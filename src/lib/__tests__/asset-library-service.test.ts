/**
 * AssetLibraryService 单元测试
 * 覆盖：复用角色图 URL 一致、删除引用保留 OSS 文件、跨用户 403、displayName 派生、
 *       下载签名 URL 生成、跨项目角色图应用、项目与角色列表查询
 */
import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  prisma: {
    asset: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      delete: vi.fn(),
    },
    character: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    project: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}))

vi.mock('@/lib/storage', () => ({
  deleteObject: vi.fn(),
  extractKeyFromUrl: vi.fn((url: string) => url.replace('https://oss.example.com/', '')),
  isOSSConfigured: vi.fn(() => true),
  getSignedObjectUrl: vi.fn((key: string, _expires: number) => `https://oss.example.com/${key}?Signature=abc&Expires=9999`),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn() },
}))

import { prisma } from '@/lib/db'
import { deleteObject } from '@/lib/storage'
import {
  deleteAsset,
  getCharacterAssets,
  listAssets,
  generateDownloadUrl,
  applyToCharacter,
  listProjectsWithCharacterCount,
} from '@/lib/asset-library-service'
import { ApiError } from '@/lib/api-error'

beforeEach(() => {
  vi.clearAllMocks()
})

// ========================
// deleteAsset 测试
// ========================

describe('deleteAsset', () => {
  it('跨用户访问返回 403', async () => {
    // 资产属于 user-A，但 user-B 尝试删除
    vi.mocked(prisma.asset.findUnique).mockResolvedValue({
      id: 'asset-1',
      userId: 'user-A',
      url: 'https://oss.example.com/chars/img.png',
      projectId: null,
      type: 'CHARACTER_IMAGE',
      category: 'CHARACTER',
      displayName: '角色1',
      thumbUrl: null,
      fileName: 'img.png',
      fileSize: 1024,
      isCharImage: true,
      sortOrder: 0,
      status: 'UPLOADED',
      rejectReason: null,
      expiresAt: null,
      createdAt: new Date(),
    } as any)

    await expect(deleteAsset('asset-1', 'user-B')).rejects.toThrow(ApiError)
    await expect(deleteAsset('asset-1', 'user-B')).rejects.toMatchObject({
      statusCode: 403,
    })

    // 不应调用 delete
    expect(prisma.asset.delete).not.toHaveBeenCalled()
  })

  it('资产不存在返回 404', async () => {
    vi.mocked(prisma.asset.findUnique).mockResolvedValue(null)

    await expect(deleteAsset('non-exist', 'user-A')).rejects.toThrow(ApiError)
    await expect(deleteAsset('non-exist', 'user-A')).rejects.toMatchObject({
      statusCode: 404,
    })
  })

  it('有引用保留 OSS 文件', async () => {
    const assetUrl = 'https://oss.example.com/chars/shared.png'

    vi.mocked(prisma.asset.findUnique).mockResolvedValue({
      id: 'asset-2',
      userId: 'user-A',
      url: assetUrl,
      projectId: 'proj-1',
      type: 'CHARACTER_IMAGE',
      category: 'CHARACTER',
      displayName: '共享角色',
      thumbUrl: null,
      fileName: 'shared.png',
      fileSize: 2048,
      isCharImage: true,
      sortOrder: 0,
      status: 'UPLOADED',
      rejectReason: null,
      expiresAt: null,
      createdAt: new Date(),
    } as any)

    // Character.imageUrl 引用了同一 URL
    vi.mocked(prisma.character.findFirst).mockResolvedValue({
      id: 'char-1',
    } as any)

    vi.mocked(prisma.asset.delete).mockResolvedValue({} as any)

    await deleteAsset('asset-2', 'user-A')

    // DB 记录应被删除
    expect(prisma.asset.delete).toHaveBeenCalledWith({
      where: { id: 'asset-2' },
    })

    // OSS 文件不应被删除（有引用）
    expect(deleteObject).not.toHaveBeenCalled()
  })

  it('无引用删除 OSS 文件', async () => {
    const assetUrl = 'https://oss.example.com/chars/orphan.png'

    vi.mocked(prisma.asset.findUnique).mockResolvedValue({
      id: 'asset-3',
      userId: 'user-A',
      url: assetUrl,
      projectId: 'proj-1',
      type: 'CHARACTER_IMAGE',
      category: 'CHARACTER',
      displayName: '孤立角色',
      thumbUrl: null,
      fileName: 'orphan.png',
      fileSize: 1024,
      isCharImage: true,
      sortOrder: 0,
      status: 'UPLOADED',
      rejectReason: null,
      expiresAt: null,
      createdAt: new Date(),
    } as any)

    // 无 Character 引用
    vi.mocked(prisma.character.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.asset.delete).mockResolvedValue({} as any)

    await deleteAsset('asset-3', 'user-A')

    // DB 记录应被删除
    expect(prisma.asset.delete).toHaveBeenCalledWith({
      where: { id: 'asset-3' },
    })

    // OSS 文件应被删除（无引用）
    expect(deleteObject).toHaveBeenCalledWith('chars/orphan.png')
  })
})

// ========================
// getCharacterAssets 测试
// ========================

describe('getCharacterAssets', () => {
  it('返回 CHARACTER 类型资产并正确查询', async () => {
    const mockAssets = [
      {
        id: 'asset-c1',
        displayName: '角色A',
        category: 'CHARACTER',
        type: 'CHARACTER_IMAGE',
        url: 'https://oss.example.com/chars/a.png',
        thumbUrl: 'https://oss.example.com/thumbs/a.png',
        fileName: 'a.png',
        fileSize: 1024,
        createdAt: new Date('2024-01-01'),
        project: { name: '项目1' },
      },
    ]

    vi.mocked(prisma.asset.findMany).mockResolvedValue(mockAssets as any)

    const result = await getCharacterAssets('user-A')

    // 验证查询条件
    expect(prisma.asset.findMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-A',
        category: 'CHARACTER',
      },
      include: {
        project: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    // 验证返回数据
    expect(result).toHaveLength(1)
    expect(result[0].category).toBe('CHARACTER')
    expect(result[0].displayName).toBe('角色A')
    expect(result[0].url).toBe('https://oss.example.com/chars/a.png')
  })
})

// ========================
// listAssets - displayName 派生测试
// ========================

describe('listAssets', () => {
  it('displayName 为空时 fallback 到 fileName', async () => {
    const mockAssets = [
      {
        id: 'asset-d1',
        displayName: null,
        fileName: '我的素材.png',
        category: 'MATERIAL',
        type: 'UPLOADED_IMAGE',
        url: 'https://oss.example.com/materials/file.png',
        thumbUrl: null,
        fileSize: 512,
        createdAt: new Date('2024-02-01'),
        project: null,
      },
    ]

    vi.mocked(prisma.asset.count).mockResolvedValue(1)
    vi.mocked(prisma.asset.findMany).mockResolvedValue(mockAssets as any)

    const result = await listAssets({ userId: 'user-A' })

    // displayName 应从 fileName 派生
    expect(result.items[0].displayName).toBe('我的素材.png')
  })

  it('displayName 和 fileName 都为空时 fallback 到默认名', async () => {
    const mockAssets = [
      {
        id: 'asset-d2',
        displayName: null,
        fileName: null,
        category: 'AUDIO',
        type: 'AI_GENERATED',
        url: 'https://oss.example.com/audio/unknown.mp3',
        thumbUrl: null,
        fileSize: 256,
        createdAt: new Date('2024-03-01'),
        project: { name: '测试项目' },
      },
    ]

    vi.mocked(prisma.asset.count).mockResolvedValue(1)
    vi.mocked(prisma.asset.findMany).mockResolvedValue(mockAssets as any)

    const result = await listAssets({ userId: 'user-A' })

    // 全部为空时 fallback 到 '未命名资产'
    expect(result.items[0].displayName).toBe('未命名资产')
  })

  it('有 displayName 时直接使用', async () => {
    const mockAssets = [
      {
        id: 'asset-d3',
        displayName: '自定义名称',
        fileName: 'original.png',
        category: 'CHARACTER',
        type: 'CHARACTER_IMAGE',
        url: 'https://oss.example.com/chars/original.png',
        thumbUrl: null,
        fileSize: 1024,
        createdAt: new Date('2024-04-01'),
        project: { name: '项目X' },
      },
    ]

    vi.mocked(prisma.asset.count).mockResolvedValue(1)
    vi.mocked(prisma.asset.findMany).mockResolvedValue(mockAssets as any)

    const result = await listAssets({ userId: 'user-A' })

    // 有 displayName 时优先使用
    expect(result.items[0].displayName).toBe('自定义名称')
  })
})

// ========================
// 复用角色图 URL 一致性测试
// ========================

describe('复用角色图 URL 一致', () => {
  it('getCharacterAssets 返回的 URL 与存储一致，可直接复用', async () => {
    const sharedUrl = 'https://oss.example.com/chars/shared-character.png'

    const mockAssets = [
      {
        id: 'asset-shared',
        displayName: '共享角色',
        category: 'CHARACTER',
        type: 'CHARACTER_IMAGE',
        url: sharedUrl,
        thumbUrl: 'https://oss.example.com/thumbs/shared-character.png',
        fileName: 'shared-character.png',
        fileSize: 2048,
        createdAt: new Date('2024-01-15'),
        project: { name: '项目A' },
      },
    ]

    vi.mocked(prisma.asset.findMany).mockResolvedValue(mockAssets as any)

    const result = await getCharacterAssets('user-A')

    // 返回的 URL 与原始存储 URL 完全一致，无文件复制
    expect(result[0].url).toBe(sharedUrl)
    // 跨项目复用时，Character.imageUrl 直接引用此 URL（不经过 OSS 复制）
    expect(result[0].url).toMatch(/^https:\/\//)
  })
})


// ========================
// generateDownloadUrl 测试
// ========================

describe('generateDownloadUrl', () => {
  it('正常路径 - 生成签名 URL 和文件名', async () => {
    vi.mocked(prisma.asset.findUnique).mockResolvedValue({
      id: 'asset-dl-1',
      userId: 'user-A',
      url: 'https://oss.example.com/chars/avatar.png',
      fileName: 'avatar.png',
      displayName: '我的角色',
      projectId: 'proj-1',
      type: 'CHARACTER_IMAGE',
      category: 'CHARACTER',
      thumbUrl: null,
      fileSize: 2048,
      isCharImage: true,
      sortOrder: 0,
      status: 'UPLOADED',
      rejectReason: null,
      expiresAt: null,
      createdAt: new Date(),
    } as any)

    const result = await generateDownloadUrl('asset-dl-1', 'user-A')

    // 应返回签名 URL（包含 Signature 参数）
    expect(result.downloadUrl).toContain('Signature=')
    expect(result.downloadUrl).toContain('chars/avatar.png')
    // 文件名使用原始 fileName
    expect(result.fileName).toBe('avatar.png')
  })

  it('无权限 - 非资产拥有者返回 403', async () => {
    vi.mocked(prisma.asset.findUnique).mockResolvedValue({
      id: 'asset-dl-2',
      userId: 'user-A',
      url: 'https://oss.example.com/chars/private.png',
      fileName: 'private.png',
      displayName: '私有角色',
      projectId: 'proj-1',
      type: 'CHARACTER_IMAGE',
      category: 'CHARACTER',
      thumbUrl: null,
      fileSize: 1024,
      isCharImage: true,
      sortOrder: 0,
      status: 'UPLOADED',
      rejectReason: null,
      expiresAt: null,
      createdAt: new Date(),
    } as any)

    // user-B 尝试下载 user-A 的资产
    await expect(generateDownloadUrl('asset-dl-2', 'user-B')).rejects.toThrow(ApiError)
    await expect(generateDownloadUrl('asset-dl-2', 'user-B')).rejects.toMatchObject({
      statusCode: 403,
    })
  })

  it('资产不存在 - 返回 404', async () => {
    vi.mocked(prisma.asset.findUnique).mockResolvedValue(null)

    await expect(generateDownloadUrl('non-exist-asset', 'user-A')).rejects.toThrow(ApiError)
    await expect(generateDownloadUrl('non-exist-asset', 'user-A')).rejects.toMatchObject({
      statusCode: 404,
    })
  })

  it('fileName 为空时回退到 displayName', async () => {
    vi.mocked(prisma.asset.findUnique).mockResolvedValue({
      id: 'asset-dl-3',
      userId: 'user-A',
      url: 'https://oss.example.com/materials/file123.png',
      fileName: null,
      displayName: '素材截图',
      projectId: 'proj-1',
      type: 'UPLOADED_IMAGE',
      category: 'MATERIAL',
      thumbUrl: null,
      fileSize: 512,
      isCharImage: false,
      sortOrder: 0,
      status: 'UPLOADED',
      rejectReason: null,
      expiresAt: null,
      createdAt: new Date(),
    } as any)

    const result = await generateDownloadUrl('asset-dl-3', 'user-A')
    // 无 fileName 时回退到 displayName
    expect(result.fileName).toBe('素材截图')
  })
})

// ========================
// applyToCharacter 测试
// ========================

describe('applyToCharacter', () => {
  it('正常路径 - 成功更新角色 imageUrl', async () => {
    const assetUrl = 'https://oss.example.com/chars/hero.png'

    // 资产存在且属于当前用户
    vi.mocked(prisma.asset.findUnique).mockResolvedValue({
      id: 'asset-apply-1',
      userId: 'user-A',
      url: assetUrl,
      fileName: 'hero.png',
      displayName: '主角',
      projectId: 'proj-source',
      type: 'CHARACTER_IMAGE',
      category: 'CHARACTER',
      thumbUrl: null,
      fileSize: 4096,
      isCharImage: true,
      sortOrder: 0,
      status: 'UPLOADED',
      rejectReason: null,
      expiresAt: null,
      createdAt: new Date(),
    } as any)

    // 目标项目存在且属于当前用户
    vi.mocked(prisma.project.findUnique).mockResolvedValue({
      id: 'proj-target',
      userId: 'user-A',
      name: '目标项目',
    } as any)

    // 目标角色存在且属于目标项目
    vi.mocked(prisma.character.findFirst).mockResolvedValue({
      id: 'char-target',
      name: '配角',
      projectId: 'proj-target',
      imageUrl: null,
    } as any)

    // 模拟事务执行 - 返回更新后的角色
    const updatedCharacter = {
      id: 'char-target',
      name: '配角',
      projectId: 'proj-target',
      imageUrl: assetUrl,
    }
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
      return fn({
        character: {
          update: vi.fn().mockResolvedValue(updatedCharacter),
        },
      })
    })

    const result = await applyToCharacter('asset-apply-1', 'proj-target', 'char-target', 'user-A')

    // imageUrl 应与资产 URL 完全一致（直接引用，不复制文件）
    expect(result.imageUrl).toBe(assetUrl)
    expect(result.id).toBe('char-target')
  })

  it('覆盖已有 imageUrl - 正确更新', async () => {
    const newAssetUrl = 'https://oss.example.com/chars/new-hero.png'
    const oldImageUrl = 'https://oss.example.com/chars/old-hero.png'

    vi.mocked(prisma.asset.findUnique).mockResolvedValue({
      id: 'asset-apply-2',
      userId: 'user-A',
      url: newAssetUrl,
      fileName: 'new-hero.png',
      displayName: '新角色',
      projectId: 'proj-source',
      type: 'CHARACTER_IMAGE',
      category: 'CHARACTER',
      thumbUrl: null,
      fileSize: 4096,
      isCharImage: true,
      sortOrder: 0,
      status: 'UPLOADED',
      rejectReason: null,
      expiresAt: null,
      createdAt: new Date(),
    } as any)

    vi.mocked(prisma.project.findUnique).mockResolvedValue({
      id: 'proj-target',
      userId: 'user-A',
      name: '目标项目',
    } as any)

    // 目标角色已有 imageUrl
    vi.mocked(prisma.character.findFirst).mockResolvedValue({
      id: 'char-existing',
      name: '已有角色',
      projectId: 'proj-target',
      imageUrl: oldImageUrl,
    } as any)

    const updatedCharacter = {
      id: 'char-existing',
      name: '已有角色',
      projectId: 'proj-target',
      imageUrl: newAssetUrl,
    }
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
      return fn({
        character: {
          update: vi.fn().mockResolvedValue(updatedCharacter),
        },
      })
    })

    const result = await applyToCharacter('asset-apply-2', 'proj-target', 'char-existing', 'user-A')

    // 新 URL 应覆盖旧 URL
    expect(result.imageUrl).toBe(newAssetUrl)
    expect(result.imageUrl).not.toBe(oldImageUrl)
  })

  it('无权访问资产 - 资产不属于当前用户返回 403', async () => {
    vi.mocked(prisma.asset.findUnique).mockResolvedValue({
      id: 'asset-other',
      userId: 'user-B', // 资产属于 user-B
      url: 'https://oss.example.com/chars/other.png',
      fileName: 'other.png',
      displayName: '他人角色',
      projectId: 'proj-x',
      type: 'CHARACTER_IMAGE',
      category: 'CHARACTER',
      thumbUrl: null,
      fileSize: 1024,
      isCharImage: true,
      sortOrder: 0,
      status: 'UPLOADED',
      rejectReason: null,
      expiresAt: null,
      createdAt: new Date(),
    } as any)

    // user-A 尝试使用 user-B 的资产
    await expect(
      applyToCharacter('asset-other', 'proj-target', 'char-1', 'user-A')
    ).rejects.toThrow(ApiError)
    await expect(
      applyToCharacter('asset-other', 'proj-target', 'char-1', 'user-A')
    ).rejects.toMatchObject({ statusCode: 403, message: '无权访问该资产' })

    // 不应执行事务
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('无权操作项目 - 项目不属于当前用户返回 403', async () => {
    vi.mocked(prisma.asset.findUnique).mockResolvedValue({
      id: 'asset-ok',
      userId: 'user-A',
      url: 'https://oss.example.com/chars/ok.png',
      fileName: 'ok.png',
      displayName: '我的角色',
      projectId: 'proj-mine',
      type: 'CHARACTER_IMAGE',
      category: 'CHARACTER',
      thumbUrl: null,
      fileSize: 1024,
      isCharImage: true,
      sortOrder: 0,
      status: 'UPLOADED',
      rejectReason: null,
      expiresAt: null,
      createdAt: new Date(),
    } as any)

    // 目标项目属于另一个用户
    vi.mocked(prisma.project.findUnique).mockResolvedValue({
      id: 'proj-other',
      userId: 'user-B', // 项目属于 user-B
      name: '他人项目',
    } as any)

    await expect(
      applyToCharacter('asset-ok', 'proj-other', 'char-1', 'user-A')
    ).rejects.toThrow(ApiError)
    await expect(
      applyToCharacter('asset-ok', 'proj-other', 'char-1', 'user-A')
    ).rejects.toMatchObject({ statusCode: 403, message: '无权操作该项目' })

    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('资产不存在 - 返回 404', async () => {
    vi.mocked(prisma.asset.findUnique).mockResolvedValue(null)

    await expect(
      applyToCharacter('non-exist', 'proj-target', 'char-1', 'user-A')
    ).rejects.toThrow(ApiError)
    await expect(
      applyToCharacter('non-exist', 'proj-target', 'char-1', 'user-A')
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it('目标项目不存在 - 返回 404', async () => {
    vi.mocked(prisma.asset.findUnique).mockResolvedValue({
      id: 'asset-ok',
      userId: 'user-A',
      url: 'https://oss.example.com/chars/ok.png',
      fileName: 'ok.png',
      displayName: '角色',
      projectId: 'proj-mine',
      type: 'CHARACTER_IMAGE',
      category: 'CHARACTER',
      thumbUrl: null,
      fileSize: 1024,
      isCharImage: true,
      sortOrder: 0,
      status: 'UPLOADED',
      rejectReason: null,
      expiresAt: null,
      createdAt: new Date(),
    } as any)

    // 项目不存在
    vi.mocked(prisma.project.findUnique).mockResolvedValue(null)

    await expect(
      applyToCharacter('asset-ok', 'non-exist-proj', 'char-1', 'user-A')
    ).rejects.toThrow(ApiError)
    await expect(
      applyToCharacter('asset-ok', 'non-exist-proj', 'char-1', 'user-A')
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it('目标角色不存在 - 返回 404', async () => {
    vi.mocked(prisma.asset.findUnique).mockResolvedValue({
      id: 'asset-ok',
      userId: 'user-A',
      url: 'https://oss.example.com/chars/ok.png',
      fileName: 'ok.png',
      displayName: '角色',
      projectId: 'proj-mine',
      type: 'CHARACTER_IMAGE',
      category: 'CHARACTER',
      thumbUrl: null,
      fileSize: 1024,
      isCharImage: true,
      sortOrder: 0,
      status: 'UPLOADED',
      rejectReason: null,
      expiresAt: null,
      createdAt: new Date(),
    } as any)

    vi.mocked(prisma.project.findUnique).mockResolvedValue({
      id: 'proj-target',
      userId: 'user-A',
      name: '目标项目',
    } as any)

    // 角色不存在
    vi.mocked(prisma.character.findFirst).mockResolvedValue(null)

    await expect(
      applyToCharacter('asset-ok', 'proj-target', 'non-exist-char', 'user-A')
    ).rejects.toThrow(ApiError)
    await expect(
      applyToCharacter('asset-ok', 'proj-target', 'non-exist-char', 'user-A')
    ).rejects.toMatchObject({ statusCode: 404, message: '目标角色不存在' })
  })
})

// ========================
// listProjectsWithCharacterCount 测试
// ========================

describe('listProjectsWithCharacterCount', () => {
  it('空列表 - 无项目返回空数组', async () => {
    vi.mocked(prisma.project.findMany).mockResolvedValue([])

    const result = await listProjectsWithCharacterCount('user-A')

    expect(result).toEqual([])
    expect(prisma.project.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-A' },
      select: {
        id: true,
        name: true,
        updatedAt: true,
        _count: {
          select: { characters: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
    })
  })

  it('返回项目列表按 updatedAt DESC 排序', async () => {
    const mockProjects = [
      {
        id: 'proj-1',
        name: '最近项目',
        updatedAt: new Date('2025-06-01T10:00:00Z'),
        _count: { characters: 3 },
      },
      {
        id: 'proj-2',
        name: '较早项目',
        updatedAt: new Date('2025-05-15T08:00:00Z'),
        _count: { characters: 1 },
      },
      {
        id: 'proj-3',
        name: '最早项目',
        updatedAt: new Date('2025-04-20T12:00:00Z'),
        _count: { characters: 5 },
      },
    ]

    vi.mocked(prisma.project.findMany).mockResolvedValue(mockProjects as any)

    const result = await listProjectsWithCharacterCount('user-A')

    // 验证返回数量
    expect(result).toHaveLength(3)

    // 验证排序 - updatedAt DESC（由 Prisma orderBy 保证）
    expect(result[0].name).toBe('最近项目')
    expect(result[1].name).toBe('较早项目')
    expect(result[2].name).toBe('最早项目')

    // 验证 characterCount 正确映射
    expect(result[0].characterCount).toBe(3)
    expect(result[1].characterCount).toBe(1)
    expect(result[2].characterCount).toBe(5)

    // 验证 updatedAt 为 ISO 字符串格式
    expect(result[0].updatedAt).toBe('2025-06-01T10:00:00.000Z')
    expect(result[1].updatedAt).toBe('2025-05-15T08:00:00.000Z')
  })

  it('正确映射字段结构', async () => {
    const mockProjects = [
      {
        id: 'proj-x',
        name: '测试项目',
        updatedAt: new Date('2025-03-01T00:00:00Z'),
        _count: { characters: 0 },
      },
    ]

    vi.mocked(prisma.project.findMany).mockResolvedValue(mockProjects as any)

    const result = await listProjectsWithCharacterCount('user-A')

    // 验证返回结构包含所有必要字段
    expect(result[0]).toEqual({
      id: 'proj-x',
      name: '测试项目',
      characterCount: 0,
      updatedAt: '2025-03-01T00:00:00.000Z',
    })
  })
})
