import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'

// Versão = ano.número-da-PR (docs/VERSOES.md); o commit vem da Vercel (VERCEL_GIT_COMMIT_SHA) quando existe.
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSAO__: JSON.stringify(version),
    __APP_COMMIT__: JSON.stringify((process.env.VERCEL_GIT_COMMIT_SHA ?? '').slice(0, 7)),
  },
  server: {
    host: '0.0.0.0',
    port: 3000,
  },
})
