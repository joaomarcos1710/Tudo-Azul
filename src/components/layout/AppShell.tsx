import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { definirValoresOcultos, useValoresOcultos } from '../../lib/privacidade'
import { useAuth } from '../../lib/auth'
import { supabase } from '../../lib/supabase'
import { IconeMais, IconeOlho, IconeOlhoFechado } from './icons'
import { gruposMenuPerfil, gruposNavegacao, itemAtivo, itensAcessoRapido, itensFixosNoCelular, itensNavegacao } from './navegacao'
import { Marca } from './Marca'
import { Versao } from './Versao'

const base = 'flex min-h-11 items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors'

/** Encerra a sessão; a rota protegida leva para /entrar quando a sessão some. */
function sair() {
  void supabase?.auth.signOut()
}

/** Liga/desliga a máscara nos valores em reais (só apresentação). */
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

/** Folha do celular com os destinos que não cabem na barra inferior. */
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
      <div role="dialog" aria-modal="true" aria-label="Menu"
        className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-2xl bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-card">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-lg font-bold">Menu</h2>
          <button ref={fechar} type="button" aria-label="Fechar" onClick={aoFechar}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-xl text-slate-600 hover:bg-slate-100">×</button>
        </div>
        <div role="group" aria-label="Atalhos" className="mb-4 grid grid-cols-2 gap-2">
          {itensNavegacao.filter((i) => i.atalho).map(({ caminho, rotulo, descricao, Icone }) => (
            <NavLink key={caminho} to={caminho} aria-label={rotulo} aria-describedby={`desc-${caminho}`} onClick={aoFechar}
              className={({ isActive }) => `flex min-h-[5.5rem] flex-col justify-between gap-2 rounded-xl border p-3 ${
                isActive ? 'border-azul bg-azul-claro' : 'border-slate-200 bg-white hover:bg-slate-50'}`}>
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
                    <NavLink to={caminho} end={caminho === '/'} aria-label={rotulo} aria-describedby={`desc-${caminho}`} onClick={aoFechar}
                      className={({ isActive }) => `${base} min-h-11 ${isActive ? 'bg-azul/10 text-azul' : 'text-slate-700 hover:bg-slate-100'}`}>
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
          <button type="button" onClick={sair} className="min-h-11 rounded-lg px-3 text-sm font-medium text-slate-700 hover:bg-slate-100">Sair</button>
          <Versao className="text-slate-500" />
        </div>
      </div>
    </div>
  )
}

/** Perfil autenticado e menu de configurações da navegação desktop. */
function PerfilSidebar({ pathname }: { pathname: string }) {
  const { sessao } = useAuth()
  const [aberto, setAberto] = useState(false)
  const area = useRef<HTMLDivElement>(null)
  const botao = useRef<HTMLButtonElement>(null)
  const usuario = sessao?.user
  const metadados = usuario?.user_metadata ?? {}
  const nome = String(metadados.full_name ?? metadados.name ?? usuario?.email?.split('@')[0] ?? 'Minha conta')
  const avatar = typeof metadados.avatar_url === 'string' ? metadados.avatar_url
    : typeof metadados.picture === 'string' ? metadados.picture : ''
  const planoMeta = usuario?.app_metadata?.plan ?? metadados.plan ?? metadados.subscription_plan
  const plano = typeof planoMeta === 'string' && planoMeta.trim() ? planoMeta : 'Conta familiar'
  const iniciais = nome.split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((p: string) => p[0]).join('').toUpperCase() || 'TA'

  useEffect(() => {
    if (!aberto) return
    const fora = (e: PointerEvent) => { if (!area.current?.contains(e.target as Node)) setAberto(false) }
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setAberto(false)
        botao.current?.focus()
      }
    }
    document.addEventListener('pointerdown', fora)
    document.addEventListener('keydown', tecla)
    return () => {
      document.removeEventListener('pointerdown', fora)
      document.removeEventListener('keydown', tecla)
    }
  }, [aberto])

  useEffect(() => { setAberto(false) }, [pathname])

  return (
    <div ref={area} className="relative mt-auto pt-4">
      {aberto && (
        <div role="menu" aria-label="Configurações da conta"
          className="absolute bottom-[calc(100%+0.5rem)] left-0 right-0 z-50 overflow-hidden rounded-xl border border-white/10 bg-[#102b4b] p-2 shadow-2xl shadow-black/40">
          {gruposMenuPerfil.map((grupo) => (
            <section key={grupo.titulo} aria-label={grupo.titulo} className="py-1">
              <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-blue-200/60">{grupo.titulo}</p>
              {grupo.itens.map(({ caminho, rotulo, Icone }) => (
                <NavLink key={caminho} to={caminho} end={caminho === '/'}
                  role="menuitem" onClick={() => setAberto(false)}
                  className={({ isActive }) => `flex min-h-10 items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                    isActive ? 'bg-azul text-white' : 'text-blue-50 hover:bg-white/10'}`}>
                  <Icone />{rotulo}
                </NavLink>
              ))}
            </section>
          ))}
          <div className="mt-1 border-t border-white/10 pt-2">
            <button type="button" role="menuitem" onClick={sair}
              className="flex min-h-10 w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-blue-50 transition-colors hover:bg-white/10">
              <span aria-hidden="true" className="w-[22px] text-center">↪</span>Sair
            </button>
            <Versao className="px-3 pb-1 pt-2 text-[11px] text-blue-200/60" />
          </div>
        </div>
      )}
      <button ref={botao} type="button" aria-haspopup="menu" aria-expanded={aberto}
        aria-label={`Perfil de ${nome}`} onClick={() => setAberto((v) => !v)}
        className="flex min-h-[60px] w-full items-center gap-3 rounded-xl border border-transparent px-2.5 py-2 text-left transition-colors hover:border-white/10 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300">
        {avatar
          ? <img src={avatar} alt="" referrerPolicy="no-referrer" className="h-10 w-10 shrink-0 rounded-full bg-white/10 object-cover" />
          : <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-azul text-sm font-semibold text-white">{iniciais}</span>}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-white">{nome}</span>
          <span className="block truncate text-xs text-blue-200/70">{plano}</span>
        </span>
        <span aria-hidden="true" className="text-xl leading-none text-blue-100/80">⋮</span>
      </button>
    </div>
  )
}

export function AppShell() {
  const { pathname } = useLocation()
  const modoFatura = /^\/cartoes\/[^/]+\/fatura\//.test(pathname)
  const [menuColapsado, setMenuColapsado] = useState(false)
  const [maisAberto, setMaisAberto] = useState(false)
  const botaoMais = useRef<HTMLButtonElement>(null)
  const fecharMais = useCallback(() => {
    setMaisAberto(false)
    botaoMais.current?.focus()
  }, [])
  useEffect(() => { setMaisAberto(false) }, [pathname])
  // O modo de foco só existe na página dedicada da fatura; ao sair, a navegação volta ao normal.
  useEffect(() => { if (!modoFatura) setMenuColapsado(false) }, [modoFatura])

  const ativo = itemAtivo(pathname)
  const maisAtivo = maisAberto || (ativo !== undefined && !ativo.fixoNoCelular)

  return (
    <div className="min-h-screen md:flex">
      <aside id="navegacao-lateral" className={`hidden w-64 shrink-0 flex-col bg-marinho p-4 text-white transition-all duration-300 md:sticky md:top-0 md:h-screen md:overflow-y-auto ${menuColapsado ? "md:hidden" : "md:flex"}`}>
        <div className="mb-5 flex items-center justify-between py-2 pl-3">
          <Marca claro />
          <BotaoOcultarValores claro />
        </div>
        <nav aria-label="Principal" className="flex flex-col gap-2">
          <ul className="flex flex-col gap-2">
            {itensAcessoRapido.map(({ caminho, rotulo, Icone }) => (
              <li key={caminho}>
                <NavLink to={caminho} end={caminho === '/'}
                  className={({ isActive }) => `${base} ${isActive ? 'bg-azul text-white shadow-sm' : 'text-blue-100 hover:bg-white/10'}`}>
                  <Icone />{rotulo === 'Análises' || rotulo === 'Relatórios' ? rotulo : rotulo}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <PerfilSidebar pathname={pathname} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between bg-marinho pb-2 pl-4 pr-2 pt-[max(0.5rem,env(safe-area-inset-top))] md:hidden">
          <Marca tamanho={28} claro />
          <div className="flex items-center"><BotaoOcultarValores claro /></div>
        </header>
        {modoFatura && (
          <div className="hidden justify-end px-4 pt-3 md:flex md:px-8">
            <button type="button" aria-expanded={!menuColapsado} aria-controls="navegacao-lateral"
              onClick={() => setMenuColapsado((v) => !v)}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
              aria-label={menuColapsado ? "Mostrar menu lateral" : "Ocultar menu lateral"}>
              <span aria-hidden="true">{menuColapsado ? "☰" : "‹"}</span>{menuColapsado ? "Mostrar menu" : "Ocultar menu"}
            </button>
          </div>
        )}
        <main className={`mx-auto w-full flex-1 p-4 transition-[max-width,padding] duration-300 ${modoFatura ? "max-w-none pb-4" : "max-w-6xl pb-28"} md:p-8 md:pb-8`}>
          <Suspense fallback={<p role="status" className="text-sm text-slate-500">Carregando…</p>}><Outlet /></Suspense>
        </main>
      </div>

      <nav aria-label="Principal no celular"
        className={`fixed inset-x-0 bottom-0 z-10 flex border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden ${modoFatura ? "hidden" : ""}`}>
        {itensFixosNoCelular.map(({ caminho, curto, Icone }) => (
          <NavLink key={caminho} to={caminho} end={caminho === '/'}
            className={({ isActive }) => `flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-0.5 text-[11px] font-medium ${
              isActive && !maisAberto ? 'text-azul' : 'text-slate-500'}`}>
            <Icone />{curto}
          </NavLink>
        ))}
        <button ref={botaoMais} type="button" aria-haspopup="dialog" aria-expanded={maisAberto}
          onClick={() => setMaisAberto(true)}
          className={`flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-0.5 text-[11px] font-medium ${
            maisAtivo ? 'text-azul' : 'text-slate-500'}`}>
          <IconeMais />Mais
        </button>
      </nav>
      {maisAberto && <MenuMais aoFechar={fecharMais} />}
    </div>
  )
}
