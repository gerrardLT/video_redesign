/**
 * 集成测试门控助手（local-life-depth-enhancements 任务 16.x 共用）
 *
 * 集成测试必须走真实接口与真实流程（遵循 AGENTS.md：不 mock 关键外部业务流程）。
 * 但默认 `pnpm test` 环境通常缺少真实外部凭证与 DATABASE_URL，因此用环境门控：
 *  - 必须显式开启总开关 RUN_INTEGRATION=1；
 *  - 且所需环境变量 / 真实实体 ID 全部就绪；
 * 否则用 describe.skipIf / it.skipIf 干净跳过（显示 skipped 而非 failed），绝不 mock 冒充通过。
 *
 * 重要：被测服务一律在 it()/beforeAll() 体内用动态 import() 引入，
 * 避免顶层 import 在缺少 DATABASE_URL 时于「文件加载阶段」即触发 prisma 构造而使套件失败。
 */

/** 集成测试总开关：仅当 RUN_INTEGRATION=1 时才可能启用 */
export const RUN_INTEGRATION = process.env.RUN_INTEGRATION === '1'

/**
 * 判断给定的环境变量是否全部存在且非空。
 * @returns 缺失的变量名数组（空数组表示齐备）
 */
export function missingEnv(keys: string[]): string[] {
  return keys.filter((k) => {
    const v = process.env[k]
    return v === undefined || v === null || v.trim() === ''
  })
}

/**
 * 计算某集成测试是否启用：总开关开 + 所需 env 齐备。
 * @param requiredEnv 该测试运行所需的环境变量 / 真实实体 ID 变量名
 */
export function integrationEnabled(requiredEnv: string[]): boolean {
  return RUN_INTEGRATION && missingEnv(requiredEnv).length === 0
}

/**
 * 生成跳过原因（用于在跳过时打印清晰指引，便于运维补齐 env 后真实运行）。
 */
export function skipReason(requiredEnv: string[]): string {
  if (!RUN_INTEGRATION) return '集成测试默认跳过：设置 RUN_INTEGRATION=1 并提供所需真实环境后运行'
  const miss = missingEnv(requiredEnv)
  return miss.length > 0 ? `缺少所需环境变量/真实实体 ID：${miss.join(', ')}` : ''
}

/** 读取必需的环境变量；缺失时抛错（仅在已通过 integrationEnabled 门控后调用） */
export function env(key: string): string {
  const v = process.env[key]
  if (v === undefined || v === null || v.trim() === '') {
    throw new Error(`[integration] 环境变量缺失：${key}`)
  }
  return v
}
