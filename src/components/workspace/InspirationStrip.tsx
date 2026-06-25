'use client'

/**
 * 灵感模板横向滚动组件
 *
 * 展示预设 prompt 模板（≥6 个），点击填入 PromptInput。
 */

import { useWorkspaceStore } from '@/stores/workspace-store'
import { INSPIRATION_TEMPLATES } from '@/constants/workspace'

export function InspirationStrip() {
  const setPrompt = useWorkspaceStore((s) => s.setPrompt)

  const handleClick = (text: string) => {
    setPrompt(text)
  }

  return (
    <section className="px-4 sm:px-8 pb-6">
      <div className="max-w-[720px] mx-auto">
        <div className="flex gap-2 overflow-x-auto pb-2">
          {INSPIRATION_TEMPLATES.map((template) => (
            <button
              key={template.id}
              onClick={() => handleClick(template.text)}
              className="flex-shrink-0 px-4 py-2.5 rounded-lg border border-[var(--cine-line-2)] bg-[var(--cine-surface)] text-xs text-[var(--cine-text-2)] hover:border-[var(--cine-gold)] hover:text-[var(--cine-text)] transition-all min-w-[200px] max-w-[280px]"
              title={template.text}
            >
              {template.tag && (
                <span className="text-[var(--cine-gold)] mr-1">#{template.tag}</span>
              )}
              <span className="line-clamp-2">{template.text}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}
