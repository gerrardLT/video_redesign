'use client'

/**
 * 商家问诊表单页 — /merchant/onboarding
 *
 * 多步骤向导表单（3 步）：
 * 1. 门店基本信息（名称、行业、地址、营业时间、客单价）
 * 2. 产品与卖点（主打产品列表、核心卖点、拍摄能力）
 * 3. 优惠活动（可选，可跳过）
 *
 * 手机端优先的响应式布局，v3 禅意编辑式 UI（serif 标题 + 暖奶油纯色底 + 3px 圆角 + 大地绿主色），使用日常用语。
 * 行业选择器的 emoji 属数据展示场景，按 Req 2.3 保留；标题/按钮的装饰性 emoji 已移除。
 *
 * Requirements: 1.1, 1.3, 14.1, 14.2, 15.2, 15.3
 */

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { MerchantOnboardingSchema } from '@/lib/validations/merchant'
import type { MerchantIndustry } from '@/types/merchant'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/shared/utils'

// ========================
// 行业选项（带 emoji 图标的网格按钮）
// ========================

const INDUSTRY_OPTIONS: { value: MerchantIndustry; emoji: string; label: string }[] = [
  { value: 'RESTAURANT', emoji: '🍲', label: '中餐' },
  { value: 'DRINK', emoji: '🧋', label: '饮品' },
  { value: 'BAKERY', emoji: '🍰', label: '烘焙' },
  { value: 'CAFE', emoji: '☕', label: '咖啡' },
  { value: 'HOTPOT', emoji: '🫕', label: '火锅' },
  { value: 'BBQ', emoji: '🍢', label: '烧烤' },
  { value: 'FAST_FOOD', emoji: '🍔', label: '快餐' },
  { value: 'OTHER_LOCAL', emoji: '🏪', label: '其他' },
]

// ========================
// 表单数据结构
// ========================

interface FormData {
  merchantName: string
  store: {
    name: string
    industry: MerchantIndustry | ''
    city: string
    district: string
    address: string
    openingHours: string
    avgTicket: string
  }
  products: string[]
  sellingPoints: string[]
  canShootKitchen: boolean
  canShootStaff: boolean
  canShootCustomers: boolean
  offers: Array<{
    name: string
    originalPrice: string
    salePrice: string
    description: string
  }>
}

const initialFormData: FormData = {
  merchantName: '',
  store: {
    name: '',
    industry: '',
    city: '',
    district: '',
    address: '',
    openingHours: '',
    avgTicket: '',
  },
  products: [],
  sellingPoints: [],
  canShootKitchen: false,
  canShootStaff: true,
  canShootCustomers: false,
  offers: [],
}

// ========================
// 主组件
// ========================

export default function OnboardingPage() {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [formData, setFormData] = useState<FormData>(initialFormData)
  const [submitting, setSubmitting] = useState(false)
  // 临时输入状态（用于 Tag 输入）
  const [productInput, setProductInput] = useState('')
  const [sellingPointInput, setSellingPointInput] = useState('')

  // 步骤切换
  const goNext = useCallback(() => setStep((s) => Math.min(s + 1, 3)), [])
  const goBack = useCallback(() => setStep((s) => Math.max(s - 1, 1)), [])

  // 添加/删除 Tag（产品和卖点）
  const addProduct = useCallback(() => {
    const val = productInput.trim()
    if (!val) return
    if (val.length > 30) {
      toast.error('产品名最多 30 个字')
      return
    }
    if (formData.products.length >= 20) {
      toast.error('最多添加 20 个产品')
      return
    }
    if (formData.products.includes(val)) {
      toast.error('已添加过这个产品')
      return
    }
    setFormData((d) => ({ ...d, products: [...d.products, val] }))
    setProductInput('')
  }, [productInput, formData.products])

  const removeProduct = useCallback((idx: number) => {
    setFormData((d) => ({
      ...d,
      products: d.products.filter((_, i) => i !== idx),
    }))
  }, [])

  const addSellingPoint = useCallback(() => {
    const val = sellingPointInput.trim()
    if (!val) return
    if (val.length > 50) {
      toast.error('卖点最多 50 个字')
      return
    }
    if (formData.sellingPoints.length >= 10) {
      toast.error('最多添加 10 个卖点')
      return
    }
    setFormData((d) => ({ ...d, sellingPoints: [...d.sellingPoints, val] }))
    setSellingPointInput('')
  }, [sellingPointInput, formData.sellingPoints])

  const removeSellingPoint = useCallback((idx: number) => {
    setFormData((d) => ({
      ...d,
      sellingPoints: d.sellingPoints.filter((_, i) => i !== idx),
    }))
  }, [])

  // 优惠活动管理
  const addOffer = useCallback(() => {
    setFormData((d) => ({
      ...d,
      offers: [...d.offers, { name: '', originalPrice: '', salePrice: '', description: '' }],
    }))
  }, [])

  const removeOffer = useCallback((idx: number) => {
    setFormData((d) => ({
      ...d,
      offers: d.offers.filter((_, i) => i !== idx),
    }))
  }, [])

  const updateOffer = useCallback((idx: number, field: string, value: string) => {
    setFormData((d) => ({
      ...d,
      offers: d.offers.map((o, i) => (i === idx ? { ...o, [field]: value } : o)),
    }))
  }, [])

  // 步骤验证
  const validateStep = useCallback((currentStep: number): boolean => {
    if (currentStep === 1) {
      if (!formData.merchantName.trim()) {
        toast.error('请填写店铺名称')
        return false
      }
      if (!formData.store.industry) {
        toast.error('请选择行业类型')
        return false
      }
    }
    if (currentStep === 2) {
      if (formData.products.length === 0) {
        toast.error('请至少添加 1 个主打产品')
        return false
      }
      if (formData.sellingPoints.length === 0) {
        toast.error('请至少添加 1 个核心卖点')
        return false
      }
    }
    return true
  }, [formData])

  const handleNext = useCallback(() => {
    if (validateStep(step)) {
      goNext()
    }
  }, [step, validateStep, goNext])

  // 提交表单
  const handleSubmit = useCallback(async () => {
    setSubmitting(true)
    try {
      // 构建提交数据
      const submitData = {
        merchantName: formData.merchantName.trim(),
        store: {
          name: formData.merchantName.trim(), // 商家名称默认同门店名称
          industry: formData.store.industry as MerchantIndustry,
          city: formData.store.city || undefined,
          district: formData.store.district || undefined,
          address: formData.store.address || undefined,
          openingHours: formData.store.openingHours || undefined,
          avgTicket: formData.store.avgTicket
            ? Math.round(parseFloat(formData.store.avgTicket) * 100)
            : undefined,
          mainProducts: formData.products,
          mainSellingPoints: formData.sellingPoints,
          canShootKitchen: formData.canShootKitchen,
          canShootStaff: formData.canShootStaff,
          canShootCustomers: formData.canShootCustomers,
        },
        offers: formData.offers
          .filter((o) => o.name.trim())
          .map((o) => ({
            name: o.name.trim(),
            description: o.description || undefined,
            originalPrice: o.originalPrice
              ? Math.round(parseFloat(o.originalPrice) * 100)
              : undefined,
            salePrice: o.salePrice
              ? Math.round(parseFloat(o.salePrice) * 100)
              : undefined,
          })),
      }

      // 前端 Zod 校验
      const result = MerchantOnboardingSchema.safeParse(submitData)
      if (!result.success) {
        const firstError = result.error.issues[0]
        toast.error(firstError?.message || '请检查填写内容')
        return
      }

      // 提交到后端
      const res = await fetch('/api/merchant/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(submitData),
      })

      if (!res.ok) {
        const errData = await res.json().catch(() => null)
        if (res.status === 409) {
          toast.error('您已完成过问诊，无需重复填写')
          return
        }
        const msg = errData?.error || '提交失败，请稍后重试'
        toast.error(msg)
        return
      }

      const data = await res.json()
      toast.success('提交成功！正在为您生成营销方案...')
      router.push(`/merchant/stores/${data.storeId}`)
    } catch (err) {
      console.error('[onboarding] 提交错误:', err)
      toast.error('网络错误，请检查网络连接后重试')
    } finally {
      setSubmitting(false)
    }
  }, [formData, router])

  return (
    <div className="min-h-screen bg-[var(--ll-canvas)]">
      {/* 顶部进度条 — v3 Zen: 暖奶油半透明磨砂 + 2px 细线进度 + Space Grotesk 步数 */}
      <div className="sticky top-0 z-10 bg-[var(--ll-surface)]/90 backdrop-blur-sm border-b border-[var(--ll-hair)]">
        <div className="max-w-lg mx-auto px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-[var(--ll-green-sb)] font-medium">
              {step === 1 && '第 1 步：门店信息'}
              {step === 2 && '第 2 步：产品与卖点'}
              {step === 3 && '第 3 步：优惠活动'}
            </span>
            <span className="text-xs text-[var(--ll-text-3)] font-[var(--font-num)] tabular-nums">{step} / 3</span>
          </div>
          <div className="h-[2px] bg-[var(--ll-hair)] rounded-[1px] overflow-hidden">
            <div
              className="h-full bg-[var(--ll-green)] rounded-[1px]"
              style={{
                width: `${(step / 3) * 100}%`,
                transitionProperty: 'width',
                transitionDuration: '600ms',
                transitionTimingFunction: 'var(--ease-out)',
              }}
            />
          </div>
        </div>
      </div>

      {/* 表单主体 */}
      <div className="max-w-lg mx-auto px-4 py-6 pb-28">
        {/* 步骤 1：门店基本信息 */}
        {step === 1 && (
          <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
            <div>
              <h1 className="text-[29px] font-semibold text-[var(--ll-text)] font-[var(--font-serif)] leading-[1.38]">
                欢迎入驻
              </h1>
              <p className="mt-1 text-base text-[var(--ll-text-2)]">
                填写门店基本信息，我们帮您策划短视频内容
              </p>
            </div>

            {/* 门店名称 */}
            <div className="space-y-2">
              <label className="text-base font-medium text-gray-800">
                店铺名称 <span className="text-red-500">*</span>
              </label>
              <Input
                placeholder="例如：老王家重庆小面"
                value={formData.merchantName}
                onChange={(e) =>
                  setFormData((d) => ({ ...d, merchantName: e.target.value }))
                }
                className="h-12 text-base rounded-xl border-orange-200 focus-visible:border-orange-400 focus-visible:ring-orange-200"
                maxLength={50}
              />
            </div>

            {/* 行业选择 — 网格按钮 */}
            <div className="space-y-2">
              <label className="text-base font-medium text-gray-800">
                行业类型 <span className="text-red-500">*</span>
              </label>
              <div className="grid grid-cols-4 gap-2">
                {INDUSTRY_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() =>
                      setFormData((d) => ({
                        ...d,
                        store: { ...d.store, industry: opt.value },
                      }))
                    }
                    className={cn(
                      'flex flex-col items-center justify-center gap-1 p-3 rounded-xl border-2 transition-all text-center',
                      formData.store.industry === opt.value
                        ? 'border-orange-500 bg-orange-50 shadow-sm'
                        : 'border-gray-200 bg-white hover:border-orange-300 hover:bg-orange-50/50'
                    )}
                  >
                    <span className="text-2xl">{opt.emoji}</span>
                    <span className="text-xs font-medium text-gray-700">
                      {opt.label}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* 地址信息 */}
            <div className="space-y-2">
              <label className="text-base font-medium text-gray-800">
                门店地址
              </label>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  placeholder="城市"
                  value={formData.store.city}
                  onChange={(e) =>
                    setFormData((d) => ({
                      ...d,
                      store: { ...d.store, city: e.target.value },
                    }))
                  }
                  className="h-11 text-base rounded-xl border-orange-200 focus-visible:border-orange-400 focus-visible:ring-orange-200"
                  maxLength={20}
                />
                <Input
                  placeholder="区/县"
                  value={formData.store.district}
                  onChange={(e) =>
                    setFormData((d) => ({
                      ...d,
                      store: { ...d.store, district: e.target.value },
                    }))
                  }
                  className="h-11 text-base rounded-xl border-orange-200 focus-visible:border-orange-400 focus-visible:ring-orange-200"
                  maxLength={20}
                />
              </div>
              <Input
                placeholder="详细地址（选填）"
                value={formData.store.address}
                onChange={(e) =>
                  setFormData((d) => ({
                    ...d,
                    store: { ...d.store, address: e.target.value },
                  }))
                }
                className="h-11 text-base rounded-xl border-orange-200 focus-visible:border-orange-400 focus-visible:ring-orange-200"
                maxLength={100}
              />
            </div>

            {/* 营业时间 & 客单价 */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">
                  营业时间
                </label>
                <Input
                  placeholder="如 10:00-22:00"
                  value={formData.store.openingHours}
                  onChange={(e) =>
                    setFormData((d) => ({
                      ...d,
                      store: { ...d.store, openingHours: e.target.value },
                    }))
                  }
                  className="h-11 text-base rounded-xl border-orange-200 focus-visible:border-orange-400 focus-visible:ring-orange-200"
                  maxLength={50}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">
                  人均消费（元）
                </label>
                <Input
                  type="number"
                  placeholder="如 35"
                  value={formData.store.avgTicket}
                  onChange={(e) =>
                    setFormData((d) => ({
                      ...d,
                      store: { ...d.store, avgTicket: e.target.value },
                    }))
                  }
                  className="h-11 text-base rounded-xl border-orange-200 focus-visible:border-orange-400 focus-visible:ring-orange-200"
                  min={0}
                />
              </div>
            </div>
          </div>
        )}

        {/* 步骤 2：产品与卖点 */}
        {step === 2 && (
          <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
            <div>
              <h1 className="text-[29px] font-semibold text-[var(--ll-text)] font-[var(--font-serif)] leading-[1.38]">
                产品与卖点
              </h1>
              <p className="mt-1 text-base text-[var(--ll-text-2)]">
                告诉我们您的主打产品和核心优势
              </p>
            </div>

            {/* 主打产品（Tag 方式） */}
            <div className="space-y-2">
              <label className="text-base font-medium text-gray-800">
                主打产品 <span className="text-red-500">*</span>
              </label>
              <p className="text-sm text-gray-500">
                添加您的招牌菜品或主推产品（至少 1 个）
              </p>
              <div className="flex gap-2">
                <Input
                  placeholder="输入产品名，按回车添加"
                  value={productInput}
                  onChange={(e) => setProductInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      addProduct()
                    }
                  }}
                  className="h-11 flex-1 text-base rounded-xl border-orange-200 focus-visible:border-orange-400 focus-visible:ring-orange-200"
                  maxLength={30}
                />
                <Button
                  type="button"
                  onClick={addProduct}
                  className="h-11 px-4 rounded-xl bg-orange-500 hover:bg-orange-600 text-white"
                >
                  添加
                </Button>
              </div>

              {/* 已添加的产品标签 */}
              {formData.products.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {formData.products.map((p, idx) => (
                    <span
                      key={idx}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-orange-100 text-orange-800 text-sm font-medium"
                    >
                      {p}
                      <button
                        type="button"
                        onClick={() => removeProduct(idx)}
                        className="ml-1 text-orange-500 hover:text-orange-700 text-lg leading-none"
                        aria-label={`删除 ${p}`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* 核心卖点（Tag 方式） */}
            <div className="space-y-2">
              <label className="text-base font-medium text-gray-800">
                核心卖点 <span className="text-red-500">*</span>
              </label>
              <p className="text-sm text-gray-500">
                您店铺的独特优势是什么？（至少 1 个）
              </p>
              <div className="flex gap-2">
                <Input
                  placeholder="如：现熬骨汤、手工现做"
                  value={sellingPointInput}
                  onChange={(e) => setSellingPointInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      addSellingPoint()
                    }
                  }}
                  className="h-11 flex-1 text-base rounded-xl border-orange-200 focus-visible:border-orange-400 focus-visible:ring-orange-200"
                  maxLength={50}
                />
                <Button
                  type="button"
                  onClick={addSellingPoint}
                  className="h-11 px-4 rounded-xl bg-orange-500 hover:bg-orange-600 text-white"
                >
                  添加
                </Button>
              </div>
              {formData.sellingPoints.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {formData.sellingPoints.map((sp, idx) => (
                    <span
                      key={idx}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-amber-100 text-amber-800 text-sm font-medium"
                    >
                      {sp}
                      <button
                        type="button"
                        onClick={() => removeSellingPoint(idx)}
                        className="ml-1 text-amber-500 hover:text-amber-700 text-lg leading-none"
                        aria-label={`删除 ${sp}`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* 拍摄能力 */}
            <div className="space-y-3">
              <label className="text-base font-medium text-gray-800">
                拍摄条件
              </label>
              <p className="text-sm text-gray-500">
                选择您方便拍摄的场景（我们会据此推荐视频方案）
              </p>
              <div className="space-y-2">
                {[
                  { key: 'canShootKitchen', label: '🍳 可以拍厨房/制作过程' },
                  { key: 'canShootStaff', label: '👨‍🍳 可以拍员工/老板' },
                  { key: 'canShootCustomers', label: '👥 可以拍顾客反应' },
                ].map(({ key, label }) => (
                  <label
                    key={key}
                    className={cn(
                      'flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all',
                      formData[key as keyof FormData]
                        ? 'border-orange-400 bg-orange-50'
                        : 'border-gray-200 bg-white hover:border-orange-200'
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={formData[key as keyof FormData] as boolean}
                      onChange={(e) =>
                        setFormData((d) => ({ ...d, [key]: e.target.checked }))
                      }
                      className="w-5 h-5 rounded border-gray-300 text-orange-500 focus:ring-orange-500"
                    />
                    <span className="text-base text-gray-700">{label}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* 步骤 3：优惠活动（可选，可跳过） */}
        {step === 3 && (
          <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
            <div>
              <h1 className="text-[29px] font-semibold text-[var(--ll-text)] font-[var(--font-serif)] leading-[1.38]">
                优惠活动
              </h1>
              <p className="mt-1 text-base text-[var(--ll-text-2)]">
                添加正在进行的活动或套餐，没有也可以跳过
              </p>
            </div>

            {/* 已添加的优惠 */}
            {formData.offers.map((offer, idx) => (
              <Card key={idx} className="border-orange-200 bg-white">
                <CardContent className="space-y-3 pt-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-orange-700">
                      优惠 {idx + 1}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeOffer(idx)}
                      className="text-sm text-red-500 hover:text-red-700"
                    >
                      删除
                    </button>
                  </div>
                  <Input
                    placeholder="活动名称，如：双人套餐"
                    value={offer.name}
                    onChange={(e) => updateOffer(idx, 'name', e.target.value)}
                    className="h-11 text-base rounded-xl border-orange-200 focus-visible:border-orange-400 focus-visible:ring-orange-200"
                    maxLength={30}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      type="number"
                      placeholder="原价（元）"
                      value={offer.originalPrice}
                      onChange={(e) =>
                        updateOffer(idx, 'originalPrice', e.target.value)
                      }
                      className="h-11 text-base rounded-xl border-orange-200 focus-visible:border-orange-400 focus-visible:ring-orange-200"
                      min={0}
                    />
                    <Input
                      type="number"
                      placeholder="优惠价（元）"
                      value={offer.salePrice}
                      onChange={(e) =>
                        updateOffer(idx, 'salePrice', e.target.value)
                      }
                      className="h-11 text-base rounded-xl border-orange-200 focus-visible:border-orange-400 focus-visible:ring-orange-200"
                      min={0}
                    />
                  </div>

                  <Input
                    placeholder="简单描述一下这个活动（选填）"
                    value={offer.description}
                    onChange={(e) =>
                      updateOffer(idx, 'description', e.target.value)
                    }
                    className="h-11 text-base rounded-xl border-orange-200 focus-visible:border-orange-400 focus-visible:ring-orange-200"
                    maxLength={200}
                  />
                </CardContent>
              </Card>
            ))}

            {/* 添加优惠按钮 */}
            {formData.offers.length < 20 && (
              <button
                type="button"
                onClick={addOffer}
                className="w-full p-4 rounded-xl border-2 border-dashed border-orange-300 text-orange-600 hover:bg-orange-50 transition-colors text-base font-medium"
              >
                + 添加一个优惠活动
              </button>
            )}

            {formData.offers.length === 0 && (
              <div className="text-center py-6">
                <p className="text-gray-400 text-sm">
                  没有正在进行的活动？可以直接提交
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 底部固定操作栏 — v3 Zen: 暖奶油磨砂 + 发丝线 + 大地绿主按钮 */}
      <div className="fixed bottom-0 left-0 right-0 bg-[var(--ll-surface)]/95 backdrop-blur-sm border-t border-[var(--ll-hair)] px-4 py-4 safe-area-pb">
        <div className="max-w-lg mx-auto flex gap-3">
          {step > 1 && (
            <Button
              type="button"
              variant="outline"
              onClick={goBack}
              className="h-12 flex-1 rounded-[3px] border-[var(--ll-hair)] text-[var(--ll-text-2)] hover:bg-[var(--ll-green-light)] text-base"
            >
              上一步
            </Button>
          )}
          {step < 3 ? (
            <Button
              type="button"
              onClick={handleNext}
              className="h-12 flex-1 rounded-[3px] bg-[var(--ll-green)] hover:bg-[var(--ll-green-sb)] active:bg-[var(--ll-green-active)] text-white text-base font-medium tracking-[.04em]"
            >
              下一步
            </Button>
          ) : (
            <Button
              type="button"
              onClick={handleSubmit}
              disabled={submitting}
              className="h-12 flex-1 rounded-[3px] bg-[var(--ll-green)] hover:bg-[var(--ll-green-sb)] active:bg-[var(--ll-green-active)] text-white text-base font-medium tracking-[.04em] disabled:opacity-60"
            >
              {submitting ? '提交中...' : '开始生成方案'}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
