import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../store/authStore'
import { useToast } from '../store/toastStore'
import { IMG } from '../lib/assets'

export default function LoginPage() {
  const nav = useNavigate()
  const { login, register, loading } = useAuth()
  const toast = useToast((s) => s.show)
  const [tab, setTab] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!username.trim() || !password.trim()) return toast('请填写账号和密码')
    let err: string | null
    if (tab === 'login') {
      // 用户名登录：含 @ 视为邮箱，否则按用户名约定
      err = await login(email.includes('@') ? email : username, password, !email.includes('@'))
    } else {
      if (!email.includes('@')) return toast('请填写正确的邮箱')
      err = await register(username.trim(), email.trim(), password)
    }
    if (err) toast(err)
    else { toast(tab === 'login' ? '登录成功，欢迎回来！' : '注册成功！'); nav('/lobby') }
  }

  const quickDemo = async (u: string, p: string) => {
    const err = await login(u, p, true)
    if (err) toast(err)
    else { toast('已进入演示账号'); nav('/lobby') }
  }

  return (
    <div className="app-shell">
      <div className="login-page" style={{ backgroundImage: `url(${IMG.loginBg})` }}>
        <img className="login-logo" src={IMG.logo} alt="白城麻将·老友" />
        <form className="login-card" onSubmit={submit}>
          <div className="login-title">白城麻将 · 老友</div>
          <div className="login-sub">HAKKA MASTER · 老友欢乐场</div>
          <div className="login-tabs">
            <button type="button" className={tab === 'login' ? 'active' : ''} onClick={() => setTab('login')}>登 录</button>
            <button type="button" className={tab === 'register' ? 'active' : ''} onClick={() => setTab('register')}>注 册</button>
          </div>
          <div className="field">
            <img className="field-icon" src={IMG.unameIcon} alt="" />
            <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="请输入用户名" autoComplete="username" />
          </div>
          {tab === 'register' && (
            <div className="field">
              <span className="field-icon" style={{ textAlign: 'center', color: '#eec45c', fontSize: 18 }}>@</span>
              <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="请输入邮箱" type="email" />
            </div>
          )}
          <div className="field">
            <img className="field-icon" src={IMG.pwdIcon} alt="" />
            <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="请输入密码" type="password" autoComplete="current-password" />
          </div>
          <button className="btn gold block lg" type="submit" disabled={loading}>{loading ? '请稍候…' : tab === 'login' ? '登 录' : '注 册'}</button>
          <div className="login-hint">
            体验账号：<b>demo / demo123</b>（管理员）　<b>player1 / 123456</b>
            <div style={{ marginTop: 6 }}>
              <button type="button" className="btn ghost sm" onClick={() => quickDemo('demo', 'demo123')}>一键体验管理员</button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
