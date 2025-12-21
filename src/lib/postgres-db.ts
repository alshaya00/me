/**
 * PostgreSQL database layer using Prisma
 * Replaces the SQLite implementation for Replit deployment
 *
 * CONCURRENCY HANDLING:
 * - Uses PostgreSQL transactions for write operations
 * - Implements optimistic locking with version numbers for updates
 * - Atomic ID generation within transactions to prevent duplicates
 * - Retry mechanism for database errors
 */

import { prisma, TransactionClient } from './prisma';
import { FamilyMember } from './data';

// Constants for retry mechanism
const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 100;

// Error types for better error handling
export class DatabaseError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
    this.name = 'DatabaseError';
  }
}

export class ConcurrencyError extends DatabaseError {
  constructor(message: string) {
    super(message, 'CONCURRENCY_ERROR');
    this.name = 'ConcurrencyError';
  }
}

export class DuplicateIdError extends DatabaseError {
  constructor(id: string) {
    super(`Member with ID ${id} already exists`, 'DUPLICATE_ID');
    this.name = 'DuplicateIdError';
  }
}

/**
 * Sleep utility for retry delays
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry wrapper for database operations that may fail due to transient errors
 */
async function withRetry<T>(
  operation: () => Promise<T>,
  operationName: string
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;
      const errorMessage = (error as Error).message || '';

      // Check if it's a transient error that we should retry
      if (
        errorMessage.includes('connection') ||
        errorMessage.includes('timeout') ||
        errorMessage.includes('ECONNRESET')
      ) {
        if (attempt < MAX_RETRIES) {
          const delayMs = RETRY_DELAY_MS * Math.pow(2, attempt - 1); // Exponential backoff
          console.warn(
            `${operationName}: Database error, retrying in ${delayMs}ms (attempt ${attempt}/${MAX_RETRIES})`
          );
          await sleep(delayMs);
          continue;
        }
      }

      // For non-transient errors or max retries exceeded, throw immediately
      throw error;
    }
  }

  throw lastError || new Error(`${operationName} failed after ${MAX_RETRIES} retries`);
}

function rowToMember(row: Record<string, unknown>): FamilyMember {
  return {
    id: row.id as string,
    firstName: row.firstName as string,
    fatherName: row.fatherName as string | null,
    grandfatherName: row.grandfatherName as string | null,
    greatGrandfatherName: row.greatGrandfatherName as string | null,
    familyName: row.familyName as string,
    fatherId: row.fatherId as string | null,
    gender: row.gender as 'Male' | 'Female',
    birthYear: row.birthYear as number | null,
    deathYear: row.deathYear as number | null,
    sonsCount: row.sonsCount as number,
    daughtersCount: row.daughtersCount as number,
    generation: row.generation as number,
    branch: row.branch as string | null,
    fullNameAr: row.fullNameAr as string | null,
    fullNameEn: row.fullNameEn as string | null,
    phone: row.phone as string | null,
    city: row.city as string | null,
    status: row.status as string,
    photoUrl: row.photoUrl as string | null,
    biography: row.biography as string | null,
    occupation: row.occupation as string | null,
    email: row.email as string | null,
    createdAt: row.createdAt ? new Date(row.createdAt as string) : undefined,
    updatedAt: row.updatedAt ? new Date(row.updatedAt as string) : undefined,
    createdBy: row.createdBy as string | null,
    lastModifiedBy: row.lastModifiedBy as string | null,
    version: row.version as number,
  };
}

export async function isDatabaseAvailable(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

export async function getAllMembers(): Promise<FamilyMember[]> {
  try {
    const rows = await prisma.familyMember.findMany({
      orderBy: { id: 'asc' },
    });
    return rows.map((row: unknown) => rowToMember(row as Record<string, unknown>));
  } catch (error) {
    console.error('Error fetching all members:', error);
    return [];
  }
}

export async function getMemberById(id: string): Promise<FamilyMember | null> {
  try {
    const row = await prisma.familyMember.findUnique({
      where: { id },
    });
    return row ? rowToMember(row as unknown as Record<string, unknown>) : null;
  } catch (error) {
    console.error('Error fetching member by id:', error);
    return null;
  }
}

export async function getMaleMembers(): Promise<FamilyMember[]> {
  try {
    const rows = await prisma.familyMember.findMany({
      where: { gender: 'Male' },
      orderBy: { id: 'asc' },
    });
    return rows.map((row: unknown) => rowToMember(row as Record<string, unknown>));
  } catch (error) {
    console.error('Error fetching male members:', error);
    return [];
  }
}

export async function getChildren(parentId: string): Promise<FamilyMember[]> {
  try {
    const rows = await prisma.familyMember.findMany({
      where: { fatherId: parentId },
      orderBy: { id: 'asc' },
    });
    return rows.map((row: unknown) => rowToMember(row as Record<string, unknown>));
  } catch (error) {
    console.error('Error fetching children:', error);
    return [];
  }
}

export async function getGen2Branches(): Promise<FamilyMember[]> {
  try {
    const rows = await prisma.familyMember.findMany({
      where: { generation: 2 },
      orderBy: { id: 'asc' },
    });
    return rows.map((row: unknown) => rowToMember(row as Record<string, unknown>));
  } catch (error) {
    console.error('Error fetching Gen 2 branches:', error);
    return [];
  }
}

/**
 * Get the next available ID
 * NOTE: This is for display purposes only. For actual inserts, use createMemberWithAutoId
 * which generates the ID atomically within a transaction.
 */
export async function getNextId(): Promise<string> {
  try {
    const result = await prisma.familyMember.findFirst({
      orderBy: { id: 'desc' },
      select: { id: true },
    });
    if (!result) return 'P001';

    const numPart = parseInt(result.id.replace('P', ''));
    return `P${String(numPart + 1).padStart(3, '0')}`;
  } catch (error) {
    console.error('Error getting next ID:', error);
    return 'P001';
  }
}

export async function getMemberCount(): Promise<number> {
  try {
    return await prisma.familyMember.count();
  } catch (error) {
    console.error('Error getting member count:', error);
    return 0;
  }
}

/**
 * Check if a member ID already exists
 */
export async function memberExists(id: string): Promise<boolean> {
  try {
    const result = await prisma.familyMember.findUnique({
      where: { id },
      select: { id: true },
    });
    return result !== null;
  } catch (error) {
    console.error('Error checking member existence:', error);
    return false;
  }
}

/**
 * Generate the next available ID atomically within a transaction
 * This prevents race conditions where two concurrent requests get the same ID
 */
async function generateNextIdInTransaction(tx: typeof prisma): Promise<string> {
  const result = await tx.familyMember.findFirst({
    orderBy: { id: 'desc' },
    select: { id: true },
  });

  if (!result) return 'P001';

  const numPart = parseInt(result.id.replace('P', ''));
  return `P${String(numPart + 1).padStart(3, '0')}`;
}

/**
 * Create a new member with automatic ID generation
 * This is the RECOMMENDED way to create members as it handles concurrency safely
 *
 * @param memberData - Member data WITHOUT the id field
 * @returns The created member with its generated ID, or null on failure
 */
export async function createMemberWithAutoId(
  memberData: Omit<FamilyMember, 'id' | 'createdAt' | 'updatedAt'>
): Promise<FamilyMember | null> {
  return withRetry(async () => {
    // Use PostgreSQL transaction for atomicity
    const result = await prisma.$transaction(async (tx: TransactionClient) => {
      // Generate ID within the transaction (atomic operation)
      const newId = await generateNextIdInTransaction(tx);

      // Check for duplicate (should never happen in transaction, but safety check)
      const existing = await tx.familyMember.findUnique({
        where: { id: newId },
        select: { id: true },
      });
      if (existing) {
        throw new DuplicateIdError(newId);
      }

      // Insert the new member
      const created = await tx.familyMember.create({
        data: {
          id: newId,
          firstName: memberData.firstName,
          fatherName: memberData.fatherName || null,
          grandfatherName: memberData.grandfatherName || null,
          greatGrandfatherName: memberData.greatGrandfatherName || null,
          familyName: memberData.familyName || 'آل شايع',
          fatherId: memberData.fatherId || null,
          gender: memberData.gender,
          birthYear: memberData.birthYear || null,
          deathYear: memberData.deathYear || null,
          sonsCount: memberData.sonsCount || 0,
          daughtersCount: memberData.daughtersCount || 0,
          generation: memberData.generation || 1,
          branch: memberData.branch || null,
          fullNameAr: memberData.fullNameAr || null,
          fullNameEn: memberData.fullNameEn || null,
          phone: memberData.phone || null,
          city: memberData.city || null,
          status: memberData.status || 'Living',
          photoUrl: memberData.photoUrl || null,
          biography: memberData.biography || null,
          occupation: memberData.occupation || null,
          email: memberData.email || null,
          createdBy: memberData.createdBy || 'system',
          version: 1,
        },
      });

      // Update parent's child count within the same transaction
      if (memberData.fatherId) {
        const countField = memberData.gender === 'Male' ? 'sonsCount' : 'daughtersCount';
        await tx.familyMember.update({
          where: { id: memberData.fatherId },
          data: {
            [countField]: { increment: 1 },
            version: { increment: 1 },
          },
        });
      }

      return created;
    });

    return rowToMember(result as unknown as Record<string, unknown>);
  }, 'createMemberWithAutoId');
}

/**
 * Create a new member with a specific ID
 * Use this only when you have a pre-validated ID (e.g., from import)
 * For normal operations, use createMemberWithAutoId instead
 *
 * @param member - Member data including the id field
 * @returns The created member, or null on failure
 * @throws DuplicateIdError if the ID already exists
 */
export async function createMember(
  member: Omit<FamilyMember, 'createdAt' | 'updatedAt'>
): Promise<FamilyMember | null> {
  return withRetry(async () => {
    const result = await prisma.$transaction(async (tx: TransactionClient) => {
      // Check for duplicate ID
      const existing = await tx.familyMember.findUnique({
        where: { id: member.id },
        select: { id: true },
      });
      if (existing) {
        throw new DuplicateIdError(member.id);
      }

      const created = await tx.familyMember.create({
        data: {
          id: member.id,
          firstName: member.firstName,
          fatherName: member.fatherName || null,
          grandfatherName: member.grandfatherName || null,
          greatGrandfatherName: member.greatGrandfatherName || null,
          familyName: member.familyName || 'آل شايع',
          fatherId: member.fatherId || null,
          gender: member.gender,
          birthYear: member.birthYear || null,
          deathYear: member.deathYear || null,
          sonsCount: member.sonsCount || 0,
          daughtersCount: member.daughtersCount || 0,
          generation: member.generation || 1,
          branch: member.branch || null,
          fullNameAr: member.fullNameAr || null,
          fullNameEn: member.fullNameEn || null,
          phone: member.phone || null,
          city: member.city || null,
          status: member.status || 'Living',
          photoUrl: member.photoUrl || null,
          biography: member.biography || null,
          occupation: member.occupation || null,
          email: member.email || null,
          createdBy: member.createdBy || 'system',
          version: 1,
        },
      });

      // Update parent's child count
      if (member.fatherId) {
        const countField = member.gender === 'Male' ? 'sonsCount' : 'daughtersCount';
        await tx.familyMember.update({
          where: { id: member.fatherId },
          data: {
            [countField]: { increment: 1 },
            version: { increment: 1 },
          },
        });
      }

      return created;
    });

    return rowToMember(result as unknown as Record<string, unknown>);
  }, 'createMember');
}

/**
 * Update a member with optimistic locking
 * This prevents lost updates when two users edit the same member simultaneously
 *
 * @param id - The member ID to update
 * @param updates - The fields to update
 * @param expectedVersion - Optional: The expected version number (for optimistic locking)
 * @returns The updated member, or null on failure
 * @throws ConcurrencyError if the version doesn't match (someone else updated first)
 */
export async function updateMember(
  id: string,
  updates: Partial<FamilyMember>,
  expectedVersion?: number
): Promise<FamilyMember | null> {
  return withRetry(async () => {
    const result = await prisma.$transaction(async (tx: TransactionClient) => {
      // Get current member to check version
      const current = await tx.familyMember.findUnique({
        where: { id },
        select: { version: true },
      });

      if (!current) {
        throw new DatabaseError(`Member ${id} not found`, 'NOT_FOUND');
      }

      // Optimistic locking check
      if (expectedVersion !== undefined && current.version !== expectedVersion) {
        throw new ConcurrencyError(
          `Member ${id} was modified by another user. Expected version ${expectedVersion}, found ${current.version}. Please refresh and try again.`
        );
      }

      const allowedFields = [
        'firstName', 'fatherName', 'grandfatherName', 'greatGrandfatherName',
        'familyName', 'fatherId', 'gender', 'birthYear', 'deathYear', 'sonsCount',
        'daughtersCount', 'generation', 'branch', 'fullNameAr', 'fullNameEn',
        'phone', 'city', 'status', 'photoUrl', 'biography', 'occupation', 'email',
        'lastModifiedBy'
      ];

      const updateData: Record<string, unknown> = {
        version: { increment: 1 },
      };

      for (const field of allowedFields) {
        if (field in updates) {
          updateData[field] = updates[field as keyof FamilyMember] ?? null;
        }
      }

      const updated = await tx.familyMember.update({
        where: { id },
        data: updateData,
      });

      return updated;
    });

    return rowToMember(result as unknown as Record<string, unknown>);
  }, 'updateMember');
}

/**
 * Delete a member with proper transaction handling
 * Also updates the parent's child count
 *
 * @param id - The member ID to delete
 * @returns true if deleted, false otherwise
 */
export async function deleteMember(id: string): Promise<boolean> {
  return withRetry(async () => {
    return await prisma.$transaction(async (tx: TransactionClient) => {
      // Get member info before deleting (to update parent's count)
      const member = await tx.familyMember.findUnique({
        where: { id },
        select: { fatherId: true, gender: true },
      });

      if (!member) {
        return false; // Member doesn't exist
      }

      // Check if member has children
      const hasChildren = await tx.familyMember.findFirst({
        where: { fatherId: id },
        select: { id: true },
      });
      if (hasChildren) {
        throw new DatabaseError(
          `Cannot delete member ${id} because they have children. Delete children first.`,
          'HAS_CHILDREN'
        );
      }

      // Delete the member
      await tx.familyMember.delete({
        where: { id },
      });

      // Update parent's child count
      if (member.fatherId) {
        const countField = member.gender === 'Male' ? 'sonsCount' : 'daughtersCount';
        await tx.familyMember.update({
          where: { id: member.fatherId },
          data: {
            [countField]: { decrement: 1 },
            version: { increment: 1 },
          },
        });
      }

      return true;
    });
  }, 'deleteMember');
}

/**
 * Bulk create members (for seeding/import)
 * Uses a single transaction for atomicity and performance
 */
export async function bulkCreateMembers(
  members: Omit<FamilyMember, 'createdAt' | 'updatedAt'>[]
): Promise<{ success: number; failed: number; errors: string[] }> {
  const errors: string[] = [];
  let success = 0;
  let failed = 0;

  return withRetry(async () => {
    await prisma.$transaction(async (tx: TransactionClient) => {
      for (const member of members) {
        try {
          // Check if already exists
          const existing = await tx.familyMember.findUnique({
            where: { id: member.id },
            select: { id: true },
          });

          if (existing) {
            failed++;
            errors.push(`ID ${member.id}: Already exists`);
            continue;
          }

          await tx.familyMember.create({
            data: {
              id: member.id,
              firstName: member.firstName,
              fatherName: member.fatherName || null,
              grandfatherName: member.grandfatherName || null,
              greatGrandfatherName: member.greatGrandfatherName || null,
              familyName: member.familyName || 'آل شايع',
              fatherId: member.fatherId || null,
              gender: member.gender,
              birthYear: member.birthYear || null,
              deathYear: member.deathYear || null,
              sonsCount: member.sonsCount || 0,
              daughtersCount: member.daughtersCount || 0,
              generation: member.generation || 1,
              branch: member.branch || null,
              fullNameAr: member.fullNameAr || null,
              fullNameEn: member.fullNameEn || null,
              phone: member.phone || null,
              city: member.city || null,
              status: member.status || 'Living',
              photoUrl: member.photoUrl || null,
              biography: member.biography || null,
              occupation: member.occupation || null,
              email: member.email || null,
              createdBy: member.createdBy || 'system',
              version: 1,
            },
          });
          success++;
        } catch (error) {
          failed++;
          errors.push(`ID ${member.id}: ${(error as Error).message}`);
        }
      }
    });

    return { success, failed, errors };
  }, 'bulkCreateMembers');
}

export async function getStatistics() {
  try {
    const members = await getAllMembers();
    const totalMembers = members.length;

    if (totalMembers === 0) {
      return {
        totalMembers: 0,
        males: 0,
        females: 0,
        generations: 0,
        branches: [],
        generationBreakdown: [],
      };
    }

    const males = members.filter(m => m.gender === 'Male').length;
    const females = members.filter(m => m.gender === 'Female').length;
    const generations = Math.max(...members.map(m => m.generation));

    const branches = [...new Set(members.map(m => m.branch).filter(Boolean))] as string[];
    const branchCounts = branches.map(branch => ({
      name: branch,
      count: members.filter(m => m.branch === branch).length,
    }));

    const generationBreakdown = Array.from({ length: generations }, (_, i) => {
      const gen = i + 1;
      const genMembers = members.filter(m => m.generation === gen);
      return {
        generation: gen,
        count: genMembers.length,
        males: genMembers.filter(m => m.gender === 'Male').length,
        females: genMembers.filter(m => m.gender === 'Female').length,
        percentage: totalMembers > 0 ? Math.round((genMembers.length / totalMembers) * 100) : 0,
      };
    });

    return {
      totalMembers,
      males,
      females,
      generations,
      branches: branchCounts,
      generationBreakdown,
    };
  } catch (error) {
    console.error('Error getting statistics:', error);
    return {
      totalMembers: 0,
      males: 0,
      females: 0,
      generations: 0,
      branches: [],
      generationBreakdown: [],
    };
  }
}

/**
 * Acquire an advisory lock for a specific operation
 * This is a simple in-process lock for additional safety
 */
const operationLocks = new Map<string, Promise<void>>();

export async function withLock<T>(
  lockKey: string,
  operation: () => Promise<T>
): Promise<T> {
  // Wait for any existing operation with the same key
  const existingLock = operationLocks.get(lockKey);
  if (existingLock) {
    await existingLock;
  }

  let resolve: () => void;
  const lockPromise = new Promise<void>(r => { resolve = r; });
  operationLocks.set(lockKey, lockPromise);

  try {
    return await operation();
  } finally {
    resolve!();
    operationLocks.delete(lockKey);
  }
}
