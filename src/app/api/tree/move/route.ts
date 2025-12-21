import { NextRequest, NextResponse } from 'next/server';
import { prisma, TransactionClient } from '@/lib/prisma';
import { findSessionByToken, findUserById } from '@/lib/auth/store';
import { getMemberById, familyMembers, updateMemberInMemory } from '@/lib/data';
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

// Helper to check if a member is a descendant of another
function isDescendant(potentialDescendantId: string, ancestorId: string): boolean {
  const visited = new Set<string>();
  const queue = [ancestorId];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    if (visited.has(currentId)) continue;
    visited.add(currentId);

    const children = familyMembers.filter(m => m.fatherId === currentId);
    for (const child of children) {
      if (child.id === potentialDescendantId) {
        return true;
      }
      queue.push(child.id);
    }
  }

  return false;
}

// Helper to calculate generation based on parent
function calculateGeneration(parentId: string | null): number {
  if (!parentId) return 1;

  const parent = getMemberById(parentId);
  if (!parent) return 1;

  return (parent.generation || 1) + 1;
}

// Helper to update generations for all descendants
async function updateDescendantGenerations(
  tx: typeof prisma,
  memberId: string,
  newGeneration: number
): Promise<number> {
  let updated = 0;
  const children = await tx.familyMember.findMany({
    where: { fatherId: memberId },
    select: { id: true },
  });

  for (const child of children) {
    await tx.familyMember.update({
      where: { id: child.id },
      data: { generation: newGeneration + 1 },
    });
    updated++;
    updated += await updateDescendantGenerations(tx, child.id, newGeneration + 1);
  }

  return updated;
}

// POST /api/tree/move - Move a member to a new parent (drag-and-drop)
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Check permission - need edit_members permission
    if (user.role !== 'SUPER_ADMIN' && user.role !== 'ADMIN' && user.role !== 'BRANCH_LEADER') {
      return NextResponse.json(
        { success: false, message: 'No permission to move members' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { memberId, newParentId, updateGenerations = true } = body;

    // Validate memberId
    if (!memberId) {
      return NextResponse.json(
        { success: false, message: 'memberId is required' },
        { status: 400 }
      );
    }

    // Get the member to move
    const member = getMemberById(memberId);
    if (!member) {
      return NextResponse.json(
        { success: false, message: 'Member not found' },
        { status: 404 }
      );
    }

    // Check for branch leader scope
    if (user.role === 'BRANCH_LEADER' && user.assignedBranch) {
      if (member.branch !== user.assignedBranch) {
        return NextResponse.json(
          { success: false, message: 'You can only move members in your branch' },
          { status: 403 }
        );
      }
    }

    // Validate new parent if provided
    if (newParentId) {
      const newParent = getMemberById(newParentId);
      if (!newParent) {
        return NextResponse.json(
          { success: false, message: 'New parent not found' },
          { status: 404 }
        );
      }

      // Check that new parent is male (father)
      if (newParent.gender !== 'Male') {
        return NextResponse.json(
          { success: false, message: 'Parent must be male (father)' },
          { status: 400 }
        );
      }

      // Check for circular reference - can't set a descendant as parent
      if (isDescendant(newParentId, memberId)) {
        return NextResponse.json(
          { success: false, message: 'Cannot set a descendant as parent (would create cycle)' },
          { status: 400 }
        );
      }

      // Can't set self as parent
      if (newParentId === memberId) {
        return NextResponse.json(
          { success: false, message: 'Cannot set self as parent' },
          { status: 400 }
        );
      }
    }

    const oldParentId = member.fatherId;
    const newGeneration = calculateGeneration(newParentId);
    const batchId = randomUUID();

    try {
      // Perform the move in a transaction
      const result = await prisma.$transaction(async (tx: TransactionClient) => {
        // 1. Record the change in history
        await tx.changeHistory.create({
          data: {
            memberId,
            fieldName: 'fatherId',
            oldValue: oldParentId || null,
            newValue: newParentId || null,
            changeType: 'PARENT_CHANGE',
            changedBy: user.id,
            changedByName: user.nameArabic,
            batchId,
            fullSnapshot: JSON.stringify(member),
            reason: `Moved via tree editor from ${oldParentId || 'root'} to ${newParentId || 'root'}`,
          },
        });

        // 2. Update the member's parent
        const updateData: Record<string, unknown> = {
          fatherId: newParentId || null,
        };

        // 3. Update generation if requested
        if (updateGenerations && newGeneration !== member.generation) {
          updateData.generation = newGeneration;

          await tx.changeHistory.create({
            data: {
              memberId,
              fieldName: 'generation',
              oldValue: String(member.generation || 1),
              newValue: String(newGeneration),
              changeType: 'UPDATE',
              changedBy: user.id,
              changedByName: user.nameArabic,
              batchId,
            },
          });
        }

        const updatedMember = await tx.familyMember.update({
          where: { id: memberId },
          data: updateData,
        });

        // 4. Update old parent's children count
        if (oldParentId) {
          const countField = member.gender === 'Male' ? 'sonsCount' : 'daughtersCount';
          await tx.familyMember.update({
            where: { id: oldParentId },
            data: {
              [countField]: { decrement: 1 },
            },
          }).catch(() => {
            // Parent might not exist
          });
        }

        // 5. Update new parent's children count
        if (newParentId) {
          const countField = member.gender === 'Male' ? 'sonsCount' : 'daughtersCount';
          await tx.familyMember.update({
            where: { id: newParentId },
            data: {
              [countField]: { increment: 1 },
            },
          }).catch(() => {
            // Parent might not exist
          });
        }

        // 6. Update descendant generations if needed
        let descendantsUpdated = 0;
        if (updateGenerations) {
          descendantsUpdated = await updateDescendantGenerations(tx, memberId, newGeneration);
        }

        return {
          member: updatedMember,
          descendantsUpdated,
        };
      });

      // Also update in-memory data
      updateMemberInMemory(memberId, {
        fatherId: newParentId || null,
        generation: newGeneration,
      });

      return NextResponse.json({
        success: true,
        message: 'Member moved successfully',
        messageAr: 'تم نقل العضو بنجاح',
        member: result.member,
        changes: {
          oldParentId,
          newParentId,
          oldGeneration: member.generation,
          newGeneration,
          descendantsUpdated: result.descendantsUpdated,
        },
        batchId,
      });
    } catch (dbError) {
      console.error('Database error during move:', dbError);

      // Fallback to in-memory update
      const updated = updateMemberInMemory(memberId, {
        fatherId: newParentId || null,
        generation: newGeneration,
      });

      if (!updated) {
        return NextResponse.json(
          { success: false, message: 'Failed to move member' },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        message: 'Member moved (in-memory only - database unavailable)',
        member: updated,
        warning: 'Database persistence failed',
      });
    }
  } catch (error) {
    console.error('Error moving member:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to move member' },
      { status: 500 }
    );
  }
}

// PUT /api/tree/move - Batch move multiple members
export async function PUT(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user || (user.role !== 'SUPER_ADMIN' && user.role !== 'ADMIN')) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized - Admin required' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { moves } = body;

    if (!Array.isArray(moves) || moves.length === 0) {
      return NextResponse.json(
        { success: false, message: 'moves array is required' },
        { status: 400 }
      );
    }

    if (moves.length > 50) {
      return NextResponse.json(
        { success: false, message: 'Maximum 50 moves per batch' },
        { status: 400 }
      );
    }

    const batchId = randomUUID();
    const results: Array<{ memberId: string; success: boolean; error?: string }> = [];

    // Validate all moves first
    for (const move of moves) {
      const { memberId, newParentId } = move;

      if (!memberId) {
        results.push({ memberId: 'unknown', success: false, error: 'memberId is required' });
        continue;
      }

      const member = getMemberById(memberId);
      if (!member) {
        results.push({ memberId, success: false, error: 'Member not found' });
        continue;
      }

      if (newParentId) {
        const newParent = getMemberById(newParentId);
        if (!newParent) {
          results.push({ memberId, success: false, error: 'New parent not found' });
          continue;
        }

        if (newParent.gender !== 'Male') {
          results.push({ memberId, success: false, error: 'Parent must be male' });
          continue;
        }

        if (isDescendant(newParentId, memberId)) {
          results.push({ memberId, success: false, error: 'Would create cycle' });
          continue;
        }
      }

      // Valid move
      results.push({ memberId, success: true });
    }

    // Execute valid moves
    const validMoves = moves.filter((_, i) => results[i].success);

    if (validMoves.length > 0) {
      await prisma.$transaction(async (tx: TransactionClient) => {
        for (const move of validMoves) {
          const member = getMemberById(move.memberId)!;
          const newGeneration = calculateGeneration(move.newParentId);

          await tx.changeHistory.create({
            data: {
              memberId: move.memberId,
              fieldName: 'fatherId',
              oldValue: member.fatherId || null,
              newValue: move.newParentId || null,
              changeType: 'PARENT_CHANGE',
              changedBy: user.id,
              changedByName: user.nameArabic,
              batchId,
              reason: 'Batch move via tree editor',
            },
          });

          await tx.familyMember.update({
            where: { id: move.memberId },
            data: {
              fatherId: move.newParentId || null,
              generation: newGeneration,
            },
          });

          // Update in-memory
          updateMemberInMemory(move.memberId, {
            fatherId: move.newParentId || null,
            generation: newGeneration,
          });
        }
      });
    }

    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    return NextResponse.json({
      success: true,
      message: `Batch move completed: ${successCount} succeeded, ${failCount} failed`,
      messageAr: `تمت العملية: ${successCount} نجحت، ${failCount} فشلت`,
      results,
      batchId,
    });
  } catch (error) {
    console.error('Error in batch move:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to execute batch move' },
      { status: 500 }
    );
  }
}
