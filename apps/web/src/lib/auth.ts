// 统一账号 / 资料访问层：云端 Supabase 与本地 Demo 共用同一套接口。
// 页面只调用本文件，不需要判断当前是哪种模式。
import { supabase, isSupabaseConfigured, type Profile, type GameRecord } from './supabase'
import { readJSON, writeJSON, removeJSON } from './storage'

// 页面/状态层统一从本文件取 Profile 类型
export type { Profile } from './supabase'

/**
 * 统一错误返回：成功 = null，失败 = 错误文案。
 * 与现有 store / AdminPage 的调用方式保持一致（if (!err) / toast(err)）。
 * 需要 { error?: string } 结构的调用方可使用文件末尾的 authApi。
 */
export type AuthResult = string | null

export interface ProfilesResult {
  data: Profile[]
  error?: string
}

/** 允许修改的字段（id / created_at 由系统管理） */
export type ProfilePatch = Partial<Omit<Profile, 'id' | 'created_at'>>

/** 管理后台可字段级修改的敏感项 */
export type AdminProfilePatch = Partial<Pick<Profile, 'currency' | 'roomcard' | 'banned' | 'is_admin'>>

export type AuthChangeCallback = (profile: Profile | null) => void

// ---------------------------- Demo 专用 ----------------------------

interface DemoUser extends Profile {
  email: string
  password: string // btoa(明文)，仅 Demo 使用，切勿用于真实环境
}

const DEMO_USERS_KEY = 'demo_users'
const DEMO_SESSION_KEY = 'demo_session' // 存当前登录用户的 id
const SENSITIVE_FIELDS = ['currency', 'roomcard', 'is_admin', 'banned'] as const

// Demo 无原生 auth 事件，自己维护订阅者
const demoListeners = new Set<AuthChangeCallback>()

const encodePwd = (pwd: string): string => {
  try {
    return btoa(pwd)
  } catch {
    return pwd // 非 ASCII 密码 btoa 会抛错，Demo 下直接退化存原文
  }
}

const normalizeEmail = (input: string): string => {
  const value = input.trim()
  return value.includes('@') ? value.toLowerCase() : `${value}@redbird.local`
}

function newDemoId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `demo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  }
}

function seedDemoUsers(): DemoUser[] {
  const now = new Date().toISOString()
  const make = (
    id: string,
    username: string,
    password: string,
    extra: Partial<DemoUser> = {},
  ): DemoUser => ({
    id,
    username,
    email: `${username}@redbird.local`,
    password: encodePwd(password),
    avatar: 0,
    currency: 1000,
    roomcard: 5,
    games: 0,
    wins: 0,
    record_data: [] as GameRecord[],
    is_admin: false,
    banned: false,
    created_at: now,
    last_login: null,
    ...extra,
  })

  return [
    // 管理员账号：金币 8888、房卡 20
    make('demo-admin', 'demo', 'demo123', { currency: 8888, roomcard: 20, is_admin: true }),
    make('demo-player1', 'player1', '123456'),
    make('demo-player2', 'player2', '123456'),
  ]
}

function loadDemoUsers(): DemoUser[] {
  const users = readJSON<DemoUser[] | null>(DEMO_USERS_KEY, null)
  if (!Array.isArray(users) || users.length === 0) {
    const seeded = seedDemoUsers()
    writeJSON(DEMO_USERS_KEY, seeded)
    return seeded
  }
  return users
}

function saveDemoUsers(users: DemoUser[]): void {
  writeJSON(DEMO_USERS_KEY, users)
}

/** 对外不暴露 Demo 的邮箱和密码 */
function toProfile(user: DemoUser): Profile {
  const { password: _password, email: _email, ...profile } = user
  return profile
}

function notifyDemoListeners(): void {
  void getCurrentProfile().then((profile) => {
    demoListeners.forEach((cb) => cb(profile))
  })
}

// ---------------------------- 统一接口 ----------------------------

/** 获取当前登录用户资料；未登录返回 null */
export async function getCurrentProfile(): Promise<Profile | null> {
  if (!isSupabaseConfigured) {
    const id = readJSON<string | null>(DEMO_SESSION_KEY, null)
    if (!id) return null
    const user = loadDemoUsers().find((u) => u.id === id)
    if (!user) {
      removeJSON(DEMO_SESSION_KEY)
      return null
    }
    return toProfile(user)
  }

  const { data: authData, error: authError } = await supabase.auth.getUser()
  if (authError || !authData.user) return null
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', authData.user.id)
    .maybeSingle()
  if (error || !data) return null
  return data as Profile
}

/**
 * 注册新账号。email 留空时自动使用 `用户名@redbird.local`，
 * 便于直接用用户名登录。注册成功后自动登录（与云端默认行为一致）。
 * 返回 null 表示成功，否则返回错误文案。
 */
export async function signUp(username: string, email: string, password: string): Promise<AuthResult> {
  const name = username.trim()
  if (!name) return '请输入用户名'
  if (!password || password.length < 6) return '密码至少 6 位'

  const authEmail = email.trim() || `${name}@redbird.local`

  if (!isSupabaseConfigured) {
    const users = loadDemoUsers()
    const lowerName = name.toLowerCase()
    const lowerEmail = authEmail.toLowerCase()
    if (users.some((u) => u.username.toLowerCase() === lowerName || u.email.toLowerCase() === lowerEmail)) {
      return '用户名或邮箱已被注册'
    }
    const now = new Date().toISOString()
    users.push({
      id: newDemoId(),
      username: name,
      email: lowerEmail,
      password: encodePwd(password),
      avatar: 0,
      currency: 1000,
      roomcard: 5,
      games: 0,
      wins: 0,
      record_data: [] as GameRecord[],
      is_admin: false,
      banned: false,
      created_at: now,
      last_login: now,
    })
    saveDemoUsers(users)
    writeJSON(DEMO_SESSION_KEY, users[users.length - 1].id)
    notifyDemoListeners()
    return null
  }

  const { error } = await supabase.auth.signUp({
    email: authEmail,
    password,
    // 触发器会从 user_metadata 里取 username 写入 profiles
    options: { data: { username: name } },
  })
  return error ? error.message : null
}

/** 邮箱登录；输入不含 @ 时按用户名约定补 @redbird.local */
export async function signIn(email: string, password: string): Promise<AuthResult> {
  const account = email.trim()
  if (!account || !password) return '请输入账号和密码'
  const authEmail = normalizeEmail(account)

  if (!isSupabaseConfigured) {
    const users = loadDemoUsers()
    const user = users.find((u) => u.email.toLowerCase() === authEmail)
    if (!user || user.password !== encodePwd(password)) return '账号或密码错误'
    if (user.banned) return '该账号已被封禁，请联系管理员'
    user.last_login = new Date().toISOString()
    saveDemoUsers(users)
    writeJSON(DEMO_SESSION_KEY, user.id)
    notifyDemoListeners()
    return null
  }

  const { error } = await supabase.auth.signInWithPassword({ email: authEmail, password })
  if (error) return error.message
  // 封禁用户禁止进入
  const profile = await getCurrentProfile()
  if (profile?.banned) {
    await supabase.auth.signOut()
    return '该账号已被封禁，请联系管理员'
  }
  return null
}

/** 老游戏风格的用户名登录（约定邮箱为 `用户名@redbird.local`） */
export async function signInWithUsername(username: string, password: string): Promise<AuthResult> {
  const name = username.trim()
  return signIn(name.includes('@') ? name : `${name}@redbird.local`, password)
}

export async function signOut(): Promise<void> {
  if (!isSupabaseConfigured) {
    removeJSON(DEMO_SESSION_KEY)
    notifyDemoListeners()
    return
  }
  await supabase.auth.signOut()
}

/**
 * 修改资料。普通用户只能改自己且改不了敏感字段；
 * 管理员可改任意用户的任意字段（后台改金币/房卡/封禁）。
 */
export async function updateProfile(id: string, patch: ProfilePatch): Promise<AuthResult> {
  if (!isSupabaseConfigured) {
    const users = loadDemoUsers()
    const index = users.findIndex((u) => u.id === id)
    if (index < 0) return '用户不存在'
    const currentId = readJSON<string | null>(DEMO_SESSION_KEY, null)
    const actor = users.find((u) => u.id === currentId)
    if (!actor) return '请先登录'
    if (!actor.is_admin && id !== actor.id) return '只能修改自己的资料'
    if (!actor.is_admin && SENSITIVE_FIELDS.some((field) => field in patch)) {
      return '无权限修改金币/房卡/管理员/封禁状态'
    }

    const newName = patch.username?.trim()
    if (newName && users.some((u, i) => i !== index && u.username.toLowerCase() === newName.toLowerCase())) {
      return '用户名已被占用'
    }
    users[index] = { ...users[index], ...patch, ...(newName ? { username: newName } : {}) }
    saveDemoUsers(users)
    if (id === currentId) notifyDemoListeners()
    return null
  }

  const { error } = await supabase.from('profiles').update(patch).eq('id', id)
  return error ? error.message : null
}

/**
 * 订阅登录态变化，返回退订函数。
 * 与 Supabase 一致：订阅时会立刻用当前会话回调一次。
 */
export function onAuthStateChange(cb: AuthChangeCallback): () => void {
  if (!isSupabaseConfigured) {
    demoListeners.add(cb)
    void getCurrentProfile().then((profile) => cb(profile))
    return () => {
      demoListeners.delete(cb)
    }
  }

  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    if (!session?.user) {
      cb(null)
      return
    }
    void supabase
      .from('profiles')
      .select('*')
      .eq('id', session.user.id)
      .maybeSingle()
      .then(({ data: profile }) => cb((profile as Profile | null) ?? null))
  })
  void getCurrentProfile().then((profile) => cb(profile))
  return () => data.subscription.unsubscribe()
}

/** 后台用户列表（仅管理员可用；云端由 RLS 兜底） */
export async function listProfiles(): Promise<ProfilesResult> {
  const me = await getCurrentProfile()
  if (!me) return { data: [], error: '请先登录' }
  if (!me.is_admin) return { data: [me], error: '无管理员权限，仅返回自己的资料' }

  if (!isSupabaseConfigured) {
    return { data: loadDemoUsers().map(toProfile) }
  }
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) return { data: [], error: error.message }
  return { data: (data ?? []) as Profile[] }
}

/**
 * 管理后台：取出全部用户资料（含预置 Demo 账号）。
 * 权限不在此处判断——页面已校验 is_admin，云端由 RLS 兜底。
 */
export async function listAllProfiles(): Promise<Profile[]> {
  if (!isSupabaseConfigured) {
    return loadDemoUsers()
      .map(toProfile)
      .sort((a, b) => b.created_at.localeCompare(a.created_at) || a.username.localeCompare(b.username))
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) return []
  return (data ?? []) as Profile[]
}

/** 管理后台：按 id 修改用户资料；云端的管理员权限由 RLS 保证 */
export async function adminUpdateProfile(id: string, patch: AdminProfilePatch): Promise<AuthResult> {
  if (!isSupabaseConfigured) {
    const users = loadDemoUsers()
    const index = users.findIndex((u) => u.id === id)
    if (index < 0) return '用户不存在'
    users[index] = { ...users[index], ...patch }
    saveDemoUsers(users)
    const currentId = readJSON<string | null>(DEMO_SESSION_KEY, null)
    if (id === currentId) notifyDemoListeners()
    return null
  }

  const { error } = await supabase.from('profiles').update(patch).eq('id', id)
  return error ? error.message : null
}

/**
 * 偏好 { error?: string } 结构的调用方可使用本组封装，
 * 与上面的函数共享同一实现（成功返回空对象，失败返回 { error }）。
 */
export const authApi = {
  signUp: async (username: string, email: string, password: string) => {
    const error = await signUp(username, email, password)
    return error ? { error } : {}
  },
  signIn: async (email: string, password: string) => {
    const error = await signIn(email, password)
    return error ? { error } : {}
  },
  signInWithUsername: async (username: string, password: string) => {
    const error = await signInWithUsername(username, password)
    return error ? { error } : {}
  },
  updateProfile: async (id: string, patch: ProfilePatch) => {
    const error = await updateProfile(id, patch)
    return error ? { error } : {}
  },
  adminUpdateProfile: async (id: string, patch: AdminProfilePatch) => {
    const error = await adminUpdateProfile(id, patch)
    return error ? { error } : {}
  },
}
