import { describe, it, expect } from 'vitest'
import jwt from 'jsonwebtoken'
import { signToken, verifyToken, hashPassword, comparePassword } from '@/lib/shared/auth'

describe('auth - hashPassword & comparePassword', () => {
  it('正确密码应验证通过', async () => {
    const password = 'mySecureP@ss123'
    const hash = await hashPassword(password)
    const result = await comparePassword(password, hash)
    expect(result).toBe(true)
  })

  it('错误密码应验证失败', async () => {
    const hash = await hashPassword('correctPassword')
    const result = await comparePassword('wrongPassword', hash)
    expect(result).toBe(false)
  })

  it('哈希值不应与原始密码相同', async () => {
    const password = 'testPassword123'
    const hash = await hashPassword(password)
    expect(hash).not.toBe(password)
  })
})

describe('auth - signToken', () => {
  it('应返回字符串格式的 token', () => {
    const token = signToken({ userId: 'test-user-id', role: 'USER' })
    expect(typeof token).toBe('string')
    expect(token.split('.')).toHaveLength(3) // JWT 格式: header.payload.signature
  })
})

describe('auth - verifyToken', () => {
  it('应正确解码有效 token', () => {
    const payload = { userId: 'user-123', role: 'ADMIN' }
    const token = signToken(payload)
    const decoded = verifyToken(token)
    expect(decoded.userId).toBe(payload.userId)
    expect(decoded.role).toBe(payload.role)
  })

  it('无效 token 应抛出错误', () => {
    expect(() => verifyToken('invalid.token.string')).toThrow()
  })

  it('篡改的 token 应抛出错误', () => {
    const token = signToken({ userId: 'user-123', role: 'USER' })
    const tampered = token.slice(0, -5) + 'xxxxx'
    expect(() => verifyToken(tampered)).toThrow()
  })

  it('过期的 token 应抛出错误', () => {
    const secret = process.env.JWT_SECRET || 'fallback-secret'
    // 手动创建一个已过期的 token
    const expiredToken = jwt.sign(
      { userId: 'user-123', role: 'USER' },
      secret,
      { expiresIn: '-1s' }
    )
    expect(() => verifyToken(expiredToken)).toThrow()
  })
})
