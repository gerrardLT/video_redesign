/**
 * 生成请求幂等哈希计算
 * 纯函数：相同输入恒等于相同输出
 */
import { createHash } from 'crypto'

/**
 * 计算生成请求的幂等哈希
 * 输入：finalScript + duration + resolution
 * 输出：SHA-256 摘要的前 16 位十六进制字符串
 *
 * 纯函数：相同输入恒等于相同输出
 */
export function computeScriptHash(
  finalScript: string,
  duration: number,
  resolution: string
): string {
  const input = `${finalScript}|${duration}|${resolution}`
  return createHash('sha256').update(input).digest('hex').substring(0, 16)
}
