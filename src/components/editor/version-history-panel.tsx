'use client'

import { useEffect, useState, useCallback } from 'react'
import { useVersionHistoryStore } from '@/stores/version-history-store'
import { VersionItemCard } from './version-item-card'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

/**
 * 版本历史面板组件 Props
 */
export interface VersionHistoryPanelProps {
  /** 分镜组 ID */
  shotGroupId: string
  /** 关闭面板回调 */
  onClose?: () => void
}

/**
 * 版本历史侧边面板
 *
 * 展示分镜组的所有历史版本（降序排列），支持：
 * - 版本列表浏览（带版本计数 n/10）
 * - 切换当前版本
 * - 删除版本（确认对话框）
 * - 选择两个版本进入 A/B 对比模式
 *
 * Requirements: 3.1, 3.3, 3.4, 4.1, 6.1, 6.5
 */
export function VersionHistoryPanel({ shotGroupId, onClose }: VersionHistoryPanelProps) {
  const {
    versions,
    stats,
    isLoading,
    error,
    compareMode,
    fetchVersions,
    switchVersion,
    deleteVersion,
    enterCompareMode,
    exitCompareMode,
  } = useVersionHistoryStore()

  /** 删除确认对话框状态 */
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)

  /** A/B 对比选择状态：选中的版本 ID 列表（最多2个） */
  const [compareSelections, setCompareSelections] = useState<string[]>([])
  /** 是否处于对比选择模式 */
  const [isSelectingCompare, setIsSelectingCompare] = useState(false)

  // 组件挂载时获取版本列表
  useEffect(() => {
    fetchVersions(shotGroupId)
  }, [shotGroupId, fetchVersions])

  // 切换当前版本
  const handleSwitch = useCallback(
    (versionId: string) => {
      switchVersion(shotGroupId, versionId)
    },
    [shotGroupId, switchVersion]
  )

  // 请求删除版本（打开确认对话框）
  const handleDeleteRequest = useCallback((versionId: string) => {
    setPendingDeleteId(versionId)
    setDeleteDialogOpen(true)
  }, [])

  // 确认删除
  const handleDeleteConfirm = useCallback(() => {
    if (pendingDeleteId) {
      deleteVersion(shotGroupId, pendingDeleteId)
    }
    setDeleteDialogOpen(false)
    setPendingDeleteId(null)
  }, [shotGroupId, pendingDeleteId, deleteVersion])

  // 取消删除
  const handleDeleteCancel = useCallback(() => {
    setDeleteDialogOpen(false)
    setPendingDeleteId(null)
  }, [])

  // A/B 对比选择
  const handleSelect = useCallback(
    (versionId: string) => {
      if (!isSelectingCompare) return

      setCompareSelections((prev) => {
        if (prev.includes(versionId)) {
          // 取消选择
          return prev.filter((id) => id !== versionId)
        }
        if (prev.length >= 2) {
          // 已选满2个，替换第一个
          return [prev[1], versionId]
        }
        return [...prev, versionId]
      })
    },
    [isSelectingCompare]
  )

  // 进入对比模式
  const handleEnterCompare = useCallback(() => {
    if (compareSelections.length === 2) {
      enterCompareMode(compareSelections[0], compareSelections[1])
    }
  }, [compareSelections, enterCompareMode])

  // 退出对比选择模式
  const handleExitCompareSelect = useCallback(() => {
    setIsSelectingCompare(false)
    setCompareSelections([])
    if (compareMode) {
      exitCompareMode()
    }
  }, [compareMode, exitCompareMode])

  // 开始选择对比版本
  const handleStartCompareSelect = useCallback(() => {
    setIsSelectingCompare(true)
    setCompareSelections([])
  }, [])

  return (
    <div className="flex h-full flex-col bg-[var(--cine-bg)] border-l border-[var(--cine-line)]">
      {/* 头部 */}
      <div className="flex items-center justify-between border-b border-[var(--cine-line)] px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium text-[var(--cine-text)]">版本历史</h2>
          {stats && (
            <span className="text-xs text-[var(--cine-text-3)]">
              {stats.count}/{stats.limit}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {/* A/B 对比按钮：至少有2个版本才显示 */}
          {versions.length >= 2 && !isSelectingCompare && (
            <Button
              variant="ghost"
              size="xs"
              className="text-[var(--cine-text-2)] hover:text-[var(--cine-gold)]"
              onClick={handleStartCompareSelect}
            >
              A/B 对比
            </Button>
          )}
          {isSelectingCompare && (
            <Button
              variant="ghost"
              size="xs"
              className="text-[var(--cine-text-3)]"
              onClick={handleExitCompareSelect}
            >
              取消
            </Button>
          )}
          {onClose && (
            <Button
              variant="ghost"
              size="xs"
              className="text-[var(--cine-text-3)] hover:text-[var(--cine-text)]"
              onClick={onClose}
              aria-label="关闭版本历史面板"
            >
              <svg
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </Button>
          )}
        </div>
      </div>

      {/* 对比选择模式提示 */}
      {isSelectingCompare && (
        <div className="border-b border-[var(--cine-line)] bg-[var(--cine-surface)] px-4 py-2">
          <p className="text-xs text-[var(--cine-text-2)]">
            请选择两个版本进行对比（已选 {compareSelections.length}/2）
          </p>
          {compareSelections.length === 2 && (
            <Button
              variant="ghost"
              size="xs"
              className="mt-1 text-[var(--cine-gold)] hover:bg-[var(--cine-gold-dim)]"
              onClick={handleEnterCompare}
            >
              开始对比
            </Button>
          )}
        </div>
      )}

      {/* 内容区域 */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {/* 加载状态 */}
        {isLoading && versions.length === 0 && (
          <div className="flex items-center justify-center py-8">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--cine-text-3)] border-t-[var(--cine-gold)]" />
            <span className="ml-2 text-xs text-[var(--cine-text-3)]">加载中...</span>
          </div>
        )}

        {/* 错误状态 */}
        {error && (
          <div className="rounded-lg border border-red-900/30 bg-red-950/20 px-3 py-2">
            <p className="text-xs text-red-400">{error}</p>
            <Button
              variant="ghost"
              size="xs"
              className="mt-1 text-red-400 hover:text-red-300"
              onClick={() => fetchVersions(shotGroupId)}
            >
              重试
            </Button>
          </div>
        )}

        {/* 空状态 */}
        {!isLoading && !error && versions.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <svg
              className="h-8 w-8 text-[var(--cine-text-3)]"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
              />
            </svg>
            <p className="mt-2 text-xs text-[var(--cine-text-3)]">暂无版本记录</p>
            <p className="mt-0.5 text-[11px] text-[var(--cine-text-3)]/60">
              生成视频后将自动创建版本
            </p>
          </div>
        )}

        {/* 版本列表 */}
        {versions.length > 0 && (
          <div className="flex flex-col gap-2">
            {versions.map((version) => (
              <VersionItemCard
                key={version.id}
                version={version}
                isSelected={compareSelections.includes(version.id)}
                onSwitch={handleSwitch}
                onDelete={handleDeleteRequest}
                onSelect={isSelectingCompare ? handleSelect : undefined}
              />
            ))}
          </div>
        )}
      </div>

      {/* 删除确认对话框 */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              删除后将无法恢复该版本的视频和封面文件。确定要删除吗？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleDeleteCancel}>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={handleDeleteConfirm}
            >
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
