import { PrismaClient } from '@/generated/prisma'
import { PrismaPg } from '@prisma/adapter-pg'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createPrismaClient(): PrismaClient {
  const dbUrl = process.env.DATABASE_URL
  if (!dbUrl) {
    throw new Error('[db] DATABASE_URL 环境变量未配置，无法连接 PostgreSQL')
  }

  const adapter = new PrismaPg({ connectionString: dbUrl })
  const client = new PrismaClient({
    adapter,
    // PostgreSQL 并发能力强，事务超时设为 30s 即可满足大部分场景
    transactionOptions: {
      maxWait: 30000,
      timeout: 30000,
    },
  })

  return client
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
