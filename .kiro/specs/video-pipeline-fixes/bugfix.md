# Bug 修复需求文档

## Introduction

本文档针对 AI 视频二次创作平台（Next.js 15 + Prisma 7 + SQLite + BullMQ/Redis + 阿里云 OSS + FFmpeg + 火山引擎 Seedance 2.0）核心流程（导入/上传 → 解析 → 编辑 → 按组生成 → 合并导出）中，经代码审查确认的 13 个缺陷进行修复。每个缺陷均基于真实代码证据，覆盖计费、状态一致性、配置/文档、安全与架构健壮性五大类。

修复必须遵守用户铁律：业务使用真实接口、真实流程，禁止 fallback / 静默处理 / 假数据；修改代码必须同步更新对应注释，不留过时或与代码不符的注释。

修复优先级（影响下游任务排序）：先堵计费漏洞（缺陷 1/2/3/4）→ 再统一状态与配置（缺陷 5/6/7/9）→ 最后音频策略、架构与安全加固（缺陷 8/10/11/12/13）。

> 说明：本文档仅描述缺陷的当前行为、期望行为与需保持不变的行为。具体技术方案、文件级改动、Bug 条件与属性形式化（C(X)/P(result)/F/F'）将在 design.md 中给出。

## Bug Analysis

### Current Behavior (Defect)

当前系统在以下条件下表现出缺陷行为（编号 1.N 与下方 Expected 的 2.N 一一对应同一条件）：

1.1 WHEN 用户积分余额为 0 或不足以支付解析预估成本时触发视频解析 THEN 系统仍执行完整解析流程（多模态直传分析、OSS、FFmpeg），仅在解析成功后才扣费，且 `chargeParseCreditsTx` 在余额不足时兜底扣至 0（`actualCharge = Math.min(balance, amount)`），使零余额用户可无限触发解析、平台白白消耗外部成本（解析前缺少余额预检查/冻结）

1.2 WHEN 任意视频解析计费时 THEN 系统按 `estimateParseCreditCost = ceil(duration × 0.5) + 10` 收费，其中固定 `+10`（`PARSE_FIRST_FRAME_COST`）按注释对应"第一组 Seedream 首帧图生成"，但 `parse-video.ts` 第 7 步已明确废弃 first_frame 流程、不再生成首帧，导致每次解析多扣 10 积分且无对应外部消费（过时注释 + 错误计费）

1.3 WHEN 解析阶段进行扣费时 THEN 系统采用"不冻结、不预检、事后扣、可欠费（兜底扣至 0）"模式，与生成阶段完整的 `RESERVE`（创建即冻结）→ `CHARGE` → `REFUND` 模型不一致，两套扣费哲学并存

1.4 WHEN 项目级分段生成任务 `processProjectSegmentGenerate` 在队列重试（`attempts=3`）时已存在该 jobId 的 CHARGE 记录 THEN 系统仍在事务内直接 `create` CHARGE，缺少 `existingCharge` 幂等检查（按组路径 `atomicSuccessUpdate` 已有该检查），可能重复写入 CHARGE 重复扣费；且 CHARGE 逻辑被复制三份（`chargeCredits`、`atomicSuccessUpdate` 内联、项目级内联），维护风险高

1.5 WHEN worker 执行 `QUEUED → GENERATING → SUCCEEDED → FAILED` 等真实状态转换时 THEN 系统直接 `update({ status })` 写入，绕过 `assertTransition` 校验（该校验实际仅在 `jobs/retry`、`jobs/cancel` 两个 API 路由调用），与 `state-machine.ts` 注释声称的"在关键写状态处强制校验"不符

1.6 WHEN 视频合并 `merge-video` 失败时 THEN 系统实际写入 `status: 'FAILED'`，而该处注释声称写入"MERGE_FAILED（区别于生成 FAILED，允许用户只重试合并）"，且 `MERGE_FAILED` 不在 `ProjectStatus` 枚举中，导致无法区分合并失败与生成失败、无法实现"只重试合并"

1.7 WHEN 检视 `ProjectStatus` 枚举时 THEN 存在 `PARTIAL`、`COMPLETED` 两个状态定义，但无任何 worker 写入（真实流程为 `EDITABLE → GENERATING → EXPORTED`），属语义不明的疑似死状态

1.8 WHEN 成片合并需要确定音轨时 THEN 系统并存三套音频来源——解析阶段按组切 `audioKey` 存入 `ShotGroup`、Seedance `generate_audio` 用对白做 TTS 配音、`merge-video` 在片段无音频时又从原始整段视频重新提取音频混入——最终成片采用哪条音轨、是否音画同步无明确策略，存在串味/错位风险

1.9 WHEN 开发者按 `.env.example` 配置并运行项目时 THEN 配置脱节导致跑不起来：代码 `video-analyzer.ts` 强依赖 `VISION_API_URL`/`VISION_API_KEY`/`VISION_MODEL`（缺失即抛错、明确无 Mock），但 `.env.example` 完全没有这三个变量，反而保留 `GEMINI_API_KEY` 留空并标注"使用 Mock 模式返回模拟分镜数据"的误导说明，还残留已废弃的 `FLUX_API_KEY` 与 meai.cloud Seedream 表述（违反"无 fallback / 无假数据"铁律）

1.10 WHEN 任意用户访问 `public/uploads/...` 下的 URL 时 THEN 所有 worker 写入该目录的临时文件、封面、按组音频、生成结果、人物头像等被 Next.js 无鉴权静态公开，用户原视频/AI 生成结果/人物头像可被任意 URL 访问（即使同时上传了 OSS，本地公开副本仍是隐私与盗刷隐患）

1.11 WHEN 生成 worker（`concurrency=5`）、合并、链式续接并发写积分账本（`creditLedger`）与状态时 THEN SQLite 单写锁下产生锁竞争（`db-retry.ts` 的存在印证该痛点），高并发积分事务存在可靠性风险

1.12 WHEN 生成 worker 单任务最长轮询 10 分钟（`MAX_POLL_TIME`）而未调大 BullMQ `lockDuration`（默认 stalled 检测约 30s）时 THEN 任务可能被误判为 stalled 并被重复派发（当前依赖分布式锁兜底掩盖该问题）

1.13 WHEN 检视 `ShotGroup.firstFrameUrl` 字段及其注释时 THEN 注释仍声称该字段"作为 Seedance first_frame"，但 first_frame 流程已全面废弃（改用 `asset://` 人物锚定图作 reference_image），属死字段 + 过时注释（与缺陷 2 同源，为一次重构未清理干净的残留）

### Expected Behavior (Correct)

修复后系统在相同条件下应表现出以下正确行为（编号 2.N 对应上方 1.N）：

2.1 WHEN 用户积分余额不足以支付解析预估成本时触发视频解析 THEN 系统 SHALL 在解析开始前（消耗任何外部资源前）校验余额，余额不足时拒绝触发/入队并明确提示积分不足，绝不消耗多模态/OSS/FFmpeg 成本，也绝不兜底扣至 0 让零余额用户白嫖

2.2 WHEN 任意视频解析计费时 THEN 系统 SHALL 仅对真实发生的外部消费计费——移除已废弃首帧图对应的 `+10` 固定成本，并同步更新 `estimateParseCreditCost` 的注释使其与真实计费口径一致，不留过时描述

2.3 WHEN 解析阶段进行扣费时 THEN 系统 SHALL 对齐生成阶段的扣费范式：解析前先做余额预检查（必要时冻结），不允许欠费、不兜底扣至 0，使解析与生成采用一致的扣费哲学

2.4 WHEN 项目级分段生成任务执行扣费时 THEN 系统 SHALL 在写入 CHARGE 前进行 `existingCharge` 幂等检查（与按组路径一致），确保重试时不重复扣费；并将三处重复的 CHARGE 逻辑收敛为单一可复用实现以降低维护风险

2.5 WHEN worker 执行关键状态写入（`QUEUED → GENERATING → SUCCEEDED → FAILED` 等）时 THEN 系统 SHALL 经 `assertTransition` 校验合法转换后再写入；若选择不在 worker 强制校验，则 SHALL 同步修正 `state-machine.ts` 注释使其与真实调用点一致，不留与代码不符的注释

2.6 WHEN 视频合并失败时 THEN 系统 SHALL 写入可与生成失败区分的合并失败状态——在 `ProjectStatus` 枚举中新增 `MERGE_FAILED` 并在合并失败处真实落地写入，使用户能在不重新生成的前提下只重试合并；相关注释与重试语义保持一致

2.7 WHEN 检视 `ProjectStatus` 枚举时 THEN 系统 SHALL 明确 `PARTIAL`、`COMPLETED` 的归属：要么实现其语义并落地真实写入点，要么作为遗留枚举清理移除，并同步相关注释与文档

2.8 WHEN 成片合并确定音轨时 THEN 系统 SHALL 明确单一、确定的音频来源优先级与音画同步策略（哪条音轨为准、如何对齐），消除三源叠加导致的串味/错位，且不静默丢弃或伪造音轨

2.9 WHEN 开发者按 `.env.example` 配置项目时 THEN 系统 SHALL 提供与真实代码一致的环境变量清单：包含 `VISION_API_URL`/`VISION_API_KEY`/`VISION_MODEL` 等必填项及说明，移除 `GEMINI_API_KEY` 的 Mock 模式误导说明与已废弃的 `FLUX`/Seedream 残留表述，使按其配置即可真实运行

2.10 WHEN 访问用户私有媒体资源（原视频、封面、按组音频、生成结果、人物头像等）时 THEN 系统 SHALL 通过鉴权访问控制保护这些资源，不将私有产物置于 Next.js 无鉴权公开目录（或不保留可被任意 URL 访问的本地公开副本），消除隐私与盗刷隐患

2.11 WHEN 生成、合并、链式续接高并发写积分账本与状态时 THEN 系统 SHALL 提供可承载并发事务的方案（迁移到支持并发写的数据库，或对关键写显式串行化/排队），保证积分账本与状态的一致性和可靠性

2.12 WHEN 生成任务长时间（最长 10 分钟）轮询时 THEN 系统 SHALL 配置与轮询时长相匹配的 BullMQ `lockDuration` / stalled 检测参数，避免任务被误判 stalled 而重复派发（不再仅依赖分布式锁掩盖）

2.13 WHEN 检视首帧相关字段与逻辑时 THEN 系统 SHALL 清理已废弃的 `firstFrameUrl` 字段及相关残留逻辑，并同步更新/删除对应注释，使代码与"first_frame 已废弃、改用 asset:// 人物锚定图"的真实流程一致

### Unchanged Behavior (Regression Prevention)

修复过程中，以下未触发上述缺陷的行为必须保持不变：

3.1 WHEN 用户积分余额充足时触发视频解析 THEN 系统 SHALL CONTINUE TO 正常完成解析（多模态分析、分组、抽缩略图、按组切音频）、按真实消费扣费并置项目为 `EDITABLE`

3.2 WHEN 按组生成路径 `atomicSuccessUpdate` 执行扣费时 THEN 系统 SHALL CONTINUE TO 保持幂等（`existingCharge` 检查、`RESERVE → CHARGE` 并对多冻结部分 `REFUND` 差额）

3.3 WHEN 生成任务成功或失败时 THEN 系统 SHALL CONTINUE TO 正确执行既有的 `RESERVE` 冻结、`CHARGE` 扣费、`REFUND` 退款积分流转（含链式失败兜底 `failProjectChain` 退还下游冻结积分）

3.4 WHEN 视频生成成功并完成全部分镜组时 THEN 系统 SHALL CONTINUE TO 触发合并并在合并成功后置项目为 `EXPORTED`

3.5 WHEN `jobs/retry`、`jobs/cancel` API 路由触发状态转换时 THEN 系统 SHALL CONTINUE TO 经 `assertTransition` 校验合法性

3.6 WHEN 充值 `topupCredits` 按 `orderId` 处理时 THEN 系统 SHALL CONTINUE TO 保持幂等，正确入账且不重复充值

3.7 WHEN 解析/生成/合并产物上传 OSS 时 THEN 系统 SHALL CONTINUE TO 正常写入 OSS 并可通过 OSS URL 被前端正常访问

3.8 WHEN `merge-video` 检测到项目已为 `EXPORTED` 时 THEN 系统 SHALL CONTINUE TO 幂等跳过重复合并
