import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// 用 Record 取值避免不同 Vite 版本下 import.meta.env 索引签名差异
const env = import.meta.env as Record<string, string | undefined>
const readEnv = (key: string): string => (env[key] ?? '').trim()

export const SUPABASE_URL = readEnv('VITE_SUPABASE_URL')
export const SUPABASE_ANON_KEY = readEnv('VITE_SUPABASE_ANON_KEY')
export const GAME_SERVER_URL = readEnv('VITE_GAME_SERVER_URL')
export const ADMIN_EMAILS = readEnv('VITE_ADMIN_EMAILS')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

/** URL 和 anon key 都填了才算接入云端；否则走本地 Demo */
export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY)

// createClient 构造时不会发网络请求；未配置时用占位地址，auth.ts 的 Demo 分支也不会调用它
const PLACEHOLDER_URL = 'http://localhost:54321'
const PLACEHOLDER_KEY = 'demo-anon-key'

export const supabase: SupabaseClient = createClient(
  isSupabaseConfigured ? SUPABASE_URL : PLACEHOLDER_URL,
  isSupabaseConfigured ? SUPABASE_ANON_KEY : PLACEHOLDER_KEY,
  {
    auth: {
      persistSession: isSupabaseConfigured,
      autoRefreshToken: isSupabaseConfigured,
      detectSessionInUrl: isSupabaseConfigured,
    },
  },
)

/** 一条战绩，字段不固定（兼容旧 userData.recordData 里的任意结构） */
export type GameRecord = Record<string, unknown>

/** 与数据库 public.profiles 表一一对应 */
export interface Profile {
  id: string
  username: string
  avatar: number | string
  currency: number
  roomcard: number
  games: number
  wins: number
  record_data: any
  is_admin: boolean
  banned: boolean
  created_at: string
  last_login: string | null
  updated_at?: string
}
