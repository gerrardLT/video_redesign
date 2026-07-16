# Seedance 2.0 官方 API 参考文档

> **文档状态**：📘 参考资料（外部 API，当前有效）
> **用途/说明**：火山方舟 Seedance 2.0 视频生成 API 参考（封存底座仍依赖）
> **权威来源**：本仓库权威文档为 `AGENTS.md` + `docs/local-life-user-journey.md`
> **最后校准**：2026-07-11

> 来源：火山引擎方舟平台 https://www.volcengine.com/docs/82379/1520757

## 接口地址

`POST https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks`

## 鉴权

仅支持 API Key 鉴权，Header: `Authorization: Bearer {API_KEY}`

## 模型能力

### Doubao Seedance 2.0 系列（有声视频/无声视频）

- **多模态参考生视频**：输入参考图片（0~9）+ 参考视频（0~3）+ 参考音频（0~3）+ 文本提示词（可选）生成目标视频
- **图生视频-首尾帧**：输入首帧图片 + 尾帧图片 + 文本提示词（可选）
- **图生视频-首帧**：输入首帧图片 + 文本提示词（可选）
- **文生视频**：输入文本提示词

> 注意：图生视频-首帧、图生视频-首尾帧、多模态参考生视频为 3 种互斥场景，不可混用。

## 请求参数

### 请求体

#### model (string, 必选)

模型 ID。可选值：
- `doubao-seedance-2-0-260128`
- `doubao-seedance-2-0-fast-260128`

#### content (object[], 必选)

输入给模型的信息数组，支持文本、图片、音频、视频。

支持的组合：
- 文本
- 文本（可选）+ 图片
- 文本（可选）+ 视频
- 文本（可选）+ 图片 + 音频
- 文本（可选）+ 图片 + 视频
- 文本（可选）+ 视频 + 音频
- 文本（可选）+ 图片 + 视频 + 音频

##### 文本信息

```json
{
  "type": "text",
  "text": "描述期望生成的视频"
}
```

- 中文不超过500字，英文不超过1000词
- 支持中英文、日语、印尼语、西班牙语、葡萄牙语

##### 图片信息

```json
{
  "type": "image_url",
  "image_url": { "url": "https://..." },
  "role": "first_frame"  // 或 "last_frame" 或 "reference_image"
}
```

- 格式：jpeg、png、webp、bmp、tiff、gif、heic、heif
- 宽高比（宽/高）：(0.4, 2.5)
- 宽高长度（px）：(300, 6000)
- 大小：单张 < 30MB，请求体 < 64MB
- 图片数量：首帧 1 张，首尾帧 2 张，多模态参考 1~9 张

**role 取值：**
- `first_frame`：首帧图片
- `last_frame`：尾帧图片
- `reference_image`：参考图（多模态参考模式）

##### 视频信息

```json
{
  "type": "video_url",
  "video_url": { "url": "https://..." },
  "role": "reference_video"
}
```

- 格式：mp4、mov（H.264/AVC、H.265/HEVC）
- 分辨率：480p、720p、1080p
- 时长：单个视频 [2, 15]s，最多 3 个，总时长不超过 15s
- 尺寸：宽高比 [0.4, 2.5]，宽高 [300, 6000]px
- 大小：单个 < 50MB
- 帧率：[24, 60] FPS

**role 取值：**
- `reference_video`：参考视频

##### 音频信息

```json
{
  "type": "audio_url",
  "audio_url": { "url": "https://..." },
  "role": "reference_audio"
}
```

- 格式：wav、mp3
- 时长：单个 [2, 15]s，最多 3 段，总时长不超过 15s
- 大小：单个 < 15MB，请求体 < 64MB
- **不可单独输入音频，应至少包含 1 个参考视频或图片**

**role 取值：**
- `reference_audio`：参考音频

#### resolution (string, 可选, 默认 720p)

- `480p`
- `720p`
- `1080p`（Seedance 2.0 fast 不支持）

#### ratio (string, 可选, 默认 adaptive)

- `16:9`、`4:3`、`1:1`、`3:4`、`9:16`、`21:9`
- `adaptive`：根据输入自动选择

#### duration (integer, 可选, 默认 5)

生成视频时长（秒）：
- Seedance 2.0 系列：[4, 15] 或 -1（智能选择）

#### generate_audio (boolean, 可选, 默认 true)

- `true`：视频包含同步音频（人声、音效、背景音乐）
- `false`：无声视频

#### seed (integer, 可选, 默认 -1)

种子整数，取值 [-1, 2^32-1]。

#### watermark (boolean, 可选, 默认 false)

- `true`：右下角 "AI 生成" 水印
- `false`：无水印

#### callback_url (string, 可选)

任务结果回调通知地址。

#### return_last_frame (boolean, 可选, 默认 false)

是否返回生成视频的尾帧图像。

#### tools (object[], 可选)

```json
[{"type": "web_search"}]
```

#### priority (integer, 可选, 默认 0)

执行优先级，0~9，数值越大优先级越高。

## 响应参数

#### id (string)

视频生成任务 ID。保存 7 天。

创建任务为异步接口，获取 ID 后通过查询接口获取结果。

## 查询任务接口

`GET https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/{task_id}`

### 响应

```json
{
  "id": "task-id",
  "model": "doubao-seedance-2-0-260128",
  "status": "succeeded",
  "output": {
    "video_url": "https://...",
    "duration": 10
  }
}
```

**status 枚举值：**
- `queued`：排队中
- `running`：运行中
- `succeeded`：成功
- `failed`：失败
- `expired`：超时

## 请求示例

### 多模态参考生视频

```json
{
  "model": "doubao-seedance-2-0-260128",
  "content": [
    {
      "type": "text",
      "text": "全程使用视频1的第一视角构图，首帧参考图片1"
    },
    {
      "type": "image_url",
      "image_url": { "url": "https://example.com/ref-image.jpg" },
      "role": "reference_image"
    },
    {
      "type": "video_url",
      "video_url": { "url": "https://example.com/ref-video.mp4" },
      "role": "reference_video"
    },
    {
      "type": "audio_url",
      "audio_url": { "url": "https://example.com/ref-audio.mp3" },
      "role": "reference_audio"
    }
  ],
  "resolution": "720p",
  "ratio": "16:9",
  "duration": 11,
  "generate_audio": true
}
```

### 图生视频-首帧

```json
{
  "model": "doubao-seedance-2-0-260128",
  "content": [
    {
      "type": "text",
      "text": "小猫在草地上奔跑"
    },
    {
      "type": "image_url",
      "image_url": { "url": "https://example.com/first-frame.png" },
      "role": "first_frame"
    }
  ],
  "resolution": "720p",
  "duration": 5
}
```

### 图生视频-首尾帧

```json
{
  "model": "doubao-seedance-2-0-260128",
  "content": [
    {
      "type": "text",
      "text": "镜头从窗边花束慢慢推到餐桌中央"
    },
    {
      "type": "image_url",
      "image_url": { "url": "https://example.com/first-frame.png" },
      "role": "first_frame"
    },
    {
      "type": "image_url",
      "image_url": { "url": "https://example.com/last-frame.png" },
      "role": "last_frame"
    }
  ],
  "resolution": "720p",
  "duration": 10,
  "return_last_frame": true
}
```

### 文生视频

```json
{
  "model": "doubao-seedance-2-0-260128",
  "content": [
    {
      "type": "text",
      "text": "微距镜头拍摄一只玻璃蛙停在叶片上"
    }
  ],
  "resolution": "720p",
  "ratio": "16:9",
  "duration": 11,
  "generate_audio": true
}
```

## 分辨率与宽高比像素映射

| 分辨率 | 宽高比 | 宽高像素值 |
|--------|--------|-----------|
| 480p | 16:9 | 864×496 |
| 480p | 4:3 | 752×560 |
| 480p | 1:1 | 640×640 |
| 480p | 3:4 | 560×752 |
| 480p | 9:16 | 496×864 |
| 480p | 21:9 | 992×432 |
| 720p | 16:9 | 1280×720 |
| 720p | 4:3 | 1112×834 |
| 720p | 1:1 | 960×960 |
| 720p | 3:4 | 834×1112 |
| 720p | 9:16 | 720×1280 |
| 720p | 21:9 | 1470×630 |
| 1080p | 16:9 | 1920×1080 |
| 1080p | 4:3 | 1664×1248 |
| 1080p | 1:1 | 1440×1440 |
| 1080p | 3:4 | 1248×1664 |
| 1080p | 9:16 | 1080×1920 |
| 1080p | 21:9 | 2206×946 |

## 参考视频约束

| 约束项 | 限制 |
|--------|------|
| 最多视频数量 | 3 个 |
| 单个时长 | [2, 15] 秒 |
| 所有视频总时长 | ≤ 15 秒 |
| 单个文件大小 | < 50MB |
| 格式 | mp4、mov |
| 分辨率 | 480p/720p/1080p |
| 帧率 | 24~60 FPS |








`GET https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/{id}`  [运行](https://api.volcengine.com/api-explorer/?action=GetContentsGenerationsTask&data=%7B%22id%22%3A%22cgt-20250331175019-68d9t%22%7D&groupName=%E8%A7%86%E9%A2%91%E7%94%9F%E6%88%90API&query=%7B%7D&serviceCode=ark&version=2024-01-01)

查询视频生成任务的状态。

<div data-tips="true" data-tips-type="default" data-tips-is-title="true">说明</div>


<div data-tips="true" data-tips-type="default">仅支持查询最近 7 天的任务记录，时间区间为 [T\-7天, T)，其中 T 为请求发起时刻的 UTC 时间戳（精确到秒）。注意：视频 URL 有效期为 24 小时，请及时下载或转存。</div>



<Tabs>
<Tab zoneid="fq9yXaKY" title="快速入口">
<TabTitle>快速入口</TabTitle>

 [ ](https://www.volcengine.com/docs/82379/1521309#)[体验中心](https://console.volcengine.com/ark/region:ark+cn-beijing/experience/vision)       <span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2abecd05ca2779567c6d32f0ddc7874d.png) </span>[模型列表](https://www.volcengine.com/docs/82379/1330310)       <span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_a5fdd3028d35cc512a10bd71b982b6eb.png) </span>[模型计费](https://www.volcengine.com/docs/82379/1099320#%E8%A7%86%E9%A2%91%E7%94%9F%E6%88%90%E6%A8%A1%E5%9E%8B)       <span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_afbcf38bdec05c05089d5de5c3fd8fc8.png) </span>[API Key](https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey?apikey=%7B%7D)

 <span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_57d0bca8e0d122ab1191b40101b5df75.png) </span>[调用教程](https://www.volcengine.com/docs/82379/1366799)       <span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_f45b5cd5863d1eed3bc3c81b9af54407.png) </span>[接口文档](https://www.volcengine.com/docs/82379/1521309)       <span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_1609c71a747f84df24be1e6421ce58f0.png) </span>[常见问题](https://www.volcengine.com/docs/82379/1359411)       <span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_bef4bc3de3535ee19d0c5d6c37b0ffdd.png) </span>[开通模型](https://console.volcengine.com/ark/region:ark+cn-beijing/openManagement?LLM=%7B%7D&OpenTokenDrawer=false)


</Tab>
<Tab zoneid="3vCxpwty" title="鉴权说明">
<TabTitle>鉴权说明</TabTitle>

本接口支持 API Key 鉴权，详见[鉴权认证方式](https://www.volcengine.com/docs/82379/1298459)。


</Tab>
</Tabs>



---



<span id="RxN8G2nH"></span>
## 请求参数 

> 跳转 [响应参数](https://www.volcengine.com/docs/82379/1521309#7mi8G8RI)



---



**id** `string` <span data-api-tag="require|mtkjmj">必选</span>

您需要查询的视频生成任务的 ID 。

<div data-tips="true" data-tips-type="default" data-tips-is-title="true">说明</div>


<div data-tips="true" data-tips-type="default">上面参数为Query String Parameters，在URL String中传入。</div>



---



&nbsp;

<span id="7mi8G8RI"></span>
## 响应参数

> 跳转 [请求参数](https://www.volcengine.com/docs/82379/1521309#RxN8G2nH)



---



**id ** `string`

视频生成任务 ID 。


---



**model** `string`

任务使用的模型名称和版本，`模型名称-版本`。


---



**status** `string`

任务状态，以及相关的信息：


* `queued`：排队中。

* `running`：任务运行中。

* `cancelled`：取消任务，取消状态24h自动删除（只支持排队中状态的任务被取消）。

* `succeeded`： 任务成功。

* `failed`：任务失败。

* `expired`：任务超时。



---



**error** `object / null`

错误提示信息，任务成功返回`null`，任务失败时返回错误数据，错误信息具体参见 [错误处理](https://www.volcengine.com/docs/82379/1299023#.5pa56Iif6ZSZ6K-v56CB)。


属性


---



error.**code** `string`

错误码。


---



error.**message** `string`

错误提示信息。



---



**created_at** `integer`

任务创建时间的 Unix 时间戳（秒）。


---



**updated_at** `integer`

任务当前状态更新时间的 Unix 时间戳（秒）。


---



**content** `object`

视频生成任务的输出内容。


属性


---



content.**video_url** `string`

生成视频的 URL，格式为 mp4。有效期为 24 小时，请及时下载或转存。

推荐配置火山引擎 TOS 提供的数据订阅功能，将您的模型推理产物自动转存到自己的 TOS 桶中，便于长期备份或二次加工。详细介绍请参见 [TOS 数据订阅](https://www.volcengine.com/docs/6349/2280949?lang=zh)。

content.**last_frame_url ** `string`

视频的尾帧图像 URL。有效期为 24 小时，请及时下载或转存。

说明：[创建视频生成任务](https://www.volcengine.com/docs/82379/1520757) 时设置 `"return_last_frame": true` 时，会返回该参数。



---



**seed** `integer`

本次请求使用的种子整数值。


---



**resolution **  `string` 

生成视频的分辨率。


---



**ratio ** `string`

生成视频的宽高比。


---



**duration** `integer` 

生成视频的时长，单位：秒。

说明：**duration 和 frames 参数只会返回一个**。[创建视频生成任务](https://www.volcengine.com/docs/82379/1520757) 时未指定 frames，会返回 duration。


---



**frames** `integer`  

生成视频的帧数。

说明：**duration 和 frames 参数只会返回一个**。[创建视频生成任务](https://www.volcengine.com/docs/82379/1520757) 时指定了 frames，会返回 frames。


---



**framespersecond**  `integer` 

生成视频的帧率。


---



**generate_audio** `boolean`

生成的视频是否包含与画面同步的声音。仅 seedance 2.0 & 2.0 fast、seedance 1.5 pro 会返回该参数。


* `true`：模型输出的视频包含同步音频。

* `false`：模型输出的视频为无声视频。



---



**tools<mark><sup>new</sup></mark>** ** ** `object[]` 

本次请求模型实际使用的工具。未使用工具时不返回。


属性

tools.**type ** `string`

实际使用的工具类型


* web_search：联网搜索工具。



---



**safety_identifier<mark><sup>new</sup></mark>** `string`

终端用户的唯一标识符。若 [创建视频生成任务](https://www.volcengine.com/docs/82379/1520757) 时设置了该参数，接口会原样返回此信息。


---



**priority<mark><sup>new</sup></mark>** `integer` 

当前请求的执行优先级。


---



**draft** `boolean`

生成的视频是否为 Draft 视频。仅 seedance 1.5 pro 会返回该参数。


* `true`：表示当前输出为 Draft 视频。

* `false`：表示当前输出为正常视频。



---



**draft_task_id ** `string`

Draft 视频任务 ID。基于 Draft 视频生成正式视频时，会返回该参数。


---



**service_tier  ** `string`

实际处理任务使用的服务等级。


---



**execution_expires_after** ** ** `integer`

任务超时阈值，单位：秒。


---



**usage** `object`

本次请求的 token 用量。


属性


---



usage.**completion_tokens** `integer`

模型生成视频消耗的 token 数量，可作为计费对账依据。

<div data-tips="true" data-tips-type="default" data-tips-is-title="true">说明</div>


<div data-tips="true" data-tips-type="default">seedance 2.0 系列模型存在最低 token 用量限制，如果实际 token 用量 ＜ 最低 token 用量，本字段会返回最低 token 用量，平台按最低 token 用量计费。</div>



---



usage.**total_tokens** `integer`

本次请求消耗的总 token 数量。视频生成模型不统计输入 token，输入 token 为 0，故 **total_tokens**=**completion_tokens**。


---



usage.**tool_usage<mark><sup>new</sup></mark>** ** ** `object`

使用工具的用量信息。


属性

usage.tool_usage.**web_search ** `integer`

实际调用联网搜索工具的次数，仅开启联网搜索时返回。








`GET https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks?page_num={page_num}&page_size={page_size}&filter.status={filter.status}&filter.task_ids={filter.task_ids}&filter.model={filter.model}`  [运行](https://api.volcengine.com/api-explorer/?action=ListContentsGenerationsTasks&data=%7B%7D&groupName=%E8%A7%86%E9%A2%91%E7%94%9F%E6%88%90API&query=%7B%7D&serviceCode=ark&version=2024-01-01)

通过传入筛选参数，查询符合条件的视频生成任务。

<div data-tips="true" data-tips-type="default" data-tips-is-title="true">说明</div>


<div data-tips="true" data-tips-type="default">仅支持查询最近 7 天的任务记录，时间区间为 [T\-7天, T)，其中 T 为请求发起时刻的 UTC 时间戳（精确到秒）。注意：视频 URL 有效期为 24 小时，请及时下载或转存。</div>



<Tabs>
<Tab zoneid="opV4RT2k" title="快速入口">
<TabTitle>快速入口</TabTitle>

 [ ](https://www.volcengine.com/docs/82379/1521675#)[体验中心](https://console.volcengine.com/ark/region:ark+cn-beijing/experience/vision)       <span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2abecd05ca2779567c6d32f0ddc7874d.png) </span>[模型列表](https://www.volcengine.com/docs/82379/1330310)       <span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_a5fdd3028d35cc512a10bd71b982b6eb.png) </span>[模型计费](https://www.volcengine.com/docs/82379/1099320#%E8%A7%86%E9%A2%91%E7%94%9F%E6%88%90%E6%A8%A1%E5%9E%8B)       <span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_afbcf38bdec05c05089d5de5c3fd8fc8.png) </span>[API Key](https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey?apikey=%7B%7D)

 <span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_57d0bca8e0d122ab1191b40101b5df75.png) </span>[调用教程](https://www.volcengine.com/docs/82379/1366799)       <span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_f45b5cd5863d1eed3bc3c81b9af54407.png) </span>[接口文档](https://www.volcengine.com/docs/82379/1521675)       <span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_1609c71a747f84df24be1e6421ce58f0.png) </span>[常见问题](https://www.volcengine.com/docs/82379/1359411)       <span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_bef4bc3de3535ee19d0c5d6c37b0ffdd.png) </span>[开通模型](https://console.volcengine.com/ark/region:ark+cn-beijing/openManagement?LLM=%7B%7D&OpenTokenDrawer=false)


</Tab>
<Tab zoneid="CPeW5vNl" title="鉴权说明">
<TabTitle>鉴权说明</TabTitle>

本接口支持 API Key 鉴权，详见[鉴权认证方式](https://www.volcengine.com/docs/82379/1298459)。


</Tab>
</Tabs>



---



<span id="RxN8G2nH"></span>
## 请求参数 

> 跳转 [响应参数](https://www.volcengine.com/docs/82379/1521675#7mi8G8RI)


<div data-tips="true" data-tips-type="default" data-tips-is-title="true">说明</div>


<div data-tips="true" data-tips-type="default">下面参数为Query String Parameters，在URL String中传入。</div>



---



**page_num** `integer / null`  `默认值：1`

返回结果的页码。

取值范围：[1, 500]


---



**page_size ** `integer / null` `默认值：20`

每页显示的结果数量。

取值范围：[1, 500]


---



**filter.status ** `string / null`

过滤参数，查询某个任务状态。


* `queued`：排队中的任务。

* `running`：运行中任务。

* `cancelled`：取消的任务。

* `succeeded`： 成功的任务。

* `failed`：失败的任务。



---



**filter.task_ids ** `string[] / null`

视频生成任务 ID，精确搜索，支持同时搜索多个任务 ID。需通过重复参数名的方式传递，示例：`filter.task_ids=id1&filter.task_ids=id2`。


---



**filter.model ** `string / null`

与返回参数不同，该字段为任务使用的推理接入点 ID，精确搜索。


---



**filter.service_tier ** `string / null` `默认值 default`

 处理任务使用的服务等级。


* `default`：在线推理模式

* `flex`：离线推理模式


<span id="7mi8G8RI"></span>
## 响应参数

> 跳转 [请求参数](https://www.volcengine.com/docs/82379/1521675#RxN8G2nH)



---



**items ** `object[]`

查询到的视频生成任务列表。


属性


---



items.**id ** `string`

视频生成任务 ID 。


---



items.**model** `string`

任务使用的模型名称和版本，`模型名称-版本`。


---



items.**status** `string`

任务状态，以及相关的信息：


* `queued`：排队中。

* `running`：任务运行中。

* `cancelled`：取消任务（只支持排队中状态的任务被取消）。

* `succeeded`： 任务成功。

* `failed`：任务失败。

* `expired`：任务超时。



---



items.**error** `object / null`

错误提示信息，任务成功返回`null`，任务失败时返回错误数据，错误信息具体参见 [错误处理](https://www.volcengine.com/docs/82379/1393047#653d2c40)。


属性


---



error.**code** `string`

错误码。


---



error.**message** `string`

错误提示信息。



---



items.**created_at** `integer`

任务创建时间的 Unix 时间戳（秒）。


---



items.**updated_at** `integer`

任务当前状态更新时间的 Unix 时间戳（秒）。


---



items.**content** `object`

当视频生成任务完成，会输出该字段，包含生成视频下载的 URL。


属性


---



content.**video_url** `string`

生成视频的URL。有效期为 24 小时，请及时下载或转存。


---



content.**last_frame_url ** `string`

视频的尾帧图像 URL。有效期为 24 小时，请及时下载或转存。

说明：[创建视频生成任务](https://www.volcengine.com/docs/82379/1520757) 时设置 `"return_last_frame": true` 时，会返回参数。



---



items.**seed** `integer`

本次请求使用的种子整数值。


---



items.**resolution **  `string` 

生成视频的分辨率。


---



items.**ratio ** `string`

生成视频的宽高比。


---



items.**duration** `integer` 

生成视频的时长，单位：秒。

说明：**duration 和 frames 参数只会返回一个**。[创建视频生成任务](https://www.volcengine.com/docs/82379/1520757) 时未指定 frames，会返回 duration。


---



items.**frames ** `integer`  

生成视频的帧数。

说明：**duration 和 frames 参数只会返回一个**。[创建视频生成任务](https://www.volcengine.com/docs/82379/1520757) 时指定了 frames，会返回 frames。


---



items.**framespersecond**  `integer` 

生成视频的帧率。


---



items.**generate_audio** `boolean`

生成的视频是否包含与画面同步的声音。仅 Seedance 2.0 系列、Seedance 1.5 pro 会返回该参数。


* `true`：模型输出的视频包含同步音频。

* `false`：模型输出的视频为无声视频。



---



items.**tools<mark><sup>new</sup></mark>** ** ** `object[]` 

本次请求模型实际使用的工具。未使用工具时不返回。


属性

items.tools.**type ** `string`

实际使用的工具类型


* web_search：联网搜索工具。



---



items.**safety_identifier<mark><sup>new</sup></mark>** `string`

终端用户的唯一标识符。若 [创建视频生成任务](https://www.volcengine.com/docs/82379/1520757) 时设置了该参数，接口会原样返回此信息。


---



items.**priority<mark><sup>new</sup></mark>** `integer` 

当前请求的执行优先级。


---



items.**draft** `boolean`

生成的视频是否为 Draft 视频。仅 Seedance 1.5 pro 会返回该参数。


* `true`：表示当前输出为 Draft 视频。

* `false`：表示当前输出为正常视频。



---



items.**draft_task_id ** `string`

Draft 视频任务 ID。基于 Draft 视频生成正式视频时，会返回该参数。


---



items.**service_tier ** `string`

实际处理任务使用的服务等级。


---



items.**execution_expires_after** ** ** `integer`

任务超时阈值，单位：秒。


---



items.**usage** `object`

本次请求的 token 用量。


属性


---



items.usage.**completion_tokens** `integer`

模型生成视频消耗的 token 数量，可作为计费对账依据。 

<div data-tips="true" data-tips-type="default" data-tips-is-title="true">说明</div>


<div data-tips="true" data-tips-type="default">Seedance 2.0 系列模型存在最低 token 用量限制，如果实际 token 用量 ＜ 最低 token 用量，本字段会返回最低 token 用量，平台按最低 token 用量计费。</div>



---



items.usage.**total_tokens**`integer`

本次请求消耗的总 token 数量。视频生成模型不统计输入 token，输入 token 为 0，故 **total_tokens**=**completion_tokens**。


---



items.usage.**tool_usage<mark><sup>new</sup></mark>** ** ** `object`

使用工具的用量信息。


属性

items.usage.tool_usage.**web_search ** `integer`

实际调用联网搜索工具的次数，仅开启联网搜索时返回。







---



**total ** `integer`

符合筛选条件的任务数量。





`DELETE https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/{id}`  [运行](https://api.volcengine.com/api-explorer/?action=DeleteContentsGenerationsTasks&data=%7B%22id%22%3A%22cgt-20250331175019-68d9t%22%7D&groupName=%E8%A7%86%E9%A2%91%E7%94%9F%E6%88%90API&query=%7B%7D&serviceCode=ark&version=2024-01-01)

取消排队中的视频生成任务，或者删除视频生成任务记录。


<Tabs>
<Tab zoneid="vI631gwS" title="快速入口">
<TabTitle>快速入口</TabTitle>

 [ ](https://www.volcengine.com/docs/82379/1521720#)[体验中心](https://console.volcengine.com/ark/region:ark+cn-beijing/experience/vision)       <span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_2abecd05ca2779567c6d32f0ddc7874d.png) </span>[模型列表](https://www.volcengine.com/docs/82379/1330310)       <span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_a5fdd3028d35cc512a10bd71b982b6eb.png) </span>[模型计费](https://www.volcengine.com/docs/82379/1099320#%E8%A7%86%E9%A2%91%E7%94%9F%E6%88%90%E6%A8%A1%E5%9E%8B)       <span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_afbcf38bdec05c05089d5de5c3fd8fc8.png) </span>[API Key](https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey?apikey=%7B%7D)

 <span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_57d0bca8e0d122ab1191b40101b5df75.png) </span>[调用教程](https://www.volcengine.com/docs/82379/1366799)       <span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_f45b5cd5863d1eed3bc3c81b9af54407.png) </span>[接口文档](https://www.volcengine.com/docs/82379/1521675)       <span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_1609c71a747f84df24be1e6421ce58f0.png) </span>[常见问题](https://www.volcengine.com/docs/82379/1359411)       <span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_bef4bc3de3535ee19d0c5d6c37b0ffdd.png) </span>[开通模型](https://console.volcengine.com/ark/region:ark+cn-beijing/openManagement?LLM=%7B%7D&OpenTokenDrawer=false)


</Tab>
<Tab zoneid="L8aMwmZD" title="鉴权说明">
<TabTitle>鉴权说明</TabTitle>

本接口支持 API Key 鉴权，详见[鉴权认证方式](https://www.volcengine.com/docs/82379/1298459)。


</Tab>
</Tabs>



---



<span id="RxN8G2nH"></span>
## 请求参数 

> 跳转 [响应参数](https://www.volcengine.com/docs/82379/1521720#7mi8G8RI)


<div data-tips="true" data-tips-type="default" data-tips-is-title="true">说明</div>


<div data-tips="true" data-tips-type="default">下面参数为Query String Parameters，在URL String中传入。</div>



---



**id** `string` <span data-api-tag="require|i8Elom">必选</span>

需要取消或者删除的视频生成任务。

任务状态不同，调用`DELETE`接口，执行的操作有所不同，具体说明如下：


|当前任务状态  |是否支持DELETE操作 |操作含义  |DELETE操作后任务状态 |
|---|---|---|---|
|queued  |是  |任务取消排队，任务状态被变更为cancelled。  |cancelled  |
|running  |否 |\- |\- |
|succeeded  |是  |删除视频生成任务记录，后续将不支持查询。  |\- |
|failed  |是  |删除视频生成任务记录，后续将不支持查询。  |\- |
|cancelled  |否  |\- |\- |
|expired |是 |删除视频生成任务记录，后续将不支持查询。  |\- |



---



<span id="7mi8G8RI"></span>
## 响应参数

> 跳转 [请求参数](https://www.volcengine.com/docs/82379/1521720#RxN8G2nH)


本接口无返回参数。

