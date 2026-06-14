import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'

const JWT_EXPIRY = '7d'

/**
 * 读取 JWT 签名密钥：必须由环境变量 JWT_SECRET 提供。
 * 缺失即抛错——禁止使用默认回退密钥（回退密钥会让生产环境的 token 可被任意伪造）。
 * 惰性读取（在签发/验证时调用），避免模块加载期因未注入环境变量而误抛。
 */
function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET
  if (!secret) {
    throw new Error('JWT_SECRET 未配置：服务端必须设置 JWT_SECRET 环境变量（禁止使用默认回退密钥）')
  }
  return secret
}

export interface JWTPayload {
  userId: string
  role: string
}

/**
 * 签发 JWT token
 */
export function signToken(payload: JWTPayload): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: JWT_EXPIRY })
}

/**
 * 验证 JWT token
 */
export function verifyToken(token: string): JWTPayload {
  return jwt.verify(token, getJwtSecret()) as JWTPayload
}

/**
 * 哈希密码
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10)
}

/**
 * 比较密码
 */
export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}
