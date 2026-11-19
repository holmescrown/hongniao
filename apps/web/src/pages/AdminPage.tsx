import { useEffect, useState } from 'react'
import TopBar from '../components/TopBar'
import { useAuth } from '../store/authStore'
import { useToast } from '../store/toastStore'
import { listAllProfiles, adminUpdateProfile } from '../lib/auth'
import type { Profile } from '../lib/auth'

export default function AdminPage() {
  const { profile } = useAuth()
  const toast = useToast((s) => s.show)
  const [users, setUsers] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Profile | null>(null)
  const [form, setForm] = useState({ currency: 0, roomcard: 0, banned: false, is_admin: false })

  const reload = async () => {
    setLoading(true)
    const list = await listAllProfiles()
    setUsers(list)
    setLoading(false)
  }
  useEffect(() => { if (profile?.is_admin) reload() }, [profile])

  if (!profile?.is_admin) {
    return <div className="app-shell"><TopBar title="后台管理" /><div className="page-wrap"><div className="page-container"><div className="empty-hint">⛔ 你没有管理员权限</div></div></div></div>
  }

  const openEdit = (u: Profile) => {
    setEditing(u)
    setForm({ currency: u.currency, roomcard: u.roomcard, banned: u.banned, is_admin: u.is_admin })
  }
  const save = async () => {
    if (!editing) return
    const err = await adminUpdateProfile(editing.id, form)
    if (err) toast(err)
    else { toast('保存成功'); setEditing(null); reload() }
  }

  return (
    <div className="app-shell">
      <TopBar title="后台管理" />
      <div className="page-wrap">
        <div className="page-container">
          <div className="page-title">运营管理系统</div>
          <div className="stat-cards" style={{ gridTemplateColumns: 'repeat(4,1fr)', marginBottom: 20 }}>
            <div className="panel stat-card"><div className="num">{users.length}</div><div className="label">注册用户</div></div>
            <div className="panel stat-card"><div className="num">{users.reduce((s, u) => s + u.games, 0)}</div><div className="label">总对局</div></div>
            <div className="panel stat-card"><div className="num">{users.reduce((s, u) => s + u.currency, 0).toLocaleString()}</div><div className="label">流通金币</div></div>
            <div className="panel stat-card"><div className="num">{users.filter((u) => u.banned).length}</div><div className="label">封禁账号</div></div>
          </div>
          <div className="panel" style={{ padding: 16, overflowX: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <span style={{ color: 'var(--gold-300)', fontWeight: 700 }}>用户列表</span>
              <button className="btn ghost sm" onClick={reload}>刷新</button>
            </div>
            {loading ? <div className="empty-hint">加载中…</div> : (
              <table className="data-table">
                <thead><tr><th>用户名</th><th>金币</th><th>房卡</th><th>对局/胜</th><th>状态</th><th>角色</th><th>操作</th></tr></thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id}>
                      <td>{u.username}</td>
                      <td style={{ color: 'var(--gold-300)' }}>{u.currency?.toLocaleString()}</td>
                      <td>{u.roomcard}</td>
                      <td>{u.games} / {u.wins}</td>
                      <td><span className={`badge ${u.banned ? 'banned' : 'normal'}`}>{u.banned ? '已封禁' : '正常'}</span></td>
                      <td><span className={`badge ${u.is_admin ? 'admin' : 'normal'}`}>{u.is_admin ? '管理员' : '玩家'}</span></td>
                      <td><button className="btn ghost sm" onClick={() => openEdit(u)}>编辑</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {editing && (
        <div className="modal-mask" onClick={() => setEditing(null)}>
          <div className="modal panel" onClick={(e) => e.stopPropagation()}>
            <h3>编辑用户 · {editing.username}</h3>
            <label>金币</label><input type="number" value={form.currency} onChange={(e) => setForm({ ...form, currency: Number(e.target.value) })} />
            <label>房卡</label><input type="number" value={form.roomcard} onChange={(e) => setForm({ ...form, roomcard: Number(e.target.value) })} />
            <label style={{ marginTop: 14 }}><input type="checkbox" checked={form.is_admin} onChange={(e) => setForm({ ...form, is_admin: e.target.checked })} style={{ width: 'auto', marginRight: 8 }} />设为管理员</label>
            <label><input type="checkbox" checked={form.banned} onChange={(e) => setForm({ ...form, banned: e.target.checked })} style={{ width: 'auto', marginRight: 8 }} />封禁账号</label>
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setEditing(null)}>取消</button>
              <button className="btn gold" onClick={save}>保存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
