/**
 * Prompt 素材引用解析器
 * 解析 prompt 文本中的 [图N] 引用，并校验引用合法性
 */

/**
 * 解析 prompt 中的 [图N] 引用
 * @param prompt 提示词文本
 * @returns 去重后的引用编号数组
 */
export function parseAssetReferences(prompt: string): number[] {
  const pattern = /\[图(\d+)\]/g
  const refs: number[] = []
  let match: RegExpExecArray | null
  while ((match = pattern.exec(prompt)) !== null) {
    refs.push(parseInt(match[1], 10))
  }
  return [...new Set(refs)]
}

/**
 * 校验引用合法性
 * @param refs 引用编号数组
 * @param totalAssets 可用素材总数
 * @returns 校验结果 { valid, errors }
 */
export function validateReferences(
  refs: number[],
  totalAssets: number
): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (refs.length > 9) {
    errors.push('单个分镜最多引用 9 张素材')
  }

  for (const ref of refs) {
    if (ref < 1 || ref > totalAssets) {
      errors.push(`[图${ref}] 引用的素材不存在`)
    }
  }

  return { valid: errors.length === 0, errors }
}

/**
 * 解析后的引用结果
 */
export interface ResolvedReference {
  displayNum: number
  url: string
}

/**
 * 将 prompt 中的 [图N] 引用解析为对应 shotAsset 的实际 URL
 * 返回去除标记的 cleanPrompt 和排序后的 URL 映射
 *
 * @param prompt 包含 [图N] 标记的提示词文本
 * @param shotAssets 分镜素材数组，含 displayNum 和 asset.url
 * @returns { cleanPrompt, resolvedRefs }
 */
export function resolveReferences(
  prompt: string,
  shotAssets: Array<{ displayNum: number; asset: { url: string } }>
): { cleanPrompt: string; resolvedRefs: ResolvedReference[] } {
  const refs = parseAssetReferences(prompt)

  // 边界处理：无引用时直接返回原 prompt
  if (refs.length === 0) {
    return { cleanPrompt: prompt, resolvedRefs: [] }
  }

  // 建立 displayNum → URL 映射
  const assetMap = new Map<number, string>()
  for (const sa of shotAssets) {
    assetMap.set(sa.displayNum, sa.asset.url)
  }

  // 过滤掉 shotAssets 中不存在的引用，按 displayNum 排序
  const resolvedRefs: ResolvedReference[] = refs
    .filter(num => assetMap.has(num))
    .sort((a, b) => a - b)
    .map(num => ({ displayNum: num, url: assetMap.get(num)! }))

  // 移除 [图N] 标记，清理多余空格
  const cleanPrompt = prompt.replace(/\[图\d+\]/g, '').replace(/\s{2,}/g, ' ').trim()

  return { cleanPrompt, resolvedRefs }
}
