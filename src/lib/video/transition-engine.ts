/**
 * 视频转场引擎
 *
 * 纯函数模块，根据分镜组序列计算转场参数并生成 FFmpeg xfade/acrossfade filter 链。
 * 不直接调用 FFmpeg，仅产出可拼接到 -filter_complex 参数的 filter 字符串。
 *
 * 规则：
 * - 同场景（normScene 判定相等）：crossfade 0.4s
 * - 跨场景（normScene 不等或 scene 缺失）：fade-to-black 0.7s
 * - 短段（duration < 2 × transitionDuration）：跳过转场，硬拼接
 * - 单段：无转场，空数组
 * - 重叠分配：offsetA = offsetB = duration / 2
 */
import { normScene } from '@/lib/video/frame-continuity'

// ========================
// 类型定义
// ========================

/** 转场类型 */
export type TransitionType = 'crossfade' | 'fade' | 'none'

/** 单个转场配置 */
export interface TransitionConfig {
  type: TransitionType
  /** 过渡时长（秒） */
  duration: number
  /** 前一段的过渡起始偏移（从尾部倒数） */
  offsetA: number
  /** 后一段的过渡起始偏移（从头部正数） */
  offsetB: number
}

/** 分镜组转场输入 */
export interface SegmentInfo {
  groupIndex: number
  /** 该段视频时长（秒） */
  duration: number
  /** 场景名（由 normScene 规范化后比较） */
  scene: string | null
}

/** 转场计划：N 个段产生 N-1 个转场配置 */
export interface TransitionPlan {
  /** 长度 = segments.length - 1 */
  transitions: TransitionConfig[]
  /** 合并后视频总时长 */
  totalDuration: number
}

// ========================
// 常量
// ========================

/** 同场景 crossfade 默认时长（秒） */
const CROSSFADE_DURATION = 0.4

/** 跨场景 fade-to-black 默认时长（秒） */
const FADE_DURATION = 0.7

// ========================
// 核心函数
// ========================

/**
 * 根据分镜组序列计算转场计划
 *
 * @param segments 分镜组信息序列（按播放顺序排列）
 * @returns 转场计划（含每对相邻段的转场配置 + 合并后总时长）
 */
export function computeTransitionPlan(segments: SegmentInfo[]): TransitionPlan {
  // 空序列或单段：无转场
  if (segments.length <= 1) {
    const totalDuration = segments.length === 1 ? segments[0].duration : 0
    return { transitions: [], totalDuration }
  }

  const transitions: TransitionConfig[] = []

  for (let i = 0; i < segments.length - 1; i++) {
    const current = segments[i]
    const next = segments[i + 1]

    // 判定场景关系
    const currentScene = normScene(current.scene)
    const nextScene = normScene(next.scene)
    const sameScene = currentScene !== '' && nextScene !== '' && currentScene === nextScene

    // 确定转场类型和时长
    let type: TransitionType
    let duration: number

    if (sameScene) {
      type = 'crossfade'
      duration = CROSSFADE_DURATION
    } else {
      type = 'fade'
      duration = FADE_DURATION
    }

    // 短段检测：任一段时长 < 2 × transitionDuration 时跳过转场
    if (current.duration < 2 * duration || next.duration < 2 * duration) {
      transitions.push({ type: 'none', duration: 0, offsetA: 0, offsetB: 0 })
      continue
    }

    // 重叠分配：各取一半
    const offsetA = duration / 2
    const offsetB = duration / 2

    transitions.push({ type, duration, offsetA, offsetB })
  }

  // 计算总时长：各段时长之和 - 所有有效转场重叠时长之和
  const sumDurations = segments.reduce((acc, s) => acc + s.duration, 0)
  const sumOverlaps = transitions
    .filter((t) => t.type !== 'none')
    .reduce((acc, t) => acc + t.duration, 0)
  const totalDuration = sumDurations - sumOverlaps

  return { transitions, totalDuration }
}

/**
 * 根据转场计划生成 FFmpeg xfade/acrossfade filter 链
 *
 * xfade filter 链式串联规则：
 * - 第一个 xfade 消费 [0:v] 和 [1:v]，输出中间标签
 * - 后续 xfade 消费上一步输出和下一个输入，逐步串联
 * - offset 计算：每个 xfade 的 offset = 累积已用时长（前面各段时长减去已重叠时长）
 *
 * @param segments 分镜组信息序列
 * @param plan 转场计划
 * @returns 可拼接到 -filter_complex 的 video/audio filter 字符串（空 filter 时返回空字符串）
 */
export function buildTransitionFilters(
  segments: SegmentInfo[],
  plan: TransitionPlan
): { videoFilter: string; audioFilter: string } {
  // 无转场或所有转场均为 none：返回空 filter
  const activeTransitions = plan.transitions.filter((t) => t.type !== 'none')
  if (activeTransitions.length === 0 || segments.length <= 1) {
    return { videoFilter: '', audioFilter: '' }
  }

  const videoFilters: string[] = []
  const audioFilters: string[] = []

  // 追踪累积 offset：每段视频结束点（减去已消耗的重叠）
  let accumulatedOffset = 0

  // 当前视频/音频流标签
  let currentVideoLabel = '[0:v]'
  let currentAudioLabel = '[0:a]'

  accumulatedOffset = segments[0].duration

  for (let i = 0; i < plan.transitions.length; i++) {
    const transition = plan.transitions[i]
    const nextVideoInput = `[${i + 1}:v]`
    const nextAudioInput = `[${i + 1}:a]`

    if (transition.type === 'none') {
      // 无转场：通过 concat 硬拼接这两段，输出新标签
      const vOut = i < plan.transitions.length - 1 ? `[vt${i}]` : '[outv]'
      const aOut = i < plan.transitions.length - 1 ? `[at${i}]` : '[outa]'
      videoFilters.push(`${currentVideoLabel}${nextVideoInput}concat=n=2:v=1:a=0${vOut}`)
      audioFilters.push(`${currentAudioLabel}${nextAudioInput}concat=n=2:v=0:a=1${aOut}`)
      currentVideoLabel = vOut
      currentAudioLabel = aOut
      accumulatedOffset += segments[i + 1].duration
      continue
    }

    // 计算 xfade offset（从合并开始到本次转场触发点的时长）
    const xfadeOffset = accumulatedOffset - transition.duration

    // xfade transition 类型映射：crossfade → fade（两段互溶渐变），fade → fadeblack（经过黑场过渡）
    const xfadeTransition = transition.type === 'crossfade' ? 'fade' : 'fadeblack'

    const vOut = i < plan.transitions.length - 1 ? `[vt${i}]` : '[outv]'
    const aOut = i < plan.transitions.length - 1 ? `[at${i}]` : '[outa]'

    // 视频 xfade
    videoFilters.push(
      `${currentVideoLabel}${nextVideoInput}xfade=transition=${xfadeTransition}:duration=${transition.duration}:offset=${xfadeOffset.toFixed(3)}${vOut}`
    )

    // 音频 acrossfade（时长与视觉一致）
    audioFilters.push(
      `${currentAudioLabel}${nextAudioInput}acrossfade=d=${transition.duration}:c1=tri:c2=tri${aOut}`
    )

    currentVideoLabel = vOut
    currentAudioLabel = aOut
    // 更新累积 offset：加上下一段时长，减去本次重叠
    accumulatedOffset += segments[i + 1].duration - transition.duration
  }

  return {
    videoFilter: videoFilters.join(';'),
    audioFilter: audioFilters.join(';'),
  }
}
