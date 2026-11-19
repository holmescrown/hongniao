// 麻将牌工具：牌编码 W1-9万 / T1-9条 / B1-9筒 / Z1中 Z2发 Z3白

export const TILE_SUIT: Record<string, 'wan' | 'tiao' | 'tong' | 'zi'> = {}
for (let i = 1; i <= 9; i++) {
  TILE_SUIT[`W${i}`] = 'wan'
  TILE_SUIT[`T${i}`] = 'tiao'
  TILE_SUIT[`B${i}`] = 'tong'
}
TILE_SUIT['Z1'] = 'zi'
TILE_SUIT['Z2'] = 'zi'
TILE_SUIT['Z3'] = 'zi'

const CN_NUM: Record<number, string> = { 1: '一', 2: '二', 3: '三', 4: '四', 5: '五', 6: '六', 7: '七', 8: '八', 9: '九' }
const ZI_NAME: Record<string, string> = { Z1: '中', Z2: '发', Z3: '白' }

export function tileLabel(tile: string): string {
  const suit = TILE_SUIT[tile]
  const n = parseInt(tile.slice(1), 10)
  if (suit === 'wan') return CN_NUM[n]
  if (suit === 'zi') return ZI_NAME[tile]
  return ''
}

export function tileSuitName(tile: string): string {
  return { wan: '万', tiao: '条', tong: '筒', zi: '' }[TILE_SUIT[tile]] ?? ''
}

export function createDeck(): string[] {
  const deck: string[] = []
  for (let i = 1; i <= 9; i++) {
    for (const p of ['W', 'T', 'B']) for (let k = 0; k < 4; k++) deck.push(`${p}${i}`)
  }
  for (const z of ['Z1', 'Z2', 'Z3']) for (let k = 0; k < 4; k++) deck.push(z)
  return deck
}

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** 标准胡牌判断：4 面子 + 1 将，支持七对子 */
export function canHu(hand: string[], winTile?: string): boolean {
  const tiles = winTile ? [...hand, winTile] : [...hand]
  if (tiles.length !== 14) return false
  const count: Record<string, number> = {}
  tiles.forEach((t) => (count[t] = (count[t] ?? 0) + 1))

  // 七对子
  if (tiles.length === 14 && Object.values(count).every((c) => c === 2 || c === 4) &&
      Object.values(count).filter((c) => c === 2 || c === 4).length >= 7) {
    // 4 张可拆两对
    const pairs = Object.values(count).reduce((s, c) => s + Math.floor(c / 2), 0)
    if (pairs === 7) return true
  }

  const keys = Object.keys(count).sort()
  for (const pair of keys) {
    if (count[pair] < 2) continue
    count[pair] -= 2
    if (canFormMelds(count, 4)) {
      count[pair] += 2
      return true
    }
    count[pair] += 2
  }
  return false
}

function canFormMelds(count: Record<string, number>, need: number): boolean {
  if (need === 0) return Object.values(count).every((c) => c === 0)
  const key = Object.keys(count).find((k) => count[k] > 0)
  if (!key) return false
  // 刻子
  if (count[key] >= 3) {
    count[key] -= 3
    if (canFormMelds(count, need - 1)) { count[key] += 3; return true }
    count[key] += 3
  }
  // 顺子（仅数牌，同花色连续）
  const suit = key[0]
  const num = parseInt(key.slice(1), 10)
  if (suit !== 'Z' && num <= 7) {
    const k2 = `${suit}${num + 1}`, k3 = `${suit}${num + 2}`
    if ((count[k2] ?? 0) > 0 && (count[k3] ?? 0) > 0) {
      count[key]--; count[k2]--; count[k3]--
      if (canFormMelds(count, need - 1)) { count[key]++; count[k2]++; count[k3]++; return true }
      count[key]++; count[k2]++; count[k3]++
    }
  }
  return false
}

export function sortHand(hand: string[]): string[] {
  const order: Record<string, number> = {}
  let idx = 0
  for (const p of ['W', 'T', 'B']) for (let i = 1; i <= 9; i++) order[`${p}${i}`] = idx++
  for (const z of ['Z1', 'Z2', 'Z3']) order[z] = idx++
  return [...hand].sort((a, b) => (order[a] ?? 99) - (order[b] ?? 99))
}

export function canPeng(hand: string[], tile: string): boolean {
  return hand.filter((t) => t === tile).length >= 2
}
export function canGang(hand: string[], tile: string): boolean {
  return hand.filter((t) => t === tile).length >= 3
}
