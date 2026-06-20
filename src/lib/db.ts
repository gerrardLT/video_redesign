import { PrismaClient } from '@/generated/prisma'
import { PrismaLibSql } from '@prisma/adapter-libsql'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createPrismaClient(): PrismaClient {
  // SQLite 连接配置（WAL 模式 + busy_timeout 60s）
  // WAL 模式已通过 sqlite3 CLI 持久化设置到 dev.db，允许并发读+串行写
  // busy_timeout 需每个连接设置，通过 $executeRawUnsafe 在连接初始化时执行
  const dbUrl = process.env.DATABASE_URL ?? 'file:./dev.db'
  const adapter = new PrismaLibSql({
    url: dbUrl,
    intMode: 'number',
  })
  const client = new PrismaClient({
    adapter,
    // interactive transaction 超时 120s（Worker 调用外部 API 后回写 DB 需要充裕时间）
    transactionOptions: {
      maxWait: 120000,
      timeout: 120000,
    },
  })

  // 设置 SQLite busy_timeout PRAGMA（连接级别，需每次连接初始化时执行）
  // 使写操作在等待锁时最长重试 60 秒，而非默认立即失败
  client.$executeRawUnsafe('PRAGMA busy_timeout = 60000')
    .then(() => console.log('[db] SQLite busy_timeout 已设为 60s'))
    .catch((err: unknown) => {
      // libSQL adapter 可能不支持 PRAGMA，降级到依赖 transactionOptions
      console.warn('[db] PRAGMA busy_timeout 设置失败，依赖 transactionOptions 超时:', err instanceof Error ? err.message : err)
    })

  return client
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
