# HappyHorse 视频生成模型 API 调研文档

> 信息来源:[阿里云百炼 HappyHorse API 参考](https://www.alibabacloud.com/help/zh/model-studio/happyhorse-api-reference/)
> 调研日期:2026-06-22

## 一、模型概览

HappyHorse 1.0 是阿里云百炼平台的视频生成模型系列,**已在 DashScope 平台正式开放**,支持 4 种模式:

| 模式 | 模型 ID | 说明 |
|------|---------|------|
| 文生视频 (T2V) | `happyhorse-1.0-t2v` | 纯文本生成视频 |
| 图生视频 (I2V) | `happyhorse-1.0-i2v` | 首帧图 + 文本引导 |
| 参考生视频 (R2V) | `happyhorse-1.0-r2v` | 多张参考图 + 文本融合生成 |
| 视频编辑 (V-Edit) | `happyhorse-1.0-video-edit` | 输入视频 + 参考图 + 指令编辑 |

### 核心能力

- **分辨率**: 720P / 1080P(默认 1080P)
- **时长**: 3-15 秒(整数)
- **比例**: 16:9(默认)、9:16、1:1、4:3、3:4(I2V 模式自动跟随首帧)
- **Prompt 长度**: ≤ 2500 中文字 / 5000 非中文字符
- **任务耗时**: 1-5 分钟
- **结果有效期**: video_url 24 小时过期,需及时下载转存

---

## 二、统一接口格式

所有模式**共用同一个 API endpoint**,仅 model/input 不同:

### Endpoint

```
POST https://{WorkspaceId}.{region}.maas.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis
```

支持的地域:
- 新加坡: `ap-southeast-1`
- 美国(弗吉尼亚): `us-east-1`(推测)
- 华北2(北京): `cn-beijing`(推测)
- 德国(法兰克福): `eu-central-1`(推测)

### 必须的请求头

```
Content-Type: application/json
Authorization: Bearer $DASHSCOPE_API_KEY
X-DashScope-Async: enable     # 必须!否则报错 "current user api does not support synchronous calls"
```

### 任务查询

```
GET https://{WorkspaceId}.{region}.maas.aliyuncs.com/api/v1/tasks/{task_id}
Authorization: Bearer $DASHSCOPE_API_KEY
```

### 任务状态流转

```
PENDING → RUNNING → SUCCEEDED / FAILED
```

---

## 三、各模式详细参数

### 3.1 文生视频 (T2V)

**模型**: `happyhorse-1.0-t2v`

```json
{
  "model": "happyhorse-1.0-t2v",
  "input": {
    "prompt": "一座由硬纸板搭建的微型城市..."
  },
  "parameters": {
    "resolution": "720P",
    "ratio": "16:9",
    "duration": 5
  }
}
```

| 参数 | 类型 | 必选 | 默认值 | 说明 |
|------|------|------|--------|------|
| input.prompt | string | ✅ | - | 文本提示词 |
| parameters.resolution | string | ❌ | "1080P" | 720P / 1080P |
| parameters.ratio | string | ❌ | "16:9" | 16:9 / 9:16 / 1:1 / 4:3 / 3:4 / 4:5 / 5:4 / 9:21 / 21:9 |
| parameters.duration | integer | ❌ | 5 | 3-15 秒 |
| parameters.watermark | boolean | ❌ | true | 是否加水印(右下角"Happy Horse") |
| parameters.seed | integer | ❌ | 随机 | [0, 2147483647],固定可提升复现性 |

### 3.2 图生视频 (I2V) — 基于首帧

**模型**: `happyhorse-1.0-i2v`

```json
{
  "model": "happyhorse-1.0-i2v",
  "input": {
    "prompt": "一只猫在草地上奔跑",
    "media": [
      { "type": "first_frame", "url": "https://..." }
    ]
  },
  "parameters": {
    "resolution": "720P",
    "duration": 5,
    "watermark": false
  }
}
```

| 参数 | 类型 | 必选 | 默认值 | 说明 |
|------|------|------|--------|------|
| input.prompt | string | ❌ | - | 可选的文本引导 |
| input.media[0].type | string | ✅ | - | 固定 `first_frame` |
| input.media[0].url | string | ✅ | - | 首帧图像 URL |
| parameters.resolution | string | ❌ | "1080P" | 720P / 1080P |
| parameters.duration | integer | ❌ | 5 | 3-15 秒 |
| parameters.watermark | boolean | ❌ | true | 是否加水印 |

**注意**: I2V 模式**不支持 ratio 参数**,宽高比自动跟随输入首帧。

### 3.3 参考生视频 (R2V) — 多图融合

**模型**: `happyhorse-1.0-r2v`

```json
{
  "model": "happyhorse-1.0-r2v",
  "input": {
    "prompt": "[Image 1]中身着红色旗袍的女性...[Image 2]中的折扇...[Image 3]中的流苏耳坠...",
    "media": [
      { "type": "reference_image", "url": "https://...girl.jpg" },
      { "type": "reference_image", "url": "https://...fan.jpg" },
      { "type": "reference_image", "url": "https://...earrings.jpg" }
    ]
  },
  "parameters": {
    "resolution": "720P",
    "ratio": "16:9",
    "duration": 5
  }
}
```

| 参数 | 类型 | 必选 | 默认值 | 说明 |
|------|------|------|--------|------|
| input.prompt | string | ✅ | - | 必须用 `[Image N]` 指代 media 中对应位置的图片 |
| input.media[] | array | ✅ | - | 多张参考图,type 均为 `reference_image` |
| parameters.resolution | string | ❌ | "1080P" | 720P / 1080P |
| parameters.ratio | string | ❌ | "16:9" | 16:9 / 9:16 / 3:4 / 4:3 / 4:5 / 5:4 / 1:1 / 9:21 / 21:9 |
| parameters.duration | integer | ❌ | 5 | 3-15 秒 |
| parameters.watermark | boolean | ❌ | true | 是否加水印 |
| parameters.seed | integer | ❌ | 随机 | [0, 2147483647] |

**R2V 参考图限制**:
- 数量:1-9 张
- 格式:JPEG / JPG / PNG / WEBP
- 分辨率:短边 ≥ 400px,推荐 720P 以上清晰图
- 文件大小:≤ 20MB
- 在 prompt 中用 `[Image 1]`、`[Image 2]` 指代 media 数组对应位置

### 3.4 视频编辑 (V-Edit) — 视频 + 参考图 + 指令

**模型**: `happyhorse-1.0-video-edit`

```json
{
  "model": "happyhorse-1.0-video-edit",
  "input": {
    "prompt": "让视频中的马头人身角色穿上图片中的条纹毛衣",
    "media": [
      { "type": "video", "url": "https://...原始视频.mp4" },
      { "type": "reference_image", "url": "https://...参考图.webp" }
    ]
  },
  "parameters": {
    "resolution": "720P",
    "watermark": false,
    "audio_setting": "keep_original"
  }
}
```

| 参数 | 类型 | 必选 | 默认值 | 说明 |
|------|------|------|--------|------|
| input.prompt | string | ✅ | - | 编辑指令(风格变换/局部替换等) |
| input.media[] | array | ✅ | - | 必须含 1 个 `video` + 0-5 个 `reference_image` |
| parameters.resolution | string | ❌ | "1080P" | 720P / 1080P |
| parameters.watermark | boolean | ❌ | true | 是否加水印 |
| parameters.audio_setting | string | ❌ | "auto" | `auto`(模型控制) / `origin`(保留原声) |
| parameters.seed | integer | ❌ | 随机 | [0, 2147483647] |

**视频输入限制(V-Edit)**:
- 格式:MP4 / MOV(建议 H.264)
- 时长:3-60 秒(超 15 秒自动截取前 15 秒输出)
- 分辨率:长边 ≤ 4096px,短边 ≥ 360px
- 比例:1:2.5 ~ 2.5:1
- 文件大小:≤ 100MB
- 帧率:> 8fps

---

## 四、响应格式

### 创建任务(成功)

```json
{
  "output": {
    "task_status": "PENDING",
    "task_id": "0385dc79-5ff8-4d82-bcb6-xxxxxx"
  },
  "request_id": "4909100c-7b5a-9f92-bfe5-xxxxxx"
}
```

### 查询结果(成功)

```json
{
  "request_id": "99243b47-ec5f-9413-9993-xxxxxx",
  "output": {
    "task_id": "4673458e-28be-4a05-bf2a-xxxxxx",
    "task_status": "SUCCEEDED",
    "submit_time": "2026-04-20 17:55:17.075",
    "scheduled_time": "2026-04-20 17:55:17.129",
    "end_time": "2026-04-20 17:56:36.658",
    "orig_prompt": "原始提示词...",
    "video_url": "https://dashscope-result.oss-cn-beijing.aliyuncs.com/xxx.mp4?Expires=xxx"
  },
  "usage": {
    "duration": 5,
    "input_video_duration": 0,
    "output_video_duration": 5,
    "SR": 720,
    "ratio": "16:9",
    "video_count": 1
  }
}
```

### 查询结果(失败)

```json
{
  "output": {
    "task_id": "xxx",
    "task_status": "FAILED",
    "code": "错误码",
    "message": "错误详情"
  }
}
```

---

## 五、定价(官方确认)

> 来源:`docs/happyhorse.md` 原始资料(阿里云百炼模型定价页面)

### 计费规则

- **仅输出计费**(T2V / I2V / R2V):按成功生成的视频秒数计费,请求失败不收费
- **输入+输出均计费**(V-Edit):输入视频秒数 + 输出视频秒数,均按下方单价计费
- 费用公式:`费用 = 视频单价 × 视频时长(秒)`

### 单价表(华北2 北京 / 中国内地)

| 模型 ID | 分辨率 | 单价(元/秒) | 免费额度 |
|---------|--------|-------------|----------|
| `happyhorse-1.0-t2v` | 720P | **0.9** | 10 秒 |
| `happyhorse-1.0-t2v` | 1080P | **1.6** | - |
| `happyhorse-1.0-i2v` | 720P | **0.9** | 10 秒 |
| `happyhorse-1.0-i2v` | 1080P | **1.6** | - |
| `happyhorse-1.0-r2v` | 720P | **0.9** | 10 秒 |
| `happyhorse-1.0-r2v` | 1080P | **1.6** | - |
| `happyhorse-1.0-video-edit` | 720P | **0.9**(输入+输出) | 10 秒 |

> 免费额度仅限**中国内地部署范围**,阿里云百炼开通后 90 天内有效。其他地域(新加坡/美国/德国)无免费额度。

### 成本对比(生成 5 秒视频)

| | Seedance 2.0 (480p) | HappyHorse (720P) | HappyHorse (1080P) |
|---|---|---|---|
| 5 秒视频成本 | ≈ ¥1.98(按 70K tokens × ¥28/M) | ¥4.5 | ¥8.0 |
| 10 秒视频成本 | ≈ ¥3.96 | ¥9.0 | ¥16.0 |

HappyHorse 按秒定价比 Seedance 贵约 2-4 倍,但原生 1080P 无需超分。

---

## 六、与 Seedance 2.0 对比(关键差异)

| 对比项 | Seedance 2.0 (火山方舟) | HappyHorse 1.0 (阿里百炼) |
|--------|------------------------|---------------------------|
| **调用方式** | 异步创建 + 轮询 | 异步创建 + 轮询(完全一致) |
| **Endpoint** | 火山方舟 `/v3/async/chat/completions` | DashScope `/api/v1/services/aigc/video-generation/video-synthesis` |
| **参考图** | `role: reference_image` 在 content 数组 | `media[].type = reference_image` |
| **首帧图** | `role: first_frame` 在 content 数组 | `media[].type = first_frame` (I2V 模式) |
| **参考视频续接** | ✅ `role: reference_video` | ❌ T2V/I2V/R2V 不支持;V-Edit 支持输入视频但是做编辑 |
| **参考音频** | ✅ `role: reference_audio`(TTS + 唇形) | ❌ 不支持外部音频输入 |
| **内置音频** | generate_audio: true/false | T2V 自动生音频;I2V/R2V 无音频 |
| **返回尾帧** | ✅ `return_last_frame: true` | ❌ 不支持,需自行 ffmpeg 抽帧 |
| **原生分辨率** | 480p(720p 限流) | **720P / 1080P 原生** |
| **时长范围** | 4-15 秒 | 3-15 秒 |
| **审核** | 严格(真人拦截) | **无明确真人拦截限制** |
| **token 计费** | 按 completion_tokens | 按**视频秒数** |
| **链式续接能力** | ✅ reference_video 实现组间衔接 | ❌ 需替代方案(I2V 用上一组尾帧) |

---

## 七、接入评估(针对我们系统)

### 适合用 HappyHorse 的场景

1. **真人复刻场景被 Seedance 审核拦截时**:HappyHorse R2V 模式支持多参考图,且审核政策相对宽松
2. **需要原生 1080P 输出**(省去超分步骤)
3. **非链式的单组生成**(如"抽卡"重试某一组)

### 不适合的场景

1. **链式串行生成**(无 reference_video 续接,组间连贯性弱)
2. **音画同步需求**(无外部音频驱动唇形)
3. **需要精确控制帧级衔接**(无 return_last_frame)

### 建议接入策略

**方案 A — 备选引擎(推荐)**:
- Seedance 为主引擎(有续接 + 音频)
- 当 Seedance 被审核拦截(InputImageSensitiveContent / OutputVideoSensitiveContent)时,自动 fallback 到 HappyHorse R2V 模式重试
- 单组重试场景也可选择 HappyHorse(不需要续接时)

**方案 B — 独立模式**:
- 新增"HappyHorse 模式"选项,用户手动选择
- 此模式下链式续接改为 I2V(用上一组尾帧做 first_frame),连贯性比 reference_video 弱但可用

---

## 八、接入所需改动(概要)

1. 新增 `src/lib/happyhorse.ts` — HappyHorse API 客户端(创建任务 + 轮询)
2. `generate-video.ts` — 增加引擎选择分支(根据审核失败自动切换或手动选择)
3. 环境变量 — `DASHSCOPE_API_KEY`(百炼)、`DASHSCOPE_WORKSPACE_ID`
4. 数据库 — GenerationJob 增加 `engine` 字段标记用的哪个引擎
5. 链式续接适配 — HappyHorse 模式下用 I2V + 上一组尾帧(需自行 ffmpeg 从 OSS 视频抽尾帧)

---

## 参考链接

- [HappyHorse 文生视频](https://www.alibabacloud.com/help/zh/model-studio/happyhorse-text-to-video-api-reference)
- [HappyHorse 图生视频](https://www.alibabacloud.com/help/zh/model-studio/happyhorse-image-to-video-api-reference)
- [HappyHorse 参考生视频](https://www.alibabacloud.com/help/zh/model-studio/happyhorse-reference-to-video-api-reference)
- [HappyHorse 视频编辑](https://www.alibabacloud.com/help/zh/model-studio/happyhorse-video-edit-api-reference)
- [百炼模型定价](https://help.aliyun.com/zh/model-studio/model-pricing)
