'use client'

/**
 * 工作台客户端容器组件
 *
 * 高级感视觉升级：
 * - 顶部径向光晕氛围层
 * - 创作卡片毛玻璃质感
 * - 标题渐变色
 * - 空间节奏统一
 */

import { useEffect } from 'react'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { PromptInput } from './PromptInput'
import { AssetUploader } from './AssetUploader'
import { ModelSelector } from './ModelSelector'
import { ParamBar } from './ParamBar'
import { GenerateButton } from './GenerateButton'
import { ProgressOverlay } from './ProgressOverlay'
import { ResultGallery } from './ResultGallery'

export function WorkspaceClient() {
  const setCreditBalance = useWorkspaceStore((s) => s.setCreditBalance)

  useEffect(() => {
    async function loadBalance() {
      try {
        const res = await fetch('/api/credits/balance')
        if (res.ok) {
          const data = await res.json()
          setCreditBalance(data.balance ?? 0)
        }
      } catch { /* 不阻塞 */ }
    }
    loadBalance()
  }, [setCreditBalance])

  return (
    <div className="min-h-[calc(100vh-56px)] relative overflow-hidden">
      {/* ===== 氛围层：顶部径向光晕 ===== */}
      <div
        className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] opacity-[0.04]"
        style={{
          background: 'radial-gradient(ellipse at center, var(--cine-gold) 0%, transparent 70%)',
        }}
      />

      {/* ===== 创作区域 ===== */}
      <section className="relative flex flex-col items-center pt-16 pb-6 px-4">
        {/* 标题：渐变色 */}
        <h1 className="text-xl sm:text-2xl font-bold text-center mb-1 text-[var(--cine-text)]">
          <span className="bg-gradient-to-r from-[var(--cine-gold)] to-[#E8D5B0] bg-clip-text text-transparent">
            AI 视频生成
          </span>
          {' '}工作台
        </h1>
        <p className="text-xs text-[var(--cine-text-3)] mb-10 text-center tracking-wide">
          描述画面 · 选模型 · 上传参考素材 · 一键生成
        </p>

        {/* ===== 创作输入卡片（毛玻璃质感） ===== */}
        <div className="w-full max-w-[900px] rounded-2xl border border-[var(--cine-line-2)] bg-[var(--cine-surface)]/90 backdrop-blur-sm p-5 transition-all duration-300 focus-within:border-[var(--cine-gold)]/60 focus-within:shadow-[0_0_0_3px_rgba(199,168,119,0.10),0_8px_32px_rgba(0,0,0,0.2)]">
          {/* 输入区：prompt + 上传（在同一个区块内） */}
          <div className="flex flex-col">
            <PromptInput />
            {/* 上传区在输入框内部底部 */}
            <AssetUploader />
          </div>

          {/* 参数行（分隔线下方） */}
          <div className="flex items-center gap-2 gap-y-2 mt-3 pt-3 border-t border-[var(--cine-line-2)]/50 flex-wrap">
            <ModelSelector />
            <ParamBar />
            <div className="flex-1" />
            <GenerateButton />
          </div>
        </div>

        {/* 进度指示（内联，卡片下方） */}
        <ProgressOverlay />
      </section>

      {/* ===== 结果画廊 ===== */}
      <div className="max-w-6xl mx-auto px-4 sm:px-8">
        <div className="border-t border-[var(--cine-line-2)]/30 mb-6" />
      </div>
      <ResultGallery />
    </div>
  )
}
