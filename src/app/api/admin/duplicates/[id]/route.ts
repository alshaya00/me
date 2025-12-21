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

// GET /api/admin/duplicates/[id] - Get duplicate details
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getAuthUser(request);
    if (!user || (user.role !== 'SUPER_ADMIN' && user.role !== 'ADMIN')) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized' },
        { status: 401 }
      );
    }

    const duplicate = await prisma.duplicateFlag.findUnique({
      where: { id: params.id },
      include: {
        sourceMember: true,
        targetMember: true,
      },
    });

    if (!duplicate) {
      return NextResponse.json(
        { success: false, message: 'Duplicate flag not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      duplicate,
    });
  } catch (error) {
    console.error('Error fetching duplicate:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to fetch duplicate' },
      { status: 500 }
    );
  }
}

// PUT /api/admin/duplicates/[id] - Resolve duplicate (mark as not duplicate or merge)
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getAuthUser(request);
    if (!user || (user.role !== 'SUPER_ADMIN' && user.role !== 'ADMIN')) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { action, keepMemberId, mergeStrategy } = body;

    // Validate action
    if (!['NOT_DUPLICATE', 'MERGE', 'CONFIRMED_DUPLICATE'].includes(action)) {
      return NextResponse.json(
        { success: false, message: 'Invalid action. Must be NOT_DUPLICATE, MERGE, or CONFIRMED_DUPLICATE' },
        { status: 400 }
      );
    }

    // Get the duplicate flag
    const duplicate = await prisma.duplicateFlag.findUnique({
      where: { id: params.id },
      include: {
        sourceMember: true,
        targetMember: true,
      },
    });

    if (!duplicate) {
      return NextResponse.json(
        { success: false, message: 'Duplicate flag not found' },
        { status: 404 }
      );
    }

    if (duplicate.status !== 'PENDING') {
      return NextResponse.json(
        { success: false, message: 'Duplicate already resolved' },
        { status: 400 }
      );
    }

    // Handle different actions
    if (action === 'NOT_DUPLICATE') {
      // Mark as not a duplicate
      const updated = await prisma.duplicateFlag.update({
        where: { id: params.id },
        data: {
          status: 'NOT_DUPLICATE',
          resolvedBy: user.id,
          resolvedAt: new Date(),
          resolution: 'Marked as not duplicate by admin',
        },
      });

      return NextResponse.json({
        success: true,
        message: 'Marked as not duplicate',
        duplicate: updated,
      });
    }

    if (action === 'CONFIRMED_DUPLICATE') {
      // Just confirm it's a duplicate but don't merge yet
      const updated = await prisma.duplicateFlag.update({
        where: { id: params.id },
        data: {
          status: 'CONFIRMED_DUPLICATE',
          resolvedBy: user.id,
          resolvedAt: new Date(),
          resolution: 'Confirmed as duplicate, pending merge decision',
        },
      });

      return NextResponse.json({
        success: true,
        message: 'Confirmed as duplicate',
        duplicate: updated,
      });
    }

    if (action === 'MERGE') {
      // Validate keepMemberId
      if (!keepMemberId || (keepMemberId !== duplicate.sourceMemberId && keepMemberId !== duplicate.targetMemberId)) {
        return NextResponse.json(
          { success: false, message: 'keepMemberId must be either sourceMemberId or targetMemberId' },
          { status: 400 }
        );
      }

      const keepMember = keepMemberId === duplicate.sourceMemberId ? duplicate.sourceMember : duplicate.targetMember;
      const removeMember = keepMemberId === duplicate.sourceMemberId ? duplicate.targetMember : duplicate.sourceMember;

      if (!keepMember || !removeMember) {
        return NextResponse.json(
          { success: false, message: 'One of the members no longer exists' },
          { status: 400 }
        );
      }

      const batchId = randomUUID();

      // Start transaction for merge
      const result = await prisma.$transaction(async (tx: TransactionClient) => {
        // 1. Record the merge in change history
        await tx.changeHistory.create({
          data: {
            memberId: keepMember.id,
            fieldName: 'MERGE',
            oldValue: null,
            newValue: JSON.stringify({
              mergedFrom: removeMember.id,
              mergedFromName: removeMember.fullNameAr || removeMember.firstName,
            }),
            changeType: 'UPDATE',
            changedBy: user.id,
            changedByName: user.nameArabic,
            batchId,
            fullSnapshot: JSON.stringify(keepMember),
            reason: `Merged with duplicate member ${removeMember.id}`,
          },
        });

        // 2. Merge data based on strategy
        const mergeData: Record<string, unknown> = {};

        if (mergeStrategy === 'PREFER_SOURCE') {
          // Prefer source member data, fill gaps with target
          const fields = ['phone', 'city', 'occupation', 'email', 'biography', 'photoUrl', 'birthYear', 'deathYear'];
          for (const field of fields) {
            const sourceVal = (duplicate.sourceMember as Record<string, unknown>)[field];
            const targetVal = (duplicate.targetMember as Record<string, unknown>)[field];
            if (keepMemberId === duplicate.sourceMemberId) {
              if (!sourceVal && targetVal) mergeData[field] = targetVal;
            } else {
              if (!targetVal && sourceVal) mergeData[field] = sourceVal;
            }
          }
        } else if (mergeStrategy === 'PREFER_TARGET') {
          // Prefer target member data, fill gaps with source
          const fields = ['phone', 'city', 'occupation', 'email', 'biography', 'photoUrl', 'birthYear', 'deathYear'];
          for (const field of fields) {
            const sourceVal = (duplicate.sourceMember as Record<string, unknown>)[field];
            const targetVal = (duplicate.targetMember as Record<string, unknown>)[field];
            if (keepMemberId === duplicate.targetMemberId) {
              if (!targetVal && sourceVal) mergeData[field] = sourceVal;
            } else {
              if (!sourceVal && targetVal) mergeData[field] = targetVal;
            }
          }
        } else {
          // Default: fill empty fields from the other member
          const fields = ['phone', 'city', 'occupation', 'email', 'biography', 'photoUrl', 'birthYear', 'deathYear'];
          const otherMember = keepMemberId === duplicate.sourceMemberId ? duplicate.targetMember : duplicate.sourceMember;
          for (const field of fields) {
            const keepVal = (keepMember as Record<string, unknown>)[field];
            const otherVal = (otherMember as Record<string, unknown>)[field];
            if (!keepVal && otherVal) {
              mergeData[field] = otherVal;
            }
          }
        }

        // 3. Update the kept member with merged data
        if (Object.keys(mergeData).length > 0) {
          await tx.familyMember.update({
            where: { id: keepMember.id },
            data: mergeData,
          });
        }

        // 4. Reassign children from removed member to kept member
        await tx.familyMember.updateMany({
          where: { fatherId: removeMember.id },
          data: { fatherId: keepMember.id },
        });

        // 5. Transfer photos from removed member to kept member
        await tx.memberPhoto.updateMany({
          where: { memberId: removeMember.id },
          data: { memberId: keepMember.id },
        });

        // 6. Update change history references
        await tx.changeHistory.updateMany({
          where: { memberId: removeMember.id },
          data: { memberId: keepMember.id },
        });

        // 7. Delete the removed member
        await tx.familyMember.delete({
          where: { id: removeMember.id },
        });

        // 8. Update the duplicate flag
        const updated = await tx.duplicateFlag.update({
          where: { id: params.id },
          data: {
            status: 'MERGED',
            resolvedBy: user.id,
            resolvedAt: new Date(),
            resolution: JSON.stringify({
              action: 'MERGED',
              keptMemberId: keepMember.id,
              removedMemberId: removeMember.id,
              mergeStrategy: mergeStrategy || 'FILL_EMPTY',
              mergedFields: Object.keys(mergeData),
            }),
          },
        });

        // 9. Clean up any other duplicate flags involving the removed member
        await tx.duplicateFlag.deleteMany({
          where: {
            OR: [
              { sourceMemberId: removeMember.id },
              { targetMemberId: removeMember.id },
            ],
            id: { not: params.id },
          },
        });

        return updated;
      });

      return NextResponse.json({
        success: true,
        message: 'Members merged successfully',
        messageAr: 'تم دمج الأعضاء بنجاح',
        duplicate: result,
        mergeDetails: {
          keptMemberId: keepMember.id,
          removedMemberId: removeMember.id,
        },
      });
    }

    return NextResponse.json(
      { success: false, message: 'Invalid action' },
      { status: 400 }
    );
  } catch (error) {
    console.error('Error resolving duplicate:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to resolve duplicate' },
      { status: 500 }
    );
  }
}

// DELETE /api/admin/duplicates/[id] - Delete duplicate flag
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getAuthUser(request);
    if (!user || (user.role !== 'SUPER_ADMIN' && user.role !== 'ADMIN')) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized' },
        { status: 401 }
      );
    }

    await prisma.duplicateFlag.delete({
      where: { id: params.id },
    });

    return NextResponse.json({
      success: true,
      message: 'Duplicate flag deleted',
    });
  } catch (error) {
    console.error('Error deleting duplicate:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to delete duplicate flag' },
      { status: 500 }
    );
  }
}
