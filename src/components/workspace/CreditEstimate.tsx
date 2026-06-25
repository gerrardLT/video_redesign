'use client'

/**
 * 积分预估组件
 *
 * 实时展示预估积分消耗，参数变化后 300ms 防抖更新。
 * 余额不足时高亮警告。
 */

import { useState, useEffect, useRef } from 'react'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { estimateWorkspaceCost } from '@/lib/credit-calc'

export function CreditEstimate() {
  const model = useWorkspaceStore((s) => s.model)
  const duration = useWorkspaceStore((s) => s.duration)
  const resolution = useWorkspaceStore((s) => s.resolution)
  const creditBalance = useWorkspaceStore((s) => s.creditBalance)

  const [displayCost, setDisplayCost] = useState(0)
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  // 300ms 防抖更新预估值
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      const cost = estimateWorkspaceCost(model, duration, resolution)
      setDisplayCost(cost)
    }, 300)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [model, duration, resolution])

  const isInsufficient = creditBalance < displayCost

  return (
    <span
      className={`text-xs mr-1 ${isInsufficient ? 'text-red-400' : 'text-[var(--cine-text-3)]'}`}
      title={isInsufficient ? `余额不足（剩余 ${creditBalance}）` : `预估消耗 ${displayCost} 积分`}
    >
      ↓ {displayCost}
      {isInsufficient && <span className="ml-1 text-red-400 text-[10px]">余额不足</span>}
    </span>
  )
}
