'use client'

/**
 * 链式生成模式升级提示组件
 *
 * 当免费用户使用链式串行生成模式时，展示可关闭的提示横幅，
 * 告知付费用户可享受并行生成以大幅提升速度，并提供升级入口。
 *
 * Requirements: 7.2
 */

import { useState } from 'react'
import Link from 'next/link'
import { Zap, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

/** 组件 Props 定义 */
interface ChainModeUpgradeHintProps {
  /** 用户当前订阅等级 */
  tier: 'FREE' | 'MONTHLY' | 'YEARLY'
  /** 当前生成模式 */
  generationMode: 'chain' | 'parallel'
}

/**
 * 链式生成模式升级提示
 *
 * 仅在用户为 FREE 等级且使用链式串行生成时渲染。
 * 用户可手动关闭提示（当前会话内不再显示）。
 */
export function ChainModeUpgradeHint({ tier, generationMode }: ChainModeUpgradeHintProps) {
  const [dismissed, setDismissed] = useState(false)

  // 仅 FREE 等级 + 链式模式时显示
  if (tier !== 'FREE' || generationMode !== 'chain') {
    return null
  }

  // 用户已关闭提示
  if (dismissed) {
    return null
  }

  return (
    <div className="relative flex items-center gap-3 rounded-lg border border-[var(--cine-gold)]/20 bg-[var(--cine-gold-dim)] px-4 py-3">
      {/* 图标 */}
      <Zap className="size-4 shrink-0 text-[var(--cine-gold)]" />

      {/* 提示文案 */}
      <p className="flex-1 text-sm text-[var(--cine-text-2)]">
        当前为串行生成模式，付费会员可享受并行生成，大幅提升生成速度
      </p>

      {/* 升级按钮 */}
      <Link href="/dashboard/packages">
        <Button
          size="sm"
          className="bg-[var(--cine-gold)] text-[var(--cine-ink)] hover:bg-[var(--cine-gold-2)]"
        >
          升级会员
        </Button>
      </Link>

      {/* 关闭按钮 */}
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="ml-1 rounded-md p-1 text-[var(--cine-text-3)] transition-colors hover:bg-[var(--cine-line)] hover:text-[var(--cine-text-2)]"
        aria-label="关闭提示"
      >
        <X className="size-3.5" />
      </button>
    </div>
  )
}
