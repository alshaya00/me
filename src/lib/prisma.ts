// Prisma client wrapper with build-time fallback support
// This handles the case where prisma generate hasn't been run yet

// Generic type for Prisma models - allows property access without full type definitions
// eslint-disable-next-line
type AnyRecord = { [key: string]: any };

// Transaction client type - generic to work with or without generated types
export type TransactionClient = AnyRecord;

// Fallback Prisma namespace for build-time type safety
export const Prisma = {} as const;

// Type for the Prisma client - using Record to allow dynamic model access
type PrismaClientType = AnyRecord;

// Create a mock Prisma client for build time when Prisma isn't fully initialized
function createMockPrismaClient(): PrismaClientType {
  const mockModel = {
    findMany: () => Promise.resolve([]),
    findFirst: () => Promise.resolve(null),
    findUnique: () => Promise.resolve(null),
    create: () => Promise.resolve({}),
    update: () => Promise.resolve({}),
    delete: () => Promise.resolve({}),
    deleteMany: () => Promise.resolve({ count: 0 }),
    count: () => Promise.resolve(0),
    upsert: () => Promise.resolve({}),
    updateMany: () => Promise.resolve({ count: 0 }),
    createMany: () => Promise.resolve({ count: 0 }),
    aggregate: () => Promise.resolve({}),
    groupBy: () => Promise.resolve([]),
  };

  const mockHandler = {
    get(_target: unknown, prop: string) {
      if (prop === '$connect' || prop === '$disconnect') {
        return () => Promise.resolve();
      }
      if (prop === '$transaction') {
        return (fn: (tx: unknown) => Promise<unknown>) => fn(createMockPrismaClient());
      }
      if (prop === '$queryRaw' || prop === '$executeRaw') {
        return () => Promise.resolve([]);
      }
      // Return mock model for any property access
      return mockModel;
    },
  };
  return new Proxy({}, mockHandler) as PrismaClientType;
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClientType | undefined;
};

let prisma: PrismaClientType;

// Try to load the actual Prisma client
function loadPrismaClient(): PrismaClientType | null {
  try {
    // Dynamic require to handle build-time when client isn't generated
    const prismaModule = require('@prisma/client');
    const PrismaClient = prismaModule.PrismaClient;
    if (PrismaClient) {
      return new PrismaClient({
        log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
      });
    }
  } catch {
    // PrismaClient not available - likely during build without prisma generate
  }
  return null;
}

// Initialize prisma client
if (globalForPrisma.prisma) {
  prisma = globalForPrisma.prisma;
} else if (!process.env.DATABASE_URL) {
  console.warn('DATABASE_URL not set, using mock client');
  prisma = createMockPrismaClient();
} else {
  const client = loadPrismaClient();
  if (client) {
    prisma = client;
    if (process.env.NODE_ENV !== 'production') {
      globalForPrisma.prisma = prisma;
    }
  } else {
    console.warn('Prisma client not available. Using mock client for build.');
    prisma = createMockPrismaClient();
  }
}

export { prisma };
export default prisma;
