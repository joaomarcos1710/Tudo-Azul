import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import { AuthProvider } from './lib/auth'
import { FamiliaProvider } from './lib/FamiliaContext'
import { clienteConsultas } from './lib/consultas'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={clienteConsultas}>
      <AuthProvider>
        <FamiliaProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </FamiliaProvider>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
)

// App instalável (PWA): só em produção; o service worker guarda o app, nunca os dados (public/sw.js).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined)
  })
}

// Monitoramento de erros (Sentry): só em produção, só com o DSN configurado no Vercel, carregado depois da página.
const dsnSentry = import.meta.env.VITE_SENTRY_DSN as string | undefined
if (import.meta.env.PROD && dsnSentry) {
  window.addEventListener('load', () => {
    void import('./lib/monitoramento').then((m) => m.iniciarMonitoramento(dsnSentry)).catch(() => undefined)
  })
}
