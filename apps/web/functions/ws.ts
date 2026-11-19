// Pages Function：把同域 /ws 的 WebSocket 升级请求转发到已部署的 Durable Object。
// 这样前端连接 pages.dev 同域即可真实联机，绕开被 DNS 污染的 workers.dev 域名。
// DO 在内部由 CF 网络转发，不经过用户浏览器的 DNS 解析。
export async function onRequest(context: { request: Request; env: { ROOM: DurableObjectNamespace } }) {
  const request = context.request
  const url = new URL(request.url)
  const roomId = (url.searchParams.get('roomId') || 'default').trim()

  // CORS 预检（同域一般不需要，保留以便调试/跨域场景）
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Upgrade, Connection',
      },
    })
  }

  const stub = context.env.ROOM.get(context.env.ROOM.idFromName(roomId))
  // 原样转发请求（保留 Upgrade/Connection 头与 roomId 参数），DO 返回 101 + webSocket
  return stub.fetch(request)
}
