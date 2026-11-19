// 游戏客户端：有后端连 CF Worker WebSocket，无后端自动用本地引擎
import type { ClientMessage, ServerMessage, RoomConfig, RoomState } from './protocol'
import { LocalGameEngine } from './localGame'

const WS_URL = (import.meta.env.VITE_GAME_SERVER_URL ?? '').replace(/\/$/, '')
export const isRemoteGame = Boolean(WS_URL)

export interface GameClientEvents {
  onState: (room: RoomState, youId: string) => void
  onError: (message: string) => void
  onGameOver: (result: any, room: RoomState) => void
}

type Handler = (m: ServerMessage) => void

class GameClient {
  private ws?: WebSocket
  private local = new LocalGameEngine()
  private handlers = new Set<Handler>()
  private unsubLocal?: () => void

  readonly mode: 'remote' | 'local' = isRemoteGame ? 'remote' : 'local'

  private ensureLocal() {
    if (!this.unsubLocal) {
      this.unsubLocal = this.local.subscribe((m) => this.handlers.forEach((h) => h(m)))
    }
  }

  subscribe(h: Handler) {
    this.handlers.add(h)
    if (!isRemoteGame) this.ensureLocal()
    return () => this.handlers.delete(h)
  }

  connect(roomId?: string) {
    if (isRemoteGame) {
      const proto = WS_URL.startsWith('https') ? 'wss' : 'ws'
      const host = WS_URL.replace(/^https?:\/\//, '').replace(/\/$/, '')
      const rid = roomId || sessionStorage.getItem('redbird_room_id') || 'default'
      sessionStorage.setItem('redbird_room_id', rid)
      this.ws = new WebSocket(`${proto}://${host}/ws?roomId=${encodeURIComponent(rid)}`)
      this.ws.onmessage = (e) => {
        try { const m = JSON.parse(e.data) as ServerMessage; this.handlers.forEach((h) => h(m)) } catch {}
      }
      this.ws.onerror = () => this.handlers.forEach((h) => h({ type: 'error', message: '连接游戏服务器失败' }))
    } else {
      this.ensureLocal()
    }
  }

  send(msg: ClientMessage) {
    if (isRemoteGame) {
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg))
      else this.handlers.forEach((h) => h({ type: 'error', message: '游戏服务器未连接' }))
      return
    }
    const l = this.local
    switch (msg.type) {
      case 'create_room': l.createRoom(msg.nickname, msg.avatar, msg.config); break
      case 'join_room': l.joinRoom(msg.roomId, msg.nickname, msg.avatar); break
      case 'quick_match': l.quickMatch(msg.nickname, msg.avatar); break
      case 'leave_room': break
      case 'ready': l.setReady(msg.ready); break
      case 'start_game': l.start(); break
      case 'discard': l.discard(msg.tile); break
      case 'action': l.action(msg.action, msg.tiles); break
      case 'draw': break
    }
  }

  /** 本地模式下“过”后需要主动推进回合 */
  localPass() {
    if (!isRemoteGame) this.local.passAndContinue()
  }
  localNextRound() {
    if (!isRemoteGame) this.local.nextRound()
  }

  /** 本地模式：是否已有房间状态 */
  hasLocalState() {
    return !isRemoteGame && this.local.hasState()
  }
  /** 本地模式：离开房间时清空状态 */
  resetLocal() {
    if (!isRemoteGame) this.local.reset()
  }

  disconnect() {
    this.ws?.close()
    this.ws = undefined
  }
}

export const gameClient = new GameClient()
