import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './lib/auth'
import { FamiliaProvider } from './lib/FamiliaContext'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <FamiliaProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </FamiliaProvider>
    </AuthProvider>
  </StrictMode>,
)

// App instalável (PWA): só em produção; o service worker guarda o app, nunca os dados (public/sw.js).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined)
  })
}
