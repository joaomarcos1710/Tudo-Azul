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
