import { useState, useMemo } from 'react'
import { useFinanceStore } from '../lib/store'
import { formatBRL, formatMonth, currentMonth } from '../lib/format'
import {
  PieChart, BarChart3, ChevronLeft, ChevronRight, Award,
  ArrowUpRight, ArrowDownRight, Layers
} from 'lucide-react'

export default function Relatorios() {
  const { lancamentos, categorias } = useFinanceStore()
  const [mesSelecionado, setMesSelecionado] = useState(currentMonth())
  const [abaRelatorio, setAbaRelatorio] = useState<'resumo' | 'comparativo'>('resumo')

  const mudarMes = (delta: number) => {
    const [ano, mes] = mesSelecionado.split('-').map(Number)
    const d = new Date(ano, mes - 1 + delta, 1)
    const novoAno = d.getFullYear()
    const novoMes = String(d.getMonth() + 1).padStart(2, '0')
    setMesSelecionado(`${novoAno}-${novoMes}`)
  }

  // Mês anterior para cálculo comparativo
  const mesAnteriorYm = useMemo(() => {
    const [ano, mes] = mesSelecionado.split('-').map(Number)
    const d = new Date(ano, mes - 2, 1)
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    return `${y}-${m}`
  }, [mesSelecionado])

  // Despesas por Categoria no mês selecionado
  const dadosCategorias = useMemo(() => {
    const mapa = new Map<string, number>()
    let totalDespesas = 0

    lancamentos.forEach(l => {
      if (l.tipo === 'despesa' && l.data.startsWith(mesSelecionado)) {
        mapa.set(l.categoriaId, (mapa.get(l.categoriaId) || 0) + l.valor)
        totalDespesas += l.valor
      }
    })

    const lista = Array.from(mapa.entries()).map(([catId, valor]) => {
      const cat = categorias.find(c => c.id === catId)
      const perc = totalDespesas > 0 ? (valor / totalDespesas) * 100 : 0
      return {
        id: catId,
        nome: cat?.nome || 'Geral',
        cor: cat?.cor || '#3B82F6',
        classificacao: cat?.classificacao || 'estilo_vida',
        valor,
        perc,
      }
    }).sort((a, b) => b.valor - a.valor)

    return { lista, totalDespesas }
  }, [lancamentos, categorias, mesSelecionado])

  // Análise da Regra 50-30-20
  const regra503020 = useMemo(() => {
    let receitaMes = 0
    let essencial = 0
    let estiloVida = 0
    let investimento = 0

    lancamentos.forEach(l => {
      if (!l.data.startsWith(mesSelecionado)) return
      if (l.tipo === 'receita') {
        receitaMes += l.valor
      } else if (l.tipo === 'despesa') {
        const cat = categorias.find(c => c.id === l.categoriaId)
        if (cat?.classificacao === 'essencial') essencial += l.valor
        else if (cat?.classificacao === 'investimento') investimento += l.valor
        else estiloVida += l.valor
      }
    })

    const sobra = Math.max(0, receitaMes - essencial - estiloVida - investimento)
    const totalPoupanca = investimento + sobra

    const percEssencial = receitaMes > 0 ? (essencial / receitaMes) * 100 : 0
    const percEstilo = receitaMes > 0 ? (estiloVida / receitaMes) * 100 : 0
    const percPoupanca = receitaMes > 0 ? (totalPoupanca / receitaMes) * 100 : 0

    return {
      receitaMes,
      essencial,
      estiloVida,
      investimento,
      totalPoupanca,
      percEssencial,
      percEstilo,
      percPoupanca,
    }
  }, [lancamentos, categorias, mesSelecionado])

  // Histórico dos últimos 6 meses (Receitas vs Despesas)
  const historicoMeses = useMemo(() => {
    const meses = []
    const [ano, mes] = mesSelecionado.split('-').map(Number)

    for (let i = 5; i >= 0; i--) {
      const d = new Date(ano, mes - 1 - i, 1)
      const y = d.getFullYear()
      const m = String(d.getMonth() + 1).padStart(2, '0')
      const ym = `${y}-${m}`

      let r = 0
      let desp = 0

      lancamentos.forEach(l => {
        if (l.data.startsWith(ym) && l.tipo !== 'transferencia') {
          if (l.tipo === 'receita') r += l.valor
          else if (l.tipo === 'despesa') desp += l.valor
        }
      })

      meses.push({
        mesYm: ym,
        rotulo: d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }),
        receitas: r,
        despesas: desp,
        saldo: r - desp,
        taxaPoupanca: r > 0 ? ((r - desp) / r) * 100 : 0,
      })
    }

    return meses
  }, [lancamentos, mesSelecionado])

  // Comparativo Direto Mês Atual vs Mês Anterior
  const dadosMesAtual = historicoMeses[historicoMeses.length - 1]
  const dadosMesAnterior = historicoMeses[historicoMeses.length - 2] || {
    receitas: 0,
    despesas: 0,
    saldo: 0,
  }

  const difReceitas = dadosMesAtual.receitas - dadosMesAnterior.receitas
  const percDifReceitas = dadosMesAnterior.receitas > 0 ? (difReceitas / dadosMesAnterior.receitas) * 100 : 0

  const difDespesas = dadosMesAtual.despesas - dadosMesAnterior.despesas
  const percDifDespesas = dadosMesAnterior.despesas > 0 ? (difDespesas / dadosMesAnterior.despesas) * 100 : 0

  const difSaldo = dadosMesAtual.saldo - dadosMesAnterior.saldo

  // Médias dos últimos meses
  const mediaReceitas = historicoMeses.reduce((acc, m) => acc + m.receitas, 0) / historicoMeses.length
  const mediaDespesas = historicoMeses.reduce((acc, m) => acc + m.despesas, 0) / historicoMeses.length
  const mediaSobra = mediaReceitas - mediaDespesas

  // Comparativo por Categoria Mês Atual vs Mês Anterior
  const comparativoCategorias = useMemo(() => {
    return categorias
      .filter(c => c.tipo === 'despesa')
      .map(cat => {
        let gastoAtual = 0
        let gastoAnterior = 0

        lancamentos.forEach(l => {
          if (l.categoriaId === cat.id && l.tipo === 'despesa') {
            if (l.data.startsWith(mesSelecionado)) gastoAtual += l.valor
            else if (l.data.startsWith(mesAnteriorYm)) gastoAnterior += l.valor
          }
        })

        const diferenca = gastoAtual - gastoAnterior
        const percVar = gastoAnterior > 0 ? (diferenca / gastoAnterior) * 100 : 0

        return {
          cat,
          gastoAtual,
          gastoAnterior,
          diferenca,
          percVar,
        }
      })
      .filter(i => i.gastoAtual > 0 || i.gastoAnterior > 0)
      .sort((a, b) => b.gastoAtual - a.gastoAtual)
  }, [categorias, lancamentos, mesSelecionado, mesAnteriorYm])

  return (
    <div className="space-y-6">
      {/* Topo / Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-marinho">Relatórios & Comparativos</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Resumo consolidado do mês, diagnóstico 50-30-20 e comparativo com meses anteriores
          </p>
        </div>

        {/* Seletor de Mês */}
        <div className="flex items-center rounded-xl bg-white border border-slate-200 shadow-sm p-1">
          <button
            type="button"
            onClick={() => mudarMes(-1)}
            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 transition"
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
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Sub-abas: Resumo do Mês vs Comparativo com Últimos Meses */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
        <button
          type="button"
          onClick={() => setAbaRelatorio('resumo')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition ${
            abaRelatorio === 'resumo'
              ? 'bg-azul text-white shadow-sm'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <PieChart className="h-4 w-4" /> Resumo do Mês
        </button>
        <button
          type="button"
          onClick={() => setAbaRelatorio('comparativo')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition ${
            abaRelatorio === 'comparativo'
              ? 'bg-azul text-white shadow-sm'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <BarChart3 className="h-4 w-4" /> Comparativo com Últimos Meses
        </button>
      </div>

      {/* ABA 1: RESUMO DO MÊS */}
      {abaRelatorio === 'resumo' && (
        <div className="space-y-6">
          {/* Diagnóstico Regra 50-30-20 */}
          <div className="rounded-2xl bg-white p-6 border border-slate-200/80 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Award className="h-5 w-5 text-azul" />
                <h2 className="text-base font-bold text-marinho">
                  Diagnóstico da Regra 50-30-20 em {formatMonth(mesSelecionado)}
                </h2>
              </div>
              <span className="text-xs text-slate-500">
                Receita Base: {formatBRL(regra503020.receitaMes)}
              </span>
            </div>

            <p className="text-xs text-slate-600">
              A metodologia 50-30-20 propõe destinar até <strong>50%</strong> para necessidades essenciais, até <strong>30%</strong> para estilo de vida e pelo menos <strong>20%</strong> para poupança e investimentos.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
              {/* 50% Essenciais */}
              <div className="p-4 rounded-xl bg-blue-50/60 border border-blue-100 space-y-2">
                <div className="flex justify-between items-baseline">
                  <span className="text-xs font-bold text-blue-900">50% Essenciais</span>
                  <span className={`text-xs font-bold ${regra503020.percEssencial <= 50 ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {regra503020.percEssencial.toFixed(1)}% (Meta: ≤50%)
                  </span>
                </div>
                <p className="text-lg font-bold text-blue-950">{formatBRL(regra503020.essencial)}</p>
                <div className="w-full bg-blue-200 rounded-full h-2 overflow-hidden">
                  <div
                    className={`h-full ${regra503020.percEssencial <= 50 ? 'bg-blue-600' : 'bg-rose-500'}`}
                    style={{ width: `${Math.min(100, (regra503020.percEssencial / 50) * 100)}%` }}
                  />
                </div>
                <p className="text-[11px] text-slate-500">Aluguel, contas, alimentação, saúde, educação</p>
              </div>

              {/* 30% Estilo de Vida */}
              <div className="p-4 rounded-xl bg-purple-50/60 border border-purple-100 space-y-2">
                <div className="flex justify-between items-baseline">
                  <span className="text-xs font-bold text-purple-900">30% Estilo de Vida</span>
                  <span className={`text-xs font-bold ${regra503020.percEstilo <= 30 ? 'text-emerald-600' : 'text-amber-600'}`}>
                    {regra503020.percEstilo.toFixed(1)}% (Meta: ≤30%)
                  </span>
                </div>
                <p className="text-lg font-bold text-purple-950">{formatBRL(regra503020.estiloVida)}</p>
                <div className="w-full bg-purple-200 rounded-full h-2 overflow-hidden">
                  <div
                    className={`h-full ${regra503020.percEstilo <= 30 ? 'bg-purple-600' : 'bg-amber-500'}`}
                    style={{ width: `${Math.min(100, (regra503020.percEstilo / 30) * 100)}%` }}
                  />
                </div>
                <p className="text-[11px] text-slate-500">Restaurantes, compras, lazer, assinaturas</p>
              </div>

              {/* 20% Poupança & Metas */}
              <div className="p-4 rounded-xl bg-emerald-50/60 border border-emerald-100 space-y-2">
                <div className="flex justify-between items-baseline">
                  <span className="text-xs font-bold text-emerald-900">20% Poupança & Metas</span>
                  <span className={`text-xs font-bold ${regra503020.percPoupanca >= 20 ? 'text-emerald-600' : 'text-amber-600'}`}>
                    {regra503020.percPoupanca.toFixed(1)}% (Meta: ≥20%)
                  </span>
                </div>
                <p className="text-lg font-bold text-emerald-950">{formatBRL(regra503020.totalPoupanca)}</p>
                <div className="w-full bg-emerald-200 rounded-full h-2 overflow-hidden">
                  <div
                    className="h-full bg-emerald-600"
                    style={{ width: `${Math.min(100, (regra503020.percPoupanca / 20) * 100)}%` }}
                  />
                </div>
                <p className="text-[11px] text-slate-500">Aportes, reserva de emergência, previdência</p>
              </div>
            </div>
          </div>

          {/* Despesas por Categoria */}
          <div className="rounded-2xl bg-white p-6 border border-slate-200/80 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <PieChart className="h-5 w-5 text-azul" />
                <h2 className="text-base font-bold text-marinho">Despesas por Categoria</h2>
              </div>
              <span className="text-xs text-slate-500 font-bold">
                Total: {formatBRL(dadosCategorias.totalDespesas)}
              </span>
            </div>

            {dadosCategorias.lista.length === 0 ? (
              <p className="text-xs text-slate-400 py-6 text-center">Nenhuma despesa registrada neste mês.</p>
            ) : (
              <div className="space-y-3 pt-1">
                {dadosCategorias.lista.map(cat => (
                  <div key={cat.id} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span className="h-3 w-3 rounded-full" style={{ backgroundColor: cat.cor }} />
                        <span className="font-semibold text-slate-800">{cat.nome}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900">{formatBRL(cat.valor)}</span>
                        <span className="text-slate-400 text-[11px]">({cat.perc.toFixed(1)}%)</span>
                      </div>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                      <div
                        className="h-full transition-all duration-300"
                        style={{ width: `${cat.perc}%`, backgroundColor: cat.cor }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ABA 2: COMPARATIVO COM ÚLTIMOS MESES */}
      {abaRelatorio === 'comparativo' && (
        <div className="space-y-6">
          {/* Cards de Variação Direta vs Mês Anterior */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Variação Receitas */}
            <div className="rounded-2xl bg-white p-5 border border-slate-200/80 shadow-sm space-y-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Receitas vs Mês Anterior
              </span>
              <div className="flex items-baseline justify-between">
                <span className="text-xl font-bold text-slate-900">{formatBRL(dadosMesAtual.receitas)}</span>
                <span className={`inline-flex items-center text-xs font-bold ${difReceitas >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                  {difReceitas >= 0 ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
                  {difReceitas >= 0 ? '+' : ''}{percDifReceitas.toFixed(1)}%
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Mês anterior: {formatBRL(dadosMesAnterior.receitas)}
              </p>
            </div>

            {/* Variação Despesas */}
            <div className="rounded-2xl bg-white p-5 border border-slate-200/80 shadow-sm space-y-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Despesas vs Mês Anterior
              </span>
              <div className="flex items-baseline justify-between">
                <span className="text-xl font-bold text-slate-900">{formatBRL(dadosMesAtual.despesas)}</span>
                <span className={`inline-flex items-center text-xs font-bold ${difDespesas <= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                  {difDespesas > 0 ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
                  {difDespesas > 0 ? '+' : ''}{percDifDespesas.toFixed(1)}%
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Mês anterior: {formatBRL(dadosMesAnterior.despesas)}
              </p>
            </div>

            {/* Variação Sobra */}
            <div className="rounded-2xl bg-white p-5 border border-slate-200/80 shadow-sm space-y-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Sobra Líquida vs Mês Anterior
              </span>
              <div className="flex items-baseline justify-between">
                <span className={`text-xl font-bold ${dadosMesAtual.saldo >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>
                  {formatBRL(dadosMesAtual.saldo)}
                </span>
                <span className={`inline-flex items-center text-xs font-bold ${difSaldo >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                  {difSaldo >= 0 ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
                  {difSaldo >= 0 ? '+' : ''}{formatBRL(difSaldo)}
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Mês anterior: {formatBRL(dadosMesAnterior.saldo)}
              </p>
            </div>
          </div>

          {/* Tabela Histórica Mês a Mês dos Últimos 6 Meses */}
          <div className="rounded-2xl bg-white p-6 border border-slate-200/80 shadow-sm space-y-4 overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-azul" />
                <h2 className="text-base font-bold text-marinho">
                  Tabela Comparativa dos Últimos 6 Meses
                </h2>
              </div>
              <div className="text-xs text-slate-500">
                Média mensal poupada: <strong className="text-emerald-600">{formatBRL(mediaSobra)}</strong>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-400 font-bold uppercase tracking-wider">
                    <th className="py-2.5 px-3">Mês</th>
                    <th className="py-2.5 px-3">Receitas</th>
                    <th className="py-2.5 px-3">Despesas</th>
                    <th className="py-2.5 px-3">Saldo / Sobra</th>
                    <th className="py-2.5 px-3">% Poupança</th>
                    <th className="py-2.5 px-3 text-right">Ação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {historicoMeses.map(item => {
                    const isSelecionado = item.mesYm === mesSelecionado
                    return (
                      <tr
                        key={item.mesYm}
                        className={`transition hover:bg-slate-50 ${
                          isSelecionado ? 'bg-blue-50/60 font-semibold text-azul' : 'text-slate-700'
                        }`}
                      >
                        <td className="py-3 px-3 capitalize font-bold">
                          {item.rotulo} {isSelecionado && <span className="ml-1 text-[10px] bg-azul text-white px-1.5 py-0.5 rounded">Atual</span>}
                        </td>
                        <td className="py-3 px-3 text-emerald-600 font-bold">{formatBRL(item.receitas)}</td>
                        <td className="py-3 px-3 text-rose-600 font-bold">{formatBRL(item.despesas)}</td>
                        <td className={`py-3 px-3 font-bold ${item.saldo >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>
                          {formatBRL(item.saldo)}
                        </td>
                        <td className="py-3 px-3">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold ${
                            item.taxaPoupanca >= 20 ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'
                          }`}>
                            {item.taxaPoupanca.toFixed(1)}%
                          </span>
                        </td>
                        <td className="py-3 px-3 text-right">
                          <button
                            type="button"
                            onClick={() => setMesSelecionado(item.mesYm)}
                            className="text-xs text-azul hover:underline font-bold"
                          >
                            Ver detalhes
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Comparativo de Gastos por Categoria (Mês Atual vs Mês Anterior) */}
          <div className="rounded-2xl bg-white p-6 border border-slate-200/80 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <Layers className="h-5 w-5 text-azul" />
                <h2 className="text-base font-bold text-marinho">
                  Onde os gastos mudaram vs Mês Anterior
                </h2>
              </div>
              <span className="text-xs text-slate-500">
                Comparação {formatMonth(mesSelecionado)} vs {formatMonth(mesAnteriorYm)}
              </span>
            </div>

            <div className="space-y-3">
              {comparativoCategorias.map(item => {
                const subiu = item.diferenca > 0
                return (
                  <div
                    key={item.cat.id}
                    className="p-3.5 rounded-xl border border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50 transition"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className="h-8 w-8 rounded-lg flex items-center justify-center text-white font-bold"
                        style={{ backgroundColor: item.cat.cor }}
                      >
                        <span className="text-xs">●</span>
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-slate-800">{item.cat.nome}</h4>
                        <p className="text-[11px] text-slate-400">
                          Mês anterior: {formatBRL(item.gastoAnterior)}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <span className="text-xs font-bold text-slate-900">{formatBRL(item.gastoAtual)}</span>
                        <div className={`text-[11px] font-bold flex items-center justify-end gap-0.5 ${
                          subiu ? 'text-rose-600' : item.diferenca < 0 ? 'text-emerald-600' : 'text-slate-400'
                        }`}>
                          {subiu ? <ArrowUpRight className="h-3 w-3" /> : item.diferenca < 0 ? <ArrowDownRight className="h-3 w-3" /> : null}
                          {subiu ? '+' : ''}{formatBRL(item.diferenca)} ({item.percVar > 0 ? `+${item.percVar.toFixed(0)}%` : `${item.percVar.toFixed(0)}%`})
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
