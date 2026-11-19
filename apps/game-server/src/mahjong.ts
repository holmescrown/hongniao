// 麻将核心纯函数（不依赖 Cloudflare API）
// 牌型：W1..W9 万、T1..T9 条、B1..B9 筒、Z1中 Z2发 Z3白，共 30 种、每种 4 张 = 120 张

import type { Meld, Tile } from './types'

export interface Fan {
  name: string
  score: number
}

export interface DealResult {
  hands: Tile[][]
  remaining: Tile[]
}

/** 牌面 -> 0..29 的下标。万 0-8、条 9-17、筒 18-26、字 27-29 */
function tileIndex(tile: Tile): number {
  const suit = tile.charAt(0)
  const num = Number.parseInt(tile.slice(1), 10) - 1
  const base = suit === 'W' ? 0 : suit === 'T' ? 9 : suit === 'B' ? 18 : 27
  return base + num
}

/** 下标 -> 牌面 */
function indexTile(i: number): Tile {
  const suits = ['W', 'T', 'B', 'Z']
  return suits[Math.floor(i / 9)] + ((i % 9) + 1)
}

/** 生成 120 张牌 */
export function createDeck(): Tile[] {
  const deck: Tile[] = []
  const suits = ['W', 'T', 'B']
  for (const suit of suits) {
    for (let n = 1; n <= 9; n++) {
      for (let copy = 0; copy < 4; copy++) deck.push(`${suit}${n}`)
    }
  }
  for (const honor of ['Z1', 'Z2', 'Z3']) {
    for (let copy = 0; copy < 4; copy++) deck.push(honor)
  }
  return deck
}

/** Fisher-Yates 洗牌（原地打乱并返回） */
export function shuffle<T>(deck: T[]): T[] {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = deck[i]
    deck[i] = deck[j]
    deck[j] = tmp
  }
  return deck
}

/** 发牌：庄家 14 张，其余 13 张 */
export function deal(deck: Tile[], playerCount: number): DealResult {
  const hands: Tile[][] = []
  for (let p = 0; p < playerCount; p++) {
    const size = p === 0 ? 14 : 13
    hands.push(deck.splice(0, size))
  }
  return { hands, remaining: deck }
}

/** 统计成 int[30] 计数表 */
function toCounts(tiles: Tile[]): number[] {
  const counts = new Array<number>(30).fill(0)
  for (const t of tiles) {
    const i = tileIndex(t)
    if (i >= 0 && i < 30) counts[i]++
  }
  return counts
}

/**
 * 递归判断剩余牌能否全部拆成面子（刻子或顺子）。
 * 取第一张非0牌：它只能作为刻子起点或顺子起点，否则就无法被消耗——
 * 这是胡牌拆分的标准贪心+回溯算法，正确且不会漏解。
 */
function canFormMelds(counts: number[]): boolean {
  const first = counts.findIndex((c) => c > 0)
  if (first === -1) return true // 全部消耗完，成功

  // 尝试刻子（三张相同）
  if (counts[first] >= 3) {
    counts[first] -= 3
    if (canFormMelds(counts)) {
      counts[first] += 3
      return true
    }
    counts[first] += 3
  }

  // 尝试顺子：仅数牌（下标 < 27）且不能跨花色（同花色连续3张）
  if (first < 27 && first % 9 <= 6 && counts[first + 1] > 0 && counts[first + 2] > 0) {
    counts[first]--
    counts[first + 1]--
    counts[first + 2]--
    if (canFormMelds(counts)) {
      counts[first]++
      counts[first + 1]++
      counts[first + 2]++
      return true
    }
    counts[first]++
    counts[first + 1]++
    counts[first + 2]++
  }

  return false
}

/** 七对子判断（四张相同可拆成两对） */
function isSevenPairs(counts: number[]): boolean {
  let pairs = 0
  for (const c of counts) {
    if (c === 2) pairs++
    else if (c === 4) pairs += 2
    else if (c !== 0) return false
  }
  return pairs === 7
}

/**
 * 胡牌判断：标准 4 面子 + 1 将，或七对子。
 * @param hand 手牌（通常已含摸到的牌）
 * @param winTile 若是吃胡/点炮，传入别人打出的那张牌（会被临时加入计算）
 */
export function canHu(hand: Tile[], winTile?: Tile): boolean {
  const counts = toCounts(hand)
  if (winTile) counts[tileIndex(winTile)]++
  const total = counts.reduce((a, b) => a + b, 0)

  // 胡牌张数必为 3k+2（14 / 11 / 8 …），最多 14
  if (total === 0 || total % 3 !== 2 || total > 14) return false

  // 七对子（仅 14 张时成立）
  if (total === 14 && isSevenPairs(counts)) return true

  // 标准型：枚举每种牌做将（对子），剩余递归拆面子
  for (let i = 0; i < 30; i++) {
    if (counts[i] >= 2) {
      counts[i] -= 2
      const ok = canFormMelds(counts)
      counts[i] += 2
      if (ok) return true
    }
  }
  return false
}

/** 能否碰：手牌中该牌 >= 2 张 */
export function canPeng(hand: Tile[], tile: Tile): boolean {
  return toCounts(hand)[tileIndex(tile)] >= 2
}

/** 能否杠（明杠/加杠）：手牌中该牌 >= 3 张 */
export function canGang(hand: Tile[], tile: Tile): boolean {
  return toCounts(hand)[tileIndex(tile)] >= 3
}

/** 手牌中是否存在可暗杠的牌（某牌 >= 4 张），返回该牌 */
export function findConcealedGang(hand: Tile[]): Tile | undefined {
  const counts = toCounts(hand)
  for (let i = 0; i < 30; i++) {
    if (counts[i] >= 4) return indexTile(i)
  }
  return undefined
}

/**
 * 返回吃牌的所有可能组合（每种组合为「手牌中需打出的两张」）。
 * 字牌不能吃；不能跨花色（如 W8 W9 不能吃 W9 组成的顺子）。
 */
export function chiCombos(hand: Tile[], tile: Tile): Tile[][] {
  const t = tileIndex(tile)
  if (t >= 27) return [] // 字牌不能吃
  const counts = toCounts(hand)
  const combos: Tile[][] = []
  const inSuit = (i: number): boolean => i >= 0 && i < 27 && Math.floor(i / 9) === Math.floor(t / 9)

  const patterns: Array<[number, number]> = [
    [t - 2, t - 1], // 吃 1-2-3 中的 3
    [t - 1, t + 1], // 吃中间张
    [t + 1, t + 2], // 吃 1-2-3 中的 1
  ]
  for (const [a, b] of patterns) {
    if (!inSuit(a) || !inSuit(b)) continue
    if (counts[a] > 0 && counts[b] > 0) {
      combos.push([indexTile(a), indexTile(b)])
    }
  }
  return combos
}

/** 能否吃 */
export function canChi(hand: Tile[], tile: Tile): boolean {
  return chiCombos(hand, tile).length > 0
}

/** 是否全部为同一花色（不含字牌） */
function isAllOneSuit(tiles: Tile[]): boolean {
  if (tiles.length === 0) return false
  const suit = tiles[0].charAt(0)
  if (suit === 'Z') return false
  return tiles.every((t) => t.charAt(0) === suit)
}

/** 能否全部拆成刻子 + 一对将（碰碰和） */
function isAllTriplets(tiles: Tile[]): boolean {
  const counts = toCounts(tiles)
  let pairs = 0
  for (const c of counts) {
    if (c === 0) continue
    if (c % 3 === 2) pairs++
    else if (c % 3 !== 0) return false
  }
  return pairs === 1 // 恰好一个对子（将），其余全是刻子
}

/** 计算番数 */
export function computeFans(
  hand: Tile[],
  winTile: Tile | undefined,
  melds: Meld[],
  selfDraw = false,
): Fan[] {
  // 自摸时 winTile 已在手牌中；点炮时需临时加入
  const concealed = selfDraw ? [...hand] : winTile ? [...hand, winTile] : [...hand]
  const allTiles = [...concealed, ...melds.flatMap((m) => m.tiles)]
  const fans: Fan[] = []

  if (isAllOneSuit(allTiles)) fans.push({ name: '清一色', score: 24 })
  if (melds.length === 0 && isSevenPairs(toCounts(concealed))) fans.push({ name: '七对', score: 24 })
  if (isAllTriplets(concealed) && melds.every((m) => m.type !== 'chi')) {
    fans.push({ name: '碰碰和', score: 6 })
  }
  if (melds.length === 0) fans.push({ name: '门清', score: 1 })
  if (selfDraw) fans.push({ name: '自摸', score: 1 })

  // 基础平胡保底
  fans.push({ name: '平胡', score: 1 })
  return fans
}
