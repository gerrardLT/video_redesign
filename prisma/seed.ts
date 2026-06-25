import { PrismaClient } from '../src/generated/prisma'
import { PrismaPg } from '@prisma/adapter-pg'

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:123456@localhost:5432/video_redesign'
const adapter = new PrismaPg({ connectionString })
const prisma = new PrismaClient({ adapter })

// ========================
// 套餐种子数据
// ========================
const packages = [
  {
    name: '体验包',
    credits: 50,
    price: 990, // ¥9.9
    description: '适合新用户体验，快速了解 AI 视频重塑效果',
    sortOrder: 1,
  },
  {
    name: '基础包',
    credits: 200,
    price: 2990, // ¥29.9
    description: '满足日常创作需求，性价比之选',
    sortOrder: 2,
  },
  {
    name: '专业包',
    credits: 500,
    price: 5990, // ¥59.9
    description: '专业创作者首选，批量生成更划算',
    sortOrder: 3,
  },
  {
    name: '企业包',
    credits: 2000,
    price: 19990, // ¥199.9
    description: '企业级大容量套餐，团队协作无忧',
    sortOrder: 4,
  },
]

// ========================
// 订阅套餐种子数据
// ========================
const subscriptionPlans = [
  {
    type: 'monthly',
    name: '月卡会员',
    price: 2990, // ¥29.9
    monthlyCredits: 500,
    bonusCredits: 0,
    description: '按月订阅，每月自动到账500积分，享受会员特权',
    privileges: JSON.stringify([
      '优先生成队列',
      '支持1080p分辨率',
      '去除水印',
      '30天版本历史',
    ]),
    sortOrder: 1,
  },
  {
    type: 'quarterly',
    name: '季卡会员',
    price: 7990, // ¥79.9（vs 月卡 ¥29.9×3=¥89.7，省约11%）
    monthlyCredits: 500,
    bonusCredits: 300, // 开通赠送300积分
    description: '按季订阅，每月自动到账500积分，开通赠送300积分',
    privileges: JSON.stringify([
      '优先生成队列',
      '支持1080p分辨率',
      '去除水印',
      '30天版本历史',
      '季卡专属300积分奖励',
    ]),
    sortOrder: 2,
  },
  {
    type: 'yearly',
    name: '年卡会员',
    price: 24900, // ¥249
    monthlyCredits: 500,
    bonusCredits: 1000,
    description: '按年订阅，每月自动到账500积分，额外赠送1000积分奖励，享受全部会员特权',
    privileges: JSON.stringify([
      '优先生成队列',
      '支持1080p分辨率',
      '去除水印',
      '30天版本历史',
      '年卡专属1000积分奖励',
    ]),
    sortOrder: 3,
  },
]

// ========================
// 风格模板种子数据
// ========================
const styleTemplates = [
  {
    name: '写实风格',
    description: '高度真实的画面效果，适合纪录片和产品展示',
    promptPrefix: 'realistic, photorealistic, high quality, detailed',
    sortOrder: 1,
  },
  {
    name: '动漫风格',
    description: '鲜艳的动漫画风，适合娱乐和二次元内容',
    promptPrefix: 'anime style, vibrant colors, cel shading',
    sortOrder: 2,
  },
  {
    name: '3D渲染',
    description: '精致的三维渲染效果，适合科技和建筑展示',
    promptPrefix: '3D render, cinema 4D, octane render, high quality',
    sortOrder: 3,
  },
  {
    name: '水彩风格',
    description: '柔和的水彩画效果，适合艺术和文艺类内容',
    promptPrefix: 'watercolor painting, soft colors, artistic',
    sortOrder: 4,
  },
  {
    name: '赛博朋克',
    description: '霓虹灯效的未来感画面，适合科幻和潮流内容',
    promptPrefix: 'cyberpunk style, neon lights, futuristic, dark',
    sortOrder: 5,
  },
]

// ========================
// 餐饮行业剧本种子数据
// 覆盖 8 个 ContentGoal，每个至少 1-2 个剧本
// ========================
const playbooks = [
  // ========== TRAFFIC（工作日引流）==========
  {
    id: 'playbook-traffic-lunch-rush',
    industry: 'RESTAURANT' as const,
    name: '午餐引流-限时特惠',
    goal: 'TRAFFIC' as const,
    description: '通过限时优惠吸引工作日午餐客流',
    structure: [
      { name: '钩子', purpose: '价格利益点前置抓注意力', durationSec: 3 },
      { name: '产品展示', purpose: '展示招牌菜品的诱人画面', durationSec: 5 },
      { name: '优惠信息', purpose: '强调限时优惠和到店方式', durationSec: 4 },
      { name: '行动号召', purpose: '引导用户点击定位或团购', durationSec: 3 },
    ],
    requiredShots: ['PRODUCT_CLOSEUP', 'OFFER_DISPLAY'],
    optionalShots: ['STOREFRONT', 'ENVIRONMENT'],
    hookTemplates: [
      '打工人注意！{storeName}午餐只要{price}元',
      '公司附近吃什么？{productName}今天特价{price}',
      '{storeName}工作日午餐套餐上新了，人均不到{price}块',
    ],
    captionTemplates: [
      '工作日午餐不知道吃啥？来{storeName}试试{productName}，现在只要{price}元，好吃不贵还管饱 📍{location}',
      '打工人的快乐就是中午吃顿好的！{storeName}午餐特惠{price}元起，{productName}真的绝了',
    ],
    coverTitleTemplates: ['午餐{price}元', '{productName}特惠'],
    ctaTemplates: ['点击下方团购链接立省{discount}元', '📍导航到店，今天就能吃到'],
    scoreWeight: { views: 0.6, conversion: 0.4 },
    tierRequired: 'FREE',
    isActive: true,
  },
  {
    id: 'playbook-traffic-new-store',
    industry: 'RESTAURANT' as const,
    name: '新店引流-周边探店',
    goal: 'TRAFFIC' as const,
    description: '新店开业或冷启动阶段吸引周边客流',
    structure: [
      { name: '悬念钩子', purpose: '用"新开了一家"引起好奇', durationSec: 3 },
      { name: '环境展示', purpose: '展示门店外观和内部环境', durationSec: 5 },
      { name: '招牌菜品', purpose: '展示1-2道核心产品', durationSec: 5 },
      { name: '到店指引', purpose: '告知地址和优惠信息', durationSec: 3 },
    ],
    requiredShots: ['STOREFRONT', 'PRODUCT_CLOSEUP', 'ENVIRONMENT'],
    optionalShots: ['STAFF_ACTION'],
    hookTemplates: [
      '{location}新开了一家{storeName}，进去一看被惊到了',
      '附近居然藏了这么一家店！{storeName}你们去过吗',
      '跟着我来探个店，{location}的{storeName}到底怎么样',
    ],
    captionTemplates: [
      '发现了一家新开的宝藏小店{storeName}！{productName}真的可以，环境也不错，推荐大家去试试 📍{location}',
      '{location}的朋友们有福了！{storeName}新开业，{productName}是真的好吃，趁人少赶紧去',
    ],
    coverTitleTemplates: ['新店探店', '{location}宝藏店'],
    ctaTemplates: ['📍{location}，导航搜{storeName}', '新店开业有优惠，快去尝鲜'],
    scoreWeight: { views: 0.7, conversion: 0.3 },
    tierRequired: 'FREE',
    isActive: true,
  },

  // ========== PROMOTION（促销爆品）==========
  {
    id: 'playbook-promotion-group-buy',
    industry: 'RESTAURANT' as const,
    name: '团购爆款-价格冲击',
    goal: 'PROMOTION' as const,
    description: '通过价格对比和视觉冲击推动团购转化',
    structure: [
      { name: '价格钩子', purpose: '用超低价格数字抓眼球', durationSec: 3 },
      { name: '菜品特写', purpose: '近景展示菜品色泽和分量', durationSec: 5 },
      { name: '套餐内容', purpose: '逐一展示套餐包含的菜品', durationSec: 6 },
      { name: '下单引导', purpose: '引导点击团购链接', durationSec: 3 },
    ],
    requiredShots: ['PRODUCT_CLOSEUP', 'OFFER_DISPLAY'],
    optionalShots: ['COOKING_PROCESS', 'CUSTOMER_REACTION'],
    hookTemplates: [
      '{price}元吃到撑！{storeName}这个套餐太离谱了',
      '原价{originalPrice}现在只要{price}！{storeName}{productName}团购上线',
      '不到{price}块钱，{storeName}这顿饭我吃了什么',
    ],
    captionTemplates: [
      '姐妹们冲！{storeName}团购上新了，{productName}只要{price}元（原价{originalPrice}），真的太划算了，手慢无！',
      '这个价格我真的会谢！{storeName}{productName}团购价{price}元，4个菜1个汤管够，快去抢',
    ],
    coverTitleTemplates: ['{price}元套餐', '团购{price}元起'],
    ctaTemplates: ['点击左下角团购，立省{discount}元', '手慢无！团购链接在下方'],
    scoreWeight: { views: 0.4, conversion: 0.6 },
    tierRequired: 'FREE',
    isActive: true,
  },
  {
    id: 'playbook-promotion-limited-time',
    industry: 'RESTAURANT' as const,
    name: '限时秒杀-紧迫感',
    goal: 'PROMOTION' as const,
    description: '通过倒计时和限量营造紧迫感促进下单',
    structure: [
      { name: '紧迫钩子', purpose: '用"最后X份"或限时制造紧迫', durationSec: 3 },
      { name: '产品亮点', purpose: '快速展示产品最吸引人的特点', durationSec: 4 },
      { name: '优惠详情', purpose: '明确优惠内容和截止时间', durationSec: 4 },
      { name: '立即下单', purpose: '催促立即行动', durationSec: 3 },
    ],
    requiredShots: ['PRODUCT_CLOSEUP', 'OFFER_DISPLAY', 'CTA_SCREEN'],
    optionalShots: ['STOREFRONT'],
    hookTemplates: [
      '最后50份！{storeName}{productName}秒杀价{price}元',
      '今天截止！{storeName}这个{productName}优惠明天就没了',
      '手慢无！{price}元的{productName}还剩最后一天',
    ],
    captionTemplates: [
      '限时优惠最后一天！{storeName}{productName}秒杀价{price}元，平时可没这个价，错过等下次活动 📍{location}',
      '⏰倒计时！{storeName}周年庆最后3天，{productName}套餐直降到{price}元，抓紧时间下单',
    ],
    coverTitleTemplates: ['限时{price}元', '最后一天'],
    ctaTemplates: ['⏰限时优惠，点击抢购', '最后{count}份，手慢无'],
    scoreWeight: { views: 0.3, conversion: 0.7 },
    tierRequired: 'FREE',
    isActive: true,
  },

  // ========== NEW_PRODUCT（新品推荐）==========
  {
    id: 'playbook-new-product-signature',
    industry: 'RESTAURANT' as const,
    name: '招牌新品-制作过程',
    goal: 'NEW_PRODUCT' as const,
    description: '通过展示制作过程凸显新品卖点和食材品质',
    structure: [
      { name: '新品悬念', purpose: '预告新品引起好奇', durationSec: 3 },
      { name: '制作过程', purpose: '展示食材和制作关键步骤', durationSec: 8 },
      { name: '成品展示', purpose: '成品特写激发食欲', durationSec: 4 },
      { name: '品尝推荐', purpose: '推荐到店品尝', durationSec: 3 },
    ],
    requiredShots: ['PRODUCT_CLOSEUP', 'COOKING_PROCESS'],
    optionalShots: ['STAFF_ACTION', 'OWNER_TALKING'],
    hookTemplates: [
      '{storeName}上新了！这道{productName}花了3个月研发',
      '我们的新菜终于来了！{productName}，用的全是好食材',
      '偷偷告诉你们，{storeName}最近出了个新品{productName}',
    ],
    captionTemplates: [
      '新品上线🎉{storeName}最新研发的{productName}，从选材到出品每一步都用心，来店里尝个鲜吧！',
      '等了很久的新品终于来了！{productName}用了{sellingPoint}，口感和之前完全不一样，快来试试',
    ],
    coverTitleTemplates: ['新品上线', '{productName}来了'],
    ctaTemplates: ['新品尝鲜价{price}元，到店即享', '来{storeName}尝鲜，新品等你'],
    scoreWeight: { views: 0.5, conversion: 0.5 },
    tierRequired: 'FREE',
    isActive: true,
  },

  // ========== TRUST_BUILDING（信任建设）==========
  {
    id: 'playbook-trust-kitchen-reveal',
    industry: 'RESTAURANT' as const,
    name: '后厨揭秘-透明厨房',
    goal: 'TRUST_BUILDING' as const,
    description: '展示后厨环境和操作规范建立食品安全信任',
    structure: [
      { name: '引入话题', purpose: '提出"后厨到底什么样"的好奇点', durationSec: 3 },
      { name: '后厨环境', purpose: '展示干净整洁的后厨全景', durationSec: 5 },
      { name: '操作规范', purpose: '展示厨师规范操作和食材', durationSec: 6 },
      { name: '信任结语', purpose: '强调食品安全承诺', durationSec: 3 },
    ],
    requiredShots: ['COOKING_PROCESS', 'STAFF_ACTION', 'ENVIRONMENT'],
    optionalShots: ['OWNER_TALKING'],
    hookTemplates: [
      '带你们看看{storeName}的后厨，干不干净你说了算',
      '很多人问我们后厨什么样，今天直接公开给大家看',
      '{storeName}的厨房，随时欢迎检查',
    ],
    captionTemplates: [
      '透明公开！带大家看看{storeName}的后厨真实状态，每天消毒、食材当日采购，吃得放心才是真的好',
      '有些东西不用多说，直接看后厨就知道了。{storeName}坚持每天清洁消毒，食材新鲜看得见',
    ],
    coverTitleTemplates: ['后厨大公开', '真实后厨'],
    ctaTemplates: ['用心做菜，放心来吃', '📍{storeName}欢迎到店参观'],
    scoreWeight: { views: 0.7, conversion: 0.3 },
    tierRequired: 'FREE',
    isActive: true,
  },
  {
    id: 'playbook-trust-owner-story',
    industry: 'RESTAURANT' as const,
    name: '老板人设-用心做菜',
    goal: 'TRUST_BUILDING' as const,
    description: '通过老板口播建立人格化信任感',
    structure: [
      { name: '老板出镜', purpose: '老板自我介绍和开店初心', durationSec: 5 },
      { name: '坚持细节', purpose: '展示日常坚持的小事', durationSec: 5 },
      { name: '真诚邀请', purpose: '真诚邀请客人来品尝', durationSec: 4 },
    ],
    requiredShots: ['OWNER_TALKING', 'STAFF_ACTION'],
    optionalShots: ['COOKING_PROCESS', 'PRODUCT_CLOSEUP'],
    hookTemplates: [
      '开了{years}年店，我为什么还在坚持自己选菜',
      '做餐饮这么多年，我有一个原则从不妥协',
      '大家好我是{storeName}的老板，今天跟你们聊聊',
    ],
    captionTemplates: [
      '做餐饮不容易，但每次看到客人吃得开心就觉得值了。{storeName}会一直用心做每一道菜，欢迎来坐坐',
      '开店{years}年了，能坚持下来靠的就是一个"真"字。食材好、味道正，{storeName}等你来品',
    ],
    coverTitleTemplates: ['老板的坚持', '用心做菜'],
    ctaTemplates: ['来{storeName}坐坐，尝尝老板的手艺', '用心做菜，真诚待客'],
    scoreWeight: { views: 0.6, conversion: 0.4 },
    tierRequired: 'FREE',
    isActive: true,
  },

  // ========== BRAND_STORY（品牌故事）==========
  {
    id: 'playbook-brand-story-ambiance',
    industry: 'RESTAURANT' as const,
    name: '氛围种草-用餐体验',
    goal: 'BRAND_STORY' as const,
    description: '通过环境氛围展示吸引目标客群种草到店',
    structure: [
      { name: '氛围钩子', purpose: '用视觉氛围感吸引停留', durationSec: 4 },
      { name: '环境细节', purpose: '展示装修细节和灯光氛围', durationSec: 6 },
      { name: '用餐场景', purpose: '展示真实用餐场景', durationSec: 5 },
      { name: '到店邀请', purpose: '邀请来体验', durationSec: 3 },
    ],
    requiredShots: ['ENVIRONMENT', 'PRODUCT_CLOSEUP'],
    optionalShots: ['CUSTOMER_REACTION', 'STOREFRONT'],
    hookTemplates: [
      '下班后想找个安静的地方吃饭？来{storeName}',
      '{location}居然藏着这么有氛围感的餐厅',
      '约会/聚餐选这里准没错，{storeName}的环境绝了',
    ],
    captionTemplates: [
      '有时候吃饭不只是为了填肚子，还有那个氛围和心情。{storeName}的环境真的很适合下班后放松一下 📍{location}',
      '朋友聚餐选在了{storeName}，环境好、出片率高，菜也好吃，下次还来',
    ],
    coverTitleTemplates: ['氛围感餐厅', '约会好去处'],
    ctaTemplates: ['📍{location}，适合约会聚餐', '来{storeName}感受一下'],
    scoreWeight: { views: 0.7, conversion: 0.3 },
    tierRequired: 'FREE',
    isActive: true,
  },

  // ========== CUSTOMER_TESTIMONIAL（顾客见证）==========
  {
    id: 'playbook-testimonial-reaction',
    industry: 'RESTAURANT' as const,
    name: '食客反应-真实评价',
    goal: 'CUSTOMER_TESTIMONIAL' as const,
    description: '记录真实顾客用餐后的反应和评价',
    structure: [
      { name: '引出话题', purpose: '介绍今天来了一桌客人', durationSec: 3 },
      { name: '用餐过程', purpose: '展示客人品尝菜品的过程', durationSec: 5 },
      { name: '真实反馈', purpose: '记录客人的真实评价', durationSec: 5 },
      { name: '推荐结语', purpose: '用客人的好评做收尾', durationSec: 3 },
    ],
    requiredShots: ['CUSTOMER_REACTION', 'PRODUCT_CLOSEUP'],
    optionalShots: ['OWNER_TALKING', 'ENVIRONMENT'],
    hookTemplates: [
      '第一次来{storeName}的客人，吃完{productName}后的反应',
      '让客人评价我们的{productName}，结果说了这些',
      '问了今天来的客人：{storeName}的菜怎么样？',
    ],
    captionTemplates: [
      '最真实的评价就是客人的反应！今天这桌客人第一次来{storeName}，点了{productName}，看表情就知道满意了',
      '做餐饮最开心的时刻就是客人说"下次还来"。感谢每一位信任{storeName}的食客',
    ],
    coverTitleTemplates: ['食客真实评价', '客人说好吃'],
    ctaTemplates: ['来{storeName}尝尝，你也会爱上', '好不好吃，来了就知道'],
    scoreWeight: { views: 0.6, conversion: 0.4 },
    tierRequired: 'GROWTH',
    isActive: true,
  },

  // ========== WEEKEND_BOOST（周末预热）==========
  {
    id: 'playbook-weekend-family',
    industry: 'RESTAURANT' as const,
    name: '周末聚餐-家庭场景',
    goal: 'WEEKEND_BOOST' as const,
    description: '周五预热周末家庭聚餐场景',
    structure: [
      { name: '场景代入', purpose: '用"周末带家人吃什么"引共鸣', durationSec: 3 },
      { name: '菜品展示', purpose: '展示适合分享的大份菜品', durationSec: 6 },
      { name: '欢乐氛围', purpose: '展示多人用餐的热闹场景', durationSec: 5 },
      { name: '预约引导', purpose: '引导提前预约避免排队', durationSec: 3 },
    ],
    requiredShots: ['PRODUCT_CLOSEUP', 'ENVIRONMENT'],
    optionalShots: ['CUSTOMER_REACTION', 'STOREFRONT'],
    hookTemplates: [
      '周末带家人来{storeName}，这几道菜必点',
      '还在纠结周末去哪吃？{storeName}的{productName}适合一家人',
      '周末聚餐就来{storeName}，人均{price}吃得好又热闹',
    ],
    captionTemplates: [
      '周末不知道带家人吃什么？推荐{storeName}的{productName}，分量足味道好，适合3-5人一起吃，提前预约不用等位',
      '这周末的家庭聚餐安排上了！{storeName}人均{price}，环境舒服菜品丰富，一家老小都满意',
    ],
    coverTitleTemplates: ['周末聚餐推荐', '一家人吃这个'],
    ctaTemplates: ['提前预约不排队，周末直接来', '📍{storeName}，周末见'],
    scoreWeight: { views: 0.5, conversion: 0.5 },
    tierRequired: 'FREE',
    isActive: true,
  },
  {
    id: 'playbook-weekend-friends',
    industry: 'RESTAURANT' as const,
    name: '周末预热-朋友聚会',
    goal: 'WEEKEND_BOOST' as const,
    description: '面向年轻群体的周末聚会场景',
    structure: [
      { name: '社交钩子', purpose: '用"周末约朋友"引起共鸣', durationSec: 3 },
      { name: '特色菜品', purpose: '展示适合拍照分享的菜品', durationSec: 5 },
      { name: '社交氛围', purpose: '展示朋友聚会的欢乐场景', durationSec: 5 },
      { name: '邀约引导', purpose: '引导转发给朋友约饭', durationSec: 3 },
    ],
    requiredShots: ['PRODUCT_CLOSEUP', 'ENVIRONMENT'],
    optionalShots: ['CUSTOMER_REACTION', 'OFFER_DISPLAY'],
    hookTemplates: [
      '周末约朋友来{storeName}，这顿饭太开心了',
      '和闺蜜的周末饭局就选{storeName}，出片率超高',
      '朋友聚会去哪吃？{storeName}人均{price}氛围感拉满',
    ],
    captionTemplates: [
      '周末约了朋友来{storeName}，点了{productName}和几道招牌菜，边吃边聊太开心了！强推给周末约饭的姐妹们 📍{location}',
      '找到了一个超适合朋友聚会的地方！{storeName}环境好、菜好吃、人均{price}不贵，周末直接约起来',
    ],
    coverTitleTemplates: ['周末约这里', '朋友聚会'],
    ctaTemplates: ['@你的朋友 周末约这里', '转发给要约饭的朋友'],
    scoreWeight: { views: 0.6, conversion: 0.4 },
    tierRequired: 'FREE',
    isActive: true,
  },

  // ========== REPEAT_PURCHASE（复购激活）==========
  {
    id: 'playbook-repeat-loyalty',
    industry: 'RESTAURANT' as const,
    name: '老客复购-会员回馈',
    goal: 'REPEAT_PURCHASE' as const,
    description: '通过会员福利和老客专属优惠刺激复购',
    structure: [
      { name: '感恩开场', purpose: '感谢老客人的支持', durationSec: 3 },
      { name: '新品/升级', purpose: '展示老客人还没尝过的新菜品', durationSec: 5 },
      { name: '专属福利', purpose: '公布老客专属优惠', durationSec: 5 },
      { name: '欢迎回来', purpose: '温馨邀请再次光临', durationSec: 3 },
    ],
    requiredShots: ['PRODUCT_CLOSEUP', 'OWNER_TALKING'],
    optionalShots: ['OFFER_DISPLAY', 'CUSTOMER_REACTION'],
    hookTemplates: [
      '来过{storeName}的老客人注意了，这次有专属福利',
      '感谢老朋友们的支持！{storeName}给你们准备了惊喜',
      '上次来{storeName}吃{productName}的朋友，这次有新的了',
    ],
    captionTemplates: [
      '感谢每一位老客人的支持！{storeName}这次给回头客准备了专属优惠，{productName}升级版上线了，老朋友来尝个鲜',
      '你们要的{productName}升级了！老客人到店报暗号还有额外优惠，{storeName}欢迎你再来 📍{location}',
    ],
    coverTitleTemplates: ['老客福利', '回头客专属'],
    ctaTemplates: ['老客到店报暗号享专属优惠', '欢迎回来，{storeName}等你'],
    scoreWeight: { views: 0.4, conversion: 0.6 },
    tierRequired: 'FREE',
    isActive: true,
  },
  {
    id: 'playbook-repeat-seasonal',
    industry: 'RESTAURANT' as const,
    name: '季节上新-唤醒老客',
    goal: 'REPEAT_PURCHASE' as const,
    description: '利用季节性新品吸引老客人再次到店',
    structure: [
      { name: '季节话题', purpose: '用应季食材引起兴趣', durationSec: 3 },
      { name: '食材展示', purpose: '展示新鲜应季食材', durationSec: 4 },
      { name: '新菜制作', purpose: '展示新菜品的制作亮点', durationSec: 6 },
      { name: '限定提醒', purpose: '强调时令限定', durationSec: 3 },
    ],
    requiredShots: ['PRODUCT_CLOSEUP', 'COOKING_PROCESS'],
    optionalShots: ['STAFF_ACTION', 'OWNER_TALKING'],
    hookTemplates: [
      '这个季节来{storeName}一定要吃{productName}',
      '应季食材到了！{storeName}限定菜品{productName}上线',
      '只有这个月才有！{storeName}时令新品别错过',
    ],
    captionTemplates: [
      '换季了，菜单也换了！{storeName}用当季最新鲜的食材做了这道{productName}，限定供应不知道能卖多久，想吃的赶紧来',
      '时令限定🍃{storeName}这道{productName}用的是当季食材，过了这个月就下架了，老客们赶紧安排',
    ],
    coverTitleTemplates: ['时令限定', '应季新品'],
    ctaTemplates: ['时令限定，过季即止', '来{storeName}尝尝这个季节的味道'],
    scoreWeight: { views: 0.5, conversion: 0.5 },
    tierRequired: 'FREE',
    isActive: true,
  },
]

async function main() {
  console.log('🌱 开始插入种子数据...')

  // 使用 upsert 确保幂等性：按名称匹配
  for (const pkg of packages) {
    await prisma.package.upsert({
      where: { id: pkg.name }, // 利用 name 作为唯一标识逻辑
      update: {
        credits: pkg.credits,
        price: pkg.price,
        description: pkg.description,
        sortOrder: pkg.sortOrder,
        isActive: true,
      },
      create: {
        id: pkg.name, // 使用名称作为 ID 方便 upsert
        name: pkg.name,
        credits: pkg.credits,
        price: pkg.price,
        description: pkg.description,
        sortOrder: pkg.sortOrder,
        isActive: true,
      },
    })
    console.log(`  ✅ 套餐: ${pkg.name} (${pkg.credits}积分, ¥${(pkg.price / 100).toFixed(1)})`)
  }

  for (const template of styleTemplates) {
    await prisma.styleTemplate.upsert({
      where: { id: template.name }, // 使用名称作为唯一标识逻辑
      update: {
        description: template.description,
        promptPrefix: template.promptPrefix,
        sortOrder: template.sortOrder,
        isActive: true,
      },
      create: {
        id: template.name, // 使用名称作为 ID 方便 upsert
        name: template.name,
        description: template.description,
        promptPrefix: template.promptPrefix,
        sortOrder: template.sortOrder,
        isActive: true,
      },
    })
    console.log(`  ✅ 风格模板: ${template.name}`)
  }

  // 插入订阅套餐种子数据（幂等：按 type 作为 ID 进行 upsert）
  for (const plan of subscriptionPlans) {
    await prisma.subscriptionPlan.upsert({
      where: { id: plan.type }, // 使用 type 作为 ID 确保幂等
      update: {
        name: plan.name,
        price: plan.price,
        monthlyCredits: plan.monthlyCredits,
        bonusCredits: plan.bonusCredits,
        description: plan.description,
        privileges: plan.privileges,
        sortOrder: plan.sortOrder,
        isActive: true,
      },
      create: {
        id: plan.type, // 使用 type 作为 ID 方便 upsert 幂等
        name: plan.name,
        type: plan.type,
        price: plan.price,
        monthlyCredits: plan.monthlyCredits,
        bonusCredits: plan.bonusCredits,
        description: plan.description,
        privileges: plan.privileges,
        sortOrder: plan.sortOrder,
        isActive: true,
      },
    })
    console.log(`  ✅ 订阅套餐: ${plan.name} (¥${(plan.price / 100).toFixed(1)}/期, ${plan.monthlyCredits}积分/月${plan.bonusCredits > 0 ? `, +${plan.bonusCredits}积分奖励` : ''})`)
  }

  // 插入餐饮行业剧本种子数据（幂等：按 id 进行 upsert）
  for (const playbook of playbooks) {
    await prisma.playbook.upsert({
      where: { id: playbook.id },
      update: {
        industry: playbook.industry,
        name: playbook.name,
        goal: playbook.goal,
        description: playbook.description,
        structure: playbook.structure,
        requiredShots: playbook.requiredShots,
        optionalShots: playbook.optionalShots,
        hookTemplates: playbook.hookTemplates,
        captionTemplates: playbook.captionTemplates,
        coverTitleTemplates: playbook.coverTitleTemplates,
        ctaTemplates: playbook.ctaTemplates,
        scoreWeight: playbook.scoreWeight,
        tierRequired: playbook.tierRequired,
        isActive: playbook.isActive,
      },
      create: {
        id: playbook.id,
        industry: playbook.industry,
        name: playbook.name,
        goal: playbook.goal,
        description: playbook.description,
        structure: playbook.structure,
        requiredShots: playbook.requiredShots,
        optionalShots: playbook.optionalShots,
        hookTemplates: playbook.hookTemplates,
        captionTemplates: playbook.captionTemplates,
        coverTitleTemplates: playbook.coverTitleTemplates,
        ctaTemplates: playbook.ctaTemplates,
        scoreWeight: playbook.scoreWeight,
        tierRequired: playbook.tierRequired,
        isActive: playbook.isActive,
      },
    })
    console.log(`  ✅ 剧本: ${playbook.name} (${playbook.goal})`)
  }

  console.log('\n🎉 种子数据插入完成！')
  console.log(`   - ${packages.length} 个积分套餐`)
  console.log(`   - ${styleTemplates.length} 个风格模板`)
  console.log(`   - ${subscriptionPlans.length} 个订阅套餐`)
  console.log(`   - ${playbooks.length} 个餐饮行业剧本`)
}

main()
  .catch((e) => {
    console.error('❌ 种子数据插入失败:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
