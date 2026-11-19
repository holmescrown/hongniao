// 前后端 WebSocket 通信协议契约（服务端副本，与 web/src/lib/protocol.ts 保持一致）

export type Tile = string // 如 W1..W9 万, T1..T9 条, B1..B9 筒, Z1中 Z2发 Z3白

export interface PlayerSeat {
  id: string
  nickname: string
  avatar: number
  ready: boolean
  online: boolean
  isDealer: boolean
  score: number
  handCount: number
  melds: Meld[]
}

export interface Meld {
  type: 'peng' | 'gang' | 'chi'
  tiles: Tile[]
  from?: string
}

export interface RoomConfig {
  name: string
  maxPlayers: number // 2 或 4
  baseScore: number
  allowChi: boolean
}

export type RoomPhase = 'waiting' | 'playing' | 'over'

export interface RoomState {
  roomId: string
  phase: RoomPhase
  config: RoomConfig
  hostId: string
  seats: PlayerSeat[]
  turnIndex: number // 当前谁的回合（seats 下标）
  dealerIndex: number
  lastDiscard?: { playerId: string; tile: Tile }
  /** 仅发给本人的私牌（服务端按连接单独下发） */
  myHand?: Tile[]
  myDraw?: Tile
  /** 可操作提示 */
  myOptions?: ActionOption[]
  round: number
}

export interface ActionOption {
  type: 'peng' | 'gang' | 'hu' | 'chi' | 'pass' | 'ting'
  tiles?: Tile[]
}

// 客户端 -> 服务端
export type ClientMessage =
  | { type: 'create_room'; nickname: string; avatar: number; config: RoomConfig }
  | { type: 'join_room'; roomId: string; nickname: string; avatar: number }
  | { type: 'quick_match'; nickname: string; avatar: number }
  | { type: 'leave_room' }
  | { type: 'ready'; ready: boolean }
  | { type: 'start_game' }
  | { type: 'discard'; tile: Tile }
  | { type: 'draw' } // 摸牌（若服务端不自动摸）
  | { type: 'action'; action: 'peng' | 'gang' | 'hu' | 'chi' | 'pass' | 'ting'; tiles?: Tile[] }

// 服务端 -> 客户端
export type ServerMessage =
  | { type: 'room_state'; room: RoomState; youId: string }
  | { type: 'error'; message: string }
  | { type: 'game_over'; result: GameResult; room: RoomState }
  | { type: 'pong' }

export interface GameResult {
  winnerId: string
  winTile: Tile
  fans: { name: string; score: number }[]
  totalScore: number
  scores: Record<string, number> // 各玩家本局增减
}

// Worker 环境绑定
export interface Env {
  ROOM: DurableObjectNamespace
  MAX_ROOMS: string
}
