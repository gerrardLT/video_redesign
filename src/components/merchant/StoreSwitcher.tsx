'use client'

/**
 * 门店切换器（StoreSwitcher）—— 多门店快速切换（需求 10.1, 10.2, 10.4）
 *
 * 挂载于商家主框架顶部 Header 门店名处。行为：
 * - 仅当 /api/stores/switcher 返回 multiStore=true（会员权益 maxStores>1 且实际拥有多店）时
 *   才渲染切换器；单店 / 无多店权益时返回 null，隐藏不展示空壳（需求 10.4 / Property 34）。
 * - 点击门店名打开门店列表弹窗，选择目标门店后：
 *   1. POST /api/stores/switch 将统一作用域键 currentStoreId 切到目标门店；
 *   2. 在「保持当前功能上下文」的前提下加载目标门店数据（需求 10.2）：
 *      将当前路由路径中的 storeId 段替换为目标门店 ID，停留在同一功能页
 *      （如在日历页切换则跳到目标门店的日历页），而非跳回首页。
 *
 * 纯前端组件，数据来自后端已就绪的 GET /api/stores/switcher 与 POST /api/stores/switch。
 *
 * Requirements: 10.1, 10.2, 10.4
 */

import { useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import useSWR from 'swr'
import { ChevronDown, Check, Loader2, Store } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toast } from 'sonner'

// ========================
// 数据获取
// ========================

const fetcher = async (url: string) => {
  const res = await fetch(url)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: '请求失败' } }))
    throw new Error(err.error?.message || '请求失败')
  }
  return res.json()
}

// ========================
// 类型（对应后端 cross-store-service.StoreSwitcher）
// ========================

type SwitcherData =
  | { multiStore: false }
  | { multiStore: true; stores: { storeId: string; name: string }[] }

interface StoreSwitcherProps {
  /** 当前所选门店 ID（取自路由），用于高亮当前项与做路径段替换 */
  currentStoreId: string | null
  /** 当前门店名称（回退展示，切换器隐藏时由父组件直接展示门店名） */
  storeName: string
}

/**
 * 将当前路径中的 storeId 段替换为目标门店 ID，保持当前功能上下文（需求 10.2）。
 * 形如 /merchant/stores/{old}/calendar → /merchant/stores/{new}/calendar；
 * 若当前路径非门店作用域路由，则回退到目标门店首页。
 */
function buildTargetPath(pathname: string, fromStoreId: string | null, toStoreId: string): string {
  if (fromStoreId && pathname.includes(`/merchant/stores/${fromStoreId}`)) {
    return pathname.replace(
      `/merchant/stores/${fromStoreId}`,
      `/merchant/stores/${toStoreId}`
    )
  }
  return `/merchant/stores/${toStoreId}`
}

// ========================
// 组件
// ========================

export function StoreSwitcher({ currentStoreId, storeName }: StoreSwitcherProps) {
  const router = useRouter()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [switching, setSwitching] = useState<string | null>(null)

  // 门店切换器数据：失败不阻塞布局（隐藏切换器即可）
  const { data } = useSWR<SwitcherData>('/api/stores/switcher', fetcher, {
    revalidateOnFocus: false,
  })

  // 单店 / 无多店权益 / 数据未就绪 → 隐藏切换器，不展示空壳（需求 10.4）
  if (!data || data.multiStore !== true) {
    return null
  }

  const stores = data.stores

  /** 切换到目标门店：统一作用域键 + 保持当前功能上下文跳转 */
  async function handleSwitch(toStoreId: string) {
    // 已是当前门店：仅关闭弹窗
    if (toStoreId === currentStoreId) {
      setOpen(false)
      return
    }
    setSwitching(toStoreId)
    try {
      const res = await fetch('/api/stores/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId: toStoreId }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(json?.error?.message || '切换门店失败')
        return
      }
      setOpen(false)
      // 保持当前功能上下文，加载目标门店数据（需求 10.2）
      router.push(buildTargetPath(pathname, currentStoreId, toStoreId))
    } catch {
      toast.error('网络错误，请重试')
    } finally {
      setSwitching(null)
    }
  }

  return (
    <>
      {/* 触发按钮：展示当前门店名 + 下拉箭头 */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1 max-w-[55%] rounded-full px-2 py-1 -ml-2 text-amber-900 hover:bg-amber-100 transition-colors"
        aria-label="切换门店"
      >
        <span className="text-lg font-semibold truncate">{storeName}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-amber-600" />
      </button>

      {/* 门店选择弹窗 */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-900">
              <Store className="h-4 w-4 text-amber-600" />
              切换门店
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            {stores.map((s) => {
              const isCurrent = s.storeId === currentStoreId
              const isSwitching = switching === s.storeId
              return (
                <button
                  key={s.storeId}
                  type="button"
                  onClick={() => handleSwitch(s.storeId)}
                  disabled={switching !== null}
                  className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left transition-colors disabled:opacity-60 ${
                    isCurrent
                      ? 'border-amber-300 bg-amber-50'
                      : 'border-gray-100 hover:border-amber-200 hover:bg-amber-50/40'
                  }`}
                >
                  <span className="truncate font-medium text-gray-800">{s.name}</span>
                  {isSwitching ? (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-amber-500" />
                  ) : isCurrent ? (
                    <Check className="h-4 w-4 shrink-0 text-amber-600" />
                  ) : null}
                </button>
              )
            })}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
