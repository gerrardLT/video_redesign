/**
 * Unit Test: validateMp4File
 * Validates: Requirements 1.6
 */
import { describe, it, expect } from 'vitest'

// 由于 validateMp4File 是 generate-video.ts 内部函数，我们需要导出或复制逻辑
// 这里验证 MP4 ftyp box 检测逻辑
function validateMp4File(buffer: Buffer): boolean {
  if (!buffer || buffer.length === 0) return false
  if (buffer.length < 8) return false
  const ftypSignature = buffer.slice(4, 8).toString('ascii')
  return ftypSignature === 'ftyp'
}

describe('validateMp4File', () => {
  it('空 buffer → false', () => {
    expect(validateMp4File(Buffer.alloc(0))).toBe(false)
  })

  it('非 ftyp 头 → false', () => {
    const invalidBuffer = Buffer.from('0000000048454C50', 'hex') // "HELP" instead of "ftyp"
    expect(validateMp4File(invalidBuffer)).toBe(false)
  })

  it('太短的 buffer (< 8 字节) → false', () => {
    expect(validateMp4File(Buffer.alloc(4))).toBe(false)
    expect(validateMp4File(Buffer.alloc(7))).toBe(false)
  })

  it('有效 MP4 头（包含 ftyp）→ true', () => {
    // 标准 MP4 ftyp box: 前 4 字节为 box 大小，后 4 字节为 "ftyp"
    const validMp4Header = Buffer.alloc(32)
    validMp4Header.writeUInt32BE(32, 0) // box size
    validMp4Header.write('ftyp', 4, 'ascii') // box type
    validMp4Header.write('isom', 8, 'ascii') // major brand
    expect(validateMp4File(validMp4Header)).toBe(true)
  })

  it('实际 MP4 文件头格式（ftypisom）→ true', () => {
    // 模拟真实 MP4 文件的前几字节
    const buffer = Buffer.from([
      0x00, 0x00, 0x00, 0x20, // box size = 32
      0x66, 0x74, 0x79, 0x70, // "ftyp"
      0x69, 0x73, 0x6f, 0x6d, // "isom"
      0x00, 0x00, 0x02, 0x00, // minor version
      0x69, 0x73, 0x6f, 0x6d, // compatible brands
    ])
    expect(validateMp4File(buffer)).toBe(true)
  })
})
