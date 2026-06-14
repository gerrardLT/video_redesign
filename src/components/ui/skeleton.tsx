/**
 * 骨架屏组件
 * 用于内容加载时的占位展示
 */

interface SkeletonProps {
  className?: string
}

export function Skeleton({ className = '' }: SkeletonProps) {
  return (
    <div
      className={`animate-pulse rounded-md bg-[var(--cine-surface)] ${className}`}
      role="status"
      aria-label="内容加载中"
    />
  )
}

/**
 * 预设骨架屏：卡片
 */
export function SkeletonCard() {
  return (
    <div className="rounded-xl border border-[var(--cine-line-2)] bg-[var(--cine-surface)] p-4 space-y-3">
      <Skeleton className="h-40 w-full rounded-lg" />
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-4 w-1/2" />
    </div>
  )
}

/**
 * 预设骨架屏：表格行
 */
export function SkeletonTableRow({ columns = 5 }: { columns?: number }) {
  return (
    <tr>
      {Array.from({ length: columns }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <Skeleton className="h-4 w-full" />
        </td>
      ))}
    </tr>
  )
}
