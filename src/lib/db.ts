import { PrismaClient } from '@/generated/prisma'
import { PrismaLibSql } from '@prisma/adapter-libsql'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createPrismaClient(): PrismaClient {
  // SQLite 连接配置：连接初始化时设置 WAL 模式 + synchronous + busy_timeout。
  // - journal_mode=WAL：允许「并发读 + 串行写」，写事务不再阻塞读，消除多进程
  //   （app + workers 共享同一 db 文件）下「一个写阻塞所有读」导致的 P1008 超时雪崩。
  //   WAL 是按库文件持久化的设置，但每次连接初始化重设是幂等且安全的。
  // - synchronous=NORMAL：WAL 下的标准搭配，兼顾安全与写入吞吐。
  // - busy_timeout=60s：连接级别，写操作等待锁时最长重试 60 秒而非立即失败。
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

  // 按顺序设置 PRAGMA（连接初始化时执行）。
  // journal_mode=WAL 返回结果行，用 $queryRawUnsafe；其余无返回行，用 $executeRawUnsafe。
  ;(async () => {
    try {
      const walResult = await client.$queryRawUnsafe<Array<{ journal_mode?: string }>>('PRAGMA journal_mode=WAL')
      const mode = walResult?.[0]?.journal_mode ?? 'unknown'
      await client.$executeRawUnsafe('PRAGMA synchronous=NORMAL')
      await client.$executeRawUnsafe('PRAGMA busy_timeout=60000')
      console.log(`[db] SQLite PRAGMA 已设置：journal_mode=${mode}, synchronous=NORMAL, busy_timeout=60s`)
    } catch (err: unknown) {
      // libSQL adapter 可能不支持部分 PRAGMA，降级到依赖 transactionOptions 超时
      console.warn('[db] PRAGMA 设置失败，依赖 transactionOptions 超时:', err instanceof Error ? err.message : err)
    }
  })()

  return client
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
