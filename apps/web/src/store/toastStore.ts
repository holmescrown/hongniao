import { create } from 'zustand'

interface ToastState {
  message: string | null
  show: (msg: string) => void
  clear: () => void
}

let timer: number | undefined
export const useToast = create<ToastState>((set) => ({
  message: null,
  show: (msg) => {
    set({ message: msg })
    if (timer) window.clearTimeout(timer)
    timer = window.setTimeout(() => set({ message: null }), 2600)
  },
  clear: () => set({ message: null }),
}))
