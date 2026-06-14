'use client'

import { Dialog } from '@base-ui/react/dialog'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'

interface InsufficientCreditsDialogProps {
  open: boolean
  onClose: () => void
  currentBalance: number
  requiredCredits: number
}

export function InsufficientCreditsDialog({
  open,
  onClose,
  currentBalance,
  requiredCredits,
}: InsufficientCreditsDialogProps) {
  const router = useRouter()

  return (
    <Dialog.Root open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm transition-opacity" />
        <Dialog.Popup className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-xl border border-[var(--cine-line-2)] bg-[var(--cine-surface)] p-6 shadow-2xl">
            {/* 图标 */}
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-500/10">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-6 w-6 text-red-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>

            {/* 标题 */}
            <Dialog.Title className="text-center text-lg font-semibold text-white">
              积分余额不足
            </Dialog.Title>

            {/* 描述 */}
            <Dialog.Description className="mt-2 text-center text-sm text-[var(--cine-text-2)]">
              当前余额不足以执行此操作，请充值后重试。
            </Dialog.Description>

            {/* 积分信息 */}
            <div className="mt-4 rounded-lg bg-[var(--cine-surface)] p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-[var(--cine-text-2)]">当前余额</span>
                <span className="text-sm font-medium text-white">
                  {currentBalance} 积分
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-sm text-[var(--cine-text-2)]">所需积分</span>
                <span className="text-sm font-medium text-red-400">
                  {requiredCredits} 积分
                </span>
              </div>
              <div className="mt-2 border-t border-[var(--cine-line-2)] pt-2 flex items-center justify-between">
                <span className="text-sm text-[var(--cine-text-2)]">还需充值</span>
                <span className="text-sm font-medium text-[var(--cine-gold)]">
                  {Math.max(0, requiredCredits - currentBalance)} 积分
                </span>
              </div>
            </div>

            {/* 操作按钮 */}
            <div className="mt-6 flex gap-3">
              <Button
                variant="outline"
                className="flex-1"
                onClick={onClose}
              >
                取消
              </Button>
              <Button
                className="flex-1 bg-[var(--cine-gold)] text-white hover:bg-[var(--cine-gold)]/80"
                onClick={() => {
                  onClose()
                  router.push('/dashboard/packages')
                }}
              >
                前往充值
              </Button>
            </div>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
