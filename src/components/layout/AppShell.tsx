import { NavLink, Outlet } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { itensNavegacao } from './navegacao'

const base = 'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors'

/** Encerra a sessão; o RotaProtegida leva para /entrar quando a sessão some. */
function sair() {
  void supabase?.auth.signOut()
}

export function AppShell() {
  return (
    <div className="min-h-screen md:flex">
      {/* Navegação lateral (desktop/tablet) */}
      <aside className="hidden w-64 shrink-0 flex-col bg-marinho p-4 text-white md:flex">
        <div className="mb-6 px-3 py-2 text-xl font-bold tracking-tight">Tudo Azul</div>
        <nav aria-label="Principal" className="flex flex-col gap-1">
          {itensNavegacao.map(({ caminho, rotulo, Icone }) => (
            <NavLink
              key={caminho}
              to={caminho}
              end={caminho === '/'}
              className={({ isActive }) =>
                `${base} ${isActive ? 'bg-azul text-white' : 'text-blue-100 hover:bg-white/10'}`}
            >
              <Icone />
              {rotulo}
            </NavLink>
          ))}
        </nav>
        <button type="button" onClick={sair} className={`${base} mt-auto text-blue-100 hover:bg-white/10`}>
          Sair
        </button>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between bg-marinho px-4 py-3 text-lg font-bold text-white md:hidden">
          Tudo Azul
          <button type="button" onClick={sair} className="min-h-11 rounded-lg px-3 text-sm font-medium text-blue-100 hover:bg-white/10">
            Sair
          </button>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 p-4 pb-28 md:p-8 md:pb-8">
          <Outlet />
        </main>
      </div>

      {/* Navegação inferior (celular): 8 itens cabem (45px cada em 360px) na largura, alvos de toque >= 44px */}
      <nav
        aria-label="Principal"
        className="fixed inset-x-0 bottom-0 z-10 flex border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        {itensNavegacao.map(({ caminho, curto, Icone }) => (
          <NavLink
            key={caminho}
            to={caminho}
            end={caminho === '/'}
            className={({ isActive }) =>
              `flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-0.5 text-[10px] font-medium ${
                isActive ? 'text-azul' : 'text-slate-500'}`}
          >
            <Icone />
            {curto}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
