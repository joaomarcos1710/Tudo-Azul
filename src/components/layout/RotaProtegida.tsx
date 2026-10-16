import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import { supabaseConfigurado } from '../../lib/supabase'
import { Aviso } from '../ui/Aviso'

/** Só mostra o conteúdo para quem entrou; os demais vão para /entrar e voltam depois. */
export function RotaProtegida({ children }: { children: ReactNode }) {
  const { sessao, carregando } = useAuth()
  const location = useLocation()

  if (!supabaseConfigurado) {
    return (
      <div className="mx-auto max-w-md p-6">
        <Aviso tipo="erro">
          O app ainda não está ligado ao banco de dados. Configure <code>VITE_SUPABASE_URL</code> e{' '}
          <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> (veja <code>.env.example</code>).
        </Aviso>
      </div>
    )
  }
  if (carregando) {
    return <p className="p-6 text-sm text-slate-600" role="status">Carregando…</p>
  }
  if (!sessao) {
    // hash incluído: o token do convite (/convite#token) sobrevive ao login
    return <Navigate to="/entrar" replace state={{ de: location.pathname + location.search + location.hash }} />
  }
  return <>{children}</>
}
