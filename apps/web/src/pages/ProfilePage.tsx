import TopBar from '../components/TopBar'
import { useAuth } from '../store/authStore'

export default function ProfilePage() {
  const { profile } = useAuth()
  if (!profile) return null
  const records: any[] = Array.isArray((profile as any).record_data) ? (profile as any).record_data : []
  const winRate = profile.games ? Math.round((profile.wins / profile.games) * 100) : 0
  return (
    <div className="app-shell">
      <TopBar title="个人中心" />
      <div className="page-wrap">
        <div className="page-container">
          <div className="page-title">个人中心</div>
          <div className="profile-grid">
            <div className="panel profile-card">
              <div className="big-avatar">{typeof profile.avatar === 'number' ? '😀' : profile.avatar}</div>
              <div className="p-name">{profile.username}</div>
              <div className="p-id">ID: {profile.id}</div>
              <div className="divider" />
              <div style={{ color: '#c8b795', fontSize: 13, lineHeight: 1.9, textAlign: 'left' }}>
                <div>🎮 总对局：<b style={{ color: '#f5d98a' }}>{profile.games}</b></div>
                <div>🏆 胜场：<b style={{ color: '#f5d98a' }}>{profile.wins}</b></div>
                <div>📈 胜率：<b style={{ color: '#f5d98a' }}>{winRate}%</b></div>
                {profile.is_admin && <div style={{ color: '#ef9a8a' }}>🛡️ 管理员账号</div>}
              </div>
            </div>
            <div>
              <div className="stat-cards">
                <div className="panel stat-card"><div className="num">{profile.currency?.toLocaleString()}</div><div className="label">💰 金币</div></div>
                <div className="panel stat-card"><div className="num">{profile.roomcard}</div><div className="label">🎫 房卡</div></div>
                <div className="panel stat-card"><div className="num">{profile.games}</div><div className="label">🎮 总对局</div></div>
                <div className="panel stat-card"><div className="num">{winRate}%</div><div className="label">🏆 胜率</div></div>
              </div>
              <div className="panel record-list" style={{ padding: 16, marginTop: 20 }}>
                <div style={{ color: 'var(--gold-300)', fontWeight: 700, marginBottom: 10 }}>最近战绩</div>
                {records.length === 0 ? (
                  <div className="empty-hint">暂无战绩，快去大厅玩几局吧</div>
                ) : records.slice(0, 8).map((r: any, i: number) => (
                  <div className="record-row" key={i}><span>{r.time ?? `第${i + 1}局`}</span><span>{r.result ?? '—'}</span></div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
