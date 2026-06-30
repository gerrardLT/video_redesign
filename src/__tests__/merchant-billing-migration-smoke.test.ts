/**
 * 商家计费体系收敛（merchant-billing-unification）结构 / 迁移冒烟检查
 *
 * 对应 task 12.2，固化以下回归保护（纯静态读取文件断言，不触及数据库/网络）：
 * 1. 静态检查：生产代码（src/）已无 merchant-quota-service / SUBSCRIPTION_TIERS /
 *    QuotaAction / QuotaCheckResult 的实际引用（Req 2.1 / 2.2 / 2.4）。
 *    —— 注释中提及「已废除」属说明性文字，不算引用，故按「去注释后」的源码判定。
 * 2. 迁移检查：credit_ledger 仅新增 biz_ref_type / biz_ref_id 两个可空列与一个复合索引，
 *    无任何 ALTER/DROP 既有列或约束；且迁移不触碰
 *    Merchant / Store / ContentBrief / VideoVariant 表（Req 2.5 / 4.3 / 7.3）。
 * 3. 回填检查：scripts/ 与 prisma/ 下无「历史额度→积分流水」回填脚本（Req 7.4）。
 *
 * 说明：本测试以仓库根目录（process.cwd()，vitest 默认从根运行）为基准定位文件，
 * 不依赖任何业务模块导入，因此无需 DATABASE_URL 等环境变量。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** 仓库根目录（vitest 默认 cwd 为项目根） */
const ROOT = process.cwd()
const SRC = join(ROOT, 'src')

/** 已废除的额度体系标识符（生产代码中不得再实际引用） */
const FORBIDDEN_SYMBOLS = [
  'merchant-quota-service',
  'SUBSCRIPTION_TIERS',
  'QuotaAction',
  'QuotaCheckResult',
  'checkMerchantQuota',
  'getMerchantTier',
  'MerchantTier',
] as const

/**
 * 去除源码中的注释（行注释 // ... 与块注释 /* ... *​/），
 * 以便区分「注释里的说明性提及」与「真实代码引用」。
 * 简化实现：不处理字符串字面量内的 // ，对本场景足够（被测标识符不会出现在字符串里）。
 */
function stripComments(source: string): string {
  // 先去块注释，再去行注释
  const withoutBlock = source.replace(/\/\*[\s\S]*?\*\//g, '')
  return withoutBlock.replace(/\/\/[^\n]*/g, '')
}

/** 递归收集目录下所有 .ts / .tsx 源文件（跳过自动生成目录与本测试目录） */
function collectSourceFiles(dir: string): string[] {
  const results: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) {
      // 跳过 Prisma 自动生成目录与测试目录（测试文件含被测标识符属正常）
      if (entry === 'generated' || entry === '__tests__') continue
      results.push(...collectSourceFiles(full))
    } else if (/\.tsx?$/.test(entry)) {
      results.push(full)
    }
  }
  return results
}

describe('merchant-billing-unification 结构 / 迁移冒烟检查（task 12.2）', () => {
  it('生产代码已删除 merchant-quota-service.ts 文件（Req 2.1）', () => {
    expect(existsSync(join(SRC, 'lib', 'merchant-quota-service.ts'))).toBe(false)
  })

  it('生产代码去注释后无任何已废除额度体系标识符的实际引用（Req 2.1 / 2.2 / 2.4）', () => {
    const files = collectSourceFiles(SRC)
    const offenders: string[] = []

    for (const file of files) {
      const code = stripComments(readFileSync(file, 'utf-8'))
      for (const symbol of FORBIDDEN_SYMBOLS) {
        if (code.includes(symbol)) {
          offenders.push(`${file} → ${symbol}`)
        }
      }
    }

    expect(offenders, `仍存在已废除额度体系的实际引用:\n${offenders.join('\n')}`).toEqual([])
  })

  it('types/merchant.ts 不再定义 QuotaAction / QuotaCheckResult（Req 2.4）', () => {
    const typesPath = join(SRC, 'types', 'merchant.ts')
    if (!existsSync(typesPath)) return // 文件不存在亦满足「无引用」
    const code = stripComments(readFileSync(typesPath, 'utf-8'))
    expect(code).not.toContain('QuotaAction')
    expect(code).not.toContain('QuotaCheckResult')
  })

  it('constants/merchant.ts 不再导出 SUBSCRIPTION_TIERS（Req 2.2）', () => {
    const constPath = join(SRC, 'constants', 'merchant.ts')
    const code = stripComments(readFileSync(constPath, 'utf-8'))
    expect(code).not.toContain('SUBSCRIPTION_TIERS')
  })

  it('迁移仅对 credit_ledger 新增 biz_ref_type / biz_ref_id 可空列与复合索引，无 ALTER/DROP 既有列或约束（Req 4.3 / 7.3）', () => {
    const migrationPath = join(
      ROOT,
      'prisma',
      'migrations',
      '20260626061751_add_credit_ledger_biz_ref',
      'migration.sql',
    )
    expect(existsSync(migrationPath), '未找到 add_credit_ledger_biz_ref 迁移').toBe(true)

    const sql = readFileSync(migrationPath, 'utf-8')
    const upper = sql.toUpperCase()

    // 仅新增两列（均可空：无 NOT NULL / 无 DEFAULT）
    expect(sql).toContain('ADD COLUMN     "biz_ref_id" TEXT')
    expect(sql).toContain('ADD COLUMN     "biz_ref_type" TEXT')
    expect(upper).not.toContain('NOT NULL')
    expect(upper).not.toContain('DEFAULT')

    // 新增复合索引
    expect(sql).toContain(
      'CREATE INDEX "credit_ledger_biz_ref_type_biz_ref_id_idx" ON "credit_ledger"("biz_ref_type", "biz_ref_id")',
    )

    // 无破坏性操作：不得 DROP，不得改列类型，不得动外键约束
    expect(upper).not.toContain('DROP')
    expect(upper).not.toContain('ALTER COLUMN')
    expect(upper).not.toContain('CONSTRAINT')
    expect(upper).not.toContain('FOREIGN KEY')

    // 迁移仅触碰 credit_ledger，不涉及业务实体表（Req 2.5）
    for (const table of ['"Merchant"', '"Store"', '"ContentBrief"', '"VideoVariant"', 'merchant', 'store', 'content_brief', 'video_variant']) {
      expect(upper).not.toContain(table.toUpperCase())
    }
  })

  it('scripts/ 与 prisma/ 下不存在「历史额度→积分流水」回填脚本（Req 7.4）', () => {
    const dirsToScan = [join(ROOT, 'scripts'), join(ROOT, 'prisma')]
    const offenders: string[] = []

    for (const dir of dirsToScan) {
      if (!existsSync(dir)) continue
      for (const file of collectFilesFlat(dir)) {
        const lower = file.toLowerCase()
        // 仅审视脚本/SQL 文件
        if (!/\.(ts|mjs|js|sql)$/.test(lower)) continue
        const content = readFileSync(file, 'utf-8')
        // 回填额度→积分流水的特征：同时出现 quota/额度 与 creditLedger/credit_ledger 写入语义
        const mentionsQuota = /quota|额度/i.test(content)
        const writesLedger = /creditLedger\.create|INSERT\s+INTO\s+"?credit_ledger/i.test(content)
        if (mentionsQuota && writesLedger) {
          offenders.push(file)
        }
      }
    }

    expect(offenders, `发现疑似历史额度回填脚本:\n${offenders.join('\n')}`).toEqual([])
  })
})

/** 非递归收集目录下文件（含一层子目录），用于扫描 scripts/ 与 prisma/ */
function collectFilesFlat(dir: string): string[] {
  const results: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) {
      // prisma/migrations 等子目录也需扫描
      results.push(...collectFilesFlat(full))
    } else {
      results.push(full)
    }
  }
  return results
}
