import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useFinanceStore, CartaoCredito, MetaSonho } from '../lib/store'
import { formatBRL, formatMonth, currentMonth } from '../lib/format'
import { Button } from '../components/ui/Button'
import { ModalNovoLancamento } from '../components/modals/ModalNovoLancamento'
import { ModalPagarFatura } from '../components/modals/ModalPagarFatura'
import { ModalAporteMeta } from '../components/modals/ModalAporteMeta'
import { BancoLogo, BandeiraCartaoLogo, MoedaBadge } from '../components/ui/BancoLogo'
import {
  Wallet, TrendingUp, TrendingDown, CreditCard, ChevronLeft, ChevronRight,
  Plus, CheckCircle2, Clock, Sparkles, ArrowRight, Target,
  AlertTriangle, Layers, BarChart3
} from 'lucide-react'

export default function VisaoGeral() {
  const [mesSelecionado, setMesSelecionado] = useState(currentMonth())
  const [modalNovoAberto, setModalNovoAberto] = useState(false)
  const [modalFaturaAberto, setModalFaturaAberto] = useState(false)
  const [cartaoFatura, setCartaoFatura] = useState<CartaoCredito | null>(null)
  const [modalAporteAberto, setModalAporteAberto] = useState(false)
  const [metaAporte, setMetaAporte] = useState<MetaSonho | null>(null)
  const [filtroMoeda, setFiltroMoeda] = useState<'todas' | 'BRL' | 'USD' | 'EUR'>('todas')

  const {
    contas,
    cartoes,
    categorias,
    lancamentos,
    metas,
    saldoTotalContas,
    calcularSaldoConta,
    calcularSaldoContaEmBRL,
    calcularFaturaCartao,
    calcularTotaisMes,
    calcularConsumoOrcamento,
    toggleStatusLancamento,
  } = useFinanceStore()

  // Navegação de meses
  const mudarMes = (delta: number) => {
    const [ano, mes] = mesSelecionado.split('-').map(Number)
    const d = new Date(ano, mes - 1 + delta, 1)
    const novoAno = d.getFullYear()
    const novoMes = String(d.getMonth() + 1).padStart(2, '0')
    setMesSelecionado(`${novoAno}-${novoMes}`)
  }

  const totais = calcularTotaisMes(mesSelecionado)

  // Evolução Mensal (Últimos 6 meses para visualização)
  const evolucaoMensal = useMemo(() => {
    const [ano, mes] = mesSelecionado.split('-').map(Number)
    const lista = []

    for (let i = 5; i >= 0; i--) {
      const d = new Date(ano, mes - 1 - i, 1)
      const a = d.getFullYear()
      const m = String(d.getMonth() + 1).padStart(2, '0')
      const ym = `${a}-${m}`

      let rec = 0
      let desp = 0

      lancamentos.forEach(l => {
        if (l.data.startsWith(ym) && l.tipo !== 'transferencia') {
          if (l.tipo === 'receita') rec += l.valor
          else if (l.tipo === 'despesa') desp += l.valor
        }
      })

      const sobra = rec - desp
      const nomeMesAbrev = d.toLocaleDateString('pt-BR', { month: 'short' })

      lista.push({
        anoMes: ym,
        rotulo: nomeMesAbrev,
        ano: a,
        receitas: rec,
        despesas: desp,
        sobra,
        ativo: ym === mesSelecionado,
      })
    }

    return lista
  }, [lancamentos, mesSelecionado])

  const maiorValorEvolucao = Math.max(
    ...evolucaoMensal.map(m => Math.max(m.receitas, m.despesas)),
    1000,
  )

  // Filtragem de contas bancárias (uma embaixo da outra)
  const contasFiltradas = contas.filter(c => {
    if (!c.ativa) return false
    if (filtroMoeda === 'todas') return true
    return (c.moeda || 'BRL') === filtroMoeda
  })

  // Totais separados por moeda
  const totalBRL = contas
    .filter(c => c.ativa && (c.moeda === 'BRL' || !c.moeda))
    .reduce((acc, c) => acc + calcularSaldoConta(c.id), 0)

  const totalUSD = contas
    .filter(c => c.ativa && c.moeda === 'USD')
    .reduce((acc, c) => acc + calcularSaldoConta(c.id), 0)

  const totalEUR = contas
    .filter(c => c.ativa && c.moeda === 'EUR')
    .reduce((acc, c) => acc + calcularSaldoConta(c.id), 0)

  // Lançamentos recentes do mês
  const lancamentosDoMes = lancamentos
    .filter(l => l.data.startsWith(mesSelecionado))
    .slice(0, 8)

  return (
    <div className="space-y-6">
      {/* Topo / Barra de controle com Navegação de Mês e Ações */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-marinho">Visão Geral & Dashboard</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Evolução mensal do patrimônio, contas bancárias nacionais & internacionais e fluxo familiar
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Seletor de Mês */}
          <div className="flex items-center rounded-xl bg-white border border-slate-200 shadow-sm p-1">
            <button
              type="button"
              onClick={() => mudarMes(-1)}
              className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 transition"
              title="Mês anterior"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="px-3 text-xs font-semibold text-slate-700 capitalize min-w-[130px] text-center">
              {formatMonth(mesSelecionado)}
            </span>
            <button
              type="button"
              onClick={() => mudarMes(1)}
              className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 transition"
              title="Próximo mês"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <Button
            variante="primario"
            onClick={() => setModalNovoAberto(true)}
            className="flex items-center gap-1.5 shadow-sm text-xs"
          >
            <Plus className="h-4 w-4" /> Novo Lançamento
          </Button>
        </div>
      </div>

      {/* Banner Executivo com Background Bancário */}
      <div className="relative overflow-hidden rounded-3xl border border-slate-800 bg-[#0A192F] text-white shadow-xl">
        <img
          src="/src/assets/images/bank_app_bg_1791936218344.jpg"
          alt="Fintech banking background"
          referrerPolicy="no-referrer"
          className="absolute inset-0 h-full w-full object-cover object-center opacity-60 mix-blend-screen pointer-events-none"
        />
        <div className="relative z-10 p-6 md:p-8 flex flex-col md:flex-row md:items-center justify-between gap-6 backdrop-blur-[2px]">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 text-xs font-semibold">
              <span className="h-2 w-2 rounded-full bg-cyan-400 animate-pulse" />
              Finanças Familiares • Tudo Azul
            </div>
            <h2 className="text-xl md:text-2xl font-bold tracking-tight text-white">
              Patrimônio Consolidado em Contas: {formatBRL(saldoTotalContas)}
            </h2>
            <div className="flex flex-wrap items-center gap-3 text-xs text-cyan-100/90 pt-1">
              <span className="bg-white/10 px-2.5 py-1 rounded-md border border-white/10">
                🇧🇷 BRL: <strong>{formatBRL(totalBRL)}</strong>
              </span>
              {totalUSD > 0 && (
                <span className="bg-emerald-500/20 text-emerald-300 px-2.5 py-1 rounded-md border border-emerald-400/30">
                  🇺🇸 USD: <strong>$ {totalUSD.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong>
                </span>
              )}
              {totalEUR > 0 && (
                <span className="bg-blue-500/20 text-blue-300 px-2.5 py-1 rounded-md border border-blue-400/30">
                  🇪🇺 EUR: <strong>€ {totalEUR.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong>
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => setModalNovoAberto(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-2.5 text-xs md:text-sm font-semibold text-white shadow-lg shadow-cyan-500/25 hover:from-cyan-400 hover:to-blue-500 transition"
            >
              <Plus className="h-4 w-4" /> Novo Lançamento
            </button>
            <Link
              to="/lancamentos"
              className="inline-flex items-center gap-2 rounded-xl bg-white/10 hover:bg-white/20 border border-white/15 px-4 py-2.5 text-xs md:text-sm font-semibold text-white backdrop-blur transition"
            >
              Extrato <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </div>

      {/* Grid de KPIs Heróicos */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Saldo Atual Total */}
        <div className="rounded-2xl bg-white p-5 border border-slate-200/80 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Saldo Consolidado
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-azul">
              <Wallet className="h-4 w-4" />
            </div>
          </div>
          <div>
            <div className="text-2xl font-bold tracking-tight text-marinho">
              {formatBRL(saldoTotalContas)}
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Soma de {contas.filter(c => c.ativa).length} contas ativas (com conversão)
            </p>
          </div>
        </div>

        {/* Saldo Projetado Fim do Mês */}
        <div className="rounded-2xl bg-white p-5 border border-slate-200/80 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Saldo Projetado
            </span>
            <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${
              totais.saldoProjetadoFimDoMes >= 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'
            }`}>
              <Sparkles className="h-4 w-4" />
            </div>
          </div>
          <div>
            <div className={`text-2xl font-bold tracking-tight ${
              totais.saldoProjetadoFimDoMes >= 0 ? 'text-emerald-700' : 'text-rose-600'
            }`}>
              {formatBRL(totais.saldoProjetadoFimDoMes)}
            </div>
            <div className="flex items-center gap-1.5 mt-1">
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                totais.saldoProjetadoFimDoMes >= 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
              }`}>
                {totais.saldoProjetadoFimDoMes >= 0 ? '✓ No Azul' : '⚠ Atenção'}
              </span>
              <span className="text-xs text-slate-500">fim de {formatMonth(mesSelecionado)}</span>
            </div>
          </div>
        </div>

        {/* Receitas do Mês */}
        <div className="rounded-2xl bg-white p-5 border border-slate-200/80 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Receitas de {formatMonth(mesSelecionado)}
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
              <TrendingUp className="h-4 w-4" />
            </div>
          </div>
          <div>
            <div className="text-2xl font-bold tracking-tight text-emerald-600">
              {formatBRL(totais.totalReceitas)}
            </div>
            <div className="flex items-center justify-between text-xs text-slate-500 mt-1">
              <span>Pago: {formatBRL(totais.receitasPagas)}</span>
              {totais.receitasPendentes > 0 && (
                <span className="text-amber-600 font-medium">A receber: {formatBRL(totais.receitasPendentes)}</span>
              )}
            </div>
          </div>
        </div>

        {/* Despesas do Mês */}
        <div className="rounded-2xl bg-white p-5 border border-slate-200/80 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Despesas de {formatMonth(mesSelecionado)}
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-50 text-rose-600">
              <TrendingDown className="h-4 w-4" />
            </div>
          </div>
          <div>
            <div className="text-2xl font-bold tracking-tight text-rose-600">
              {formatBRL(totais.totalDespesas)}
            </div>
            <div className="flex items-center justify-between text-xs text-slate-500 mt-1">
              <span>Pago: {formatBRL(totais.despesasPagas)}</span>
              {totais.despesasPendentes > 0 && (
                <span className="text-amber-600 font-medium">A pagar: {formatBRL(totais.despesasPendentes)}</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* SEÇÃO 1: EVOLUÇÃO MENSAL (Solicitação do Usuário) */}
      <div className="rounded-2xl bg-white p-6 border border-slate-200/80 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-azul" />
            <div>
              <h2 className="text-base font-bold text-marinho">Evolução Mensal (Receitas vs Despesas)</h2>
              <p className="text-xs text-slate-500">Comparativo histórico mês a mês do fluxo de caixa familiar</p>
            </div>
          </div>

          <div className="flex items-center gap-3 text-xs">
            <div className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-sm bg-emerald-500" />
              <span className="text-slate-600 font-medium">Receitas</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-sm bg-rose-500" />
              <span className="text-slate-600 font-medium">Despesas</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-sm bg-blue-600" />
              <span className="text-slate-600 font-medium">Sobra/Poupança</span>
            </div>
          </div>
        </div>

        {/* Barras de Comparação Mês a Mês */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3 pt-2">
          {evolucaoMensal.map(item => {
            const percRec = (item.receitas / maiorValorEvolucao) * 100
            const percDesp = (item.despesas / maiorValorEvolucao) * 100

            return (
              <div
                key={item.anoMes}
                onClick={() => setMesSelecionado(item.anoMes)}
                className={`cursor-pointer rounded-xl p-3 border transition flex flex-col justify-between ${
                  item.ativo
                    ? 'border-azul bg-blue-50/50 shadow-sm ring-1 ring-azul'
                    : 'border-slate-200/70 hover:border-slate-300 bg-slate-50/30'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className={`text-xs font-bold capitalize ${item.ativo ? 'text-azul' : 'text-slate-700'}`}>
                    {item.rotulo}
                  </span>
                  <span className="text-[10px] text-slate-400">{item.ano}</span>
                </div>

                {/* Altura das barras */}
                <div className="h-28 flex items-end justify-center gap-2 py-1">
                  {/* Barra Receita */}
                  <div className="w-4 bg-slate-100 rounded-t-md h-full flex items-end" title={`Receitas: ${formatBRL(item.receitas)}`}>
                    <div
                      className="w-full bg-emerald-500 rounded-t-md transition-all duration-500"
                      style={{ height: `${Math.max(4, percRec)}%` }}
                    />
                  </div>

                  {/* Barra Despesa */}
                  <div className="w-4 bg-slate-100 rounded-t-md h-full flex items-end" title={`Despesas: ${formatBRL(item.despesas)}`}>
                    <div
                      className="w-full bg-rose-500 rounded-t-md transition-all duration-500"
                      style={{ height: `${Math.max(4, percDesp)}%` }}
                    />
                  </div>
                </div>

                {/* Sobra / Saldo do mês */}
                <div className="pt-2 border-t border-slate-100 text-center">
                  <span className="text-[10px] text-slate-400 block">Sobra</span>
                  <span
                    className={`text-xs font-bold ${
                      item.sobra >= 0 ? 'text-emerald-700' : 'text-rose-600'
                    }`}
                  >
                    {formatBRL(item.sobra)}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* SEÇÃO 2: CONTAS BANCÁRIAS (UMA EMBAIXO DA OUTRA) COM SUPORTE A DÓLAR E EURO */}
      <div className="rounded-2xl bg-white p-6 border border-slate-200/80 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <Wallet className="h-5 w-5 text-azul" />
            <div>
              <h2 className="text-base font-bold text-marinho">Contas Bancárias & Dinheiro</h2>
              <p className="text-xs text-slate-500">
                Lista vertical de contas ativas com conversão de moedas (Dólar USD e Euro EUR)
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Filtro de Moeda */}
            <div className="flex items-center p-0.5 rounded-lg bg-slate-100 text-xs font-medium">
              <button
                type="button"
                onClick={() => setFiltroMoeda('todas')}
                className={`px-2.5 py-1 rounded-md transition ${filtroMoeda === 'todas' ? 'bg-white shadow-xs font-bold text-marinho' : 'text-slate-500'}`}
              >
                Todas
              </button>
              <button
                type="button"
                onClick={() => setFiltroMoeda('BRL')}
                className={`px-2.5 py-1 rounded-md transition ${filtroMoeda === 'BRL' ? 'bg-white shadow-xs font-bold text-marinho' : 'text-slate-500'}`}
              >
                🇧🇷 BRL
              </button>
              <button
                type="button"
                onClick={() => setFiltroMoeda('USD')}
                className={`px-2.5 py-1 rounded-md transition ${filtroMoeda === 'USD' ? 'bg-white shadow-xs font-bold text-emerald-700' : 'text-slate-500'}`}
              >
                🇺🇸 USD
              </button>
              <button
                type="button"
                onClick={() => setFiltroMoeda('EUR')}
                className={`px-2.5 py-1 rounded-md transition ${filtroMoeda === 'EUR' ? 'bg-white shadow-xs font-bold text-blue-700' : 'text-slate-500'}`}
              >
                🇪🇺 EUR
              </button>
            </div>

            <Link
              to="/contas"
              className="text-xs font-semibold text-azul hover:underline flex items-center gap-1 shrink-0"
            >
              Gerenciar contas <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>

        {/* LISTA VERTICAL: UMA CONTA EMBAIXO DA OUTRA */}
        <div className="space-y-3">
          {contasFiltradas.map(conta => {
            const saldoOriginal = calcularSaldoConta(conta.id)
            const saldoBRL = calcularSaldoContaEmBRL(conta.id)
            const moeda = conta.moeda || 'BRL'
            const isEstrangeira = moeda === 'USD' || moeda === 'EUR'
            const cotacao = conta.cotacao || (moeda === 'USD' ? 5.65 : moeda === 'EUR' ? 6.15 : 1)

            return (
              <div
                key={conta.id}
                className="rounded-xl border border-slate-200/90 p-4 bg-white hover:border-azul/50 hover:shadow-xs transition flex flex-col md:flex-row md:items-center justify-between gap-4"
              >
                {/* Lado Esquerdo: Logo do Banco (bancos-brasil) e Informações */}
                <div className="flex items-center gap-3.5 min-w-0">
                  <BancoLogo banco={conta.instituicao || conta.nome} tamanho="lg" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm font-bold text-slate-900 truncate">{conta.nome}</h3>
                      <MoedaBadge moeda={moeda} />
                      <span className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                        {conta.tipo}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 flex items-center gap-2 mt-0.5">
                      <span>{conta.instituicao}</span>
                      {conta.codigoBanco && (
                        <>
                          <span>•</span>
                          <span className="font-mono text-[11px]">COMPE {conta.codigoBanco}</span>
                        </>
                      )}
                      {isEstrangeira && (
                        <>
                          <span>•</span>
                          <span className="text-slate-600 font-medium">Cotação: R$ {cotacao.toFixed(2)}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Lado Direito: Saldos (Original + Convertido) e Ações */}
                <div className="flex items-center justify-between md:justify-end gap-6 pt-2 md:pt-0 border-t md:border-t-0 border-slate-100">
                  <div className="text-left md:text-right">
                    {/* Se for moeda estrangeira, mostra o saldo em USD/EUR e a conversão em BRL */}
                    {isEstrangeira ? (
                      <div>
                        <div className="text-base md:text-lg font-bold text-slate-900">
                          {moeda === 'USD' ? '$' : '€'} {saldoOriginal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {moeda}
                        </div>
                        <div className="text-xs text-slate-500 font-medium">
                          ≈ {formatBRL(saldoBRL)}
                        </div>
                      </div>
                    ) : (
                      <div>
                        <div className="text-base md:text-lg font-bold text-slate-900">
                          {formatBRL(saldoOriginal)}
                        </div>
                        <div className="text-[11px] text-slate-400">Saldo disponível em conta</div>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      variante="secundario"
                      onClick={() => setModalNovoAberto(true)}
                      className="!min-h-8 !px-2.5 !text-xs font-semibold text-azul"
                      title="Registrar lançamento nesta conta"
                    >
                      <Plus className="h-3.5 w-3.5" /> Lançar
                    </Button>
                    <Link
                      to="/lancamentos"
                      className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
                      title="Ver extrato"
                    >
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        <div className="pt-3 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-500 gap-2">
          <span>{contasFiltradas.length} contas listadas</span>
          <span className="font-semibold text-slate-700">
            Saldo Total Consolidado em Reais: <strong className="text-azul text-sm">{formatBRL(saldoTotalContas)}</strong>
          </span>
        </div>
      </div>

      {/* Seção 3: Faturas de Cartão de Crédito */}
      <div className="rounded-2xl bg-white p-5 border border-slate-200/80 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-azul" />
            <h2 className="text-base font-bold text-marinho">Cartões de Crédito & Faturas</h2>
          </div>
          <Link to="/contas" className="text-xs font-semibold text-azul hover:underline flex items-center gap-1">
            Gerenciar cartões <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {cartoes.map(cartao => {
            const fatura = calcularFaturaCartao(cartao.id, mesSelecionado)
            const limiteDisponivel = Math.max(0, cartao.limiteTotal - fatura)
            const percUtilizado = (fatura / cartao.limiteTotal) * 100

            return (
              <div
                key={cartao.id}
                className="rounded-xl border border-slate-200 p-4 bg-gradient-to-br from-slate-50 to-white hover:border-azul/50 transition space-y-3"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <BancoLogo banco={cartao.nome} tamanho="md" />
                    <div>
                      <div className="flex items-center gap-1.5">
                        <h3 className="text-sm font-bold text-slate-800">{cartao.nome}</h3>
                        <BandeiraCartaoLogo bandeira={cartao.bandeira} />
                      </div>
                      <p className="text-[11px] text-slate-500">
                        Fecha dia {cartao.diaFechamento} • Vence dia {cartao.diaVencimento}
                      </p>
                    </div>
                  </div>
                  <Button
                    variante="secundario"
                    className="!min-h-8 !px-3 !text-xs font-semibold"
                    onClick={() => {
                      setCartaoFatura(cartao)
                      setModalFaturaAberto(true)
                    }}
                  >
                    Pagar Fatura
                  </Button>
                </div>

                <div className="flex items-baseline justify-between pt-1">
                  <div>
                    <span className="text-xs text-slate-500">Fatura de {formatMonth(mesSelecionado)}:</span>
                    <p className="text-lg font-bold text-rose-600">{formatBRL(fatura)}</p>
                  </div>
                  <div className="text-right">
                    <span className="text-xs text-slate-500">Limite Disponível:</span>
                    <p className="text-xs font-semibold text-slate-700">{formatBRL(limiteDisponivel)}</p>
                  </div>
                </div>

                {/* Barra de Limite */}
                <div className="w-full bg-slate-200 rounded-full h-1.5 overflow-hidden">
                  <div
                    className={`h-full transition-all duration-300 ${
                      percUtilizado > 85 ? 'bg-rose-500' : percUtilizado > 60 ? 'bg-amber-500' : 'bg-azul'
                    }`}
                    style={{ width: `${Math.min(100, percUtilizado)}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Seção 4: Orçamentos do Mês + Sonhos/Metas (Lado a Lado) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Orçamentos por Categoria */}
        <div className="rounded-2xl bg-white p-5 border border-slate-200/80 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Target className="h-5 w-5 text-azul" />
              <h2 className="text-base font-bold text-marinho">Orçamentos do Mês</h2>
            </div>
            <Link to="/orcamentos" className="text-xs font-semibold text-azul hover:underline flex items-center gap-1">
              Ver todos <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          <div className="space-y-3">
            {categorias
              .filter(c => c.tipo === 'despesa')
              .slice(0, 4)
              .map(cat => {
                const consumo = calcularConsumoOrcamento(cat.id, mesSelecionado)
                if (!consumo.temOrcamento && consumo.totalGasto === 0) return null

                return (
                  <div key={cat.id} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-slate-800">{cat.nome}</span>
                      <span className="text-slate-500">
                        {formatBRL(consumo.totalGasto)} de {consumo.limite > 0 ? formatBRL(consumo.limite) : 'Sem teto'}
                      </span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                      <div
                        className={`h-full transition-all duration-300 ${
                          consumo.estourado
                            ? 'bg-rose-600'
                            : consumo.percentual > 80
                            ? 'bg-amber-500'
                            : 'bg-emerald-500'
                        }`}
                        style={{ width: `${Math.min(100, consumo.percentual)}%` }}
                      />
                    </div>
                    {consumo.estourado && (
                      <p className="text-[11px] font-semibold text-rose-600 flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" /> Orçamento estourado em {formatBRL(Math.abs(consumo.restante))}
                      </p>
                    )}
                  </div>
                )
              })}
          </div>
        </div>

        {/* Gerenciador de Sonhos & Metas */}
        <div className="rounded-2xl bg-white p-5 border border-slate-200/80 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-amber-500" />
              <h2 className="text-base font-bold text-marinho">Sonhos & Metas da Família</h2>
            </div>
            <Link to="/metas" className="text-xs font-semibold text-azul hover:underline flex items-center gap-1">
              Ver todos os sonhos <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          <div className="space-y-3">
            {metas.slice(0, 2).map(meta => {
              const perc = Math.min(100, (meta.valorAtual / meta.valorAlvo) * 100)
              return (
                <div key={meta.id} className="p-3.5 rounded-xl border border-slate-100 bg-slate-50/70 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-bold text-slate-800">{meta.titulo}</h3>
                      <p className="text-[11px] text-slate-500">
                        {formatBRL(meta.valorAtual)} de {formatBRL(meta.valorAlvo)} ({perc.toFixed(0)}%)
                      </p>
                    </div>
                    <Button
                      variante="secundario"
                      className="!min-h-7 !px-2.5 !text-xs font-medium"
                      onClick={() => {
                        setMetaAporte(meta)
                        setModalAporteAberto(true)
                      }}
                    >
                      + Guardar
                    </Button>
                  </div>
                  <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 transition-all duration-300"
                      style={{ width: `${perc}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Seção 5: Últimos Lançamentos com Toggle Rápido de Status */}
      <div className="rounded-2xl bg-white p-5 border border-slate-200/80 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-azul" />
            <h2 className="text-base font-bold text-marinho">Lançamentos Recentes</h2>
          </div>
          <Link to="/lancamentos" className="text-xs font-semibold text-azul hover:underline flex items-center gap-1">
            Abrir extrato completo <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        {lancamentosDoMes.length === 0 ? (
          <div className="py-8 text-center text-slate-500 text-sm">
            Nenhum lançamento registrado neste mês.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {lancamentosDoMes.map(l => {
              const cat = categorias.find(c => c.id === l.categoriaId)
              const conta = contas.find(c => c.id === l.contaId)
              const cartao = cartoes.find(c => c.id === l.cartaoId)

              return (
                <div key={l.id} className="py-3 flex items-center justify-between hover:bg-slate-50/80 px-2 rounded-lg transition">
                  <div className="flex items-center gap-3 min-w-0">
                    <button
                      type="button"
                      onClick={() => toggleStatusLancamento(l.id)}
                      title={l.status === 'pago' ? 'Marcar como pendente' : 'Marcar como pago'}
                      className={`h-7 w-7 rounded-full flex items-center justify-center transition shrink-0 ${
                        l.status === 'pago'
                          ? 'bg-emerald-100 text-emerald-600 hover:bg-emerald-200'
                          : 'bg-amber-100 text-amber-600 hover:bg-amber-200'
                      }`}
                    >
                      {l.status === 'pago' ? <CheckCircle2 className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
                    </button>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-800 truncate">{l.descricao}</p>
                      <div className="text-xs text-slate-500 flex items-center gap-1.5 flex-wrap">
                        <span>{l.data}</span>
                        <span>•</span>
                        <span>{cat?.nome || 'Geral'}</span>
                        <span>•</span>
                        <span className="inline-flex items-center gap-1 font-medium text-slate-700">
                          {cartao ? (
                            <>
                              <BancoLogo banco={cartao.nome} tamanho="sm" />
                              <span>{cartao.nome}</span>
                            </>
                          ) : conta ? (
                            <>
                              <BancoLogo banco={conta.instituicao || conta.nome} tamanho="sm" />
                              <span>{conta.nome}</span>
                            </>
                          ) : (
                            'Transferência'
                          )}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <span
                      className={`text-sm font-bold ${
                        l.tipo === 'receita'
                          ? 'text-emerald-600'
                          : l.tipo === 'transferencia'
                          ? 'text-blue-600'
                          : 'text-rose-600'
                      }`}
                    >
                      {l.tipo === 'receita' ? '+' : l.tipo === 'despesa' ? '-' : ''} {formatBRL(l.valor)}
                    </span>
                    <p className="text-[10px] text-slate-400 capitalize">{l.status}</p>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Modais Reativos */}
      <ModalNovoLancamento
        aberto={modalNovoAberto}
        aoFechar={() => setModalNovoAberto(false)}
      />

      <ModalPagarFatura
        aberto={modalFaturaAberto}
        aoFechar={() => setModalFaturaAberto(false)}
        cartao={cartaoFatura}
        mesAtual={mesSelecionado}
      />

      <ModalAporteMeta
        aberto={modalAporteAberto}
        aoFechar={() => setModalAporteAberto(false)}
        meta={metaAporte}
      />
    </div>
  )
}
