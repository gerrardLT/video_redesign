/**
 * 阿里云 OSS 对象存储封装
 * 提供文件上传、对象访问 URL 获取、文件删除功能。
 *
 * 访问策略（缺陷 10 修复）：
 * - 私有产物（原视频、封面、按组音频、生成结果、人物头像、合并导出等）不再依赖
 *   「Bucket 公共读 + 直链」对外暴露，也不在 public/uploads/ 留下无鉴权的本地公开副本；
 *   前端访问统一走鉴权代理路由 `/api/media/{key}`（见 getMediaProxyUrl / toMediaProxyUrl），
 *   由该路由校验登录 + 资源归属后，服务端签发短时效签名 URL 或流式回源 OSS。
 * - getPublicUrl 仅用于「真正公开、且需被外部服务（如 Seedance）直接抓取」的对象 URL 拼接，
 *   不应再直接交给前端展示私有产物。
 *
 * 注意：要让 OSS 直链真正不可被任意 URL 猜测访问，还需在 OSS 控制台把 Bucket ACL 设为私有读
 * （private），这是代码之外的基础设施动作，必须作为配套的运维跟进项落实。
 */
import OSS from 'ali-oss'
import { Readable } from 'stream'
import type { ReadableStream as WebReadableStream } from 'stream/web'
import { createWriteStream } from 'fs'
import { finished } from 'stream/promises'

// ========================
// OSS 客户端初始化
// ========================

const OSS_REGION = process.env.OSS_REGION || 'oss-cn-shanghai'
const OSS_BUCKET = process.env.OSS_BUCKET || ''
const OSS_ACCESS_KEY_ID = process.env.OSS_ACCESS_KEY_ID || ''
const OSS_ACCESS_KEY_SECRET = process.env.OSS_ACCESS_KEY_SECRET || ''
const OSS_ENDPOINT = process.env.OSS_ENDPOINT || `https://${OSS_REGION}.aliyuncs.com`
// OSS 传输加速 endpoint（如 oss-accelerate.aliyuncs.com）。
// 仅用于「送外部境内服务（火山方舟）拉取」场景，解决跨境（境外 OSS ← 境内方舟）下载超时。
// 留空则不启用加速，相关函数回退为普通直链。其它 OSS 操作（上传/下载/签名/前端代理）一律不走加速，避免额外加速流量计费。
const OSS_ACCELERATE_ENDPOINT = process.env.OSS_ACCELERATE_ENDPOINT || ''

/**
 * 检查 OSS 是否已配置
 * 导出供 worker/路由判断：OSS 已配置时本地仅作 FFmpeg 临时工作文件，
 * 上传成功后删除本地公开副本（缺陷 10）；未配置（开发模式）时本地文件为唯一副本，
 * 须经鉴权代理路由访问，不能删除。
 */
export function isOSSConfigured(): boolean {
  return !!(OSS_BUCKET && OSS_ACCESS_KEY_ID && OSS_ACCESS_KEY_SECRET)
}

/**
 * 获取 OSS 客户端实例（懒加载单例）
 */
let _ossClient: OSS | null = null
function getOSSClient(): OSS {
  if (!_ossClient) {
    if (!isOSSConfigured()) {
      throw new Error('OSS 未配置，请设置 OSS_BUCKET、OSS_ACCESS_KEY_ID、OSS_ACCESS_KEY_SECRET 环境变量')
    }
    _ossClient = new OSS({
      region: OSS_REGION,
      bucket: OSS_BUCKET,
      accessKeyId: OSS_ACCESS_KEY_ID,
      accessKeySecret: OSS_ACCESS_KEY_SECRET,
      endpoint: OSS_ENDPOINT,
      secure: true,
      timeout: 300000, // 上传超时 300 秒（跨云传输大文件需要更长时间）
    })
  }
  return _ossClient
}

// ========================
// 公共 API
// ========================

/**
 * 带重试的 OSS put：对 TLS/网络抖动（如代理环境下大文件握手中断）重试若干次。
 * 重试的是同一次真实上传操作，非伪造结果。
 */
async function putWithRetry(
  key: string,
  body: string | Buffer,
  maxAttempts = 4
): Promise<void> {
  const client = getOSSClient()
  let lastErr: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await client.put(key, body)
      return
    } catch (err) {
      lastErr = err
      const reason = err instanceof Error ? err.message : String(err)
      console.warn(`[storage] OSS 上传第 ${attempt}/${maxAttempts} 次失败（重试）: ${key} - ${reason}`)
      // 指数退避：500ms、1s、2s...
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 500 * 2 ** (attempt - 1)))
      }
    }
  }
  throw lastErr
}

/**
 * 上传本地文件到 OSS
 * @param key - OSS 对象键名（如 "videos/originals/{projectId}/xxx.mp4"）
 * @param filePath - 本地文件路径
 * @returns 公网可访问的 URL
 */
export async function uploadFile(key: string, filePath: string): Promise<string> {
  if (!isOSSConfigured()) {
    // 未配置 OSS 时返回本地路径（开发模式兼容）
    return `/uploads/${key}`
  }

  await putWithRetry(key, filePath)
  return getPublicUrl(key)
}

/**
 * 上传 Buffer 到 OSS
 * @param key - OSS 对象键名
 * @param buffer - 文件内容 Buffer
 * @returns 公网可访问的 URL
 */
export async function uploadBuffer(key: string, buffer: Buffer): Promise<string> {
  if (!isOSSConfigured()) {
    return `/uploads/${key}`
  }

  await putWithRetry(key, buffer)
  return getPublicUrl(key)
}

/**
 * 生成上传 URL（兼容旧接口）
 * 返回预签名上传 URL 供客户端直传
 */
export function generateUploadUrl(projectId: string, fileName: string): { url: string; key: string } {
  const key = `videos/originals/${projectId}/${Date.now()}_${fileName}`

  if (!isOSSConfigured()) {
    // 未配置 OSS：返回本地上传 API 路径
    return { url: `/api/upload/${key}`, key }
  }

  // 已配置 OSS：返回本地中转上传路径（后续可改为预签名直传）
  return { url: `/api/upload`, key }
}

/**
 * 获取对象的 OSS 直链 URL（仅限真正公开 / 需被外部服务直接抓取的对象）
 *
 * 用途：作为外部服务（如 Seedance 生成接口）可直接抓取的参考资源 URL 拼接。
 * 注意：私有产物不要用本函数直接交给前端展示，应改用 getMediaProxyUrl/toMediaProxyUrl
 * 走鉴权代理路由（缺陷 10）。当 Bucket ACL 设为私有读后，外部抓取场景应改用
 * getSignedObjectUrl 生成短时效签名 URL。
 */
export function getPublicUrl(key: string): string {
  if (!isOSSConfigured()) {
    return `/uploads/${key}`
  }
  // 格式：https://{bucket}.{region}.aliyuncs.com/{key}
  return `https://${OSS_BUCKET}.${OSS_REGION}.aliyuncs.com/${key}`
}

/**
 * 删除 OSS 对象
 */
export async function deleteObject(key: string): Promise<void> {
  if (!isOSSConfigured()) {
    // 未配置 OSS 时为空操作
    return
  }

  const client = getOSSClient()
  await client.delete(key)
}

/**
 * 从公网 URL 中提取 OSS key
 * 例如: https://bucket.region.aliyuncs.com/videos/xxx.mp4 → videos/xxx.mp4
 */
export function extractKeyFromUrl(url: string): string | null {
  if (!isOSSConfigured()) return null

  const prefix = `https://${OSS_BUCKET}.${OSS_REGION}.aliyuncs.com/`
  if (url.startsWith(prefix)) {
    return url.slice(prefix.length)
  }
  return null
}

/**
 * 将普通 OSS 直链转换为「传输加速」直链，仅用于送外部境内服务（火山方舟）拉取。
 *
 * 背景：OSS bucket 在境外（如新加坡），方舟服务器在境内（北京），方舟直接拉境外直链会跨境超时。
 * 转换后走 OSS 传输加速域名（{bucket}.{accelerate-endpoint}/{key}），经阿里云骨干网加速，避免超时。
 *
 * - 未配置 OSS_ACCELERATE_ENDPOINT、或 URL 不是本系统 OSS 直链时，原样返回（安全回退，不影响功能）
 * - 仅此函数产生加速流量；其它存储/访问路径一律不调用本函数，避免额外计费
 */
export function toAcceleratedUrl(url: string): string {
  if (!OSS_ACCELERATE_ENDPOINT) return url
  const key = extractKeyFromUrl(url)
  if (!key) return url
  return `https://${OSS_BUCKET}.${OSS_ACCELERATE_ENDPOINT}/${key}`
}

// ========================
// 私有媒体鉴权访问（缺陷 10）
// ========================

/**
 * 构造私有媒体的鉴权代理访问路径：`/api/media/{key}`
 *
 * 前端拿到该路径后，浏览器请求会带上登录 Cookie，经中间件鉴权 + 代理路由校验资源归属，
 * 再由服务端签发短时效签名 URL / 流式回源 OSS。不再向前端下发可被任意访问的 OSS 直链。
 */
export function getMediaProxyUrl(key: string): string {
  // 对每个路径段做 encodeURIComponent，避免特殊字符破坏路由匹配；保留 `/` 作为分隔符
  const safeKey = key
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/')
  return `/api/media/${safeKey}`
}

/**
 * 将已存储的对象 URL/路径归一化为鉴权代理路径 `/api/media/{key}`，供前端展示私有产物。
 *
 * 支持的输入形态：
 * - OSS 直链（https://{bucket}.{region}.aliyuncs.com/{key}）→ 提取 key 后转代理路径
 * - 开发模式本地相对路径（/uploads/{key}）→ 去前缀后转代理路径
 * - 已是代理路径（/api/media/...）→ 原样返回（幂等）
 * - asset:// 锚定图引用、其它外部 URL、空值 → 原样返回（由各自解析逻辑处理，不在本函数职责内）
 */
export function toMediaProxyUrl(storedUrl: string | null | undefined): string | null | undefined {
  if (!storedUrl) return storedUrl
  if (storedUrl.startsWith('/api/media/')) return storedUrl
  if (storedUrl.startsWith('/uploads/')) {
    return getMediaProxyUrl(storedUrl.slice('/uploads/'.length))
  }
  const key = extractKeyFromUrl(storedUrl)
  if (key) {
    return getMediaProxyUrl(key)
  }
  // asset:// 引用或非本系统 OSS 的外部 URL：保持原样
  return storedUrl
}

/**
 * 为对象生成短时效预签名 GET URL（即使 Bucket 为私有读也可访问）。
 *
 * 用途：
 * - 鉴权代理路由在校验归属通过后，以 302 重定向方式把请求交给该签名 URL（大文件/视频回源由 OSS 处理 Range）；
 * - 外部服务（如 Seedance）需直接抓取私有对象时的受控访问入口。
 *
 * @param key OSS 对象键
 * @param expiresSeconds 有效期（秒），默认 300s
 * @throws 未配置 OSS 时抛错（无 fallback：不静默返回无效/公开 URL）
 */
export function getSignedObjectUrl(key: string, expiresSeconds = 300): string {
  if (!isOSSConfigured()) {
    throw new Error('OSS 未配置，无法生成签名 URL')
  }
  return getOSSClient().signatureUrl(key, { expires: expiresSeconds, method: 'GET' })
}

/**
 * 服务端流式回源：获取 OSS 对象的可读流与元信息（Content-Type/Content-Length）。
 *
 * 供鉴权代理路由在校验归属通过后直接把对象内容流式转发给客户端（不下发任何可外泄的直链）。
 * @throws 未配置 OSS 时抛错；对象不存在时由底层 OSS 客户端抛错
 */
export async function getObjectStream(
  key: string
): Promise<{ stream: Readable; contentType: string | undefined; contentLength: number | undefined }> {
  if (!isOSSConfigured()) {
    throw new Error('OSS 未配置，无法流式回源对象')
  }
  const result = await getOSSClient().getStream(key)
  const headers = (result.res?.headers ?? {}) as Record<string, string>
  const contentLengthRaw = headers['content-length']
  return {
    stream: result.stream as Readable,
    contentType: headers['content-type'],
    contentLength: contentLengthRaw ? Number(contentLengthRaw) : undefined,
  }
}


/**
 * 从 URL 下载文件到本地临时路径
 * 支持 OSS 直链和任意公网 URL
 *
 * @param url 远程文件 URL
 * @param destPath 本地目标路径
 * @throws 下载失败或 HTTP 非 2xx 时抛错
 */
export async function downloadToTemp(url: string, destPath: string): Promise<void> {
  const { promises: fsPromises } = await import('fs')
  const { dirname } = await import('path')

  // 确保目标目录存在
  await fsPromises.mkdir(dirname(destPath), { recursive: true })

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`下载失败 (${response.status}): ${url}`)
  }

  if (!response.body) {
    throw new Error(`下载响应体为空: ${url}`)
  }

  // 流式写入磁盘，避免将整个文件加载到内存（大文件 OOM 风险）
  const writeStream = createWriteStream(destPath)
  const nodeStream = Readable.fromWeb(response.body as WebReadableStream)
  nodeStream.pipe(writeStream)
  await finished(writeStream)
}
