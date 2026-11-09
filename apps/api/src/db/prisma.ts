import { PrismaClient } from '@prisma/client';
import { config } from '../config/env.js';
import { logger } from '../config/logger.js';

const globalForPrisma = globalThis as unknown as { __hirefoPrisma?: PrismaClient };

export const prisma =
  globalForPrisma.__hirefoPrisma ??
  new PrismaClient({
    datasources: { db: { url: config().DATABASE_URL } },
    log: config().isProd
      ? [{ emit: 'event', level: 'warn' }, { emit: 'event', level: 'error' }]
      : [{ emit: 'event', level: 'warn' }, { emit: 'event', level: 'error' }],
  });

prisma.$on('warn' as never, (e: unknown) => logger.warn({ prisma: e }, 'prisma warning'));
prisma.$on('error' as never, (e: unknown) => logger.error({ prisma: e }, 'prisma error'));

if (!config().isProd) globalForPrisma.__hirefoPrisma = prisma;

export type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
export type Db = PrismaClient | Tx;
