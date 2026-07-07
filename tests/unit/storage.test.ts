/**
 * storage.ts 接口契约测试
 *
 * 纯 mock 测试，不真实调用 OSS。验证各导出函数的调用契约：
 * - uploadFile：传参格式（key + filePath）正确调用 OSS put
 * - deleteObject：正确调用 OSS delete
 * - getSignedObjectUrl：返回的 URL 包含 Expires / OSSAccessKeyId / Signature 参数
 * - getPublicUrl：正确拼接 CDN 域名 + key
 * - toAcceleratedUrl：将 OSS 普通域名 URL 转为加速域名
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ========================
// 环境变量 mock（模拟已配置 OSS 的状态）
// ========================
const TEST_BUCKET = 'test-bucket'
const TEST_REGION = 'oss-cn-shanghai'
const TEST_ACCESS_KEY_ID = 'test-ak-id'
const TEST_ACCESS_KEY_SECRET = 'test-ak-secret'
const TEST_ENDPOINT = `https://${TEST_REGION}.aliyuncs.com`
const TEST_ACCELERATE_ENDPOINT = 'oss-accelerate.aliyuncs.com'

// 在 import 模块之前设置环境变量，确保模块初始化时能读到
vi.stubEnv('OSS_BUCKET', TEST_BUCKET)
vi.stubEnv('OSS_REGION', TEST_REGION)
vi.stubEnv('OSS_ACCESS_KEY_ID', TEST_ACCESS_KEY_ID)
vi.stubEnv('OSS_ACCESS_KEY_SECRET', TEST_ACCESS_KEY_SECRET)
vi.stubEnv('OSS_ENDPOINT', TEST_ENDPOINT)
vi.stubEnv('OSS_ACCELERATE_ENDPOINT', TEST_ACCELERATE_ENDPOINT)

// ========================
// mock ali-oss 客户端
// ========================
const mockPut = vi.fn().mockResolvedValue({ url: 'https://mock.oss/file' })
const mockDelete = vi.fn().mockResolvedValue({ res: { status: 204 } })
const mockSignatureUrl = vi.fn().mockReturnValue(
  `https://${TEST_BUCKET}.${TEST_REGION}.aliyuncs.com/some-key?Expires=1700000000&OSSAccessKeyId=${TEST_ACCESS_KEY_ID}&Signature=abc123`
)
const mockGetStream = vi.fn().mockResolvedValue({
  stream: {},
  res: { headers: { 'content-type': 'video/mp4', 'content-length': '1024' } },
})

vi.mock('ali-oss', () => {
  // ali-oss 导出为 default export 的 class，源码中以 `new OSS(...)` 调用
  // 需要使 mock 既能作为 constructor 也能返回带方法的实例
  function MockOSS() {
    return {
      put: mockPut,
      delete: mockDelete,
      signatureUrl: mockSignatureUrl,
      getStream: mockGetStream,
    }
  }
  return { default: MockOSS }
})

// 延迟 import 确保 mock 先于模块加载
let uploadFile: typeof import('@/lib/shared/storage').uploadFile
let uploadBuffer: typeof import('@/lib/shared/storage').uploadBuffer
let deleteObject: typeof import('@/lib/shared/storage').deleteObject
let getSignedObjectUrl: typeof import('@/lib/shared/storage').getSignedObjectUrl
let getPublicUrl: typeof import('@/lib/shared/storage').getPublicUrl
let toAcceleratedUrl: typeof import('@/lib/shared/storage').toAcceleratedUrl
let extractKeyFromUrl: typeof import('@/lib/shared/storage').extractKeyFromUrl
let getMediaProxyUrl: typeof import('@/lib/shared/storage').getMediaProxyUrl
let toMediaProxyUrl: typeof import('@/lib/shared/storage').toMediaProxyUrl
let isOSSConfigured: typeof import('@/lib/shared/storage').isOSSConfigured

beforeEach(async () => {
  vi.resetModules()
  // 重新 stubEnv 确保每个测试可用
  vi.stubEnv('OSS_BUCKET', TEST_BUCKET)
  vi.stubEnv('OSS_REGION', TEST_REGION)
  vi.stubEnv('OSS_ACCESS_KEY_ID', TEST_ACCESS_KEY_ID)
  vi.stubEnv('OSS_ACCESS_KEY_SECRET', TEST_ACCESS_KEY_SECRET)
  vi.stubEnv('OSS_ENDPOINT', TEST_ENDPOINT)
  vi.stubEnv('OSS_ACCELERATE_ENDPOINT', TEST_ACCELERATE_ENDPOINT)

  const mod = await import('@/lib/shared/storage')
  uploadFile = mod.uploadFile
  uploadBuffer = mod.uploadBuffer
  deleteObject = mod.deleteObject
  getSignedObjectUrl = mod.getSignedObjectUrl
  getPublicUrl = mod.getPublicUrl
  toAcceleratedUrl = mod.toAcceleratedUrl
  extractKeyFromUrl = mod.extractKeyFromUrl
  getMediaProxyUrl = mod.getMediaProxyUrl
  toMediaProxyUrl = mod.toMediaProxyUrl
  isOSSConfigured = mod.isOSSConfigured
})

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
})

// ========================
// 测试用例
// ========================

describe('storage.ts 接口契约测试', () => {
  describe('isOSSConfigured', () => {
    it('环境变量完备时返回 true', () => {
      expect(isOSSConfigured()).toBe(true)
    })
  })

  describe('uploadFile', () => {
    it('使用正确的 key 和 filePath 调用 OSS put', async () => {
      const key = 'videos/originals/proj-001/test.mp4'
      const filePath = '/tmp/test.mp4'

      const url = await uploadFile(key, filePath)

      // 验证 put 被调用，参数为 key + filePath
      expect(mockPut).toHaveBeenCalledWith(key, filePath)
      // 返回值应为拼接的公网 URL
      expect(url).toBe(`https://${TEST_BUCKET}.${TEST_REGION}.aliyuncs.com/${key}`)
    })

    it('key 中包含多层路径时正确传递', async () => {
      const key = 'assets/characters/user-123/avatar.png'
      const filePath = '/tmp/avatar.png'

      await uploadFile(key, filePath)

      expect(mockPut).toHaveBeenCalledWith(key, filePath)
    })
  })

  describe('uploadBuffer', () => {
    it('使用正确的 key 和 Buffer 调用 OSS put', async () => {
      const key = 'images/cover/proj-001/cover.jpg'
      const buffer = Buffer.from('fake-image-data')

      const url = await uploadBuffer(key, buffer)

      expect(mockPut).toHaveBeenCalledWith(key, buffer)
      expect(url).toBe(`https://${TEST_BUCKET}.${TEST_REGION}.aliyuncs.com/${key}`)
    })
  })

  describe('deleteObject', () => {
    it('使用正确的 key 调用 OSS delete', async () => {
      const key = 'videos/originals/proj-001/old.mp4'

      await deleteObject(key)

      expect(mockDelete).toHaveBeenCalledWith(key)
    })

    it('多次删除不同 key 互不干扰', async () => {
      const key1 = 'videos/a.mp4'
      const key2 = 'videos/b.mp4'

      await deleteObject(key1)
      await deleteObject(key2)

      expect(mockDelete).toHaveBeenCalledTimes(2)
      expect(mockDelete).toHaveBeenNthCalledWith(1, key1)
      expect(mockDelete).toHaveBeenNthCalledWith(2, key2)
    })
  })

  describe('getSignedObjectUrl', () => {
    it('返回的 URL 包含 Expires 和 Signature 参数', () => {
      const key = 'videos/generated/proj-001/out.mp4'

      const signedUrl = getSignedObjectUrl(key)

      expect(signedUrl).toContain('Expires=')
      expect(signedUrl).toContain('Signature=')
    })

    it('以正确参数调用 OSS signatureUrl（默认 300s 过期）', () => {
      const key = 'audio/proj-001/group_0.mp3'

      getSignedObjectUrl(key)

      expect(mockSignatureUrl).toHaveBeenCalledWith(key, { expires: 300, method: 'GET' })
    })

    it('自定义过期时间正确传递', () => {
      const key = 'audio/proj-001/group_0.mp3'

      getSignedObjectUrl(key, 600)

      expect(mockSignatureUrl).toHaveBeenCalledWith(key, { expires: 600, method: 'GET' })
    })
  })

  describe('getPublicUrl', () => {
    it('正确拼接 bucket + region + key 为公网 URL', () => {
      const key = 'videos/originals/proj-001/input.mp4'

      const url = getPublicUrl(key)

      expect(url).toBe(`https://${TEST_BUCKET}.${TEST_REGION}.aliyuncs.com/${key}`)
    })

    it('key 包含中文/特殊字符时原样拼接', () => {
      const key = 'videos/测试项目/文件 (1).mp4'

      const url = getPublicUrl(key)

      expect(url).toBe(`https://${TEST_BUCKET}.${TEST_REGION}.aliyuncs.com/${key}`)
    })
  })

  describe('toAcceleratedUrl', () => {
    it('将 OSS 标准域名 URL 转为加速域名', () => {
      const key = 'videos/generated/proj-001/out.mp4'
      const standardUrl = `https://${TEST_BUCKET}.${TEST_REGION}.aliyuncs.com/${key}`

      const acceleratedUrl = toAcceleratedUrl(standardUrl)

      expect(acceleratedUrl).toBe(`https://${TEST_BUCKET}.${TEST_ACCELERATE_ENDPOINT}/${key}`)
    })

    it('非本系统 OSS URL 原样返回', () => {
      const externalUrl = 'https://other-bucket.oss-cn-beijing.aliyuncs.com/file.mp4'

      const result = toAcceleratedUrl(externalUrl)

      expect(result).toBe(externalUrl)
    })

    it('空字符串原样返回', () => {
      expect(toAcceleratedUrl('')).toBe('')
    })
  })

  describe('extractKeyFromUrl', () => {
    it('从标准 OSS URL 中提取 key', () => {
      const key = 'videos/originals/proj-001/video.mp4'
      const url = `https://${TEST_BUCKET}.${TEST_REGION}.aliyuncs.com/${key}`

      expect(extractKeyFromUrl(url)).toBe(key)
    })

    it('非本系统 URL 返回 null', () => {
      expect(extractKeyFromUrl('https://other.com/file.mp4')).toBeNull()
    })
  })

  describe('getMediaProxyUrl', () => {
    it('将 key 转为 /api/media/{key} 代理路径', () => {
      const key = 'videos/originals/proj-001/video.mp4'

      const proxyUrl = getMediaProxyUrl(key)

      expect(proxyUrl).toBe(`/api/media/${key}`)
    })

    it('特殊字符路径段被 encodeURIComponent 编码', () => {
      const key = 'videos/项目 (1)/文件.mp4'

      const proxyUrl = getMediaProxyUrl(key)

      // 每段编码，/ 保留
      expect(proxyUrl).toContain('/api/media/')
      expect(proxyUrl).toContain(encodeURIComponent('项目 (1)'))
      expect(proxyUrl).toContain(encodeURIComponent('文件.mp4'))
    })
  })

  describe('toMediaProxyUrl', () => {
    it('OSS 直链转为代理路径', () => {
      const key = 'videos/originals/proj-001/video.mp4'
      const ossUrl = `https://${TEST_BUCKET}.${TEST_REGION}.aliyuncs.com/${key}`

      const result = toMediaProxyUrl(ossUrl)

      expect(result).toBe(`/api/media/${key}`)
    })

    it('开发模式本地路径 /uploads/... 转为代理路径', () => {
      const key = 'videos/originals/proj-001/video.mp4'

      const result = toMediaProxyUrl(`/uploads/${key}`)

      expect(result).toBe(`/api/media/${key}`)
    })

    it('已是代理路径时原样返回（幂等）', () => {
      const proxyUrl = '/api/media/videos/originals/proj-001/video.mp4'

      expect(toMediaProxyUrl(proxyUrl)).toBe(proxyUrl)
    })

    it('null/undefined 原样透传', () => {
      expect(toMediaProxyUrl(null)).toBeNull()
      expect(toMediaProxyUrl(undefined)).toBeUndefined()
    })

    it('asset:// 引用原样返回', () => {
      const assetRef = 'asset://character-001/avatar.png'

      expect(toMediaProxyUrl(assetRef)).toBe(assetRef)
    })
  })
})
