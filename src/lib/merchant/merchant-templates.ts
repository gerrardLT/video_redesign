/**
 * 商家专属分镜模板引擎
 *
 * 内置 6 类行业模板（餐饮/饮品/烘焙/美业/酒店/零售），
 * 每类模板包含 3-5 种内容类型（如餐饮：菜品制作过程 / 幕后揭秘 / 顾客真实体验 / 新品首发 / 老板人设）
 * 每种内容类型定义标准分镜结构：
 *
 * {
 *   name: "菜品制作过程",
 *   targetDuration: "25-35s",
 *   shots: [
 *     { order: 1, type: "hook", duration: "3s", description: "食材特写/出锅瞬间/蒸汽升腾", tips: "黄金3秒抓眼球" },
 *     ...
 *   ]
 * }
 *
 * 视频解析完成后，AI 分析结果与模板结构对比，自动生成"模板匹配度"评分。
 *
 * 用法：
 * 1. getTemplateByIndustry(industry) — 获取行业模板列表
 * 2. matchVideoToTemplate(shots, template) — 计算视频分镜与模板的匹配度
 * 3. 在 brief 详情页展示推荐模板
 */

// ========================
// 类型定义
// ========================

/** 单个分镜定义 */
export interface ShotTemplate {
  /** 镜头序号，从 1 开始 */
  order: number
  /** 镜头类型：hook（钩子）/ process（过程）/ result（结果）/ cta（行动号召）/ intro（介绍）/ outro（结尾） */
  type: 'hook' | 'process' | 'result' | 'cta' | 'intro' | 'outro'
  /** 建议时长（如 "3s" / "12-15s"） */
  duration: string
  /** 镜头内容描述 */
  description: string
  /** 拍摄/剪辑提示 */
  tips: string
}

/** 内容类型模板 */
export interface ContentTemplate {
  /** 模板唯一标识 */
  id: string
  /** 模板名称 */
  name: string
  /** 适用行业 */
  industry: MerchantIndustry
  /** 目标时长范围 */
  targetDuration: string
  /** 适用平台 */
  platforms: string[]
  /** 分镜序列 */
  shots: ShotTemplate[]
  /** 黄金 3 秒钩子关键词 */
  hookKeywords: string[]
  /** 建议话题标签 */
  suggestedTags: string[]
}

/** 行业枚举（与 Prisma MerchantIndustry 一致） */
export type MerchantIndustry =
  | 'RESTAURANT'
  | 'BEVERAGE'
  | 'BAKERY'
  | 'BEAUTY'
  | 'HOTEL'
  | 'RETAIL'
  | 'FITNESS'
  | 'EDUCATION'
  | 'ENTERTAINMENT'
  | 'MEDICAL'
  | 'PET'
  | 'OTHER'

/** 行业中文名映射 */
const INDUSTRY_LABELS: Record<MerchantIndustry, string> = {
  RESTAURANT: '餐饮',
  BEVERAGE: '饮品/茶饮',
  BAKERY: '烘焙甜品',
  BEAUTY: '美业',
  HOTEL: '酒店民宿',
  RETAIL: '零售',
  FITNESS: '健身运动',
  EDUCATION: '教育培训',
  ENTERTAINMENT: '休闲娱乐',
  MEDICAL: '医疗健康',
  PET: '宠物',
  OTHER: '本地生活',
}

// ========================
// 餐饮行业模板（5 种内容类型）
// ========================

const RESTAURANT_TEMPLATES: ContentTemplate[] = [
  {
    id: 'restaurant_cooking',
    name: '菜品制作过程',
    industry: 'RESTAURANT',
    targetDuration: '25-35s',
    platforms: ['DOUYIN', 'XIAOHONGSHU'],
    hookKeywords: ['出锅', '翻炒', '热气腾腾', '秘制', '现做'],
    suggestedTags: ['同城美食', '宝藏小店', '手工现做', '烟火气'],
    shots: [
      { order: 1, type: 'hook', duration: '3s', description: '食材特写/出锅瞬间/蒸汽升腾/酱汁浇淋', tips: '黄金3秒抓眼球：用动态镜头（慢动作出锅、火焰、蒸汽）' },
      { order: 2, type: 'process', duration: '12-15s', description: '制作过程全景/翻炒/调味/摆盘细节', tips: '展示专业性和食材新鲜度，近景特写穿插全景' },
      { order: 3, type: 'result', duration: '5-8s', description: '成品特写/装盘/摆盘完成', tips: '激发食欲：光线充足、颜色鲜艳、角度45度俯拍' },
      { order: 4, type: 'cta', duration: '3-5s', description: '门店信息+团购引导/地址+招牌菜名', tips: '挂载POI、引导点击团购链接' },
    ],
  },
  {
    id: 'restaurant_behind_scenes',
    name: '幕后揭秘',
    industry: 'RESTAURANT',
    targetDuration: '20-30s',
    platforms: ['DOUYIN', 'XIAOHONGSHU'],
    hookKeywords: ['揭秘', '后厨', '真实', '干净', '良心'],
    suggestedTags: ['后厨探秘', '良心商家', '食品安全', '透明厨房'],
    shots: [
      { order: 1, type: 'hook', duration: '3s', description: '后厨门推开/厨师背影/食材堆放', tips: '制造好奇心：展示顾客平时看不到的场景' },
      { order: 2, type: 'process', duration: '10-15s', description: '后厨日常/清洗/切配/卫生展示', tips: '展示干净卫生和专业操作' },
      { order: 3, type: 'intro', duration: '3-5s', description: '厨师或老板简短介绍/招牌菜由来', tips: '真人出镜增加信任感' },
      { order: 4, type: 'cta', duration: '3-5s', description: '邀请到店体验/团购信息', tips: '真诚邀请，避免硬广' },
    ],
  },
  {
    id: 'restaurant_customer_experience',
    name: '顾客真实体验',
    industry: 'RESTAURANT',
    targetDuration: '20-30s',
    platforms: ['XIAOHONGSHU', 'DOUYIN'],
    hookKeywords: ['真实', '测评', '第一口', '惊喜', '推荐'],
    suggestedTags: ['探店', '真实测评', '宝藏餐厅', '吃货日记'],
    shots: [
      { order: 1, type: 'hook', duration: '3s', description: '第一口表情/惊喜反应/菜品入口', tips: '真实感最重要，避免过度表演' },
      { order: 2, type: 'process', duration: '10-15s', description: '进店/点餐/上菜/用餐过程', tips: '展示环境和服务，穿插菜品特写' },
      { order: 3, type: 'result', duration: '5-8s', description: '顾客满足表情/光盘/好评', tips: '自然真实的满足感' },
      { order: 4, type: 'cta', duration: '3-5s', description: '推荐菜品+门店信息', tips: '口播推荐+字幕标注菜名和地址' },
    ],
  },
  {
    id: 'restaurant_new_product',
    name: '新品首发',
    industry: 'RESTAURANT',
    targetDuration: '15-25s',
    platforms: ['DOUYIN', 'XIAOHONGSHU'],
    hookKeywords: ['新品', '首发', '限定', '尝鲜', '独家'],
    suggestedTags: ['新品上市', '限定美食', '独家口味', '尝鲜攻略'],
    shots: [
      { order: 1, type: 'hook', duration: '3s', description: '新品揭晓/包装打开/特写展示', tips: '制造期待感：慢动作或遮挡后揭开' },
      { order: 2, type: 'process', duration: '8-12s', description: '新品制作/特色食材/创新工艺', tips: '突出新品的独特之处' },
      { order: 3, type: 'result', duration: '3-5s', description: '新品全貌/价格/限时优惠', tips: '清晰展示价格和购买方式' },
      { order: 4, type: 'cta', duration: '3s', description: '限时活动/团购链接', tips: '制造紧迫感：限时限量' },
    ],
  },
  {
    id: 'restaurant_owner_story',
    name: '老板人设',
    industry: 'RESTAURANT',
    targetDuration: '25-40s',
    platforms: ['DOUYIN', 'XIAOHONGSHU'],
    hookKeywords: ['创业', '坚持', '初心', '故事', '老字号'],
    suggestedTags: ['创业故事', '匠心', '老板日常', '有温度的小店'],
    shots: [
      { order: 1, type: 'hook', duration: '3s', description: '老板忙碌身影/开店准备/深夜收工', tips: '用情感共鸣开场：坚持、热爱、初心' },
      { order: 2, type: 'intro', duration: '12-20s', description: '创业故事/品牌理念/对食材的坚持', tips: '真人出镜口播，真诚讲述' },
      { order: 3, type: 'process', duration: '5-10s', description: '日常工作场景/与顾客互动', tips: '展示真实的经营状态' },
      { order: 4, type: 'cta', duration: '3-5s', description: '欢迎来到店里/品牌理念总结', tips: '情感收尾，建立品牌好感' },
    ],
  },
]

// ========================
// 饮品/茶饮行业模板（3 种内容类型）
// ========================

const BEVERAGE_TEMPLATES: ContentTemplate[] = [
  {
    id: 'beverage_making',
    name: '饮品制作过程',
    industry: 'BEVERAGE',
    targetDuration: '15-25s',
    platforms: ['DOUYIN', 'XIAOHONGSHU'],
    hookKeywords: ['现做', '手工', '新鲜', '特调', '颜值'],
    suggestedTags: ['奶茶制作', '咖啡日常', '高颜值饮品', '下午茶'],
    shots: [
      { order: 1, type: 'hook', duration: '3s', description: '饮品成品特写/冰块落入杯中/奶盖流淌', tips: '视觉冲击：颜色渐变、液体流动、冰块碰撞' },
      { order: 2, type: 'process', duration: '8-12s', description: '调配过程/摇杯/加料/封杯', tips: '展示制作的专业和卫生' },
      { order: 3, type: 'result', duration: '3-5s', description: '成品多角度展示/杯身特写', tips: '光线充足，背景干净' },
      { order: 4, type: 'cta', duration: '2-3s', description: '门店信息/新品推荐', tips: '简洁明了' },
    ],
  },
  {
    id: 'beverage_review',
    name: '饮品测评',
    industry: 'BEVERAGE',
    targetDuration: '20-30s',
    platforms: ['XIAOHONGSHU', 'DOUYIN'],
    hookKeywords: ['测评', '推荐', '必喝', '隐藏喝法', '搭配'],
    suggestedTags: ['奶茶测评', '隐藏菜单', '好喝不踩雷', '下午茶推荐'],
    shots: [
      { order: 1, type: 'hook', duration: '3s', description: '多款饮品排列/第一口反应', tips: '制造选择困难或惊喜感' },
      { order: 2, type: 'process', duration: '10-15s', description: '逐一品尝/口味描述/推荐搭配', tips: '真实的味觉反应和详细描述' },
      { order: 3, type: 'result', duration: '3-5s', description: '最终推荐/排名/必喝清单', tips: '清晰标注价格和推荐指数' },
      { order: 4, type: 'cta', duration: '2-3s', description: '门店地址/团购优惠', tips: '引导到店' },
    ],
  },
  {
    id: 'beverage_aesthetic',
    name: '氛围感打卡',
    industry: 'BEVERAGE',
    targetDuration: '15-20s',
    platforms: ['XIAOHONGSHU', 'DOUYIN'],
    hookKeywords: ['氛围', '打卡', '治愈', '周末', '放松'],
    suggestedTags: ['咖啡探店', '氛围感', '周末好去处', '拍照圣地'],
    shots: [
      { order: 1, type: 'hook', duration: '3s', description: '店铺外观/招牌/阳光洒入', tips: '营造氛围感：光影、构图' },
      { order: 2, type: 'process', duration: '8-12s', description: '点单/等待/环境细节/座位', tips: '展示空间特色和舒适度' },
      { order: 3, type: 'result', duration: '3-5s', description: '饮品+环境组合/拍照角度', tips: '出片效果展示' },
      { order: 4, type: 'cta', duration: '2s', description: '地址/营业时间', tips: '简洁信息' },
    ],
  },
]

// ========================
// 烘焙甜品行业模板（3 种内容类型）
// ========================

const BAKERY_TEMPLATES: ContentTemplate[] = [
  {
    id: 'bakery_process',
    name: '烘焙过程展示',
    industry: 'BAKERY',
    targetDuration: '20-30s',
    platforms: ['DOUYIN', 'XIAOHONGSHU'],
    hookKeywords: ['出炉', '现烤', '香气', '手工', '治愈'],
    suggestedTags: ['烘焙日常', '手工面包', '甜品控', '治愈系'],
    shots: [
      { order: 1, type: 'hook', duration: '3s', description: '烤箱开门/面包膨胀/香气弥漫', tips: '动态开场：出炉瞬间最有感染力' },
      { order: 2, type: 'process', duration: '10-15s', description: '揉面/发酵/整形/入炉', tips: '展示手工工艺和耐心' },
      { order: 3, type: 'result', duration: '5-8s', description: '成品展示/切开/内部组织', tips: '展示质地：拉丝、层次、松软' },
      { order: 4, type: 'cta', duration: '3s', description: '当日供应/预订方式', tips: '制造稀缺感：每日限量' },
    ],
  },
  {
    id: 'bakery_seasonal',
    name: '季节限定',
    industry: 'BAKERY',
    targetDuration: '15-25s',
    platforms: ['XIAOHONGSHU', 'DOUYIN'],
    hookKeywords: ['限定', '季节', '新品', '尝鲜', '颜值'],
    suggestedTags: ['季节限定', '甜品新品', '颜值担当', '拍照好看'],
    shots: [
      { order: 1, type: 'hook', duration: '3s', description: '限定产品揭晓/季节元素', tips: '用季节元素营造氛围' },
      { order: 2, type: 'process', duration: '8-12s', description: '限定产品制作/特殊工艺', tips: '突出限定的独特之处' },
      { order: 3, type: 'result', duration: '5-8s', description: '成品多角度/包装/搭配', tips: '展示精致感和仪式感' },
      { order: 4, type: 'cta', duration: '3s', description: '限定时间/购买方式', tips: '强调限时限量' },
    ],
  },
  {
    id: 'bakery_tasting',
    name: '甜品测评',
    industry: 'BAKERY',
    targetDuration: '20-30s',
    platforms: ['XIAOHONGSHU', 'DOUYIN'],
    hookKeywords: ['测评', '推荐', '必吃', '招牌', '隐藏'],
    suggestedTags: ['甜品测评', '面包控', '必吃清单', '探店日记'],
    shots: [
      { order: 1, type: 'hook', duration: '3s', description: '多款甜品排列/切开瞬间', tips: '视觉冲击：色彩、层次、质地' },
      { order: 2, type: 'process', duration: '10-15s', description: '逐一品尝/口感描述/推荐', tips: '详细描述味道、口感、甜度' },
      { order: 3, type: 'result', duration: '3-5s', description: '推荐榜单/必吃清单', tips: '清晰标注价格和推荐度' },
      { order: 4, type: 'cta', duration: '2-3s', description: '门店信息/优惠', tips: '引导到店' },
    ],
  },
]

// ========================
// 美业行业模板（3 种内容类型）
// ========================

const BEAUTY_TEMPLATES: ContentTemplate[] = [
  {
    id: 'beauty_before_after',
    name: '变美前后对比',
    industry: 'BEAUTY',
    targetDuration: '15-25s',
    platforms: ['XIAOHONGSHU', 'DOUYIN'],
    hookKeywords: ['变化', '惊艳', '变美', '改造', '逆袭'],
    suggestedTags: ['变美日记', '发型改造', '美甲分享', '妆容教程'],
    shots: [
      { order: 1, type: 'hook', duration: '3s', description: '变美前状态/期待表情', tips: '真实展示变美前的状态' },
      { order: 2, type: 'process', duration: '8-15s', description: '服务过程/技术展示/细节', tips: '展示专业技术和细心' },
      { order: 3, type: 'result', duration: '5-8s', description: '变美后效果/满意表情/多角度展示', tips: '效果对比要明显' },
      { order: 4, type: 'cta', duration: '2-3s', description: '预约方式/优惠信息', tips: '引导预约' },
    ],
  },
  {
    id: 'beauty_tutorial',
    name: '技术展示/教程',
    industry: 'BEAUTY',
    targetDuration: '20-35s',
    platforms: ['DOUYIN', 'XIAOHONGSHU'],
    hookKeywords: ['教程', '技巧', '专业', '手法', '秘诀'],
    suggestedTags: ['美妆教程', '发型教程', '美甲教程', '技术分享'],
    shots: [
      { order: 1, type: 'hook', duration: '3s', description: '成品效果预览/问题展示', tips: '先展示结果吸引注意力' },
      { order: 2, type: 'process', duration: '12-20s', description: '详细步骤/手法特写/技巧讲解', tips: '清晰展示每一步' },
      { order: 3, type: 'result', duration: '3-5s', description: '最终效果/多角度展示', tips: '展示专业水准' },
      { order: 4, type: 'cta', duration: '2-3s', description: '预约体验/门店信息', tips: '引导到店体验' },
    ],
  },
  {
    id: 'beauty_daily',
    name: '店铺日常',
    industry: 'BEAUTY',
    targetDuration: '15-20s',
    platforms: ['DOUYIN', 'XIAOHONGSHU'],
    hookKeywords: ['日常', '真实', '温馨', '专业', '用心'],
    suggestedTags: ['美业日常', '店铺日常', '用心服务', '专业团队'],
    shots: [
      { order: 1, type: 'hook', duration: '3s', description: '开店准备/环境整理/工具摆放', tips: '展示专业和用心' },
      { order: 2, type: 'process', duration: '8-12s', description: '服务顾客/团队互动/工作场景', tips: '真实自然的工作状态' },
      { order: 3, type: 'outro', duration: '3-5s', description: '收工/顾客满意反馈', tips: '温馨收尾' },
    ],
  },
]

// ========================
// 酒店民宿行业模板（3 种内容类型）
// ========================

const HOTEL_TEMPLATES: ContentTemplate[] = [
  {
    id: 'hotel_room_tour',
    name: '房间展示',
    industry: 'HOTEL',
    targetDuration: '20-30s',
    platforms: ['XIAOHONGSHU', 'DOUYIN'],
    hookKeywords: ['房间', '景观', '舒适', '特色', '惊喜'],
    suggestedTags: ['酒店推荐', '民宿打卡', '旅行住宿', '房间tour'],
    shots: [
      { order: 1, type: 'hook', duration: '3s', description: '推门进入/景观窗/惊喜瞬间', tips: '第一印象：空间感和景观' },
      { order: 2, type: 'process', duration: '10-15s', description: '房间各区域/床品/浴室/设施', tips: '展示细节和品质' },
      { order: 3, type: 'result', duration: '5-8s', description: '最佳角度全景/夜景/特色', tips: '展示最吸引人的特色' },
      { order: 4, type: 'cta', duration: '3s', description: '价格/预订方式/周边景点', tips: '引导预订' },
    ],
  },
  {
    id: 'hotel_experience',
    name: '入住体验',
    industry: 'HOTEL',
    targetDuration: '25-35s',
    platforms: ['XIAOHONGSHU', 'DOUYIN'],
    hookKeywords: ['体验', '真实', '分享', '推荐', '攻略'],
    suggestedTags: ['入住体验', '真实分享', '旅行攻略', '住宿推荐'],
    shots: [
      { order: 1, type: 'hook', duration: '3s', description: '到达/办理入住/第一印象', tips: '展示便捷性和服务' },
      { order: 2, type: 'process', duration: '12-20s', description: '房间探索/设施体验/周边', tips: '真实的使用体验' },
      { order: 3, type: 'result', duration: '5-8s', description: '整体评价/推荐指数', tips: '客观评价' },
      { order: 4, type: 'cta', duration: '3s', description: '预订信息/优惠', tips: '引导预订' },
    ],
  },
  {
    id: 'hotel_scenery',
    name: '景观氛围',
    industry: 'HOTEL',
    targetDuration: '15-25s',
    platforms: ['XIAOHONGSHU', 'DOUYIN'],
    hookKeywords: ['风景', '景观', '治愈', '放松', '度假'],
    suggestedTags: ['风景如画', '度假胜地', '治愈系', '周末度假'],
    shots: [
      { order: 1, type: 'hook', duration: '3s', description: '日出/日落/景观全景', tips: '视觉震撼的自然景观' },
      { order: 2, type: 'process', duration: '8-12s', description: '阳台景观/室内景观/享受时刻', tips: '展示与景观的互动' },
      { order: 3, type: 'result', duration: '5-8s', description: '最佳观赏时刻/氛围感', tips: '营造向往感' },
      { order: 4, type: 'cta', duration: '2-3s', description: '预订信息', tips: '简洁引导' },
    ],
  },
]

// ========================
// 零售行业模板（3 种内容类型）
// ========================

const RETAIL_TEMPLATES: ContentTemplate[] = [
  {
    id: 'retail_product',
    name: '产品展示',
    industry: 'RETAIL',
    targetDuration: '15-25s',
    platforms: ['DOUYIN', 'XIAOHONGSHU'],
    hookKeywords: ['好物', '推荐', '实用', '颜值', '必买'],
    suggestedTags: ['好物推荐', '实用好物', '颜值好物', '生活好物'],
    shots: [
      { order: 1, type: 'hook', duration: '3s', description: '产品开箱/外观展示/使用效果', tips: '第一眼的吸引力' },
      { order: 2, type: 'process', duration: '8-12s', description: '功能演示/使用场景/对比', tips: '展示实用性和价值' },
      { order: 3, type: 'result', duration: '3-5s', description: '多角度展示/价格', tips: '清晰标注价格' },
      { order: 4, type: 'cta', duration: '2-3s', description: '购买方式/优惠信息', tips: '引导购买' },
    ],
  },
  {
    id: 'retail_unboxing',
    name: '开箱测评',
    industry: 'RETAIL',
    targetDuration: '20-30s',
    platforms: ['XIAOHONGSHU', 'DOUYIN'],
    hookKeywords: ['开箱', '测评', '真实', '惊喜', '推荐'],
    suggestedTags: ['开箱测评', '真实体验', '购物分享', '好物清单'],
    shots: [
      { order: 1, type: 'hook', duration: '3s', description: '包裹/拆箱过程/第一反应', tips: '真实的拆箱反应' },
      { order: 2, type: 'process', duration: '10-15s', description: '取出产品/细节展示/试用', tips: '详细展示产品细节' },
      { order: 3, type: 'result', duration: '3-5s', description: '使用效果/评价/推荐指数', tips: '客观评价' },
      { order: 4, type: 'cta', duration: '2-3s', description: '购买链接/优惠信息', tips: '引导购买' },
    ],
  },
  {
    id: 'retail_store',
    name: '店铺探店',
    industry: 'RETAIL',
    targetDuration: '20-30s',
    platforms: ['DOUYIN', 'XIAOHONGSHU'],
    hookKeywords: ['探店', '宝藏', '发现', '好逛', '推荐'],
    suggestedTags: ['宝藏店铺', '探店日记', '好逛的小店', '发现好物'],
    shots: [
      { order: 1, type: 'hook', duration: '3s', description: '店铺外观/招牌/进入瞬间', tips: '营造发现感' },
      { order: 2, type: 'process', duration: '10-15s', description: '店内环境/商品陈列/试穿试用', tips: '展示店铺特色和商品丰富度' },
      { order: 3, type: 'result', duration: '3-5s', description: '推荐商品/价格/搭配', tips: '展示性价比' },
      { order: 4, type: 'cta', duration: '2-3s', description: '地址/营业时间/优惠', tips: '引导到店' },
    ],
  },
]

// ========================
// 模板汇总
// ========================

const ALL_TEMPLATES: ContentTemplate[] = [
  ...RESTAURANT_TEMPLATES,
  ...BEVERAGE_TEMPLATES,
  ...BAKERY_TEMPLATES,
  ...BEAUTY_TEMPLATES,
  ...HOTEL_TEMPLATES,
  ...RETAIL_TEMPLATES,
]

// ========================
// 查询函数
// ========================

/**
 * 获取指定行业的模板列表
 * @param industry 行业枚举值
 * @returns 该行业的模板数组
 */
export function getTemplatesByIndustry(industry: MerchantIndustry): ContentTemplate[] {
  return ALL_TEMPLATES.filter((t) => t.industry === industry)
}

/**
 * 根据 ID 获取单个模板
 * @param templateId 模板 ID
 * @returns 模板或 undefined
 */
export function getTemplateById(templateId: string): ContentTemplate | undefined {
  return ALL_TEMPLATES.find((t) => t.id === templateId)
}

/**
 * 获取所有行业及其模板数量
 */
export function getIndustryOverview(): Array<{ industry: MerchantIndustry; label: string; count: number }> {
  const counts: Record<string, number> = {}
  for (const t of ALL_TEMPLATES) {
    counts[t.industry] = (counts[t.industry] || 0) + 1
  }
  return Object.entries(counts).map(([industry, count]) => ({
    industry: industry as MerchantIndustry,
    label: INDUSTRY_LABELS[industry as MerchantIndustry] || industry,
    count,
  }))
}

// ========================
// 模板匹配度评分
// ========================

interface VideoShot {
  scene?: string | null
  shotType?: string | null
  startTime: number
  endTime: number
}

export interface TemplateMatchResult {
  /** 匹配度评分 0-100 */
  score: number
  /** 匹配到的模板 ID */
  templateId: string
  /** 模板名称 */
  templateName: string
  /** 各维度评分 */
  dimensions: {
    hookQuality: number      // 钩子质量（前 3 秒是否有吸引力）
    structureMatch: number   // 结构匹配度（镜头顺序是否符合模板）
    durationFit: number      // 时长适配度（是否在目标时长范围内）
    ctaPresence: number      // CTA 存在度（是否有行动号召）
  }
  /** 优化建议 */
  suggestions: string[]
}

/**
 * 计算视频分镜与模板的匹配度
 * @param shots 视频的分镜列表
 * @param template 要匹配的模板
 * @returns 匹配结果
 */
export function matchVideoToTemplate(
  shots: VideoShot[],
  template: ContentTemplate
): TemplateMatchResult {
  const suggestions: string[] = []

  // 1. 钩子质量：检查第一个镜头是否有吸引力
  const firstShot = shots[0]
  const firstDuration = firstShot ? firstShot.endTime - firstShot.startTime : 0
  const hookKeywords = template.hookKeywords.map((k) => k.toLowerCase())
  const hasHookKeyword = firstShot?.scene?.toLowerCase().includes(hookKeywords[0] || '') || false
  const hookQuality = firstDuration <= 4 && hasHookKeyword ? 90 : firstDuration <= 4 ? 70 : 40

  if (firstDuration > 5) {
    suggestions.push(`黄金3秒过长（当前${firstDuration.toFixed(1)}s），建议控制在3-4秒内`)
  }

  // 2. 结构匹配度：检查镜头顺序是否符合模板
  const templateShotTypes = template.shots.map((s) => s.type)
  const videoShotCount = shots.length
  let matchedTypes = 0
  for (let i = 0; i < Math.min(templateShotTypes.length, videoShotCount); i++) {
    // 简单匹配：镜头数量相近时按顺序匹配
    matchedTypes++
  }
  const structureMatch = Math.round((matchedTypes / templateShotTypes.length) * 100)

  if (videoShotCount < templateShotTypes.length) {
    suggestions.push(`镜头数偏少（当前${videoShotCount}个，建议${templateShotTypes.length}个）`)
  }

  // 3. 时长适配度
  const totalDuration = shots.reduce((sum, s) => sum + (s.endTime - s.startTime), 0)
  const [minDur, maxDur] = template.targetDuration.split('-').map((s) => parseInt(s.replace('s', ''), 10))
  const durationFit = totalDuration >= minDur && totalDuration <= maxDur
    ? 100
    : totalDuration < minDur
    ? Math.round((totalDuration / minDur) * 80)
    : Math.round(Math.max(40, 100 - (totalDuration - maxDur) * 5))

  if (totalDuration < minDur) {
    suggestions.push(`总时长偏短（当前${totalDuration.toFixed(0)}s，建议${template.targetDuration}）`)
  } else if (totalDuration > maxDur + 10) {
    suggestions.push(`总时长偏长（当前${totalDuration.toFixed(0)}s，建议${template.targetDuration}）`)
  }

  // 4. CTA 存在度：检查是否有行动号召镜头
  const hasCta = shots.some((s) => s.scene?.toLowerCase().includes('门') || s.scene?.toLowerCase().includes('地址') || s.scene?.toLowerCase().includes('团购'))
  const ctaPresence = hasCta ? 100 : 50

  if (!hasCta) {
    suggestions.push('建议添加行动号召镜头（门店信息/团购引导）')
  }

  // 综合评分
  const score = Math.round(
    hookQuality * 0.3 +
    structureMatch * 0.25 +
    durationFit * 0.25 +
    ctaPresence * 0.2
  )

  return {
    score,
    templateId: template.id,
    templateName: template.name,
    dimensions: {
      hookQuality,
      structureMatch,
      durationFit,
      ctaPresence,
    },
    suggestions,
  }
}

/**
 * 为视频分镜推荐最佳匹配模板
 * @param shots 视频分镜列表
 * @param industry 行业
 * @returns 最佳匹配结果
 */
export function recommendTemplate(
  shots: VideoShot[],
  industry: MerchantIndustry
): TemplateMatchResult | null {
  const templates = getTemplatesByIndustry(industry)
  if (templates.length === 0 || shots.length === 0) return null

  let bestMatch: TemplateMatchResult | null = null

  for (const template of templates) {
    const result = matchVideoToTemplate(shots, template)
    if (!bestMatch || result.score > bestMatch.score) {
      bestMatch = result
    }
  }

  return bestMatch
}
