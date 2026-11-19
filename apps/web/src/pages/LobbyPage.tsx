import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import TopBar from '../components/TopBar'
import { IMG } from '../lib/assets'
import { gameClient, type PlayMode } from '../lib/gameClient'
import { AI_LEVELS, type AiLevel } from '../lib/localGame'
import { useAuth } from '../store/authStore'
import { useToast } from '../store/toastStore'
import type { RoomConfig } from '../lib/protocol'

const ROOMS = [
  { id: 'R001', name: '新手欢乐场', level: '初级', cls: 'tag-easy', base: 1, bg: IMG.roomNormal, players: 2 },
  { id: 'R002', name: '老友竞技场', level: '中级', cls: 'tag-mid', base: 5, bg: IMG.roomMiddle, players: 3 },
  { id: 'R003', name: '高手过招场', level: '高级', cls: 'tag-high', base: 20, bg: IMG.roomHigh, players: 1 },
]

export default function LobbyPage() {
  const nav = useNavigate()
  const { profile } = useAuth()
  const toast = useToast((s) => s.show)
  const [showCreate, setShowCreate] = useState(false)
  const [cfg, setCfg] = useState<RoomConfig>({ name: '我的房间', maxPlayers: 4, baseScore: 1, allowChi: false })
  const [mode, setModeState] = useState<PlayMode>(
    () => (localStorage.getItem('redbird_mode') as PlayMode) || 'online'
  )
  const [aiLevel, setAiLevelState] = useState<AiLevel>(
    () => (localStorage.getItem('redbird_ai_level') as AiLevel) || 'pro'
  )

  const pickMode = (m: PlayMode) => {
    setModeState(m)
    localStorage.setItem('redbird_mode', m)
  }
  const pickLevel = (lv: AiLevel) => {
    setAiLevelState(lv)
    localStorage.setItem('redbird_ai_level', lv)
  }

  const enter = (config: RoomConfig) => {
    if (!profile) return
    const roomId = config.name === '快速匹配'
      ? Math.random().toString(36).slice(2, 6).toUpperCase()
      : config.name.replace(/[^A-Za-z0-9\u4e00-\u9fa5]/g, '').slice(0, 8) || Math.random().toString(36).slice(2, 6).toUpperCase()
    sessionStorage.setItem('redbird_room_id', roomId)
    const nickname = profile.username
    const avatar = typeof profile.avatar === 'number' ? profile.avatar : 0
    // 持久化本人身份，供房间页使用（避免 profile 异步加载导致昵称不一致而重复入座）
    sessionStorage.setItem('redbird_my_nick', nickname)
    sessionStorage.setItem('redbird_my_avatar', String(avatar))
    // 标记“刚从大厅进入”：建房消息由 client 的 pending 队列在连接建立后补发，
    // 房间页据此跳过 join_room，避免同一玩家重复入座；刷新时该标记仍在但组件需重连。
    sessionStorage.setItem('redbird_room_fresh', '1')
    // 运行时设定模式与难度
    gameClient.setMode(mode, mode === 'local' ? aiLevel : undefined)
    gameClient.connect(roomId)
    if (config.name === '快速匹配') gameClient.send({ type: 'quick_match', nickname, avatar })
    else gameClient.send({ type: 'create_room', nickname, avatar, config })
    sessionStorage.setItem('redbird_room_cfg', JSON.stringify(config))
    nav('/room')
  }

  const levelDesc = AI_LEVELS.find((l) => l.id === aiLevel)?.desc ?? ''

  return (
    <div className="app-shell">
      <TopBar />
      <div className="lobby" style={{ backgroundImage: `url(${IMG.lobbyBg})` }}>
        <div className="lobby-inner">
          <div className="lobby-heading">游戏大厅</div>

          {/* 模式切换 */}
          <div className="mode-switch">
            <button className={`mode-tab ${mode === 'online' ? 'active' : ''}`} onClick={() => pickMode('online')}>
              🌐 联机对战 <span>真人对战</span>
            </button>
            <button className={`mode-tab ${mode === 'local' ? 'active' : ''}`} onClick={() => pickMode('local')}>
              🤖 单机练习 <span>AI 陪玩</span>
            </button>
          </div>

          <div className="lobby-desc">
            {mode === 'online'
              ? '在线实时对战 · 与其他玩家同场竞技'
              : `单机对战 · 电脑难度【${AI_LEVELS.find((l) => l.id === aiLevel)?.name}】`}
          </div>

          {/* 单机难度选择 */}
          {mode === 'local' && (
            <div className="level-picker">
              <span className="level-picker-label">电脑等级</span>
              <div className="level-options">
                {AI_LEVELS.map((lv) => (
                  <button
                    key={lv.id}
                    className={`level-chip ${aiLevel === lv.id ? 'active' : ''}`}
                    onClick={() => pickLevel(lv.id)}
                    title={lv.desc}
                  >{lv.name}</button>
                ))}
              </div>
              <span className="level-desc">{levelDesc}</span>
            </div>
          )}

          <div className="action-bar">
            <button className="btn gold lg" onClick={() => enter({ name: '快速匹配', maxPlayers: 4, baseScore: 1, allowChi: false })}>⚡ 快速开始</button>
            <button className="btn lg" onClick={() => setShowCreate(true)}>＋ 创建房间</button>
            <button className="btn ghost lg" onClick={() => toast(mode === 'online'
              ? '联机说明：大众麻将 120 张牌，同域实时对战，房间内玩家同步'
              : `单机说明：${levelDesc}`)}>📖 玩法说明</button>
          </div>
          <div className="room-grid">
            {ROOMS.map((r) => (
              <div className="room-card" key={r.id} onClick={() => enter({ name: r.name, maxPlayers: 4, baseScore: r.base, allowChi: false })}>
                <div className="rc-bg" style={{ backgroundImage: `url(${r.bg})` }} />
                <div className="rc-body">
                  <div className="rc-name">{r.name}</div>
                  <span className={`rc-tag ${r.cls}`}>{r.level}</span>
                  <div className="rc-meta"><span>底分 <b>{r.base}</b></span><span>人数 <b>{r.players}/4</b></span></div>
                  <div className="rc-players">
                    {Array.from({ length: 4 }, (_, i) => <i key={i} className={i < r.players ? '' : 'empty'}>{i < r.players ? '🙂' : ''}</i>)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {showCreate && (
        <div className="modal-mask" onClick={() => setShowCreate(false)}>
          <div className="modal panel" onClick={(e) => e.stopPropagation()}>
            <h3>创建房间</h3>
            <label>房间名称</label>
            <input value={cfg.name} onChange={(e) => setCfg({ ...cfg, name: e.target.value })} />
            <label>游戏人数</label>
            <select value={cfg.maxPlayers} onChange={(e) => setCfg({ ...cfg, maxPlayers: Number(e.target.value) })}>
              <option value={4}>4 人场</option>
              <option value={2}>2 人场</option>
            </select>
            <label>底分</label>
            <select value={cfg.baseScore} onChange={(e) => setCfg({ ...cfg, baseScore: Number(e.target.value) })}>
              <option value={1}>1 分</option><option value={5}>5 分</option><option value={20}>20 分</option>
            </select>
            {mode === 'local' && (
              <>
                <label>电脑等级</label>
                <select value={aiLevel} onChange={(e) => pickLevel(e.target.value as AiLevel)}>
                  {AI_LEVELS.map((lv) => <option key={lv.id} value={lv.id}>{lv.name} · {lv.desc}</option>)}
                </select>
              </>
            )}
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setShowCreate(false)}>取消</button>
              <button className="btn gold" onClick={() => { setShowCreate(false); enter(cfg) }}>创建并进入</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
