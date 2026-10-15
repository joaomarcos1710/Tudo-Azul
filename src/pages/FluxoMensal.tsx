import { useState, useMemo } from 'react'
import { useFinanceStore, Lancamento } from '../lib/store'
import { formatBRL, formatMonth, currentMonth } from '../lib/format'
import { Button } from '../components/ui/Button'
import { ModalNovoLancamento } from '../components/modals/ModalNovoLancamento'
import { ModalNovoParcelamento } from '../components/modals/ModalNovoParcelamento'
import { BancoLogo } from '../components/ui/BancoLogo'
import {
  TrendingDown, TrendingUp, ChevronLeft, ChevronRight,
  Plus, CheckCircle2, Clock, Tv, Home, RotateCcw,
  ShoppingBag, CreditCard, Receipt
} from 'lucide-react'

export default function FluxoMensal() {
  const { lancamentos, contas, cartoes, categorias, membros, toggleStatusLancamento } = useFinanceStore()
  const [mesSelecionado, setMesSelecionado] = useState(currentMonth())
  const [abaAtiva, setAbaAtiva] = useState<'gastos' | 'receitas'>('gastos')
  const [filtroGastos, setFiltroGastos] = useState<'todos' | 'fixos' | 'parcelas' | 'variaveis' | 'ressarcimentos'>('todos')
  const [modalNovoAberto, setModalNovoAberto] = useState(false)
  const [modalParcelamentoAberto, setModalParcelamentoAberto] = useState(false)

  const mudarMes = (delta: number) => {
    const [ano, mes] = mesSelecionado.split('-').map(Number)
    const d = new Date(ano, mes - 1 + delta, 1)
    const novoAno = d.getFullYear()
    const novoMes = String(d.getMonth() + 1).padStart(2, '0')
    setMesSelecionado(`${novoAno}-${novoMes}`)
  }

  // Filtragem dos lançamentos do mês
  const lancamentosDoMes = useMemo(() => {
    return lancamentos.filter(l => l.data.startsWith(mesSelecionado) && l.tipo !== 'transferencia')
  }, [lancamentos, mesSelecionado])

  // Despesas agrupadas incluindo parcelas de cartão e carnês
  const despesasAgrupadas = useMemo(() => {
    const fixos: Lancamento[] = []
    const assinaturas: Lancamento[] = []
    const variaveis: Lancamento[] = []
    const ressarcimentos: Lancamento[] = []
    const parcelasCartao: Lancamento[] = []
    const parcelasCarne: Lancamento[] = []

    lancamentosDoMes.forEach(l => {
      if (l.tipo !== 'despesa') return

      // É parcela de cartão ou carnê?
      const isCarne = l.tipoParcelamento === 'carne' || (l.descricao.toLowerCase().includes('carnê') || l.descricao.toLowerCase().includes('crediário'))
      const isCartaoParc = l.cartaoId && l.totalParcelas && l.totalParcelas > 1
      const isParcGenerica = (l.totalParcelas && l.totalParcelas > 1) || l.tipoParcelamento === 'cartao'

      if (isCarne) {
        parcelasCarne.push(l)
        return
      }

      if (isCartaoParc || isParcGenerica) {
        parcelasCartao.push(l)
        return
      }

      const sub = l.subtipoDespesa || (l.recorrente ? 'fixo' : 'variavel')
      if (sub === 'fixo') fixos.push(l)
      else if (sub === 'assinatura') assinaturas.push(l)
      else if (sub === 'ressarcimento') ressarcimentos.push(l)
      else variaveis.push(l)
    })

    const somar = (lista: Lancamento[]) => lista.reduce((acc, i) => acc + i.valor, 0)

    const todasParcelas = [...parcelasCartao, ...parcelasCarne]
    const totalGeral = somar([...fixos, ...assinaturas, ...variaveis, ...ressarcimentos, ...todasParcelas])

    // Cálculo da dívida futura de parcelas
    const dividaFuturaTotal = todasParcelas.reduce((acc, p) => {
      const rest = (p.totalParcelas || 1) - (p.parcelaAtual || 1)
      return acc + (rest * p.valor)
    }, 0)

    return {
      fixos: { lista: fixos, total: somar(fixos) },
      assinaturas: { lista: assinaturas, total: somar(assinaturas) },
      variaveis: { lista: variaveis, total: somar(variaveis) },
      ressarcimentos: { lista: ressarcimentos, total: somar(ressarcimentos) },
      parcelasCartao: { lista: parcelasCartao, total: somar(parcelasCartao) },
      parcelasCarne: { lista: parcelasCarne, total: somar(parcelasCarne) },
      todasParcelas: { lista: todasParcelas, total: somar(todasParcelas), dividaFuturaTotal },
      totalGeral,
    }
  }, [lancamentosDoMes])

  // Receitas agrupadas
  const receitasAgrupadas = useMemo(() => {
    const salarios: Lancamento[] = []
    const extras: Lancamento[] = []
    const investimentos: Lancamento[] = []
    const reembolsos: Lancamento[] = []

    lancamentosDoMes.forEach(l => {
      if (l.tipo !== 'receita') return
      const sub = l.subtipoReceita || 'salario'
      if (sub === 'salario') salarios.push(l)
      else if (sub === 'extra') extras.push(l)
      else if (sub === 'investimento') investimentos.push(l)
      else reembolsos.push(l)
    })

    const somar = (lista: Lancamento[]) => lista.reduce((acc, i) => acc + i.valor, 0)

    return {
      salarios: { lista: salarios, total: somar(salarios) },
      extras: { lista: extras, total: somar(extras) },
      investimentos: { lista: investimentos, total: somar(investimentos) },
      reembolsos: { lista: reembolsos, total: somar(reembolsos) },
      totalGeral: somar([...salarios, ...extras, ...investimentos, ...reembolsos]),
    }
  }, [lancamentosDoMes])

  const renderCardParcela = (l: Lancamento) => {
    const isCarne = l.tipoParcelamento === 'carne' || l.descricao.toLowerCase().includes('carnê') || l.descricao.toLowerCase().includes('crediário')
    const cartao = cartoes.find(c => c.id === l.cartaoId)
    const conta = contas.find(c => c.id === l.contaId)
    const cat = categorias.find(c => c.id === l.categoriaId)
    const membro = membros.find(m => m.id === l.membroId)

    const atual = l.parcelaAtual || 1
    const total = l.totalParcelas || 1
    const progresso = Math.min(100, Math.round((atual / total) * 100))
    const parcelasRestantes = Math.max(0, total - atual)
    const saldoRestante = parcelasRestantes * l.valor

    return (
      <div
        key={l.id}
        className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm hover:shadow-md transition-all space-y-3"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {isCarne ? (
              <div className="h-10 w-10 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center shrink-0 shadow-sm border border-amber-200">
                <Receipt className="h-5 w-5" />
              </div>
            ) : cartao ? (
              <BancoLogo banco={cartao.nome} tamanho="lg" />
            ) : (
              <div className="h-10 w-10 rounded-xl bg-blue-100 text-blue-800 flex items-center justify-center shrink-0 shadow-sm border border-blue-200">
                <CreditCard className="h-5 w-5" />
              </div>
            )}

            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                    isCarne
                      ? 'bg-amber-100 text-amber-800 border border-amber-200'
                      : 'bg-blue-100 text-blue-800 border border-blue-200'
                  }`}
                >
                  {isCarne ? 'Carnê / Crediário' : 'Cartão de Crédito'}
                </span>
                <span className="text-xs font-semibold text-slate-400">
                  Vence: {l.data.slice(8, 10)}/{l.data.slice(5, 7)}
                </span>
              </div>
              <h4 className="font-bold text-slate-900 truncate text-sm mt-0.5">
                {l.descricao}
              </h4>
              <p className="text-xs text-slate-500">
                {isCarne
                  ? `Débito: ${conta?.nome || 'Conta bancária'} • ${cat?.nome || 'Compras'}`
                  : `${cartao?.nome || 'Cartão'} • ${cat?.nome || 'Compras'}`}
                {membro ? ` • ${membro.nome.split(' ')[0]}` : ''}
              </p>
            </div>
          </div>

          <div className="text-right shrink-0">
            <span className="text-base font-black text-slate-900">
              {formatBRL(l.valor)}
            </span>
            <span className="block text-[10px] text-slate-400">/mês</span>
          </div>
        </div>

        {/* Barra de Progresso das Parcelas */}
        <div className="space-y-1.5 pt-1 border-t border-slate-100">
          <div className="flex items-center justify-between text-xs font-semibold">
            <span className="text-slate-700">
              Parcela <strong className="text-blue-600">{atual}</strong> de {total}
            </span>
            <span className="text-slate-500 text-[11px]">
              {progresso}% quitado
            </span>
          </div>

          <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden p-0.5 border border-slate-200/60">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                isCarne ? 'bg-gradient-to-r from-amber-400 to-amber-600' : 'bg-gradient-to-r from-blue-500 to-indigo-600'
              }`}
              style={{ width: `${progresso}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-[11px] text-slate-500 pt-0.5">
            <span>
              Restam <strong>{parcelasRestantes}x</strong> de {formatBRL(l.valor)}
            </span>
            <span className="font-semibold text-slate-700">
              Saldo restante: {formatBRL(saldoRestante)}
            </span>
          </div>
        </div>

        {/* Rodapé do Card com Ação de Pagamento */}
        <div className="flex items-center justify-between pt-2 border-t border-slate-100/80">
          <button
            type="button"
            onClick={() => toggleStatusLancamento(l.id)}
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-bold transition ${
              l.status === 'pago'
                ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                : 'bg-amber-100 text-amber-800 hover:bg-amber-200'
            }`}
          >
            {l.status === 'pago' ? (
              <>
                <CheckCircle2 className="h-3.5 w-3.5" /> Parcela deste mês Paga
              </>
            ) : (
              <>
                <Clock className="h-3.5 w-3.5" /> Pendente de Pagamento
              </>
            )}
          </button>

          {l.observacoes && (
            <span className="text-[10px] text-slate-400 italic truncate max-w-[200px]" title={l.observacoes}>
              {l.observacoes}
            </span>
          )}
        </div>
      </div>
    )
  }

  const renderItemLancamento = (l: Lancamento) => {
    const cat = categorias.find(c => c.id === l.categoriaId)
    const conta = contas.find(c => c.id === l.contaId)
    const cartao = cartoes.find(c => c.id === l.cartaoId)
    const membro = membros.find(m => m.id === l.membroId)

    return (
      <div key={l.id} className="py-2.5 px-3 flex items-center justify-between hover:bg-slate-50 rounded-xl transition text-sm">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={() => toggleStatusLancamento(l.id)}
            title={l.status === 'pago' ? 'Marcar como pendente' : 'Marcar como pago'}
            className={`h-6 w-6 rounded-full flex items-center justify-center shrink-0 transition ${
              l.status === 'pago'
                ? 'bg-emerald-100 text-emerald-600 hover:bg-emerald-200'
                : 'bg-amber-100 text-amber-600 hover:bg-amber-200'
            }`}
          >
            {l.status === 'pago' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}
          </button>

          <div className="min-w-0">
            <p className="font-semibold text-slate-900 truncate">{l.descricao}</p>
            <div className="flex items-center gap-1.5 text-xs text-slate-400">
              <span>{l.data}</span>
              <span>•</span>
              <span className="font-medium text-slate-600">{cat?.nome || 'Geral'}</span>
              <span>•</span>
              {cartao ? (
                <span className="flex items-center gap-1 text-slate-700">
                  <BancoLogo banco={cartao.nome} tamanho="xs" /> {cartao.nome}
                </span>
              ) : conta ? (
                <span className="flex items-center gap-1 text-slate-700">
                  <BancoLogo banco={conta.instituicao || conta.nome} tamanho="xs" /> {conta.nome}
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <div className="text-right shrink-0">
          <span className={`font-bold ${l.tipo === 'receita' ? 'text-emerald-600' : 'text-slate-900'}`}>
            {l.tipo === 'receita' ? '+' : '-'} {formatBRL(l.valor)}
          </span>
          <p className="text-[10px] text-slate-400">
            {membro ? membro.nome.split(' ')[0] : ''} • {l.status}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Topo / Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-marinho">
            Receitas & Despesas Mensais
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Controle de custos fixos, assinaturas, parcelas de cartões e carnês
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Seletor Mês */}
          <div className="flex items-center rounded-xl bg-white border border-slate-200 shadow-sm p-1">
            <button
              type="button"
              onClick={() => mudarMes(-1)}
              className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 transition"
              title="Mês anterior"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="px-3 text-xs font-bold text-marinho capitalize min-w-[130px] text-center">
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
            variante="secundario"
            onClick={() => setModalParcelamentoAberto(true)}
            className="flex items-center gap-1.5 shadow-sm text-xs border-blue-200 bg-blue-50/50 text-blue-700 hover:bg-blue-100"
          >
            <CreditCard className="h-3.5 w-3.5" /> + Parcelamento (Cartão/Carnê)
          </Button>

          <Button
            variante="primario"
            onClick={() => setModalNovoAberto(true)}
            className="flex items-center gap-1.5 shadow-sm text-xs"
          >
            <Plus className="h-4 w-4" /> Novo Lançamento
          </Button>
        </div>
      </div>

      {/* Alternador de Abas Principais */}
      <div className="flex items-center justify-between border-b border-slate-200 pb-2 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setAbaAtiva('gastos')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition ${
              abaAtiva === 'gastos'
                ? 'bg-rose-50 text-rose-700 border border-rose-200 shadow-sm'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <TrendingDown className="h-4 w-4" /> Gastos Mensais ({formatBRL(despesasAgrupadas.totalGeral)})
          </button>

          <button
            type="button"
            onClick={() => setAbaAtiva('receitas')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition ${
              abaAtiva === 'receitas'
                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-sm'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <TrendingUp className="h-4 w-4" /> Receitas Mensais ({formatBRL(receitasAgrupadas.totalGeral)})
          </button>
        </div>

        {/* Filtros rápidos da aba de Gastos */}
        {abaAtiva === 'gastos' && (
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl text-xs font-semibold text-slate-600">
            <button
              type="button"
              onClick={() => setFiltroGastos('todos')}
              className={`px-3 py-1 rounded-lg transition ${
                filtroGastos === 'todos' ? 'bg-white text-slate-900 shadow-xs' : 'hover:text-slate-900'
              }`}
            >
              Todos
            </button>
            <button
              type="button"
              onClick={() => setFiltroGastos('parcelas')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-lg transition ${
                filtroGastos === 'parcelas'
                  ? 'bg-blue-600 text-white shadow-xs font-bold'
                  : 'hover:text-slate-900'
              }`}
            >
              <CreditCard className="h-3.5 w-3.5" />
              Parcelas & Carnês ({despesasAgrupadas.todasParcelas.lista.length})
            </button>
            <button
              type="button"
              onClick={() => setFiltroGastos('fixos')}
              className={`px-3 py-1 rounded-lg transition ${
                filtroGastos === 'fixos' ? 'bg-white text-slate-900 shadow-xs' : 'hover:text-slate-900'
              }`}
            >
              Custos Fixos
            </button>
            <button
              type="button"
              onClick={() => setFiltroGastos('variaveis')}
              className={`px-3 py-1 rounded-lg transition ${
                filtroGastos === 'variaveis' ? 'bg-white text-slate-900 shadow-xs' : 'hover:text-slate-900'
              }`}
            >
              Variáveis
            </button>
            <button
              type="button"
              onClick={() => setFiltroGastos('ressarcimentos')}
              className={`px-3 py-1 rounded-lg transition ${
                filtroGastos === 'ressarcimentos' ? 'bg-white text-slate-900 shadow-xs' : 'hover:text-slate-900'
              }`}
            >
              Ressarcimentos
            </button>
          </div>
        )}
      </div>

      {/* Conteúdo Aba Gastos Mensais */}
      {abaAtiva === 'gastos' && (
        <div className="space-y-6">
          {/* Cards de Resumo dos Grupos */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
            {/* Custos Fixos */}
            <div className="rounded-2xl bg-white p-4 border border-slate-200 shadow-sm space-y-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                <Home className="h-3.5 w-3.5 text-blue-600" /> Custos Fixos
              </span>
              <p className="text-xl font-bold text-slate-900">{formatBRL(despesasAgrupadas.fixos.total)}</p>
              <p className="text-[10px] text-slate-400">Aluguel, condomínio, luz</p>
            </div>

            {/* Destaque Parcelas Ativas (Cartão & Carnês) */}
            <div className="rounded-2xl bg-gradient-to-br from-blue-50 to-indigo-50/50 p-4 border border-blue-200 shadow-sm space-y-1">
              <span className="text-[11px] font-bold uppercase tracking-wider text-blue-700 flex items-center gap-1.5">
                <CreditCard className="h-3.5 w-3.5 text-blue-600" /> Parcelas & Carnês
              </span>
              <p className="text-xl font-black text-blue-900">{formatBRL(despesasAgrupadas.todasParcelas.total)}</p>
              <p className="text-[10px] text-blue-600/80 font-medium">
                {despesasAgrupadas.parcelasCartao.lista.length} no cartão • {despesasAgrupadas.parcelasCarne.lista.length} em carnê
              </p>
            </div>

            {/* Assinaturas & Apps */}
            <div className="rounded-2xl bg-white p-4 border border-slate-200 shadow-sm space-y-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                <Tv className="h-3.5 w-3.5 text-cyan-600" /> Assinaturas & Apps
              </span>
              <p className="text-xl font-bold text-slate-900">{formatBRL(despesasAgrupadas.assinaturas.total)}</p>
              <p className="text-[10px] text-slate-400">Netflix, ChatGPT, Spotify</p>
            </div>

            {/* Gastos Variáveis */}
            <div className="rounded-2xl bg-white p-4 border border-slate-200 shadow-sm space-y-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                <ShoppingBag className="h-3.5 w-3.5 text-amber-600" /> Gastos Variáveis
              </span>
              <p className="text-xl font-bold text-slate-900">{formatBRL(despesasAgrupadas.variaveis.total)}</p>
              <p className="text-[10px] text-slate-400">Supermercado, combustível</p>
            </div>

            {/* Ressarcimentos */}
            <div className="rounded-2xl bg-white p-4 border border-slate-200 shadow-sm space-y-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                <RotateCcw className="h-3.5 w-3.5 text-purple-600" /> A Ressarcir
              </span>
              <p className="text-xl font-bold text-purple-700">{formatBRL(despesasAgrupadas.ressarcimentos.total)}</p>
              <p className="text-[10px] text-slate-400">Empresas / Reembolsos</p>
            </div>
          </div>

          {/* SEÇÃO PRINCIPAL DE PARCELAS (SEJA DE CARTÃO OU CARNÊ) */}
          {(filtroGastos === 'todos' || filtroGastos === 'parcelas') && (
            <div className="rounded-2xl bg-gradient-to-b from-white to-slate-50 p-5 border border-slate-200/90 shadow-sm space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200/80 pb-3">
                <div className="flex items-center gap-2.5">
                  <div className="h-9 w-9 rounded-xl bg-blue-600 text-white flex items-center justify-center shadow-md shadow-blue-500/20">
                    <CreditCard className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-base text-slate-900">
                      Parcelas Ativas: Cartão de Crédito & Carnês
                    </h3>
                    <p className="text-xs text-slate-500">
                      Acompanhamento mês a mês das parcelas em andamento, quitação e saldo devedor
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <span className="text-xs text-slate-500 block">Dívida Futura Total</span>
                    <span className="text-sm font-black text-rose-600">
                      {formatBRL(despesasAgrupadas.todasParcelas.dividaFuturaTotal)}
                    </span>
                  </div>

                  <Button
                    variante="secundario"
                    onClick={() => setModalParcelamentoAberto(true)}
                    className="text-xs font-bold border-blue-300 text-blue-700 bg-blue-50/70 hover:bg-blue-100"
                  >
                    + Novo Parcelamento
                  </Button>
                </div>
              </div>

              {/* Grid das parcelas */}
              {despesasAgrupadas.todasParcelas.lista.length === 0 ? (
                <div className="py-8 text-center bg-slate-50 rounded-xl border border-dashed border-slate-200">
                  <CreditCard className="h-8 w-8 text-slate-300 mx-auto mb-2" />
                  <p className="text-xs font-semibold text-slate-600">
                    Nenhuma compra parcelada registrada para este mês.
                  </p>
                  <p className="text-[11px] text-slate-400 mt-1">
                    Cadastre parcelamentos de cartão ou carnês para acompanhar o saldo restante.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {despesasAgrupadas.todasParcelas.lista.map(renderCardParcela)}
                </div>
              )}
            </div>
          )}

          {/* Listas Detalhadas por Grupo */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Bloco 1: Custos Fixos */}
            {(filtroGastos === 'todos' || filtroGastos === 'fixos') && (
              <div className="rounded-2xl bg-white p-5 border border-slate-200 shadow-sm space-y-3">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                  <div className="flex items-center gap-2">
                    <Home className="h-5 w-5 text-blue-600" />
                    <h3 className="font-bold text-slate-900">Custos Fixos da Casa & Família</h3>
                  </div>
                  <span className="font-bold text-slate-800 text-sm">{formatBRL(despesasAgrupadas.fixos.total)}</span>
                </div>
                <div className="divide-y divide-slate-100">
                  {despesasAgrupadas.fixos.lista.length === 0 ? (
                    <p className="text-xs text-slate-400 py-4 text-center">Nenhum custo fixo registrado.</p>
                  ) : (
                    despesasAgrupadas.fixos.lista.map(renderItemLancamento)
                  )}
                </div>
              </div>
            )}

            {/* Bloco 2: Assinaturas & Apps */}
            {(filtroGastos === 'todos' || filtroGastos === 'fixos') && (
              <div className="rounded-2xl bg-white p-5 border border-slate-200 shadow-sm space-y-3">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                  <div className="flex items-center gap-2">
                    <Tv className="h-5 w-5 text-cyan-600" />
                    <h3 className="font-bold text-slate-900">Assinaturas, Apps & Streaming</h3>
                  </div>
                  <span className="font-bold text-slate-800 text-sm">{formatBRL(despesasAgrupadas.assinaturas.total)}</span>
                </div>
                <div className="divide-y divide-slate-100">
                  {despesasAgrupadas.assinaturas.lista.length === 0 ? (
                    <p className="text-xs text-slate-400 py-4 text-center">Nenhuma assinatura registrada.</p>
                  ) : (
                    despesasAgrupadas.assinaturas.lista.map(renderItemLancamento)
                  )}
                </div>
              </div>
            )}

            {/* Bloco 3: Variáveis */}
            {(filtroGastos === 'todos' || filtroGastos === 'variaveis') && (
              <div className="rounded-2xl bg-white p-5 border border-slate-200 shadow-sm space-y-3">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                  <div className="flex items-center gap-2">
                    <ShoppingBag className="h-5 w-5 text-amber-600" />
                    <h3 className="font-bold text-slate-900">Gastos Variáveis do Dia a Dia</h3>
                  </div>
                  <span className="font-bold text-slate-800 text-sm">{formatBRL(despesasAgrupadas.variaveis.total)}</span>
                </div>
                <div className="divide-y divide-slate-100">
                  {despesasAgrupadas.variaveis.lista.length === 0 ? (
                    <p className="text-xs text-slate-400 py-4 text-center">Nenhum gasto variável registrado.</p>
                  ) : (
                    despesasAgrupadas.variaveis.lista.map(renderItemLancamento)
                  )}
                </div>
              </div>
            )}

            {/* Bloco 4: Ressarcimentos */}
            {(filtroGastos === 'todos' || filtroGastos === 'ressarcimentos') && (
              <div className="rounded-2xl bg-white p-5 border border-slate-200 shadow-sm space-y-3">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                  <div className="flex items-center gap-2">
                    <RotateCcw className="h-5 w-5 text-purple-600" />
                    <h3 className="font-bold text-slate-900">Ressarcimentos & Reembolsos a Receber</h3>
                  </div>
                  <span className="font-bold text-purple-700 text-sm">{formatBRL(despesasAgrupadas.ressarcimentos.total)}</span>
                </div>
                <div className="divide-y divide-slate-100">
                  {despesasAgrupadas.ressarcimentos.lista.length === 0 ? (
                    <p className="text-xs text-slate-400 py-4 text-center">Nenhum valor a ser ressarcido neste mês.</p>
                  ) : (
                    despesasAgrupadas.ressarcimentos.lista.map(renderItemLancamento)
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Conteúdo Aba Receitas Mensais */}
      {abaAtiva === 'receitas' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="rounded-2xl bg-white p-4 border border-slate-200 shadow-sm space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Salários & Pró-labore
              </span>
              <p className="text-xl font-bold text-emerald-600">{formatBRL(receitasAgrupadas.salarios.total)}</p>
              <p className="text-[11px] text-slate-400">Renda fixa recorrente</p>
            </div>

            <div className="rounded-2xl bg-white p-4 border border-slate-200 shadow-sm space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Renda Extra & Freelas
              </span>
              <p className="text-xl font-bold text-slate-900">{formatBRL(receitasAgrupadas.extras.total)}</p>
              <p className="text-[11px] text-slate-400">Projetos paralelos e bônus</p>
            </div>

            <div className="rounded-2xl bg-white p-4 border border-slate-200 shadow-sm space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Rendimentos de Investimento
              </span>
              <p className="text-xl font-bold text-azul">{formatBRL(receitasAgrupadas.investimentos.total)}</p>
              <p className="text-[11px] text-slate-400">Dividendos de FIIs e ações</p>
            </div>

            <div className="rounded-2xl bg-white p-4 border border-slate-200 shadow-sm space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Reembolsos Efetivados
              </span>
              <p className="text-xl font-bold text-purple-700">{formatBRL(receitasAgrupadas.reembolsos.total)}</p>
              <p className="text-[11px] text-slate-400">Valores ressarcidos</p>
            </div>
          </div>

          <div className="rounded-2xl bg-white p-5 border border-slate-200 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-slate-900">Todas as Entradas de {formatMonth(mesSelecionado)}</h3>
              <span className="text-sm font-bold text-emerald-600">Total: {formatBRL(receitasAgrupadas.totalGeral)}</span>
            </div>
            <div className="divide-y divide-slate-100">
              {lancamentosDoMes.filter(l => l.tipo === 'receita').map(renderItemLancamento)}
            </div>
          </div>
        </div>
      )}

      {/* Modal Novo Lançamento */}
      <ModalNovoLancamento
        aberto={modalNovoAberto}
        aoFechar={() => setModalNovoAberto(false)}
      />

      {/* Modal Novo Parcelamento */}
      <ModalNovoParcelamento
        aberto={modalParcelamentoAberto}
        aoFechar={() => setModalParcelamentoAberto(false)}
      />
    </div>
  )
}
