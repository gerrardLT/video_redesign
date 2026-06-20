'use client'

import { useState } from 'react'

/**
 * 案例展示页面
 * 按短视频主流分类筛选，暂无实际数据时显示空状态引导
 */

const categories = [
  '全部', '剧情短剧', '搞笑段子', '美食探店', '旅行Vlog',
  '知识科普', '商品种草', '宠物萌宠', '健身运动', '音乐舞蹈',
]

export default function ShowcasePage() {
  const [activeCategory, setActiveCategory] = useState('全部')

  return (
    <div>
      {/* 页面标题 */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">案例展示</h1>
        <p className="mt-2 text-sm text-[var(--cine-text-2)]">
          探索各类短视频创作案例，获取灵感与参考
        </p>
      </div>

      {/* 分类筛选（横向可滚动药丸列表） */}
      <div className="mb-8 -mx-1 overflow-x-auto pb-2" style={{ scrollbarWidth: 'none' }}>
        <div className="flex gap-2 px-1 whitespace-nowrap">
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`
                shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-all duration-200
                ${activeCategory === cat
                  ? 'bg-[var(--cine-gold)] text-[var(--cine-ink)] shadow-[0_0_20px_rgba(199,168,119,0.2)]'
                  : 'border border-[var(--cine-line-2)] bg-[var(--cine-surface)] text-[var(--cine-text-2)] hover:border-[var(--cine-gold)] hover:text-[var(--cine-gold)]'
                }
              `}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* 空状态 */}
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[var(--cine-line-2)] py-24">
        <svg
          className="mb-4 h-16 w-16 text-[var(--cine-text-3)]"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
          />
        </svg>
        <p className="text-lg font-medium text-[var(--cine-text-2)]">
          {activeCategory === '全部' ? '案例即将上线' : `「${activeCategory}」案例即将上线`}
        </p>
        <p className="mt-2 text-sm text-[var(--cine-text-3)]">
          精选案例正在准备中，敬请期待
        </p>
      </div>
    </div>
  )
}
