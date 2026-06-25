'use client'

/**
 * 优化建议卡片组件
 *
 * 展示单条表现学习优化建议：
 * - 类别图标（hook/CTA/offer/structure/timing）
 * - 推荐动作描述
 * - 数据证据说明
 *
 * 设计风格：暖色调、大圆角、日常用语。
 *
 * Requirements: 12.1, 15.2
 */

import { Card, CardContent } from '@/components/ui/card'
import {
  Zap,
  Target,
  Gift,
  LayoutList,
  Clock,
} from 'lucide-react'
import type { Suggestion } from '@/types/merchant'

/** 类别图标和中文标签映射 */
const CATEGORY_CONFIG: Record<Suggestion['category'], { icon: typeof Zap; label: string; color: string }> = {
  hook: { icon: Zap, label: '开场钩子', color: 'text-yellow-600 bg-yellow-100' },
  CTA: { icon: Target, label: '行动号召', color: 'text-red-600 bg-red-100' },
  offer: { icon: Gift, label: '优惠策略', color: 'text-green-600 bg-green-100' },
  structure: { icon: LayoutList, label: '内容结构', color: 'text-blue-600 bg-blue-100' },
  timing: { icon: Clock, label: '发布时间', color: 'text-purple-600 bg-purple-100' },
}

interface PerformanceInsightCardProps {
  /** 优化建议数据 */
  suggestion: Suggestion
}

export function PerformanceInsightCard({ suggestion }: PerformanceInsightCardProps) {
  const config = CATEGORY_CONFIG[suggestion.category]
  const Icon = config.icon

  return (
    <Card className="border-amber-100 bg-white hover:shadow-sm transition-shadow">
      <CardContent className="p-4">
        <div className="flex gap-3">
          {/* 类别图标 */}
          <div className={`flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center ${config.color}`}>
            <Icon className="h-5 w-5" />
          </div>

          {/* 内容区域 */}
          <div className="flex-1 min-w-0">
            {/* 类别标签 */}
            <span className="text-xs font-medium text-amber-600 uppercase tracking-wide">
              {config.label}
            </span>

            {/* 推荐动作 */}
            <p className="mt-1 text-sm font-medium text-gray-900 leading-snug">
              {suggestion.action}
            </p>

            {/* 数据证据 */}
            <p className="mt-1.5 text-xs text-gray-500 leading-relaxed">
              📊 {suggestion.evidence}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
