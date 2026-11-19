// 本地单机游戏引擎：无后端时模拟一桌麻将（本人 + 3 个 AI），对外行为与远端 WS 一致
import type { RoomState, PlayerSeat, RoomConfig, ServerMessage, GameResult, ActionOption } from './protocol'
import { createDeck, shuffle, sortHand, canHu, canPeng, canGang } from './tiles'

const AI_NAMES = ['老李', '王婶', '张大爷', '小赵']
const AI_AVATARS = [1, 2, 3, 4]

function uid() {
  return Math.random().toString(36).slice(2, 10)
}

export class LocalGameEngine {
  state!: RoomState
  youId = ''
  private hands: Record<string, string[]> = {}
  private deck: string[] = []
  private listeners = new Set<(m: ServerMessage) => void>()
  private timer?: number
  private config: RoomConfig = { name: '快速匹配', maxPlayers: 4, baseScore: 1, allowChi: false }

  subscribe(cb: (m: ServerMessage) => void) {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }
  private emit(m: ServerMessage) {
    this.listeners.forEach((cb) => cb(m))
  }
  private push() {
    const view: RoomState = { ...this.state }
    this.emit({ type: 'room_state', room: view, youId: this.youId })
  }
  private error(message: string) { this.emit({ type: 'error', message }) }

  createRoom(nickname: string, avatar: number, config?: RoomConfig) {
    this.youId = uid()
    this.config = config ?? this.config
    const me = this.makeSeat(this.youId, nickname || '我', avatar, true)
    const seats: PlayerSeat[] = [me]
    for (let i = 1; i < this.config.maxPlayers; i++) {
      seats.push(this.makeSeat(uid(), AI_NAMES[(i - 1) % AI_NAMES.length], AI_AVATARS[(i - 1) % 4], false))
    }
    this.state = {
      roomId: uid().toUpperCase().slice(0, 4),
      phase: 'waiting', config: this.config, hostId: this.youId, seats,
      turnIndex: 0, dealerIndex: 0, round: 1,
    }
    this.push()
  }

  joinRoom(roomId: string, nickname: string, avatar: number) {
    this.createRoom(nickname, avatar, this.config)
    this.state.roomId = roomId || this.state.roomId
    this.error('演示模式：已为你创建本地房间，AI 将自动陪玩')
  }

  quickMatch(nickname: string, avatar: number) {
    this.createRoom(nickname, avatar, this.config)
  }

  private makeSeat(id: string, nickname: string, avatar: number, host: boolean): PlayerSeat {
    return { id, nickname, avatar, ready: host, online: true, isDealer: false, score: 1000, handCount: 0, melds: [] }
  }

  setReady(ready: boolean) {
    const me = this.state.seats.find((s) => s.id === this.youId)
    if (me) me.ready = ready
    this.push()
    // AI 自动准备
    if (ready) {
      this.state.seats.forEach((s) => { if (s.id !== this.youId) s.ready = true })
      window.setTimeout(() => this.push(), 300)
    }
  }

  start() {
    if (this.state.phase !== 'waiting') return
    const deck = shuffle(createDeck())
    const n = this.state.seats.length
    const dealer = Math.floor(Math.random() * n)
    this.hands = {}
    this.state.seats.forEach((s, i) => {
      const cnt = i === dealer ? 14 : 13
      this.hands[s.id] = sortHand(deck.splice(0, cnt))
      s.handCount = this.hands[s.id].length
      s.isDealer = i === dealer
      s.melds = []
    })
    this.deck = deck
    this.state.phase = 'playing'
    this.state.dealerIndex = dealer
    this.state.turnIndex = dealer
    this.state.round = 1
    this.state.lastDiscard = undefined
    this.push()
    // 若庄家是 AI，让 AI 先出
    if (this.state.seats[dealer].id !== this.youId) this.scheduleAI()
  }

  private myView() {
    const hand = sortHand(this.hands[this.youId] ?? [])
    const opts: ActionOption[] = []
    const last = this.state.lastDiscard
    if (last && last.playerId !== this.youId) {
      if (canHu(hand, last.tile)) opts.push({ type: 'hu', tiles: [last.tile] })
      if (canGang(hand, last.tile)) opts.push({ type: 'gang', tiles: [last.tile] })
      if (canPeng(hand, last.tile)) opts.push({ type: 'peng', tiles: [last.tile] })
    }
    return { ...this.state, myHand: hand, myOptions: opts }
  }
  // push 时保证私牌只发给本人
  private pushWithHand() {
    this.emit({ type: 'room_state', room: this.myView(), youId: this.youId })
  }

  discard(tile: string) {
    const me = this.state.seats.find((s) => s.id === this.youId)
    if (!me || this.state.turnIndex !== this.state.seats.indexOf(me)) return this.error('还没轮到你出牌')
    const hand = this.hands[this.youId]
    const idx = hand.indexOf(tile)
    if (idx < 0) return this.error('手里没有这张牌')
    hand.splice(idx, 1)
    me.handCount = hand.length
    this.state.lastDiscard = { playerId: this.youId, tile }
    this.pushWithHand()
    this.scheduleAI()
  }

  action(action: 'peng' | 'gang' | 'hu' | 'chi' | 'pass' | 'ting', tiles?: string[]) {
    if (action === 'pass') { this.nextTurnAfterDiscard(); return }
    if (action === 'hu') { this.finishGame(this.youId, tiles?.[0] ?? ''); return }
    if (action === 'peng' && tiles?.[0]) {
      const t = tiles[0]
      const hand = this.hands[this.youId]
      for (let i = 0; i < 2; i++) { const k = hand.indexOf(t); if (k >= 0) hand.splice(k, 1) }
      const me = this.state.seats.find((s) => s.id === this.youId)!
      me.melds.push({ type: 'peng', tiles: [t, t, t] })
      me.handCount = hand.length
      this.state.turnIndex = this.state.seats.indexOf(me)
      this.pushWithHand()
    }
    if (action === 'gang' && tiles?.[0]) {
      const t = tiles[0]
      const hand = this.hands[this.youId]
      for (let i = 0; i < 3; i++) { const k = hand.indexOf(t); if (k >= 0) hand.splice(k, 1) }
      const me = this.state.seats.find((s) => s.id === this.youId)!
      me.melds.push({ type: 'gang', tiles: [t, t, t, t] })
      this.drawFor(this.youId)
      me.handCount = hand.length
      this.state.turnIndex = this.state.seats.indexOf(me)
      this.pushWithHand()
    }
  }

  private nextTurnAfterDiscard() {
    let next = (this.state.turnIndex + 1) % this.state.seats.length
    // 跳过已经胡完离场的（本 demo 不淘汰，直接轮转）
    this.state.turnIndex = next
    this.drawFor(this.state.seats[next].id)
    this.pushWithHandFor(this.state.seats[next].id)
    if (this.state.seats[next].id !== this.youId) this.scheduleAI()
  }

  private drawFor(playerId: string) {
    if (this.deck.length === 0) return
    const t = this.deck.shift()!
    this.hands[playerId] = sortHand([...(this.hands[playerId] ?? []), t])
    const s = this.state.seats.find((x) => x.id === playerId)
    if (s) s.handCount = this.hands[playerId].length
  }

  private pushWithHandFor(playerId: string) {
    if (playerId === this.youId) this.pushWithHand()
    else this.push()
  }

  private scheduleAI() {
    this.clearTimer()
    this.timer = window.setTimeout(() => {
      const seat = this.state.seats[this.state.turnIndex]
      if (!seat || seat.id === this.youId) return
      // AI 摸牌
      this.drawFor(seat.id)
      const hand = this.hands[seat.id]
      // AI 自摸胡
      if (hand.length === 14 && canHu(hand)) { this.finishGame(seat.id, hand[hand.length - 1]); return }
      // 简单策略：优先打出现有孤张（这里就打第一张非字牌，够用）
      const discard = hand.find((t) => t[0] !== 'Z') ?? hand[0]
      const idx = hand.indexOf(discard)
      if (idx >= 0) hand.splice(idx, 1)
      seat.handCount = hand.length
      this.state.lastDiscard = { playerId: seat.id, tile: discard }
      this.pushWithHand()
      // 检查我能否碰杠胡
      if (this.myView().myOptions?.length) {
        // 给玩家一点操作窗口，由前端弹按钮；这里先不自动过
        return
      }
      this.scheduleAI()
    }, 700)
  }

  private clearTimer() { if (this.timer) { window.clearTimeout(this.timer); this.timer = undefined } }

  private finishGame(winnerId: string, winTile: string) {
    this.clearTimer()
    this.state.phase = 'over'
    const winner = this.state.seats.find((s) => s.id === winnerId)
    const result: GameResult = {
      winnerId, winTile,
      fans: [{ name: winnerId === this.youId ? '自摸' : '平胡', score: 2 }],
      totalScore: 2 * (this.state.seats.length - 1),
      scores: Object.fromEntries(this.state.seats.map((s) => [s.id, s.id === winnerId ? 2 * (this.state.seats.length - 1) : -2])),
    }
    this.emit({ type: 'game_over', result, room: this.state })
  }

  /** 玩家在“可碰杠胡”提示出现后选择“过”，继续轮转 */
  passAndContinue() { this.nextTurnAfterDiscard() }

  nextRound() {
    this.clearTimer()
    this.state.phase = 'waiting'
    this.state.seats.forEach((s) => (s.ready = s.id === this.youId))
    this.push()
  }

  /** 是否已建立过房间状态（供页面判断是否补发开局消息） */
  hasState(): boolean { return Boolean(this.state) }

  /** 离开房间时清空状态，避免下次进入残留 */
  reset() {
    this.clearTimer()
    this.state = undefined as any
    this.youId = ''
    this.hands = {}
    this.deck = []
  }
}
