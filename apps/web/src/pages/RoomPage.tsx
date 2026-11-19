import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import TopBar from '../components/TopBar'
import MahjongTile from '../components/MahjongTile'
import { IMG } from '../lib/assets'
import { gameClient } from '../lib/gameClient'
import type { RoomState, PlayerSeat, GameResult } from '../lib/protocol'
import { useToast } from '../store/toastStore'
import { useAuth } from '../store/authStore'

export default function RoomPage() {
  const nav = useNavigate()
  const toast = useToast((s) => s.show)
  const { profile } = useAuth()
  const [room, setRoom] = useState<RoomState | null>(null)
  const [youId, setYouId] = useState('')
  const [result, setResult] = useState<GameResult | null>(null)
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    const nick = () => profile?.username ?? '我'
    const av = () => (typeof profile?.avatar === 'number' ? (profile.avatar as number) : 0)

    // 本地模式开局：大厅阶段的建房消息早于本页订阅而被丢弃，故补发一次，
    // 保证当前订阅者能收到 room_state。重复建局只会把房间重置为 waiting，无副作用。
    const initLocalGame = () => {
      const cfg = JSON.parse(sessionStorage.getItem('redbird_room_cfg') || 'null')
      window.setTimeout(() => {
        if (cfg && cfg.name !== '快速匹配') {
          gameClient.send({ type: 'create_room', nickname: nick(), avatar: av(), config: cfg })
        } else {
          gameClient.send({ type: 'quick_match', nickname: nick(), avatar: av() })
        }
      }, 60)
    }

    let initedLocal = false
    const unsub = gameClient.subscribe((m) => {
      if (m.type === 'room_state') { setRoom(m.room); setYouId(m.youId) }
      else if (m.type === 'error') toast(m.message)
      else if (m.type === 'game_over') { setResult(m.result); setRoom(m.room) }
    })
    // 联机失败自动降级为本地时，补发一局本地游戏（降级提示已由 error 消息给出）
    const unsubMode = gameClient.onModeChange(() => {
      if (initedLocal) return
      initedLocal = true
      initLocalGame()
      // 快速匹配场景：降级后自动开局，用户无需再点“开始游戏”
      const cfg = JSON.parse(sessionStorage.getItem('redbird_room_cfg') || 'null')
      if (!cfg || cfg.name === '快速匹配') {
        window.setTimeout(() => gameClient.send({ type: 'start_game' }), 350)
      }
    })

    gameClient.connect()

    if (!gameClient.isRemote()) {
      // 未配置远端地址：直接本地模式
      initedLocal = true
      initLocalGame()
    } else {
      // 远端模式刷新重连：带房间号重新入座（若期间降级为本地则跳过）
      const roomId = sessionStorage.getItem('redbird_room_id')
      if (roomId) {
        window.setTimeout(() => {
          if (gameClient.isRemote()) {
            gameClient.send({ type: 'join_room', roomId, nickname: nick(), avatar: av() })
          }
        }, 250)
      }
    }
    return () => { unsub(); unsubMode() }
  }, [])

  const mySeat = room?.seats.find((s) => s.id === youId)
  const isMyTurn = room?.phase === 'playing' && room.seats[room.turnIndex]?.id === youId
  const opts = room?.myOptions ?? []

  const doDiscard = () => {
    if (!selected) return toast('请先点选一张牌')
    const tile = selected.split('-')[0]
    gameClient.send({ type: 'discard', tile })
    setSelected(null)
  }
  const doAction = (a: string, tiles?: string[]) => {
    gameClient.send({ type: 'action', action: a as any, tiles })
    if (a === 'pass') gameClient.localPass()
  }
  const startGame = () => gameClient.send({ type: 'start_game' })
  const ready = (v: boolean) => gameClient.send({ type: 'ready', ready: v })
  const leaveRoom = () => {
    gameClient.send({ type: 'leave_room' })
    gameClient.resetLocal()
    sessionStorage.removeItem('redbird_room_cfg')
    nav('/lobby')
  }

  const others = room?.seats.filter((s) => s.id !== youId) ?? []
  const seatPos = ['left', 'top', 'right']

  return (
    <div className="app-shell">
      <TopBar title={room ? `${room.config.name} · 第${room.round}局` : '游戏中'} />
      <div className="game-room">
        <div className="table-area" style={{ backgroundImage: `url(${IMG.tableBg})` }}>
          <div className="table-wrap">
            {others.slice(0, 3).map((s, i) => (
              <SeatView key={s.id} seat={s} pos={seatPos[i]} active={room?.seats[room.turnIndex]?.id === s.id} />
            ))}
            <div className="table-center">
              <div className="round-num">牌局进行中</div>
              <div className="discard-area">
                {room?.lastDiscard && <MahjongTile tile={room.lastDiscard.tile} small />}
              </div>
            </div>
          </div>

          {room?.phase === 'waiting' && (
            <div className="overlay">
              <div className="panel result-card">
                <div className="result-title win">房间已就绪</div>
                <div style={{ color: '#e0cfae', fontSize: 14, margin: '10px 0 18px' }}>房间号：<b style={{ color: 'var(--gold-300)' }}>{room.roomId}</b> · {room.config.maxPlayers} 人场 · 底分 {room.config.baseScore}</div>
                <div className="divider" />
                {room.seats.map((s) => (
                  <div key={s.id} className="score-row"><span>{s.id === youId ? '我' : s.nickname}</span><span>{s.ready ? '✅ 已准备' : '⏳ 等待中'}</span></div>
                ))}
                <div style={{ marginTop: 20, display: 'flex', gap: 10, justifyContent: 'center' }}>
                  <button className="btn ghost" onClick={() => leaveRoom()}>离开房间</button>
                  {mySeat && !mySeat.ready && <button className="btn gold" onClick={() => ready(true)}>准备</button>}
                  {mySeat?.ready && room.hostId === youId && <button className="btn gold" onClick={startGame}>开始游戏</button>}
                </div>
              </div>
            </div>
          )}

          {result && (
            <div className="overlay">
              <div className="panel result-card">
                <div className={`result-title ${result.winnerId === youId ? 'win' : 'lose'}`}>
                  {result.winnerId === youId ? '胡牌啦！' : '本局结束'}
                </div>
                <div style={{ color: '#e0cfae', fontSize: 14 }}>赢家：<b style={{ color: 'var(--gold-300)' }}>{room?.seats.find((s) => s.id === result.winnerId)?.nickname}</b></div>
                <div className="fan-list">{result.fans.map((f) => `${f.name} +${f.score}`).join(' · ')}</div>
                <div className="divider" />
                {room?.seats.map((s) => {
                  const sc = result.scores[s.id] ?? 0
                  return <div key={s.id} className="score-row"><span>{s.id === youId ? '我' : s.nickname}</span><span className={sc >= 0 ? 'score-plus' : 'score-minus'}>{sc >= 0 ? '+' : ''}{sc}</span></div>
                })}
                <div style={{ marginTop: 20, display: 'flex', gap: 10, justifyContent: 'center' }}>
                  <button className="btn gold" onClick={() => { setResult(null); gameClient.localNextRound() }}>再来一局</button>
                  <button className="btn ghost" onClick={() => leaveRoom()}>返回大厅</button>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="my-hand-bar">
          <div className="action-buttons">
            {opts.length > 0 ? (
              <>
                {opts.map((o) => (
                  <button key={o.type} className={`btn sm ${o.type === 'hu' ? 'gold' : o.type === 'pass' ? 'ghost' : 'green'}`}
                    onClick={() => doAction(o.type, o.tiles)}>
                    {({ peng: '碰', gang: '杠', hu: '胡', chi: '吃', pass: '过', ting: '听' } as any)[o.type]}
                  </button>
                ))}
              </>
            ) : (
              <span className="tip-text">{isMyTurn ? '轮到你了，请选择一张牌打出' : '等待其他玩家出牌…'}</span>
            )}
          </div>
          <div className="hand-tiles">
            {(room?.myHand ?? []).map((t, i) => (
              <MahjongTile key={`${t}-${i}`} tile={t} selectable={isMyTurn} selected={selected === `${t}-${i}`}
                onClick={() => isMyTurn && setSelected(selected === `${t}-${i}` ? null : `${t}-${i}`)} />
            ))}
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn gold" disabled={!isMyTurn || !selected} onClick={doDiscard}>出 牌</button>
            <button className="btn ghost sm" onClick={() => toast('提示功能：即将开放')}>💡 提示</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function SeatView({ seat, pos, active }: { seat: PlayerSeat; pos: string; active: boolean }) {
  return (
    <div className={`seat ${pos} ${active ? 'active' : ''}`}>
      <div className="seat-avatar" style={{ position: 'relative' }}>
        {seat.avatar}
        {seat.isDealer && <span className="dealer-badge">庄</span>}
        {seat.ready && <span className="ready-badge">准备</span>}
      </div>
      <div className="seat-name">{seat.nickname} · {seat.online ? '🟢' : '⚫'}</div>
      <div className="seat-tiles">
        {Array.from({ length: Math.min(seat.handCount, 13) }, (_, i) => <MahjongTile key={i} tile="" back small />)}
      </div>
    </div>
  )
}
