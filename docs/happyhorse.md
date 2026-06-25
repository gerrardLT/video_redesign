视频生成
计费规则：输入不计费，输出计费。输出按成功生成的 视频秒数 计费。

计费公式：费用 = 视频单价 × 输出的视频时长（单位：秒）。

计费说明：

部分模型按输出视频分辨率定价。不同分辨率（480P/720P/1080P）的计费价格有差异。

部分模型按输出视频模式定价。不同视频模式（标准版/专业版）的计费价格有差异。

部分模型按输出视频画幅定价。不同视频画幅（1:1/3:4）的计费价格有差异。

部分模型采用统一定价，与分辨率、模式或画幅无关。

请求失败不产生任何费用，也不会消耗免费额度。

HappyHorse-文生视频
仅输出计费，计费规则请参见视频生成。
说明
以下模型仅在中国内地服务部署范围下有免费额度，其他服务部署范围下均无免费额度。

华北2（北京）美国（弗吉尼亚）新加坡德国（法兰克福）
模型 ID（Model ID）

服务部署范围

输出视频分辨率

输出单价

免费额度（注）

有效期：阿里云百炼开通后90天内

happyhorse-1.0-t2v

中国内地

720P

0.9元/秒

10秒

1080P

1.6元/秒

HappyHorse-图生视频-基于首帧
仅输出计费，计费规则请参见视频生成。
说明
以下模型仅在中国内地服务部署范围下有免费额度，其他服务部署范围下均无免费额度。

华北2（北京）美国（弗吉尼亚）新加坡德国（法兰克福）
模型 ID（Model ID）

服务部署范围

输出视频分辨率

输出单价

免费额度（注）

有效期：阿里云百炼开通后90天内

happyhorse-1.0-i2v

中国内地

720P

0.9元/秒

10秒

1080P

1.6元/秒

HappyHorse-参考生视频
仅输出计费，计费规则请参见视频生成。
说明
以下模型仅在中国内地服务部署范围下有免费额度，其他服务部署范围下均无免费额度。

华北2（北京）美国（弗吉尼亚）新加坡德国（法兰克福）
模型 ID（Model ID）

服务部署范围

输出视频分辨率

输出单价

免费额度（注）

有效期：阿里云百炼开通后90天内

happyhorse-1.0-r2v

中国内地

720P

0.9元/秒

10秒

1080P

1.6元/秒

HappyHorse-视频编辑
说明
以下模型仅在中国内地服务部署范围下有免费额度，其他服务部署范围下均无免费额度。

华北2（北京）美国（弗吉尼亚）新加坡德国（法兰克福）
计费规则：输入视频和输出视频均计费，按视频秒数计费，失败不计费也不占用免费额度。

模型 ID（Model ID）

服务部署范围

输出视频分辨率

输入和输出单价

免费额度（注）

有效期：阿里云百炼开通后90天内

happyhorse-1.0-video-edit

中国内地

720P

0.9元/秒

10秒


HappyHorse文生视频模型，输入文本提示词生成物理真实、运动流畅的视频内容。

## 适用范围

为确保调用成功，请务必保证模型、endpoint URL 和 API Key 均属于**同一地域**。跨地域调用将会失败。

-   [**选择模型**](https://modelstudio.console.alibabacloud.com/ap-southeast-1?tab=doc#/doc/?type=model&url=2840914)：确认模型所属的地域。
    
-   **选择 URL**：选择对应的地域 Endpoint URL，支持HTTP URL。
    
-   **配置 API Key**：获取该地域的[API Key](/help/zh/model-studio/get-api-key)，再[配置API Key到环境变量](/help/zh/model-studio/configure-api-key-through-environment-variables)。
    

**说明**

本文的示例代码适用于**新加坡地域**。

**重要**

百炼为新加坡地域推出了业务空间专属域名 `https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com`，**能够为推理请求提供卓越的性能和更高的稳定性**，建议从 `https://dashscope-intl.aliyuncs.com` 迁移至新域名。

其中 `{WorkspaceId}` 为您的业务空间 ID，可在百炼控制台的**业务空间详情**页面查看。现有域名仍可正常使用。

## HTTP调用

文生视频任务耗时较长（通常为1-5分钟），API采用异步调用的方式。整个流程包含 **"创建任务 -> 轮询获取"** 两个核心步骤，具体如下：

### **步骤1：创建任务获取任务ID**

## **新加坡**

`POST https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis`

调用时请将`WorkspaceId`替换为真实的[Workspace ID](/help/zh/model-studio/obtain-the-app-id-and-workspace-id#d3eb3cd37b7fu)。

## **美国（弗吉尼亚）**

`POST https://dashscope-us.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis`

## **华北2（北京）**

`POST https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis`

## **德国（法兰克福）**

`POST https://{WorkspaceId}.eu-central-1.maas.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis`

调用时请将`WorkspaceId`替换为真实的[Workspace ID](/help/zh/model-studio/obtain-the-app-id-and-workspace-id#d3eb3cd37b7fu)。

**说明**

-   创建成功后，使用接口返回的 `task_id` 查询结果，task\_id 有效期为 24 小时。**请勿重复创建任务**，轮询获取即可。
    
-   新手指引请参见[Postman](/help/zh/model-studio/first-call-to-image-and-video-api)。
    

| #### 请求参数 | ## 文生视频 ``` curl --location 'https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis' \\ -H 'X-DashScope-Async: enable' \\ -H "Authorization: Bearer $DASHSCOPE_API_KEY" \\ -H 'Content-Type: application/json' \\ -d '{ "model": "happyhorse-1.0-t2v", "input": { "prompt": "一座由硬纸板和瓶盖搭建的微型城市，在夜晚焕发出生机。一列硬纸板火车缓缓驶过，小灯点缀其间，照亮前路。" }, "parameters": { "resolution": "720P", "ratio": "16:9", "duration": 5 } }' ``` |
| --- | --- |
| **Content-Type** `*string*` **（必选）** 请求内容类型。此参数必须设置为`application/json`。 |
| **Authorization** `*string*`**（必选）** 请求身份认证。接口使用阿里云百炼API Key进行身份认证。示例值：Bearer sk-xxxx。 |
| **X-DashScope-Async** `*string*` **（必选）** 异步处理配置参数。HTTP请求只支持异步，**必须设置为**`**enable**`。 **重要** 缺少此请求头将报错：“current user api does not support synchronous calls”。 |
| ##### 请求体（Request Body） |
| **model** `*string*` **（必选）** 模型名称。 可选值： - `happyhorse-1.0-t2v` |
| **input** `*object*` **（必选）** 模型的输入信息。 **属性** **prompt** `*string*` **（必选）** 文本提示词，用于描述期望生成的视频内容。 支持任何语言输入，长度不超过5000个非中文字符或2500个中文字符，超过部分将自动截断。 |
| **parameters** `*object*` （可选） 视频处理参数，如设置视频分辨率、设置视频时长等。 **属性** **resolution** `*string*` （可选） 指定生成视频的分辨率档位。 可选值： - `720P` - `1080P`：默认值。 **ratio** `*string*` （可选） 指定生成视频的宽高比。 可选值： - `16:9`：默认值。 - `9:16` - `1:1` - `4:3` - `3:4` - `4:5` - `5:4` - `9:21` - `21:9` **duration** `*integer*` （可选） 指定生成视频的时长，单位为秒。 取值为\\[3, 15\\]之间的整数。默认值为`5`。 **watermark** `*boolean*` （可选） 是否在生成的视频上添加水印标识。水印位于视频右下角，文案固定为“Happy Horse”。 - `true`：默认值，添加水印。 - `false`：不添加水印。 **seed** `*integer*` （可选） 随机数种子，取值范围为`[0, 2147483647]`。 未指定时，系统自动生成随机种子。若需提升生成结果的可复现性，建议固定seed值。 请注意，由于模型生成具有概率性，即使使用相同 seed，也不能保证每次生成结果完全一致。 |     |

| #### 响应参数 | ### 成功响应 请保存 task\\_id，用于查询任务状态与结果。 ``` { "output": { "task_status": "PENDING", "task_id": "0385dc79-5ff8-4d82-bcb6-xxxxxx" }, "request_id": "4909100c-7b5a-9f92-bfe5-xxxxxx" } ``` ### 异常响应 创建任务失败，请参见[错误码](/help/zh/model-studio/error-code)进行解决。 ``` { "code": "InvalidApiKey", "message": "No API-key provided.", "request_id": "7438d53d-6eb8-4596-8835-xxxxxx" } ``` |
| --- | --- |
| **output** `*object*` 任务输出信息。 属性 **task\\_id** `*string*` 任务ID。查询有效期24小时。 **task\\_status** `*string*` 任务状态。 **枚举值** - PENDING：任务排队中 - RUNNING：任务处理中 - SUCCEEDED：任务执行成功 - FAILED：任务执行失败 - CANCELED：任务已取消 - UNKNOWN：任务不存在或状态未知 |
| **request\\_id** `*string*` 请求唯一标识。可用于请求明细溯源和问题排查。 |
| **code** `*string*` 请求失败的错误码。请求成功时不会返回此参数，详情请参见[错误码](/help/zh/model-studio/error-code)。 |
| **message** `*string*` 请求失败的详细信息。请求成功时不会返回此参数，详情请参见[错误码](/help/zh/model-studio/error-code)。 |

### **步骤2：根据任务ID查询结果**

## **新加坡**

`GET https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/api/v1/tasks/{task_id}`

调用时请将`WorkspaceId`替换为真实的[Workspace ID](/help/zh/model-studio/obtain-the-app-id-and-workspace-id#d3eb3cd37b7fu)。

## **美国（弗吉尼亚）**

`GET https://dashscope-us.aliyuncs.com/api/v1/tasks/{task_id}`

## **华北2（北京）**

`GET https://dashscope.aliyuncs.com/api/v1/tasks/{task_id}`

## **德国（法兰克福）**

`GET https://{WorkspaceId}.eu-central-1.maas.aliyuncs.com/api/v1/tasks/{task_id}`

调用时请将`WorkspaceId`替换为真实的[Workspace ID](/help/zh/model-studio/obtain-the-app-id-and-workspace-id#d3eb3cd37b7fu)。

**说明**

-   **轮询建议**：视频生成过程约需数分钟，建议采用**轮询**机制，并设置合理的查询间隔（如 15 秒）来获取结果。
    
-   **任务状态流转**：PENDING（排队中）→ RUNNING（处理中）→ SUCCEEDED（成功）/ FAILED（失败）。
    
-   **结果链接**：任务成功后返回视频链接，有效期为 **24 小时**。建议在获取链接后立即下载并转存至永久存储（如[阿里云 OSS](/help/zh/oss/user-guide/what-is-oss)）。
    
-   **task\_id 有效期**：**24小时**，超时后将无法查询结果，接口将返回任务状态为`UNKNOWN`。
    

| #### 请求参数 | ## 查询任务结果 将`{task_id}`完整替换为上一步接口返回的`task_id`的值。`task_id`查询有效期为24小时。 ``` curl -X GET https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/api/v1/tasks/{task_id} \\ --header "Authorization: Bearer $DASHSCOPE_API_KEY" ``` |
| --- | --- |
| ##### **请求头（Headers）** |
| **Authorization** `*string*`**（必选）** 请求身份认证。接口使用阿里云百炼API Key进行身份认证。示例值：Bearer sk-xxxx。 |
| ##### **URL路径参数（Path parameters）** |
| **task\\_id** `*string*`**（必选）** 任务ID。 |

| #### **响应参数** | ## 任务执行成功 视频URL仅保留24小时，超时后会被自动清除，请及时保存生成的视频。 ``` { "request_id": "99243b47-ec5f-9413-9993-xxxxxx", "output": { "task_id": "4673458e-28be-4a05-bf2a-xxxxxx", "task_status": "SUCCEEDED", "submit_time": "2026-04-20 17:55:17.075", "scheduled_time": "2026-04-20 17:55:17.129", "end_time": "2026-04-20 17:56:36.658", "orig_prompt": "一座由硬纸板和瓶盖搭建的微型城市，在夜晚焕发出生机。一列硬纸板火车缓缓驶过，小灯点缀其间，照亮前路。", "video_url": "https://dashscope-result.oss-cn-beijing.aliyuncs.com/xxx.mp4?Expires=xxx" }, "usage": { "duration": 5, "input_video_duration": 0, "output_video_duration": 5, "video_count": 1, "SR": 720, "ratio": "16:9" } } ``` ## 任务执行失败 若任务执行失败，task\\_status将置为 FAILED，并提供错误码和信息。请参见[错误码](/help/zh/model-studio/error-code)进行解决。 ``` { "request_id": "e5d70b02-ebd3-98ce-9fe8-759d7d7b107d", "output": { "task_id": "86ecf553-d340-4e21-af6e-a0c6a421c010", "task_status": "FAILED", "code": "InvalidParameter", "message": "The parameter is invalid." } } ``` ## 任务查询过期 task\\_id查询有效期为 24 小时，超时后将无法查询，返回以下报错信息。 ``` { "request_id": "a4de7c32-7057-9f82-8581-xxxxxx", "output": { "task_id": "502a00b1-19d9-4839-a82f-xxxxxx", "task_status": "UNKNOWN" } } ``` |
| --- | --- |
| **output** `*object*` 任务输出信息。 **属性** **task\\_id** `*string*` 任务ID。查询有效期24小时。 **task\\_status** `*string*` 任务状态。 **枚举值** - PENDING：任务排队中 - RUNNING：任务处理中 - SUCCEEDED：任务执行成功 - FAILED：任务执行失败 - CANCELED：任务已取消 - UNKNOWN：任务不存在或状态未知 **轮询过程中的状态流转：** - PENDING（排队中） → RUNNING（处理中）→ SUCCEEDED（成功）/ FAILED（失败）。 - 初次查询状态通常为 PENDING（排队中）或 RUNNING（处理中）。 - 当状态变为 SUCCEEDED 时，响应中将包含生成的视频URL。 - 若状态为 FAILED，请检查错误信息并重试。 - 若状态为 CANCELED，表示任务已取消，如需继续请重新提交任务。 - 若状态为 UNKNOWN，表示任务不存在或状态未知，可能在 task\\_id 不存在或超过 24 小时有效期后出现。 **submit\\_time** `*string*` 任务提交时间。时区为UTC+8，格式为 YYYY-MM-DD HH:mm:ss.SSS。 **scheduled\\_time** `*string*` 任务执行时间。时区为UTC+8，格式为 YYYY-MM-DD HH:mm:ss.SSS。 **end\\_time** `*string*` 任务完成时间。时区为UTC+8，格式为 YYYY-MM-DD HH:mm:ss.SSS。 **video\\_url** `*string*` 视频URL。仅在 task\\_status 为 SUCCEEDED 时返回。 链接有效期24小时，可通过此URL下载视频。视频格式为MP4（H.264 编码）。 **orig\\_prompt** `*string*` 原始输入的prompt，对应请求参数`prompt`。 **code** `*string*` 请求失败的错误码。请求成功时不会返回此参数，详情请参见[错误码](/help/zh/model-studio/error-code)。 **message** `*string*` 请求失败的详细信息。请求成功时不会返回此参数，详情请参见[错误码](/help/zh/model-studio/error-code)。 |
| **usage** `*object*` 输出信息统计，只对成功的结果计数。 **属性** **input\\_video\\_duration** `*integer*` 输入的视频的时长，单位秒。 **output\\_video\\_duration** `*integer*` 输出视频的时长，单位秒。 **duration** `*integer*` 总的视频时长，用于计费。 **SR** `*integer*` 输出视频的分辨率档位。 **ratio** `*string*` 输出视频的宽高比。 **video\\_count** `*integer*` 输出视频的数量。固定为1。 |
| **request\\_id** `*string*` 请求唯一标识。可用于请求明细溯源和问题排查。 |

## **错误码**

如果模型调用失败并返回报错信息，请参见[错误码](/help/zh/model-studio/error-code)进行解决。

/\* 调整 table 宽度 \*/ .aliyun-docs-content table.medium-width { max-width: 1018px; width: 100%; } .aliyun-docs-content table.table-no-border tr td:first-child { padding-left: 0; } .aliyun-docs-content table.table-no-border tr td:last-child { padding-right: 0; } /\* 支持吸顶 \*/ div:has(.aliyun-docs-content), .aliyun-docs-content .markdown-body { overflow: visible; } .stick-top { position: sticky; top: 46px; } /\*\*代码块字体\*\*/ /\* 减少表格中的代码块 margin，让表格信息显示更紧凑 \*/ .unionContainer .markdown-body table .help-code-block { margin: 0 !important; } /\* 减少表格中的代码块字号，让表格信息显示更紧凑 \*/ .unionContainer .markdown-body .help-code-block pre { font-size: 12px !important; } /\* 减少表格中的代码块字号，让表格信息显示更紧凑 \*/ .unionContainer .markdown-body .help-code-block pre code { font-size: 12px !important; } /\*\* API Reference 表格 \*\*/ .aliyun-docs-content table.api-reference tr td:first-child { margin: 0px; border-bottom: 1px solid #d8d8d8; } .aliyun-docs-content table.api-reference tr:last-child td:first-child { border-bottom: none; } .aliyun-docs-content table.api-reference p { color: #6e6e80; } .aliyun-docs-content table.api-reference b, i { color: #181818; } .aliyun-docs-content table.api-reference .collapse { border: none; margin-top: 4px; margin-bottom: 4px; } .aliyun-docs-content table.api-reference .collapse .expandable-title-bold { padding: 0; } .aliyun-docs-content table.api-reference .collapse .expandable-title { padding: 0; } .aliyun-docs-content table.api-reference .collapse .expandable-title-bold .title { margin-left: 16px; } .aliyun-docs-content table.api-reference .collapse .expandable-title .title { margin-left: 16px; } .aliyun-docs-content table.api-reference .collapse .expandable-title-bold i.icon { position: absolute; color: #777; font-weight: 100; } .aliyun-docs-content table.api-reference .collapse .expandable-title i.icon { position: absolute; color: #777; font-weight: 100; } .aliyun-docs-content table.api-reference .collapse.expanded .expandable-content { padding: 10px 14px 10px 14px !important; margin: 0; border: 1px solid #e9e9e9; } .aliyun-docs-content table.api-reference .collapse .expandable-title-bold b { font-size: 13px; font-weight: normal; color: #6e6e80; } .aliyun-docs-content table.api-reference .collapse .expandable-title b { font-size: 13px; font-weight: normal; color: #6e6e80; } .aliyun-docs-content table.api-reference .tabbed-content-box { border: none; } .aliyun-docs-content table.api-reference .tabbed-content-box section { padding: 8px 0 !important; } .aliyun-docs-content table.api-reference .tabbed-content-box.mini .tab-box { /\* position: absolute; left: 40px; right: 0; \*/ } .aliyun-docs-content .margin-top-33 { margin-top: 33px !important; } .aliyun-docs-content .two-codeblocks pre { max-height: calc(50vh - 136px) !important; height: auto; } .expandable-content section { border-bottom: 1px solid #e9e9e9; padding-top: 6px; padding-bottom: 4px; } .expandable-content section:last-child { border-bottom: none; } .expandable-content section:first-child { padding-top: 0; }

/\* 让表格显示成类似钉钉文档的分栏卡片 \*/ table.help-table-card td { border: 10px solid #FFF !important; background: #F4F6F9; padding: 16px !important; vertical-align: top; } /\* 减少表格中的代码块 margin，让表格信息显示更紧凑 \*/ .unionContainer .markdown-body table .help-code-block { margin: 0 !important; } /\* 减少表格中的代码块字号，让表格信息显示更紧凑 \*/ .unionContainer .markdown-body .help-code-block pre { font-size: 12px !important; } /\* 减少表格中的代码块字号，让表格信息显示更紧凑 \*/ .unionContainer .markdown-body .help-code-block pre code { font-size: 12px !important; } /\* 表格中的引用上下间距调小，避免内容显示过于稀疏 \*/ .unionContainer .markdown-body table blockquote { margin: 4px 0 0 0; }

/\* ========================================= \*/ /\* 新增样式：带边框的表格 (api-table-border) \*/ /\* ========================================= \*/ /\* 1. 表格容器核心设置 \*/ .aliyun-docs-content table.api-table-border { border: 1px solid #d8d8d8 !important; /\* 表格外边框 \*/ border-collapse: collapse !important; /\* 合并边框，防止双线 \*/ width: 100% !important; /\* 宽度占满 \*/ margin: 10px 0 !important; /\* 上下间距 \*/ background-color: #fff !important; /\* 背景色 \*/ box-sizing: border-box !important; } /\* 2. 表头、表体、行设置 \*/ /\* 确保行本身没有干扰边框 \*/ .aliyun-docs-content table.api-table-border thead, .aliyun-docs-content table.api-table-border tbody, .aliyun-docs-content table.api-table-border tr { border: none !important; background-color: transparent !important; } /\* 3. 单元格设置 (th 和 td) \*/ /\* 这是边框显示的关键位置 \*/ .aliyun-docs-content table.api-table-border th, .aliyun-docs-content table.api-table-border td { border: 1px solid #d8d8d8 !important; /\* 单元格四周边框 \*/ padding: 8px 12px !important; /\* 内边距 \*/ text-align: left !important; /\* 文字左对齐 \*/ vertical-align: middle !important; /\* 垂直居中 \*/ color: #6e6e80 !important; /\* 文字颜色 \*/ font-size: 14px !important; /\* 字体大小 \*/ line-height: 1.5 !important; } /\* 4. 表头特殊样式 \*/ .aliyun-docs-content table.api-table-border th { background-color: #f9fafb !important; /\* 表头背景色 \*/ color: #181818 !important; /\* 表头文字颜色 \*/ font-weight: 600 !important; /\* 表头加粗 \*/ } /\* 5. 鼠标悬停效果 (可选) \*/ .aliyun-docs-content table.api-table-border tbody tr:hover td { background-color: #fcfcfc !important; /\* 悬停时背景微变 \*/ } /\* 6. 兼容原有 api-reference 可能存在的冲突 \*/ /\* 如果原有样式针对 td:first-child 等特殊选择器有干扰，这里强制覆盖 \*/ .aliyun-docs-content table.api-table-border tr td:first-child { border-bottom: 1px solid #d8d8d8 !important; margin: 0 !important; } .aliyun-docs-content table.api-table-border tr:last-child td:first-child { border-bottom: 1px solid #d8d8d8 !important; /\* 保持底部边框 \*/ }

HappyHorse图生视频模型，以首帧图片为基础，支持通过文本描述进行引导，生成物理真实、运动流畅的视频。

## 适用范围

为确保调用成功，请务必保证模型、endpoint URL 和 API Key 均属于**同一地域**。跨地域调用将会失败。

-   [**选择模型**](https://modelstudio.console.alibabacloud.com/ap-southeast-1?tab=doc#/doc/?type=model&url=2840914)：确认模型所属的地域。
    
-   **选择 URL**：选择对应的地域 Endpoint URL，支持HTTP URL。
    
-   **配置 API Key**：获取该地域的[API Key](/help/zh/model-studio/get-api-key)，再[配置API Key到环境变量](/help/zh/model-studio/configure-api-key-through-environment-variables)。
    

**说明**

本文的示例代码适用于**新加坡地域**。

**重要**

百炼为新加坡地域推出了业务空间专属域名 `https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com`，**能够为推理请求提供卓越的性能和更高的稳定性**，建议从 `https://dashscope-intl.aliyuncs.com` 迁移至新域名。

其中 `{WorkspaceId}` 为您的业务空间 ID，可在百炼控制台的**业务空间详情**页面查看。现有域名仍可正常使用。

## HTTP调用

图生视频任务耗时较长（通常为1-5分钟），API采用异步调用的方式。整个流程包含 **"创建任务 -> 轮询获取"** 两个核心步骤，具体如下：

### **步骤1：创建任务获取任务ID**

## **新加坡**

`POST https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis`

调用时请将`WorkspaceId`替换为真实的[Workspace ID](/help/zh/model-studio/obtain-the-app-id-and-workspace-id#d3eb3cd37b7fu)。

## **美国（弗吉尼亚）**

`POST https://dashscope-us.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis`

## **华北2（北京）**

`POST https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis`

## **德国（法兰克福）**

`POST https://{WorkspaceId}.eu-central-1.maas.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis`

调用时请将`WorkspaceId`替换为真实的[Workspace ID](/help/zh/model-studio/obtain-the-app-id-and-workspace-id#d3eb3cd37b7fu)。

**说明**

-   创建成功后，使用接口返回的 `task_id` 查询结果，task\_id 有效期为 24 小时。**请勿重复创建任务**，轮询获取即可。
    
-   新手指引请参见[Postman](/help/zh/model-studio/first-call-to-image-and-video-api)。
    

| #### 请求参数 | ## 图生视频-基于首帧 ``` curl --location 'https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis' \\ -H 'X-DashScope-Async: enable' \\ -H "Authorization: Bearer $DASHSCOPE_API_KEY" \\ -H 'Content-Type: application/json' \\ -d '{ "model": "happyhorse-1.0-i2v", "input": { "prompt": "一只猫在草地上奔跑", "media": [ { "type": "first_frame", "url": "https://cdn.translate.alibaba.com/r/wanx-demo-1.png" } ] }, "parameters": { "resolution": "720P", "duration": 5 } }' ``` |
| --- | --- |
| **Content-Type** `*string*` **（必选）** 请求内容类型。此参数必须设置为`application/json`。 |
| **Authorization** `*string*`**（必选）** 请求身份认证。接口使用阿里云百炼API Key进行身份认证。示例值：Bearer sk-xxxx。 |
| **X-DashScope-Async** `*string*` **（必选）** 异步处理配置参数。HTTP请求只支持异步，**必须设置为**`**enable**`。 **重要** 缺少此请求头将报错：“current user api does not support synchronous calls”。 |
| ##### 请求体（Request Body） |
| **model** `*string*` **（必选）** 模型名称。 可选值： - `happyhorse-1.0-i2v` |
| **input** `*object*` **（必选）** 输入的基本信息，如提示词等。 **属性** **prompt** `*string*` （可选） 文本提示词。用于描述期望生成的视频内容。 支持任何语言输入，长度不超过5000个非中文字符或2500个中文字符，超过部分将自动截断。 **media** `*array*` **（必选）** 输入媒体列表。用于指定视频生成所需的图像。 **media\\[\\] 元素属性** **type** `*string*` **（必选）** 媒体素材类型。可选值为： - `first_frame`：首帧。 素材限制：有且仅有1张首帧图像。 **url** `*string*` **（必选）** 媒体素材URL。 传入图像（type=first\\_frame） 首帧URL，或 Base64 编码数据。 图像限制： - 格式：JPEG、JPG、PNG、WEBP。 - 分辨率：宽和高不小于300像素。 - 宽高比：1:2.5～2.5:1。 - 文件大小：不超过20MB。 支持输入的格式： 1. 公网URL： - 支持 HTTP 或 HTTPS 协议。 - 示例值：https://xxx/xxx.png。 2. Base64 编码图像后的字符串： - 数据格式：`data:{MIME_type};base64,{base64_data}`。 - 示例值：data:image/png;base64,GDU7MtCZzEbTbmRZ......（示例已截断，仅做演示）。 **Base64编码数据格式** 格式： `data:{MIME_type};base64,{base64_data}` 。 - {base64\\_data}：图像文件经过 Base64 编码后的字符串。 - {MIME\\_type}：图像的媒体类型，需与文件格式对应。 \\| 图像格式 \\| MIME Type \\| \\| --- \\| --- \\| \\| JPEG \\| image/jpeg \\| \\| JPG \\| image/jpeg \\| \\| PNG \\| image/png \\| \\| WEBP \\| image/webp \\| |
| **parameters** `*object*` （可选） 视频处理参数，如设置视频分辨率、设置视频时长等。 **属性** **resolution** `*string*` （可选） 指定生成的视频分辨率档位，用于控制视频的清晰度（总像素）。 模型根据选择的分辨率档位，自动缩放至相近总像素。输出的视频宽高比与输入首帧近似一致。 可选值： - `720P` - `1080P`：默认值。 **duration** `*integer*` （可选） 指定生成视频的时长，单位为秒。 取值为\\[3, 15\\]之间的整数。默认值为`5`。 **watermark** `*boolean*` （可选） 是否在生成的视频上添加水印标识。水印位于视频右下角，文案固定为“Happy Horse”。 - `true`：默认值，添加水印。 - `false`：不添加水印。 **seed** `*integer*` （可选） 随机数种子，取值范围为`[0, 2147483647]`。 未指定时，系统自动生成随机种子。若需提升生成结果的可复现性，建议固定seed值。 请注意，由于模型生成具有概率性，即使使用相同 seed，也不能保证每次生成结果完全一致。 |

| #### 响应参数 | ### 成功响应 请保存 task\\_id，用于查询任务状态与结果。 ``` { "output": { "task_status": "PENDING", "task_id": "0385dc79-5ff8-4d82-bcb6-xxxxxx" }, "request_id": "4909100c-7b5a-9f92-bfe5-xxxxxx" } ``` ### 异常响应 创建任务失败，请参见[错误码](/help/zh/model-studio/error-code)进行解决。 ``` { "code": "InvalidApiKey", "message": "No API-key provided.", "request_id": "7438d53d-6eb8-4596-8835-xxxxxx" } ``` |
| --- | --- |
| **output** `*object*` 任务输出信息。 属性 **task\\_id** `*string*` 任务ID。查询有效期24小时。 **task\\_status** `*string*` 任务状态。 **枚举值** - PENDING：任务排队中 - RUNNING：任务处理中 - SUCCEEDED：任务执行成功 - FAILED：任务执行失败 - CANCELED：任务已取消 - UNKNOWN：任务不存在或状态未知 |
| **request\\_id** `*string*` 请求唯一标识。可用于请求明细溯源和问题排查。 |
| **code** `*string*` 请求失败的错误码。请求成功时不会返回此参数，详情请参见[错误码](/help/zh/model-studio/error-code)。 |
| **message** `*string*` 请求失败的详细信息。请求成功时不会返回此参数，详情请参见[错误码](/help/zh/model-studio/error-code)。 |

### **步骤2：根据任务ID查询结果**

## **新加坡**

`GET https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/api/v1/tasks/{task_id}`

调用时请将`WorkspaceId`替换为真实的[Workspace ID](/help/zh/model-studio/obtain-the-app-id-and-workspace-id#d3eb3cd37b7fu)。

## **美国（弗吉尼亚）**

`GET https://dashscope-us.aliyuncs.com/api/v1/tasks/{task_id}`

## **华北2（北京）**

`GET https://dashscope.aliyuncs.com/api/v1/tasks/{task_id}`

## **德国（法兰克福）**

`GET https://{WorkspaceId}.eu-central-1.maas.aliyuncs.com/api/v1/tasks/{task_id}`

调用时请将`WorkspaceId`替换为真实的[Workspace ID](/help/zh/model-studio/obtain-the-app-id-and-workspace-id#d3eb3cd37b7fu)。

**说明**

-   **轮询建议**：视频生成过程约需数分钟，建议采用**轮询**机制，并设置合理的查询间隔（如 15 秒）来获取结果。
    
-   **任务状态流转**：PENDING（排队中）→ RUNNING（处理中）→ SUCCEEDED（成功）/ FAILED（失败）。
    
-   **结果链接**：任务成功后返回视频链接，有效期为 **24 小时**。建议在获取链接后立即下载并转存至永久存储（如[阿里云 OSS](/help/zh/oss/user-guide/what-is-oss)）。
    
-   **task\_id 有效期**：**24小时**，超时后将无法查询结果，接口将返回任务状态为`UNKNOWN`。
    

| #### 请求参数 | ## 查询任务结果 将`{task_id}`完整替换为上一步接口返回的`task_id`的值。`task_id`查询有效期为24小时。 ``` curl -X GET https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/api/v1/tasks/{task_id} \\ --header "Authorization: Bearer $DASHSCOPE_API_KEY" ``` |
| --- | --- |
| ##### **请求头（Headers）** |
| **Authorization** `*string*`**（必选）** 请求身份认证。接口使用阿里云百炼API Key进行身份认证。示例值：Bearer sk-xxxx。 |
| ##### **URL路径参数（Path parameters）** |
| **task\\_id** `*string*`**（必选）** 任务ID。 |

| #### **响应参数** | ## 任务执行成功 视频URL仅保留24小时，超时后会被自动清除，请及时保存生成的视频。 ``` { "request_id": "8ae698ba-df2d-966c-abcf-xxxxxx", "output": { "task_id": "e56d806f-76f9-4037-aefa-xxxxxx", "task_status": "SUCCEEDED", "submit_time": "2026-04-20 19:33:50.425", "scheduled_time": "2026-04-20 19:33:50.463", "end_time": "2026-04-20 19:35:34.216", "orig_prompt": "一只猫在草地上奔跑", "video_url": "https://dashscope-result.oss-cn-beijing.aliyuncs.com/xxx.mp4?Expires=xxx" }, "usage": { "duration": 5, "input_video_duration": 0, "output_video_duration": 5, "video_count": 1, "SR": 720 } } ``` ## 任务执行失败 若任务执行失败，task\\_status将置为 FAILED，并提供错误码和信息。请参见[错误码](/help/zh/model-studio/error-code)进行解决。 ``` { "request_id": "e5d70b02-ebd3-98ce-9fe8-759d7d7b107d", "output": { "task_id": "86ecf553-d340-4e21-af6e-a0c6a421c010", "task_status": "FAILED", "code": "InvalidParameter", "message": "The parameter is invalid." } } ``` ## 任务查询过期 task\\_id查询有效期为 24 小时，超时后将无法查询，返回以下报错信息。 ``` { "request_id": "a4de7c32-7057-9f82-8581-xxxxxx", "output": { "task_id": "502a00b1-19d9-4839-a82f-xxxxxx", "task_status": "UNKNOWN" } } ``` |
| --- | --- |
| **output** `*object*` 任务输出信息。 **属性** **task\\_id** `*string*` 任务ID。查询有效期24小时。 **task\\_status** `*string*` 任务状态。 **枚举值** - PENDING：任务排队中 - RUNNING：任务处理中 - SUCCEEDED：任务执行成功 - FAILED：任务执行失败 - CANCELED：任务已取消 - UNKNOWN：任务不存在或状态未知 **轮询过程中的状态流转：** - PENDING（排队中） → RUNNING（处理中）→ SUCCEEDED（成功）/ FAILED（失败）。 - 初次查询状态通常为 PENDING（排队中）或 RUNNING（处理中）。 - 当状态变为 SUCCEEDED 时，响应中将包含生成的视频URL。 - 若状态为 FAILED，请检查错误信息并重试。 - 若状态为 CANCELED，表示任务已取消，如需继续请重新提交任务。 - 若状态为 UNKNOWN，表示任务不存在或状态未知，可能在 task\\_id 不存在或超过 24 小时有效期后出现。 **submit\\_time** `*string*` 任务提交时间。时区为UTC+8，格式为 YYYY-MM-DD HH:mm:ss.SSS。 **scheduled\\_time** `*string*` 任务执行时间。时区为UTC+8，格式为 YYYY-MM-DD HH:mm:ss.SSS。 **end\\_time** `*string*` 任务完成时间。时区为UTC+8，格式为 YYYY-MM-DD HH:mm:ss.SSS。 **video\\_url** `*string*` 视频URL。仅在 task\\_status 为 SUCCEEDED 时返回。 链接有效期24小时，可通过此URL下载视频。视频帧率为24fps，格式为MP4（H.264 编码）。 **orig\\_prompt** `*string*` 原始输入的prompt，对应请求参数`prompt`。 **code** `*string*` 请求失败的错误码。请求成功时不会返回此参数，详情请参见[错误码](/help/zh/model-studio/error-code)。 **message** `*string*` 请求失败的详细信息。请求成功时不会返回此参数，详情请参见[错误码](/help/zh/model-studio/error-code)。 |
| **usage** `*object*` 输出信息统计，只对成功的结果计数。 **属性** **input\\_video\\_duration** `*integer*` 输入的视频的时长，单位秒。 **output\\_video\\_duration** `*integer*` 输出视频的时长，单位秒。 **duration** `*integer*` 总的视频时长，用于计费。 **SR** `*integer*` 输出视频的分辨率档位。 **video\\_count** `*integer*` 输出视频的数量。固定为1。 |
| **request\\_id** `*string*` 请求唯一标识。可用于请求明细溯源和问题排查。 |

## **错误码**

如果模型调用失败并返回报错信息，请参见[错误码](/help/zh/model-studio/error-code)进行解决。

## 常见问题

#### **视频的宽高比如何确定？**

图生视频的宽高比自动跟随输入首帧图像，无需手动指定。与[HappyHorse-文生视频](/help/zh/model-studio/happyhorse-text-to-video-api-reference)不同，图生视频不支持 `ratio` 参数。

.table-wrapper { overflow: visible !important; } /\* 调整 table 宽度 \*/ .aliyun-docs-content table.medium-width { max-width: 1018px; width: 100%; } .aliyun-docs-content table.table-no-border tr td:first-child { padding-left: 0; } .aliyun-docs-content table.table-no-border tr td:last-child { padding-right: 0; } /\* 支持吸顶 \*/ div:has(.aliyun-docs-content), .aliyun-docs-content .markdown-body { overflow: visible; } .stick-top { position: sticky; top: 46px; } /\*\*代码块字体\*\*/ /\* 减少表格中的代码块 margin，让表格信息显示更紧凑 \*/ .unionContainer .markdown-body table .help-code-block { margin: 0 !important; } /\* 减少表格中的代码块字号，让表格信息显示更紧凑 \*/ .unionContainer .markdown-body .help-code-block pre { font-size: 12px !important; } /\* 减少表格中的代码块字号，让表格信息显示更紧凑 \*/ .unionContainer .markdown-body .help-code-block pre code { font-size: 12px !important; } /\*\* API Reference 表格 \*\*/ .aliyun-docs-content table.api-reference tr td:first-child { margin: 0px; border-bottom: 1px solid #d8d8d8; } .aliyun-docs-content table.api-reference tr:last-child td:first-child { border-bottom: none; } .aliyun-docs-content table.api-reference p { color: #6e6e80; } .aliyun-docs-content table.api-reference b, i { color: #181818; } .aliyun-docs-content table.api-reference .collapse { border: none; margin-top: 4px; margin-bottom: 4px; } .aliyun-docs-content table.api-reference .collapse .expandable-title-bold { padding: 0; } .aliyun-docs-content table.api-reference .collapse .expandable-title { padding: 0; } .aliyun-docs-content table.api-reference .collapse .expandable-title-bold .title { margin-left: 16px; } .aliyun-docs-content table.api-reference .collapse .expandable-title .title { margin-left: 16px; } .aliyun-docs-content table.api-reference .collapse .expandable-title-bold i.icon { position: absolute; color: #777; font-weight: 100; } .aliyun-docs-content table.api-reference .collapse .expandable-title i.icon { position: absolute; color: #777; font-weight: 100; } .aliyun-docs-content table.api-reference .collapse.expanded .expandable-content { padding: 10px 14px 10px 14px !important; margin: 0; border: 1px solid #e9e9e9; } .aliyun-docs-content table.api-reference .collapse .expandable-title-bold b { font-size: 13px; font-weight: normal; color: #6e6e80; } .aliyun-docs-content table.api-reference .collapse .expandable-title b { font-size: 13px; font-weight: normal; color: #6e6e80; } .aliyun-docs-content table.api-reference .tabbed-content-box { border: none; } .aliyun-docs-content table.api-reference .tabbed-content-box section { padding: 8px 0 !important; } .aliyun-docs-content table.api-reference .tabbed-content-box.mini .tab-box { /\* position: absolute; left: 40px; right: 0; \*/ } .aliyun-docs-content .margin-top-33 { margin-top: 33px !important; } .aliyun-docs-content .two-codeblocks pre { max-height: calc(50vh - 136px) !important; height: auto; } .expandable-content section { border-bottom: 1px solid #e9e9e9; padding-top: 6px; padding-bottom: 4px; } .expandable-content section:last-child { border-bottom: none; } .expandable-content section:first-child { padding-top: 0; }

/\* ========================================= \*/ /\* 新增样式：带边框的表格 (api-table-border) \*/ /\* ========================================= \*/ /\* 1. 表格容器核心设置 \*/ .aliyun-docs-content table.api-table-border { border: 1px solid #d8d8d8 !important; /\* 表格外边框 \*/ border-collapse: collapse !important; /\* 合并边框，防止双线 \*/ width: 100% !important; /\* 宽度占满 \*/ margin: 10px 0 !important; /\* 上下间距 \*/ background-color: #fff !important; /\* 背景色 \*/ box-sizing: border-box !important; } /\* 2. 表头、表体、行设置 \*/ /\* 确保行本身没有干扰边框 \*/ .aliyun-docs-content table.api-table-border thead, .aliyun-docs-content table.api-table-border tbody, .aliyun-docs-content table.api-table-border tr { border: none !important; background-color: transparent !important; } /\* 3. 单元格设置 (th 和 td) \*/ /\* 这是边框显示的关键位置 \*/ .aliyun-docs-content table.api-table-border th, .aliyun-docs-content table.api-table-border td { border: 1px solid #d8d8d8 !important; /\* 单元格四周边框 \*/ padding: 8px 12px !important; /\* 内边距 \*/ text-align: left !important; /\* 文字左对齐 \*/ vertical-align: middle !important; /\* 垂直居中 \*/ color: #6e6e80 !important; /\* 文字颜色 \*/ font-size: 14px !important; /\* 字体大小 \*/ line-height: 1.5 !important; } /\* 4. 表头特殊样式 \*/ .aliyun-docs-content table.api-table-border th { background-color: #f9fafb !important; /\* 表头背景色 \*/ color: #181818 !important; /\* 表头文字颜色 \*/ font-weight: 600 !important; /\* 表头加粗 \*/ } /\* 5. 鼠标悬停效果 (可选) \*/ .aliyun-docs-content table.api-table-border tbody tr:hover td { background-color: #fcfcfc !important; /\* 悬停时背景微变 \*/ } /\* 6. 兼容原有 api-reference 可能存在的冲突 \*/ /\* 如果原有样式针对 td:first-child 等特殊选择器有干扰，这里强制覆盖 \*/ .aliyun-docs-content table.api-table-border tr td:first-child { border-bottom: 1px solid #d8d8d8 !important; margin: 0 !important; } .aliyun-docs-content table.api-table-border tr:last-child td:first-child { border-bottom: 1px solid #d8d8d8 !important; /\* 保持底部边框 \*/ }


HappyHorse-参考生视频模型支持传入**多张参考图像**，通过**文本提示词**描述场景，将图像中的主体角色融合生成一段流畅的视频。

## 适用范围

为确保调用成功，请务必保证**模型、Endpoint URL 和 API Key 均属于同一地域**。跨地域调用将会失败。

-   [**选择模型**](https://modelstudio.console.alibabacloud.com/ap-southeast-1?tab=doc#/doc/?type=model&url=2840914)：确认模型所属的地域。
    
-   **选择 URL**：选择对应的地域 Endpoint URL，支持HTTP URL或 DashScope SDK URL。
    
-   **配置 API Key**：选择地域并[获取API Key](/help/zh/model-studio/get-api-key)，再[配置API Key到环境变量](/help/zh/model-studio/configure-api-key-through-environment-variables)。
    

**说明**

本文的示例代码适用于**新加坡地域**。

**重要**

百炼为新加坡地域推出了业务空间专属域名 `https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com`，**能够为推理请求提供卓越的性能和更高的稳定性**，建议从 `https://dashscope-intl.aliyuncs.com` 迁移至新域名。

其中 `{WorkspaceId}` 为您的业务空间 ID，可在百炼控制台的**业务空间详情**页面查看。现有域名仍可正常使用。

## HTTP调用

由于参考生视频任务耗时较长（通常为1-5分钟），API采用异步调用。整个流程包含 **"创建任务 -> 轮询获取"** 两个核心步骤，具体如下：

### **步骤1：创建任务获取任务ID**

## **新加坡**

`POST https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis`

调用时请将`WorkspaceId`替换为真实的[Workspace ID](/help/zh/model-studio/obtain-the-app-id-and-workspace-id#d3eb3cd37b7fu)。

## **美国（弗吉尼亚）**

`POST https://dashscope-us.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis`

## **华北2（北京）**

`POST https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis`

## **德国（法兰克福）**

`POST https://{WorkspaceId}.eu-central-1.maas.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis`

调用时请将`WorkspaceId`替换为真实的[Workspace ID](/help/zh/model-studio/obtain-the-app-id-and-workspace-id#d3eb3cd37b7fu)。

**说明**

-   创建成功后，使用接口返回的 `task_id` 查询结果，task\_id 有效期为 24 小时。**请勿重复创建任务**，轮询获取即可。
    
-   新手指引请参见[Postman](/help/zh/model-studio/first-call-to-image-and-video-api)。
    

| #### 请求参数 | ## 参考生视频（多图像） ``` curl --location 'https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis' \\ -H 'X-DashScope-Async: enable' \\ -H "Authorization: Bearer $DASHSCOPE_API_KEY" \\ -H 'Content-Type: application/json' \\ -d '{ "model": "happyhorse-1.0-r2v", "input": { "prompt": "[Image 1]中身着红色旗袍的女性，镜头先以侧面中景勾勒旗袍修身剪裁与S型曲线，随即切换至低角度仰拍，捕捉她轻抬玉手展开[Image 2]中的折扇的同时，[Image 3]中的流苏耳坠随头部转动轻盈摆动的细节，最后推近至面部特写，定格在她指尖轻点扇骨、眼波流转间的含蓄风情，多视角全方位展现东方韵味。", "media": [ { "type": "reference_image", "url": "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20260424/mvzfud/hh-v2v-girl.jpg" }, { "type": "reference_image", "url": "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20260424/fvuihk/hh-v2v2-folding-fan.jpg" }, { "type": "reference_image", "url": "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20260424/imerii/hh-v2v-earrings.jpg" } ] }, "parameters": { "resolution": "720P", "ratio": "16:9", "duration": 5 } }' ``` |
| --- | --- |
| ##### 请求头（Headers） |
| **Content-Type** `*string*` **（必选）** 请求内容类型。此参数必须设置为`application/json`。 |
| **Authorization** `*string*`**（必选）** 请求身份认证。接口使用阿里云百炼API Key进行身份认证。示例值：Bearer sk-xxxx。 |
| **X-DashScope-Async** `*string*` **（必选）** 异步处理配置参数。HTTP请求只支持异步，**必须设置为**`**enable**`。 **重要** 缺少此请求头将报错：“current user api does not support synchronous calls”。 |
| ##### 请求体（Request Body） |
| **model** `*string*` **（必选）** 模型名称。 固定值：happyhorse-1.0-r2v。 |
| **input** `*object*` **（必选）** 输入的基本信息，包括参考图像和提示词。 **属性** **prompt** `*string*` **（必选）** 文本提示词。用来描述生成视频中期望包含的元素和视觉特点。 支持任何语言输入，长度不超过5000个非中文字符或2500个中文字符，超过部分会自动截断。 **参考指代**：在prompt中通过“**\\[Image 1\\]、\\[Image 2\\]**”标识指代`media`数组中对应位置的参考图像，顺序与`media`数组顺序一致。使用时需要指明参考图中的具体对象，例如“\\[Image 1\\]中身着红色旗袍的女性”。 **media** `*array*` **（必选）** 媒体素材列表，用于指定参考图像。 数组的每个元素为一个媒体对象，包含 `type`和 `url`字段。 - 按照数组顺序定义`prompt`中角色引用的顺序。 - 数组中的第 1 个`reference_image`对应 **\\[Image 1\\]**，第 2 个对应 **\\[Image 2\\]**，以此类推。 **元素属性** **type** `*string*` **（必选）** 媒体素材类型。固定值为： - `reference_image`：参考图像。 素材限制： - 参考图像数量：1～9张。 **url** `*string*` **（必选）** 参考图像URL或 Base64 编码数据。 图像限制： - 格式：JPEG、JPG、PNG、WEBP。 - 分辨率：短边不低于400像素，推荐720P以上清晰图。避免传入过小、模糊或压缩过度的图像，影响效果。 - 文件大小：不超过20MB。 支持输入的格式： 1. 公网URL： - 支持 HTTP 或 HTTPS 协议。 - 示例值：https://xxx/xxx.jpg。 2. Base64 编码图像后的字符串： - 数据格式：`data:{MIME_type};base64,{base64_data}`。 - 示例值：data:image/png;base64,GDU7MtCZzEbTbmRZ......（示例已截断，仅做演示）。 **Base64编码数据格式** 格式： `data:{MIME_type};base64,{base64_data}` 。 - {base64\\_data}：图像文件经过 Base64 编码后的字符串。 - {MIME\\_type}：图像的媒体类型，需与文件格式对应。 \\| 图像格式 \\| MIME Type \\| \\| --- \\| --- \\| \\| JPEG \\| image/jpeg \\| \\| JPG \\| image/jpeg \\| \\| PNG \\| image/png \\| \\| WEBP \\| image/webp \\| |
| **parameters** `*object*` （可选） 视频生成参数。如设置视频分辨率、宽高比、时长等。 **属性** **resolution** `*string*` （可选） 生成视频的分辨率档位。 可选值： - `1080P`：默认值。 - `720P` **ratio** `*string*` （可选） 生成视频的宽高比。 可选值： - `16:9`：默认值。 - `9:16` - `3:4` - `4:3` - `4:5` - `5:4` - `1:1` - `9:21` - `21:9` **duration** `*integer*` （可选） 生成视频的时长，单位为秒。 取值范围：`3~15`之间的整数。 默认值：`5`。 **watermark** `*boolean*` （可选） 是否在生成的视频上添加水印标识。水印位于视频右下角，文案固定为“Happy Horse”。 - `true`：默认值，添加水印。 - `false`：不添加水印。 **seed** `*integer*` （可选） 随机数种子，取值范围为`[0, 2147483647]`。 未指定时，系统自动生成随机种子。若需提升生成结果的可复现性，建议固定seed值。 请注意，由于模型生成具有概率性，即使使用相同 seed，也不能保证每次生成结果完全一致。 |

| #### 响应参数 | ### 成功响应 请保存 task\\_id，用于查询任务状态与结果。 ``` { "output": { "task_status": "PENDING", "task_id": "0385dc79-5ff8-4d82-bcb6-xxxxxx" }, "request_id": "4909100c-7b5a-9f92-bfe5-xxxxxx" } ``` ### 异常响应 创建任务失败，请参见[错误码](/help/zh/model-studio/error-code)进行解决。 ``` { "code": "InvalidApiKey", "message": "No API-key provided.", "request_id": "7438d53d-6eb8-4596-8835-xxxxxx" } ``` |
| --- | --- |
| **output** `*object*` 任务输出信息。 **属性** **task\\_id** `*string*` 任务ID。查询有效期24小时。 **task\\_status** `*string*` 任务状态。 **枚举值** - PENDING：任务排队中 - RUNNING：任务处理中 - SUCCEEDED：任务执行成功 - FAILED：任务执行失败 - CANCELED：任务已取消 - UNKNOWN：任务不存在或状态未知 |
| **request\\_id** `*string*` 请求唯一标识。可用于请求明细溯源和问题排查。 |
| **code** `*string*` 请求失败的错误码。请求成功时不会返回此参数，详情请参见[错误码](/help/zh/model-studio/error-code)。 |     |
| **message** `*string*` 请求失败的详细信息。请求成功时不会返回此参数，详情请参见[错误码](/help/zh/model-studio/error-code)。 |     |

### **步骤2：根据任务ID查询结果**

## **新加坡**

`GET https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/api/v1/tasks/{task_id}`

调用时请将`WorkspaceId`替换为真实的[Workspace ID](/help/zh/model-studio/obtain-the-app-id-and-workspace-id#d3eb3cd37b7fu)。

## **美国（弗吉尼亚）**

`GET https://dashscope-us.aliyuncs.com/api/v1/tasks/{task_id}`

## **华北2（北京）**

`GET https://dashscope.aliyuncs.com/api/v1/tasks/{task_id}`

## **德国（法兰克福）**

`GET https://{WorkspaceId}.eu-central-1.maas.aliyuncs.com/api/v1/tasks/{task_id}`

调用时请将`WorkspaceId`替换为真实的[Workspace ID](/help/zh/model-studio/obtain-the-app-id-and-workspace-id#d3eb3cd37b7fu)。

**说明**

-   **轮询建议**：视频生成过程约需数分钟，建议采用**轮询**机制，并设置合理的查询间隔（如 15 秒）来获取结果。
    
-   **任务状态流转**：PENDING（排队中）→ RUNNING（处理中）→ SUCCEEDED（成功）/ FAILED（失败）。
    
-   **task\_id 有效期**：**24小时**，超时后将无法查询结果，接口将返回任务状态为`UNKNOWN`。
    

| #### 请求参数 | ## 查询任务结果 将`{task_id}`完整替换为上一步接口返回的`task_id`的值。`task_id`查询有效期为24小时。 ``` curl -X GET https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/api/v1/tasks/{task_id} \\ --header "Authorization: Bearer $DASHSCOPE_API_KEY" ``` |
| --- | --- |
| ##### **请求头（Headers）** |
| **Authorization** `*string*`**（必选）** 请求身份认证。接口使用阿里云百炼API Key进行身份认证。示例值：Bearer sk-xxxx。 |
| ##### **URL路径参数（Path parameters）** |
| **task\\_id** `*string*`**（必选）** 任务ID。 |

| #### **响应参数** | #### **任务执行成功** 视频URL仅保留24小时，超时后会被自动清除，请及时保存生成的视频。 ``` { "request_id": "35137489-2862-96cb-b6f2-xxxxxx", "output": { "task_id": "1469cfc3-3004-4d9e-ab10-xxxxxx", "task_status": "SUCCEEDED", "submit_time": "2026-04-25 15:03:25.848", "scheduled_time": "2026-04-25 15:03:25.884", "end_time": "2026-04-25 15:04:05.882", "orig_prompt": "[Image 1]中身着红色旗袍的女性，镜头先以侧面中景勾勒旗袍修身剪裁与S型曲线，随即切换至低角度仰拍，捕捉她轻抬玉手展开[Image 2]中的折扇的同时，[Image 3]中的流苏耳坠随头部转动轻盈摆动的细节，最后推近至面部特写，定格在她指尖轻点扇骨、眼波流转间的含蓄风情，多视角全方位展现东方韵味。", "video_url": "https://dashscope-result.oss-cn-beijing.aliyuncs.com/xxxx.mp4" }, "usage": { "duration": 5, "input_video_duration": 0, "output_video_duration": 5, "video_count": 1, "SR": 720, "ratio": "16:9" } } ``` ## 任务执行失败 若任务执行失败，task\\_status将置为 FAILED，并提供错误码和信息。请参见[错误码](/help/zh/model-studio/error-code)进行解决。 ``` { "request_id": "e5d70b02-ebd3-98ce-9fe8-759d7d7b107d", "output": { "task_id": "86ecf553-d340-4e21-af6e-a0c6a421c010", "task_status": "FAILED", "code": "InvalidParameter", "message": "The resolution is not valid xxxxxx" } } ``` ## 任务查询过期 task\\_id查询有效期为 24 小时，超时后将无法查询，返回以下报错信息。 ``` { "request_id": "a4de7c32-7057-9f82-8581-xxxxxx", "output": { "task_id": "502a00b1-19d9-4839-a82f-xxxxxx", "task_status": "UNKNOWN" } } ``` |
| --- | --- |
| **output** `*object*` 任务输出信息。 **属性** **task\\_id** `*string*` 任务ID。查询有效期24小时。 **task\\_status** `*string*` 任务状态。 **枚举值** - PENDING：任务排队中 - RUNNING：任务处理中 - SUCCEEDED：任务执行成功 - FAILED：任务执行失败 - CANCELED：任务已取消 - UNKNOWN：任务不存在或状态未知 **轮询过程中的状态流转：** - PENDING（排队中） → RUNNING（处理中）→ SUCCEEDED（成功）/ FAILED（失败）。 - 初次查询状态通常为 PENDING（排队中）或 RUNNING（处理中）。 - 当状态变为 SUCCEEDED 时，响应中将包含生成的视频URL。 - 若状态为 FAILED，请检查错误信息并重试。 - 若状态为 CANCELED，表示任务已取消，如需继续请重新提交任务。 - 若状态为 UNKNOWN，表示任务不存在或状态未知，可能在 task\\_id 不存在或超过 24 小时有效期后出现。 **submit\\_time** `*string*` 任务提交时间。时区为UTC+8，格式为 YYYY-MM-DD HH:mm:ss.SSS。 **scheduled\\_time** `*string*` 任务执行时间。时区为UTC+8，格式为 YYYY-MM-DD HH:mm:ss.SSS。 **end\\_time** `*string*` 任务完成时间。时区为UTC+8，格式为 YYYY-MM-DD HH:mm:ss.SSS。 **video\\_url** `*string*` 视频URL。仅在 task\\_status 为 SUCCEEDED 时返回。 链接有效期24小时，可通过此URL下载视频。视频格式为MP4（H.264 编码）。 **orig\\_prompt** `*string*` 原始输入的prompt，对应请求参数`prompt`。 **code** `*string*` 请求失败的错误码。请求成功时不会返回此参数，详情请参见[错误码](/help/zh/model-studio/error-code)。 **message** `*string*` 请求失败的详细信息。请求成功时不会返回此参数，详情请参见[错误码](/help/zh/model-studio/error-code)。 |
| **usage** `*object*` 输出信息统计。只对成功的结果计数。 **属性** **duration** `*integer*` 生成视频的总视频时长，用于计费。 **input\\_video\\_duration** `*integer*` 输入视频的总时长，单位为秒。参考生视频中固定为0。 **output\\_video\\_duration** `*integer*` 输出视频的总时长，单位为秒。 **ratio** `*string*` 生成视频的宽高比。 **SR** `*integer*` 生成视频的分辨率档位。 **video\\_count** `*integer*` 生成视频的数量。固定为1。 |     |
| **request\\_id** `*string*` 请求唯一标识。可用于请求明细溯源和问题排查。 |     |

## **错误码**

如果模型调用失败并返回报错信息，请参见[错误码](/help/zh/model-studio/error-code)进行解决。

.table-wrapper { overflow: visible !important; } /\* 调整 table 宽度 \*/ .aliyun-docs-content table.medium-width { max-width: 1018px; width: 100%; } .aliyun-docs-content table.table-no-border tr td:first-child { padding-left: 0; } .aliyun-docs-content table.table-no-border tr td:last-child { padding-right: 0; } /\* 支持吸顶 \*/ div:has(.aliyun-docs-content), .aliyun-docs-content .markdown-body { overflow: visible; } .stick-top { position: sticky; top: 46px; } /\*\*代码块字体\*\*/ /\* 减少表格中的代码块 margin，让表格信息显示更紧凑 \*/ .unionContainer .markdown-body table .help-code-block { margin: 0 !important; } /\* 减少表格中的代码块字号，让表格信息显示更紧凑 \*/ .unionContainer .markdown-body .help-code-block pre { font-size: 12px !important; } /\* 减少表格中的代码块字号，让表格信息显示更紧凑 \*/ .unionContainer .markdown-body .help-code-block pre code { font-size: 12px !important; } /\*\* API Reference 表格 \*\*/ .aliyun-docs-content table.api-reference tr td:first-child { margin: 0px; border-bottom: 1px solid #d8d8d8; } .aliyun-docs-content table.api-reference tr:last-child td:first-child { border-bottom: none; } .aliyun-docs-content table.api-reference p { color: #6e6e80; } .aliyun-docs-content table.api-reference b, i { color: #181818; } .aliyun-docs-content table.api-reference .collapse { border: none; margin-top: 4px; margin-bottom: 4px; } .aliyun-docs-content table.api-reference .collapse .expandable-title-bold { padding: 0; } .aliyun-docs-content table.api-reference .collapse .expandable-title { padding: 0; } .aliyun-docs-content table.api-reference .collapse .expandable-title-bold .title { margin-left: 16px; } .aliyun-docs-content table.api-reference .collapse .expandable-title .title { margin-left: 16px; } .aliyun-docs-content table.api-reference .collapse .expandable-title-bold i.icon { position: absolute; color: #777; font-weight: 100; } .aliyun-docs-content table.api-reference .collapse .expandable-title i.icon { position: absolute; color: #777; font-weight: 100; } .aliyun-docs-content table.api-reference .collapse.expanded .expandable-content { padding: 10px 14px 10px 14px !important; margin: 0; border: 1px solid #e9e9e9; } .aliyun-docs-content table.api-reference .collapse .expandable-title-bold b { font-size: 13px; font-weight: normal; color: #6e6e80; } .aliyun-docs-content table.api-reference .collapse .expandable-title b { font-size: 13px; font-weight: normal; color: #6e6e80; } .aliyun-docs-content table.api-reference .tabbed-content-box { border: none; } .aliyun-docs-content table.api-reference .tabbed-content-box section { padding: 8px 0 !important; } .aliyun-docs-content table.api-reference .tabbed-content-box.mini .tab-box { /\* position: absolute; left: 40px; right: 0; \*/ } .aliyun-docs-content .margin-top-33 { margin-top: 33px !important; } .aliyun-docs-content .two-codeblocks pre { max-height: calc(50vh - 136px) !important; height: auto; } .expandable-content section { border-bottom: 1px solid #e9e9e9; padding-top: 6px; padding-bottom: 4px; } .expandable-content section:last-child { border-bottom: none; } .expandable-content section:first-child { padding-top: 0; }

/\* 让表格显示成类似钉钉文档的分栏卡片 \*/ table.help-table-card td { border: 10px solid #FFF !important; background: #F4F6F9; padding: 16px !important; vertical-align: top; } /\* 减少表格中的代码块 margin，让表格信息显示更紧凑 \*/ .unionContainer .markdown-body table .help-code-block { margin: 0 !important; } /\* 减少表格中的代码块字号，让表格信息显示更紧凑 \*/ .unionContainer .markdown-body .help-code-block pre { font-size: 12px !important; } /\* 减少表格中的代码块字号，让表格信息显示更紧凑 \*/ .unionContainer .markdown-body .help-code-block pre code { font-size: 12px !important; } /\* 表格中的引用上下间距调小，避免内容显示过于稀疏 \*/ .unionContainer .markdown-body table blockquote { margin: 4px 0 0 0; }

/\* ========================================= \*/ /\* 新增样式：带边框的表格 (api-table-border) \*/ /\* ========================================= \*/ /\* 1. 表格容器核心设置 \*/ .aliyun-docs-content table.api-table-border { border: 1px solid #d8d8d8 !important; /\* 表格外边框 \*/ border-collapse: collapse !important; /\* 合并边框，防止双线 \*/ width: 100% !important; /\* 宽度占满 \*/ margin: 10px 0 !important; /\* 上下间距 \*/ background-color: #fff !important; /\* 背景色 \*/ box-sizing: border-box !important; } /\* 2. 表头、表体、行设置 \*/ /\* 确保行本身没有干扰边框 \*/ .aliyun-docs-content table.api-table-border thead, .aliyun-docs-content table.api-table-border tbody, .aliyun-docs-content table.api-table-border tr { border: none !important; background-color: transparent !important; } /\* 3. 单元格设置 (th 和 td) \*/ /\* 这是边框显示的关键位置 \*/ .aliyun-docs-content table.api-table-border th, .aliyun-docs-content table.api-table-border td { border: 1px solid #d8d8d8 !important; /\* 单元格四周边框 \*/ padding: 8px 12px !important; /\* 内边距 \*/ text-align: left !important; /\* 文字左对齐 \*/ vertical-align: middle !important; /\* 垂直居中 \*/ color: #6e6e80 !important; /\* 文字颜色 \*/ font-size: 14px !important; /\* 字体大小 \*/ line-height: 1.5 !important; } /\* 4. 表头特殊样式 \*/ .aliyun-docs-content table.api-table-border th { background-color: #f9fafb !important; /\* 表头背景色 \*/ color: #181818 !important; /\* 表头文字颜色 \*/ font-weight: 600 !important; /\* 表头加粗 \*/ } /\* 5. 鼠标悬停效果 (可选) \*/ .aliyun-docs-content table.api-table-border tbody tr:hover td { background-color: #fcfcfc !important; /\* 悬停时背景微变 \*/ } /\* 6. 兼容原有 api-reference 可能存在的冲突 \*/ /\* 如果原有样式针对 td:first-child 等特殊选择器有干扰，这里强制覆盖 \*/ .aliyun-docs-content table.api-table-border tr td:first-child { border-bottom: 1px solid #d8d8d8 !important; margin: 0 !important; } .aliyun-docs-content table.api-table-border tr:last-child td:first-child { border-bottom: 1px solid #d8d8d8 !important; /\* 保持底部边框 \*/ }


HappyHorse 视频编辑模型支持输入视频与参考图，结合文本指令完成风格变换、局部替换等编辑任务。

## 适用范围

为确保调用成功，请务必保证**模型、Endpoint URL 和 API Key 均属于同一地域**。跨地域调用将会失败。

-   [**选择模型**](https://modelstudio.console.alibabacloud.com/ap-southeast-1?tab=doc#/doc/?type=model&url=2840914)：确认模型所属的地域。
    
-   **选择 URL**：选择对应的地域 Endpoint URL，支持HTTP URL。
    
-   **配置 API Key**：选择地域并[获取API Key](/help/zh/model-studio/get-api-key)，再[配置API Key到环境变量](/help/zh/model-studio/configure-api-key-through-environment-variables)。
    

**说明**

本文的示例代码适用于**新加坡地域**。

**重要**

百炼为新加坡地域推出了业务空间专属域名 `https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com`，**能够为推理请求提供卓越的性能和更高的稳定性**，建议从 `https://dashscope-intl.aliyuncs.com` 迁移至新域名。

其中 `{WorkspaceId}` 为您的业务空间 ID，可在百炼控制台的**业务空间详情**页面查看。现有域名仍可正常使用。

## HTTP调用

由于视频编辑任务耗时较长（通常为1-5分钟），API采用异步调用。整个流程包含 **"创建任务 -> 轮询获取"** 两个核心步骤，具体如下：

### **步骤1：创建任务获取任务ID**

## **新加坡**

`POST https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis`

调用时请将`WorkspaceId`替换为真实的[Workspace ID](/help/zh/model-studio/obtain-the-app-id-and-workspace-id#d3eb3cd37b7fu)。

## **美国（弗吉尼亚）**

`POST https://dashscope-us.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis`

## **华北2（北京）**

`POST https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis`

## **德国（法兰克福）**

`POST https://{WorkspaceId}.eu-central-1.maas.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis`

调用时请将`WorkspaceId`替换为真实的[Workspace ID](/help/zh/model-studio/obtain-the-app-id-and-workspace-id#d3eb3cd37b7fu)。

**说明**

-   创建成功后，使用接口返回的 `task_id` 查询结果，task\_id 有效期为 24 小时。**请勿重复创建任务**，轮询获取即可。
    
-   新手指引请参见[Postman](/help/zh/model-studio/first-call-to-image-and-video-api)。
    

| #### 请求参数 | ## 视频编辑（指令+参考图） ``` curl --location 'https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis' \\ -H 'X-DashScope-Async: enable' \\ -H "Authorization: Bearer $DASHSCOPE_API_KEY" \\ -H 'Content-Type: application/json' \\ -d '{ "model": "happyhorse-1.0-video-edit", "input": { "prompt": "让视频中的马头人身角色穿上图片中的条纹毛衣", "media": [ { "type": "video", "url": "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20260409/dozxak/Wan_Video_Edit_33_1.mp4" }, { "type": "reference_image", "url": "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20260415/hynnff/wan-video-edit-clothes.webp" } ] }, "parameters": { "resolution": "720P" } }' ``` |
| --- | --- |
| ##### 请求头（Headers） |
| **Content-Type** `*string*` **（必选）** 请求内容类型。此参数必须设置为`application/json`。 |
| **Authorization** `*string*`**（必选）** 请求身份认证。接口使用阿里云百炼API Key进行身份认证。示例值：Bearer sk-xxxx。 |
| **X-DashScope-Async** `*string*` **（必选）** 异步处理配置参数。HTTP请求只支持异步，**必须设置为**`**enable**`。 **重要** 缺少此请求头将报错：“current user api does not support synchronous calls”。 |
| ##### 请求体（Request Body） |
| **model** `*string*` **（必选）** 模型名称。 固定值：happyhorse-1.0-video-edit。 |
| **input** `*object*` **（必选）** 输入的基本信息，包括待编辑的视频、参考图片和提示词。 **属性** **prompt** `*string*` **（必选）** 文本提示词。用来描述对视频的编辑意图，如风格转换、局部替换等。 支持任何语言输入，长度不超过5000个非中文字符或2500个中文字符，超过部分会自动截断。 **media** `*array*` **（必选）** 媒体素材列表，用于指定待编辑的视频和参考图像。 数组必须包含**1个** `video` 类型元素；可选包含0~5个 `reference_image` 类型元素。 **元素属性** **type** `*string*` **（必选）** 媒体素材类型。可选值为： - `video`：必传。待编辑的视频。 - `reference_image`：可选。参考图像。 素材限制： - 视频数量：有且仅有1个。 - 参考图像数量：0～5张。 **url** `*string*` **（必选）** 媒体素材的URL地址。 传入视频（type=video） 待编辑的视频URL，必须为公网可访问的URL。 - 支持 HTTP 和 HTTPS 协议。 - 示例值：https://xxx/xxx.mp4。 视频限制： - 格式：MP4、MOV（建议H.264编码）。 - 时长：3~60秒。 - 分辨率：长边不超过4096像素，短边不小于360像素。 - 宽高比：1:2.5~2.5:1。 - 文件大小：不超过100MB。 - 帧率：大于8fps。 **说明** **输出视频时长：3~15秒**。 - 当输入视频不超过 15 秒时，输出视频时长与输入视频保持一致。 - 当输入视频超过 15 秒时，系统会从头开始自动截取前 15 秒作为有效片段，因此最长输出为 15 秒。 传入图像（type=reference\\_image） 参考图像的URL或 Base64 编码数据。 图像限制： - 格式：JPEG、JPG、PNG、WEBP。 - 分辨率：宽高尺寸不小于300像素。 - 宽高比：1:2.5~2.5:1。 - 文件大小：不超过20MB。 支持输入的格式： 1. 公网URL： - 支持 HTTP 或 HTTPS 协议。 - 示例值：https://xxx/xxx.png。 2. Base64 编码图像后的字符串： - 数据格式：`data:{MIME_type};base64,{base64_data}`。 - 示例值：data:image/png;base64,GDU7MtCZzEbTbmRZ......（示例已截断，仅做演示）。 **Base64编码数据格式** 格式： `data:{MIME_type};base64,{base64_data}` 。 - {base64\\_data}：图像文件经过 Base64 编码后的字符串。 - {MIME\\_type}：图像的媒体类型，需与文件格式对应。 \\| 图像格式 \\| MIME Type \\| \\| --- \\| --- \\| \\| JPEG \\| image/jpeg \\| \\| JPG \\| image/jpeg \\| \\| PNG \\| image/png \\| \\| WEBP \\| image/webp \\| |
| **parameters** `*object*` （可选） 视频编辑参数。如设置视频分辨率等。 **属性** **resolution** `*string*` （可选） 生成视频的分辨率档位。 可选值： - `1080P`：默认值。 - `720P` **watermark** `*boolean*` （可选） 是否在生成的视频上添加水印标识。水印位于视频右下角，文案固定为“Happy Horse”。 - `true`：默认值，添加水印。 - `false`：不添加水印。 **audio\\_setting** `*string*` （可选） 声音控制。 - `auto`：默认值，由模型自行控制。 - `origin`：保留输入视频的原始声音。 **seed** `*integer*` （可选） 随机数种子，取值范围为`[0, 2147483647]`。 未指定时，系统自动生成随机种子。若需提升生成结果的可复现性，建议固定seed值。 请注意，由于模型生成具有概率性，即使使用相同 seed，也不能保证每次生成结果完全一致。 |

| #### 响应参数 | ### 成功响应 请保存 task\\_id，用于查询任务状态与结果。 ``` { "output": { "task_status": "PENDING", "task_id": "0385dc79-5ff8-4d82-bcb6-xxxxxx" }, "request_id": "4909100c-7b5a-9f92-bfe5-xxxxxx" } ``` ### 异常响应 创建任务失败，请参见[错误码](/help/zh/model-studio/error-code)进行解决。 ``` { "code": "InvalidApiKey", "message": "No API-key provided.", "request_id": "7438d53d-6eb8-4596-8835-xxxxxx" } ``` |
| --- | --- |
| **output** `*object*` 任务输出信息。 **属性** **task\\_id** `*string*` 任务ID。查询有效期24小时。 **task\\_status** `*string*` 任务状态。 **枚举值** - PENDING：任务排队中 - RUNNING：任务处理中 - SUCCEEDED：任务执行成功 - FAILED：任务执行失败 - CANCELED：任务已取消 - UNKNOWN：任务不存在或状态未知 |
| **request\\_id** `*string*` 请求唯一标识。可用于请求明细溯源和问题排查。 |
| **code** `*string*` 请求失败的错误码。请求成功时不会返回此参数，详情请参见[错误码](/help/zh/model-studio/error-code)。 |     |
| **message** `*string*` 请求失败的详细信息。请求成功时不会返回此参数，详情请参见[错误码](/help/zh/model-studio/error-code)。 |     |

### **步骤2：根据任务ID查询结果**

## **新加坡**

`GET https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/api/v1/tasks/{task_id}`

调用时请将`WorkspaceId`替换为真实的[Workspace ID](/help/zh/model-studio/obtain-the-app-id-and-workspace-id#d3eb3cd37b7fu)。

## **美国（弗吉尼亚）**

`GET https://dashscope-us.aliyuncs.com/api/v1/tasks/{task_id}`

## **华北2（北京）**

`GET https://dashscope.aliyuncs.com/api/v1/tasks/{task_id}`

## **德国（法兰克福）**

`GET https://{WorkspaceId}.eu-central-1.maas.aliyuncs.com/api/v1/tasks/{task_id}`

调用时请将`WorkspaceId`替换为真实的[Workspace ID](/help/zh/model-studio/obtain-the-app-id-and-workspace-id#d3eb3cd37b7fu)。

**说明**

-   **轮询建议**：视频编辑过程约需数分钟，建议采用**轮询**机制，并设置合理的查询间隔（如 15 秒）来获取结果。
    
-   **任务状态流转**：PENDING（排队中）→ RUNNING（处理中）→ SUCCEEDED（成功）/ FAILED（失败）。
    
-   **task\_id 有效期**：**24小时**，超时后将无法查询结果，接口将返回任务状态为`UNKNOWN`。
    

| #### 请求参数 | ## 查询任务结果 将`{task_id}`完整替换为上一步接口返回的`task_id`的值。`task_id`查询有效期为24小时。 ``` curl -X GET https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/api/v1/tasks/{task_id} \\ --header "Authorization: Bearer $DASHSCOPE_API_KEY" ``` |
| --- | --- |
| ##### **请求头（Headers）** |
| **Authorization** `*string*`**（必选）** 请求身份认证。接口使用阿里云百炼API Key进行身份认证。示例值：Bearer sk-xxxx。 |
| ##### **URL路径参数（Path parameters）** |
| **task\\_id** `*string*`**（必选）** 任务ID。 |

| #### **响应参数** | #### **任务执行成功** 视频URL仅保留24小时，超时后会被自动清除，请及时保存生成的视频。 ``` { "request_id": "c11018a8-3f83-9591-a636-xxxxxx", "output": { "task_id": "051c7b40-b2c5-4341-aee4-xxxxxx", "task_status": "SUCCEEDED", "submit_time": "2026-04-26 14:13:14.373", "scheduled_time": "2026-04-26 14:13:14.419", "end_time": "2026-04-26 14:14:13.679", "orig_prompt": "让视频中的马头人身角色穿上图片中的条纹毛衣", "video_url": "https://dashscope-result.oss-cn-beijing.aliyuncs.com/xxxx.mp4" }, "usage": { "duration": 13.24, "input_video_duration": 6.62, "output_video_duration": 6.62, "video_count": 1, "SR": 720 } } ``` ## 任务执行失败 若任务执行失败，task\\_status将置为 FAILED，并提供错误码和信息。请参见[错误码](/help/zh/model-studio/error-code)进行解决。 ``` { "request_id": "e5d70b02-ebd3-98ce-9fe8-759d7d7b107d", "output": { "task_id": "86ecf553-d340-4e21-af6e-a0c6a421c010", "task_status": "FAILED", "code": "InvalidParameter", "message": "The resolution is not valid xxxxxx" } } ``` ## 任务查询过期 task\\_id查询有效期为 24 小时，超时后将无法查询，返回以下报错信息。 ``` { "request_id": "a4de7c32-7057-9f82-8581-xxxxxx", "output": { "task_id": "502a00b1-19d9-4839-a82f-xxxxxx", "task_status": "UNKNOWN" } } ``` |
| --- | --- |
| **output** `*object*` 任务输出信息。 **属性** **task\\_id** `*string*` 任务ID。查询有效期24小时。 **task\\_status** `*string*` 任务状态。 **枚举值** - PENDING：任务排队中 - RUNNING：任务处理中 - SUCCEEDED：任务执行成功 - FAILED：任务执行失败 - CANCELED：任务已取消 - UNKNOWN：任务不存在或状态未知 **轮询过程中的状态流转：** - PENDING（排队中） → RUNNING（处理中）→ SUCCEEDED（成功）/ FAILED（失败）。 - 初次查询状态通常为 PENDING（排队中）或 RUNNING（处理中）。 - 当状态变为 SUCCEEDED 时，响应中将包含生成的视频URL。 - 若状态为 FAILED，请检查错误信息并重试。 - 若状态为 CANCELED，表示任务已取消，如需继续请重新提交任务。 - 若状态为 UNKNOWN，表示任务不存在或状态未知，可能在 task\\_id 不存在或超过 24 小时有效期后出现。 **submit\\_time** `*string*` 任务提交时间。时区为UTC+8，格式为 YYYY-MM-DD HH:mm:ss.SSS。 **scheduled\\_time** `*string*` 任务执行时间。时区为UTC+8，格式为 YYYY-MM-DD HH:mm:ss.SSS。 **end\\_time** `*string*` 任务完成时间。时区为UTC+8，格式为 YYYY-MM-DD HH:mm:ss.SSS。 **video\\_url** `*string*` 视频URL。仅在 task\\_status 为 SUCCEEDED 时返回。 链接有效期24小时，可通过此URL下载视频。视频格式为MP4（H.264 编码）。 **orig\\_prompt** `*string*` 原始输入的prompt，对应请求参数`prompt`。 **code** `*string*` 请求失败的错误码。请求成功时不会返回此参数，详情请参见[错误码](/help/zh/model-studio/error-code)。 **message** `*string*` 请求失败的详细信息。请求成功时不会返回此参数，详情请参见[错误码](/help/zh/model-studio/error-code)。 |
| **usage** `*object*` 输出信息统计。只对成功的结果计数。 **属性** **duration** `*float*` 生成视频的总视频时长，用于计费。 **SR** `*integer*` 生成视频的分辨率档位。 **output\\_video\\_duration** `*float*` 输出视频的时长，单位秒。 **input\\_video\\_duration** `*float*` 输入视频的时长，单位秒。 **video\\_count** `*integer*` 生成视频的数量。固定为1。 |     |
| **request\\_id** `*string*` 请求唯一标识。可用于请求明细溯源和问题排查。 |     |

## **错误码**

如果模型调用失败并返回报错信息，请参见[错误码](/help/zh/model-studio/error-code)进行解决。

.table-wrapper { overflow: visible !important; } /\* 调整 table 宽度 \*/ .aliyun-docs-content table.medium-width { max-width: 1018px; width: 100%; } .aliyun-docs-content table.table-no-border tr td:first-child { padding-left: 0; } .aliyun-docs-content table.table-no-border tr td:last-child { padding-right: 0; } /\* 支持吸顶 \*/ div:has(.aliyun-docs-content), .aliyun-docs-content .markdown-body { overflow: visible; } .stick-top { position: sticky; top: 46px; } /\*\*代码块字体\*\*/ /\* 减少表格中的代码块 margin，让表格信息显示更紧凑 \*/ .unionContainer .markdown-body table .help-code-block { margin: 0 !important; } /\* 减少表格中的代码块字号，让表格信息显示更紧凑 \*/ .unionContainer .markdown-body .help-code-block pre { font-size: 12px !important; } /\* 减少表格中的代码块字号，让表格信息显示更紧凑 \*/ .unionContainer .markdown-body .help-code-block pre code { font-size: 12px !important; } /\*\* API Reference 表格 \*\*/ .aliyun-docs-content table.api-reference tr td:first-child { margin: 0px; border-bottom: 1px solid #d8d8d8; } .aliyun-docs-content table.api-reference tr:last-child td:first-child { border-bottom: none; } .aliyun-docs-content table.api-reference p { color: #6e6e80; } .aliyun-docs-content table.api-reference b, i { color: #181818; } .aliyun-docs-content table.api-reference .collapse { border: none; margin-top: 4px; margin-bottom: 4px; } .aliyun-docs-content table.api-reference .collapse .expandable-title-bold { padding: 0; } .aliyun-docs-content table.api-reference .collapse .expandable-title { padding: 0; } .aliyun-docs-content table.api-reference .collapse .expandable-title-bold .title { margin-left: 16px; } .aliyun-docs-content table.api-reference .collapse .expandable-title .title { margin-left: 16px; } .aliyun-docs-content table.api-reference .collapse .expandable-title-bold i.icon { position: absolute; color: #777; font-weight: 100; } .aliyun-docs-content table.api-reference .collapse .expandable-title i.icon { position: absolute; color: #777; font-weight: 100; } .aliyun-docs-content table.api-reference .collapse.expanded .expandable-content { padding: 10px 14px 10px 14px !important; margin: 0; border: 1px solid #e9e9e9; } .aliyun-docs-content table.api-reference .collapse .expandable-title-bold b { font-size: 13px; font-weight: normal; color: #6e6e80; } .aliyun-docs-content table.api-reference .collapse .expandable-title b { font-size: 13px; font-weight: normal; color: #6e6e80; } .aliyun-docs-content table.api-reference .tabbed-content-box { border: none; } .aliyun-docs-content table.api-reference .tabbed-content-box section { padding: 8px 0 !important; } .aliyun-docs-content table.api-reference .tabbed-content-box.mini .tab-box { /\* position: absolute; left: 40px; right: 0; \*/ } .aliyun-docs-content .margin-top-33 { margin-top: 33px !important; } .aliyun-docs-content .two-codeblocks pre { max-height: calc(50vh - 136px) !important; height: auto; } .expandable-content section { border-bottom: 1px solid #e9e9e9; padding-top: 6px; padding-bottom: 4px; } .expandable-content section:last-child { border-bottom: none; } .expandable-content section:first-child { padding-top: 0; }

/\* 让表格显示成类似钉钉文档的分栏卡片 \*/ table.help-table-card td { border: 10px solid #FFF !important; background: #F4F6F9; padding: 16px !important; vertical-align: top; } /\* 减少表格中的代码块 margin，让表格信息显示更紧凑 \*/ .unionContainer .markdown-body table .help-code-block { margin: 0 !important; } /\* 减少表格中的代码块字号，让表格信息显示更紧凑 \*/ .unionContainer .markdown-body .help-code-block pre { font-size: 12px !important; } /\* 减少表格中的代码块字号，让表格信息显示更紧凑 \*/ .unionContainer .markdown-body .help-code-block pre code { font-size: 12px !important; } /\* 表格中的引用上下间距调小，避免内容显示过于稀疏 \*/ .unionContainer .markdown-body table blockquote { margin: 4px 0 0 0; }

/\* ========================================= \*/ /\* 新增样式：带边框的表格 (api-table-border) \*/ /\* ========================================= \*/ /\* 1. 表格容器核心设置 \*/ .aliyun-docs-content table.api-table-border { border: 1px solid #d8d8d8 !important; /\* 表格外边框 \*/ border-collapse: collapse !important; /\* 合并边框，防止双线 \*/ width: 100% !important; /\* 宽度占满 \*/ margin: 10px 0 !important; /\* 上下间距 \*/ background-color: #fff !important; /\* 背景色 \*/ box-sizing: border-box !important; } /\* 2. 表头、表体、行设置 \*/ /\* 确保行本身没有干扰边框 \*/ .aliyun-docs-content table.api-table-border thead, .aliyun-docs-content table.api-table-border tbody, .aliyun-docs-content table.api-table-border tr { border: none !important; background-color: transparent !important; } /\* 3. 单元格设置 (th 和 td) \*/ /\* 这是边框显示的关键位置 \*/ .aliyun-docs-content table.api-table-border th, .aliyun-docs-content table.api-table-border td { border: 1px solid #d8d8d8 !important; /\* 单元格四周边框 \*/ padding: 8px 12px !important; /\* 内边距 \*/ text-align: left !important; /\* 文字左对齐 \*/ vertical-align: middle !important; /\* 垂直居中 \*/ color: #6e6e80 !important; /\* 文字颜色 \*/ font-size: 14px !important; /\* 字体大小 \*/ line-height: 1.5 !important; } /\* 4. 表头特殊样式 \*/ .aliyun-docs-content table.api-table-border th { background-color: #f9fafb !important; /\* 表头背景色 \*/ color: #181818 !important; /\* 表头文字颜色 \*/ font-weight: 600 !important; /\* 表头加粗 \*/ } /\* 5. 鼠标悬停效果 (可选) \*/ .aliyun-docs-content table.api-table-border tbody tr:hover td { background-color: #fcfcfc !important; /\* 悬停时背景微变 \*/ } /\* 6. 兼容原有 api-reference 可能存在的冲突 \*/ /\* 如果原有样式针对 td:first-child 等特殊选择器有干扰，这里强制覆盖 \*/ .aliyun-docs-content table.api-table-border tr td:first-child { border-bottom: 1px solid #d8d8d8 !important; margin: 0 !important; } .aliyun-docs-content table.api-table-border tr:last-child td:first-child { border-bottom: 1px solid #d8d8d8 !important; /\* 保持底部边框 \*/ }