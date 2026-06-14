/**
 * Feature: video-reshaping-mvp
 * Property 2: 视频文件校验完整性
 *
 * 验证文件校验逻辑对各种输入的正确性：
 * - 合法文件始终通过校验
 * - 超出限制的文件始终被拒绝
 * - 不支持的格式始终被拒绝
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import {
  validateVideoFile,
  ALLOWED_VIDEO_TYPES,
  MAX_VIDEO_SIZE,
  MAX_VIDEO_DURATION,
} from '@/lib/validators/file-validator'

describe('Property 2: 视频文件校验完整性', () => {
  /**
   * Validates: Requirements 3.1
   * 合法的视频文件应始终通过校验
   */
  it('合法视频文件始终通过校验', () => {
    const validFileArb = fc.record({
      fileName: fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
      fileSize: fc.integer({ min: 1, max: MAX_VIDEO_SIZE }),
      mimeType: fc.constantFrom(...ALLOWED_VIDEO_TYPES),
      duration: fc.double({ min: 0.1, max: MAX_VIDEO_DURATION, noNaN: true }),
    })

    fc.assert(
      fc.property(validFileArb, (file) => {
        const result = validateVideoFile(file)
        expect(result.success).toBe(true)
      }),
      { numRuns: 200 }
    )
  })

  /**
   * Validates: Requirements 3.1
   * 超过 300MB 的文件应始终被拒绝
   */
  it('超过 300MB 的文件始终被拒绝', () => {
    const oversizedFileArb = fc.record({
      fileName: fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
      fileSize: fc.integer({ min: MAX_VIDEO_SIZE + 1, max: MAX_VIDEO_SIZE * 3 }),
      mimeType: fc.constantFrom(...ALLOWED_VIDEO_TYPES),
      duration: fc.double({ min: 0.1, max: MAX_VIDEO_DURATION, noNaN: true }),
    })

    fc.assert(
      fc.property(oversizedFileArb, (file) => {
        const result = validateVideoFile(file)
        expect(result.success).toBe(false)
      }),
      { numRuns: 100 }
    )
  })

  /**
   * Validates: Requirements 3.1
   * 超过 2 分钟的视频应始终被拒绝
   */
  it('超过 2 分钟的视频始终被拒绝', () => {
    const longVideoArb = fc.record({
      fileName: fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
      fileSize: fc.integer({ min: 1, max: MAX_VIDEO_SIZE }),
      mimeType: fc.constantFrom(...ALLOWED_VIDEO_TYPES),
      duration: fc.double({ min: MAX_VIDEO_DURATION + 0.1, max: 600, noNaN: true }),
    })

    fc.assert(
      fc.property(longVideoArb, (file) => {
        const result = validateVideoFile(file)
        expect(result.success).toBe(false)
      }),
      { numRuns: 100 }
    )
  })

  /**
   * Validates: Requirements 3.1
   * 不支持的 MIME 类型应始终被拒绝
   */
  it('不支持的 MIME 类型始终被拒绝', () => {
    const invalidTypes = [
      'video/avi',
      'video/x-msvideo',
      'video/x-flv',
      'video/x-matroska',
      'audio/mp3',
      'image/png',
      'application/pdf',
      'text/plain',
    ]

    const invalidTypeFileArb = fc.record({
      fileName: fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
      fileSize: fc.integer({ min: 1, max: MAX_VIDEO_SIZE }),
      mimeType: fc.constantFrom(...invalidTypes),
      duration: fc.double({ min: 0.1, max: MAX_VIDEO_DURATION, noNaN: true }),
    })

    fc.assert(
      fc.property(invalidTypeFileArb, (file) => {
        const result = validateVideoFile(file)
        expect(result.success).toBe(false)
      }),
      { numRuns: 100 }
    )
  })

  /**
   * Validates: Requirements 3.1
   * 文件大小为 0 或负数应始终被拒绝
   */
  it('文件大小为 0 应被拒绝', () => {
    const zeroSizeFileArb = fc.record({
      fileName: fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
      fileSize: fc.constantFrom(0, -1, -100),
      mimeType: fc.constantFrom(...ALLOWED_VIDEO_TYPES),
      duration: fc.double({ min: 0.1, max: MAX_VIDEO_DURATION, noNaN: true }),
    })

    fc.assert(
      fc.property(zeroSizeFileArb, (file) => {
        const result = validateVideoFile(file)
        expect(result.success).toBe(false)
      }),
      { numRuns: 50 }
    )
  })
})
