'use client'

/**
 * 平台账号关联卡片（需求 7.1/7.2/7.7/7.8）
 *
 * 面向小白老板的「自营账号数据自动抓取」关联入口，挂载于门店设置页。
 *
 * 设计红线（遵循 AGENTS.md 与需求 0：真实接口、无 fallback、无伪造、充分告知不诱导）：
 *  - 两阶段授权（对接 POST /api/stores/[storeId]/platform-accounts）：
 *    阶段一仅传 platform → 后端返回 ToS 提示 / 风险点 / 一次性 authToken；
 *    阶段二必须勾选「我已阅读并授权」后才允许填入 cookie 并提交（authConfirmed=true）。
 *  - 关联前充分明示：平台用户协议（ToS）、反爬/风控/封号风险、账号安全；
 *    并明示抓取脆弱性边界（仅抓本人账号、需授权、平台策略变动可能随时中断）。
 *  - 失效（status=NEEDS_RELINK）显著展示「需重新关联」入口。
 *  - 来源冲突（自动/手动）标注由商家决定采用，不静默覆盖：以说明文案明示。
 *  - 手动录入永久兜底：明示自动抓取仅为增强，关联失败不影响手动录入。
 *
 * 数据读取：GET /api/stores/[storeId]/platform-accounts（仅非敏感字段，无凭证密文）。
 */

import { useState } from 'react'
import useSWR, { mutate } from 'swr'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  Link2,
  ShieldAlert,
  AlertTriangle,
  RefreshCw,
  CheckCircle2,
  Info,
  Hand,
} from 'lucide-react'
import type { PublishPlatform } from '@/types/merchant'

// ========================
// 类型
// ========================

/** 后端 GET 返回的非敏感账号字段（绝不含 encryptedCookie） */
interface SafePlatformAccount {
  id: string
  platform: PublishPlatform
  status: 'ACTIVE' | 'NEEDS_RELINK'
  authConfirmed: boolean
  lastCrawledAt: string | null
  crawlIntervalH: number
  createdAt: string
  updatedAt: string
}

/** 阶段一返回：风险告知 + 一次性授权 token */
interface AuthNoticeResponse {
  phase: 'AUTH_NOTICE'
  tosNotice: string
  risks: string[]
  authToken: string
}

/** 支持自动抓取的三平台（需求 7：抖音 / 小红书 / 视频号） */
const SUPPORTED_PLATFORMS: { value: PublishPlatform; label: string }[] = [
  { value: 'DOUYIN', label: '抖音' },
  { value: 'XIAOHONGSHU', label: '小红书' },
  { value: 'WECHAT_CHANNELS', label: '微信视频号' },
]

const PLATFORM_LABELS: Record<string, string> = {
  DOUYIN: '抖音',
  XIAOHONGSHU: '小红书',
  WECHAT_CHANNELS: '微信视频号',
  KUAISHOU: '快手',
  MANUAL_EXPORT: '手动导出',
}

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

/** 抓取间隔/最近抓取时间的友好展示 */
function formatLastCrawled(iso: string | null): string {
  if (!iso) return '尚未抓取'
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// ========================
// 关联向导（两阶段）对话框
// ========================

function LinkWizardDialog({
  storeId,
  open,
  onOpenChange,
  presetPlatform,
}: {
  storeId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 预选平台（用于「需重新关联」直接进入对应平台流程） */
  presetPlatform?: PublishPlatform | null
}) {
  // step1: 选择平台并拉取风险告知；step2: 已展示风险，等待授权确认 + 填凭证
  const [step, setStep] = useState<1 | 2>(1)
  const [platform, setPlatform] = useState<PublishPlatform | null>(presetPlatform ?? null)
  const [notice, setNotice] = useState<AuthNoticeResponse | null>(null)
  const [authConfirmed, setAuthConfirmed] = useState(false)
  const [cookie, setCookie] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const apiUrl = `/api/stores/${storeId}/platform-accounts`

  // 重置向导内部状态（每次关闭/重开都从干净状态开始，避免授权确认态残留）
  const reset = () => {
    setStep(1)
    setPlatform(presetPlatform ?? null)
    setNotice(null)
    setAuthConfirmed(false)
    setCookie('')
    setError(null)
  }

  const handleOpenChange = (next: boolean) => {
    if (!next) reset()
    onOpenChange(next)
  }

  // 阶段一：仅传 platform，拉取 ToS / 风险点 / authToken（此阶段不保存任何凭证）
  const handleRequestNotice = async (p: PublishPlatform) => {
    setPlatform(p)
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: p }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error?.message || '获取授权告知失败')
      setNotice(data as AuthNoticeResponse)
      setStep(2)
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取授权告知失败')
    } finally {
      setLoading(false)
    }
  }

  // 阶段二：勾选授权确认后才允许提交 cookie（authConfirmed=true + authToken 串联）
  const handleSaveCredential = async () => {
    if (!platform || !notice) return
    if (!authConfirmed) {
      setError('请先勾选授权确认')
      return
    }
    if (!cookie.trim()) {
      setError('请粘贴你本人账号的会话凭证（cookie）')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform,
          cookie: cookie.trim(),
          authConfirmed: true,
          authToken: notice.authToken,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error?.message || '保存凭证失败')
      // 关联成功：刷新账号列表并关闭向导
      await mutate(apiUrl)
      handleOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存凭证失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1.5 text-amber-900">
            <Link2 className="h-4 w-4 text-amber-500" />
            关联自营平台账号
          </DialogTitle>
          <DialogDescription>
            登录一次你本人的平台账号，系统就能按受控频率帮你把作品数据抓回来，省去逐条手抄。
          </DialogDescription>
        </DialogHeader>

        {/* 阶段一：选择平台 */}
        {step === 1 && (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">选择要关联的平台：</p>
            <div className="grid grid-cols-3 gap-2">
              {SUPPORTED_PLATFORMS.map((p) => (
                <Button
                  key={p.value}
                  variant={platform === p.value ? 'default' : 'outline'}
                  onClick={() => handleRequestNotice(p.value)}
                  disabled={loading}
                  className={
                    platform === p.value
                      ? 'bg-orange-600 hover:bg-orange-700 text-white rounded-xl'
                      : 'border-amber-200 text-amber-800 hover:bg-amber-50 rounded-xl'
                  }
                >
                  {loading && platform === p.value ? <Spinner size="sm" /> : p.label}
                </Button>
              ))}
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
          </div>
        )}

        {/* 阶段二：风险告知 + 授权确认 + 凭证录入 */}
        {step === 2 && notice && (
          <div className="space-y-4">
            {/* 平台用户协议（ToS）提示 */}
            <div className="rounded-xl bg-amber-50 border border-amber-100 p-3">
              <div className="flex items-center gap-1.5 text-amber-800 text-sm font-medium mb-1">
                <ShieldAlert className="h-4 w-4" />
                关联「{platform ? PLATFORM_LABELS[platform] : ''}」前请知悉
              </div>
              <p className="text-xs text-amber-700 leading-relaxed">{notice.tosNotice}</p>
            </div>

            {/* 风险点列表 */}
            <div className="rounded-xl bg-red-50 border border-red-100 p-3">
              <div className="flex items-center gap-1.5 text-red-700 text-sm font-medium mb-2">
                <AlertTriangle className="h-4 w-4" />
                风险提示（请认真阅读）
              </div>
              <ul className="space-y-1.5">
                {notice.risks.map((risk, i) => (
                  <li key={i} className="flex gap-1.5 text-xs text-red-600 leading-relaxed">
                    <span className="mt-1 h-1 w-1 rounded-full bg-red-400 flex-shrink-0" />
                    <span>{risk}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* 抓取脆弱性边界（需求 7.7） */}
            <div className="rounded-xl bg-blue-50 border border-blue-100 p-3">
              <div className="flex items-center gap-1.5 text-blue-700 text-sm font-medium mb-2">
                <Info className="h-4 w-4" />
                自动抓取的能力边界
              </div>
              <ul className="space-y-1.5 text-xs text-blue-700 leading-relaxed">
                <li>· 仅抓取你本人账号下作品的公开表现数据，不触碰他人数据。</li>
                <li>· 需要你完成账号授权后才能抓取，凭证仅服务端加密存储。</li>
                <li>· 平台策略/反爬调整可能导致抓取随时中断，届时会提示你重新关联。</li>
                <li>· 默认每 24 小时抓取一次（系统最小间隔 6 小时），以降低风控风险。</li>
              </ul>
            </div>

            {/* 授权确认勾选（未勾选不得提交凭证 —— 需求 7.2） */}
            <label className="flex items-start gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={authConfirmed}
                onChange={(e) => setAuthConfirmed(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-amber-300 text-orange-600 focus:ring-orange-300"
              />
              <span className="text-xs text-gray-700 leading-relaxed">
                我已阅读并理解上述平台用户协议、风险提示与能力边界，确认在我本人账号范围内
                授权本平台抓取我的作品数据。
              </span>
            </label>

            {/* 凭证录入：仅在勾选授权确认后启用（不诱导，灰显提示前置条件） */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700">
                粘贴你本人账号的会话凭证（cookie）
              </label>
              <textarea
                value={cookie}
                onChange={(e) => setCookie(e.target.value)}
                disabled={!authConfirmed}
                rows={3}
                placeholder={
                  authConfirmed
                    ? '在你本人已登录的平台网页中复制会话 cookie 后粘贴到此处'
                    : '请先勾选上方授权确认'
                }
                className="w-full rounded-xl border border-amber-200 bg-white p-2 text-xs text-gray-800 focus:outline-none focus:ring-2 focus:ring-orange-300 disabled:bg-gray-50 disabled:text-gray-400"
              />
              <p className="text-[11px] text-gray-400">
                凭证仅服务端加密存储、仅用于抓取你本人账号数据，绝不明文保存或外泄。
              </p>
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setStep(1)
                  setNotice(null)
                  setAuthConfirmed(false)
                  setCookie('')
                  setError(null)
                }}
                disabled={loading}
                className="flex-1 border-amber-200 text-amber-800 hover:bg-amber-50 rounded-xl"
              >
                返回
              </Button>
              <Button
                onClick={handleSaveCredential}
                disabled={loading || !authConfirmed || !cookie.trim()}
                className="flex-1 bg-orange-600 hover:bg-orange-700 text-white rounded-xl"
              >
                {loading ? <Spinner size="sm" /> : '确认关联'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ========================
// 主卡片
// ========================

export function PlatformAccountLinkCard({ storeId }: { storeId: string }) {
  const apiUrl = `/api/stores/${storeId}/platform-accounts`
  const { data, error, isLoading } = useSWR<{ accounts: SafePlatformAccount[] }>(
    apiUrl,
    fetcher,
    { revalidateOnFocus: false }
  )

  const [wizardOpen, setWizardOpen] = useState(false)
  // 「需重新关联」时预选对应平台直接进入向导
  const [presetPlatform, setPresetPlatform] = useState<PublishPlatform | null>(null)

  const accounts = data?.accounts ?? []

  const openWizard = (platform?: PublishPlatform) => {
    setPresetPlatform(platform ?? null)
    setWizardOpen(true)
  }

  return (
    <Card className="border-amber-100 rounded-2xl">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-1.5 text-amber-900">
            <Link2 className="h-4 w-4 text-amber-500" />
            自营账号数据自动抓取
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => openWizard()}
            className="border-orange-200 text-orange-700 hover:bg-orange-50 rounded-xl"
          >
            <Link2 className="h-4 w-4 mr-1" />
            关联账号
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* 能力说明 + 手动录入永久兜底（需求 7.1） */}
        <div className="rounded-xl bg-amber-50/60 border border-amber-100 p-3 text-xs text-gray-600 leading-relaxed">
          关联你本人的平台账号后，系统会按受控频率自动把作品数据抓回来，省去逐条手抄。
          <span className="text-amber-700 font-medium">
            自动抓取仅为增强，手动录入数据始终保留为兜底
          </span>
          ，即使未关联或关联失效，你也可以随时在各作品的「数据」页手动录入。
        </div>

        {/* 已关联账号列表 */}
        {isLoading ? (
          <div className="flex justify-center py-4">
            <Spinner size="sm" />
          </div>
        ) : error ? (
          <p className="text-sm text-red-500">{error.message}</p>
        ) : accounts.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-3">
            尚未关联任何平台账号，点击右上角「关联账号」开始
          </p>
        ) : (
          <div className="space-y-2">
            {accounts.map((acc) => {
              const needsRelink = acc.status === 'NEEDS_RELINK'
              return (
                <div
                  key={acc.id}
                  className={`flex items-center justify-between p-3 rounded-xl border ${
                    needsRelink ? 'bg-red-50/60 border-red-200' : 'bg-white border-amber-100'
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-800">
                        {PLATFORM_LABELS[acc.platform] ?? acc.platform}
                      </span>
                      {needsRelink ? (
                        <Badge variant="secondary" className="text-xs bg-red-100 text-red-600">
                          需重新关联
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="text-xs bg-green-100 text-green-700">
                          <CheckCircle2 className="h-3 w-3 mr-0.5" />
                          正常同步
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      {needsRelink
                        ? '凭证可能已失效或平台策略调整导致抓取中断，请重新关联以恢复同步；在此之前可继续手动录入。'
                        : `最近抓取：${formatLastCrawled(acc.lastCrawledAt)} · 每 ${acc.crawlIntervalH} 小时一次`}
                    </p>
                  </div>
                  {needsRelink && (
                    <Button
                      size="sm"
                      onClick={() => openWizard(acc.platform)}
                      className="bg-red-600 hover:bg-red-700 text-white rounded-xl flex-shrink-0"
                    >
                      <RefreshCw className="h-3.5 w-3.5 mr-1" />
                      需重新关联
                    </Button>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* 来源冲突标注说明（需求 7.8）：自动/手动并存，由商家决定采用，不静默覆盖 */}
        <div className="rounded-xl bg-blue-50/60 border border-blue-100 p-3 text-xs text-blue-700 leading-relaxed">
          <div className="flex items-center gap-1.5 font-medium mb-1">
            <Info className="h-3.5 w-3.5" />
            关于数据来源
          </div>
          自动抓取的数据会标注来源为「自动」，与你手动录入的「手动」数据并列展示、互不覆盖。
          当两者冲突时，由你决定采用哪条，系统不会替你静默替换。
        </div>

        {/* 手动录入兜底强调（需求 7.1） */}
        <div className="flex items-start gap-2 text-xs text-gray-500">
          <Hand className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-amber-400" />
          <span>手动录入永久可用：在任意作品详情页的「数据」入口即可随时手动填写表现数据。</span>
        </div>
      </CardContent>

      {/* 关联向导对话框 */}
      <LinkWizardDialog
        storeId={storeId}
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        presetPlatform={presetPlatform}
      />
    </Card>
  )
}
