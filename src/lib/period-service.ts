/**
 * 内容周期口径单点服务（period-service）
 *
 * 统一「内容周期 / 周」的计算口径，供以下场景单点引用，杜绝各页另立周期口径：
 * - 需求 1：跨周对比（getPeriodComparison 按周期聚合本周 vs 上周）
 * - 需求 8：发布提醒时长基准（待发布超时提醒以周期为参照）
 * - 需求 11：连续创作 / 效果对比（最大连续发布段、本月最佳 vs 上月最佳）
 *
 * 周期定义：
 * - 默认自然周（周一 00:00 至下周一 00:00，左闭右开）。
 * - 当门店 StoreProfile.weeklyCadence 另有配置时以其为准：取 weeklyCadence 中
 *   最早的发布日（day 取值 1=周一…7=周日 的最小者）作为「内容周」的起始星期，
 *   使周期窗口对齐该门店真实的内容运营节奏；缺失 / 非法配置时回退默认周一起始。
 *
 * 本服务为纯计算，不访问数据库、不消耗积分、不依赖环境变量。
 */

/** 周期边界（左闭右开：startDate <= date < endDate） */
export interface PeriodRange {
  /** 周期序号（0 = 含基准日的当前周期，-1 = 上一周期，依此类推） */
  index: number
  /** 周期开始（含） */
  startDate: Date
  /** 周期结束（不含） */
  endDate: Date
  /** 通俗标签，如 "本周(1.6-1.12)" */
  label: string
}

/** 一周固定 7 天 */
const DAYS_PER_PERIOD = 7

/**
 * 将 JS Date.getDay()（0=周日…6=周六）转换为 ISO 星期（1=周一…7=周日）。
 */
function toIsoDow(date: Date): number {
  const jsDow = date.getDay()
  return jsDow === 0 ? 7 : jsDow
}

/**
 * 从 weeklyCadence 配置解析「内容周」起始星期（1=周一…7=周日）。
 *
 * 约定的配置结构为 WeeklyCadenceEntry[]（{ day, theme, count }[]，day 为 1-7）。
 * 取所有合法条目中最小的 day 作为周期起始星期，对齐门店真实发布节奏。
 * 入参为 unknown 以容错任意来源：非数组 / 空数组 / 无合法条目时回退默认周一(1)。
 */
function resolveStartDow(weeklyCadence: unknown): number {
  const DEFAULT_START_DOW = 1 // 默认自然周：周一起始

  if (!Array.isArray(weeklyCadence)) {
    return DEFAULT_START_DOW
  }

  const validDays: number[] = []
  for (const entry of weeklyCadence) {
    if (
      entry !== null &&
      typeof entry === 'object' &&
      'day' in entry &&
      typeof (entry as { day: unknown }).day === 'number'
    ) {
      const day = (entry as { day: number }).day
      // 仅接受 1-7 的整数星期值
      if (Number.isInteger(day) && day >= 1 && day <= 7) {
        validDays.push(day)
      }
    }
  }

  if (validDays.length === 0) {
    return DEFAULT_START_DOW
  }

  return Math.min(...validDays)
}

/**
 * 返回某日期所在本地自然日的 00:00（清零时分秒毫秒）。
 * 使用本地时间构造，周期边界以门店本地时区的 00:00 为界。
 */
function atLocalMidnight(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0)
}

/**
 * 在给定日期基础上偏移若干天，保持本地 00:00。
 * 通过 new Date(year, month, date + offset) 构造，自动处理跨月 / 跨年 / 夏令时。
 */
function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, 0, 0, 0, 0)
}

/** 格式化为「月.日」展示，如 1.6 */
function formatMonthDay(date: Date): string {
  return `${date.getMonth() + 1}.${date.getDate()}`
}

/**
 * 生成周期的通俗中文标签。
 * @param index 周期相对序号（0=本周，-1=上周，…）
 * @param startDate 周期开始（含）
 * @param endDate 周期结束（不含）—— 展示时取其前一天作为「含」的末日
 */
function buildLabel(index: number, startDate: Date, endDate: Date): string {
  let word: string
  if (index === 0) {
    word = '本周'
  } else if (index === -1) {
    word = '上周'
  } else if (index < -1) {
    word = `${-index}周前`
  } else if (index === 1) {
    word = '下周'
  } else {
    word = `${index}周后`
  }

  // endDate 为右开边界，展示时回退一天得到该周期最后一个自然日
  const lastDay = addDays(endDate, -1)
  return `${word}(${formatMonthDay(startDate)}-${formatMonthDay(lastDay)})`
}

/**
 * 基于门店 weeklyCadence 解析周期序列。
 *
 * 默认自然周（周一 00:00 至下周一 00:00）；weeklyCadence 另有配置时以其定义的
 * 最早发布日为内容周起始星期。返回以基准日所在周期为终点、向过去回溯的 count 个
 * 周期，按时间升序排列（最早在前，当前周期 index=0 在末尾）。
 *
 * @param input.weeklyCadence StoreProfile.weeklyCadence（容错 unknown）
 * @param input.referenceDate 基准日（决定「当前周期」）
 * @param input.count 需要回溯的周期数（含当前周期，必须 >= 1）
 * @returns 按时间升序的 PeriodRange[]，长度为 max(count, 1)
 */
export function resolvePeriods(input: {
  weeklyCadence: unknown
  referenceDate: Date
  count: number
}): PeriodRange[] {
  const { weeklyCadence, referenceDate, count } = input

  // 回溯周期数至少为 1（含当前周期）
  const periodCount = Number.isInteger(count) && count >= 1 ? count : 1

  const startDow = resolveStartDow(weeklyCadence)
  const refMidnight = atLocalMidnight(referenceDate)

  // 计算基准日所在周期的起始日：回退到最近一次（含当日）的 startDow
  const refIsoDow = toIsoDow(refMidnight)
  const daysBackToStart = (refIsoDow - startDow + DAYS_PER_PERIOD) % DAYS_PER_PERIOD
  const currentStart = addDays(refMidnight, -daysBackToStart)

  const ranges: PeriodRange[] = []
  // index 从最早（-(periodCount-1)）到当前（0），保证时间升序
  for (let index = -(periodCount - 1); index <= 0; index++) {
    const startDate = addDays(currentStart, index * DAYS_PER_PERIOD)
    const endDate = addDays(startDate, DAYS_PER_PERIOD)
    ranges.push({
      index,
      startDate,
      endDate,
      label: buildLabel(index, startDate, endDate),
    })
  }

  return ranges
}

/**
 * 判断某日期归属哪个周期序号（相对 referenceDate）。
 *
 * 采用左闭右开判定：startDate <= date < endDate。命中则返回该周期的 index，
 * 不落在任一给定周期内（如未来周期或超出回溯范围）时返回 null，不臆造归属。
 *
 * @param date 待判定日期
 * @param ranges resolvePeriods 返回的周期序列
 * @returns 命中的周期 index，或 null
 */
export function periodIndexOf(date: Date, ranges: PeriodRange[]): number | null {
  const t = date.getTime()
  for (const range of ranges) {
    if (t >= range.startDate.getTime() && t < range.endDate.getTime()) {
      return range.index
    }
  }
  return null
}
