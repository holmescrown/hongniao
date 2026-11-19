// 房间 Durable Object：每个房间一个实例，串行处理所有WebSocket消息，天然无锁

import { DurableObject } from 'cloudflare:workers'
import type { ActionOption, ClientMessage, Env, GameResult, Meld, RoomConfig, RoomPhase, RoomState, ServerMessage, Tile } from './types'
import {
  canChi,
  canGang,
  canHu,
  canPeng,
  chiCombos,
  computeFans,
  createDeck,
  deal,
  findConcealedGang,
  shuffle,
} from './mahjong'

interface Player {
  id: string
  ws: WebSocket | null
  nickname: string
  avatar: number
  ready: boolean
  hand: Tile[]
  melds: Meld[]
  online: boolean
  score: number
}

type PlayerAction = 'peng' | 'gang' | 'hu' | 'chi' | 'pass' | 'ting'

/** 等待别人响应某张打出的牌 */
interface PendingClaim {
  fromId: string
  tile: Tile
  responders: Set<string>
}

const DEFAULT_CONFIG: RoomConfig = {
  name: '白城麻将',
  maxPlayers: 4,
  baseScore: 1,
  allowChi: true,
}

export class RoomDurableObject extends DurableObject<Env> {
  private readonly state: DurableObjectState
  private roomId = ''
  private players: Player[] = [] // 按入座顺序保存，turnIndex 即此数组下标
  private hostId = ''
  private phase: RoomPhase = 'waiting'
  private dealerIndex = 0
  private turnIndex = 0
  private config: RoomConfig = { ...DEFAULT_CONFIG }
  private round = 0
  private lastDiscard?: { playerId: string; tile: Tile }
  private deck: Tile[] = []
  private drawTiles = new Map<string, Tile>() // 各玩家刚摸到的牌
  private options = new Map<string, ActionOption[]>() // 各玩家可操作提示
  private pending: PendingClaim | null = null
  private sessions = new Map<WebSocket, string>() // ws -> playerId

  constructor(state: DurableObjectState, env: Env) {
    super(state, env)
    this.state = state
  }

  // -------------------------------------------------------------------------
  // HTTP / WebSocket 升级
  // -------------------------------------------------------------------------
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const roomId = url.searchParams.get('roomId')
    if (roomId && !this.roomId) this.roomId = roomId
    if (!this.roomId) this.roomId = 'default'

    if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
      const { 0: client, 1: server } = new WebSocketPair()
      // 接受 WebSocket；playerId 在识别消息到达后用 serializeAttachment 写入
      this.state.acceptWebSocket(server)
      return new Response(null, { status: 101, webSocket: client })
    }

    return new Response(
      JSON.stringify({ ok: true, service: 'redbird-mahjong-room', roomId: this.roomId, phase: this.phase }),
      { headers: { 'content-type': 'application/json' } },
    )
  }

  // -------------------------------------------------------------------------
  // WebSocket 事件回调
  // -------------------------------------------------------------------------
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    try {
      const raw = typeof message === 'string' ? message : new TextDecoder().decode(message)
      const msg = JSON.parse(raw) as ClientMessage
      const player = this.playerFor(ws)

      switch (msg.type) {
        case 'create_room':
        case 'join_room':
        case 'quick_match':
          this.identify(ws, msg)
          return
        case 'leave_room':
          if (player) this.leave(ws, player)
          return
      }

      // 以下操作必须先入座
      if (!player) {
        this.sendError(ws, '请先加入房间')
        return
      }

      switch (msg.type) {
        case 'ready':
          player.ready = msg.ready
          this.broadcast()
          return
        case 'start_game':
          this.startGame(ws, player)
          return
        case 'discard':
          this.discard(ws, player, msg.tile)
          return
        case 'draw':
          // 服务端已自动摸牌，这里仅回推当前状态
          this.broadcast()
          return
        case 'action':
          this.handleAction(ws, player, msg.action, msg.tiles)
          return
      }
    } catch (err) {
      this.sendError(ws, `服务器错误：${err instanceof Error ? err.message : String(err)}`)
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const player = this.playerFor(ws)
    if (player) this.leave(ws, player)
    else this.sessions.delete(ws)
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    const player = this.playerFor(ws)
    if (player) this.leave(ws, player)
    else this.sessions.delete(ws)
  }

  // -------------------------------------------------------------------------
  // 入座 / 重连
  // -------------------------------------------------------------------------
  private identify(ws: WebSocket, msg: Extract<ClientMessage, { type: 'create_room' | 'join_room' | 'quick_match' }>): void {
    // 同名离线玩家重连：复活原座位（保留 playerId 与分数）
    let player = this.players.find((p) => p.nickname === msg.nickname && !p.online)
    if (player) {
      player.ws = ws
      player.online = true
    } else {
      if (this.phase === 'playing') {
        this.sendError(ws, '对局进行中，暂时无法加入')
        return
      }
      if (this.players.filter((p) => p.online).length >= this.config.maxPlayers) {
        this.sendError(ws, '房间已满')
        return
      }
      player = {
        id: crypto.randomUUID(),
        ws,
        nickname: msg.nickname,
        avatar: msg.avatar,
        ready: false,
        hand: [],
        melds: [],
        online: true,
        score: 0,
      }
      this.players.push(player)
      if (msg.type === 'create_room' && msg.config) this.config = this.normalizeConfig(msg.config)
    }

    this.sessions.set(ws, player.id)
    this.setAttachment(ws, player.id)
    if (!this.hostId || !this.players.some((p) => p.id === this.hostId && p.online)) {
      this.hostId = player.id
    }
    this.broadcast()
  }

  private normalizeConfig(raw: RoomConfig): RoomConfig {
    return {
      name: raw.name || DEFAULT_CONFIG.name,
      maxPlayers: raw.maxPlayers === 2 ? 2 : 4,
      baseScore: raw.baseScore > 0 ? Math.floor(raw.baseScore) : 1,
      allowChi: raw.allowChi !== false,
    }
  }

  private leave(ws: WebSocket, player: Player): void {
    player.online = false
    player.ws = null
    this.sessions.delete(ws)
    this.options.delete(player.id)

    if (this.pending?.responders.has(player.id)) {
      this.pending.responders.delete(player.id)
      if (this.pending.responders.size === 0) {
        this.pending = null
        if (this.phase === 'playing') this.advanceTurnAndDraw()
      }
    }
    if (player.id === this.hostId) {
      this.hostId = this.players.find((p) => p.online)?.id ?? ''
    }
    // 全员离线：重置房间，允许下一批玩家重新开始
    if (this.players.every((p) => !p.online)) this.resetRoom()
    else this.broadcast()
  }

  private resetRoom(): void {
    this.phase = 'waiting'
    this.players = []
    this.hostId = ''
    this.dealerIndex = 0
    this.turnIndex = 0
    this.round = 0
    this.deck = []
    this.lastDiscard = undefined
    this.pending = null
    this.options.clear()
    this.drawTiles.clear()
    this.sessions.clear()
  }

  // -------------------------------------------------------------------------
  // 开局 / 摸牌 / 回合流转
  // -------------------------------------------------------------------------
  private startGame(ws: WebSocket, host: Player): void {
    if (host.id !== this.hostId) {
      this.sendError(ws, '只有房主可以开始游戏')
      return
    }
    // 等待中或上一局结束后均可开新局（分数累计保留）
    if (this.phase !== 'waiting' && this.phase !== 'over') {
      this.sendError(ws, '当前不能开始游戏')
      return
    }
    if (this.players.length < 2) {
      this.sendError(ws, '至少需要 2 名玩家')
      return
    }
    if (!this.players.every((p) => p.ready)) {
      this.sendError(ws, '还有玩家未准备')
      return
    }

    const deck = shuffle(createDeck())
    const { hands, remaining } = deal(deck, this.players.length)
    this.deck = remaining
    this.round += 1
    this.dealerIndex = (this.round - 1) % this.players.length
    this.turnIndex = this.dealerIndex
    this.lastDiscard = undefined
    this.pending = null
    this.options.clear()
    this.drawTiles.clear()

    this.players.forEach((p, i) => {
      p.hand = hands[i]
      p.melds = []
      p.ready = false
    })
    this.phase = 'playing'

    // 庄家起手 14 张，最后一张视为“摸到”的牌
    const dealer = this.players[this.dealerIndex]
    this.drawTiles.set(dealer.id, dealer.hand[dealer.hand.length - 1])
    this.refreshSelfOptions(dealer)
    this.broadcast()
  }

  private nextIndex(from: number): number {
    if (this.players.length === 0) return 0
    return ((from % this.players.length) + this.players.length) % this.players.length
  }

  /** 从 from 开始找下一个在线玩家的下标 */
  private nextOnlineIndex(from: number): number {
    for (let step = 0; step < this.players.length; step++) {
      const idx = this.nextIndex(from + step)
      if (this.players[idx].online) return idx
    }
    return this.nextIndex(from)
  }

  private indexOf(player: Player): number {
    return this.players.findIndex((p) => p.id === player.id)
  }

  /** 轮到玩家摸牌；牌堆空则流局 */
  private advanceTurnAndDraw(): void {
    this.pending = null
    this.options.clear()
    if (this.phase !== 'playing') return

    this.turnIndex = this.nextOnlineIndex(this.turnIndex + 1)
    const player = this.players[this.turnIndex]
    if (!player) return

    const drawn = this.deck.pop()
    if (!drawn) {
      this.endDrawGame()
      return
    }
    player.hand.push(drawn)
    this.drawTiles.set(player.id, drawn)
    this.refreshSelfOptions(player)
    this.broadcast()
  }

  /** 自己回合：计算自摸 / 暗杠 / 过 的提示 */
  private refreshSelfOptions(player: Player): void {
    const opts: ActionOption[] = []
    if (canHu(player.hand)) opts.push({ type: 'hu' })
    const gang = findConcealedGang(player.hand)
    if (gang) opts.push({ type: 'gang', tiles: [gang] })
    if (opts.length > 0) {
      opts.push({ type: 'pass' })
      this.options.set(player.id, opts)
    } else {
      this.options.delete(player.id)
    }
  }

  // -------------------------------------------------------------------------
  // 出牌与响应
  // -------------------------------------------------------------------------
  private discard(ws: WebSocket, player: Player, tile: Tile): void {
    if (this.phase !== 'playing') {
      this.sendError(ws, '当前不在对局中')
      return
    }
    if (this.players[this.turnIndex]?.id !== player.id) {
      this.sendError(ws, '还没轮到你出牌')
      return
    }
    const idx = player.hand.indexOf(tile)
    if (idx === -1) {
      this.sendError(ws, '手牌中没有这张牌')
      return
    }
    player.hand.splice(idx, 1)
    this.drawTiles.delete(player.id)
    this.options.clear()
    this.lastDiscard = { playerId: player.id, tile }
    this.collectResponses(player, tile)
  }

  /** 按 胡 > 碰/杠 > 吃 的优先级收集响应者 */
  private collectResponses(from: Player, tile: Tile): void {
    const huPlayers: Player[] = []
    const pengPlayers: Player[] = []
    const fromIdx = this.indexOf(from)
    for (let step = 1; step < this.players.length; step++) {
      const q = this.players[this.nextIndex(fromIdx + step)]
      if (!q.online || !q.ws) continue
      if (canHu(q.hand, tile)) huPlayers.push(q)
      else if (canGang(q.hand, tile) || canPeng(q.hand, tile)) pengPlayers.push(q)
    }

    // 吃只有下家可以，且受 config.allowChi 控制
    const next = this.players[this.nextIndex(fromIdx + 1)]
    const chiPlayers: Player[] = []
    if (this.config.allowChi && next && next.online && next.ws && next.id !== from.id && canChi(next.hand, tile)) {
      chiPlayers.push(next)
    }

    let responders: Player[]
    let makeOptions: (q: Player) => ActionOption[]
    if (huPlayers.length > 0) {
      responders = huPlayers
      makeOptions = () => [{ type: 'hu' }, { type: 'pass' }]
    } else if (pengPlayers.length > 0) {
      responders = pengPlayers
      makeOptions = (q) => {
        const opts: ActionOption[] = []
        if (canGang(q.hand, tile)) opts.push({ type: 'gang', tiles: [tile] })
        opts.push({ type: 'peng' }, { type: 'pass' })
        return opts
      }
    } else if (chiPlayers.length > 0) {
      responders = chiPlayers
      makeOptions = (q) => [
        ...chiCombos(q.hand, tile).map((c): ActionOption => ({ type: 'chi', tiles: c })),
        { type: 'pass' },
      ]
    } else {
      responders = []
      makeOptions = () => []
    }

    if (responders.length === 0) {
      this.advanceTurnAndDraw()
      return
    }
    this.pending = { fromId: from.id, tile, responders: new Set(responders.map((q) => q.id)) }
    for (const q of responders) this.options.set(q.id, makeOptions(q))
    this.broadcast()
  }

  private handleAction(ws: WebSocket, player: Player, action: PlayerAction, tiles?: Tile[]): void {
    if (this.phase !== 'playing') {
      this.sendError(ws, '当前不在对局中')
      return
    }

    // 正在等待响应别人打出的牌
    if (this.pending?.responders.has(player.id)) {
      this.handleResponse(player, action, tiles)
      return
    }

    // 自己回合：自摸 / 暗杠 / 放弃提示
    if (this.players[this.turnIndex]?.id === player.id) {
      if (action === 'hu') {
        const winTile = this.drawTiles.get(player.id) ?? player.hand[player.hand.length - 1] ?? ''
        this.settleHu(player, winTile, true)
        return
      }
      if (action === 'gang') {
        const tile = tiles?.[0] ?? findConcealedGang(player.hand)
        if (!tile) {
          this.sendError(ws, '没有可以杠的牌')
          return
        }
        this.doConcealedGang(player, tile, ws)
        return
      }
      if (action === 'pass' || action === 'ting') {
        this.options.delete(player.id)
        this.broadcast()
        return
      }
    }
    this.sendError(ws, '当前无法执行该操作')
  }

  private handleResponse(player: Player, action: PlayerAction, tiles?: Tile[]): void {
    const pending = this.pending
    if (!pending) return
    const tile = pending.tile
    const from = this.players.find((p) => p.id === pending.fromId)

    if (action === 'pass' || action === 'ting' || !from) {
      pending.responders.delete(player.id)
      this.options.delete(player.id)
      if (pending.responders.size === 0) {
        this.pending = null
        this.advanceTurnAndDraw()
      } else {
        this.broadcast()
      }
      return
    }

    if (action === 'hu') {
      this.settleHu(player, tile, false)
      return
    }

    // 碰/杠/吃：打出的牌被消耗，清除响应状态，由该玩家接管回合
    this.pending = null
    this.options.clear()
    this.lastDiscard = undefined
    switch (action) {
      case 'peng':
        this.doClaimPeng(player, from, tile)
        break
      case 'gang':
        this.doClaimGang(player, from, tile)
        break
      case 'chi':
        this.doClaimChi(player, from, tile, tiles)
        break
    }
  }

  private removeFromHand(player: Player, tile: Tile, count: number): boolean {
    let removed = 0
    player.hand = player.hand.filter((t) => {
      if (t === tile && removed < count) {
        removed++
        return false
      }
      return true
    })
    return removed === count
  }

  private doClaimPeng(player: Player, from: Player, tile: Tile): void {
    if (!this.removeFromHand(player, tile, 2)) {
      this.advanceTurnAndDraw()
      return
    }
    player.melds.push({ type: 'peng', tiles: [tile, tile, tile], from: from.id })
    this.turnIndex = this.indexOf(player)
    this.drawTiles.delete(player.id)
    this.broadcast()
  }

  private doClaimGang(player: Player, from: Player, tile: Tile): void {
    if (!this.removeFromHand(player, tile, 3)) {
      this.advanceTurnAndDraw()
      return
    }
    player.melds.push({ type: 'gang', tiles: [tile, tile, tile, tile], from: from.id })
    this.turnIndex = this.indexOf(player)
    const drawn = this.deck.pop()
    if (!drawn) {
      this.endDrawGame()
      return
    }
    player.hand.push(drawn)
    this.drawTiles.set(player.id, drawn)
    this.refreshSelfOptions(player)
    this.broadcast()
  }

  private doClaimChi(player: Player, from: Player, tile: Tile, tiles?: Tile[]): void {
    const combos = chiCombos(player.hand, tile)
    let pair = tiles && tiles.length === 2 ? tiles : combos[0]
    if (!pair || !pair.every((t) => player.hand.includes(t))) pair = combos[0]
    if (!pair) {
      this.advanceTurnAndDraw()
      return
    }
    for (const t of pair) {
      const i = player.hand.indexOf(t)
      if (i >= 0) player.hand.splice(i, 1)
    }
    player.melds.push({ type: 'chi', tiles: [...pair, tile], from: from.id })
    this.turnIndex = this.indexOf(player)
    this.drawTiles.delete(player.id)
    this.broadcast()
  }

  /** 暗杠：自己回合用手牌中 4 张相同牌开杠并补牌 */
  private doConcealedGang(player: Player, tile: Tile, ws: WebSocket): void {
    if (!this.removeFromHand(player, tile, 4)) {
      this.sendError(ws, '暗杠失败')
      return
    }
    player.melds.push({ type: 'gang', tiles: [tile, tile, tile, tile] })
    this.options.delete(player.id)
    const drawn = this.deck.pop()
    if (!drawn) {
      this.endDrawGame()
      return
    }
    player.hand.push(drawn)
    this.drawTiles.set(player.id, drawn)
    this.refreshSelfOptions(player)
    this.broadcast()
  }

  // -------------------------------------------------------------------------
  // 结算
  // -------------------------------------------------------------------------
  private settleHu(winner: Player, winTile: Tile, selfDraw: boolean): void {
    const fans = computeFans(winner.hand, winTile, winner.melds, selfDraw)
    const total = fans.reduce((sum, f) => sum + f.score, 0)
    const base = this.config.baseScore > 0 ? this.config.baseScore : 1
    const totalScore = total * base
    const others = this.players.filter((p) => p.id !== winner.id)
    const per = others.length > 0 ? Math.round(totalScore / others.length) : totalScore

    const scores: Record<string, number> = {}
    for (const p of this.players) {
      const delta = p.id === winner.id ? per * others.length : -per
      scores[p.id] = delta
      p.score += delta
    }

    this.phase = 'over'
    this.pending = null
    this.options.clear()
    this.drawTiles.clear()
    const result: GameResult = { winnerId: winner.id, winTile, fans, totalScore, scores }
    this.sendGameOver(result)
  }

  /** 流局 */
  private endDrawGame(): void {
    this.phase = 'over'
    this.pending = null
    this.options.clear()
    this.drawTiles.clear()
    const scores: Record<string, number> = {}
    for (const p of this.players) scores[p.id] = 0
    this.sendGameOver({ winnerId: '', winTile: '', fans: [{ name: '流局', score: 0 }], totalScore: 0, scores })
  }

  private sendGameOver(result: GameResult): void {
    for (const p of this.players) {
      if (p.ws && p.online) this.send(p.ws, { type: 'game_over', result, room: this.buildRoom(p) })
    }
  }

  // -------------------------------------------------------------------------
  // 广播 / 工具
  // -------------------------------------------------------------------------
  /** 按连接单独下发：myHand / myDraw / myOptions 只发给本人，绝不泄露他人手牌 */
  private broadcast(): void {
    for (const p of this.players) {
      if (p.ws && p.online) this.send(p.ws, { type: 'room_state', room: this.buildRoom(p), youId: p.id })
    }
  }

  private buildRoom(viewer: Player): RoomState {
    return {
      roomId: this.roomId,
      phase: this.phase,
      config: this.config,
      hostId: this.hostId,
      seats: this.players.map((p, i) => ({
        id: p.id,
        nickname: p.nickname,
        avatar: p.avatar,
        ready: p.ready,
        online: p.online,
        isDealer: i === this.dealerIndex,
        score: p.score,
        handCount: p.hand.length,
        melds: p.melds,
      })),
      turnIndex: this.turnIndex,
      dealerIndex: this.dealerIndex,
      lastDiscard: this.lastDiscard,
      myHand: this.phase === 'waiting' ? undefined : [...viewer.hand],
      myDraw: this.drawTiles.get(viewer.id),
      myOptions: this.options.get(viewer.id),
      round: this.round,
    }
  }

  private playerFor(ws: WebSocket): Player | undefined {
    const id = this.sessions.get(ws) ?? this.readAttachment(ws)?.playerId
    return id ? this.players.find((p) => p.id === id) : undefined
  }

  private setAttachment(ws: WebSocket, playerId: string): void {
    try {
      ws.serializeAttachment({ playerId })
    } catch {
      // 旧运行时可能不支持，sessions Map 作为兜底
    }
  }

  private readAttachment(ws: WebSocket): { playerId?: string } | undefined {
    try {
      return ws.deserializeAttachment() as { playerId?: string } | undefined
    } catch {
      return undefined
    }
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    try {
      ws.send(JSON.stringify(msg))
    } catch {
      // 连接已断开，交由 webSocketClose 处理
    }
  }

  private sendError(ws: WebSocket, message: string): void {
    this.send(ws, { type: 'error', message })
  }
}
