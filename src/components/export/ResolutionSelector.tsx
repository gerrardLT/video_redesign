'use client'

/**
 * 分辨率选择器组件
 *
 * 展示 480p/720p/1080p 三档卡片，全部标注"免费"。
 * 使用 shadcn/ui RadioGroup + Card + Badge 实现选中交互。
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5
 */
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

export type Resolution = '480p' | '720p' | '1080p'

interface ResolutionSelectorProps {
  /** 视频总时长（秒） */
  totalDuration: number
  /** 选中回调 */
  onSelect: (resolution: Resolution) => void
  /** 当前选中分辨率 */
  selectedResolution: Resolution
  /** 用户当前余额（加载中为 null，当前所有分辨率免费） */
  creditBalance: number | null
}

/** 分辨率档位配置 */
interface ResolutionOption {
  value: Resolution
  label: string
  description: string
}

/** 三档分辨率选项 */
const RESOLUTION_OPTIONS: ResolutionOption[] = [
  { value: '480p', label: '480p 标清', description: '基础画质，适合快速预览' },
  { value: '720p', label: '720p 高清', description: '清晰画质，适合社交媒体' },
  { value: '1080p', label: '1080p 超清', description: '极致画质，适合专业发布' },
]

/**
 * 判断当前选中分辨率是否余额不足
 * 当前所有分辨率均免费，始终返回 false
 */
export function isInsufficientBalance(
  _totalDuration: number,
  _selectedResolution: Resolution,
  _creditBalance: number | null
): boolean {
  return false
}

export function ResolutionSelector({
  onSelect,
  selectedResolution,
}: ResolutionSelectorProps) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-muted-foreground">选择导出分辨率</h3>

      <RadioGroup
        value={selectedResolution}
        onValueChange={(value) => onSelect(value as Resolution)}
        className="grid grid-cols-1 gap-3 sm:grid-cols-3"
      >
        {RESOLUTION_OPTIONS.map((option) => {
          const isSelected = selectedResolution === option.value

          return (
            <label key={option.value} className="cursor-pointer">
              <Card
                className={cn(
                  'relative transition-all hover:border-primary/50',
                  isSelected && 'border-primary ring-2 ring-primary/20'
                )}
              >
                <CardContent className="p-4 space-y-2">
                  {/* 顶部：标题 + RadioGroupItem + 免费 Badge */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value={option.value} />
                      <span className="font-semibold text-sm">{option.label}</span>
                    </div>
                    <Badge
                      variant="default"
                      className="bg-green-100 text-green-700 border-green-200"
                    >
                      免费
                    </Badge>
                  </div>

                  {/* 档位描述 */}
                  <p className="text-xs text-muted-foreground pl-6">{option.description}</p>
                </CardContent>
              </Card>
            </label>
          )
        })}
      </RadioGroup>
    </div>
  )
}
