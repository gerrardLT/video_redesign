'use client'

/**
 * 日历视图 — /merchant/stores/[storeId]/calendar
 *
 * 7 天内容计划可编辑视图（需求 6.1, 6.4, 6.5, 6.6, 6.7）。按自然日分组展示计划区间内的每一天：
 * - 某天的 brief 支持：改期 / 换选题(goal) / 删除（编辑弹窗 + 保存确认，避免误操作）
 * - 某天新增 brief（受单日上界约束，超出时后端返回 409 DAY_LIMIT_EXCEEDED → 友好提示）
 * - 某天锁定 / 跳过 / 恢复（下一轮自动生成尊重该状态，需求 6.5）
 * - 空缺的天如实展示「未安排内容」，不自动填充伪内容（需求 6.7）
 * - 换选题且存在已拍素材时（后端返回 assetWarning），显式提示确认是否重拍（需求 6.4）
 *
 * 调用 API：
 * - GET    /api/stores/{storeId}/content-plan/current  当前计划
 * - POST   /api/stores/{storeId}/content-plan/generate  生成新计划
 * - POST   /api/content-briefs                          新增 brief
 * - PATCH  /api/content-briefs/{briefId}                改期 / 换 goal（返回 assetWarning）
 * - DELETE /api/content-briefs/{briefId}                删除 brief
 * - PUT    /api/stores/{storeId}/calendar/day-lock      锁定 / 跳过 / 恢复某天
 *
 * 说明：锁定/跳过仅有写入端点（无查询端点），故本页以会话内状态反映用户当次操作；
 * 该状态已持久化于后端，并由下一轮自动生成尊重（需求 6.5）。
 *
 * Requirements: 6.1, 6.4, 6.5, 6.6, 6.7
 */

import { useParams, useRouter } from 'next/navigation'
import { useState } from 'react'
import useSWR from 'swr'
import {
  Plus,
  Pencil,
  Trash2,
  Lock,
  LockOpen,
  SkipForward,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { toast } from 'sonner'
import type { ContentGoal } from '@/types/merchant'

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
// 常量映射
// ========================

const GOAL_LABELS: Record<string, string> = {
  TRAFFIC: '午餐引流',
  PROMOTION: '爆品促销',
  NEW_PRODUCT: '招牌新品',
  TRUST_BUILDING: '人设建设',
  BRAND_STORY: '品牌故事',
  CUSTOMER_TESTIMONIAL: '顾客口碑',
  WEEKEND_BOOST: '周末预热',
  REPEAT_PURCHASE: '家庭聚餐',
}

const GOAL_ICONS: Record<string, string> = {
  TRAFFIC: '🚗',
  PROMOTION: '🔥',
  NEW_PRODUCT: '✨',
  TRUST_BUILDING: '🤝',
  BRAND_STORY: '📖',
  CUSTOMER_TESTIMONIAL: '💬',
  WEEKEND_BOOST: '🎉',
  REPEAT_PURCHASE: '💝',
}

/** 可选内容目标（用于换选题/新增的下拉） */
const GOAL_OPTIONS: { value: ContentGoal; label: string }[] = (
  Object.keys(GOAL_LABELS) as ContentGoal[]
).map((value) => ({ value, label: GOAL_LABELS[value] }))

/** 状态 → 中文标签 */
const STATUS_LABELS: Record<string, string> = {
  DRAFT: '草稿',
  READY_TO_SHOOT: '待拍摄',
  MATERIALS_UPLOADED: '已上传',
  RENDERING: '渲染中',
  GENERATED: '已生成',
  COMPLIANCE_REVIEW: '审查中',
  READY_TO_EXPORT: '待导出',
  EXPORTED: '已导出',
  PUBLISHED: '已发布',
  FAILED: '失败',
  ARCHIVED: '已归档',
}

/** 单日内容数量上界（与后端默认一致，前端用于禁用新增按钮） */
const SINGLE_DAY_LIMIT = 3

/** 某天锁定/跳过状态 */
type DayState = 'NORMAL' | 'LOCKED' | 'SKIPPED'

/** 状态 → Badge 样式 */
function getStatusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'READY_TO_SHOOT':
      return 'default'
    case 'MATERIALS_UPLOADED':
    case 'RENDERING':
      return 'secondary'
    case 'GENERATED':
    case 'READY_TO_EXPORT':
    case 'EXPORTED':
    case 'PUBLISHED':
      return 'outline'
    case 'FAILED':
      return 'destructive'
    default:
      return 'secondary'
  }
}

// ========================
// 类型
// ========================

interface ShotTask {
  id: string
  order: number
  type: string
  title: string
  required: boolean
  status: string
}

interface Brief {
  id: string
  title: string
  goal: string
  status: string
  scheduledDate: string
  shotTasks: ShotTask[]
}

interface ContentPlan {
  id: string
  title: string
  startDate: string
  endDate: string
  status: string
  briefs: Brief[]
}

/** 按天分组的桶 */
interface DayBucket {
  key: string // YYYY-MM-DD（本地时区）
  date: Date
  briefs: Brief[]
}

// ========================
// 工具函数
// ========================

/** 判断两个日期是否为同一天（本地时区） */
function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

/** 本地时区日期键 YYYY-MM-DD */
function dateKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 格式化日期为 "X月X日" */
function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

/**
 * 构造按天分组的桶：取计划区间 [startDate, endDate] 内每一天，并并入所有 brief 的实际日期
 * （改期后的 brief 可能落在区间外），保证所有 brief 都可见，空缺天如实展示（需求 6.7）。
 */
function buildDayBuckets(plan: ContentPlan): DayBucket[] {
  const keyToBriefs = new Map<string, Brief[]>()

  // 1) 计划区间内每一天先建立空桶
  const start = new Date(plan.startDate)
  const end = new Date(plan.endDate)
  const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate())
  const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate())
  // 防御：区间异常时至少展示起始日
  let guard = 0
  while (cursor.getTime() <= endDay.getTime() && guard < 366) {
    keyToBriefs.set(dateKey(cursor), [])
    cursor.setDate(cursor.getDate() + 1)
    guard += 1
  }

  // 2) 并入每条 brief（含落在区间外的改期结果）
  for (const brief of plan.briefs) {
    const d = new Date(brief.scheduledDate)
    const key = dateKey(d)
    const list = keyToBriefs.get(key)
    if (list) {
      list.push(brief)
    } else {
      keyToBriefs.set(key, [brief])
    }
  }

  // 3) 按日期升序输出
  return Array.from(keyToBriefs.keys())
    .sort()
    .map((key) => {
      const [y, m, day] = key.split('-').map(Number)
      return {
        key,
        date: new Date(y, m - 1, day),
        briefs: keyToBriefs.get(key)!,
      }
    })
}

// ========================
// 拍摄进度指示器
// ========================

/** 拍摄进度指示器 */
function ShotProgress({ shotTasks }: { shotTasks: ShotTask[] }) {
  const required = shotTasks.filter((s) => s.required)
  const captured = required.filter((s) => s.status === 'CAPTURED')

  if (required.length === 0) return null

  return (
    <div className="flex items-center gap-2">
      <div className="flex gap-0.5">
        {required.map((task) => (
          <div
            key={task.id}
            className={`w-4 h-1.5 rounded-full ${task.status === 'CAPTURED' ? 'bg-green-400' : 'bg-gray-200'}`}
          />
        ))}
      </div>
      <span className="text-[10px] text-gray-400">
        {captured.length}/{required.length}
      </span>
    </div>
  )
}

// ========================
// 编辑 brief 弹窗（改期 / 换选题 / 换剧本）
// ========================

/** 编辑操作类型 */
type EditOp = 'RESCHEDULE' | 'CHANGE_GOAL' | 'CHANGE_PLAYBOOK'

/** 剧本选项（来自 GET /api/stores/[storeId]/playbooks） */
interface PlaybookOption {
  id: string
  name: string
  goal: string
  description: string | null
}

/**
 * 编辑某条 brief 的弹窗：支持改期 / 换选题(goal) / 换剧本(playbook)。
 * 通过「保存」按钮显式确认提交，避免误操作（需求 6.6）。
 * 提交成功后若后端返回 assetWarning（换选题/剧本且已有已拍素材），透传给父级显式提示（需求 6.4）。
 */
function EditBriefDialog({
  storeId,
  brief,
  open,
  onOpenChange,
  onSaved,
}: {
  storeId: string
  brief: Brief | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: (result: { message: string; assetWarning?: string; briefId: string }) => void
}) {
  const [op, setOp] = useState<EditOp>('RESCHEDULE')
  const [newDate, setNewDate] = useState('')
  const [newGoal, setNewGoal] = useState<ContentGoal | ''>('')
  const [newPlaybookId, setNewPlaybookId] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // 仅在选择「换剧本」时按当前选题拉取真实剧本列表
  const { data: playbookData, isLoading: playbooksLoading } = useSWR<{ playbooks: PlaybookOption[] }>(
    open && op === 'CHANGE_PLAYBOOK' && brief
      ? `/api/stores/${storeId}/playbooks?goal=${brief.goal}`
      : null,
    fetcher
  )

  // 弹窗打开时按当前 brief 初始化表单
  function resetForm() {
    if (!brief) return
    setOp('RESCHEDULE')
    // 改期默认填充当前日期（YYYY-MM-DD 本地时区）
    setNewDate(dateKey(new Date(brief.scheduledDate)))
    setNewGoal('')
    setNewPlaybookId('')
  }

  async function handleSubmit() {
    if (!brief) return

    // 按操作类型组装 payload，并做前端必填校验（避免无效请求）
    let payload: Record<string, string> = {}
    if (op === 'RESCHEDULE') {
      if (!newDate) {
        toast.error('请选择新的日期')
        return
      }
      // 转为当天 UTC 零点的 ISO 字符串，避免时区偏移导致跨天
      payload = { newDate: new Date(`${newDate}T00:00:00`).toISOString() }
    } else if (op === 'CHANGE_GOAL') {
      if (!newGoal) {
        toast.error('请选择新的选题方向')
        return
      }
      payload = { newGoal }
    } else if (op === 'CHANGE_PLAYBOOK') {
      if (!newPlaybookId) {
        toast.error('请选择新的剧本')
        return
      }
      payload = { newPlaybookId }
    }

    setSubmitting(true)
    try {
      const res = await fetch(`/api/content-briefs/${brief.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op, payload }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        // 单日上界等显式拒绝：展示后端友好提示
        const code = json?.error?.code
        const msg =
          code === 'DAY_LIMIT_EXCEEDED'
            ? json?.error?.message || '该天内容已达上限'
            : json?.error?.message || '保存失败'
        toast.error(msg)
        return
      }
      onOpenChange(false)
      onSaved({
        message: json.message || '已更新内容任务',
        assetWarning: json.assetWarning,
        briefId: brief.id,
      })
    } catch {
      toast.error('网络错误，请重试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) resetForm()
        onOpenChange(next)
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>编辑内容任务</DialogTitle>
          <DialogDescription>
            {brief ? brief.title : ''}
          </DialogDescription>
        </DialogHeader>

        {/* 操作类型切换（分段按钮） */}
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              { value: 'RESCHEDULE', label: '改期' },
              { value: 'CHANGE_GOAL', label: '换选题' },
              { value: 'CHANGE_PLAYBOOK', label: '换剧本' },
            ] as { value: EditOp; label: string }[]
          ).map((item) => (
            <Button
              key={item.value}
              type="button"
              variant={op === item.value ? 'default' : 'outline'}
              size="sm"
              onClick={() => setOp(item.value)}
            >
              {item.label}
            </Button>
          ))}
        </div>

        {/* 按操作类型渲染表单 */}
        <div className="mt-2 space-y-2">
          {op === 'RESCHEDULE' && (
            <div className="space-y-1.5">
              <span className="text-sm text-gray-600">选择新的拍摄/发布日期</span>
              <Input
                type="date"
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
              />
            </div>
          )}

          {op === 'CHANGE_GOAL' && (
            <div className="space-y-1.5">
              <span className="text-sm text-gray-600">选择新的选题方向</span>
              <Select value={newGoal} onValueChange={(v) => setNewGoal(v as ContentGoal)}>
                <SelectTrigger>
                  <SelectValue placeholder="请选择选题方向" />
                </SelectTrigger>
                <SelectContent>
                  {GOAL_OPTIONS.map((g) => (
                    <SelectItem key={g.value} value={g.value}>
                      {GOAL_ICONS[g.value]} {g.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-gray-400">
                换选题后将基于你的门店画像重新生成镜头脚本与文案草稿
              </p>
            </div>
          )}

          {op === 'CHANGE_PLAYBOOK' && (
            <div className="space-y-1.5">
              <span className="text-sm text-gray-600">选择新的剧本（同选题方向）</span>
              {playbooksLoading ? (
                <div className="flex items-center gap-2 py-2 text-sm text-gray-400">
                  <Spinner className="h-4 w-4" /> 加载剧本中…
                </div>
              ) : playbookData && playbookData.playbooks.length > 0 ? (
                <Select value={newPlaybookId} onValueChange={(v) => setNewPlaybookId(v ?? '')}>
                  <SelectTrigger>
                    <SelectValue placeholder="请选择剧本" />
                  </SelectTrigger>
                  <SelectContent>
                    {playbookData.playbooks.map((pb) => (
                      <SelectItem key={pb.id} value={pb.id}>
                        {pb.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <p className="py-2 text-sm text-gray-400">该选题方向暂无其它可用剧本</p>
              )}
              <p className="text-xs text-gray-400">
                换剧本后将基于你的门店画像重新生成镜头脚本与文案草稿
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? <Spinner className="h-4 w-4" /> : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ========================
// 新增 brief 弹窗
// ========================

/**
 * 为某一天新增一条内容任务：选择选题方向（必填）与剧本（可选）。
 * 「确认新增」显式提交，受单日上界约束（超出后端返回 409 DAY_LIMIT_EXCEEDED）。
 */
function AddBriefDialog({
  storeId,
  date,
  open,
  onOpenChange,
  onAdded,
}: {
  storeId: string
  date: Date | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onAdded: () => void
}) {
  const [goal, setGoal] = useState<ContentGoal | ''>('')
  const [playbookId, setPlaybookId] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // 选择选题方向后按 goal 拉取真实剧本列表（可选指定）
  const { data: playbookData, isLoading: playbooksLoading } = useSWR<{ playbooks: PlaybookOption[] }>(
    open && goal ? `/api/stores/${storeId}/playbooks?goal=${goal}` : null,
    fetcher
  )

  function resetForm() {
    setGoal('')
    setPlaybookId('')
  }

  async function handleSubmit() {
    if (!date) return
    if (!goal) {
      toast.error('请选择选题方向')
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/content-briefs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storeId,
          date: new Date(`${dateKey(date)}T00:00:00`).toISOString(),
          goal,
          ...(playbookId ? { playbookId } : {}),
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        const code = json?.error?.code
        const msg =
          code === 'DAY_LIMIT_EXCEEDED'
            ? json?.error?.message || '该天内容已达上限'
            : json?.error?.message || '新增失败'
        toast.error(msg)
        return
      }
      toast.success('已新增内容任务')
      onOpenChange(false)
      onAdded()
    } catch {
      toast.error('网络错误，请重试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) resetForm()
        onOpenChange(next)
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>新增内容任务</DialogTitle>
          <DialogDescription>
            {date ? `${date.getMonth() + 1}月${date.getDate()}日` : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <span className="text-sm text-gray-600">选题方向</span>
            <Select value={goal} onValueChange={(v) => { setGoal(v as ContentGoal); setPlaybookId('') }}>
              <SelectTrigger>
                <SelectValue placeholder="请选择选题方向" />
              </SelectTrigger>
              <SelectContent>
                {GOAL_OPTIONS.map((g) => (
                  <SelectItem key={g.value} value={g.value}>
                    {GOAL_ICONS[g.value]} {g.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {goal && (
            <div className="space-y-1.5">
              <span className="text-sm text-gray-600">剧本（可选，留空由系统自动选择）</span>
              {playbooksLoading ? (
                <div className="flex items-center gap-2 py-2 text-sm text-gray-400">
                  <Spinner className="h-4 w-4" /> 加载剧本中…
                </div>
              ) : playbookData && playbookData.playbooks.length > 0 ? (
                <Select value={playbookId} onValueChange={(v) => setPlaybookId(v ?? '')}>
                  <SelectTrigger>
                    <SelectValue placeholder="自动选择剧本" />
                  </SelectTrigger>
                  <SelectContent>
                    {playbookData.playbooks.map((pb) => (
                      <SelectItem key={pb.id} value={pb.id}>
                        {pb.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <p className="py-1 text-xs text-gray-400">该选题方向暂无可选剧本，将由系统自动选择</p>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? <Spinner className="h-4 w-4" /> : '确认新增'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ========================
// 单条 brief 行
// ========================

/**
 * 单条内容任务行：展示选题/状态/拍摄进度，并提供编辑与删除入口。
 * 点击主体区域进入 brief 详情页。
 */
function BriefRow({
  storeId,
  brief,
  disabled,
  onEdit,
  onDelete,
}: {
  storeId: string
  brief: Brief
  disabled: boolean
  onEdit: (brief: Brief) => void
  onDelete: (brief: Brief) => void
}) {
  const router = useRouter()

  return (
    <div className="flex items-center gap-3 rounded-xl border border-gray-100 bg-white p-3">
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
        onClick={() => router.push(`/merchant/stores/${storeId}/briefs/${brief.id}`)}
      >
        <span className="text-xl">{GOAL_ICONS[brief.goal] ?? '📋'}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-gray-800">{brief.title}</p>
          <div className="mt-1 flex items-center gap-2">
            <Badge variant="secondary" className="text-[10px]">
              {GOAL_LABELS[brief.goal] ?? brief.goal}
            </Badge>
            <Badge variant={getStatusVariant(brief.status)} className="text-[10px]">
              {STATUS_LABELS[brief.status] ?? brief.status}
            </Badge>
            <ShotProgress shotTasks={brief.shotTasks} />
          </div>
        </div>
      </button>

      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-gray-400 hover:text-gray-700"
          disabled={disabled}
          onClick={() => onEdit(brief)}
          aria-label="编辑"
        >
          <Pencil className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-gray-400 hover:text-red-600"
          disabled={disabled}
          onClick={() => onDelete(brief)}
          aria-label="删除"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

// ========================
// 单天卡片
// ========================

/**
 * 单天卡片：展示该天日期、锁定/跳过状态控制、该天所有 brief，以及新增入口。
 * - 空缺天如实展示「未安排内容」，不自动填充（需求 6.7）
 * - 锁定/跳过状态由下一轮自动生成尊重（需求 6.5）；跳过天禁止新增
 * - 单日 brief 数量达上界时禁用新增按钮（需求 6.2）
 */
function DayCard({
  storeId,
  bucket,
  dayState,
  dayLimit,
  onAdd,
  onEdit,
  onDelete,
  onSetDayState,
}: {
  storeId: string
  bucket: DayBucket
  dayState: DayState
  dayLimit: number
  onAdd: (date: Date) => void
  onEdit: (brief: Brief) => void
  onDelete: (brief: Brief) => void
  onSetDayState: (date: Date, state: DayState) => void
}) {
  const weekday = WEEKDAYS[bucket.date.getDay()]
  const isToday = isSameDay(bucket.date, new Date())
  const atLimit = bucket.briefs.length >= dayLimit
  const isSkipped = dayState === 'SKIPPED'
  const isLocked = dayState === 'LOCKED'
  // 跳过的天禁止新增；锁定/达上界禁用新增按钮
  const addDisabled = isSkipped || atLimit

  return (
    <Card className={isToday ? 'border-orange-300' : ''}>
      <CardContent className="p-4">
        {/* 日期标题行 + 状态控制 */}
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={`text-sm font-semibold ${isToday ? 'text-orange-600' : 'text-gray-800'}`}>
              {bucket.date.getMonth() + 1}月{bucket.date.getDate()}日
            </span>
            <span className="text-xs text-gray-400">{weekday}</span>
            {isToday && (
              <Badge className="bg-orange-100 text-orange-700 text-[10px]">今天</Badge>
            )}
            {isLocked && (
              <Badge variant="outline" className="border-amber-300 text-amber-600 text-[10px]">
                <Lock className="mr-0.5 h-3 w-3" /> 已锁定
              </Badge>
            )}
            {isSkipped && (
              <Badge variant="outline" className="border-gray-300 text-gray-500 text-[10px]">
                <SkipForward className="mr-0.5 h-3 w-3" /> 已跳过
              </Badge>
            )}
          </div>

          {/* 锁定 / 跳过 / 恢复控制 */}
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className={`h-7 w-7 ${isLocked ? 'text-amber-600' : 'text-gray-400'}`}
              onClick={() => onSetDayState(bucket.date, isLocked ? 'NORMAL' : 'LOCKED')}
              aria-label={isLocked ? '解除锁定' : '锁定该天'}
              title={isLocked ? '解除锁定' : '锁定该天（下一轮自动生成不改动）'}
            >
              {isLocked ? <LockOpen className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={`h-7 w-7 ${isSkipped ? 'text-gray-700' : 'text-gray-400'}`}
              onClick={() => onSetDayState(bucket.date, isSkipped ? 'NORMAL' : 'SKIPPED')}
              aria-label={isSkipped ? '取消跳过' : '跳过该天'}
              title={isSkipped ? '取消跳过' : '跳过该天（下一轮自动生成不安排内容）'}
            >
              <SkipForward className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* brief 列表或空缺展示 */}
        {bucket.briefs.length > 0 ? (
          <div className="space-y-2">
            {bucket.briefs.map((brief) => (
              <BriefRow
                key={brief.id}
                storeId={storeId}
                brief={brief}
                disabled={false}
                onEdit={onEdit}
                onDelete={onDelete}
              />
            ))}
          </div>
        ) : (
          // 空缺如实展示，不自动填充伪内容（需求 6.7）
          <div className="rounded-xl border border-dashed border-gray-200 py-4 text-center text-xs text-gray-400">
            {isSkipped ? '本日已跳过，不安排内容' : '未安排内容'}
          </div>
        )}

        {/* 新增入口 */}
        <Button
          variant="outline"
          size="sm"
          className="mt-3 w-full border-dashed text-gray-500"
          disabled={addDisabled}
          onClick={() => onAdd(bucket.date)}
        >
          <Plus className="mr-1 h-4 w-4" />
          {atLimit ? `当日已达上限（${dayLimit}条）` : isSkipped ? '本日已跳过' : '新增内容'}
        </Button>
      </CardContent>
    </Card>
  )
}

// ========================
// 主页面
// ========================

/**
 * 日历计划可编辑主页面。
 *
 * 数据获取：GET /api/stores/{storeId}/content-plan/current → { contentPlan }
 * - 加载中 / 错误 / 暂无计划（404）三态如实展示，不伪造内容（需求 6.7）。
 *
 * 交互闭环：
 * - 编辑（改期/换选题/换剧本）：经 EditBriefDialog「保存」显式确认（需求 6.6）；
 *   若后端返回 assetWarning（换选题/剧本且已有已拍素材），弹出确认是否重拍的对话框（需求 6.4）。
 * - 删除：AlertDialog 二次确认避免误操作（需求 6.6）。
 * - 新增：经 AddBriefDialog「确认新增」显式提交，受单日上界约束（需求 6.2）。
 * - 锁定/跳过/恢复：PUT day-lock 写入后端，并以会话内状态即时反映；提供「撤销」入口避免误操作（需求 6.5, 6.6）。
 *
 * Requirements: 6.1, 6.4, 6.5, 6.6, 6.7
 */
export default function CalendarPage() {
  const params = useParams()
  const router = useRouter()
  const storeId = params.storeId as string

  // 当前活跃内容计划
  const { data, isLoading, error, mutate } = useSWR<{ contentPlan: ContentPlan }>(
    storeId ? `/api/stores/${storeId}/content-plan/current` : null,
    fetcher,
    { revalidateOnFocus: false }
  )

  // 编辑弹窗状态
  const [editBrief, setEditBrief] = useState<Brief | null>(null)
  const [editOpen, setEditOpen] = useState(false)

  // 新增弹窗状态
  const [addDate, setAddDate] = useState<Date | null>(null)
  const [addOpen, setAddOpen] = useState(false)

  // 删除确认状态
  const [deleteTarget, setDeleteTarget] = useState<Brief | null>(null)
  const [deleting, setDeleting] = useState(false)

  // 换选题/剧本后已有已拍素材 → 确认是否重拍（需求 6.4）
  const [reshootPrompt, setReshootPrompt] = useState<{ briefId: string; warning: string } | null>(null)

  // 锁定/跳过状态（会话内）：后端无查询端点，故以本次操作结果反映，已持久化并由下一轮自动生成尊重（需求 6.5）
  const [dayStates, setDayStates] = useState<Record<string, DayState>>({})

  // 单日上界（与后端默认一致）
  const dayLimit = SINGLE_DAY_LIMIT

  // 加载中
  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner size="lg" />
      </div>
    )
  }

  // 暂无活跃计划（404）：如实展示，提供生成入口，不伪造内容（需求 6.7）
  const isNotFound = error && /暂无活跃的内容计划|NOT_FOUND/.test(error.message)
  if (isNotFound || (!data?.contentPlan && !error)) {
    return (
      <div className="mx-auto max-w-lg space-y-4 py-10 text-center">
        <p className="text-gray-500">还没有内容计划</p>
        <p className="text-sm text-gray-400">生成一份 7 天内容计划后即可在此查看与编辑</p>
        <Button
          className="rounded-xl"
          onClick={() => router.push(`/merchant/stores/${storeId}`)}
        >
          去生成内容计划
        </Button>
      </div>
    )
  }

  // 其它错误
  if (error || !data?.contentPlan) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center space-y-3">
        <p className="text-gray-500">{error?.message || '加载失败'}</p>
        <Button variant="outline" className="rounded-xl" onClick={() => router.back()}>
          返回
        </Button>
      </div>
    )
  }

  const plan = data.contentPlan
  const buckets = buildDayBuckets(plan)

  /** 打开编辑弹窗 */
  function handleEdit(brief: Brief) {
    setEditBrief(brief)
    setEditOpen(true)
  }

  /** 打开新增弹窗 */
  function handleAdd(date: Date) {
    setAddDate(date)
    setAddOpen(true)
  }

  /** 编辑保存成功回调：刷新数据；若有已拍素材警告则确认是否重拍（需求 6.4） */
  function handleSaved(result: { message: string; assetWarning?: string; briefId: string }) {
    mutate()
    if (result.assetWarning) {
      // 换选题/剧本且已有已拍素材：显式提示确认是否重拍
      setReshootPrompt({ briefId: result.briefId, warning: result.assetWarning })
    } else {
      toast.success(result.message)
    }
  }

  /** 确认删除 brief（经二次确认，避免误操作 — 需求 6.6） */
  async function confirmDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/content-briefs/${deleteTarget.id}`, { method: 'DELETE' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(json?.error?.message || '删除失败')
        return
      }
      toast.success('已删除内容任务')
      setDeleteTarget(null)
      mutate()
    } catch {
      toast.error('网络错误，请重试')
    } finally {
      setDeleting(false)
    }
  }

  /**
   * 设置某天锁定/跳过/恢复状态（需求 6.5）。
   * 写入后端后即时反映会话内状态，并通过 toast「撤销」提供反悔入口（需求 6.6）。
   */
  async function handleSetDayState(date: Date, next: DayState) {
    const key = dateKey(date)
    const prev = dayStates[key] ?? 'NORMAL'
    // 乐观更新
    setDayStates((s) => ({ ...s, [key]: next }))

    const ok = await putDayLock(date, next)
    if (!ok) {
      // 失败回滚
      setDayStates((s) => ({ ...s, [key]: prev }))
      toast.error('操作失败，请重试')
      return
    }

    const label = next === 'LOCKED' ? '已锁定该天' : next === 'SKIPPED' ? '已跳过该天' : '已恢复该天'
    toast.success(label, {
      action: {
        label: '撤销',
        onClick: async () => {
          const reverted = await putDayLock(date, prev)
          if (reverted) {
            setDayStates((s) => ({ ...s, [key]: prev }))
          } else {
            toast.error('撤销失败，请重试')
          }
        },
      },
    })
  }

  /** 调用 day-lock 端点写入某天状态，返回是否成功 */
  async function putDayLock(date: Date, state: DayState): Promise<boolean> {
    try {
      const res = await fetch(`/api/stores/${storeId}/calendar/day-lock`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: new Date(`${dateKey(date)}T00:00:00`).toISOString(),
          state,
        }),
      })
      return res.ok
    } catch {
      return false
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 pb-10">
      {/* 计划头部 */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold text-gray-900">{plan.title || '内容计划'}</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            {formatDate(plan.startDate)} - {formatDate(plan.endDate)}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0 text-gray-500"
          onClick={() => router.push(`/merchant/stores/${storeId}`)}
        >
          返回门店
        </Button>
      </div>

      {/* 说明：空缺天如实展示，不自动填充（需求 6.7） */}
      <p className="text-xs text-gray-400">
        可改期 / 换选题 / 换剧本 / 删除 / 新增内容；锁定或跳过某天后，下一轮自动生成将尊重你的设置。
      </p>

      {/* 按天卡片列表 */}
      <div className="space-y-3">
        {buckets.map((bucket) => (
          <DayCard
            key={bucket.key}
            storeId={storeId}
            bucket={bucket}
            dayState={dayStates[bucket.key] ?? 'NORMAL'}
            dayLimit={dayLimit}
            onAdd={handleAdd}
            onEdit={handleEdit}
            onDelete={(brief) => setDeleteTarget(brief)}
            onSetDayState={handleSetDayState}
          />
        ))}
      </div>

      {/* 编辑弹窗 */}
      <EditBriefDialog
        storeId={storeId}
        brief={editBrief}
        open={editOpen}
        onOpenChange={setEditOpen}
        onSaved={handleSaved}
      />

      {/* 新增弹窗 */}
      <AddBriefDialog
        storeId={storeId}
        date={addDate}
        open={addOpen}
        onOpenChange={setAddOpen}
        onAdded={() => mutate()}
      />

      {/* 删除二次确认（避免误操作 — 需求 6.6） */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除这条内容任务？</AlertDialogTitle>
            <AlertDialogDescription>
              将删除「{deleteTarget?.title}」。该天可保持空缺，不会自动补位。此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                confirmDelete()
              }}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700"
            >
              {deleting ? <Spinner className="h-4 w-4" /> : '确认删除'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 换选题/剧本后已有已拍素材 → 确认是否重拍（需求 6.4） */}
      <AlertDialog open={!!reshootPrompt} onOpenChange={(open) => !open && setReshootPrompt(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>已更新选题，原素材已保留</AlertDialogTitle>
            <AlertDialogDescription>
              {reshootPrompt?.warning || '该任务已有拍摄素材，更换选题后原素材已为你保留。新脚本可能需要重新拍摄，是否现在去重拍？'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>暂不，保留原素材</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (reshootPrompt) {
                  router.push(`/merchant/stores/${storeId}/briefs/${reshootPrompt.briefId}`)
                }
              }}
            >
              去重拍
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
