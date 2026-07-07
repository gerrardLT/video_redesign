'use client'

/**
 * Prompt 输入组件
 *
 * 多行文本输入，无字数限制。
 * 输入 @ 时弹出素材选择面板（当前上传 + 用户资产库 + 上传入口）。
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import { Upload, X, Search } from 'lucide-react'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { validateFile } from '@/lib/video/workspace-validators'
import { toast } from 'sonner'

interface LibraryAsset {
  id: string
  name: string
  type: string
  url: string
  thumbUrl: string | null
  category: string
}

export function PromptInput() {
  const prompt = useWorkspaceStore((s) => s.prompt)
  const setPrompt = useWorkspaceStore((s) => s.setPrompt)
  const assets = useWorkspaceStore((s) => s.assets)
  const addAsset = useWorkspaceStore((s) => s.addAsset)
  const updateAsset = useWorkspaceStore((s) => s.updateAsset)
  const insertRef = useWorkspaceStore((s) => s.insertAssetReference)

  const [showPanel, setShowPanel] = useState(false)
  const [libraryAssets, setLibraryAssets] = useState<LibraryAsset[]>([])
  const [searchKeyword, setSearchKeyword] = useState('')
  const [loadingLibrary, setLoadingLibrary] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 加载资产库
  const loadLibrary = useCallback(async (keyword = '') => {
    setLoadingLibrary(true)
    try {
      const params = keyword ? `?keyword=${encodeURIComponent(keyword)}` : ''
      const res = await fetch(`/api/workspace/assets${params}`)
      if (res.ok) {
        const data = await res.json()
        setLibraryAssets(data.items || [])
      }
    } catch { /* 不阻塞 */ }
    finally { setLoadingLibrary(false) }
  }, [])

  // @ 触发时加载资产库
  useEffect(() => {
    if (showPanel) loadLibrary()
  }, [showPanel, loadLibrary])

  // 点击外部关闭
  useEffect(() => {
    if (!showPanel) return
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setShowPanel(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showPanel])

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    setPrompt(value)
    // 检测 @
    const cursorPos = e.target.selectionStart || 0
    if (value[cursorPos - 1] === '@') {
      setShowPanel(true)
    }
  }, [setPrompt])

  const handleSelectAsset = useCallback((assetName: string) => {
    const cursorPos = textareaRef.current?.selectionStart || prompt.length
    // 移除刚输入的 @
    const beforeAt = prompt.slice(0, cursorPos - 1)
    const afterAt = prompt.slice(cursorPos)
    setPrompt(beforeAt + afterAt)
    insertRef(cursorPos - 1, assetName)
    setShowPanel(false)
    textareaRef.current?.focus()
  }, [prompt, setPrompt, insertRef])

  // 在面板内上传
  const handlePanelUpload = useCallback(async (files: FileList) => {
    for (const file of Array.from(files)) {
      const validation = validateFile(file.name, file.type, file.size)
      if (!validation.valid) { toast.error(validation.reason); continue }

      const tempId = `asset-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      addAsset({ id: tempId, fileName: file.name, fileSize: file.size, type: validation.type, mimeType: file.type, ossUrl: '', uploadProgress: 0, status: 'uploading' })

      try {
        const formData = new FormData()
        formData.append('file', file)
        const res = await fetch('/api/workspace/upload', { method: 'POST', body: formData })
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || '上传失败')
        const data = await res.json()
        updateAsset(tempId, { ossUrl: data.url, thumbUrl: data.thumbUrl, uploadProgress: 100, status: 'uploaded' })
      } catch (error) {
        toast.error(`${file.name}: ${error instanceof Error ? error.message : '上传失败'}`)
        updateAsset(tempId, { status: 'failed' })
      }
    }
  }, [addAsset, updateAsset])

  const uploadedAssets = assets.filter((a) => a.status === 'uploaded')

  return (
    <div className="flex-1 relative">
      <textarea
        ref={textareaRef}
        value={prompt}
        onChange={handleChange}
        placeholder="输入视频描述，输入 @ 引用素材。例如：模仿 @参考视频1 的镜头运动，角色参考 @角色1"
        className="w-full min-h-[60px] bg-transparent border-none outline-none text-sm text-[var(--cine-text)] placeholder:text-[var(--cine-text-3)] resize-none leading-relaxed"
      />

      {/* @ 素材选择面板 */}
      {showPanel && (
        <div ref={panelRef} className="absolute top-full left-0 mt-2 w-80 max-h-[360px] rounded-xl border border-[var(--cine-line-2)] bg-[var(--cine-surface)] shadow-xl z-50 overflow-hidden flex flex-col">
          {/* 搜索栏 + 关闭 */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--cine-line-2)]">
            <Search className="w-3.5 h-3.5 text-[var(--cine-text-3)] shrink-0" />
            <input
              type="text"
              value={searchKeyword}
              onChange={(e) => { setSearchKeyword(e.target.value); loadLibrary(e.target.value) }}
              placeholder="搜索素材..."
              className="flex-1 bg-transparent text-xs text-[var(--cine-text)] outline-none placeholder:text-[var(--cine-text-3)]"
              autoFocus
            />
            <button onClick={() => setShowPanel(false)} className="text-[var(--cine-text-3)] hover:text-[var(--cine-text)]">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* 滚动内容 */}
          <div className="flex-1 overflow-y-auto">
            {/* 当前上传的素材 */}
            {uploadedAssets.length > 0 && (
              <div className="px-3 pt-2">
                <div className="text-[10px] text-[var(--cine-text-3)] uppercase tracking-wider mb-1.5">当前上传</div>
                {uploadedAssets.map((asset) => (
                  <AssetRow
                    key={asset.id}
                    name={asset.fileName}
                    type={asset.type}
                    thumbUrl={asset.thumbUrl}
                    onClick={() => handleSelectAsset(asset.fileName)}
                  />
                ))}
              </div>
            )}

            {/* 资产库素材 */}
            <div className="px-3 pt-2 pb-2">
              <div className="text-[10px] text-[var(--cine-text-3)] uppercase tracking-wider mb-1.5">资产库</div>
              {loadingLibrary ? (
                <div className="text-[11px] text-[var(--cine-text-3)] py-3 text-center">加载中...</div>
              ) : libraryAssets.length > 0 ? (
                libraryAssets.map((item) => (
                  <AssetRow
                    key={item.id}
                    name={item.name}
                    type={item.type}
                    thumbUrl={item.thumbUrl}
                    category={item.category}
                    onClick={() => handleSelectAsset(item.name)}
                  />
                ))
              ) : (
                <div className="text-[11px] text-[var(--cine-text-3)] py-3 text-center">
                  {searchKeyword ? '无匹配素材' : '资产库为空'}
                </div>
              )}
            </div>
          </div>

          {/* 底部上传入口 */}
          <div className="border-t border-[var(--cine-line-2)] px-3 py-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg border border-dashed border-[var(--cine-line-2)] text-[11px] text-[var(--cine-text-3)] hover:border-[var(--cine-gold)] hover:text-[var(--cine-gold)] transition-colors"
            >
              <Upload className="w-3 h-3" />
              上传新素材
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm,audio/mpeg,audio/wav,audio/aac"
              onChange={(e) => { if (e.target.files?.length) { handlePanelUpload(e.target.files); e.target.value = '' } }}
              className="hidden"
            />
          </div>
        </div>
      )}
    </div>
  )
}

/** 素材行 */
function AssetRow({ name, type, thumbUrl, category, onClick }: {
  name: string; type: string; thumbUrl?: string | null; category?: string; onClick: () => void
}) {
  // 图片类资产没有 thumbUrl 时用 url 也可以展示（如果 url 是可访问的）
  const displayThumb = thumbUrl || null

  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-left hover:bg-[var(--cine-gold)]/5 transition-colors mb-0.5"
    >
      {/* 缩略图 */}
      <div className="w-7 h-7 shrink-0 rounded-md overflow-hidden border border-[var(--cine-line-2)] bg-[var(--cine-surface)]">
        {displayThumb ? (
          <img src={displayThumb} alt={name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[10px]">
            {type.includes('image') || type === 'CHARACTER_IMAGE' || type === 'UPLOADED_IMAGE' ? '🖼' : type.includes('video') ? '🎬' : '🎵'}
          </div>
        )}
      </div>
      {/* 名称 */}
      <div className="flex-1 min-w-0">
        <div className="text-[11px] text-[var(--cine-text)] truncate">{name}</div>
        {category && <div className="text-[9px] text-[var(--cine-text-3)]">{category}</div>}
      </div>
    </button>
  )
}
