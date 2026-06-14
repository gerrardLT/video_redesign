import type { ShowcaseCategory } from '@/types/enums'

/**
 * 案例展示分类常量（8 种分类）
 * 用于前端展示分类标签和后台管理分类选择
 */
export const SHOWCASE_CATEGORIES = [
  { value: 'brand', label: '品牌宣传' },
  { value: 'education', label: '教育培训' },
  { value: 'ecommerce', label: '电商营销' },
  { value: 'entertainment', label: '娱乐内容' },
  { value: 'technology', label: '科技产品' },
  { value: 'lifestyle', label: '生活方式' },
  { value: 'travel', label: '旅行探索' },
  { value: 'other', label: '其他' },
] as const satisfies ReadonlyArray<{ value: ShowcaseCategory; label: string }>
