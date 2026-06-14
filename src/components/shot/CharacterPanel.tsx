'use client'

import { useState, useCallback } from 'react'

interface Character {
  id: string
  name: string
  appearance: string | null
  enabled: boolean
  imageUrl: string | null
  avatarStatus: 'NONE' | 'REGISTERING' | 'ACTIVE' | 'FAILED'
  avatarAssetUrl: string | null
  createdAt: string
  updatedAt: string
}

export type { Character }

interface CharacterPanelProps {
  projectId: string
  characters: Character[]
  onUpdate?: () => void
}

export default function CharacterPanel({ projectId, characters, onUpdate }: CharacterPanelProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editAppearance, setEditAppearance] = useState('')
  const [generating, setGenerating] = useState<string | null>(null)
  // 上传形象中的人物 id（避免重复提交)
  const [uploading, setUploading] = useState<string | null>(null)
  // 人物形象放大预览的图片 URL（点击缩略图打开，点遮罩关闭)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  // 开始编辑
  const startEdit = useCallback((char: Character) => {
    setEditingId(char.id)
    setEditName(char.name)
    setEditAppearance(char.appearance || '')
  }, [])

  // 保存编辑
  const saveEdit = useCallback(async (charId: string) => {
    try {
      const res = await fetch(`/api/characters/${charId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName, appearance: editAppearance }),
      })
      if (res.ok) {
        setEditingId(null)
        onUpdate?.()
      }
    } catch (error) {
      console.error('更新人物失败:', error)
    }
  }, [editName, editAppearance, onUpdate])

  // 切换启用状态
  const toggleEnabled = useCallback(async (charId: string, enabled: boolean) => {
    try {
      const res = await fetch(`/api/characters/${charId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !enabled }),
      })
      if (res.ok) {
        onUpdate?.()
      }
    } catch (error) {
      console.error('切换启用状态失败:', error)
    }
  }, [onUpdate])

  // 生成参考图
  const generateImage = useCallback(async (charId: string) => {
    setGenerating(charId)
    try {
      const res = await fetch(`/api/characters/${charId}/generate-image`, {
        method: 'POST',
      })
      if (!res.ok) {
        const data = await res.json()
        alert(data.error || '生成失败')
      }
      onUpdate?.()
    } catch (error) {
      console.error('生成参考图失败:', error)
    } finally {
      setGenerating(null)
    }
  }, [onUpdate])

  // 上传自有形象图（直接作为人物锚定图，替代文生图生成)
  const uploadImage = useCallback(async (charId: string, file: File) => {
    setUploading(charId)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch(`/api/characters/${charId}/upload-image`, {
        method: 'POST',
        body: formData,
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        alert(data.error || '上传失败')
      }
      onUpdate?.()
    } catch (error) {
      console.error('上传人物形象失败:', error)
    } finally {
      setUploading(null)
    }
  }, [onUpdate])

  // 隐藏 projectId lint warning
  void projectId

  if (characters.length === 0) {
    return (
      <div className="rounded-lg border border-[#222] bg-[var(--cine-surface)] p-4">
        <h3 className="text-sm font-medium text-gray-300 mb-2">人物信息</h3>
        <p className="text-xs text-gray-500">暂无人物，视频解析后将自动识别</p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-[#222] bg-[var(--cine-surface)] p-4">
      <h3 className="text-sm font-medium text-gray-300 mb-3">人物信息</h3>
      <div className="space-y-3">
        {characters.map((char) => (
          <div
            key={char.id}
            className="rounded-md border border-[#333] bg-[var(--cine-bg)] p-3"
          >
            {editingId === char.id ? (
              /* 编辑模式 */
              <div className="space-y-2">
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full rounded border border-[#444] bg-[#1a1a1d] px-2 py-1 text-sm text-white placeholder-gray-500 focus:border-[var(--cine-gold)] focus:outline-none"
                  placeholder="人物名称"
                />
                <textarea
                  value={editAppearance}
                  onChange={(e) => setEditAppearance(e.target.value)}
                  className="w-full rounded border border-[#444] bg-[#1a1a1d] px-2 py-1 text-sm text-white placeholder-gray-500 focus:border-[var(--cine-gold)] focus:outline-none resize-none"
                  placeholder="外貌描述"
                  rows={3}
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => saveEdit(char.id)}
                    className="rounded bg-[var(--cine-gold)] px-3 py-1 text-xs text-white hover:bg-[var(--cine-gold-2)] transition-colors"
                  >
                    保存
                  </button>
                  <button
                    onClick={() => setEditingId(null)}
                    className="rounded border border-[#444] px-3 py-1 text-xs text-gray-400 hover:text-white transition-colors"
                  >
                    取消
                  </button>
                </div>
              </div>
            ) : (
              /* 展示模式 */
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-white">{char.name}</span>
                    {!char.enabled && (
                      <span className="text-[10px] text-gray-500 border border-[#333] rounded px-1">已禁用</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    {/* 启用/禁用切换 */}
                    <button
                      onClick={() => toggleEnabled(char.id, char.enabled)}
                      className={`relative inline-flex h-4 w-8 items-center rounded-full transition-colors ${
                        char.enabled ? 'bg-[var(--cine-gold)]' : 'bg-[#333]'
                      }`}
                      title={char.enabled ? '点击禁用' : '点击启用'}
                    >
                      <span
                        className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                          char.enabled ? 'translate-x-4' : 'translate-x-0.5'
                        }`}
                      />
                    </button>
                    {/* 编辑按钮 */}
                    <button
                      onClick={() => startEdit(char)}
                      className="ml-1 text-xs text-gray-500 hover:text-[var(--cine-gold)] transition-colors"
                    >
                      编辑
                    </button>
                  </div>
                </div>

                {/* 外貌描述 */}
                {char.appearance && (
                  <p className="text-xs text-gray-400 line-clamp-2">{char.appearance}</p>
                )}

                {/* 人物图片或占位 */}
                <div className="flex items-center gap-2">
                  {char.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={char.imageUrl}
                      alt={char.name}
                      onClick={() => setPreviewUrl(char.imageUrl)}
                      className="h-16 w-16 rounded object-cover border border-[#333] cursor-zoom-in hover:border-[var(--cine-gold)] transition-colors"
                      title="点击放大预览"
                    />
                  ) : (
                    <div className="h-16 w-16 rounded border border-dashed border-[#444] bg-[#1a1a1d] flex items-center justify-center">
                      <span className="text-[10px] text-gray-500">无图</span>
                    </div>
                  )}
                  <div className="flex flex-col gap-1">
                    <button
                      onClick={() => generateImage(char.id)}
                      disabled={generating === char.id || uploading === char.id || !char.appearance}
                      className="rounded bg-[var(--cine-gold-dim)] border border-[var(--cine-gold)]/30 px-2 py-1 text-[11px] text-[var(--cine-gold)] hover:bg-[var(--cine-gold-dim)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      {generating === char.id ? '生成中...' : char.imageUrl ? '重新生成形象' : '生成人物形象'}
                    </button>
                    {/* 上传自有形象：直接作为锚定图（适合插画/3D/卡通/品牌形象；真人照片可能在生成阶段被平台审核拦截) */}
                    <label
                      className={`rounded border border-[#444] px-2 py-1 text-[11px] text-center transition-colors ${
                        uploading === char.id || generating === char.id
                          ? 'opacity-40 cursor-not-allowed text-gray-500'
                          : 'text-gray-300 hover:text-white hover:border-[var(--cine-gold)] cursor-pointer'
                      }`}
                      title="上传自有形象图作为人物锚定图（png/jpg/webp，≤10MB)"
                    >
                      {uploading === char.id ? '上传中...' : '上传形象'}
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="hidden"
                        disabled={uploading === char.id || generating === char.id}
                        onChange={(e) => {
                          const file = e.target.files?.[0]
                          if (file) uploadImage(char.id, file)
                          // 重置 value，允许重复选择同一文件再次上传
                          e.target.value = ''
                        }}
                      />
                    </label>
                    {/* 人物形象资产状态：生成成功即「已就绪」，作全片锚定图复用 */}
                    {generating !== char.id && uploading !== char.id && char.imageUrl && char.avatarStatus === 'ACTIVE' && (
                      <div className="flex items-center gap-1">
                        <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
                        <span className="text-[10px] text-[var(--cine-green)]">形象已就绪（全片锚定)</span>
                      </div>
                    )}
                    {generating !== char.id && uploading !== char.id && char.avatarStatus === 'FAILED' && (
                      <div className="flex items-center gap-1">
                        <span className="inline-block h-2 w-2 rounded-full bg-red-500" />
                        <span className="text-[10px] text-red-400">生成失败，请点「重新生成形象」或上传形象</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* 人物形象放大预览遮罩：点击任意处关闭 */}
      {previewUrl && (
        <div
          onClick={() => setPreviewUrl(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6 cursor-zoom-out"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewUrl}
            alt="人物形象预览"
            className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain shadow-2xl"
          />
        </div>
      )}
    </div>
  )
}
