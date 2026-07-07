import { vi, describe, it, expect, beforeEach } from 'vitest'

/**
 * AssetIngestionService 单元测试
 *
 * 测试自动入库服务的核心逻辑：
 * - 自动入库创建完整 Asset 记录（字段验证）
 * - 再生成 upsert 更新而非新增
 * - thumbUrl 可选处理
 * - 生成失败不创建记录（由调用方控制，此处验证 upsert 逻辑正确性）
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4
 */

// ========================
// Mock setup
// ========================

vi.mock('@/lib/shared/db', () => ({
  prisma: {
    asset: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}))

import { prisma } from '@/lib/shared/db'
import { ingestCharacterImage } from '@/lib/shared/asset-ingestion-service'

const mockFindFirst = prisma.asset.findFirst as ReturnType<typeof vi.fn>
const mockCreate = prisma.asset.create as ReturnType<typeof vi.fn>
const mockUpdate = prisma.asset.update as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
})

// ========================
// 测试：自动入库创建完整记录
// Validates: Requirements 1.1, 1.2
// ========================

describe('ingestCharacterImage - 创建完整记录', () => {
  it('无已有记录时，应调用 prisma.asset.create 并填充正确字段', async () => {
    mockFindFirst.mockResolvedValue(null)
    mockCreate.mockResolvedValue({
      id: 'asset-new-001',
      userId: 'user-123',
      projectId: 'proj-456',
      type: 'CHARACTER_IMAGE',
      category: 'CHARACTER',
      displayName: '小明',
      url: 'https://oss.example.com/char-img.png',
      thumbUrl: 'https://oss.example.com/char-img-thumb.png',
      fileName: 'char:char-789',
      isCharImage: true,
      status: 'UPLOADED',
      sortOrder: 0,
    })

    const result = await ingestCharacterImage({
      userId: 'user-123',
      projectId: 'proj-456',
      characterId: 'char-789',
      characterName: '小明',
      imageUrl: 'https://oss.example.com/char-img.png',
      thumbUrl: 'https://oss.example.com/char-img-thumb.png',
    })

    // 验证查找条件正确
    expect(mockFindFirst).toHaveBeenCalledWith({
      where: {
        userId: 'user-123',
        category: 'CHARACTER',
        isCharImage: true,
        fileName: 'char:char-789',
      },
    })

    // 验证 create 调用的字段
    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        userId: 'user-123',
        projectId: 'proj-456',
        type: 'CHARACTER_IMAGE',
        category: 'CHARACTER',
        displayName: '小明',
        url: 'https://oss.example.com/char-img.png',
        thumbUrl: 'https://oss.example.com/char-img-thumb.png',
        fileName: 'char:char-789',
        isCharImage: true,
        status: 'UPLOADED',
        sortOrder: 0,
      },
    })

    // 验证返回结果
    expect(result.id).toBe('asset-new-001')
    expect(result.category).toBe('CHARACTER')
    expect(result.status).toBe('UPLOADED')
  })

  it('thumbUrl 未传入时，创建记录中 thumbUrl 为 null', async () => {
    mockFindFirst.mockResolvedValue(null)
    mockCreate.mockResolvedValue({
      id: 'asset-no-thumb',
      userId: 'user-123',
      projectId: 'proj-456',
      type: 'CHARACTER_IMAGE',
      category: 'CHARACTER',
      displayName: '角色A',
      url: 'https://oss.example.com/img.png',
      thumbUrl: null,
      fileName: 'char:char-abc',
      isCharImage: true,
      status: 'UPLOADED',
      sortOrder: 0,
    })

    await ingestCharacterImage({
      userId: 'user-123',
      projectId: 'proj-456',
      characterId: 'char-abc',
      characterName: '角色A',
      imageUrl: 'https://oss.example.com/img.png',
      // thumbUrl 不传
    })

    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        thumbUrl: null,
      }),
    })
  })
})

// ========================
// 测试：再生成 upsert 更新而非新增
// Validates: Requirements 1.3
// ========================

describe('ingestCharacterImage - Upsert 更新', () => {
  it('已有记录时，应调用 prisma.asset.update 更新 url/thumbUrl/displayName', async () => {
    const existingAsset = {
      id: 'asset-existing-001',
      userId: 'user-123',
      projectId: 'proj-456',
      type: 'CHARACTER_IMAGE',
      category: 'CHARACTER',
      displayName: '旧名字',
      url: 'https://oss.example.com/old-img.png',
      thumbUrl: 'https://oss.example.com/old-thumb.png',
      fileName: 'char:char-999',
      isCharImage: true,
      status: 'UPLOADED',
    }

    mockFindFirst.mockResolvedValue(existingAsset)
    mockUpdate.mockResolvedValue({
      ...existingAsset,
      url: 'https://oss.example.com/new-img.png',
      thumbUrl: 'https://oss.example.com/new-thumb.png',
      displayName: '新名字',
    })

    const result = await ingestCharacterImage({
      userId: 'user-123',
      projectId: 'proj-456',
      characterId: 'char-999',
      characterName: '新名字',
      imageUrl: 'https://oss.example.com/new-img.png',
      thumbUrl: 'https://oss.example.com/new-thumb.png',
    })

    // 验证 update 调用
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'asset-existing-001' },
      data: {
        url: 'https://oss.example.com/new-img.png',
        thumbUrl: 'https://oss.example.com/new-thumb.png',
        displayName: '新名字',
        status: 'UPLOADED',
      },
    })

    // 验证不调用 create
    expect(mockCreate).not.toHaveBeenCalled()

    // 验证返回更新后的结果
    expect(result.url).toBe('https://oss.example.com/new-img.png')
    expect(result.displayName).toBe('新名字')
  })

  it('再生成时不新增记录，仅更新已有记录', async () => {
    const existingAsset = {
      id: 'asset-existing-002',
      userId: 'user-abc',
      projectId: 'proj-xyz',
      type: 'CHARACTER_IMAGE',
      category: 'CHARACTER',
      displayName: '角色B',
      url: 'https://oss.example.com/v1.png',
      thumbUrl: 'https://oss.example.com/v1-thumb.png',
      fileName: 'char:char-bbb',
      isCharImage: true,
      status: 'UPLOADED',
    }

    mockFindFirst.mockResolvedValue(existingAsset)
    mockUpdate.mockResolvedValue({
      ...existingAsset,
      url: 'https://oss.example.com/v2.png',
      thumbUrl: 'https://oss.example.com/v2-thumb.png',
    })

    await ingestCharacterImage({
      userId: 'user-abc',
      projectId: 'proj-xyz',
      characterId: 'char-bbb',
      characterName: '角色B',
      imageUrl: 'https://oss.example.com/v2.png',
      thumbUrl: 'https://oss.example.com/v2-thumb.png',
    })

    // 核心断言：不应调用 create
    expect(mockCreate).not.toHaveBeenCalled()
    // 应调用 update
    expect(mockUpdate).toHaveBeenCalledTimes(1)
  })

  it('更新时若未传 thumbUrl，应保留已有 thumbUrl', async () => {
    const existingAsset = {
      id: 'asset-existing-003',
      userId: 'user-123',
      projectId: 'proj-456',
      type: 'CHARACTER_IMAGE',
      category: 'CHARACTER',
      displayName: '角色C',
      url: 'https://oss.example.com/old.png',
      thumbUrl: 'https://oss.example.com/existing-thumb.png',
      fileName: 'char:char-ccc',
      isCharImage: true,
      status: 'UPLOADED',
    }

    mockFindFirst.mockResolvedValue(existingAsset)
    mockUpdate.mockResolvedValue({
      ...existingAsset,
      url: 'https://oss.example.com/new.png',
    })

    await ingestCharacterImage({
      userId: 'user-123',
      projectId: 'proj-456',
      characterId: 'char-ccc',
      characterName: '角色C',
      imageUrl: 'https://oss.example.com/new.png',
      // thumbUrl 不传
    })

    // thumbUrl 应保留已有值
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'asset-existing-003' },
      data: expect.objectContaining({
        thumbUrl: 'https://oss.example.com/existing-thumb.png',
      }),
    })
  })
})
