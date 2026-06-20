# Bugfix Requirements Document

## Introduction

通过"链接导入视频"功能导入视频时，如果用户未填写项目名称，系统会使用占位符 `导入视频 - {platform}`（例如 `导入视频 - douyin`）作为项目名称。该名称对用户不友好，无法体现视频的真实内容。

实际上，下载 Worker 通过 yt-dlp 在下载过程中已经获取到了视频的真实标题（`title` 字段），但下载完成后仅回写了 `videoUrl` 与 `status`，并未把真实标题回写到 `project.name`，导致项目名称始终停留在占位符上。

本次修复的目标：当用户未填写项目名称时，在下载完成后用 yt-dlp 获取到的真实视频标题作为项目名称；当用户已显式填写项目名称时，保留用户输入不变。同时需要妥善处理标题为空、标题过长等边界情况。

## Bug Analysis

### Current Behavior (Defect)

当前用户通过链接导入视频且未填写项目名称时的缺陷行为：

1.1 WHEN 用户通过链接导入视频且未填写项目名称 THEN 系统创建项目时使用占位符 `导入视频 - {platform}` 作为项目名称
1.2 WHEN yt-dlp 下载完成并成功获取到视频真实标题 THEN 系统不会把该真实标题回写到 `project.name`，项目名称仍保持为占位符 `导入视频 - {platform}`

### Expected Behavior (Correct)

修复后用户通过链接导入视频且未填写项目名称时的正确行为：

2.1 WHEN 用户通过链接导入视频且未填写项目名称、且下载完成后 yt-dlp 返回了非空的有效视频标题 THEN 系统 SHALL 将该真实视频标题回写为项目名称
2.2 WHEN 用户通过链接导入视频且未填写项目名称、且 yt-dlp 返回的标题为空或无效（如空字符串、纯空白） THEN 系统 SHALL 保留一个合理的兜底项目名称而非空名称
2.3 WHEN 用户通过链接导入视频且未填写项目名称、且 yt-dlp 返回的标题超过项目名称长度上限（100 字符） THEN 系统 SHALL 将标题截断到长度上限内后再回写为项目名称

### Unchanged Behavior (Regression Prevention)

以下既有行为必须保持不变：

3.1 WHEN 用户通过链接导入视频且已显式填写了项目名称 THEN 系统 SHALL CONTINUE TO 使用用户填写的名称，且下载完成后不被真实标题覆盖
3.2 WHEN 视频下载流程执行（解析、下载、上传 OSS、回写 `videoUrl`/`status`、触发解析、余额校验） THEN 系统 SHALL CONTINUE TO 按现有逻辑执行，不受项目名称回写逻辑影响
3.3 WHEN 视频下载失败 THEN 系统 SHALL CONTINUE TO 将下载任务与项目标记为 FAILED 并记录错误信息，不回写项目名称

## Bug Condition Derivation

### Bug Condition

识别触发该缺陷的输入：用户未填写项目名称的链接导入。

```pascal
FUNCTION isBugCondition(X)
  INPUT: X of type ImportInput   // { projectName?, sourceUrl, platform, ytdlpTitle }
  OUTPUT: boolean

  // 用户未提供项目名称（空、undefined 或纯空白）即触发缺陷
  RETURN isBlank(X.projectName)
END FUNCTION
```

### Property Specification (Fix Checking)

对于所有满足 bug 条件的输入，下载完成后项目名称应反映真实视频标题（并处理空/过长边界）。

```pascal
// Property: Fix Checking - 未填写项目名时回写真实视频标题
FOR ALL X WHERE isBugCondition(X) DO
  result ← importAndDownload'(X)   // F' 为修复后的完整导入+下载流程
  finalName ← result.project.name

  IF isBlank(X.ytdlpTitle) THEN
    ASSERT isBlank(finalName) = false        // 有合理兜底，不为空
  ELSE
    ASSERT finalName = truncate(trim(X.ytdlpTitle), 100)
  END IF
END FOR
```

### Preservation Goal (Preservation Checking)

对于所有不满足 bug 条件的输入（用户已填写名称），修复后行为与修复前完全一致。

```pascal
// Property: Preservation Checking - 已填写名称时行为不变
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT F(X) = F'(X)              // 项目名称始终等于用户输入，下载流程其余行为不变
END FOR
```

**关键定义：**
- **F**：修复前的链接导入 + 下载流程（项目名永远停留在占位符 / 用户输入）
- **F'**：修复后的链接导入 + 下载流程（未填写名称时回写真实标题）
- **isBlank(s)**：`s` 为 undefined、空字符串或仅含空白字符时为 true
- **truncate(s, n)**：将字符串 `s` 截断到最多 `n` 个字符
