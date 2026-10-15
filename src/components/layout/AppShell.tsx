import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { itensNavegacao } from './navegacao'
import { ModalExportarCodigo } from '../modals/ModalExportarCodigo'
import { Code, Download } from 'lucide-react'

const base = 'flex items-center gap-3 rounded-lg px-3 py-2 text-xs font-medium transition-colors'

export function AppShell() {
  const [modalExportarAberto, setModalExportarAberto] = useState(false)

  return (
    <div className="min-h-screen md:flex">
      {/* Navegação lateral (desktop/tablet) */}
      <aside className="hidden w-64 shrink-0 flex-col bg-marinho p-4 text-white md:flex">
        <div className="mb-4 px-3 py-2 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-tr from-cyan-400 to-blue-600 flex items-center justify-center text-white shadow-md shadow-cyan-500/20">
              <span className="font-black text-sm tracking-wider">TA</span>
            </div>
            <div>
              <div className="text-base font-bold tracking-tight text-white leading-tight">Tudo Azul</div>
              <div className="text-[10px] text-cyan-300 font-medium">Finanças Familiares</div>
            </div>
          </div>
        </div>

        <nav aria-label="Principal" className="flex flex-col gap-0.5 flex-1 overflow-y-auto pr-1">
          {itensNavegacao.map(({ caminho, rotulo, Icone }) => (
            <NavLink
              key={caminho}
              to={caminho}
              end={caminho === '/'}
              className={({ isActive }) =>
                `${base} ${isActive ? 'bg-azul text-white font-bold' : 'text-blue-100 hover:bg-white/10'}`}
            >
              <Icone />
              {rotulo}
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto pt-3 border-t border-white/10 px-1 space-y-2">
          {/* Botão de Código & Backup */}
          <button
            type="button"
            onClick={() => setModalExportarAberto(true)}
            className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-blue-100 text-xs font-semibold transition"
          >
            <span className="flex items-center gap-2">
              <Code className="h-3.5 w-3.5 text-cyan-300" />
              <span>Código & Backup</span>
            </span>
            <Download className="h-3 w-3 text-cyan-300" />
          </button>

          <div className="flex items-center gap-2 text-[11px] text-blue-200 px-2">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>Espaço Familiar Ativo</span>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between bg-marinho px-4 py-3 text-white md:hidden">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-gradient-to-tr from-cyan-400 to-blue-600 flex items-center justify-center text-white font-black text-xs">
              TA
            </div>
            <span className="text-base font-bold">Tudo Azul</span>
          </div>

          <button
            type="button"
            onClick={() => setModalExportarAberto(true)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/10 text-xs font-semibold text-cyan-200"
          >
            <Code className="h-3.5 w-3.5" />
            <span>Código</span>
          </button>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 p-4 pb-28 md:p-8 md:pb-8">
          <Outlet />
        </main>
      </div>

      {/* Navegação inferior (celular) */}
      <nav
        aria-label="Principal"
        className="fixed inset-x-0 bottom-0 z-10 flex border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden overflow-x-auto"
      >
        {itensNavegacao.slice(0, 5).map(({ caminho, curto, Icone }) => (
          <NavLink
            key={caminho}
            to={caminho}
            end={caminho === '/'}
            className={({ isActive }) =>
              `flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-0.5 text-[10px] font-medium ${
                isActive ? 'text-azul font-bold' : 'text-slate-500'}`}
          >
            <Icone />
            {curto}
          </NavLink>
        ))}
        {/* Link direto para o Calendário no celular se não estiver nos primeiros 5 */}
        <NavLink
          to="/calendario"
          className={({ isActive }) =>
            `flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-0.5 text-[10px] font-medium ${
              isActive ? 'text-azul font-bold' : 'text-slate-500'}`}
        >
          <Code className="h-4 w-4" />
          Calend.
        </NavLink>
      </nav>

      {/* Modal Código & Backup */}
      <ModalExportarCodigo
        aberto={modalExportarAberto}
        aoFechar={() => setModalExportarAberto(false)}
      />
    </div>
  )
}
