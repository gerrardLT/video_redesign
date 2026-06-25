'use client'

/**
 * 门店设置页 — /merchant/stores/[storeId]/settings
 *
 * 门店信息编辑和优惠管理页面：
 * - 门店基本信息编辑（PUT /api/stores/{storeId}）
 * - 优惠活动管理（CRUD /api/stores/{storeId}/offers）
 * - 使用 StoreUpdateSchema 验证
 * - 暖色调、大圆角
 *
 * Requirements: 2.1, 15.1
 */

import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import useSWR, { mutate } from 'swr'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Badge } from '@/components/ui/badge'
import { Save, Plus, Trash2, ArrowLeft } from 'lucide-react'

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
// 类型
// ========================

interface StoreData {
  id: string
  name: string
  industry: string
  city: string | null
  district: string | null
  businessArea: string | null
  address: string | null
  avgTicket: number | null
  openingHours: string | null
  mainProducts: string[]
  mainSellingPoints: string[]
  targetCustomers: string[] | null
  canShootKitchen: boolean
  canShootStaff: boolean
  canShootCustomers: boolean
  hasGroupBuying: boolean
  hasReservation: boolean
  notes: string | null
}

interface OfferData {
  id: string
  name: string
  description: string | null
  originalPrice: number | null
  salePrice: number | null
  sellingPoints: string[] | null
  usageRules: string | null
  isActive: boolean
}

// ========================
// 门店信息编辑组件
// ========================

function StoreInfoForm({ store, storeId }: { store: StoreData; storeId: string }) {
  const [form, setForm] = useState({
    name: store.name,
    city: store.city || '',
    district: store.district || '',
    businessArea: store.businessArea || '',
    address: store.address || '',
    avgTicket: store.avgTicket?.toString() || '',
    openingHours: store.openingHours || '',
    mainProducts: (store.mainProducts || []).join('、'),
    mainSellingPoints: (store.mainSellingPoints || []).join('、'),
  })
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const handleSave = async () => {
    setSaving(true)
    setMessage(null)
    try {
      const payload: Record<string, unknown> = {
        name: form.name || undefined,
        city: form.city || undefined,
        district: form.district || undefined,
        businessArea: form.businessArea || undefined,
        address: form.address || undefined,
        avgTicket: form.avgTicket ? parseInt(form.avgTicket, 10) : undefined,
        openingHours: form.openingHours || undefined,
        mainProducts: form.mainProducts
          ? form.mainProducts.split(/[、,，]/).map(s => s.trim()).filter(Boolean)
          : undefined,
        mainSellingPoints: form.mainSellingPoints
          ? form.mainSellingPoints.split(/[、,，]/).map(s => s.trim()).filter(Boolean)
          : undefined,
      }

      const res = await fetch(`/api/stores/${storeId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: { message: '保存失败' } }))
        throw new Error(err.error?.message || '保存失败')
      }

      setMessage('门店信息已保存')
      mutate(`/api/stores/${storeId}`)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="border-amber-100 rounded-2xl">
      <CardHeader>
        <CardTitle className="text-amber-900">门店基本信息</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700">门店名称</label>
          <Input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="rounded-xl border-amber-200 focus:ring-orange-300"
            placeholder="门店名称"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">城市</label>
            <Input
              value={form.city}
              onChange={(e) => setForm({ ...form, city: e.target.value })}
              className="rounded-xl border-amber-200"
              placeholder="城市"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">区/县</label>
            <Input
              value={form.district}
              onChange={(e) => setForm({ ...form, district: e.target.value })}
              className="rounded-xl border-amber-200"
              placeholder="区/县"
            />
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700">商圈</label>
          <Input
            value={form.businessArea}
            onChange={(e) => setForm({ ...form, businessArea: e.target.value })}
            className="rounded-xl border-amber-200"
            placeholder="商圈名称"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700">详细地址</label>
          <Input
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
            className="rounded-xl border-amber-200"
            placeholder="详细地址"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">人均消费（分）</label>
            <Input
              type="number"
              value={form.avgTicket}
              onChange={(e) => setForm({ ...form, avgTicket: e.target.value })}
              className="rounded-xl border-amber-200"
              placeholder="如 3500 表示 35 元"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">营业时间</label>
            <Input
              value={form.openingHours}
              onChange={(e) => setForm({ ...form, openingHours: e.target.value })}
              className="rounded-xl border-amber-200"
              placeholder="如 10:00-22:00"
            />
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700">主打产品（顿号分隔）</label>
          <Input
            value={form.mainProducts}
            onChange={(e) => setForm({ ...form, mainProducts: e.target.value })}
            className="rounded-xl border-amber-200"
            placeholder="招牌菜1、招牌菜2"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700">核心卖点（顿号分隔）</label>
          <Input
            value={form.mainSellingPoints}
            onChange={(e) => setForm({ ...form, mainSellingPoints: e.target.value })}
            className="rounded-xl border-amber-200"
            placeholder="卖点1、卖点2"
          />
        </div>

        {/* 保存 */}
        {message && (
          <p className={`text-sm ${message.includes('失败') ? 'text-red-600' : 'text-green-600'}`}>
            {message}
          </p>
        )}
        <Button
          onClick={handleSave}
          disabled={saving}
          className="w-full bg-orange-600 hover:bg-orange-700 text-white rounded-xl"
        >
          {saving ? <Spinner size="sm" /> : <Save className="h-4 w-4 mr-1" />}
          保存门店信息
        </Button>
      </CardContent>
    </Card>
  )
}

// ========================
// 优惠管理组件
// ========================

function OffersManagement({ storeId }: { storeId: string }) {
  const { data, isLoading } = useSWR(`/api/stores/${storeId}/offers?all=true`, fetcher)
  const [showAdd, setShowAdd] = useState(false)
  const [newOffer, setNewOffer] = useState({ name: '', originalPrice: '', salePrice: '', description: '' })
  const [creating, setCreating] = useState(false)

  const offers: OfferData[] = data?.offers || []

  const handleCreate = async () => {
    if (!newOffer.name.trim()) return
    setCreating(true)
    try {
      const payload: Record<string, unknown> = {
        name: newOffer.name.trim(),
        description: newOffer.description || undefined,
        originalPrice: newOffer.originalPrice ? parseInt(newOffer.originalPrice, 10) : undefined,
        salePrice: newOffer.salePrice ? parseInt(newOffer.salePrice, 10) : undefined,
      }

      const res = await fetch(`/api/stores/${storeId}/offers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: { message: '创建失败' } }))
        throw new Error(err.error?.message || '创建失败')
      }

      // 重置并刷新
      setNewOffer({ name: '', originalPrice: '', salePrice: '', description: '' })
      setShowAdd(false)
      mutate(`/api/stores/${storeId}/offers?all=true`)
    } catch (err) {
      alert(err instanceof Error ? err.message : '创建优惠失败')
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (offerId: string) => {
    if (!confirm('确定要删除该优惠吗？')) return
    try {
      const res = await fetch(`/api/stores/${storeId}/offers/${offerId}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        throw new Error('删除失败')
      }
      mutate(`/api/stores/${storeId}/offers?all=true`)
    } catch (err) {
      alert(err instanceof Error ? err.message : '删除失败')
    }
  }

  return (
    <Card className="border-amber-100 rounded-2xl">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-amber-900">优惠活动管理</CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowAdd(!showAdd)}
            className="border-orange-200 text-orange-700 hover:bg-orange-50 rounded-xl"
          >
            <Plus className="h-4 w-4 mr-1" />
            新增
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* 新增优惠表单 */}
        {showAdd && (
          <div className="space-y-3 p-3 bg-orange-50 rounded-xl border border-orange-100">
            <Input
              value={newOffer.name}
              onChange={(e) => setNewOffer({ ...newOffer, name: e.target.value })}
              className="rounded-xl border-orange-200"
              placeholder="优惠名称（如: 双人套餐）"
            />
            <div className="grid grid-cols-2 gap-2">
              <Input
                type="number"
                value={newOffer.originalPrice}
                onChange={(e) => setNewOffer({ ...newOffer, originalPrice: e.target.value })}
                className="rounded-xl border-orange-200"
                placeholder="原价（分）"
              />
              <Input
                type="number"
                value={newOffer.salePrice}
                onChange={(e) => setNewOffer({ ...newOffer, salePrice: e.target.value })}
                className="rounded-xl border-orange-200"
                placeholder="售价（分）"
              />
            </div>
            <Input
              value={newOffer.description}
              onChange={(e) => setNewOffer({ ...newOffer, description: e.target.value })}
              className="rounded-xl border-orange-200"
              placeholder="描述（可选）"
            />
            <Button
              onClick={handleCreate}
              disabled={creating || !newOffer.name.trim()}
              className="w-full bg-orange-600 hover:bg-orange-700 text-white rounded-xl"
            >
              {creating ? <Spinner size="sm" /> : '创建优惠'}
            </Button>
          </div>
        )}

        {/* 优惠列表 */}
        {isLoading ? (
          <div className="flex justify-center py-4">
            <Spinner size="sm" />
          </div>
        ) : offers.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-4">暂无优惠活动</p>
        ) : (
          <div className="space-y-2">
            {offers.map((offer) => (
              <div
                key={offer.id}
                className="flex items-center justify-between p-3 bg-white border border-amber-100 rounded-xl"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-800 truncate">{offer.name}</span>
                    {!offer.isActive && (
                      <Badge variant="secondary" className="text-xs bg-gray-100 text-gray-500">
                        已停用
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-1 text-sm text-gray-500">
                    {offer.originalPrice !== null && (
                      <span className="line-through">¥{(offer.originalPrice / 100).toFixed(0)}</span>
                    )}
                    {offer.salePrice !== null && (
                      <span className="text-orange-600 font-medium">¥{(offer.salePrice / 100).toFixed(0)}</span>
                    )}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDelete(offer.id)}
                  className="text-gray-400 hover:text-red-500"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ========================
// 主页面
// ========================

export default function StoreSettingsPage() {
  const params = useParams()
  const router = useRouter()
  const storeId = params.storeId as string

  const { data, isLoading, error } = useSWR(
    storeId ? `/api/stores/${storeId}` : null,
    fetcher,
    { revalidateOnFocus: false }
  )

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Spinner size="lg" />
      </div>
    )
  }

  if (error || !data?.store) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[40vh] space-y-3">
        <p className="text-gray-500">{error?.message || '门店不存在'}</p>
        <Button variant="outline" onClick={() => router.back()} className="rounded-xl">
          返回
        </Button>
      </div>
    )
  }

  const store: StoreData = data.store

  return (
    <div className="max-w-lg mx-auto space-y-4">
      {/* 顶部导航 */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push(`/merchant/stores/${storeId}`)}
          className="text-amber-700 hover:bg-amber-100 rounded-xl"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          返回
        </Button>
        <h2 className="text-xl font-bold text-amber-900">门店设置</h2>
      </div>

      {/* 门店信息编辑 */}
      <StoreInfoForm store={store} storeId={storeId} />

      {/* 优惠管理 */}
      <OffersManagement storeId={storeId} />
    </div>
  )
}
