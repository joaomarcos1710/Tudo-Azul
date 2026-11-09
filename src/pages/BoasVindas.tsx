import { Link } from 'react-router-dom'
import { Marca } from '../components/layout/Marca'
import { Versao } from '../components/layout/Versao'

function IconeCheck() {
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-5 w-5"><path d="m5 12.5 4.2 4.2L19 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
}

function IconeCarteira() {
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-6 w-6"><rect x="3" y="6" width="18" height="14" rx="3" stroke="currentColor" strokeWidth="1.7"/><path d="M3 9h18M16 14h2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/><path d="M6 6V4.8A1.8 1.8 0 0 1 7.8 3H19" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>
}

function IconeFamilia() {
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-6 w-6"><circle cx="9" cy="8" r="3" stroke="currentColor" strokeWidth="1.7"/><path d="M3.5 19v-1.2A4.8 4.8 0 0 1 8.3 13h1.4a4.8 4.8 0 0 1 4.8 4.8V19M16 5.5a3 3 0 0 1 0 5.8M17 13.5a4.4 4.4 0 0 1 3.5 4.3V19" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>
}

function IconeGrafico() {
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-6 w-6"><path d="M4 19V5M4 19h17M7 15l4-4 3 2 6-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/><path d="M16 6h4v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
}

function IconeAlvo() {
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-6 w-6"><circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.7"/><circle cx="12" cy="12" r="4.5" stroke="currentColor" strokeWidth="1.7"/><circle cx="12" cy="12" r="1" fill="currentColor"/></svg>
}

function PreviaPainel() {
  return (
    <div className="relative mx-auto w-full max-w-[31rem]">
      <div aria-hidden="true" className="absolute -inset-5 rounded-[2rem] bg-celeste/20 blur-3xl" />
      <div className="relative overflow-hidden rounded-3xl border border-white/70 bg-white p-5 shadow-[0_30px_90px_rgba(11,31,70,0.18)] sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-azul"><IconeCarteira /></span>
            <div><p className="text-sm font-bold text-marinho">Visão da família</p><p className="text-xs text-slate-500">Tudo em um só lugar</p></div>
          </div>
          <span className="rounded-full bg-blue-50 px-3 py-1 text-[11px] font-semibold text-azul">Prévia ilustrativa</span>
        </div>
        <div className="mt-6 rounded-2xl bg-[#F5F8FD] p-4 sm:p-5">
          <p className="text-xs font-medium text-slate-500">Acompanhamento financeiro</p>
          <div className="mt-1 flex items-end justify-between gap-3">
            <p className="text-2xl font-bold tracking-tight text-marinho sm:text-3xl">Mais clareza.</p>
            <span className="rounded-lg bg-white px-2.5 py-1 text-[11px] font-medium text-slate-500">Mês atual</span>
          </div>
          <svg viewBox="0 0 440 150" role="img" aria-label="Gráfico ilustrativo de evolução financeira" className="mt-5 h-auto w-full overflow-visible">
            <defs><linearGradient id="areaAzul" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#48B5FF" stopOpacity=".28"/><stop offset="100%" stopColor="#48B5FF" stopOpacity="0"/></linearGradient></defs>
            {[28,68,108].map((y) => <line key={y} x1="8" y1={y} x2="432" y2={y} stroke="#E5ECF5" strokeDasharray="4 5"/>)}
            <path d="M8 112 C48 104 58 91 94 96 S145 83 178 88 S235 54 270 65 S327 38 358 46 S407 20 432 25 L432 140 L8 140Z" fill="url(#areaAzul)"/>
            <path d="M8 112 C48 104 58 91 94 96 S145 83 178 88 S235 54 270 65 S327 38 358 46 S407 20 432 25" fill="none" stroke="#2563EB" strokeWidth="3.5" strokeLinecap="round"/>
            <circle cx="432" cy="25" r="5" fill="#2563EB" stroke="white" strokeWidth="3"/>
          </svg>
          <div className="mt-1 flex justify-between text-[10px] text-slate-400"><span>Início do período</span><span>Agora</span></div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-slate-100 p-4"><div className="flex items-center gap-2 text-xs text-slate-500"><span className="h-2 w-2 rounded-full bg-azul"/>Organização</div><p className="mt-2 text-sm font-bold text-marinho">Contas e cartões</p><p className="mt-1 text-xs text-slate-500">Tudo acompanhado</p></div>
          <div className="rounded-2xl border border-slate-100 p-4"><div className="flex items-center gap-2 text-xs text-slate-500"><span className="h-2 w-2 rounded-full bg-[#0D9488]"/>Planejamento</div><p className="mt-2 text-sm font-bold text-marinho">Metas e orçamento</p><p className="mt-1 text-xs text-slate-500">Decisões com contexto</p></div>
        </div>
        <div className="mt-4 flex items-center gap-2 rounded-xl bg-blue-50/80 px-3 py-2.5 text-xs text-blue-900"><span className="text-azul"><IconeCheck /></span> Um panorama para conversar e decidir em família.</div>
      </div>
    </div>
  )
}

const recursos = [
  { Icone: IconeCarteira, titulo: 'Contas e cartões', descricao: 'Acompanhe saldos, faturas, lançamentos e compromissos em um só lugar.' },
  { Icone: IconeAlvo, titulo: 'Planejamento com propósito', descricao: 'Organize orçamentos, recorrências e reservas para o que importa.' },
  { Icone: IconeGrafico, titulo: 'Patrimônio em perspectiva', descricao: 'Tenha uma visão mais ampla de investimentos, bens e dívidas.' },
  { Icone: IconeFamilia, titulo: 'Finanças em família', descricao: 'Compartilhe a organização financeira com quem participa das decisões.' },
]

export default function BoasVindas() {
  return (
    <div className="min-h-screen overflow-hidden bg-white text-marinho">
      <header className="relative z-10 mx-auto flex w-full max-w-7xl items-center justify-between px-5 py-5 sm:px-8 lg:px-12">
        <Link to="/" aria-label="Tudo Azul, página inicial"><Marca tamanho={38} /></Link>
        <nav aria-label="Acesso à conta" className="flex items-center gap-3">
          <Link to="/entrar" className="hidden min-h-11 items-center rounded-xl px-4 text-sm font-semibold text-marinho transition hover:bg-slate-100 sm:inline-flex">Entrar</Link>
          <Link to="/cadastro" className="inline-flex min-h-11 items-center justify-center rounded-xl bg-azul px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-azul">Criar conta</Link>
        </nav>
      </header>

      <main>
        <section className="relative isolate">
          <div aria-hidden="true" className="absolute inset-x-0 top-0 -z-10 h-[42rem] bg-gradient-to-br from-[#F4F9FF] via-white to-[#EAF5FF]" />
          <div aria-hidden="true" className="absolute -right-28 top-10 -z-10 h-72 w-72 rounded-full bg-celeste/20 blur-3xl" />
          <div className="mx-auto grid max-w-7xl items-center gap-12 px-5 pb-20 pt-10 sm:px-8 sm:pb-24 sm:pt-16 lg:grid-cols-[1.02fr_0.98fr] lg:gap-10 lg:px-12 lg:pb-28 lg:pt-20">
            <div className="max-w-2xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-blue-100 bg-white/80 px-3 py-1.5 text-xs font-semibold text-azul shadow-sm"><span className="h-2 w-2 rounded-full bg-celeste"/> Organização financeira para a vida real</div>
              <h1 className="mt-6 text-[2.65rem] font-bold leading-[1.08] tracking-[-0.045em] text-marinho sm:text-5xl lg:text-[3.65rem]">Sua vida financeira, <span className="text-azul">em equilíbrio.</span></h1>
              <p className="mt-6 max-w-xl text-base leading-7 text-slate-600 sm:text-lg sm:leading-8">Mais clareza para organizar o dinheiro, planejar os próximos passos e cuidar do patrimônio. Tudo em um só lugar, com espaço para a família participar.</p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
                <Link to="/cadastro" className="inline-flex min-h-12 items-center justify-center rounded-xl bg-azul px-6 text-sm font-semibold text-white shadow-lg shadow-blue-600/20 transition hover:-translate-y-0.5 hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-azul">Começar agora <span aria-hidden="true" className="ml-2 text-lg">→</span></Link>
                <Link to="/entrar" className="inline-flex min-h-12 items-center justify-center rounded-xl border border-slate-200 bg-white px-6 text-sm font-semibold text-marinho transition hover:border-blue-200 hover:bg-blue-50">Já tenho uma conta</Link>
              </div>
              <div className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-xs font-medium text-slate-500">
                {['Contas e cartões', 'Planejamento familiar', 'Patrimônio'].map((item) => <span key={item} className="inline-flex items-center gap-1.5"><span className="text-azul"><IconeCheck /></span>{item}</span>)}
              </div>
            </div>
            <PreviaPainel />
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-5 pb-20 sm:px-8 lg:px-12 lg:pb-24">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-azul">Tudo conectado</p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-marinho sm:text-4xl">Uma visão mais completa do seu dinheiro.</h2>
            <p className="mt-4 text-base leading-7 text-slate-600">Da rotina do mês às decisões de longo prazo, acompanhe o que acontece e planeje o que vem pela frente.</p>
          </div>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {recursos.map(({ Icone, titulo, descricao }) => (
              <article key={titulo} className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-[0_5px_25px_rgba(11,31,70,0.04)] transition hover:-translate-y-1 hover:shadow-[0_14px_35px_rgba(11,31,70,0.08)]">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-azul"><Icone /></span>
                <h3 className="mt-5 text-base font-bold text-marinho">{titulo}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{descricao}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="mx-5 mb-16 overflow-hidden rounded-[2rem] bg-marinho px-6 py-12 text-center text-white sm:mx-8 sm:px-10 sm:py-16 lg:mx-auto lg:mb-20 lg:max-w-7xl">
          <div aria-hidden="true" className="mx-auto mb-5 h-1 w-12 rounded-full bg-celeste" />
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">O próximo passo começa com clareza.</h2>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-blue-100 sm:text-base">Comece a organizar suas finanças e construa uma visão mais tranquila do futuro.</p>
          <Link to="/cadastro" className="mt-7 inline-flex min-h-12 items-center justify-center rounded-xl bg-white px-6 text-sm font-bold text-marinho transition hover:bg-blue-50">Criar minha conta <span aria-hidden="true" className="ml-2">→</span></Link>
        </section>
      </main>

      <footer className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 border-t border-slate-100 px-5 py-7 sm:flex-row sm:px-8 lg:px-12">
        <Marca tamanho={30} />
        <p className="text-center text-xs text-slate-500">Organização financeira com mais clareza, equilíbrio e parceria.</p>
        <Versao className="text-slate-400" />
      </footer>
    </div>
  )
}
