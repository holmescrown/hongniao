import { useNavigate } from 'react-router-dom'
import { useAuth } from '../store/authStore'
import { IMG } from '../lib/assets'

export default function TopBar({ title }: { title?: string }) {
  const nav = useNavigate()
  const { profile, logout } = useAuth()
  return (
    <div className="topbar">
      <button className="btn ghost sm" onClick={() => nav('/lobby')}>‹ 返回大厅</button>
      <div className="brand">
        <img src={IMG.logo} alt="白城麻将" />
        {title && <span>{title}</span>}
      </div>
      <div className="spacer" />
      <div className="stat-pill"><span className="dot" /> 金币 {profile?.currency?.toLocaleString() ?? 0}</div>
      <div className="stat-pill" style={{ color: '#a9e6c0' }}><span className="dot" style={{ background: '#5fd393', boxShadow: '0 0 8px #5fd393' }} /> 房卡 {profile?.roomcard ?? 0}</div>
      <button className="user-chip" onClick={() => nav('/profile')}>
        <span className="avatar">{profile?.avatar ?? '😀'}</span>
        <span>{profile?.username ?? '玩家'}</span>
        {profile?.is_admin && <span className="badge admin" style={{ marginLeft: 4 }}>管理</span>}
      </button>
      <button className="btn ghost sm" onClick={async () => { await logout(); nav('/login') }}>退出</button>
    </div>
  )
}
