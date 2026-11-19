import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 部署到 Vercel / Cloudflare Pages 时用相对资源路径，方便挂在任意子路径
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1200,
  },
  server: {
    port: 5173,
  },
})
