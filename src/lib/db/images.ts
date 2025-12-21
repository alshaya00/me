// Database module for image management using Prisma
import { prisma, TransactionClient } from '../prisma';
import { randomUUID } from 'crypto';

// Types
export interface PendingImage {
  id: string;
  imageData: string;
  thumbnailData: string | null;
  category: 'profile' | 'memory' | 'document' | 'historical';
  title: string | null;
  titleAr: string | null;
  caption: string | null;
  captionAr: string | null;
  year: number | null;
  memberId: string | null;
  memberName: string | null;
  taggedMemberIds: string | null; // JSON array
  uploadedBy: string | null;
  uploadedByName: string;
  uploadedByEmail: string | null;
  uploadedAt: string;
  ipAddress: string | null;
  reviewStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  reviewedBy: string | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
  approvedPhotoId: string | null;
}

export interface MemberPhoto {
  id: string;
  imageData: string;
  thumbnailData: string | null;
  category: 'profile' | 'memory' | 'document' | 'historical';
  title: string | null;
  titleAr: string | null;
  caption: string | null;
  captionAr: string | null;
  year: number | null;
  memberId: string | null;
  taggedMemberIds: string | null;
  isFamilyAlbum: boolean;
  uploadedBy: string | null;
  uploadedByName: string;
  originalPendingId: string | null;
  isProfilePhoto: boolean;
  displayOrder: number;
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePendingImageInput {
  imageData: string;
  thumbnailData?: string;
  category?: 'profile' | 'memory' | 'document' | 'historical';
  title?: string;
  titleAr?: string;
  caption?: string;
  captionAr?: string;
  year?: number;
  memberId?: string;
  memberName?: string;
  taggedMemberIds?: string[];
  uploadedBy?: string;
  uploadedByName: string;
  uploadedByEmail?: string;
  ipAddress?: string;
}

export interface CreateMemberPhotoInput {
  imageData: string;
  thumbnailData?: string;
  category?: 'profile' | 'memory' | 'document' | 'historical';
  title?: string;
  titleAr?: string;
  caption?: string;
  captionAr?: string;
  year?: number;
  memberId?: string;
  taggedMemberIds?: string[];
  isFamilyAlbum?: boolean;
  uploadedBy?: string;
  uploadedByName: string;
  originalPendingId?: string;
  isProfilePhoto?: boolean;
  displayOrder?: number;
  isPublic?: boolean;
}

// Generate CUID-like ID
function generateId(): string {
  return randomUUID();
}

// Convert Prisma result to PendingImage
function toPendingImage(row: Record<string, unknown>): PendingImage {
  return {
    id: row.id as string,
    imageData: row.imageData as string,
    thumbnailData: row.thumbnailData as string | null,
    category: row.category as 'profile' | 'memory' | 'document' | 'historical',
    title: row.title as string | null,
    titleAr: row.titleAr as string | null,
    caption: row.caption as string | null,
    captionAr: row.captionAr as string | null,
    year: row.year as number | null,
    memberId: row.memberId as string | null,
    memberName: row.memberName as string | null,
    taggedMemberIds: row.taggedMemberIds as string | null,
    uploadedBy: row.uploadedBy as string | null,
    uploadedByName: row.uploadedByName as string,
    uploadedByEmail: row.uploadedByEmail as string | null,
    uploadedAt: (row.uploadedAt as Date).toISOString(),
    ipAddress: row.ipAddress as string | null,
    reviewStatus: row.reviewStatus as 'PENDING' | 'APPROVED' | 'REJECTED',
    reviewedBy: row.reviewedBy as string | null,
    reviewedByName: row.reviewedByName as string | null,
    reviewedAt: row.reviewedAt ? (row.reviewedAt as Date).toISOString() : null,
    reviewNotes: row.reviewNotes as string | null,
    approvedPhotoId: row.approvedPhotoId as string | null,
  };
}

// Convert Prisma result to MemberPhoto
function toMemberPhoto(row: Record<string, unknown>): MemberPhoto {
  return {
    id: row.id as string,
    imageData: row.imageData as string,
    thumbnailData: row.thumbnailData as string | null,
    category: row.category as 'profile' | 'memory' | 'document' | 'historical',
    title: row.title as string | null,
    titleAr: row.titleAr as string | null,
    caption: row.caption as string | null,
    captionAr: row.captionAr as string | null,
    year: row.year as number | null,
    memberId: row.memberId as string | null,
    taggedMemberIds: row.taggedMemberIds as string | null,
    isFamilyAlbum: row.isFamilyAlbum as boolean,
    uploadedBy: row.uploadedBy as string | null,
    uploadedByName: row.uploadedByName as string,
    originalPendingId: row.originalPendingId as string | null,
    isProfilePhoto: row.isProfilePhoto as boolean,
    displayOrder: row.displayOrder as number,
    isPublic: row.isPublic as boolean,
    createdAt: (row.createdAt as Date).toISOString(),
    updatedAt: (row.updatedAt as Date).toISOString(),
  };
}

// ======================
// PENDING IMAGE OPERATIONS
// ======================

export async function createPendingImage(input: CreatePendingImageInput): Promise<PendingImage> {
  const id = generateId();

  const result = await prisma.pendingImage.create({
    data: {
      id,
      imageData: input.imageData,
      thumbnailData: input.thumbnailData || null,
      category: input.category || 'memory',
      title: input.title || null,
      titleAr: input.titleAr || null,
      caption: input.caption || null,
      captionAr: input.captionAr || null,
      year: input.year || null,
      memberId: input.memberId || null,
      memberName: input.memberName || null,
      taggedMemberIds: input.taggedMemberIds ? JSON.stringify(input.taggedMemberIds) : null,
      uploadedBy: input.uploadedBy || null,
      uploadedByName: input.uploadedByName,
      uploadedByEmail: input.uploadedByEmail || null,
      ipAddress: input.ipAddress || null,
      reviewStatus: 'PENDING',
    },
  });

  return toPendingImage(result as unknown as Record<string, unknown>);
}

export async function getPendingImageById(id: string): Promise<PendingImage | null> {
  const row = await prisma.pendingImage.findUnique({
    where: { id },
  });

  return row ? toPendingImage(row as unknown as Record<string, unknown>) : null;
}

export async function getPendingImages(options?: {
  status?: 'PENDING' | 'APPROVED' | 'REJECTED';
  category?: string;
  memberId?: string;
  limit?: number;
  offset?: number;
}): Promise<{ images: PendingImage[]; total: number }> {
  const where: Record<string, unknown> = {};

  if (options?.status) {
    where.reviewStatus = options.status;
  }
  if (options?.category) {
    where.category = options.category;
  }
  if (options?.memberId) {
    where.memberId = options.memberId;
  }

  const [total, rows] = await Promise.all([
    prisma.pendingImage.count({ where }),
    prisma.pendingImage.findMany({
      where,
      orderBy: { uploadedAt: 'desc' },
      take: options?.limit,
      skip: options?.offset,
    }),
  ]);

  const images = rows.map((row: unknown) => toPendingImage(row as Record<string, unknown>));

  return { images, total };
}

export async function approvePendingImage(
  id: string,
  reviewedBy: string,
  reviewedByName: string,
  reviewNotes?: string
): Promise<MemberPhoto | null> {
  const pending = await prisma.pendingImage.findUnique({
    where: { id },
  });

  if (!pending) {
    return null;
  }

  const photoId = generateId();

  // Use transaction to create photo and update pending image
  await prisma.$transaction(async (tx: TransactionClient) => {
    // Create the approved photo
    await tx.memberPhoto.create({
      data: {
        id: photoId,
        imageData: pending.imageData,
        thumbnailData: pending.thumbnailData,
        category: pending.category,
        title: pending.title,
        titleAr: pending.titleAr,
        caption: pending.caption,
        captionAr: pending.captionAr,
        year: pending.year,
        memberId: pending.memberId,
        taggedMemberIds: pending.taggedMemberIds,
        isFamilyAlbum: !pending.memberId,
        uploadedBy: pending.uploadedBy,
        uploadedByName: pending.uploadedByName,
        originalPendingId: pending.id,
        isProfilePhoto: pending.category === 'profile',
        displayOrder: 0,
        isPublic: true,
      },
    });

    // Update pending image status
    await tx.pendingImage.update({
      where: { id },
      data: {
        reviewStatus: 'APPROVED',
        reviewedBy,
        reviewedByName,
        reviewedAt: new Date(),
        reviewNotes: reviewNotes || null,
        approvedPhotoId: photoId,
      },
    });
  });

  return getMemberPhotoById(photoId);
}

export async function rejectPendingImage(
  id: string,
  reviewedBy: string,
  reviewedByName: string,
  reviewNotes: string
): Promise<PendingImage | null> {
  await prisma.pendingImage.update({
    where: { id },
    data: {
      reviewStatus: 'REJECTED',
      reviewedBy,
      reviewedByName,
      reviewedAt: new Date(),
      reviewNotes,
    },
  });

  return getPendingImageById(id);
}

export async function deletePendingImage(id: string): Promise<boolean> {
  try {
    await prisma.pendingImage.delete({
      where: { id },
    });
    return true;
  } catch {
    return false;
  }
}

// ======================
// MEMBER PHOTO OPERATIONS
// ======================

export async function createMemberPhoto(input: CreateMemberPhotoInput): Promise<MemberPhoto> {
  const id = generateId();

  const result = await prisma.memberPhoto.create({
    data: {
      id,
      imageData: input.imageData,
      thumbnailData: input.thumbnailData || null,
      category: input.category || 'memory',
      title: input.title || null,
      titleAr: input.titleAr || null,
      caption: input.caption || null,
      captionAr: input.captionAr || null,
      year: input.year || null,
      memberId: input.memberId || null,
      taggedMemberIds: input.taggedMemberIds ? JSON.stringify(input.taggedMemberIds) : null,
      isFamilyAlbum: input.isFamilyAlbum || false,
      uploadedBy: input.uploadedBy || null,
      uploadedByName: input.uploadedByName,
      originalPendingId: input.originalPendingId || null,
      isProfilePhoto: input.isProfilePhoto || false,
      displayOrder: input.displayOrder || 0,
      isPublic: input.isPublic !== false,
    },
  });

  return toMemberPhoto(result as unknown as Record<string, unknown>);
}

export async function getMemberPhotoById(id: string): Promise<MemberPhoto | null> {
  const row = await prisma.memberPhoto.findUnique({
    where: { id },
  });

  return row ? toMemberPhoto(row as unknown as Record<string, unknown>) : null;
}

export async function getMemberPhotos(memberId: string, options?: {
  category?: string;
  limit?: number;
  offset?: number;
}): Promise<{ photos: MemberPhoto[]; total: number }> {
  const where: Record<string, unknown> = { memberId };

  if (options?.category) {
    where.category = options.category;
  }

  const [total, rows] = await Promise.all([
    prisma.memberPhoto.count({ where }),
    prisma.memberPhoto.findMany({
      where,
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'desc' }],
      take: options?.limit,
      skip: options?.offset,
    }),
  ]);

  const photos = rows.map((row: unknown) => toMemberPhoto(row as Record<string, unknown>));

  return { photos, total };
}

export async function getFamilyAlbumPhotos(options?: {
  category?: string;
  year?: number;
  limit?: number;
  offset?: number;
}): Promise<{ photos: MemberPhoto[]; total: number }> {
  const where: Record<string, unknown> = { isFamilyAlbum: true };

  if (options?.category) {
    where.category = options.category;
  }
  if (options?.year) {
    where.year = options.year;
  }

  const [total, rows] = await Promise.all([
    prisma.memberPhoto.count({ where }),
    prisma.memberPhoto.findMany({
      where,
      orderBy: [{ year: 'desc' }, { createdAt: 'desc' }],
      take: options?.limit,
      skip: options?.offset,
    }),
  ]);

  const photos = rows.map((row: unknown) => toMemberPhoto(row as Record<string, unknown>));

  return { photos, total };
}

export async function getAllPhotos(options?: {
  category?: string;
  year?: number;
  uploadedBy?: string;
  limit?: number;
  offset?: number;
}): Promise<{ photos: MemberPhoto[]; total: number }> {
  const where: Record<string, unknown> = {};

  if (options?.category) {
    where.category = options.category;
  }
  if (options?.year) {
    where.year = options.year;
  }
  if (options?.uploadedBy) {
    where.uploadedBy = options.uploadedBy;
  }

  const [total, rows] = await Promise.all([
    prisma.memberPhoto.count({ where }),
    prisma.memberPhoto.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: options?.limit,
      skip: options?.offset,
    }),
  ]);

  const photos = rows.map((row: unknown) => toMemberPhoto(row as Record<string, unknown>));

  return { photos, total };
}

export async function getPhotoTimeline(options?: {
  memberId?: string;
  limit?: number;
}): Promise<{ year: number; count: number; photos: MemberPhoto[] }[]> {
  const where: Record<string, unknown> = { year: { not: null } };

  if (options?.memberId) {
    where.memberId = options.memberId;
  }

  const rows = await prisma.memberPhoto.findMany({
    where,
    orderBy: [{ year: 'desc' }, { createdAt: 'desc' }],
  });

  // Group by year
  const yearMap = new Map<number, MemberPhoto[]>();

  for (const row of rows) {
    const year = row.year as number;
    const photo = toMemberPhoto(row as unknown as Record<string, unknown>);

    const existing = yearMap.get(year);
    if (existing) {
      existing.push(photo);
    } else {
      yearMap.set(year, [photo]);
    }
  }

  const timeline = Array.from(yearMap.entries()).map(([year, photos]) => ({
    year,
    count: photos.length,
    photos: options?.limit ? photos.slice(0, options.limit) : photos,
  }));

  return timeline;
}

export async function updateMemberPhoto(
  id: string,
  updates: Partial<Omit<CreateMemberPhotoInput, 'imageData' | 'uploadedBy' | 'uploadedByName'>>
): Promise<MemberPhoto | null> {
  const data: Record<string, unknown> = {};

  if (updates.category !== undefined) {
    data.category = updates.category;
  }
  if (updates.title !== undefined) {
    data.title = updates.title;
  }
  if (updates.titleAr !== undefined) {
    data.titleAr = updates.titleAr;
  }
  if (updates.caption !== undefined) {
    data.caption = updates.caption;
  }
  if (updates.captionAr !== undefined) {
    data.captionAr = updates.captionAr;
  }
  if (updates.year !== undefined) {
    data.year = updates.year;
  }
  if (updates.memberId !== undefined) {
    data.memberId = updates.memberId;
  }
  if (updates.taggedMemberIds !== undefined) {
    data.taggedMemberIds = JSON.stringify(updates.taggedMemberIds);
  }
  if (updates.isFamilyAlbum !== undefined) {
    data.isFamilyAlbum = updates.isFamilyAlbum;
  }
  if (updates.isProfilePhoto !== undefined) {
    data.isProfilePhoto = updates.isProfilePhoto;
  }
  if (updates.displayOrder !== undefined) {
    data.displayOrder = updates.displayOrder;
  }
  if (updates.isPublic !== undefined) {
    data.isPublic = updates.isPublic;
  }

  await prisma.memberPhoto.update({
    where: { id },
    data,
  });

  return getMemberPhotoById(id);
}

export async function deleteMemberPhoto(id: string): Promise<boolean> {
  try {
    await prisma.memberPhoto.delete({
      where: { id },
    });
    return true;
  } catch {
    return false;
  }
}

export async function setProfilePhoto(memberId: string, photoId: string): Promise<boolean> {
  try {
    // First, unset any existing profile photos for this member
    await prisma.memberPhoto.updateMany({
      where: { memberId },
      data: { isProfilePhoto: false },
    });

    // Set the new profile photo
    const result = await prisma.memberPhoto.updateMany({
      where: { id: photoId, memberId },
      data: { isProfilePhoto: true },
    });

    return result.count > 0;
  } catch {
    return false;
  }
}

export async function getProfilePhoto(memberId: string): Promise<MemberPhoto | null> {
  const row = await prisma.memberPhoto.findFirst({
    where: { memberId, isProfilePhoto: true },
  });

  return row ? toMemberPhoto(row as unknown as Record<string, unknown>) : null;
}

// ======================
// STATISTICS
// ======================

export async function getImageStats(): Promise<{
  pendingCount: number;
  approvedCount: number;
  rejectedCount: number;
  totalPhotos: number;
  familyAlbumCount: number;
  byCategory: { category: string; count: number }[];
}> {
  const [pendingCount, approvedCount, rejectedCount, totalPhotos, familyAlbumCount, categoryGroups] = await Promise.all([
    prisma.pendingImage.count({ where: { reviewStatus: 'PENDING' } }),
    prisma.pendingImage.count({ where: { reviewStatus: 'APPROVED' } }),
    prisma.pendingImage.count({ where: { reviewStatus: 'REJECTED' } }),
    prisma.memberPhoto.count(),
    prisma.memberPhoto.count({ where: { isFamilyAlbum: true } }),
    prisma.memberPhoto.groupBy({
      by: ['category'],
      _count: true,
    }),
  ]);

  const byCategory = categoryGroups.map((group: { category: string | null; _count: number }) => ({
    category: group.category,
    count: group._count,
  }));

  return {
    pendingCount,
    approvedCount,
    rejectedCount,
    totalPhotos,
    familyAlbumCount,
    byCategory,
  };
}
