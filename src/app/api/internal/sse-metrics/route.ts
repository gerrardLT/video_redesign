/**
 * SSE 连接监控端点
 *
 * 返回当前 SSE 连接的实时指标，仅允许内部调用。
 * 通过 x-internal-api-key header 进行鉴权。
 *
 * 响应格式:
 * - totalActiveConnections: 全局活跃连接总数
 * - connectionsPerUser: 每用户连接数分布
 * - timestamp: 数据采集时间
 *
 * _Requirements: 9.3_
 */

import { NextRequest, NextResponse } from 'next/server'
import { connectionRegistry } from '@/lib/sse/connection-registry'

export const dynamic = 'force-dynamic'

const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || 'internal-secret'

export async function GET(request: NextRequest): Promise<Response> {
  // 内部 API Key 鉴权
  const apiKey = request.headers.get('x-internal-api-key')
  if (apiKey !== INTERNAL_API_KEY) {
    return NextResponse.json({ error: '未授权' }, { status: 401 })
  }

  const totalActiveConnections = connectionRegistry.getTotalConnections()
  const connectionsPerUser = Object.fromEntries(connectionRegistry.getConnectionsPerUser())

  return NextResponse.json({
    totalActiveConnections,
    connectionsPerUser,
    timestamp: new Date().toISOString(),
  })
}
