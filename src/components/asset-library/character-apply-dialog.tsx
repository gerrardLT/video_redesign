'use client'

/**
 * 角色图跨项目应用对话框
 *
 * 两级选择器：先选项目，再选角色，确认后将资产库角色图应用到目标角色。
 * 若目标角色已有参考图，显示覆盖警告需二次确认。
 *
 * 数据加载使用 SWR，toast 反馈使用 sonner。
 *
 * Requirements: 3.1, 3.2, 3.3, 3.6, 3.7, 6.1, 6.2, 6.3, 6.4, 6.5
 */

import { useState, useCallback } from 'react'
import useSWR from 'swr'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { AlertTriangle, ImageOff, Loader2, Check } from 'lucide-react'

// ========================
// 类型定义
// ========================

export interface CharacterApplyDialogProps {
  assetId: string
  assetUrl: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: (projectName: string, characterName: string) => void
}

/** 项目列表（含角色计数） */
interface ProjectWithCharacters {
  id: string
  name: string
  characterCount: number
  updatedAt: string
}

/** 角色选项 */
interface CharacterOption {
  id: string
  name: string
  imageUrl: string | null
}

// ========================
// SWR Fetcher
// ========================

const projectsFetcher = async (url: string): Promise<{ projects: ProjectWithCharacters[] }> => {
  const res = await fetch(url)
  if (!res.ok) throw new Error('加载项目列表失败')
  return res.json()
}

const charactersFetcher = async (url: string): Promise<{ characters: CharacterOption[] }> => {
  const res = await fetch(url)
  if (!res.ok) throw new Error('加载角色列表失败')
  return res.json()
}

// ========================
// 组件实现
// ========================

export function CharacterApplyDialog({
  assetId,
  assetUrl,
  open,
  onOpenChange,
  onSuccess,
}: CharacterApplyDialogProps) {
  // 选择状态
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null)
  // 提交状态
  const [isApplying, setIsApplying] = useState(false)
  // 覆盖确认状态
  const [showOverwriteConfirm, setShowOverwriteConfirm] = useState(false)

  // 加载项目列表（对话框打开时请求）
  const {
    data: projectsData,
    isLoading: isLoadingProjects,
    error: projectsError,
    mutate: mutateProjects,
  } = useSWR<{ projects: ProjectWithCharacters[] }>(
    open ? '/api/projects/list-with-characters' : null,
    projectsFetcher,
    { revalidateOnFocus: false }
  )

  // 加载角色列表（选择项目后请求）
  const {
    data: charactersData,
    isLoading: isLoadingCharacters,
    error: charactersError,
    mutate: mutateCharacters,
  } = useSWR<{ characters: CharacterOption[] }>(
    open && selectedProjectId
      ? `/api/projects/list-with-characters?projectId=${selectedProjectId}`
      : null,
    charactersFetcher,
    { revalidateOnFocus: false }
  )

  const projects = projectsData?.projects ?? []
  const characters = charactersData?.characters ?? []

  // 获取当前选中的项目和角色信息
  const selectedProject = projects.find((p) => p.id === selectedProjectId) ?? null
  const selectedCharacter = characters.find((c) => c.id === selectedCharacterId) ?? null

  /** 重置选择状态 */
  const resetState = useCallback(() => {
    setSelectedProjectId(null)
    setSelectedCharacterId(null)
    setShowOverwriteConfirm(false)
    setIsApplying(false)
  }, [])

  /** 对话框关闭时重置 */
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        resetState()
      }
      onOpenChange(nextOpen)
    },
    [onOpenChange, resetState]
  )

  /** 选择项目 */
  const handleSelectProject = useCallback((projectId: string) => {
    setSelectedProjectId(projectId)
    setSelectedCharacterId(null)
    setShowOverwriteConfirm(false)
  }, [])

  /** 选择角色 */
  const handleSelectCharacter = useCallback(
    (characterId: string) => {
      setSelectedCharacterId(characterId)
      setShowOverwriteConfirm(false)

      // 检查目标角色是否已有参考图
      const target = characters.find((c) => c.id === characterId)
      if (target?.imageUrl) {
        setShowOverwriteConfirm(true)
      }
    },
    [characters]
  )

  /** 执行应用操作 */
  const handleApply = useCallback(async () => {
    if (!selectedProjectId || !selectedCharacterId || !selectedProject || !selectedCharacter) return

    setIsApplying(true)
    try {
      const res = await fetch(`/api/asset-library/${assetId}/apply-to-character`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetProjectId: selectedProjectId,
          targetCharacterId: selectedCharacterId,
        }),
      })

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}))
        const errorMsg = errorData.error || '应用失败，请重试'
        toast.error(errorMsg)
        return
      }

      // 成功反馈
      toast.success(`已应用到 ${selectedProject.name} - ${selectedCharacter.name}`)
      onSuccess(selectedProject.name, selectedCharacter.name)
      handleOpenChange(false)
    } catch {
      toast.error('网络请求失败，请重试')
    } finally {
      setIsApplying(false)
    }
  }, [
    assetId,
    selectedProjectId,
    selectedCharacterId,
    selectedProject,
    selectedCharacter,
    onSuccess,
    handleOpenChange,
  ])

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>应用到角色</DialogTitle>
          <DialogDescription>
            选择目标项目和角色，将此参考图应用为角色形象
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          {/* 第一级：项目选择 */}
          <ProjectSelector
            projects={projects}
            isLoading={isLoadingProjects}
            error={projectsError}
            selectedProjectId={selectedProjectId}
            onSelect={handleSelectProject}
            onRetry={() => mutateProjects()}
          />

          {/* 第二级：角色选择（选中项目后显示） */}
          {selectedProjectId && (
            <CharacterSelector
              characters={characters}
              isLoading={isLoadingCharacters}
              error={charactersError}
              selectedCharacterId={selectedCharacterId}
              onSelect={handleSelectCharacter}
              onRetry={() => mutateCharacters()}
            />
          )}

          {/* 覆盖警告 */}
          {showOverwriteConfirm && selectedCharacter && (
            <OverwriteWarning characterName={selectedCharacter.name} />
          )}

          {/* 确认按钮 */}
          {selectedCharacterId && (
            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={isApplying}
              >
                取消
              </Button>
              <Button
                onClick={handleApply}
                disabled={isApplying}
              >
                {isApplying ? (
                  <>
                    <Loader2 className="mr-1.5 size-4 animate-spin" />
                    应用中...
                  </>
                ) : showOverwriteConfirm ? (
                  '确认覆盖'
                ) : (
                  '确认应用'
                )}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ========================
// 子组件
// ========================

/** 项目选择器 */
function ProjectSelector({
  projects,
  isLoading,
  error,
  selectedProjectId,
  onSelect,
  onRetry,
}: {
  projects: ProjectWithCharacters[]
  isLoading: boolean
  error: Error | undefined
  selectedProjectId: string | null
  onSelect: (id: string) => void
  onRetry: () => void
}) {
  if (isLoading) {
    return (
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-[var(--cine-text)]">选择项目</label>
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-2 py-4">
        <p className="text-sm text-[var(--cine-red)]">加载项目列表失败</p>
        <Button variant="outline" size="sm" onClick={onRetry}>
          重试
        </Button>
      </div>
    )
  }

  if (projects.length === 0) {
    return (
      <div className="flex flex-col items-center gap-1 py-4">
        <p className="text-sm text-[var(--cine-text-2)]">暂无可用项目</p>
        <p className="text-xs text-[var(--cine-text-3)]">请先创建项目并添加角色</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium text-[var(--cine-text)]">选择项目</label>
      <div className="flex max-h-48 flex-col gap-1.5 overflow-y-auto rounded-lg border border-[var(--cine-line-2)] p-2">
        {projects.map((project) => (
          <button
            key={project.id}
            type="button"
            onClick={() => onSelect(project.id)}
            className={`flex items-center justify-between rounded-lg px-3 py-2.5 text-left transition-colors ${
              selectedProjectId === project.id
                ? 'bg-[var(--cine-gold)]/10 border border-[var(--cine-gold)]/30'
                : 'hover:bg-[var(--cine-bg-soft)] border border-transparent'
            }`}
          >
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium text-[var(--cine-text)]">
                {project.name}
              </span>
              <span className="text-xs text-[var(--cine-text-3)]">
                {project.characterCount} 个角色
              </span>
            </div>
            {selectedProjectId === project.id && (
              <Check className="size-4 text-[var(--cine-gold)]" />
            )}
          </button>
        ))}
      </div>
    </div>
  )
}

/** 角色选择器 */
function CharacterSelector({
  characters,
  isLoading,
  error,
  selectedCharacterId,
  onSelect,
  onRetry,
}: {
  characters: CharacterOption[]
  isLoading: boolean
  error: Error | undefined
  selectedCharacterId: string | null
  onSelect: (id: string) => void
  onRetry: () => void
}) {
  if (isLoading) {
    return (
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-[var(--cine-text)]">选择角色</label>
        <div className="flex flex-col gap-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-2 py-4">
        <p className="text-sm text-[var(--cine-red)]">加载角色列表失败</p>
        <Button variant="outline" size="sm" onClick={onRetry}>
          重试
        </Button>
      </div>
    )
  }

  if (characters.length === 0) {
    return (
      <div className="flex flex-col items-center gap-1 py-4">
        <p className="text-sm text-[var(--cine-text-2)]">该项目暂无角色</p>
        <p className="text-xs text-[var(--cine-text-3)]">请先在项目中创建角色</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium text-[var(--cine-text)]">选择角色</label>
      <div className="flex max-h-48 flex-col gap-1.5 overflow-y-auto rounded-lg border border-[var(--cine-line-2)] p-2">
        {characters.map((character) => (
          <button
            key={character.id}
            type="button"
            onClick={() => onSelect(character.id)}
            className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
              selectedCharacterId === character.id
                ? 'bg-[var(--cine-gold)]/10 border border-[var(--cine-gold)]/30'
                : 'hover:bg-[var(--cine-bg-soft)] border border-transparent'
            }`}
          >
            {/* 角色缩略图 */}
            <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[var(--cine-bg-soft)]">
              {character.imageUrl ? (
                <img
                  src={character.imageUrl}
                  alt={character.name}
                  className="size-full object-cover"
                />
              ) : (
                <ImageOff className="size-4 text-[var(--cine-text-3)]" />
              )}
            </div>

            {/* 角色信息 */}
            <div className="flex flex-1 flex-col gap-0.5">
              <span className="text-sm font-medium text-[var(--cine-text)]">
                {character.name}
              </span>
              {character.imageUrl ? (
                <span className="text-xs text-[var(--cine-text-3)]">已有参考图</span>
              ) : (
                <span className="text-xs text-[var(--cine-text-3)]">无参考图</span>
              )}
            </div>

            {/* 选中标记 */}
            {selectedCharacterId === character.id && (
              <Check className="size-4 shrink-0 text-[var(--cine-gold)]" />
            )}
          </button>
        ))}
      </div>
    </div>
  )
}

/** 覆盖警告 */
function OverwriteWarning({ characterName }: { characterName: string }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-[var(--cine-gold)]/30 bg-[var(--cine-gold)]/5 px-3 py-2.5">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--cine-gold)]" />
      <p className="text-sm text-[var(--cine-text-2)]">
        角色「{characterName}」已有参考图，确认覆盖？
      </p>
    </div>
  )
}
