# 技术栈变更记录

> 本文档记录项目技术选型的重要变更，以便阅读早期设计文档（如 `完整方案/1.md`、`MVP-技术方案与成本分析报告.md`）时对照理解。

---

## 2026-06 技术栈现状

| 模块 | 当前技术 | 早期方案文档中的描述 | 变更原因 |
|------|---------|-------------------|---------|
| **AI 视频解析** | 多模态视频直传分析（推荐 `doubao-seed-2-0-pro-260215`，备选 `qwen-vl-max`；由 `VISION_MODEL` 配置） | Gemini 2.5 Flash multimodal | 视频 URL 直传、中文理解更强、国内直连无需科学上网 |
| **AI 视频生成** | Seedance 2.0 (`doubao-seedance-2-0-260128`) | Seedance 1.0 Pro (`doubao-seedance-1-0-pro-250528`) | 2.0 原生多模态音视频联合生成，物理准确性大幅提升 |
| **AI 图片生成** | Seedream 5.0 (`doubao-seedream-5-0-260128`) | FLUX Pro / Seedream 3.0 | 5.0 质量更高，字节原生生态一致 |
| **API 中转** | 火山引擎方舟直连 (`ark.cn-beijing.volces.com/api/v3`) | 火山引擎方舟直连 / fal.ai | 视频生成（Seedance）与生图（Seedream）均直连方舟，同账号以满足人脸审核受信前提 |
| **Seedance API Key** | 火山引擎方舟 API Key (`SEEDANCE_API_KEY`) | 火山引擎 API Key | Header：`Authorization: Bearer {SEEDANCE_API_KEY}` |
| **数据库** | PostgreSQL 16 (`@prisma/adapter-pg`) + Prisma 7.8 | SQLite (libsql) | 多用户并发下 PostgreSQL 行级锁 + MVCC 优于 SQLite 单写锁模型 |
| **队列** | BullMQ + Redis | 同（未变） | — |
| **前端** | Next.js 15 + Zustand + shadcn/ui | 同（未变） | — |
| **支付** | 微信支付 V3 + 支付宝开放平台（签约代扣） | 同（设计阶段） | 已完成实现 |

---

## Seedance 模型版本对照

| 文档中出现的模型名 | 实际对应 / 当前状态 |
|------------------|-------------------|
| `doubao-seedance-1-0-pro-250528` | Seedance 1.0 Pro（已不使用，保留备用） |
| `doubao-seedance-1-0-pro-fast-251015` | 1.0 快速版（已弃用） |
| `doubao-seedance-1-5-pro-251215` | 1.5 Pro，支持音频生成（已被 2.0 替代） |
| **`doubao-seedance-2-0-260128`** | ✅ 当前使用的生产模型 |
| `doubao-seedance-2-0-fast-260128` | 2.0 快速版（备选，速度优先场景） |

---

## Seedream 模型版本对照

> 生图代码实现位于 `src/lib/flux.ts`（沿用旧文件名，实际对接火山方舟 Seedream 5.0 lite，可用 `IMAGE_MODEL_ID` 覆盖模型）。

| 文档中出现的模型名 | 实际对应 / 当前状态 |
|------------------|-------------------|
| FLUX Pro | 已弃用，替换为 Seedream |
| `doubao-seedream-3-0-t2i-250415` | 3.0 文生图（已不使用） |
| `doubao-seedream-4-0-250828` | 4.0（保留可用） |
| `doubao-seedream-4-5-251128` | 4.5（保留可用） |
| **`doubao-seedream-5-0-260128`** | ✅ 当前使用的生产模型 |

---

## 关于文档中的 "Gemini" 引用

早期方案文档中大量提到 Gemini（Google 多模态 AI），包括：
- Gemini multimodal 视频理解
- Gemini 帧分析 API
- Gemini JSON 结构化输出
- Gemini 时间戳提取

**现已全部替换为多模态视频直传分析（Doubao-Seed-2.0-Pro / Qwen-VL 等）**，功能等价但更适合中文场景。代码中的实际实现位于 `src/lib/video-analyzer.ts`（原 `src/lib/gemini.ts` 已重构删除）。

核心差异：
| 特性 | Gemini (旧) | 当前实现 |
|------|------------|-------------|
| 推荐模型 | gemini-2.5-flash | doubao-seed-2-0-pro-260215（火山方舟，视频理解强） |
| 备选模型 | — | qwen-vl-max（DashScope，成本低一档） |
| API 格式 | Google AI Studio / Vertex | OpenAI 兼容（火山方舟 / dashscope） |
| 视频输入 | 视频 URL 直传 | 视频 URL 直传（`video_url`，无需抽帧） |
| 中文能力 | 中等 | 优秀 |
| 网络要求 | 需科学上网 | 国内直连 |

注：早期一度采用「Base64 帧图片数组」的抽帧方案，现已改为把 OSS 视频 URL 直传给多模态模型（模型可看到完整运动+听到音频），解析更精准。

---

## 关于文档中的 "FLUX" 引用

早期文档提到 FLUX Pro 用于人物形象生成。已替换为 Seedream 5.0 lite，原因：
- Seedream 与 Seedance 同属字节生态，风格一致性更好
- 中文提示词理解更准确
- 与 Seedance 视频生成同账号直连火山方舟（复用 `SEEDANCE_API_KEY`），满足人脸审核受信前提

注：生图代码文件仍命名为 `src/lib/flux.ts`（沿用旧名），实际对接火山方舟 Seedream，不再使用 FLUX。

---

## 其他过时内容说明

| 文档描述 | 当前实际情况 |
|---------|------------|
| "Provider Adapter 封装 Seedance/Gemini" | 已通过 `src/lib/seedance.ts` + `src/lib/video-analyzer.ts` 实现 |
| "ProviderTask provider: 'GEMINI'" | 已移除，解析任务直接在 parse-video Worker 内完成 |
| ".env.example 中的 GEMINI_API_KEY" | 已替换为 `VISION_API_KEY` / `VISION_API_URL` / `VISION_MODEL`（视频直传分析配置） |
| "Seedance 1.0 duration 5-10s" | 2.0 支持 2-15s，当前默认按组时长动态设定 |
| "fal.ai 备选平台" | 已改用火山引擎方舟平台直连（Seedance 视频 + Seedream 生图同账号） |

---

*最后更新：2026-07-02（修正：数据库已迁移 PostgreSQL、AI 接口改为火山引擎方舟直连，非 AceData 中转）*
