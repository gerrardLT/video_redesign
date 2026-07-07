# Implementation Plan: AI 角色外观状态变化自动识别

## Overview

在现有视频解析→生成链路中嵌入角色外观感知层。实现路径：数据层变更 → 核心比对模块 → 解析阶段扩展 → 生成阶段增强 → 承接阶段适配。全流程零用户操作，失败时优雅降级（外观设为空数组继续主流程）。

## Tasks

- [x] 1. 数据层与类型定义
  - [x] 1.1 扩展 Prisma Schema 添加 Shot.characterAppearances 字段
    - 在 `prisma/schema.prisma` 的 Shot 模型中新增 `characterAppearances String? @map("character_appearances")` 字段
    - 执行 `npx prisma migrate dev` 生成迁移文件
    - 执行 `npx prisma generate` 重新生成客户端
    - _Requirements: 2.1_

  - [x] 1.2 创建 AppearanceDescriptor 类型和 Zod Schema
    - 在 `src/types/` 目录新建 `appearance.ts`，定义 `AppearanceDescriptor` 接口和 `CharacterAppearanceRecord` 类型
    - 在 `src/lib/` 目录新建 `shot-schema.ts`（或扩展已有 schema），定义 `AppearanceDescriptorSchema` 和 `CharacterWithAppearanceSchema`
    - `AppearanceDescriptorSchema` 四个字段均使用 `z.string().default('')`
    - _Requirements: 1.1, 1.2, 1.4_

- [x] 2. 核心模块：外观比对器
  - [x] 2.1 实现 appearance-comparator.ts 基础函数
    - 新建 `src/lib/appearance-comparator.ts`
    - 实现 `normalizeAppearanceText(text: string): string` — 去除首尾空白、统一小写、移除标点符号（中英文标点）
    - 实现 `hasAppearanceChanged(prev, next): boolean` — 逐维度比对，空字符串维度忽略，规范化后比较
    - 实现 `hasGroupAppearanceChanged(prevAppearances, nextAppearances): boolean` — 提取共有角色集合，任一变化返回 true，无共有角色返回 false
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [x]* 2.2 编写属性测试：外观比对算法正确性
    - **Property 5: 外观比对算法正确性**
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4**
    - 文件: `src/__tests__/appearance-comparator.property.test.ts`
    - 使用 fast-check 生成两个 AppearanceDescriptor（含空/非空/大小写/标点变体），验证 `hasAppearanceChanged` 返回值与手动逐维度计算结果一致

  - [x] 2.3 实现 aggregateGroupAppearances 聚合函数
    - 在 `src/lib/appearance-comparator.ts` 中实现按维度取众数逻辑
    - 对组内所有 Shot 的同一角色同一维度，统计非空描述出现次数，取频率最高者；平局时取首次出现
    - 所有值均为空字符串时该维度结果为空字符串
    - _Requirements: 2.3_

  - [x]* 2.4 编写属性测试：组级外观聚合取众数
    - **Property 2: 组级外观聚合取众数**
    - **Validates: Requirements 2.3**
    - 文件: `src/__tests__/appearance-aggregation.property.test.ts`
    - 使用 fast-check 生成 N 个 Shot 的外观列表，验证每个维度返回值为出现频率最高的非空描述

  - [x] 2.5 实现 formatAppearancePrompt 格式化函数
    - 在 `src/lib/appearance-comparator.ts` 中实现
    - 格式：「本镜头中{角色名}的造型：{各维度非空描述拼接}」
    - 总长度控制在 maxLength（默认 80）字符以内，超长时从末尾截断加省略号
    - _Requirements: 3.4_

  - [x]* 2.6 编写属性测试：外观文案长度约束
    - **Property 4: 外观文案长度约束**
    - **Validates: Requirements 3.4**
    - 文件: `src/__tests__/appearance-prompt.property.test.ts`
    - 使用 fast-check 生成随机长度的中文/英文角色名和外观描述，验证 `formatAppearancePrompt` 返回值长度 ≤ 80

  - [x]* 2.7 编写属性测试：AppearanceDescriptor Schema 验证
    - **Property 1: AppearanceDescriptor Schema 验证**
    - **Validates: Requirements 1.1, 1.2, 1.4**
    - 文件: `src/__tests__/appearance-descriptor.property.test.ts`
    - 使用 fast-check 生成随机 4 字段对象（含有效/无效/部分为空变体），验证 Zod Schema 的 safeParse 结果符合预期

- [x] 3. Checkpoint - 核心模块验证
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. 解析阶段扩展：Video Analyzer
  - [x] 4.1 扩展 video-analyzer.ts 系统提示词和 Schema
    - 在 `src/lib/video-analyzer.ts` 的 `SYSTEM_PROMPT` 中追加 `appearanceDetail` 字段说明，指导模型按四维度（hair/clothing/accessories/makeup）输出
    - 扩展 `characters` 数组的 Zod Schema，新增 `appearanceDetail: AppearanceDescriptorSchema.optional()` 字段
    - 在 Zod 校验失败时触发现有 repair retry 机制（不需新增逻辑，依赖已有管道）
    - _Requirements: 1.1, 1.3, 1.4_

  - [x] 4.2 扩展 parse-video Worker 持久化外观数据
    - 在 `src/workers/parse-video.ts` 中，解析完成后将 `characters[].appearanceDetail` 转换为 `CharacterAppearanceRecord` 格式
    - 将其序列化为 JSON 字符串写入 `Shot.characterAppearances` 字段
    - AI 模型超时/异常时，将 `characterAppearances` 设为空数组 JSON（`"[]"`），不阻塞解析流程
    - _Requirements: 2.1, 2.2, 6.1, 6.4_

  - [x]* 4.3 编写单元测试：解析阶段外观提取
    - 测试 SYSTEM_PROMPT 中包含 `appearanceDetail` 结构说明
    - 测试正常解析时 characterAppearances 正确写入
    - 测试 AI 异常/超时时 characterAppearances 为空数组不阻塞
    - _Requirements: 1.1, 1.2, 6.4_

- [x] 5. 生成阶段扩展：Group Gen Context
  - [x] 5.1 扩展 group-gen-context.ts 追加外观描述到 prompt
    - 在 `src/lib/group-gen-context.ts` 的 `buildGroupGenReference` 函数中：
      - 读取组内所有 Shots 的 `characterAppearances`（JSON 解析，失败时视为空数组）
      - 调用 `aggregateGroupAppearances` 获取组级代表外观
      - 对每个角色，将组外观与全局 `Character.appearance` 比对（经 `normalizeAppearanceText` 规范化）
      - 一致时跳过追加；差异时调用 `formatAppearancePrompt` 生成文案拼接到 `characterPrefix`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 6.2_

  - [x]* 5.2 编写属性测试：Prompt 外观追加决策
    - **Property 3: Prompt 外观追加决策**
    - **Validates: Requirements 3.2, 3.3**
    - 文件: `src/__tests__/appearance-prompt.property.test.ts`
    - 使用 fast-check 生成 (全局外观, 组外观) 对，验证追加/跳过逻辑正确

  - [x]* 5.3 编写单元测试：group-gen-context 外观集成
    - 测试外观差异时 prompt 包含「本镜头中{角色名}的造型：」格式文案
    - 测试外观一致时 prompt 不包含外观文案
    - 测试 characterAppearances JSON 解析失败时正常降级
    - _Requirements: 3.1, 3.2, 3.3_

- [x] 6. 承接阶段扩展：Frame Continuity
  - [x] 6.1 扩展 frame-continuity.ts 追加外观比对
    - 在 `src/lib/frame-continuity.ts` 的 `applySameSceneContinuation` 函数中：
      - 同场景判定通过后，读取前一组和当前组的 `characterAppearances`
      - 调用 `aggregateGroupAppearances` 分别获取两组的角色外观 Map
      - 调用 `hasGroupAppearanceChanged` 判定是否存在外观变化
      - 外观变化时返回 `{ applied: false }`，即使同场景也不承接
      - 无共有角色时不影响承接决策（按原有逻辑）
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 6.3_

  - [x]* 6.2 编写属性测试：基于外观变化的承接跳过决策
    - **Property 6: 基于外观变化的承接跳过决策**
    - **Validates: Requirements 4.2, 4.3, 4.4**
    - 文件: `src/__tests__/appearance-continuity.property.test.ts`
    - 使用 fast-check 生成相邻组的角色外观数据（有/无共有角色，一致/差异），验证承接决策正确

  - [x]* 6.3 编写单元测试：frame-continuity 外观集成
    - 测试同场景+外观差异时 applied=false
    - 测试同场景+外观一致时按原逻辑承接
    - 测试无共有角色时不影响承接
    - 测试 characterAppearances 为空时不影响承接
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

- [x] 7. Final checkpoint - 全流程验证
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- 所有代码变更使用 TypeScript 严格模式，Zod v4 做 schema 校验
- 外观提取是增强功能，其失败不阻塞核心视频解析/生成流程
- 外观数据缺失时所有下游模块回退到「无外观感知」模式（即现有行为不变）
- 属性测试使用 fast-check，最少 100 次迭代，文件命名 `*.property.test.ts`
- Prisma schema 变更需执行迁移命令，注意不要手动编辑 `prisma/migrations/`

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["2.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "2.5", "2.7"] },
    { "id": 3, "tasks": ["2.4", "2.6"] },
    { "id": 4, "tasks": ["4.1", "4.2"] },
    { "id": 5, "tasks": ["4.3", "5.1"] },
    { "id": 6, "tasks": ["5.2", "5.3", "6.1"] },
    { "id": 7, "tasks": ["6.2", "6.3"] }
  ]
}
```
