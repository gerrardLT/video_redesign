'use client'

/**
 * 全局一致性设定编辑器（结构化分字段）
 * 分类展示：美术风格、色调、角色设定（数组）、字幕声明、额外说明
 * 每个字段独立编辑，自动保存
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { Palette, ChevronDown, ChevronUp, Check, Loader2, Plus, Trash2 } from 'lucide-react'

interface StyleCharacter {
  name: string
  appearance: string
  props?: string
}

interface StructuredStyle {
  artStyle: string
  colorTone: string
  characters: StyleCharacter[]
  subtitleDeclaration?: string
  extra?: string
}

interface StyleConfigEditorProps {
  projectId: string
  /** 结构化数据（优先使用） */
  initialStructured: StructuredStyle | null
  /** 扁平文本回退（当 structured 为 null 时显示为纯文本） */
  initialDescription: string | null
  editable?: boolean
}

export function StyleConfigEditor({
  projectId,
  initialStructured,
  initialDescription,
  editable = true,
}: StyleConfigEditorProps) {
  const [expanded, setExpanded] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 结构化状态：优先使用已有结构化数据，否则尝试从 customDescription 拆分迁移
  const [style, setStyle] = useState<StructuredStyle>(() => {
    if (initialStructured) return initialStructured

    // 老数据迁移：尝试从扁平 customDescription 拆分到各字段
    if (initialDescription) {
      return migrateFromDescription(initialDescription)
    }

    return { artStyle: '', colorTone: '', characters: [], subtitleDeclaration: '', extra: '' }
  })

  // debounce 自动保存
  const debouncedSave = useCallback(
    (data: StructuredStyle) => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
      saveTimeoutRef.current = setTimeout(async () => {
        setSaving(true)
        setError(null)
        try {
          const res = await fetch(`/api/projects/${projectId}/style`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
          })
          if (!res.ok) {
            const d = await res.json()
            throw new Error(d.error || '保存失败')
          }
          setSaved(true)
          setTimeout(() => setSaved(false), 2000)
        } catch (err) {
          setError(err instanceof Error ? err.message : '保存失败')
        } finally {
          setSaving(false)
        }
      }, 1500)
    },
    [projectId]
  )

  const updateField = useCallback(
    (field: keyof StructuredStyle, value: string | StyleCharacter[]) => {
      setStyle((prev) => {
        const next = { ...prev, [field]: value }
        if (editable) debouncedSave(next)
        return next
      })
    },
    [editable, debouncedSave]
  )

  // 角色操作
  const addCharacter = useCallback(() => {
    setStyle((prev) => {
      const next = { ...prev, characters: [...prev.characters, { name: '', appearance: '' }] }
      if (editable) debouncedSave(next)
      return next
    })
  }, [editable, debouncedSave])

  const removeCharacter = useCallback(
    (index: number) => {
      setStyle((prev) => {
        const next = { ...prev, characters: prev.characters.filter((_, i) => i !== index) }
        if (editable) debouncedSave(next)
        return next
      })
    },
    [editable, debouncedSave]
  )

  const updateCharacter = useCallback(
    (index: number, field: keyof StyleCharacter, value: string) => {
      setStyle((prev) => {
        const chars = [...prev.characters]
        chars[index] = { ...chars[index], [field]: value }
        const next = { ...prev, characters: chars }
        if (editable) debouncedSave(next)
        return next
      })
    },
    [editable, debouncedSave]
  )

  useEffect(() => {
    return () => { if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current) }
  }, [])

  const isEmpty = !style.artStyle && !style.colorTone && style.characters.length === 0

  return (
    <div id="style-section" className="rounded-xl border border-[var(--cine-line-2)] bg-[var(--cine-surface)] overflow-hidden">
      {/* 标题栏 */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-[var(--cine-surface)] transition-colors"
      >
        <Palette className="h-4 w-4 text-[var(--cine-gold)] shrink-0" />
        <span className="text-sm font-medium text-white">全局一致性设定</span>
        {isEmpty && <span className="ml-2 text-xs text-[var(--cine-amber)]">未设置</span>}
        {saving && <Loader2 className="ml-auto h-3.5 w-3.5 text-[var(--cine-text-3)] animate-spin" />}
        {saved && !saving && (
          <span className="ml-auto flex items-center gap-1 text-xs text-[var(--cine-green)]">
            <Check className="h-3 w-3" /> 已保存
          </span>
        )}
        {!saving && !saved && (
          expanded ? <ChevronUp className="ml-auto h-4 w-4 text-[var(--cine-text-3)]" /> : <ChevronDown className="ml-auto h-4 w-4 text-[var(--cine-text-3)]" />
        )}
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3">
          <p className="text-xs text-[var(--cine-text-3)]">
            AI 解析自动提取，生成时所有分镜组共用。重复描述会自动去重。
          </p>

          {/* 美术风格 */}
          <FieldRow label="美术风格">
            <input
              value={style.artStyle}
              onChange={(e) => updateField('artStyle', e.target.value)}
              disabled={!editable}
              placeholder="如：写实3D风格"
              className="w-full rounded-lg border border-[var(--cine-line-2)] bg-[var(--cine-bg-soft)] px-3 py-1.5 text-sm text-[var(--cine-text)] placeholder-[var(--cine-text-3)] focus:border-[var(--cine-gold)] focus:outline-none disabled:opacity-50"
            />
          </FieldRow>

          {/* 色调 */}
          <FieldRow label="色调">
            <input
              value={style.colorTone}
              onChange={(e) => updateField('colorTone', e.target.value)}
              disabled={!editable}
              placeholder="如：暖色调偏橙、冷色调偏蓝"
              className="w-full rounded-lg border border-[var(--cine-line-2)] bg-[var(--cine-bg-soft)] px-3 py-1.5 text-sm text-[var(--cine-text)] placeholder-[var(--cine-text-3)] focus:border-[var(--cine-gold)] focus:outline-none disabled:opacity-50"
            />
          </FieldRow>

          {/* 角色设定 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-[var(--cine-text-2)]">角色设定</span>
              {editable && (
                <button onClick={addCharacter} className="flex items-center gap-1 text-xs text-[var(--cine-gold)] hover:text-[var(--cine-gold-2)]">
                  <Plus className="h-3 w-3" /> 添加角色
                </button>
              )}
            </div>
            {style.characters.map((char, i) => (
              <div key={i} className="flex gap-2 items-start">
                <input
                  value={char.name}
                  onChange={(e) => updateCharacter(i, 'name', e.target.value)}
                  disabled={!editable}
                  placeholder="角色名"
                  className="w-[80px] shrink-0 rounded-lg border border-[var(--cine-line-2)] bg-[var(--cine-bg-soft)] px-2 py-1.5 text-xs text-[var(--cine-text)] placeholder-[var(--cine-text-3)] focus:border-[var(--cine-gold)] focus:outline-none disabled:opacity-50"
                />
                <input
                  value={char.appearance}
                  onChange={(e) => updateCharacter(i, 'appearance', e.target.value)}
                  disabled={!editable}
                  placeholder="外貌描述"
                  className="flex-1 rounded-lg border border-[var(--cine-line-2)] bg-[var(--cine-bg-soft)] px-2 py-1.5 text-xs text-[var(--cine-text)] placeholder-[var(--cine-text-3)] focus:border-[var(--cine-gold)] focus:outline-none disabled:opacity-50"
                />
                <input
                  value={char.props || ''}
                  onChange={(e) => updateCharacter(i, 'props', e.target.value)}
                  disabled={!editable}
                  placeholder="道具（可选）"
                  className="w-[100px] shrink-0 rounded-lg border border-[var(--cine-line-2)] bg-[var(--cine-bg-soft)] px-2 py-1.5 text-xs text-[var(--cine-text)] placeholder-[var(--cine-text-3)] focus:border-[var(--cine-gold)] focus:outline-none disabled:opacity-50"
                />
                {editable && (
                  <button onClick={() => removeCharacter(i)} className="p-1 text-[var(--cine-text-3)] hover:text-[var(--cine-red)]">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
            {style.characters.length === 0 && (
              <p className="text-xs text-[var(--cine-text-3)] italic">暂无角色设定</p>
            )}
          </div>

          {/* 字幕声明 */}
          <FieldRow label="字幕声明">
            <input
              value={style.subtitleDeclaration || ''}
              onChange={(e) => updateField('subtitleDeclaration', e.target.value)}
              disabled={!editable}
              placeholder="如：无字幕、中文字幕"
              className="w-full rounded-lg border border-[var(--cine-line-2)] bg-[var(--cine-bg-soft)] px-3 py-1.5 text-sm text-[var(--cine-text)] placeholder-[var(--cine-text-3)] focus:border-[var(--cine-gold)] focus:outline-none disabled:opacity-50"
            />
          </FieldRow>

          {/* 额外说明 */}
          <FieldRow label="额外说明">
            <textarea
              value={style.extra || ''}
              onChange={(e) => updateField('extra', e.target.value)}
              disabled={!editable}
              placeholder="其他需要所有分镜组统一遵守的约束..."
              rows={2}
              className="w-full resize-y rounded-lg border border-[var(--cine-line-2)] bg-[var(--cine-bg-soft)] px-3 py-1.5 text-sm text-[var(--cine-text)] placeholder-[var(--cine-text-3)] focus:border-[var(--cine-gold)] focus:outline-none disabled:opacity-50"
            />
          </FieldRow>

          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>
      )}
    </div>
  )
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <span className="text-xs text-[var(--cine-text-2)]">{label}</span>
      {children}
    </div>
  )
}

/**
 * 从扁平 customDescription 尝试拆分到结构化字段（老数据迁移）
 * parse-video 写入的格式："{artStyle}。{colorTone}。{subtitleDeclaration}。{角色A}：{外貌}；{角色B}：{外貌}"
 * 按句号分段，识别含「：」的段为角色设定，其余按顺序分配到 artStyle/colorTone/subtitleDeclaration
 */
function migrateFromDescription(desc: string): StructuredStyle {
  const segments = desc.split(/[。]/).map(s => s.trim()).filter(Boolean)
  const characters: StyleCharacter[] = []
  const otherSegments: string[] = []

  for (const seg of segments) {
    // 含分号分隔的多角色段（小明：短发少年；小红：长发女生）
    if (seg.includes('：') && seg.includes('；')) {
      const charParts = seg.split('；')
      for (const part of charParts) {
        const char = parseCharacterSegment(part)
        if (char) characters.push(char)
        else otherSegments.push(part)
      }
    } else if (seg.includes('：')) {
      // 单角色段（小明：短发少年，背包）
      const char = parseCharacterSegment(seg)
      if (char) characters.push(char)
      else otherSegments.push(seg)
    } else {
      otherSegments.push(seg)
    }
  }

  // 按顺序分配非角色段
  const artStyle = otherSegments[0] || ''
  const colorTone = otherSegments[1] || ''
  const subtitleDeclaration = otherSegments[2] || ''
  const extra = otherSegments.slice(3).join('。')

  return { artStyle, colorTone, characters, subtitleDeclaration, extra }
}

function parseCharacterSegment(seg: string): StyleCharacter | null {
  const colonIdx = seg.indexOf('：')
  if (colonIdx <= 0 || colonIdx > 8) return null // 角色名应在 8 字内

  const name = seg.substring(0, colonIdx).trim()
  const rest = seg.substring(colonIdx + 1).trim()

  // 尝试分离道具（最后一个逗号后的内容若短于 10 字当道具）
  const lastComma = rest.lastIndexOf('，')
  if (lastComma > 0 && rest.length - lastComma <= 10) {
    return {
      name,
      appearance: rest.substring(0, lastComma).trim(),
      props: rest.substring(lastComma + 1).trim(),
    }
  }

  return { name, appearance: rest }
}
