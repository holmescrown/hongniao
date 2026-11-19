// 游戏客户端：优先连 CF Worker WebSocket；连不上时自动降级为本地引擎（AI 陪玩）
import type { ClientMessage, ServerMessage, RoomConfig, RoomState } from './protocol'
import { LocalGameEngine } from './localGame'

const WS_URL = (import.meta.env.VITE_GAME_SERVER_URL ?? '').replace(/\/$/, '')
/** 构建期是否配置了远端地址（仅作展示/兼容，实际是否有效以 gameClient.isRemote() 为准） */
export const isRemoteGame = Boolean(WS_URL)

export interface GameClientEvents {
  onState: (room: RoomState, youId: string) => void
  onError: (message: string) => void
  onGameOver: (result: any, room: RoomState) => void
}

type Handler = (m: ServerMessage) => void
type ModeListener = () => void

class GameClient {
  private ws?: WebSocket
  private local = new LocalGameEngine()
  private handlers = new Set<Handler>()
  private modeListeners = new Set<ModeListener>()
  private unsubLocal?: () => void
  /** 运行期实际模式：远端连不上会翻转为 false */
  private usingRemote = isRemoteGame
  /** 连接序列号，避免旧连接的回调误触发降级 */
  private connectSeq = 0
  /** 连接建立前暂存的指令，onopen 后按序补发 */
  private pending: ClientMessage[] = []

  readonly mode: 'remote' | 'local' = isRemoteGame ? 'remote' : 'local'

  /** 当前是否真的在联机（降级后返回 false） */
  isRemote() {
    return this.usingRemote
  }

  /** 监听联机→本地的降级，供页面重新开局 */
  onModeChange(cb: ModeListener) {
    this.modeListeners.add(cb)
    return () => { this.modeListeners.delete(cb) }
  }

  private ensureLocal() {
    if (!this.unsubLocal) {
      this.unsubLocal = this.local.subscribe((m) => this.handlers.forEach((h) => h(m)))
    }
  }

  /** 远端不可用时切换到本地引擎，并通知页面补发本地开局 */
  private fallbackToLocal(reason: string) {
    if (!this.usingRemote) return
    this.usingRemote = false
    this.connectSeq++
    this.pending = []
    try { this.ws?.close() } catch { /* 忽略关闭异常 */ }
    this.ws = undefined
    this.ensureLocal()
    this.handlers.forEach((h) => h({ type: 'error', message: `${reason}，已切换为本地 AI 模式，可继续游戏` }))
    this.modeListeners.forEach((h) => h())
  }

  subscribe(h: Handler) {
    this.handlers.add(h)
    if (!this.usingRemote) this.ensureLocal()
    return () => { this.handlers.delete(h) }
  }

  connect(roomId?: string) {
    if (!this.usingRemote) { this.ensureLocal(); return }
    // 已经连上则不再重复建连
    if (this.ws?.readyState === WebSocket.OPEN) return
    try { this.ws?.close() } catch { /* 忽略 */ }

    const seq = ++this.connectSeq
    const proto = WS_URL.startsWith('https') ? 'wss' : 'ws'
    const host = WS_URL.replace(/^https?:\/\//, '').replace(/\/$/, '')
    const rid = roomId || sessionStorage.getItem('redbird_room_id') || 'default'
    sessionStorage.setItem('redbird_room_id', rid)

    const ws = new WebSocket(`${proto}://${host}/ws?roomId=${encodeURIComponent(rid)}`)
    this.ws = ws
    let settled = false

    // 连接超时兜底（覆盖 onerror 不触发的情况，如 DNS 解析失败）
    const timer = window.setTimeout(() => {
      if (seq === this.connectSeq && !settled && ws.readyState !== WebSocket.OPEN) {
        settled = true
        this.fallbackToLocal('联机服务器连接超时')
      }
    }, 3000)

    ws.onopen = () => {
      settled = true
      window.clearTimeout(timer)
      // 补发连接建立前暂存的指令（如大厅的建房消息）
      const queued = this.pending.splice(0)
      queued.forEach((m) => ws.send(JSON.stringify(m)))
    }
    ws.onerror = () => {
      window.clearTimeout(timer)
      if (seq === this.connectSeq && !settled) {
        settled = true
        this.fallbackToLocal('联机服务器不可用')
      }
    }
    ws.onclose = () => {
      window.clearTimeout(timer)
      if (seq === this.connectSeq && this.usingRemote && !settled) {
        settled = true
        this.fallbackToLocal('联机服务器已断开')
      }
    }
    ws.onmessage = (e) => {
      try {
        const m = JSON.parse(e.data) as ServerMessage
        this.handlers.forEach((h) => h(m))
      } catch { /* 忽略非法消息 */ }
    }
  }

  send(msg: ClientMessage) {
    if (this.usingRemote) {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(msg))
      } else {
        // 连接尚未建立：暂存，onopen 后补发；若最终失败则由降级逻辑重新在本地开局
        this.pending.push(msg)
      }
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
    if (!this.usingRemote) this.local.passAndContinue()
  }
  localNextRound() {
    if (!this.usingRemote) this.local.nextRound()
  }

  /** 本地模式：是否已有房间状态 */
  hasLocalState() {
    return !this.usingRemote && this.local.hasState()
  }
  /** 本地模式：离开房间时清空状态 */
  resetLocal() {
    if (!this.usingRemote) this.local.reset()
  }

  disconnect() {
    try { this.ws?.close() } catch { /* 忽略 */ }
    this.ws = undefined
  }
}

export const gameClient = new GameClient()
