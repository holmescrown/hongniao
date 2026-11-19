import { useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import LoginPage from './pages/LoginPage'
import LobbyPage from './pages/LobbyPage'
import RoomPage from './pages/RoomPage'
import ProfilePage from './pages/ProfilePage'
import AdminPage from './pages/AdminPage'
import { useAuth } from './store/authStore'
import { useToast } from './store/toastStore'

function Guard({ children }: { children: React.ReactNode }) {
  const { profile, ready } = useAuth()
  if (!ready) return <div className="app-shell"><div className="loading">加载中…</div></div>
  return profile ? <>{children}</> : <Navigate to="/login" replace />
}

export default function App() {
  const init = useAuth((s) => s.init)
  const message = useToast((s) => s.message)
  useEffect(() => { init() }, [])
  return (
    <>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/lobby" element={<Guard><LobbyPage /></Guard>} />
        <Route path="/room" element={<Guard><RoomPage /></Guard>} />
        <Route path="/profile" element={<Guard><ProfilePage /></Guard>} />
        <Route path="/admin" element={<Guard><AdminPage /></Guard>} />
        <Route path="/" element={<Navigate to="/lobby" replace />} />
        <Route path="*" element={<Navigate to="/lobby" replace />} />
      </Routes>
      {message && <div className="toast">{message}</div>}
    </>
  )
}
