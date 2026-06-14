'use client'

import { useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { ALLOWED_VIDEO_TYPES, MAX_VIDEO_SIZE, MAX_VIDEO_DURATION } from '@/lib/validators/file-validator'

type UploadState = 'idle' | 'validating' | 'uploading' | 'completing' | 'done' | 'error'

export default function NewProjectPage() {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [projectName, setProjectName] = useState('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [videoDuration, setVideoDuration] = useState<number>(0)
  const [uploadState, setUploadState] = useState<UploadState>('idle')
  const [uploadProgress, setUploadProgress] = useState(0)
  const [error, setError] = useState('')
  const [isDragOver, setIsDragOver] = useState(false)

  // 验证视频文件
  const validateFile = useCallback((file: File): Promise<number> => {
    return new Promise((resolve, reject) => {
      // 检查文件类型
      if (!ALLOWED_VIDEO_TYPES.includes(file.type as typeof ALLOWED_VIDEO_TYPES[number])) {
        reject(new Error('仅支持 mp4、mov、webm 格式'))
        return
      }

      // 检查文件大小
      if (file.size > MAX_VIDEO_SIZE) {
        reject(new Error('文件大小不能超过 300MB'))
        return
      }

      // 获取视频时长
      const video = document.createElement('video')
      video.preload = 'metadata'
      video.onloadedmetadata = () => {
        URL.revokeObjectURL(video.src)
        if (video.duration > MAX_VIDEO_DURATION) {
          reject(new Error('视频时长不能超过 2 分钟'))
          return
        }
        resolve(video.duration)
      }
      video.onerror = () => {
        URL.revokeObjectURL(video.src)
        reject(new Error('无法读取视频信息'))
      }
      video.src = URL.createObjectURL(file)
    })
  }, [])

  // 处理文件选择
  const handleFileSelect = useCallback(async (file: File) => {
    setError('')
    setUploadState('validating')

    try {
      const duration = await validateFile(file)
      setSelectedFile(file)
      setVideoDuration(duration)
      setUploadState('idle')
    } catch (err) {
      setError(err instanceof Error ? err.message : '文件验证失败')
      setUploadState('error')
      setSelectedFile(null)
    }
  }, [validateFile])

  // 拖放处理
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFileSelect(file)
  }, [handleFileSelect])

  // 提交创建项目
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedFile || !projectName.trim()) return

    setError('')
    setUploadState('uploading')
    setUploadProgress(0)

    try {
      // 1. 创建项目
      const createRes = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: projectName.trim(),
          videoFileName: selectedFile.name,
          videoFileSize: selectedFile.size,
          videoDuration,
          mimeType: selectedFile.type,
        }),
      })

      if (!createRes.ok) {
        const data = await createRes.json()
        throw new Error(data.error || '创建项目失败')
      }

      const { project } = await createRes.json()

      // 2. 上传文件
      const formData = new FormData()
      formData.append('file', selectedFile)
      formData.append('projectId', project.id)

      const xhr = new XMLHttpRequest()
      const uploadResult = await new Promise<string>((resolve, reject) => {
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            setUploadProgress(Math.round((e.loaded / e.total) * 100))
          }
        }
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(xhr.responseText)
          } else {
            try {
              const data = JSON.parse(xhr.responseText)
              reject(new Error(data.error || '上传失败'))
            } catch {
              reject(new Error('上传失败'))
            }
          }
        }
        xhr.onerror = () => reject(new Error('网络错误'))
        xhr.open('POST', '/api/upload')
        xhr.send(formData)
      })

      const uploadData = JSON.parse(uploadResult)

      // 3. 确认上传并触发解析
      setUploadState('completing')
      const completeRes = await fetch(`/api/projects/${project.id}/upload-complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoUrl: uploadData.url,          // OSS 公网 URL（存入 DB）
          localUrl: uploadData.localUrl,     // 本地路径（供 parse-video FFmpeg 使用）
        }),
      })

      if (!completeRes.ok) {
        const data = await completeRes.json()
        throw new Error(data.error || '确认上传失败')
      }

      setUploadState('done')

      // 跳转到项目详情
      setTimeout(() => {
        router.push(`/dashboard/project/${project.id}`)
      }, 1500)
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败')
      setUploadState('error')
    }
  }

  const isSubmitDisabled =
    !projectName.trim() ||
    !selectedFile ||
    uploadState === 'uploading' ||
    uploadState === 'completing' ||
    uploadState === 'done'

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="mb-8 text-2xl font-bold text-white">新建项目</h1>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* 错误提示 */}
        {error && (
          <div className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        {/* 项目名称 */}
        <div className="space-y-2">
          <label htmlFor="projectName" className="text-sm font-medium text-[var(--cine-text)]">
            项目名称
          </label>
          <input
            id="projectName"
            type="text"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder="给项目起个名字"
            required
            maxLength={100}
            className="w-full rounded-lg border border-[var(--cine-line-2)] bg-[var(--cine-surface)] px-4 py-2.5 text-white placeholder:text-[var(--cine-text-3)] focus:border-[var(--cine-gold)] focus:outline-none focus:ring-1 focus:ring-[var(--cine-gold)]"
          />
        </div>

        {/* 视频上传区域 */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-[var(--cine-text)]">上传视频</label>

          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
              isDragOver
                ? 'border-[var(--cine-gold)] bg-[var(--cine-gold)]/5'
                : selectedFile
                  ? 'border-[var(--cine-green)]/30 bg-[var(--cine-green-dim)]'
                  : 'border-[var(--cine-line-2)] bg-[var(--cine-surface)] hover:border-white/20'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="video/mp4,video/quicktime,video/webm"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) handleFileSelect(file)
              }}
              className="hidden"
            />

            {selectedFile ? (
              <div className="space-y-2">
                <svg
                  className="mx-auto h-10 w-10 text-[var(--cine-green)]"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <p className="text-sm font-medium text-white">{selectedFile.name}</p>
                <p className="text-xs text-[var(--cine-text-3)]">
                  {(selectedFile.size / 1024 / 1024).toFixed(1)} MB · {videoDuration.toFixed(1)} 秒
                </p>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    setSelectedFile(null)
                    setUploadState('idle')
                  }}
                  className="text-xs text-[var(--cine-text-3)] underline hover:text-[var(--cine-text-2)]"
                >
                  重新选择
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <svg
                  className="mx-auto h-12 w-12 text-[var(--cine-text-3)]"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                  />
                </svg>
                <p className="text-sm text-[var(--cine-text-2)]">拖拽文件到此处，或点击选择</p>
              </div>
            )}
          </div>

          {/* 格式限制提示 */}
          <div className="flex flex-wrap gap-3 text-xs text-[var(--cine-text-3)]">
            <span>格式: MP4、MOV、WebM</span>
            <span>·</span>
            <span>大小: 最大 300MB</span>
            <span>·</span>
            <span>时长: 最长 2 分钟</span>
          </div>
        </div>

        {/* 上传进度 */}
        {(uploadState === 'uploading' || uploadState === 'completing' || uploadState === 'done') && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-[var(--cine-text-2)]">
                {uploadState === 'uploading' && '上传中...'}
                {uploadState === 'completing' && '解析中...'}
                {uploadState === 'done' && '完成！正在跳转...'}
              </span>
              {uploadState === 'uploading' && (
                <span className="text-[var(--cine-text)]">{uploadProgress}%</span>
              )}
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-[var(--cine-surface)]">
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  uploadState === 'done' ? 'bg-green-500' : 'bg-[var(--cine-gold)]'
                }`}
                style={{
                  width:
                    uploadState === 'uploading'
                      ? `${uploadProgress}%`
                      : '100%',
                }}
              />
            </div>
          </div>
        )}

        {/* 提交按钮 */}
        <button
          type="submit"
          disabled={isSubmitDisabled}
          className="w-full rounded-lg bg-[var(--cine-gold)] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[var(--cine-gold-2)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {uploadState === 'uploading'
            ? '上传中...'
            : uploadState === 'completing'
              ? '解析中...'
              : uploadState === 'done'
                ? '完成'
                : '创建项目并上传'}
        </button>
      </form>
    </div>
  )
}
