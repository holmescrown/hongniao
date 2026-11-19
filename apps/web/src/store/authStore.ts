import { create } from 'zustand'
import type { Profile } from '../lib/auth'
import { getCurrentProfile, signIn, signUp, signOut, signInWithUsername, updateProfile as apiUpdate } from '../lib/auth'

interface AuthState {
  profile: Profile | null
  loading: boolean
  ready: boolean
  init: () => void
  login: (u: string, p: string, byUsername?: boolean) => Promise<string | null>
  register: (username: string, email: string, password: string) => Promise<string | null>
  logout: () => Promise<void>
  refresh: () => Promise<void>
  update: (patch: Partial<Profile>) => Promise<string | null>
}

export const useAuth = create<AuthState>((set, get) => ({
  profile: null,
  loading: false,
  ready: false,
  init: () => {
    const unsub = onAuth((p) => set({ profile: p, ready: true }))
    getCurrentProfile().then((p) => set({ profile: p, ready: true }))
    // 保留取消订阅引用（页面生命周期内常驻）
    ;(get() as any)._unsub = unsub
  },
  login: async (u, p, byUsername) => {
    set({ loading: true })
    const err = byUsername ? await signInWithUsername(u, p) : await signIn(u, p)
    set({ loading: false })
    if (!err) set({ profile: await getCurrentProfile() })
    return err ?? null
  },
  register: async (username, email, password) => {
    set({ loading: true })
    const err = await signUp(username, email, password)
    set({ loading: false })
    if (!err) set({ profile: await getCurrentProfile() })
    return err ?? null
  },
  logout: async () => { await signOut(); set({ profile: null }) },
  refresh: async () => set({ profile: await getCurrentProfile() }),
  update: async (patch) => {
    const cur = get().profile
    if (!cur) return '未登录'
    const err = await apiUpdate(cur.id, patch)
    if (!err) set({ profile: { ...cur, ...patch } })
    return err ?? null
  },
}))

// 单独封装，避免循环 import 顶部解析问题
import { onAuthStateChange } from '../lib/auth'
function onAuth(cb: (p: Profile | null) => void) {
  return onAuthStateChange(() => { getCurrentProfile().then(cb) })
}
