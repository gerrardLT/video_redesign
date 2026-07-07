# Implementation Plan: zen-editorial-ui-overhaul

## Overview

基于已确认的 v3「东方禅意编辑式」原型，对商家端（`/merchant/**`）进行全方位 UI 改造。实施采用分层递进策略：先建立 Design Token 与字体基建，再改造门店首页核心视觉，然后统一全局组件，最后推广至所有商家页面并完成质量验证。

所有改造限定在 `.ll-root` 作用域内，不引入 JS 动画库，确保 WCAG AA 对比度达标。

## Tasks

- [x] 1. Design Token 与字体基建
  - [x] 1.1 扩展 globals.css 中 .ll-root 的 v3 Zen Token
    - 在 `src/app/globals.css` 的 `.ll-root` 块内新增：字体变量（--font-serif / --font-sans / --font-num）、字阶变量（--text-hero:29px / --text-title:17px / --text-body:14px / --text-aux:11px）、动效曲线（--ease-out / --ease-spring）、时长档位（--dur-fast:150ms / --dur-base:300ms / --dur-slow:600ms）、画布升级（--ll-canvas:#F4F2ED）、深绿按下态（--ll-green-deep:#0E3A2A）、圆角降级（--radius:0.1875rem 即 3px）
    - 将 shadcn 默认 token 重映射为品牌语义值：--background:#F4F2ED, --foreground:#1A1714, --primary:#00754A, --primary-foreground:#FFFFFF, --muted:#EDEBE9, --border:rgba(26,23,20,.09), --card:#FBFAF7
    - 确保所有新增 token 仅在 .ll-root 内生效，不修改 :root 级别默认值
    - _Requirements: 1.2, 1.4, 4.1, 5.1, 6.3, 6.4, 8.1, 13.1, 13.4_

  - [x] 1.2 配置 next/font/google 加载三字体族
    - 在 `src/app/merchant/layout.tsx` 中通过 next/font/google 加载 Noto Serif SC（500/600/700）、Noto Sans SC（400/500/700）、Space Grotesk（400/500/600/700）
    - 设置 variable 分别为 --font-noto-serif-sc、--font-noto-sans-sc、--font-space-grotesk，display: 'swap'
    - 将三字体 CSS variable class 注入到 .ll-root 容器的 className
    - _Requirements: 1.1, 1.2_

  - [x] 1.3 添加纸质噪点纹理伪元素
    - 在 `src/app/globals.css` 中为 `.ll-root::after` 添加 SVG feTurbulence 噪点纹理
    - 使用 data URI 内联 SVG（baseFrequency:0.75, numOctaves:4, stitchTiles:stitch）
    - position:fixed, inset:0, pointer-events:none, z-index:50, opacity:0.025
    - _Requirements: 4.2, 4.3_

  - [x] 1.4 定义 Stagger 入场动效 CSS 类
    - 在 `src/app/globals.css` 中定义 `.zen-reveal` 动画类：opacity:0 → 1, translateY(14px) → 0
    - 定义 @keyframes zen-revealIn，duration 使用 var(--dur-slow)，timing 使用 var(--ease-out)
    - 定义 nth-child(1) 到 nth-child(7) 的 animation-delay（60ms 间隔）
    - 添加 prefers-reduced-motion: reduce 媒体查询降级（关闭动画和纹理）
    - _Requirements: 5.1, 5.2, 5.5_

  - [x] 1.5 定义金色会员区域氛围底色
    - 在 `src/app/globals.css` 中为会员区域定义 `.ll-gold-ambient` 类
    - 使用 radial-gradient(ellipse, rgba(168,133,63,.04), transparent) 作为背景
    - _Requirements: 4.4_

- [x] 2. Checkpoint - Token 基建验证
  - 确保 `.ll-root` 内所有新增 CSS 变量可正确解析，`/dashboard` 页面不受影响。确保所有测试通过，ask the user if questions arise.

- [x] 3. 门店首页核心改造
  - [x] 3.1 改造今日任务 Hero 区域（设计签名）
    - 修改 `src/app/merchant/stores/[storeId]/page.tsx` 中的今日任务区域
    - 添加 kicker 文字（12px, letter-spacing:.1em, color:var(--ll-green), font-weight:500）+ 左侧 24px×1.5px 绿色发丝线
    - 将今日任务标题改为 Noto Serif SC、29px、font-weight:600、line-height:1.38，左侧带 2px 宽绿色 border-left
    - 包裹在 `.zen-reveal` 动画容器内
    - _Requirements: 12.1, 12.2, 12.3, 1.3_

  - [x] 3.2 改造进度条为 2px 细线 + Space Grotesk 数字
    - 修改 `src/app/merchant/stores/[storeId]/page.tsx` 中的拍摄进度展示
    - 进度条：height:2px, background:var(--ll-hair) 底色 + var(--ll-green) 填充
    - 进度数字：font-family:var(--font-num), font-size:24px, color:var(--ll-green), tabular-nums
    - 分母展示：font-size:14px, color:var(--ll-text-3)，格式「已完成/总数」
    - 进度条宽度变化使用 CSS transition + var(--ease-out) + 600ms
    - 移除旧的 h-2 + bg-orange-100/bg-orange-500 样式
    - _Requirements: 10.1, 10.2, 10.3, 5.4, 1.5_

  - [x] 3.3 改造周计划为节气式七日布局
    - 修改 `src/app/merchant/stores/[storeId]/page.tsx` 中的周计划区域
    - 竖向排列：星期标签 → 状态圆点 → 任务目标文字
    - 状态圆点：已完成=7px 实心绿, 今日=10px 空心绿环+脉冲动画, 未来=7px 空心灰
    - 移除所有 emoji（🔥✨📋）替换为纯文字标签（10-11px, color:var(--ll-text-3)）
    - 移除彩色圆角格子和 emoji 装饰
    - _Requirements: 11.1, 11.2, 11.3_

  - [x] 3.4 去卡片化——Hairline Separator 替代 Card 包裹
    - 修改 `src/app/merchant/stores/[storeId]/page.tsx` 中的内容区块
    - 将 shadcn Card 组件包裹替换为 section + border-top:1px solid var(--ll-hair) + padding
    - 移除所有 bg-gradient-to-br from-orange-50 to-amber-50 等渐变背景色
    - 统一使用 var(--canvas) 纯色底
    - 为每个内容区块添加 `.zen-reveal` 类实现 stagger 入场
    - _Requirements: 6.1, 6.2, 5.2_

  - [x] 3.5 统一门店首页图标为 lucide-react strokeWidth 1.5
    - 修改 `src/app/merchant/stores/[storeId]/page.tsx` 及其子组件
    - 移除所有功能性 emoji（🏆/🔥 等），替换为 lucide-react 图标（如 Trophy、Flame）
    - 统一所有 lucide 图标 strokeWidth 为 1.5
    - 确保图标尺寸遵循三档：辅助 16px、正文行内 20px、独立功能 24px
    - _Requirements: 2.1, 2.3, 2.4, 14.3_

  - [x] 3.6 门店首页字体体系应用
    - 修改 `src/app/merchant/stores/[storeId]/page.tsx`
    - 所有 hero/章节标题使用 font-family:var(--font-serif)
    - 正文/UI/表单使用 Noto Sans SC（默认 sans）
    - 数据数字（播放量、积分、待办数、进度百分比）使用 font-family:var(--font-num) + tabular-nums + letter-spacing:-0.02em
    - _Requirements: 1.3, 1.5_

- [x] 4. Checkpoint - 门店首页视觉验证
  - 确保门店首页完整呈现 v3 禅意风格：签名细节、2px 进度条、节气式周计划、hairline 分隔、lucide 图标。确保所有测试通过，ask the user if questions arise.

- [x] 5. 全局组件改造
  - [x] 5.1 改造 Bottom Nav 底部导航
    - 修改 `src/app/merchant/layout.tsx` 中的底部导航组件
    - 背景：backdrop-filter:blur(16px) + background:rgba(244,242,237,.88) + border-top:1px solid var(--ll-hair)
    - 图标：lucide-react strokeWidth 1.5、尺寸 24px
    - 选中态：仅 color:var(--ll-green)，文字 font-weight:600，禁止 scale/bounce 动画
    - 非选中态：color:var(--ll-text-3)
    - 为每个导航项添加语义化 aria-label 属性
    - _Requirements: 9.2, 9.3, 9.4, 2.2, 15.4_

  - [x] 5.2 改造 Header 顶栏
    - 修改 `src/app/merchant/layout.tsx` 中的顶栏组件
    - 门店名称使用 Noto Serif SC：font-family:var(--font-serif), font-size:18px, font-weight:600, letter-spacing:.02em
    - _Requirements: 9.1_

  - [x] 5.3 创建 Empty State 空态插画组件
    - 创建 `src/components/merchant/EmptyState.tsx` 组件
    - 接口：illustration（cooking/checklist/upload/video）+ title + description
    - 插画使用单色 SVG（主色 #00754A），配合 Noto Serif SC 衬线标题 + 一句话引导文案
    - 创建 `public/illustrations/` 目录并放入至少 3 个 MIT 授权 SVG 插画文件（empty-video、empty-calendar、onboarding-shoot）
    - 不使用渐变背景或多色装饰
    - _Requirements: 3.1, 3.2, 3.3_

  - [x] 5.4 创建 Zen_Button 按钮组件
    - 创建 `src/components/merchant/ZenButton.tsx` 组件
    - Primary 样式：background:var(--ll-green), color:#FFFFFF, border-radius:3px, padding:16px, font-size:15px, font-weight:500, letter-spacing:.04em
    - :active 状态：background:var(--ll-green-deep) + transform:scale(0.97)，transition 预声明在元素上
    - Ghost 样式：transparent 背景, color:var(--ll-text-2), border-bottom:1px solid var(--ll-hair), :active → color:var(--ll-green)
    - _Requirements: 7.1, 7.2, 7.3, 5.3_

  - [x] 5.5 门店首页集成空态与按钮组件
    - 修改 `src/app/merchant/stores/[storeId]/page.tsx`
    - 在数据为空场景（无今日任务、无成片、无内容计划）中使用 EmptyState 组件
    - 将主操作按钮替换为 Zen_Button primary
    - 将次级按钮替换为 Zen_Button ghost
    - 移除所有 bg-orange-600/bg-orange-700/border-amber-* 旧色按钮样式
    - _Requirements: 3.1, 3.3, 7.3, 7.4_

- [x] 6. Checkpoint - 全局组件验证
  - 确保 Bottom Nav、Header、EmptyState、Zen_Button 组件在门店首页正确渲染。确保所有测试通过，ask the user if questions arise.

- [x] 7. 全页面风格推广
  - [x] 7.1 日历页风格统一
    - 修改 `src/app/merchant/stores/[storeId]/calendar/page.tsx`
    - 应用 serif 标题、hairline 分隔、lucide 图标 strokeWidth 1.5、--ll-* 语义变量
    - 移除 orange/amber 硬编码色值和渐变背景
    - _Requirements: 14.1, 14.2_

  - [x] 7.2 今日任务页风格统一
    - 修改 `src/app/merchant/stores/[storeId]/today/page.tsx`
    - 应用 serif 标题、hairline 分隔、zen-reveal 入场动效、Zen_Button
    - 移除 emoji 功能图标，替换为 lucide-react strokeWidth 1.5
    - _Requirements: 14.1, 14.2, 2.3_

  - [x] 7.3 会员页风格统一
    - 修改 `src/app/merchant/stores/[storeId]/membership/page.tsx`
    - 应用品牌色彩体系、金色会员区域 .ll-gold-ambient 氛围底色
    - 使用 serif 标题、hairline 分隔、Zen_Button
    - _Requirements: 14.1, 14.2, 4.4_

  - [x] 7.4 设置页风格统一
    - 修改 `src/app/merchant/stores/[storeId]/settings/page.tsx`
    - 应用 serif 标题、hairline 分隔、3px 圆角输入框
    - 统一使用 --ll-* 语义变量
    - _Requirements: 14.1, 14.2_

  - [x] 7.5 成长/数据复盘页风格统一
    - 修改 `src/app/merchant/stores/[storeId]/growth/page.tsx`
    - 数据数字使用 Space Grotesk + tabular-nums
    - 应用 serif 标题、hairline 分隔、lucide 图标
    - _Requirements: 14.1, 14.2, 1.5_

  - [x] 7.6 任务中心页与发布队列页风格统一
    - 修改 `src/app/merchant/stores/[storeId]/task-center/page.tsx` 和 `publish-queue/page.tsx`
    - 应用 serif 标题、hairline 分隔、zen-reveal 入场、Zen_Button
    - 移除 emoji 功能图标
    - _Requirements: 14.1, 14.2, 2.3_

  - [x] 7.7 Onboarding 问诊页风格统一
    - 修改 `src/app/merchant/onboarding/page.tsx`
    - 应用 serif 标题、3px 圆角、EmptyState 引导插画、Zen_Button
    - _Requirements: 14.1, 14.2_

- [x] 8. 色彩硬编码清理与作用域隔离验证
  - [x] 8.1 清理 orange/amber 硬编码色值
    - 全局搜索并替换商家端组件中所有 text-orange-*/bg-orange-*/text-amber-*/border-amber-* Tailwind 工具类
    - 替换为 --ll-* CSS 变量引用或 shadcn 组件默认样式
    - 移除 .ll-root 中对 --color-orange-*/--color-amber-*/--color-gray-* 的覆盖映射
    - _Requirements: 8.2, 8.3_

  - [x] 8.2 添加 CSS lint 规则检测残留硬编码
    - 在项目 lint 配置中新增规则：检测商家端组件中 orange-*/amber-* 硬编码色值
    - 设为 warning 级别，不阻断构建
    - 检测 lucide 图标 strokeWidth 非 1.5 的用法
    - _Requirements: 8.4, 7.4_

  - [x] 8.3 作用域隔离验证与 --cine-* 变量替换
    - 检查商家端组件中是否引用了 --cine-* 变量，替换为对应 --ll-* 语义变量
    - 验证 /dashboard 页面 --radius 仍为原值（非 3px）
    - 验证 /dashboard 无噪点纹理伪元素
    - 确认 .ll-root 容器类作为商家端样式作用域边界完整有效
    - _Requirements: 13.1, 13.2, 13.3, 13.4_

- [x] 9. Checkpoint - 全页面风格一致性验证
  - 确保所有商家端页面风格统一：字体体系、色彩体系、图标风格、分隔线风格一致。确保所有测试通过，ask the user if questions arise.

- [x] 10. 质量验证与测试
  - [x]* 10.1 编写 Playwright CSS Token 单元测试
    - 验证 .ll-root 内 --radius 计算值为 3px
    - 验证 --font-serif / --font-num 变量已声明且非空
    - 验证 --ease-out / --dur-slow 变量存在
    - 验证 /dashboard 页面 --radius 不为 3px（隔离验证）
    - _Requirements: 13.1, 1.2, 5.1_

  - [x]* 10.2 编写 WCAG AA 对比度验证测试
    - 验证白字(#FFFFFF) on 绿底(#00754A) 对比度 ≥ 4.5:1
    - 验证主文字(rgba(0,0,0,.87)) on 画布(#F4F2ED) 对比度 ≥ 4.5:1
    - 验证次文字(rgba(0,0,0,.58)) on 画布(#F4F2ED) 对比度 ≥ 4.5:1
    - _Requirements: 15.1, 15.2, 15.3_

  - [x]* 10.3 编写字体加载验证测试
    - 使用 Playwright page.evaluate 验证 document.fonts.check 返回 true
    - 验证 Noto Serif SC、Noto Sans SC、Space Grotesk 字体文件成功加载
    - _Requirements: 1.1_

  - [x]* 10.4 编写 prefers-reduced-motion 降级测试
    - 验证 prefers-reduced-motion:reduce 时 .zen-reveal 无动画
    - 验证 prefers-reduced-motion:reduce 时噪点纹理隐藏
    - _Requirements: 5.5_

  - [x]* 10.5 Playwright 视觉截图存档
    - 门店首页（有数据态）截图存档
    - 门店首页（空态）截图存档
    - 底部导航选中/非选中态截图存档
    - 供人工目视比对确认视觉还原度
    - _Requirements: 14.1, 14.2_

- [x] 11. Final Checkpoint - 全量验证
  - 确保所有测试通过，WCAG AA 对比度达标，作用域隔离完整，/dashboard 不受影响。Ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- 本特性为纯前端 UI 改造，不涉及数据库 schema 变更或后端 API 修改
- 所有改造严格限定在 `.ll-root` 作用域内，不影响视频重塑端（/dashboard）
- 不引入任何 JavaScript 动画库（framer-motion/motion），全部使用纯 CSS
- 对比度验证使用 WebAIM Contrast Checker 算法，确保 WCAG AA 达标
- 参考原型：`design-demos/home-v3-zen-full.html`
- SVG 插画需使用 MIT 授权来源（unDraw/DrawKit），主色统一为 #00754A

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["1.3", "1.4", "1.5"] },
    { "id": 2, "tasks": ["3.1", "3.2", "3.3", "3.4", "3.5", "3.6"] },
    { "id": 3, "tasks": ["5.1", "5.2", "5.3", "5.4"] },
    { "id": 4, "tasks": ["5.5"] },
    { "id": 5, "tasks": ["7.1", "7.2", "7.3", "7.4", "7.5", "7.6", "7.7"] },
    { "id": 6, "tasks": ["8.1", "8.3"] },
    { "id": 7, "tasks": ["8.2"] },
    { "id": 8, "tasks": ["10.1", "10.2", "10.3", "10.4", "10.5"] }
  ]
}
```
