'use client'

/**
 * 数据录入表单组件
 *
 * 商家手动录入视频在各平台的表现数据。
 * 表单字段：平台选择 + 10 个数值指标。
 * 提交后调用 POST /api/content-briefs/{briefId}/metrics。
 *
 * 设计风格：暖色调、大圆角、大字体，面向非技术用户。
 *
 * Requirements: 11.1, 15.2
 */

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from 'sonner'
import { BarChart3 } from 'lucide-react'
import type { PublishPlatform } from '@/types/merchant'

/** 平台选项 */
const PLATFORM_OPTIONS: { value: PublishPlatform; label: string }[] = [
  { value: 'DOUYIN', label: '抖音' },
  { value: 'KUAISHOU', label: '快手' },
  { value: 'XIAOHONGSHU', label: '小红书' },
  { value: 'WECHAT_CHANNELS', label: '微信视频号' },
]

/** 数值字段配置 */
const METRIC_FIELDS = [
  { key: 'views', label: '播放量', placeholder: '0' },
  { key: 'likes', label: '点赞数', placeholder: '0' },
  { key: 'comments', label: '评论数', placeholder: '0' },
  { key: 'shares', label: '转发数', placeholder: '0' },
  { key: 'saves', label: '收藏数', placeholder: '0' },
  { key: 'linkClicks', label: '链接点击', placeholder: '0' },
  { key: 'messages', label: '私信数', placeholder: '0' },
  { key: 'orders', label: '下单数', placeholder: '0' },
  { key: 'redemptions', label: '核销数', placeholder: '0' },
  { key: 'revenueCents', label: '营收（元）', placeholder: '0' },
] as const

/** 表单数据类型 */
interface MetricsFormData {
  platform: PublishPlatform | ''
  views: string
  likes: string
  comments: string
  shares: string
  saves: string
  linkClicks: string
  messages: string
  orders: string
  redemptions: string
  revenueCents: string
}

const initialFormData: MetricsFormData = {
  platform: '',
  views: '',
  likes: '',
  comments: '',
  shares: '',
  saves: '',
  linkClicks: '',
  messages: '',
  orders: '',
  redemptions: '',
  revenueCents: '',
}

interface MetricsInputFormProps {
  /** 内容任务 ID */
  briefId: string
  /** 提交成功后的回调 */
  onSuccess?: () => void
}

export function MetricsInputForm({ briefId, onSuccess }: MetricsInputFormProps) {
  const [formData, setFormData] = useState<MetricsFormData>(initialFormData)
  const [submitting, setSubmitting] = useState(false)

  /** 更新数值字段 */
  function handleNumberChange(key: string, value: string) {
    // 仅允许数字输入
    const cleaned = value.replace(/[^\d]/g, '')
    setFormData((prev) => ({ ...prev, [key]: cleaned }))
  }

  /** 提交表单 */
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (!formData.platform) {
      toast.error('请选择发布平台')
      return
    }

    setSubmitting(true)
    try {
      // 将营收从"元"转为"分"
      const revenueCentsValue = formData.revenueCents
        ? Math.round(parseFloat(formData.revenueCents) * 100)
        : 0

      const body = {
        platform: formData.platform,
        views: parseInt(formData.views || '0', 10),
        likes: parseInt(formData.likes || '0', 10),
        comments: parseInt(formData.comments || '0', 10),
        shares: parseInt(formData.shares || '0', 10),
        saves: parseInt(formData.saves || '0', 10),
        linkClicks: parseInt(formData.linkClicks || '0', 10),
        messages: parseInt(formData.messages || '0', 10),
        orders: parseInt(formData.orders || '0', 10),
        redemptions: parseInt(formData.redemptions || '0', 10),
        revenueCents: revenueCentsValue,
      }

      const res = await fetch(`/api/content-briefs/${briefId}/metrics`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const errorData = await res.json().catch(() => null)
        throw new Error(errorData?.error || '提交失败')
      }

      toast.success('数据录入成功')
      setFormData(initialFormData)
      onSuccess?.()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '提交失败，请重试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card className="border-amber-200 bg-white">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-amber-900 text-lg">
          <BarChart3 className="h-5 w-5 text-amber-600" />
          录入表现数据
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* 平台选择 */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-amber-800">发布平台</label>
            <Select
              value={formData.platform}
              onValueChange={(value) =>
                setFormData((prev) => ({ ...prev, platform: value as PublishPlatform }))
              }
            >
              <SelectTrigger className="border-amber-200 focus:ring-amber-400">
                <SelectValue placeholder="选择平台" />
              </SelectTrigger>
              <SelectContent>
                {PLATFORM_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* 数值字段 — 2 列网格布局 */}
          <div className="grid grid-cols-2 gap-3">
            {METRIC_FIELDS.map((field) => (
              <div key={field.key} className="space-y-1">
                <label className="text-xs font-medium text-amber-700">
                  {field.label}
                </label>
                <Input
                  type="text"
                  inputMode="numeric"
                  placeholder={field.placeholder}
                  value={formData[field.key as keyof MetricsFormData]}
                  onChange={(e) => handleNumberChange(field.key, e.target.value)}
                  className="border-amber-200 focus:ring-amber-400 text-base"
                />
              </div>
            ))}
          </div>

          {/* 提交按钮 */}
          <Button
            type="submit"
            disabled={submitting || !formData.platform}
            className="w-full bg-amber-500 hover:bg-amber-600 text-white font-medium rounded-xl h-11 text-base"
          >
            {submitting ? '提交中...' : '提交数据'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
