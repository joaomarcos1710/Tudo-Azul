import { useState, useMemo } from 'react'
import { useFinanceStore, Lancamento } from '../lib/store'
import { formatBRL, formatMonth, currentMonth } from '../lib/format'
import { Button } from '../components/ui/Button'
import { BancoLogo } from '../components/ui/BancoLogo'
import { ModalNovoLancamento } from '../components/modals/ModalNovoLancamento'
import { ModalNovoParcelamento } from '../components/modals/ModalNovoParcelamento'
import {
  Calendar as CalendarIcon, ChevronLeft, ChevronRight,
  TrendingUp, TrendingDown, CheckCircle2, Clock, Plus,
  CreditCard, Receipt, CalendarDays
} from 'lucide-react'

const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

export default function Calendario() {
  const { lancamentos, contas, cartoes, categorias, membros, toggleStatusLancamento } = useFinanceStore()

  const [mesSelecionado, setMesSelecionado] = useState(currentMonth())
  const [diaSelecionado, setDiaSelecionado] = useState<string>(() => {
    const hojeStr = new Date().toISOString().slice(0, 10)
    return hojeStr.startsWith(currentMonth()) ? hojeStr : `${currentMonth()}-01`
  })
  const [filtroTipo, setFiltroTipo] = useState<'todos' | 'entradas' | 'saidas' | 'parcelas'>('todos')
  const [modalNovoAberto, setModalNovoAberto] = useState(false)
  const [modalParcelamentoAberto, setModalParcelamentoAberto] = useState(false)

  // Navegação de mês
  const mudarMes = (delta: number) => {
    const [ano, mes] = mesSelecionado.split('-').map(Number)
    const d = new Date(ano, mes - 1 + delta, 1)
    const novoAno = d.getFullYear()
    const novoMes = String(d.getMonth() + 1).padStart(2, '0')
    const novoMesStr = `${novoAno}-${novoMes}`
    setMesSelecionado(novoMesStr)
    setDiaSelecionado(`${novoMesStr}-01`)
  }

  const irParaHoje = () => {
    const hojeStr = new Date().toISOString().slice(0, 10)
    const hojeMes = hojeStr.slice(0, 7)
    setMesSelecionado(hojeMes)
    setDiaSelecionado(hojeStr)
  }

  // Lançamentos do mês corrente filtrados
  const lancamentosDoMes = useMemo(() => {
    return lancamentos.filter((l) => l.data.startsWith(mesSelecionado) && l.tipo !== 'transferencia')
  }, [lancamentos, mesSelecionado])

  // Lançamentos organizados por dia: { 'YYYY-MM-DD': Lancamento[] }
  const mapaPorDia = useMemo(() => {
    const mapa = new Map<string, Lancamento[]>()
    lancamentosDoMes.forEach((l) => {
      const lista = mapa.get(l.data) || []
      lista.push(l)
      mapa.set(l.data, lista)
    })
    return mapa
  }, [lancamentosDoMes])

  // Totais do mês
  const totaisMes = useMemo(() => {
    let entradas = 0
    let saidas = 0
    let totalPendentes = 0

    lancamentosDoMes.forEach((l) => {
      if (l.tipo === 'receita') {
        entradas += l.valor
      } else if (l.tipo === 'despesa') {
        saidas += l.valor
      }
      if (l.status === 'pendente') {
        totalPendentes++
      }
    })

    return {
      entradas,
      saidas,
      saldo: entradas - saidas,
      totalPendentes,
    }
  }, [lancamentosDoMes])

  // Estrutura da grade do calendário
  const celulasCalendario = useMemo(() => {
    const [ano, mes] = mesSelecionado.split('-').map(Number)
    const primeiroDiaMes = new Date(ano, mes - 1, 1).getDay() // 0 = Dom, 6 = Sáb
    const totalDiasNoMes = new Date(ano, mes, 0).getDate()
    const totalDiasMesAnterior = new Date(ano, mes - 1, 0).getDate()

    const celulas = []

    // Dias do mês anterior para completar primeira semana
    for (let i = primeiroDiaMes - 1; i >= 0; i--) {
      const diaNum = totalDiasMesAnterior - i
      const mesAnt = mes === 1 ? 12 : mes - 1
      const anoAnt = mes === 1 ? ano - 1 : ano
      const dataStr = `${anoAnt}-${String(mesAnt).padStart(2, '0')}-${String(diaNum).padStart(2, '0')}`
      celulas.push({
        numero: diaNum,
        dataStr,
        doMesCorrente: false,
      })
    }

    // Dias do mês atual
    for (let diaNum = 1; diaNum <= totalDiasNoMes; diaNum++) {
      const dataStr = `${mesSelecionado}-${String(diaNum).padStart(2, '0')}`
      celulas.push({
        numero: diaNum,
        dataStr,
        doMesCorrente: true,
      })
    }

    // Dias do próximo mês para completar a última semana (múltiplo de 7)
    const resto = celulas.length % 7
    if (resto > 0) {
      const faltam = 7 - resto
      const mesProx = mes === 12 ? 1 : mes + 1
      const anoProx = mes === 12 ? ano + 1 : ano
      for (let diaNum = 1; diaNum <= faltam; diaNum++) {
        const dataStr = `${anoProx}-${String(mesProx).padStart(2, '0')}-${String(diaNum).padStart(2, '0')}`
        celulas.push({
          numero: diaNum,
          dataStr,
          doMesCorrente: false,
        })
      }
    }

    return celulas
  }, [mesSelecionado])

  // Itens do dia selecionado
  const itensDiaSelecionado = useMemo(() => {
    const itens = mapaPorDia.get(diaSelecionado) || []
    return itens.filter((l) => {
      if (filtroTipo === 'entradas') return l.tipo === 'receita'
      if (filtroTipo === 'saidas') return l.tipo === 'despesa'
      if (filtroTipo === 'parcelas') {
        return (
          l.tipoParcelamento === 'carne' ||
          l.tipoParcelamento === 'cartao' ||
          (l.totalParcelas && l.totalParcelas > 1) ||
          l.descricao.toLowerCase().includes('carnê')
        )
      }
      return true
    })
  }, [mapaPorDia, diaSelecionado, filtroTipo])

  // Totais do dia selecionado
  const totaisDiaSelecionado = useMemo(() => {
    let entradas = 0
    let saidas = 0
    itensDiaSelecionado.forEach((l) => {
      if (l.tipo === 'receita') entradas += l.valor
      else if (l.tipo === 'despesa') saidas += l.valor
    })
    return { entradas, saidas, saldo: entradas - saidas }
  }, [itensDiaSelecionado])

  const hojeStr = new Date().toISOString().slice(0, 10)

  const abrirModalComData = (_dataStr?: string) => {
    setModalNovoAberto(true)
  }

  return (
    <div className="space-y-6">
      {/* Topo / Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-xl bg-blue-600 text-white flex items-center justify-center shadow-md shadow-blue-500/20">
              <CalendarDays className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-marinho">
                Calendário Financeiro
              </h1>
              <p className="text-xs text-slate-500">
                Projeção diária do que vai entrar e sair (vencimentos, faturas, carnês e salários)
              </p>
            </div>
          </div>
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
            onClick={irParaHoje}
            className="text-xs font-bold border-slate-200 hover:bg-slate-100"
          >
            Hoje
          </Button>

          <Button
            variante="secundario"
            onClick={() => setModalParcelamentoAberto(true)}
            className="flex items-center gap-1.5 shadow-sm text-xs border-blue-200 bg-blue-50/50 text-blue-700 hover:bg-blue-100"
          >
            <CreditCard className="h-3.5 w-3.5" /> + Parcela/Carnê
          </Button>

          <Button
            variante="primario"
            onClick={() => abrirModalComData(diaSelecionado)}
            className="flex items-center gap-1.5 shadow-sm text-xs"
          >
            <Plus className="h-4 w-4" /> Novo Lançamento
          </Button>
        </div>
      </div>

      {/* 4 Cards de Resumo do Mês */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-2xl bg-white p-4 border border-slate-200 shadow-sm space-y-1">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
            <TrendingUp className="h-4 w-4 text-emerald-600" /> Previsão de Entradas
          </span>
          <p className="text-xl font-black text-emerald-600">{formatBRL(totaisMes.entradas)}</p>
          <p className="text-[11px] text-slate-400">Salários, freelas e rendimentos</p>
        </div>

        <div className="rounded-2xl bg-white p-4 border border-slate-200 shadow-sm space-y-1">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
            <TrendingDown className="h-4 w-4 text-rose-600" /> Previsão de Saídas
          </span>
          <p className="text-xl font-black text-rose-600">{formatBRL(totaisMes.saidas)}</p>
          <p className="text-[11px] text-slate-400">Fixos, boletos, cartões e carnês</p>
        </div>

        <div className="rounded-2xl bg-white p-4 border border-slate-200 shadow-sm space-y-1">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Resultado Previsto do Mês
          </span>
          <p
            className={`text-xl font-black ${
              totaisMes.saldo >= 0 ? 'text-blue-700' : 'text-rose-700'
            }`}
          >
            {totaisMes.saldo >= 0 ? '+' : ''} {formatBRL(totaisMes.saldo)}
          </p>
          <p className="text-[11px] text-slate-400">
            {totaisMes.saldo >= 0 ? 'Superávit estimado de caixa' : 'Atenção: saídas superam entradas'}
          </p>
        </div>

        <div className="rounded-2xl bg-white p-4 border border-slate-200 shadow-sm space-y-1">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
            <Clock className="h-4 w-4 text-amber-500" /> Vencimentos Pendentes
          </span>
          <p className="text-xl font-black text-amber-600">{totaisMes.totalPendentes} contas</p>
          <p className="text-[11px] text-slate-400">Aguardando confirmação de pagamento</p>
        </div>
      </div>

      {/* Grid Calendário & Painel de Detalhes Diários */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Lado Esquerdo: Grade do Calendário (7 colunas) */}
        <div className="lg:col-span-8 rounded-2xl bg-white p-4 sm:p-6 border border-slate-200 shadow-sm space-y-4">
          <div className="flex items-center justify-between pb-2 border-b border-slate-100 flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <CalendarIcon className="h-5 w-5 text-blue-600" />
              <h2 className="font-bold text-slate-900 capitalize">
                {formatMonth(mesSelecionado)}
              </h2>
            </div>

            {/* Filtros visuais */}
            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl text-xs font-semibold text-slate-600">
              <button
                type="button"
                onClick={() => setFiltroTipo('todos')}
                className={`px-2.5 py-1 rounded-lg transition ${
                  filtroTipo === 'todos' ? 'bg-white text-slate-900 shadow-xs' : 'hover:text-slate-900'
                }`}
              >
                Todos
              </button>
              <button
                type="button"
                onClick={() => setFiltroTipo('entradas')}
                className={`px-2.5 py-1 rounded-lg transition ${
                  filtroTipo === 'entradas' ? 'bg-emerald-600 text-white font-bold shadow-xs' : 'hover:text-slate-900'
                }`}
              >
                Entradas
              </button>
              <button
                type="button"
                onClick={() => setFiltroTipo('saidas')}
                className={`px-2.5 py-1 rounded-lg transition ${
                  filtroTipo === 'saidas' ? 'bg-rose-600 text-white font-bold shadow-xs' : 'hover:text-slate-900'
                }`}
              >
                Saídas
              </button>
              <button
                type="button"
                onClick={() => setFiltroTipo('parcelas')}
                className={`px-2.5 py-1 rounded-lg transition ${
                  filtroTipo === 'parcelas' ? 'bg-blue-600 text-white font-bold shadow-xs' : 'hover:text-slate-900'
                }`}
              >
                Parcelas/Carnês
              </button>
            </div>
          </div>

          {/* Cabeçalho dos dias da semana */}
          <div className="grid grid-cols-7 gap-1 text-center">
            {DIAS_SEMANA.map((dia) => (
              <div
                key={dia}
                className="py-1 text-[11px] font-bold uppercase tracking-wider text-slate-400"
              >
                {dia}
              </div>
            ))}
          </div>

          {/* Células dos dias */}
          <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
            {celulasCalendario.map((celula, idx) => {
              const itensDoDia = mapaPorDia.get(celula.dataStr) || []
              let entDia = 0
              let saiDia = 0
              let temPendente = false
              let temParc = false

              itensDoDia.forEach((l) => {
                if (l.tipo === 'receita') entDia += l.valor
                else if (l.tipo === 'despesa') saiDia += l.valor
                if (l.status === 'pendente') temPendente = true
                if (l.tipoParcelamento === 'carne' || l.tipoParcelamento === 'cartao' || (l.totalParcelas && l.totalParcelas > 1)) {
                  temParc = true
                }
              })

              const isHoje = celula.dataStr === hojeStr
              const isSelecionado = celula.dataStr === diaSelecionado

              return (
                <button
                  type="button"
                  key={idx}
                  onClick={() => setDiaSelecionado(celula.dataStr)}
                  className={`min-h-[78px] sm:min-h-[92px] p-1.5 rounded-xl border text-left flex flex-col justify-between transition-all relative ${
                    isSelecionado
                      ? 'border-blue-600 bg-blue-50/50 ring-2 ring-blue-500/20 shadow-sm z-10'
                      : isHoje
                      ? 'border-blue-400 bg-blue-50/20 shadow-xs'
                      : celula.doMesCorrente
                      ? 'border-slate-200/80 bg-white hover:bg-slate-50/80 hover:border-slate-300'
                      : 'border-slate-100 bg-slate-50/40 text-slate-300 hover:bg-slate-50'
                  }`}
                >
                  {/* Topo da célula: número e marcadores */}
                  <div className="flex items-center justify-between w-full">
                    <span
                      className={`text-xs font-bold ${
                        isHoje
                          ? 'h-5 w-5 rounded-full bg-blue-600 text-white flex items-center justify-center font-black'
                          : isSelecionado
                          ? 'text-blue-700 font-black'
                          : celula.doMesCorrente
                          ? 'text-slate-800'
                          : 'text-slate-300'
                      }`}
                    >
                      {celula.numero}
                    </span>

                    <div className="flex items-center gap-1">
                      {temParc && (
                        <span title="Possui parcela ou carnê neste dia" className="text-blue-500">
                          <Receipt className="h-3 w-3" />
                        </span>
                      )}
                      {temPendente && (
                        <span
                          title="Possui conta pendente a vencer"
                          className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse"
                        />
                      )}
                    </div>
                  </div>

                  {/* Badges de Entradas e Saídas do Dia */}
                  <div className="space-y-1 w-full mt-1">
                    {entDia > 0 && (
                      <div
                        className="text-[9px] sm:text-[10px] font-black text-emerald-800 bg-emerald-100/90 rounded px-1 py-0.5 truncate text-center"
                        title={`Entradas: ${formatBRL(entDia)}`}
                      >
                        +{formatBRL(entDia).replace('R$', '').trim()}
                      </div>
                    )}

                    {saiDia > 0 && (
                      <div
                        className="text-[9px] sm:text-[10px] font-black text-rose-800 bg-rose-100/90 rounded px-1 py-0.5 truncate text-center"
                        title={`Saídas: ${formatBRL(saiDia)}`}
                      >
                        -{formatBRL(saiDia).replace('R$', '').trim()}
                      </div>
                    )}
                  </div>
                </button>
              )
            })}
          </div>

          {/* Legenda explicativa */}
          <div className="flex items-center justify-between pt-3 border-t border-slate-100 text-[11px] text-slate-500 flex-wrap gap-2">
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                <span>Entradas (Receitas)</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-rose-500" />
                <span>Saídas (Contas / Vencimentos)</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-amber-500" />
                <span>Conta Pendente</span>
              </span>
            </div>

            <span className="text-slate-400 italic">
              Clique em qualquer dia para ver os lançamentos detalhados
            </span>
          </div>
        </div>

        {/* Lado Direito: Painel Detalhado do Dia Selecionado */}
        <div className="lg:col-span-4 rounded-2xl bg-white p-5 border border-slate-200 shadow-sm space-y-4">
          <div className="flex items-start justify-between border-b border-slate-100 pb-3">
            <div>
              <span className="text-[11px] font-black uppercase tracking-wider text-blue-600 block">
                Detalhamento do Dia
              </span>
              <h3 className="text-lg font-bold text-slate-900">
                {diaSelecionado.slice(8, 10)}/{diaSelecionado.slice(5, 7)}/{diaSelecionado.slice(0, 4)}
              </h3>
              <p className="text-xs text-slate-500">
                {itensDiaSelecionado.length === 1
                  ? '1 lançamento previsto'
                  : `${itensDiaSelecionado.length} lançamentos previstos`}
              </p>
            </div>

            <Button
              variante="secundario"
              onClick={() => abrirModalComData(diaSelecionado)}
              className="text-xs p-2 text-blue-600 bg-blue-50 hover:bg-blue-100 border-blue-200"
              title="Adicionar lançamento neste dia"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>

          {/* Mini resumo do dia */}
          <div className="grid grid-cols-2 gap-2 bg-slate-50 p-3 rounded-xl border border-slate-200/60 text-xs">
            <div>
              <span className="text-slate-400 block text-[10px] font-bold uppercase">Entradas</span>
              <span className="font-bold text-emerald-600 text-sm">
                +{formatBRL(totaisDiaSelecionado.entradas)}
              </span>
            </div>
            <div>
              <span className="text-slate-400 block text-[10px] font-bold uppercase">Saídas</span>
              <span className="font-bold text-rose-600 text-sm">
                -{formatBRL(totaisDiaSelecionado.saidas)}
              </span>
            </div>
          </div>

          {/* Lista de Itens do Dia */}
          <div className="space-y-2.5 max-h-[500px] overflow-y-auto pr-1 divide-y divide-slate-100">
            {itensDiaSelecionado.length === 0 ? (
              <div className="py-8 text-center text-slate-400 space-y-2">
                <CalendarIcon className="h-8 w-8 mx-auto text-slate-300" />
                <p className="text-xs font-semibold">Nenhum vencimento ou entrada neste dia.</p>
                <Button
                  variante="secundario"
                  onClick={() => abrirModalComData(diaSelecionado)}
                  className="text-xs text-blue-600"
                >
                  + Agendar lançamento aqui
                </Button>
              </div>
            ) : (
              itensDiaSelecionado.map((l) => {
                const cat = categorias.find((c) => c.id === l.categoriaId)
                const conta = contas.find((c) => c.id === l.contaId)
                const cartao = cartoes.find((c) => c.id === l.cartaoId)
                const membro = membros.find((m) => m.id === l.membroId)
                const isCarne =
                  l.tipoParcelamento === 'carne' ||
                  l.descricao.toLowerCase().includes('carnê') ||
                  l.descricao.toLowerCase().includes('crediário')

                return (
                  <div
                    key={l.id}
                    className="pt-2.5 first:pt-0 flex items-start justify-between gap-3 text-sm hover:bg-slate-50/80 p-2 rounded-xl transition"
                  >
                    <div className="flex items-start gap-2.5 min-w-0">
                      <button
                        type="button"
                        onClick={() => toggleStatusLancamento(l.id)}
                        className={`h-6 w-6 mt-0.5 rounded-full flex items-center justify-center shrink-0 transition ${
                          l.status === 'pago'
                            ? 'bg-emerald-100 text-emerald-600 hover:bg-emerald-200'
                            : 'bg-amber-100 text-amber-600 hover:bg-amber-200'
                        }`}
                        title={l.status === 'pago' ? 'Marcar como pendente' : 'Marcar como pago'}
                      >
                        {l.status === 'pago' ? (
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        ) : (
                          <Clock className="h-3.5 w-3.5" />
                        )}
                      </button>

                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {isCarne && (
                            <span className="px-1.5 py-0.2 rounded text-[9px] font-black uppercase bg-amber-100 text-amber-800">
                              Carnê
                            </span>
                          )}
                          {l.totalParcelas && l.totalParcelas > 1 && !isCarne && (
                            <span className="px-1.5 py-0.2 rounded text-[9px] font-black uppercase bg-blue-100 text-blue-800">
                              {l.parcelaAtual}/{l.totalParcelas}x
                            </span>
                          )}
                          <span className="font-bold text-slate-900 truncate text-xs">
                            {l.descricao}
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5 text-[11px] text-slate-400 mt-0.5">
                          <span>{cat?.nome || 'Geral'}</span>
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
                          {membro && (
                            <>
                              <span>•</span>
                              <span>{membro.nome.split(' ')[0]}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <span
                        className={`font-black text-xs ${
                          l.tipo === 'receita' ? 'text-emerald-600' : 'text-slate-900'
                        }`}
                      >
                        {l.tipo === 'receita' ? '+' : '-'} {formatBRL(l.valor)}
                      </span>
                      <span
                        className={`block text-[10px] font-semibold capitalize ${
                          l.status === 'pago' ? 'text-emerald-600' : 'text-amber-600'
                        }`}
                      >
                        {l.status}
                      </span>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>

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
