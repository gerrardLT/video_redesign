# Requirements Document

## Introduction

商家端（/merchant/**）全方位 UI 改造，基于已确认的 v3「东方禅意编辑式」原型（原研哉×Apple 留白克制方向），覆盖字体体系、图标体系、插画体系、背景纹理、动效特效、组件改造、色彩统一七个维度。目标是让移动端商家工作台呈现「翻开一本高品质杂志」般的克制高级感，同时不影响视频重塑端（/dashboard/**）已有的 --cine-* 暗色体系。

设计参考：design-demos/home-v3-zen-full.html
改造方案：docs/商家端高级感全方位改造方案.md
设计系统：docs/统一设计系统方案.md

## Glossary

- **Merchant_Layout**: 商家端布局组件（src/app/merchant/layout.tsx），承载顶栏、底部导航和内容区域
- **Store_Home**: 门店首页（/merchant/stores/[storeId]），商家每日进入的第一个页面
- **Design_Token_Layer**: globals.css 中定义的 CSS 变量层（--ll-* 前缀），所有商家端组件通过此层引用颜色/间距/字体
- **Shadcn_Theme**: shadcn/ui 组件库的 @theme inline 主题配置，控制 Button/Card/Badge 等基础组件默认外观
- **Stagger_Animation**: 列表/区块按序延迟入场的 CSS 动画效果，每个子元素间隔 50-80ms
- **Hairline_Separator**: 1px 极细分隔线（rgba(26,23,20,.09)），替代传统卡片边框实现区块分隔
- **Paper_Grain_Texture**: SVG feTurbulence 噪点纹理（opacity 0.025），覆盖在暖奶油底色上模拟高级纸质肌理
- **Tabular_Nums**: Space Grotesk 字体 + font-variant-numeric: tabular-nums 的数字展示模式，确保数据对齐
- **Empty_State_Illustration**: 数据为空时展示的 unDraw/DrawKit 单色线稿 SVG 插画（主色=#00754A）
- **Zen_Button**: v3 风格主按钮——深绿实心、border-radius 3px、:active scale(0.97)、白字
- **Bottom_Nav**: 固定在屏幕底部的移动端导航栏，含首页/日历/今日任务/我的四个 tab

## Requirements

### Requirement 1: 字体体系加载与应用

**User Story:** As a 商家用户, I want 界面文字呈现有层次的排版效果, so that 阅读体验舒适且信息层级清晰

#### Acceptance Criteria

1. WHEN Merchant_Layout 首次加载, THE Design_Token_Layer SHALL 通过 next/font/google 加载 Noto Serif SC（500/600/700 weight）、Noto Sans SC（400/500/700 weight）和 Space Grotesk（400/500/600/700 weight）三种字体
2. THE Design_Token_Layer SHALL 定义 --font-serif 指向 Noto Serif SC、--font-sans 指向 Noto Sans SC、--font-num 指向 Space Grotesk 的 CSS 变量
3. WHILE 商家端页面处于活跃渲染状态, THE Merchant_Layout SHALL 将所有 hero/章节标题使用 Noto Serif SC（font-family: var(--font-serif)），正文/UI/表单使用 Noto Sans SC，数据数字使用 Space Grotesk + tabular-nums（字体规则仅在活跃渲染期间应用，非渲染状态不强制）
4. THE Design_Token_Layer SHALL 确立字阶体系：hero 标题 29-31px serif、页面标题 17-18px serif、正文 14px sans、辅助文字 11-12px sans
5. WHEN 数据数字（播放量、积分、待办数、进度百分比）渲染时, THE Store_Home SHALL 对数字应用 font-family: var(--font-num) 和 font-variant-numeric: tabular-nums 及 letter-spacing: -0.02em

### Requirement 2: 图标体系统一

**User Story:** As a 商家用户, I want 界面图标风格统一且轻量, so that 视觉干净不杂乱

#### Acceptance Criteria

1. THE Merchant_Layout SHALL 确保所有功能图标使用 lucide-react 库且 strokeWidth 统一为 1.5
2. THE Bottom_Nav SHALL 使用 lucide-react 图标（strokeWidth 1.5），选中态仅变色（使用 --ll-green），不使用 filled 或 stroke-[2.5] 加粗效果
3. WHILE 商家端页面处于渲染状态, THE Merchant_Layout SHALL 禁止使用 emoji 作为功能按钮、导航或标题装饰图标（emoji 仅允许在行业/品类选择器的数据展示场景），此规则仅在页面渲染状态下生效
4. THE Design_Token_Layer SHALL 定义图标三档尺寸：辅助 16px、正文行内 20px、独立功能 24px

### Requirement 3: 插画体系（空态与引导）

**User Story:** As a 首次使用的商家用户, I want 空态页面有清晰友好的视觉引导, so that 我知道下一步该做什么

#### Acceptance Criteria

1. WHEN 页面数据为空（无今日任务、无成片、无内容计划）, THE Store_Home SHALL 展示 Empty_State_Illustration（单色线稿 SVG，主色 #00754A）替代当前 emoji + 渐变卡片
2. THE Empty_State_Illustration SHALL 使用 unDraw 或 DrawKit 来源的 MIT 授权 SVG 文件，自定义主色为 #00754A，存放于 public/illustrations/ 目录
3. WHEN 页面所有数据类型（今日任务、成片、内容计划）均为空时, THE Store_Home SHALL 自动展示 Empty_State_Illustration 并配合 Noto Serif SC 衬线标题和一句话引导文案，不使用渐变背景或多色装饰，无需额外触发条件

### Requirement 4: 背景纹理与画布底色

**User Story:** As a 商家用户, I want 界面底色温暖舒适且有纸质手感, so that 使用时感觉像翻阅一本精美杂志

#### Acceptance Criteria

1. THE Design_Token_Layer SHALL 将商家端主画布背景色设为暖奶油色 #F4F2ED（替代当前 --ll-canvas: #F2F0EB）
2. WHEN Merchant_Layout 渲染完成, THE Merchant_Layout SHALL 在 .ll-root 容器上覆盖 SVG feTurbulence 噪点纹理伪元素（position:fixed, inset:0, pointer-events:none, opacity:0.025, z-index 高于内容但不拦截交互）
3. THE Paper_Grain_Texture SHALL 使用纯 CSS data URI 方式内联 SVG（baseFrequency 0.75-0.8, numOctaves 4, stitchTiles:stitch），不依赖外部文件加载
4. THE Design_Token_Layer SHALL 确保金色会员区域使用 radial-gradient(ellipse, rgba(168,133,63,.04), transparent) 作为极淡氛围底色

### Requirement 5: 动效与特效体系

**User Story:** As a 商家用户, I want 界面切换和内容出现时有自然流畅的过渡, so that 操作感受顺滑不突兀

#### Acceptance Criteria

1. THE Design_Token_Layer SHALL 定义两条动效曲线：--ease-out: cubic-bezier(.16,1,.3,1)（入场/揭示）和 --ease-spring: cubic-bezier(.23,1.4,.32,1)（弹性强调），以及三档时长 --dur-fast:150ms、--dur-base:300ms、--dur-slow:600ms
2. WHEN 页面内容列表/区块首次进入视口, THE Store_Home SHALL 应用 Stagger_Animation（translateY(12-16px)→0 + opacity 0→1），子元素间隔 50-80ms，总时长不超过 700ms
3. WHEN 用户按下 Zen_Button, THE Zen_Button SHALL 在 :active 状态应用 transform:scale(0.97) + transition 80ms（scale 和 transition CSS 属性始终预声明在按钮元素上，确保按下时即时响应）
4. WHEN 进度条/进度环数值变化时, THE Store_Home SHALL 使用 CSS transition（width 或 stroke-dashoffset）配合 --ease-out 曲线和 600ms 时长实现平滑过渡
5. THE Merchant_Layout SHALL 不引入任何 JavaScript 动画库（如 framer-motion/motion），所有动效通过纯 CSS keyframes 和 transition 实现

### Requirement 6: 组件风格改造——去卡片化

**User Story:** As a 商家用户, I want 信息展示简洁有条理, so that 我能快速浏览而不被繁重的卡片边框分散注意力

#### Acceptance Criteria

1. WHEN 内容区块渲染时, THE Store_Home SHALL 使用 Hairline_Separator（border-top: 1px solid rgba(26,23,20,.09) + 上下 padding）替代 shadcn Card 的外边框+圆角包裹
2. THE Store_Home SHALL 移除现有的 bg-gradient-to-br from-orange-50 to-amber-50 等渐变背景色，统一使用 var(--canvas) 纯色底
3. THE Shadcn_Theme SHALL 将默认 --radius 值从 0.625rem 修改为 3px（0.1875rem），使按钮和输入框呈现极克制的微圆角
4. WHILE 商家端页面处于渲染状态, THE Design_Token_Layer SHALL 通过 @theme inline 将 shadcn 的 --color-primary 指向 #00754A、--color-primary-foreground 指向 #FFFFFF、--color-background 指向 #F4F2ED、--color-muted 指向 #EDEBE9、--color-border 指向 rgba(26,23,20,.09)

### Requirement 7: 按钮体系统一

**User Story:** As a 商家用户, I want 行动按钮风格统一, so that 我能清晰识别页面的主要操作入口

#### Acceptance Criteria

1. THE Zen_Button SHALL 使用 background:var(--ll-green)(#00754A)、color:#FFFFFF、border-radius:3px、padding:16px、font-size:15px、font-weight:500、letter-spacing:.04em
2. WHEN 用户按下 Zen_Button, THE Zen_Button SHALL 切换为 background:var(--ll-green-deep)(#0E3A2A) + transform:scale(0.97)
3. THE Store_Home SHALL 将次级按钮统一为 ghost 风格：无背景、文字色 var(--ll-text-2)、底部 1px border-bottom:var(--ll-hair)，:active 时文字变为 var(--ll-green)
4. THE Store_Home SHALL 移除所有 bg-orange-600/bg-orange-700/border-amber-* 等旧色按钮样式，若检测到残留 orange 样式则记录 warning 日志但不阻断部署，允许渐进式清理

### Requirement 8: 色彩体系统一——消灭三套 token 并存

**User Story:** As a 开发者, I want 商家端只有一套颜色来源, so that 样式维护不混乱且视觉一致

#### Acceptance Criteria

1. THE Shadcn_Theme SHALL 在 .ll-root 作用域内将 shadcn 默认 CSS 变量重映射为品牌语义值：--background:#F4F2ED, --foreground:#1A1714, --primary:#00754A, --primary-foreground:#FFFFFF, --muted:#EDEBE9, --muted-foreground:#75706A, --border:rgba(26,23,20,.09), --card:#FBFAF7, --card-foreground:#1A1714
2. THE Design_Token_Layer SHALL 移除 .ll-root 中对 --color-orange-*/--color-amber-*/--color-gray-* 的覆盖映射（当前 hack 方案），改为在组件层直接使用 --ll-* 语义变量
3. THE Store_Home SHALL 将所有硬编码的 text-orange-*/bg-orange-*/text-amber-*/border-amber-* 等 Tailwind 工具类替换为语义化的 --ll-* CSS 变量引用或 shadcn 组件默认样式
4. IF 某个页面仍使用了旧的 orange/amber 硬编码色值, THEN THE Design_Token_Layer SHALL 通过 CSS lint 规则标记为 warning 级别（不阻断构建），后续自动化保障渐进式迁移

### Requirement 9: 顶栏与底部导航改造

**User Story:** As a 商家用户, I want 导航栏简洁精致, so that 我能专注于页面内容而非界面装饰

#### Acceptance Criteria

1. THE Merchant_Layout SHALL 将顶栏门店名称使用 Noto Serif SC 衬线字体（font-family:var(--font-serif)）、font-size:18px、font-weight:600、letter-spacing:.02em
2. THE Bottom_Nav SHALL 使用 lucide-react 图标 strokeWidth 1.5、尺寸 24px，选中态仅变色为 var(--ll-green) 且不加粗 strokeWidth
3. THE Bottom_Nav SHALL 在背景上使用 backdrop-filter:blur(16px) + background:rgba(244,242,237,.88)（暖奶油半透明）+ border-top:1px solid var(--ll-hair)
4. WHEN 用户切换底部导航 tab 时, THE Bottom_Nav SHALL 对选中图标应用 color:var(--ll-green)，文字应用 font-weight:600 + color:var(--ll-green)，禁止 scale/bounce 动画但允许 fade/slide 等其他过渡动画（scale/bounce 仅在 tab 切换场景禁止，不影响按钮点击等其他交互场景）

### Requirement 10: 进度展示改造

**User Story:** As a 商家用户, I want 拍摄进度展示精致清晰, so that 我能一眼看出今天还剩多少工作

#### Acceptance Criteria

1. THE Store_Home SHALL 将拍摄进度条从粗条（h-2 + bg-orange-100/bg-orange-500）改为 2px 细线（height:2px + background:var(--ll-hair) 底 + var(--ll-green) 填充）
2. WHEN 进度数字展示时, THE Store_Home SHALL 使用 Space Grotesk 字体（font-family:var(--font-num)）、font-size:24px、color:var(--ll-green)、font-variant-numeric:tabular-nums
3. THE Store_Home SHALL 在进度数字旁展示 「已完成/总数」格式（如 3/5），分母使用 font-size:14px + color:var(--ll-text-3)

### Requirement 11: 周计划日历改造

**User Story:** As a 商家用户, I want 周计划展示像节气时间线, so that 我能感受到每天创作的节奏

#### Acceptance Criteria

1. THE Store_Home SHALL 将周计划从 emoji + 彩色圆角格子改为节气式七日布局：竖向排列（星期标签、状态圆点、任务目标文字）
2. WHEN 状态圆点启用时, THE Store_Home SHALL 用 7px 圆点表示每日状态——已完成：实心绿(var(--ll-green))；今日：10px 空心绿环 + 脉冲动画；未来：空心灰(var(--ll-text-3) border)（圆点样式规则仅在状态圆点功能启用时生效）
3. THE Store_Home SHALL 移除周计划中所有 emoji（🔥✨📋 等）表示任务目标，改为纯文字标签（font-size:10-11px, color:var(--ll-text-3)）

### Requirement 12: 设计签名——120%精致细节

**User Story:** As a 商家用户, I want 首页有一处让人记住的精致视觉, so that 品牌感深入人心

#### Acceptance Criteria

1. THE Store_Home SHALL 在「今日任务」区域标题上方展示 kicker 文字（font-size:12px, letter-spacing:.1em, color:var(--ll-green), font-weight:500）并在文字左侧放置一条 24px 宽、1.5px 高的绿色发丝线
2. THE Store_Home SHALL 将「今日任务」标题使用 Noto Serif SC、font-size:29px、font-weight:600、line-height:1.38，左侧带 2px 宽绿色 border-left 作为视觉锚点
3. THE Store_Home SHALL 确保此签名细节是整个商家端唯一一处明显的装饰性设计元素，其余区域保持克制留白

### Requirement 13: 改造作用域隔离

**User Story:** As a 开发者, I want UI 改造严格限定在商家端路由, so that 视频重塑端和落地页不受影响

#### Acceptance Criteria

1. THE Design_Token_Layer SHALL 确保所有 v3 禅意风格的 CSS 变量和组件样式仅在 .ll-root 容器类内生效，不污染 :root 中视频重塑端使用的 --cine-* 变量
2. THE Merchant_Layout SHALL 保持 .ll-root 容器类作为商家端样式作用域的边界
3. IF 商家端组件中引用了 --cine-* 变量, THEN THE Design_Token_Layer SHALL 将其替换为对应的 --ll-* 语义变量，允许含有未替换 --cine-* 引用的组件正常部署并在运行时降级处理
4. THE Shadcn_Theme SHALL 在 .ll-root 作用域内覆盖 shadcn 默认 token，不修改 :root 级别的 shadcn 默认值（保护 /dashboard 使用的暗色 token）

### Requirement 14: 全页面改造推广

**User Story:** As a 商家用户, I want 所有商家端页面风格一致, so that 在不同页面间切换时视觉体验连贯

#### Acceptance Criteria

1. THE Merchant_Layout SHALL 确保以下页面统一应用 v3 禅意风格：门店首页、日历页、今日任务页、拍摄页、成片页、数据复盘页、会员页、设置页、onboarding 问诊页
2. WHEN 用户在商家端不同页面间导航时, THE Merchant_Layout SHALL 保持字体体系、色彩体系、图标风格、分隔线风格的一致性
3. THE Store_Home SHALL 移除所有 「连续创作」区域的 emoji 火焰图标(🏆/🔥)，改为 lucide-react 图标（如 Trophy、Flame），strokeWidth 1.5

### Requirement 15: 对比度与无障碍

**User Story:** As a 视力正常或偏弱的商家用户, I want 界面文字和按钮可读性好, so that 我不会看不清内容

#### Acceptance Criteria

1. THE Design_Token_Layer SHALL 确保主按钮（白字 #FFFFFF 在绿底 #00754A 上）对比度达到 WCAG AA 标准（≥4.5:1）
2. THE Design_Token_Layer SHALL 确保主文字（rgba(0,0,0,.87) 在暖奶油底 #F4F2ED 上）对比度达到 WCAG AA 标准（≥4.5:1）
3. THE Design_Token_Layer SHALL 确保次级文字（rgba(0,0,0,.58) 在暖奶油底 #F4F2ED 上）对比度达到 WCAG AA 标准（≥4.5:1）
4. THE Bottom_Nav SHALL 为每个导航项设置语义化的 aria-label 属性
