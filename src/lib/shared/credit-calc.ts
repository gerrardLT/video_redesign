/**
 * 积分计算纯函数（客户端/服务端共用）
 *
 * 本文件不 import 任何服务端模块（prisma/redis/distributed-lock），
 * 可安全在 'use client' 组件中使用。
 */

/** 超分目标分辨率类型 */
export type UpscaleResolution = '480p' | '720p' | '1080p'

/**
 * 估算超分导出积分消耗
 *
 * 导出阶段专用公式（与生成阶段 estimateCreditCost 独立）：
 * - 480p: 0 积分（合并导出免费）
 * - 720p: 0 积分（合并+超分免费）
 * - 1080p: ceil(duration × 1.33) 积分（30秒≈40积分）
 *
 * @param duration 视频时长（秒）
 * @param resolution 目标分辨率：'480p' | '720p' | '1080p'
 * @returns 超分消耗积分数（非负整数）
 */
export function estimateUpscaleCreditCost(duration: number, resolution: UpscaleResolution): number {
  if (resolution === '1080p') return Math.ceil(duration * 1.33)
  return 0 // 480p、720p 免费
}

/**
 * 估算生成阶段积分消耗
 * duration × (resolution === '720p' ? 1.5 : 1.0)，向上取整
 */
export function estimateCreditCost(duration: number, resolution: string): number {
  const multiplier = resolution === '720p' ? 1.5 : 1.0
  return Math.ceil(duration * multiplier)
}

/**
 * 估算解析阶段积分消耗
 * 公式：ceil(duration × 0.5)
 */
export function estimateParseCreditCost(duration: number): number {
  return Math.ceil(duration * 0.5)
}

// ========================
// HappyHorse V-Edit 积分计算
// ========================

/**
 * HappyHorse 积分系数（平台加成）
 * 通过环境变量 HAPPYHORSE_CREDIT_COEFFICIENT 配置，默认 1.5
 */
function getHappyHorseCreditCoefficient(): number {
  if (typeof process !== 'undefined' && process.env?.HAPPYHORSE_CREDIT_COEFFICIENT) {
    return parseFloat(process.env.HAPPYHORSE_CREDIT_COEFFICIENT)
  }
  return 1.5
}

/**
 * 预估 HappyHorse V-Edit 积分消耗（生成前）
 *
 * 计费规则（720P）:
 * - 输入视频秒数 × 0.9 元/秒 + 输出视频秒数 × 0.9 元/秒
 * - V-Edit 输出时长 = min(输入时长, 15)（API 单次最大 15 秒输出限制）
 * - 积分换算后乘以平台系数
 *
 * 预估公式: ceil((inputDuration + min(inputDuration, 15)) × HAPPYHORSE_CREDIT_COEFFICIENT)
 *
 * @param inputDuration 输入视频时长（秒）
 * @returns 预估积分消耗（正整数）
 */
export function estimateHappyHorseCreditCost(inputDuration: number): number {
  const outputDuration = Math.min(inputDuration, 15)
  const coefficient = getHappyHorseCreditCoefficient()
  return Math.ceil((inputDuration + outputDuration) * coefficient)
}

/**
 * 结算 HappyHorse 实际积分消耗（生成完成后）
 *
 * 结算公式: ceil((actualInputDuration + actualOutputDuration) × HAPPYHORSE_CREDIT_COEFFICIENT)
 *
 * @param inputDuration 实际输入视频时长（秒）
 * @param outputDuration 实际输出视频时长（秒）
 * @returns 实际积分消耗（正整数）
 */
export function calculateHappyHorseActualCost(
  inputDuration: number,
  outputDuration: number
): number {
  const coefficient = getHappyHorseCreditCoefficient()
  return Math.ceil((inputDuration + outputDuration) * coefficient)
}

// ========================
// 工作台（Workspace）积分计算
// ========================

import type { WorkspaceModel } from '@/types/workspace'
import { MODEL_DURATION_OPTIONS } from '@/constants/workspace'

/**
 * 预估工作台生成积分消耗
 *
 * - Seedance 2.0: ceil(duration × 分辨率系数)
 * - HappyHorse T2V/R2V: ceil((duration + min(duration, 15)) × 分辨率系数)
 *
 * 分辨率系数：480p=1.0, 720p=1.5, 1080p=3.0
 *
 * @param model 选中的模型
 * @param duration 生成时长（秒）
 * @param resolution 分辨率（默认 720p）
 * @returns 预估积分消耗（正整数）
 */
export function estimateWorkspaceCost(model: WorkspaceModel, duration: number, resolution = '720p'): number {
  const resMultiplier = resolution === '1080p' ? 3.0 : resolution === '480p' ? 1.0 : 1.5

  if (model === 'seedance') {
    return Math.ceil(duration * resMultiplier)
  }
  // HappyHorse
  const outputDuration = Math.min(duration, 15)
  const coefficient = getHappyHorseCreditCoefficient()
  return Math.ceil((duration + outputDuration) * (resolution === '480p' ? 1.0 : coefficient))
}

/**
 * 获取指定模型的可选时长数组
 *
 * - Seedance 2.0: [4, 5, 8, 10, 15]
 * - HappyHorse: [3, 5, 8, 10, 15]
 *
 * @param model 模型类型
 * @returns 时长选项数组（正整数，严格递增）
 */
export function getDurationOptions(model: WorkspaceModel): number[] {
  return MODEL_DURATION_OPTIONS[model]
}
