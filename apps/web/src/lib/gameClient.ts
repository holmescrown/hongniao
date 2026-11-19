// 游戏客户端：联机模式走 WebSocket（默认同域 /ws -> Pages Function -> Durable Object）；
// 单机模式走本地引擎（可选 AI 难度）。模式由用户在运行时显式选择，联机失败明确报错、不静默降级。
import type { ClientMessage, ServerMessage, RoomConfig, RoomState } from './protocol'
import { LocalGameEngine, type AiLevel } from './localGame'

export type PlayMode = 'online' | 'local'

// 远端地址：优先用环境变量（Vercel 部署或自定义域名场景），否则用同域 /ws（CF Pages 场景，绕开 workers.dev DNS 污染）
const configured = (import.meta.env.VITE_GAME_SERVER_URL ?? '').trim().replace(/\/$/, '')
const sameOrigin = typeof location !== 'undefined' ? `${location.protocol}//${location.host}` : ''
const WS_BASE = configured || sameOrigin

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
  /** 当前模式，默认联机；用户可在大厅切换 */
  private modeValue: PlayMode = 'online'
  private connectSeq = 0
  private pending: ClientMessage[] = []

  get mode(): PlayMode { return this.modeValue }
  isRemote() { return this.modeValue === 'online' }
  /** 是否配置了可用的联机地址 */
  hasServer() { return Boolean(WS_BASE) }

  /** 运行时切换模式并设定单机 AI 难度 */
  setMode(mode: PlayMode, aiLevel?: AiLevel) {
    this.modeValue = mode
    if (mode === 'online') {
      // 切回联机：断开本地订阅，准备重连
      if (this.unsubLocal) { this.unsubLocal(); this.unsubLocal = undefined }
    } else {
      // 切到单机：断开 WS，设定难度，建立本地订阅
      try { this.ws?.close() } catch { /* 忽略 */ }
      this.ws = undefined
      this.local.setAiLevel(aiLevel ?? 'pro')
      this.connectSeq++
      this.pending = []
      this.ensureLocal()
    }
  }

  private ensureLocal() {
    if (!this.unsubLocal) {
      this.unsubLocal = this.local.subscribe((m) => this.handlers.forEach((h) => h(m)))
    }
  }

  subscribe(h: Handler) {
    this.handlers.add(h)
    if (!this.isRemote()) this.ensureLocal()
    return () => { this.handlers.delete(h) }
  }

  connect(roomId?: string) {
    if (!this.isRemote()) { this.ensureLocal(); return }
    if (!WS_BASE) {
      this.handlers.forEach((h) => h({ type: 'error', message: '未配置游戏服务器地址，请切换到单机模式' }))
      return
    }
    if (this.ws?.readyState === WebSocket.OPEN) return
    try { this.ws?.close() } catch { /* 忽略 */ }

    const seq = ++this.connectSeq
    const proto = WS_BASE.startsWith('https') ? 'wss' : 'ws'
    const host = WS_BASE.replace(/^https?:\/\//, '').replace(/\/$/, '')
    const rid = roomId || sessionStorage.getItem('redbird_room_id') || 'default'
    sessionStorage.setItem('redbird_room_id', rid)
    // 同域场景连 ${host}/ws；若环境变量已带路径则直接用
    const path = configured && /\/ws$/.test(configured) ? '' : '/ws'

    const ws = new WebSocket(`${proto}://${host}${path}?roomId=${encodeURIComponent(rid)}`)
    this.ws = ws
    let settled = false

    const timer = window.setTimeout(() => {
      if (seq === this.connectSeq && !settled && ws.readyState !== WebSocket.OPEN) {
        settled = true
        this.handlers.forEach((h) => h({ type: 'error', message: '联机服务器连接超时，请检查网络或切换为单机模式' }))
      }
    }, 5000)

    ws.onopen = () => {
      settled = true
      window.clearTimeout(timer)
      const queued = this.pending.splice(0)
      queued.forEach((m) => ws.send(JSON.stringify(m)))
    }
    ws.onerror = () => {
      window.clearTimeout(timer)
      if (seq === this.connectSeq && !settled) {
        settled = true
        this.handlers.forEach((h) => h({ type: 'error', message: '联机服务器不可用，请检查网络或切换为单机模式' }))
      }
    }
    ws.onclose = () => { window.clearTimeout(timer) }
    ws.onmessage = (e) => {
      try {
        const m = JSON.parse(e.data) as ServerMessage
        this.handlers.forEach((h) => h(m))
      } catch { /* 忽略非法消息 */ }
    }
  }

  send(msg: ClientMessage) {
    if (this.isRemote()) {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(msg))
      } else {
        // 连接尚未建立：暂存，onopen 后补发
        this.pending.push(msg)
        if (this.ws?.readyState !== WebSocket.CONNECTING && !this.ws) {
          this.handlers.forEach((h) => h({ type: 'error', message: '尚未连接游戏服务器' }))
        }
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

  localPass() {
    if (!this.isRemote()) this.local.passAndContinue()
  }
  localNextRound() {
    if (!this.isRemote()) this.local.nextRound()
  }
  hasLocalState() {
    return !this.isRemote() && this.local.hasState()
  }
  resetLocal() {
    if (!this.isRemote()) this.local.reset()
  }
  disconnect() {
    try { this.ws?.close() } catch { /* 忽略 */ }
    this.ws = undefined
  }
}

export const gameClient = new GameClient()
