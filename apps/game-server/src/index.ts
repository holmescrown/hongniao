// Worker 入口：CORS、健康检查、随机房间号、WebSocket 转发到对应房间的 Durable Object

import type { Env } from './types'
import { RoomDurableObject } from './room'

export { RoomDurableObject } from './room'
export type { Env } from './types'

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json; charset=utf-8' },
  })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // CORS 预检
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS })
    }

    const url = new URL(request.url)

    // WebSocket 升级：按 roomId 定位 DO，原样转发（保留 Upgrade 头与 roomId 查询参数）
    if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
      const roomId = url.searchParams.get('roomId')?.trim() || 'default'
      const stub = env.ROOM.get(env.ROOM.idFromName(roomId))
      return stub.fetch(request)
    }

    // 健康检查
    if (url.pathname === '/' && request.method === 'GET') {
      return json({
        ok: true,
        service: 'redbird-game-server',
        game: '白城麻将',
        description: 'Cloudflare Workers + Durable Objects 实时对战服务',
        endpoints: {
          health: 'GET /',
          newRoom: 'POST /api/room',
          websocket: 'WS /ws?roomId=<房间号>',
        },
        timestamp: new Date().toISOString(),
      })
    }

    // 生成随机房间号（供前端 quick_match 使用）
    if (url.pathname === '/api/room' && request.method === 'POST') {
      const roomId = crypto.randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase()
      return json({ roomId, wsUrl: `/ws?roomId=${roomId}` })
    }

    return json({ ok: false, error: 'Not found' }, 404)
  },
} satisfies ExportedHandler<Env>
