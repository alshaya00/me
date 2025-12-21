import { NextRequest, NextResponse } from 'next/server';
import { prisma, TransactionClient } from '@/lib/prisma';
import { findSessionByToken, findUserById } from '@/lib/auth/store';
import { randomUUID } from 'crypto';

// Helper to get auth user from request
async function getAuthUser(request: NextRequest) {
  const authHeader = request.headers.get('Authorization');
  const token = authHeader?.replace('Bearer ', '');

  if (!token) return null;

  const session = await findSessionByToken(token);
  if (!session) return null;

  const user = await findUserById(session.userId);
  if (!user || user.status !== 'ACTIVE') return null;

  return user;
}

// GET /api/admin/rollback - Get rollback candidates (recent changes that can be rolled back)
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user || (user.role !== 'SUPER_ADMIN' && user.role !== 'ADMIN')) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const memberId = searchParams.get('memberId');
    const batchId = searchParams.get('batchId');
    const limit = parseInt(searchParams.get('limit') || '50');

    // Build query
    const where: Record<string, unknown> = {
      fullSnapshot: { not: null }, // Only changes with snapshots can be rolled back
    };

    if (memberId) where.memberId = memberId;
    if (batchId) where.batchId = batchId;

    // Get recent changes with snapshots
    const changes = await prisma.changeHistory.findMany({
      where,
      orderBy: { changedAt: 'desc' },
      take: limit,
      include: {
        member: {
          select: {
            id: true,
            firstName: true,
            fullNameAr: true,
          },
        },
      },
    });

    // Group by batch for easier viewing
    const batches: Record<string, typeof changes> = {};
    for (const change of changes) {
      const key = change.batchId || change.id;
      if (!batches[key]) batches[key] = [];
      batches[key].push(change);
    }

    return NextResponse.json({
      success: true,
      changes,
      batches: Object.entries(batches).map(([batchId, batchChanges]) => ({
        batchId,
        changedAt: batchChanges[0].changedAt,
        changedBy: batchChanges[0].changedByName,
        memberId: batchChanges[0].memberId,
        memberName: batchChanges[0].member?.fullNameAr || batchChanges[0].member?.firstName,
        changeCount: batchChanges.length,
        changes: batchChanges.map((c: typeof changes[0]) => ({
          id: c.id,
          fieldName: c.fieldName,
          oldValue: c.oldValue,
          newValue: c.newValue,
          changeType: c.changeType,
        })),
      })),
    });
  } catch (error) {
    console.error('Error fetching rollback candidates:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to fetch rollback candidates' },
      { status: 500 }
    );
  }
}

// POST /api/admin/rollback - Execute rollback
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user || (user.role !== 'SUPER_ADMIN' && user.role !== 'ADMIN')) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { changeId, batchId, memberId, rollbackType } = body;

    // Validate rollback type
    if (!['SINGLE_CHANGE', 'BATCH', 'FULL_SNAPSHOT'].includes(rollbackType)) {
      return NextResponse.json(
        { success: false, message: 'Invalid rollbackType. Must be SINGLE_CHANGE, BATCH, or FULL_SNAPSHOT' },
        { status: 400 }
      );
    }

    const rollbackBatchId = randomUUID();
    let rolledBackCount = 0;

    if (rollbackType === 'SINGLE_CHANGE') {
      // Rollback a single field change
      if (!changeId) {
        return NextResponse.json(
          { success: false, message: 'changeId is required for SINGLE_CHANGE rollback' },
          { status: 400 }
        );
      }

      const change = await prisma.changeHistory.findUnique({
        where: { id: changeId },
      });

      if (!change) {
        return NextResponse.json(
          { success: false, message: 'Change not found' },
          { status: 404 }
        );
      }

      // Rollback single field
      await prisma.$transaction(async (tx: TransactionClient) => {
        // Get current value for history
        const currentMember = await tx.familyMember.findUnique({
          where: { id: change.memberId },
        });

        if (!currentMember) {
          throw new Error('Member not found');
        }

        const currentValue = (currentMember as Record<string, unknown>)[change.fieldName];

        // Update the field to old value
        await tx.familyMember.update({
          where: { id: change.memberId },
          data: {
            [change.fieldName]: change.oldValue,
          },
        });

        // Record the rollback in history
        await tx.changeHistory.create({
          data: {
            memberId: change.memberId,
            fieldName: change.fieldName,
            oldValue: currentValue !== null && currentValue !== undefined ? String(currentValue) : null,
            newValue: change.oldValue,
            changeType: 'RESTORE',
            changedBy: user.id,
            changedByName: user.nameArabic,
            batchId: rollbackBatchId,
            fullSnapshot: JSON.stringify(currentMember),
            reason: `Rollback of change ${changeId}`,
          },
        });

        rolledBackCount = 1;
      });
    } else if (rollbackType === 'BATCH') {
      // Rollback all changes in a batch
      if (!batchId) {
        return NextResponse.json(
          { success: false, message: 'batchId is required for BATCH rollback' },
          { status: 400 }
        );
      }

      const batchChanges = await prisma.changeHistory.findMany({
        where: { batchId },
        orderBy: { changedAt: 'desc' }, // Reverse order to undo last changes first
      });

      if (batchChanges.length === 0) {
        return NextResponse.json(
          { success: false, message: 'No changes found for this batch' },
          { status: 404 }
        );
      }

      await prisma.$transaction(async (tx: TransactionClient) => {
        for (const change of batchChanges) {
          const currentMember = await tx.familyMember.findUnique({
            where: { id: change.memberId },
          });

          if (!currentMember) continue;

          const currentValue = (currentMember as Record<string, unknown>)[change.fieldName];

          // Update the field to old value
          await tx.familyMember.update({
            where: { id: change.memberId },
            data: {
              [change.fieldName]: change.oldValue,
            },
          });

          // Record the rollback
          await tx.changeHistory.create({
            data: {
              memberId: change.memberId,
              fieldName: change.fieldName,
              oldValue: currentValue !== null && currentValue !== undefined ? String(currentValue) : null,
              newValue: change.oldValue,
              changeType: 'RESTORE',
              changedBy: user.id,
              changedByName: user.nameArabic,
              batchId: rollbackBatchId,
              reason: `Batch rollback of ${batchId}`,
            },
          });

          rolledBackCount++;
        }
      });
    } else if (rollbackType === 'FULL_SNAPSHOT') {
      // Rollback member to full snapshot state
      if (!changeId && !memberId) {
        return NextResponse.json(
          { success: false, message: 'changeId or memberId is required for FULL_SNAPSHOT rollback' },
          { status: 400 }
        );
      }

      let snapshotChange;

      if (changeId) {
        snapshotChange = await prisma.changeHistory.findUnique({
          where: { id: changeId },
        });
      } else if (memberId) {
        // Get the most recent change with a snapshot for this member
        snapshotChange = await prisma.changeHistory.findFirst({
          where: {
            memberId,
            fullSnapshot: { not: null },
          },
          orderBy: { changedAt: 'desc' },
        });
      }

      if (!snapshotChange || !snapshotChange.fullSnapshot) {
        return NextResponse.json(
          { success: false, message: 'No snapshot found for rollback' },
          { status: 404 }
        );
      }

      let snapshot: Record<string, unknown> | null = null;
      try {
        snapshot = JSON.parse(snapshotChange.fullSnapshot);
      } catch {
        return NextResponse.json(
          { success: false, message: 'Invalid snapshot data - cannot parse' },
          { status: 400 }
        );
      }
      if (!snapshot) {
        return NextResponse.json(
          { success: false, message: 'Invalid snapshot data - cannot parse' },
          { status: 400 }
        );
      }

      await prisma.$transaction(async (tx: TransactionClient) => {
        // Get current state for history
        const currentMember = await tx.familyMember.findUnique({
          where: { id: snapshotChange.memberId },
        });

        if (!currentMember) {
          throw new Error('Member not found');
        }

        // Update member to snapshot state
        const updateData: Record<string, unknown> = {};
        const fieldsToRestore = [
          'firstName', 'fatherName', 'grandfatherName', 'greatGrandfatherName',
          'familyName', 'fatherId', 'gender', 'birthYear', 'deathYear',
          'generation', 'branch', 'fullNameAr', 'fullNameEn', 'phone',
          'city', 'status', 'photoUrl', 'biography', 'occupation', 'email',
        ];

        for (const field of fieldsToRestore) {
          if (snapshot[field] !== undefined) {
            updateData[field] = snapshot[field];
          }
        }

        await tx.familyMember.update({
          where: { id: snapshotChange.memberId },
          data: updateData,
        });

        // Record the rollback
        await tx.changeHistory.create({
          data: {
            memberId: snapshotChange.memberId,
            fieldName: 'FULL_RESTORE',
            oldValue: JSON.stringify(currentMember),
            newValue: snapshotChange.fullSnapshot,
            changeType: 'RESTORE',
            changedBy: user.id,
            changedByName: user.nameArabic,
            batchId: rollbackBatchId,
            fullSnapshot: JSON.stringify(currentMember),
            reason: `Full snapshot rollback from ${snapshotChange.changedAt.toISOString()}`,
          },
        });

        rolledBackCount = fieldsToRestore.length;
      });
    }

    return NextResponse.json({
      success: true,
      message: `Rollback completed successfully. ${rolledBackCount} change(s) rolled back.`,
      messageAr: `تم التراجع بنجاح. تم التراجع عن ${rolledBackCount} تغيير(ات).`,
      rollbackBatchId,
      rolledBackCount,
    });
  } catch (error) {
    console.error('Error executing rollback:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to execute rollback' },
      { status: 500 }
    );
  }
}
