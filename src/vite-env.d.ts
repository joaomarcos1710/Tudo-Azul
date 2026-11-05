/// <reference types="vite/client" />

/** Injetados pelo vite.config.ts */
declare const __APP_VERSAO__: string
declare const __APP_COMMIT__: string

/** tailwind.config.js (JS): o teste de cores lê a paleta que o Tailwind usa (#184). */
declare module '*tailwind.config.js' {
  const config: import('tailwindcss').Config & { theme: { extend: { colors: Record<string, unknown> } } }
  export default config
}
