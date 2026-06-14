'use client'

import { useState, useCallback, useEffect } from 'react'
import { Dialog } from '@base-ui/react/dialog'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { validateShareLink } from '@/lib/video-import-service'
import { PLATFORM_PATTERNS, type VideoPlatform } from '@/constants/platform-patterns'

interface ImportLinkDialogProps {
  open: boolean
  onClose: () => void
}

/** 平台图标 SVG 组件 */
function PlatformIcon({ platform }: { platform: VideoPlatform | null }) {
  if (!platform) return null

  switch (platform) {
    case 'douyin':
      return (
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[var(--cine-surface)]" aria-label="抖音">
          <svg viewBox="0 0 24 24" className="h-4 w-4 text-[#fe2c55]" fill="currentColor" aria-hidden="true">
            <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.88 2.89 2.89 0 01-2.88-2.88 2.89 2.89 0 012.88-2.88c.28 0 .56.04.82.1V9.39a6.17 6.17 0 00-.82-.06A6.28 6.28 0 003.2 15.6a6.28 6.28 0 006.29 6.28 6.28 6.28 0 006.28-6.28V9.01a8.28 8.28 0 004.85 1.56V7.12a4.84 4.84 0 01-1.03-.43z" />
          </svg>
        </span>
      )
    case 'kuaishou':
      return (
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[var(--cine-surface)]" aria-label="快手">
          <svg viewBox="0 0 24 24" className="h-4 w-4 text-[#ff4500]" fill="currentColor" aria-hidden="true">
            <path d="M12.52 2c-.58 3.02-2.8 5.4-5.7 6.2v3.8c1.5-.3 2.9-.9 4.1-1.8v9.6h3.6V2h-2z" />
            <circle cx="9.5" cy="17" r="3" />
          </svg>
        </span>
      )
    case 'weixin':
      return (
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[var(--cine-surface)]" aria-label="微信视频号">
          <svg viewBox="0 0 24 24" className="h-4 w-4 text-[#07c160]" fill="currentColor" aria-hidden="true">
            <path d="M8.69 3C4.97 3 2 5.77 2 9.17c0 1.87.9 3.55 2.3 4.68l-.5 2.5 2.7-1.4c.7.2 1.4.32 2.19.32.34 0 .67-.02 1-.06a5.17 5.17 0 01-.2-1.38c0-3.17 2.86-5.75 6.38-5.75.36 0 .71.03 1.06.08C16.68 5.13 13.05 3 8.69 3zm-2.6 4.25a1.13 1.13 0 110 2.25 1.13 1.13 0 010-2.25zm4.93 0a1.13 1.13 0 110 2.25 1.13 1.13 0 010-2.25zM15.87 9.58c-2.97 0-5.38 2.17-5.38 4.83 0 2.67 2.41 4.84 5.38 4.84.56 0 1.1-.08 1.62-.22l2.12 1.1-.39-1.96c1.16-.94 1.9-2.28 1.9-3.76 0-2.66-2.4-4.83-5.25-4.83zm-1.92 3.38a.94.94 0 110 1.87.94.94 0 010-1.87zm3.75 0a.94.94 0 110 1.87.94.94 0 010-1.87z" />
          </svg>
        </span>
      )
    default:
      return null
  }
}

export function ImportLinkDialog({ open, onClose }: ImportLinkDialogProps) {
  const router = useRouter()
  const [url, setUrl] = useState('')
  const [projectName, setProjectName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [detectedPlatform, setDetectedPlatform] = useState<VideoPlatform | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // 重置表单
  const resetForm = useCallback(() => {
    setUrl('')
    setProjectName('')
    setError(null)
    setDetectedPlatform(null)
    setIsSubmitting(false)
  }, [])

  // 弹窗关闭时重置
  useEffect(() => {
    if (!open) {
      resetForm()
    }
  }, [open, resetForm])

  // 当链接变化时，自动检测平台
  const handleUrlChange = useCallback((value: string) => {
    setUrl(value)
    setError(null)

    if (!value.trim()) {
      setDetectedPlatform(null)
      return
    }

    // 尝试匹配平台
    const result = validateShareLink(value)
    if (result.valid && result.platform) {
      setDetectedPlatform(result.platform)
    } else {
      setDetectedPlatform(null)
    }
  }, [])

  // 获取平台中文名
  const getPlatformLabel = (platform: VideoPlatform): string => {
    const found = PLATFORM_PATTERNS.find((p) => p.platform === platform)
    return found?.label || platform
  }

  // 提交导入
  const handleSubmit = async () => {
    // 客户端预验证
    const validation = validateShareLink(url)
    if (!validation.valid) {
      setError(validation.error || '链接格式不正确')
      return
    }

    setIsSubmitting(true)
    setError(null)

    try {
      const res = await fetch('/api/projects/import-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: url.trim(),
          name: projectName.trim() || undefined,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || '导入失败，请稍后重试')
        setIsSubmitting(false)
        return
      }

      // 成功
      toast.success('视频导入任务已创建，正在下载中...')
      onClose()
      router.push(`/dashboard/projects/${data.projectId}`)
    } catch {
      setError('网络请求失败，请检查网络连接后重试')
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm transition-opacity" />
        <Dialog.Popup className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-xl border border-[var(--cine-line-2)] bg-[var(--cine-surface)] p-6 shadow-2xl">
            {/* 标题区域 */}
            <div className="mb-5 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--cine-gold-dim)]">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-5 w-5 text-[var(--cine-gold)]"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
                  />
                </svg>
              </div>
              <div>
                <Dialog.Title className="text-lg font-semibold text-white">
                  链接导入视频
                </Dialog.Title>
                <Dialog.Description className="text-sm text-[var(--cine-text-2)]">
                  粘贴抖音、快手或视频号的分享链接
                </Dialog.Description>
              </div>
            </div>

            {/* 链接输入 */}
            <div className="space-y-4">
              <div>
                <label
                  htmlFor="import-url"
                  className="mb-1.5 block text-sm font-medium text-[var(--cine-text)]"
                >
                  视频链接 <span className="text-red-400">*</span>
                </label>
                <div className="relative">
                  <input
                    id="import-url"
                    type="url"
                    value={url}
                    onChange={(e) => handleUrlChange(e.target.value)}
                    onPaste={(e) => {
                      // 粘贴时自动使用粘贴内容
                      const pasted = e.clipboardData.getData('text')
                      if (pasted) {
                        setTimeout(() => handleUrlChange(pasted), 0)
                      }
                    }}
                    placeholder="粘贴视频分享链接..."
                    className="w-full rounded-lg border border-[var(--cine-line-2)] bg-[var(--cine-surface)] px-3 py-2.5 pr-10 text-sm text-white placeholder:text-[var(--cine-text-3)] focus:border-[var(--cine-gold)]/50 focus:outline-none focus:ring-1 focus:ring-[var(--cine-gold)]/50 transition-colors"
                    disabled={isSubmitting}
                    autoFocus
                  />
                  {/* 平台识别图标 */}
                  {detectedPlatform && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      <PlatformIcon platform={detectedPlatform} />
                    </div>
                  )}
                </div>
                {/* 识别到的平台提示 */}
                {detectedPlatform && !error && (
                  <p className="mt-1.5 text-xs text-[var(--cine-gold)]">
                    已识别为{getPlatformLabel(detectedPlatform)}链接
                  </p>
                )}
                {/* 错误提示 */}
                {error && (
                  <p className="mt-1.5 text-xs text-red-400" role="alert">
                    {error}
                  </p>
                )}
              </div>

              {/* 项目名称（可选) */}
              <div>
                <label
                  htmlFor="import-name"
                  className="mb-1.5 block text-sm font-medium text-[var(--cine-text)]"
                >
                  项目名称{' '}
                  <span className="text-[var(--cine-text-3)] font-normal">（可选)</span>
                </label>
                <input
                  id="import-name"
                  type="text"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="留空将自动生成名称"
                  maxLength={100}
                  className="w-full rounded-lg border border-[var(--cine-line-2)] bg-[var(--cine-surface)] px-3 py-2.5 text-sm text-white placeholder:text-[var(--cine-text-3)] focus:border-[var(--cine-gold)]/50 focus:outline-none focus:ring-1 focus:ring-[var(--cine-gold)]/50 transition-colors"
                  disabled={isSubmitting}
                />
              </div>
            </div>

            {/* 支持平台提示 */}
            <div className="mt-4 flex items-center gap-2 rounded-lg bg-white/[0.03] px-3 py-2">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-3.5 w-3.5 text-[var(--cine-text-3)]"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <span className="text-xs text-[var(--cine-text-3)]">
                支持抖音、快手、微信视频号的分享链接
              </span>
            </div>

            {/* 操作按钮 */}
            <div className="mt-6 flex gap-3">
              <Button
                variant="outline"
                className="flex-1"
                onClick={onClose}
                disabled={isSubmitting}
              >
                取消
              </Button>
              <Button
                className="flex-1 bg-[var(--cine-gold)] text-white hover:bg-[var(--cine-gold)]/80"
                onClick={handleSubmit}
                disabled={isSubmitting || !url.trim()}
              >
                {isSubmitting ? (
                  <span className="flex items-center gap-2">
                    <svg
                      className="h-4 w-4 animate-spin"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                      />
                    </svg>
                    导入中...
                  </span>
                ) : (
                  '开始导入'
                )}
              </Button>
            </div>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
