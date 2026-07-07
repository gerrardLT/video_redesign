'use client'

/**
 * 空态插画组件 — v3 禅意编辑式风格
 *
 * 当页面数据为空时展示单色 SVG 线稿插画，配合衬线标题与引导文案。
 * 插画使用 #00754A 主色，不使用渐变背景或多色装饰。
 *
 * 插画资源位于 public/illustrations/ 目录（MIT 授权 SVG）。
 *
 * @example
 * <EmptyState
 *   illustration="video"
 *   title="开始你的第一条视频"
 *   description="完成今日拍摄任务，系统会自动帮你生成多个版本的短视频"
 * />
 */

import Image from 'next/image'

/** 可用的插画类型 → 对应 public/illustrations/ 下的 SVG 文件名 */
const illustrationMap: Record<EmptyStateProps['illustration'], string> = {
  cooking: '/illustrations/onboarding-shoot.svg',
  checklist: '/illustrations/empty-calendar.svg',
  upload: '/illustrations/onboarding-shoot.svg',
  video: '/illustrations/empty-video.svg',
}

export interface EmptyStateProps {
  /** 插画类型 */
  illustration: 'cooking' | 'checklist' | 'upload' | 'video'
  /** 衬线大标题 */
  title: string
  /** 一句话引导文案 */
  description: string
}

/**
 * EmptyState 空态插画组件
 *
 * 展示单色 SVG 线稿插画 + Noto Serif SC 衬线标题 + 引导文案。
 * 不使用渐变背景或多色装饰，保持克制留白。
 */
export function EmptyState({ illustration, title, description }: EmptyStateProps) {
  const src = illustrationMap[illustration]

  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      {/* 单色 SVG 线稿插画 */}
      <Image
        src={src}
        alt={title}
        width={200}
        height={160}
        className="mb-6 opacity-85"
        priority={false}
      />

      {/* 衬线标题 — Noto Serif SC */}
      <h3
        className="text-lg font-semibold leading-relaxed text-[var(--ll-text-1,rgba(0,0,0,.87))]"
        style={{ fontFamily: 'var(--font-serif)' }}
      >
        {title}
      </h3>

      {/* 一句话引导文案 */}
      <p className="mt-2 max-w-[260px] text-sm leading-relaxed text-[var(--ll-text-3,rgba(0,0,0,.4))]">
        {description}
      </p>
    </div>
  )
}
