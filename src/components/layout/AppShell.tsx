import { useCallback, useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { definirValoresOcultos, useValoresOcultos } from '../../lib/privacidade'
import { supabase } from '../../lib/supabase'
import { IconeMais, IconeOlho, IconeOlhoFechado } from './icons'
import { gruposNavegacao, itemAtivo, itensFixosNoCelular, itensNavegacao } from './navegacao'
import { Marca } from './Marca'
import { Versao } from './Versao'

const base = 'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors'

/** Encerra a sessão; o RotaProtegida leva para /entrar quando a sessão some. */
function sair() {
  void supabase?.auth.signOut()
}

/** Liga/desliga a máscara nos valores em reais (só apresentação; ver lib/privacidade). */
function BotaoOcultarValores({ claro = false }: { claro?: boolean }) {
  const ocultos = useValoresOcultos()
  return (
    <button
      type="button"
      aria-label="Ocultar valores"
      aria-pressed={ocultos}
      title={ocultos ? 'Valores ocultos: toque para mostrar' : 'Ocultar valores'}
      onClick={() => definirValoresOcultos(!ocultos)}
      className={`flex min-h-11 min-w-11 items-center justify-center rounded-lg transition-colors ${
        claro ? 'text-blue-100 hover:bg-white/10' : 'text-slate-600 hover:bg-slate-100'}`}
    >
      {ocultos ? <IconeOlhoFechado /> : <IconeOlho />}
    </button>
  )
}

/** Folha do celular com todos os grupos: o que não cabe na barra de baixo. */
function MenuMais({ aoFechar }: { aoFechar: () => void }) {
  const fechar = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    fechar.current?.focus()
    const aoTecla = (e: KeyboardEvent) => { if (e.key === 'Escape') aoFechar() }
    document.addEventListener('keydown', aoTecla)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', aoTecla)
      document.body.style.overflow = overflow
    }
  }, [aoFechar])

  return (
    <div className="fixed inset-0 z-30 md:hidden">
      <button type="button" aria-label="Fechar menu" tabIndex={-1} onClick={aoFechar} className="absolute inset-0 bg-black/40" />
      <div
        role="dialog" aria-modal="true" aria-label="Menu"
        className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-2xl bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-card"
      >
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-lg font-bold">Menu</h2>
          <button ref={fechar} type="button" aria-label="Fechar" onClick={aoFechar}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-xl text-slate-600 hover:bg-slate-100">
            ×
          </button>
        </div>
        <div role="group" aria-label="Atalhos" className="mb-4 grid grid-cols-2 gap-2">
          {itensNavegacao.filter((i) => i.atalho).map(({ caminho, rotulo, descricao, Icone }) => (
            <NavLink
              key={caminho}
              to={caminho}
              aria-label={rotulo}
              aria-describedby={`desc-${caminho}`}
              onClick={aoFechar}
              className={({ isActive }) =>
                `flex min-h-[5.5rem] flex-col justify-between gap-2 rounded-xl border p-3 ${
                  isActive ? 'border-azul bg-azul-claro' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
            >
              <span aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-lg bg-azul-claro text-azul"><Icone /></span>
              <span aria-hidden="true">
                <span className="block text-sm font-semibold text-marinho">{rotulo}</span>
                <span id={`desc-${caminho}`} className="block text-xs leading-snug text-slate-600">{descricao}</span>
              </span>
            </NavLink>
          ))}
        </div>
        <div className="flex flex-col gap-4">
          {gruposNavegacao.map((g) => ({ ...g, itens: g.itens.filter((i) => !i.atalho) })).filter((g) => g.itens.length > 0).map((g) => (
            <div key={g.titulo} role="group" aria-label={g.titulo}>
              <p className="mb-1 px-3 text-xs font-semibold uppercase tracking-wider text-slate-500" aria-hidden="true">{g.titulo}</p>
              <ul className="flex flex-col gap-1">
                {g.itens.map(({ caminho, rotulo, descricao, Icone }) => (
                  <li key={caminho}>
                    <NavLink
                      to={caminho}
                      end={caminho === '/'}
                      aria-label={rotulo}
                      aria-describedby={`desc-${caminho}`}
                      onClick={aoFechar}
                      className={({ isActive }) => `${base} min-h-11 ${isActive ? 'bg-azul/10 text-azul' : 'text-slate-700 hover:bg-slate-100'}`}
                    >
                      <Icone />
                      <span aria-hidden="true" className="min-w-0">
                        <span className="block">{rotulo}</span>
                        <span id={`desc-${caminho}`} className="block text-xs font-normal text-slate-600">{descricao}</span>
                      </span>
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-center justify-between border-t border-slate-200 pt-3">
          <button type="button" onClick={sair} className="min-h-11 rounded-lg px-3 text-sm font-medium text-slate-700 hover:bg-slate-100">
            Sair
          </button>
          <Versao className="text-slate-500" />
        </div>
      </div>
    </div>
  )
}

export function AppShell() {
  const { pathname } = useLocation()
  const [maisAberto, setMaisAberto] = useState(false)
  const botaoMais = useRef<HTMLButtonElement>(null)

  const fecharMais = useCallback(() => {
    setMaisAberto(false)
    botaoMais.current?.focus()
  }, [])
  // voltar/avançar do navegador com a folha aberta: ela fecha
  useEffect(() => { setMaisAberto(false) }, [pathname])

  const ativo = itemAtivo(pathname)
  const maisAtivo = maisAberto || (ativo !== undefined && !ativo.fixoNoCelular)

  return (
    <div className="min-h-screen md:flex">
      {/* Navegação lateral (iPad/computador), em grupos */}
      <aside className="hidden w-64 shrink-0 flex-col bg-marinho p-4 text-white md:sticky md:top-0 md:flex md:h-screen md:overflow-y-auto">
        <div className="mb-4 flex items-center justify-between py-2 pl-3">
          <Marca claro />
          <BotaoOcultarValores claro />
        </div>
        <nav aria-label="Principal" className="flex flex-col gap-4">
          {gruposNavegacao.map((g) => (
            <div key={g.titulo} role="group" aria-label={g.titulo}>
              <p className="mb-1 px-3 text-xs font-semibold uppercase tracking-wider text-blue-200/60" aria-hidden="true">{g.titulo}</p>
              <ul className="flex flex-col gap-1">
                {g.itens.map(({ caminho, rotulo, Icone }) => (
                  <li key={caminho}>
                    <NavLink
                      to={caminho}
                      end={caminho === '/'}
                      className={({ isActive }) =>
                        `${base} ${isActive ? 'bg-azul text-white' : 'text-blue-100 hover:bg-white/10'}`}
                    >
                      <Icone />
                      {rotulo}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <button type="button" onClick={sair} className={`${base} mt-auto text-blue-100 hover:bg-white/10`}>
          Sair
        </button>
        <Versao className="px-3 pt-2 text-blue-200/70" />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between bg-marinho pb-2 pl-4 pr-2 pt-[max(0.5rem,env(safe-area-inset-top))] md:hidden">
          <Marca tamanho={28} claro />
          <div className="flex items-center">
            <BotaoOcultarValores claro />
            <button type="button" onClick={sair} className="min-h-11 rounded-lg px-3 text-sm font-medium text-blue-100 hover:bg-white/10">
              Sair
            </button>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 p-4 pb-28 md:p-8 md:pb-8">
          <Outlet />
        </main>
      </div>

      {/* Celular: 4 atalhos + "Mais" (a folha com todos os grupos); alvos de toque >= 44px */}
      <nav
        aria-label="Principal no celular"
        className="fixed inset-x-0 bottom-0 z-10 flex border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        {itensFixosNoCelular.map(({ caminho, curto, Icone }) => (
          <NavLink
            key={caminho}
            to={caminho}
            end={caminho === '/'}
            className={({ isActive }) =>
              `flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-0.5 text-[11px] font-medium ${
                isActive && !maisAberto ? 'text-azul' : 'text-slate-500'}`}
          >
            <Icone />
            {curto}
          </NavLink>
        ))}
        <button
          ref={botaoMais}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={maisAberto}
          onClick={() => setMaisAberto(true)}
          className={`flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-0.5 text-[11px] font-medium ${
            maisAtivo ? 'text-azul' : 'text-slate-500'}`}
        >
          <IconeMais />
          Mais
        </button>
      </nav>

      {maisAberto && <MenuMais aoFechar={fecharMais} />}
    </div>
  )
}
