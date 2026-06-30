// Feature: local-life-depth-enhancements, Property 2: additive-only 迁移
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import fs from 'fs'
import path from 'path'

/**
 * Feature: local-life-depth-enhancements
 * Property 2: additive-only 迁移
 *
 * *For any* 本 spec 产生的数据库迁移，其语句集合 SHALL 仅包含
 * CREATE TABLE / ADD COLUMN（带默认或可空）/ CREATE INDEX / CREATE UNIQUE INDEX，
 * 且 SHALL NOT 包含针对既有表的 DROP TABLE / DROP COLUMN / ALTER COLUMN TYPE / DROP CONSTRAINT。
 *
 * **Validates: Requirements 0.10**
 */

// ============================================================
// 被测纯逻辑：迁移 SQL 解析与分类（无外部依赖）
// ============================================================

/** 语句分类结果 */
type StatementKind =
  | 'CREATE_TABLE'
  | 'CREATE_INDEX'
  | 'CREATE_UNIQUE_INDEX'
  | 'ADD_COLUMN' // ALTER TABLE 仅含新增列
  | 'DROP_TABLE'
  | 'DROP_COLUMN'
  | 'DROP_CONSTRAINT'
  | 'ALTER_COLUMN_TYPE'
  | 'OTHER' // 不在加法白名单内的其它语句

/** 加法白名单：仅这些类型视为 additive-only 允许 */
const ADDITIVE_KINDS: ReadonlySet<StatementKind> = new Set<StatementKind>([
  'CREATE_TABLE',
  'CREATE_INDEX',
  'CREATE_UNIQUE_INDEX',
  'ADD_COLUMN',
])

/** 针对既有表的破坏性类型：迁移中绝不允许出现 */
const DESTRUCTIVE_KINDS: ReadonlySet<StatementKind> = new Set<StatementKind>([
  'DROP_TABLE',
  'DROP_COLUMN',
  'DROP_CONSTRAINT',
  'ALTER_COLUMN_TYPE',
])

/**
 * 将单条 SQL 语句分类。
 * 关键点：ALTER TABLE 既可能是新增列（加法），也可能是删列/改类型/删约束（破坏），
 * 因此必须检查其内部动作而非仅看首关键字；破坏性子句优先判定。
 */
function classifyStatement(statement: string): StatementKind {
  const norm = statement.replace(/\s+/g, ' ').trim()
  const upper = norm.toUpperCase()

  // CREATE UNIQUE INDEX 必须先于 CREATE INDEX 判定
  if (upper.startsWith('CREATE UNIQUE INDEX')) return 'CREATE_UNIQUE_INDEX'
  if (upper.startsWith('CREATE INDEX')) return 'CREATE_INDEX'
  if (upper.startsWith('CREATE TABLE')) return 'CREATE_TABLE'
  if (upper.startsWith('DROP TABLE')) return 'DROP_TABLE'

  if (upper.startsWith('ALTER TABLE')) {
    // 破坏性动作优先：同一条 ALTER 即使含 ADD COLUMN，只要带破坏动作即判破坏
    if (/\bDROP COLUMN\b/.test(upper)) return 'DROP_COLUMN'
    if (/\bDROP CONSTRAINT\b/.test(upper)) return 'DROP_CONSTRAINT'
    if (/\bALTER COLUMN\b/.test(upper) && /\b(SET DATA TYPE|TYPE)\b/.test(upper)) {
      return 'ALTER_COLUMN_TYPE'
    }
    if (/\bADD COLUMN\b/.test(upper)) return 'ADD_COLUMN'
    return 'OTHER'
  }

  return 'OTHER'
}

/** 迁移分析结果 */
interface MigrationAnalysis {
  statements: { raw: string; kind: StatementKind }[]
  additiveOnly: boolean
  destructive: { raw: string; kind: StatementKind }[]
}

/**
 * 解析迁移 SQL 文本：剥离 `--` 注释、按 `;` 分句、逐句分类。
 * additiveOnly 当且仅当所有语句都落在加法白名单内。
 */
function analyzeMigrationSql(sql: string): MigrationAnalysis {
  const withoutComments = sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, '')) // 去掉行内/整行 `--` 注释
    .join('\n')

  const statements = withoutComments
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((raw) => ({ raw, kind: classifyStatement(raw) }))

  const destructive = statements.filter((s) => DESTRUCTIVE_KINDS.has(s.kind))
  const additiveOnly = statements.every((s) => ADDITIVE_KINDS.has(s.kind))

  return { statements, additiveOnly, destructive }
}

// ============================================================
// Arbitraries：随机生成加法语句与破坏性语句
// ============================================================

/** 合法 SQL 标识符（字母开头，含字母数字下划线） */
const identifierArb: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789_'.split('')), {
    minLength: 2,
    maxLength: 14,
  })
  .map((chars) => 't' + chars.join(''))

/** 列类型（含可空 / 默认值，均为加法允许形式） */
const columnTypeArb: fc.Arbitrary<string> = fc.constantFrom(
  'TEXT',
  'JSONB',
  'BOOLEAN NOT NULL DEFAULT false',
  'INTEGER NOT NULL DEFAULT 0',
  'TIMESTAMP(3)',
  "TEXT DEFAULT 'ACTIVE'"
)

/** CREATE TABLE：内部含 CONSTRAINT ... PRIMARY KEY，用于验证分类器不会误判内联约束 */
const createTableArb: fc.Arbitrary<string> = identifierArb.map(
  (t) =>
    `CREATE TABLE "${t}" (\n    "id" TEXT NOT NULL,\n    CONSTRAINT "${t}_pkey" PRIMARY KEY ("id")\n)`
)

/** ALTER TABLE ADD COLUMN（可一次新增多列） */
const addColumnArb: fc.Arbitrary<string> = fc
  .tuple(
    identifierArb,
    fc.array(fc.tuple(identifierArb, columnTypeArb), { minLength: 1, maxLength: 3 })
  )
  .map(([table, cols]) => {
    const adds = cols.map(([c, type]) => `ADD COLUMN "${c}" ${type}`).join(',\n')
    return `ALTER TABLE "${table}" ${adds}`
  })

const createIndexArb: fc.Arbitrary<string> = fc
  .tuple(identifierArb, identifierArb, identifierArb)
  .map(([idx, table, col]) => `CREATE INDEX "${idx}" ON "${table}"("${col}")`)

const createUniqueIndexArb: fc.Arbitrary<string> = fc
  .tuple(identifierArb, identifierArb, identifierArb)
  .map(([idx, table, col]) => `CREATE UNIQUE INDEX "${idx}" ON "${table}"("${col}")`)

/** 任意加法语句 */
const additiveStatementArb: fc.Arbitrary<string> = fc.oneof(
  createTableArb,
  addColumnArb,
  createIndexArb,
  createUniqueIndexArb
)

/** 破坏性语句（针对既有表） */
const dropTableArb = identifierArb.map((t) => `DROP TABLE "${t}"`)
const dropColumnArb = fc
  .tuple(identifierArb, identifierArb)
  .map(([t, c]) => `ALTER TABLE "${t}" DROP COLUMN "${c}"`)
const dropConstraintArb = fc
  .tuple(identifierArb, identifierArb)
  .map(([t, c]) => `ALTER TABLE "${t}" DROP CONSTRAINT "${c}_fkey"`)
const alterColumnTypeArb = fc
  .tuple(identifierArb, identifierArb)
  .map(([t, c]) => `ALTER TABLE "${t}" ALTER COLUMN "${c}" SET DATA TYPE TEXT`)
const alterColumnTypeShortArb = fc
  .tuple(identifierArb, identifierArb)
  .map(([t, c]) => `ALTER TABLE "${t}" ALTER COLUMN "${c}" TYPE INTEGER`)

const destructiveStatementArb: fc.Arbitrary<string> = fc.oneof(
  dropTableArb,
  dropColumnArb,
  dropConstraintArb,
  alterColumnTypeArb,
  alterColumnTypeShortArb
)

/** 将语句数组组装为迁移文本：随机插入 `-- 注释` 行并以 `;` 分隔 */
function assembleMigration(statements: string[]): string {
  return statements.map((s, i) => `-- statement ${i}\n${s};`).join('\n\n')
}

// ============================================================
// 真实迁移文件路径
// ============================================================

const REAL_MIGRATION_PATH = path.join(
  process.cwd(),
  'prisma',
  'migrations',
  '20260629030758_add_local_life_depth_enhancements',
  'migration.sql'
)

// ============================================================
// Property 2: additive-only 迁移
// ============================================================

describe('Property 2: additive-only 迁移', () => {
  it('本 spec 真实迁移 SQL 仅含 CREATE TABLE / ADD COLUMN / CREATE (UNIQUE) INDEX', () => {
    /**
     * **Validates: Requirements 0.10**
     * 直接解析本 spec 产生的迁移文件，断言无任何破坏性语句。
     */
    const sql = fs.readFileSync(REAL_MIGRATION_PATH, 'utf-8')
    const analysis = analyzeMigrationSql(sql)

    // 至少应解析出若干语句（防止读到空文件或解析失效后空集恒真）
    expect(analysis.statements.length).toBeGreaterThan(0)

    // 不含任何破坏性语句
    expect(analysis.destructive).toEqual([])

    // 全部语句落在加法白名单内
    expect(analysis.additiveOnly).toBe(true)

    // 逐句类型必须属于允许集合
    for (const stmt of analysis.statements) {
      expect(['CREATE_TABLE', 'CREATE_INDEX', 'CREATE_UNIQUE_INDEX', 'ADD_COLUMN']).toContain(
        stmt.kind
      )
    }
  })

  it('任意仅由加法语句组成的迁移 → additiveOnly 恒为 true', () => {
    /**
     * **Validates: Requirements 0.10**
     */
    fc.assert(
      fc.property(
        fc.array(additiveStatementArb, { minLength: 1, maxLength: 20 }),
        (statements) => {
          const sql = assembleMigration(statements)
          const analysis = analyzeMigrationSql(sql)

          expect(analysis.additiveOnly).toBe(true)
          expect(analysis.destructive).toEqual([])
          // 解析语句数应与输入一致（注释被正确剥离）
          expect(analysis.statements.length).toBe(statements.length)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('任意含至少一条破坏性语句的迁移 → 被判定为非加法且命中破坏类型', () => {
    /**
     * **Validates: Requirements 0.10**
     */
    fc.assert(
      fc.property(
        fc.array(additiveStatementArb, { minLength: 0, maxLength: 15 }),
        destructiveStatementArb,
        fc.array(additiveStatementArb, { minLength: 0, maxLength: 15 }),
        (before, destructive, after) => {
          const sql = assembleMigration([...before, destructive, ...after])
          const analysis = analyzeMigrationSql(sql)

          // 含破坏性语句 → 必不为加法
          expect(analysis.additiveOnly).toBe(false)
          // 必须捕获到至少一条破坏性语句
          expect(analysis.destructive.length).toBeGreaterThanOrEqual(1)
          // 命中的破坏类型属于受禁集合
          for (const d of analysis.destructive) {
            expect([
              'DROP_TABLE',
              'DROP_COLUMN',
              'DROP_CONSTRAINT',
              'ALTER_COLUMN_TYPE',
            ]).toContain(d.kind)
          }
        }
      ),
      { numRuns: 200 }
    )
  })

  it('CREATE TABLE 内联 CONSTRAINT/PRIMARY KEY 不会被误判为 DROP CONSTRAINT', () => {
    /**
     * **Validates: Requirements 0.10**
     * 防回归：建表语句内部的 CONSTRAINT 关键字不应触发破坏性判定。
     */
    fc.assert(
      fc.property(fc.array(createTableArb, { minLength: 1, maxLength: 10 }), (tables) => {
        const sql = assembleMigration(tables)
        const analysis = analyzeMigrationSql(sql)

        expect(analysis.additiveOnly).toBe(true)
        for (const stmt of analysis.statements) {
          expect(stmt.kind).toBe('CREATE_TABLE')
        }
      }),
      { numRuns: 200 }
    )
  })

  it('同一条 ALTER TABLE 即使同时含 ADD COLUMN 与破坏动作也判为破坏', () => {
    /**
     * **Validates: Requirements 0.10**
     * 防漏判：混合动作的 ALTER TABLE 不得因含 ADD COLUMN 而被放行。
     */
    fc.assert(
      fc.property(
        identifierArb,
        identifierArb,
        columnTypeArb,
        identifierArb,
        fc.constantFrom('DROP COLUMN', 'DROP CONSTRAINT', 'ALTER COLUMN'),
        (table, addCol, type, badCol, badAction) => {
          const badClause =
            badAction === 'ALTER COLUMN'
              ? `ALTER COLUMN "${badCol}" SET DATA TYPE TEXT`
              : `${badAction} "${badCol}"`
          const stmt = `ALTER TABLE "${table}" ADD COLUMN "${addCol}" ${type},\n${badClause}`
          const analysis = analyzeMigrationSql(`${stmt};`)

          expect(analysis.additiveOnly).toBe(false)
          expect(analysis.destructive.length).toBe(1)
        }
      ),
      { numRuns: 200 }
    )
  })
})
