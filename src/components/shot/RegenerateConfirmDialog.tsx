'use client'

import { Dialog } from '@base-ui/react/dialog'
import { Button } from '@/components/ui/button'

interface RegenerateConfirmDialogProps {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  // 该组序号（从 0 起，展示时 +1)
  groupIndex: number
  // 本次抽卡（重新生成)将消耗的积分
  cost: number
  // 提交中状态：确认后禁用按钮，防止重复提交
  submitting?: boolean
}

/**
 * 抽卡（重新生成)二次确认弹窗。
 *
 * 已完成的分镜组点「重新生成」时弹出：AI 生成有随机性，每次重新生成都是一次真实调用，
 * 会实际扣除积分。用户确认后才以 force=true 触发真生成。
 */
export function RegenerateConfirmDialog({
  open,
  onClose,
  onConfirm,
  groupIndex,
  cost,
  submitting = false,
}: RegenerateConfirmDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm transition-opacity" />
        <Dialog.Popup className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-xl border border-[var(--cine-line-2)] bg-[var(--cine-surface)] p-6 shadow-2xl">
            {/* 图标 */}
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--cine-gold-dim)]">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-6 w-6 text-[var(--cine-gold)]"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
            </div>

            {/* 标题 */}
            <Dialog.Title className="text-center text-lg font-semibold text-white">
              重新生成第 {groupIndex + 1} 组？
            </Dialog.Title>

            {/* 描述 */}
            <Dialog.Description className="mt-2 text-center text-sm text-[var(--cine-text-2)]">
              AI 生成带有随机性，重新生成会发起一次全新的生成并覆盖当前结果。
            </Dialog.Description>

            {/* 积分消耗提示 */}
            <div className="mt-4 rounded-lg bg-[var(--cine-surface)] p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-[var(--cine-text-2)]">本次将消耗</span>
                <span className="text-sm font-medium text-[var(--cine-gold)]">
                  {cost} 积分
                </span>
              </div>
            </div>

            {/* 操作按钮 */}
            <div className="mt-6 flex gap-3">
              <Button
                variant="outline"
                className="flex-1"
                onClick={onClose}
                disabled={submitting}
              >
                取消
              </Button>
              <Button
                className="flex-1 bg-[var(--cine-gold)] text-white hover:bg-[var(--cine-gold)]/80"
                onClick={onConfirm}
                disabled={submitting}
              >
                {submitting ? '提交中...' : '确认重新生成'}
              </Button>
            </div>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
