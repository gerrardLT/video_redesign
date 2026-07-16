/**
 * 行业剧本引擎（barrel re-export）
 *
 * 根据门店画像和内容目标选择合适的剧本集，并将剧本模板实例化为具体的 ContentBrief 数据。
 *
 * 本文件为向后兼容的 barrel 入口，实际实现已拆分为：
 * - playbook-types.ts    — 类型定义（Store, StoreProfile, Playbook, BriefProvenance 等）
 * - playbook-selector.ts — 剧本选择算法（selectPlaybooks, castPlaybook）
 * - playbook-instance.ts — 剧本实例化 + LLM 调用（instantiatePlaybook, instantiatePlaybookWithProvenance）
 */

export * from './playbook-types'
export * from './playbook-selector'
export * from './playbook-instance'
