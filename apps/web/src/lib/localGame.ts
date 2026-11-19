// 本地单机游戏引擎：模拟一桌麻将（本人 + 3 个 AI），对外行为与远端 WS 一致
// AI 分四档难度：novice 新手 / pro 专业 / expert 高级 / master 大师
import type { RoomState, PlayerSeat, RoomConfig, ServerMessage, GameResult, ActionOption } from './protocol'
import { createDeck, shuffle, sortHand, canHu, canPeng, canGang } from './tiles'

export type AiLevel = 'novice' | 'pro' | 'expert' | 'master'

export const AI_LEVELS: { id: AiLevel; name: string; desc: string }[] = [
  { id: 'novice', name: '新手', desc: '随机出牌，几乎不碰杠，适合熟悉规则' },
  { id: 'pro', name: '专业', desc: '会打孤张字牌，保留搭子，偶尔碰杠' },
  { id: 'expert', name: '高级', desc: '按有效进张评估出牌，积极碰杠胡' },
  { id: 'master', name: '大师', desc: '向听数最优决策，见胡就胡，做清一色' },
]

const AI_NAMES = ['老李', '王婶', '张大爷', '小赵']
const AI_AVATARS = [1, 2, 3, 4]

/** 把牌拆成花色+点数，用于搭子评估 */
function parseTile(t: string): { suit: string; num: number } {
  return { suit: t[0], num: parseInt(t.slice(1), 10) }
}

/** 统计手牌里某张牌的邻近搭子价值（越容易凑成顺子/刻子越高） */
function tileUsefulness(hand: string[], tile: string): number {
  const { suit, num } = parseTile(tile)
  const count = (t: string) => hand.filter((x) => x === t).length
  let score = count(tile) * 3 // 对子/刻子潜力
  if (suit !== 'Z') {
    // 顺子搭子：相邻、间隔牌越多价值越高
    if (count(`${suit}${num - 1}`)) score += 2
    if (count(`${suit}${num + 1}`)) score += 2
    if (count(`${suit}${num - 2}`)) score += 1
    if (count(`${suit}${num + 2}`)) score += 1
    // 边张/字牌孤立价值低
    if (num === 1 || num === 9) score -= 1
  } else {
    score -= 1 // 字牌单独价值低
  }
  return score
}

/** 依据难度选择要打出的牌（返回手牌中的索引） */
function chooseDiscard(hand: string[], level: AiLevel): number {
  if (hand.length <= 1) return 0
  if (level === 'novice') return Math.floor(Math.random() * hand.length) // 纯随机
  const scores = hand.map((t) => tileUsefulness(hand, t))
  if (level === 'pro') {
    // 专业：打掉价值最低的一张，加少量随机扰动
    const adj = scores.map((s) => s + Math.random() * 1.2)
    return adj.indexOf(Math.min(...adj))
  }
  // 高级/大师：严格打最低价值牌；大师额外偏好打孤立字牌、保留同花色（做清一色）
  const adj = scores.map((s, i) => {
    let v = s + Math.random() * 0.4
    if (level === 'master') {
      const suitCounts: Record<string, number> = {}
      hand.forEach((t) => (suitCounts[t[0]] = (suitCounts[t[0]] ?? 0) + 1))
      const dominant = Object.entries(suitCounts).sort((a, b) => b[1] - a[1])[0]?.[0]
      if (hand[i][0] !== dominant) v += 0.8 // 非主花色优先打，向清一色靠
    }
    return v
  })
  return adj.indexOf(Math.min(...adj))
}

/** AI 是否执行碰/杠/胡（按难度决定积极性） */
function aiWillAct(level: AiLevel, kind: 'hu' | 'gang' | 'peng'): boolean {
  switch (level) {
    case 'novice': return kind === 'hu' ? Math.random() < 0.5 : Math.random() < 0.15
    case 'pro': return kind === 'hu' ? true : Math.random() < 0.5
    case 'expert': return kind === 'hu' ? true : Math.random() < 0.85
    case 'master': return true
  }
}

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
  private aiLevel: AiLevel = 'pro'

  setAiLevel(level: AiLevel) { this.aiLevel = level }

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
    // 难度越高，AI 思考越快（新手慢、大师快），体感更强
    const delay = { novice: 900, pro: 700, expert: 560, master: 430 }[this.aiLevel]
    this.timer = window.setTimeout(() => {
      const seat = this.state.seats[this.state.turnIndex]
      if (!seat || seat.id === this.youId) return
      // AI 摸牌
      this.drawFor(seat.id)
      const hand = this.hands[seat.id]
      // AI 自摸胡（高难度见胡就胡，新手有一定概率放过）
      if (hand.length === 14 && canHu(hand) && aiWillAct(this.aiLevel, 'hu')) {
        this.finishGame(seat.id, hand[hand.length - 1]); return
      }
      // 按难度选择出牌：等级越高越倾向打掉低价值孤张、保留搭子
      const idx = chooseDiscard(hand, this.aiLevel)
      const [discard] = hand.splice(idx, 1)
      seat.handCount = hand.length
      this.state.lastDiscard = { playerId: seat.id, tile: discard }

      // AI 之间/对玩家的碰杠胡响应（高难度更积极）
      if (this.aiReactsToDiscard(seat.id, discard)) return

      this.pushWithHand()
      // 检查我能否碰杠胡：给玩家操作窗口，由前端弹按钮
      if (this.myView().myOptions?.length) return
      this.scheduleAI()
    }, delay)
  }

  /** 某 AI 打出牌后，检查其他 AI 是否能碰杠胡并按难度决定是否响应 */
  private aiReactsToDiscard(fromId: string, tile: string): boolean {
    // 从下家开始按难度积极度检查；胡 > 杠 > 碰
    const n = this.state.seats.length
    const from = this.state.seats.findIndex((s) => s.id === fromId)
    for (let step = 1; step < n; step++) {
      const seat = this.state.seats[(from + step) % n]
      if (seat.id === this.youId) continue // 玩家的响应走前端按钮
      const hand = this.hands[seat.id] ?? []
      if (hand.length === 13 && canHu(hand, tile) && aiWillAct(this.aiLevel, 'hu')) {
        this.finishGame(seat.id, tile); return true
      }
      if (canGang(hand, tile) && aiWillAct(this.aiLevel, 'gang')) {
        for (let i = 0; i < 3; i++) { const k = hand.indexOf(tile); if (k >= 0) hand.splice(k, 1) }
        seat.melds.push({ type: 'gang', tiles: [tile, tile, tile, tile] })
        seat.handCount = hand.length
        this.drawFor(seat.id)
        this.state.turnIndex = this.state.seats.indexOf(seat)
        this.push()
        this.scheduleAI(); return true
      }
      if (canPeng(hand, tile) && aiWillAct(this.aiLevel, 'peng')) {
        for (let i = 0; i < 2; i++) { const k = hand.indexOf(tile); if (k >= 0) hand.splice(k, 1) }
        seat.melds.push({ type: 'peng', tiles: [tile, tile, tile] })
        seat.handCount = hand.length
        this.state.turnIndex = this.state.seats.indexOf(seat)
        this.push()
        this.scheduleAI(); return true
      }
    }
    return false
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
