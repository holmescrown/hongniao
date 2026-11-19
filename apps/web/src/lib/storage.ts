// localStorage 的 JSON 读写小工具，统一加命名空间前缀，避免和老游戏数据冲突。
// SSR / 隐私模式下 localStorage 不可用时全部静默降级。

const PREFIX = 'redbird:'

export function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    return raw === null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}

export function writeJSON<T>(key: string, value: T): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch {
    // 配额不足或隐私模式：忽略，不影响主流程
  }
}

export function removeJSON(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key)
  } catch {
    // 同上
  }
}
