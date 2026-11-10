import { centsFromDb } from './format'
import type { Cents } from './format'
import { indicadoresDaLinha } from './indicadores'
import type { Indicadores, Linha } from './indicadores'
import { supabase } from './supabase'

export interface CompromissoDecisao {
  id: string
  descricao: string
  origem: string
  tipoOrigem: string
  mes: string
  moeda: string
  valor: Cents
}

export interface ProjecaoDecisao {
  diasNoMes: number
  diasDecorridos: number
  diasRestantes: number
  despesasPagas: Cents
  despesasPlanejadas: Cents
  variavelAteAgora: Cents
  ritmoDiario: Cents
  extraRitmo: Cents
  projetado: Cents
}

export interface HomeDecisao {
  inicioMes: string
  fimMes: string
  dataCorte: string
  dinheiroDisponivel: Cents
  reservasComprometidas: Cents
  saldoCirculante: Cents
  dinheiroLivre: Cents
  limiteDiarioSeguro: Cents
  ritmoDiarioAtual: Cents
  receitasPagas: Cents
  receitasPlanejadas: Cents
  despesasPagas: Cents
  despesasPlanejadas: Cents
  saidasPlanejadas: Cents
  projecao: ProjecaoDecisao
  compromissos: CompromissoDecisao[]
  /**
   * Os indicadores que a função já calculou por dentro (public.home_indicators na data de corte), para o Início
   * não pedir a mesma conta duas vezes; null = não veio ou veio ilegível (o Início pede à parte).
   */
  tesouraria: Indicadores | null
}

type Registro = Record<string, unknown>

function dinheiro(v: unknown): Cents {
  if (typeof v !== 'number' && typeof v !== 'string') return centsFromDb(0)
  return centsFromDb(v)
}

function texto(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function numero(v: unknown): number {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

function tesouraria(v: unknown): Indicadores | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  try {
    return indicadoresDaLinha(v as Linha)
  } catch {
    return null
  }
}

/** A decisão de caixa e a projeção vêm de uma única RPC; o cliente só converte para centavos e apresenta. */
export async function carregarHomeDecisao(familiaId: string, mes: string): Promise<HomeDecisao> {
  if (!supabase) throw new Error('Supabase não configurado')
  const { data, error } = await supabase.rpc('get_home_decision_month', {
    p_household: familiaId,
    p_month: `${mes}-01`,
  })
  if (error) throw error
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('decisão da Home indisponível')
  }

  const r = data as Registro
  const p = (r.projection && typeof r.projection === 'object' ? r.projection : {}) as Registro
  const compromissos = Array.isArray(r.upcoming_commitments) ? r.upcoming_commitments : []

  return {
    inicioMes: texto(r.monthStart),
    fimMes: texto(r.monthEnd),
    dataCorte: texto(r.asOf),
    dinheiroDisponivel: dinheiro(r.availableMoney),
    reservasComprometidas: dinheiro(r.reserveCommitted),
    saldoCirculante: dinheiro(r.circulatingBalance),
    dinheiroLivre: dinheiro(r.moneyFree),
    limiteDiarioSeguro: dinheiro(r.dailySafeLimit),
    ritmoDiarioAtual: dinheiro(r.currentDailyPace),
    receitasPagas: dinheiro(r.incomePaid),
    receitasPlanejadas: dinheiro(r.incomePlanned),
    despesasPagas: dinheiro(r.expensesPaid),
    despesasPlanejadas: dinheiro(r.expensesPlanned),
    saidasPlanejadas: dinheiro(r.plannedOutflows),
    projecao: {
      diasNoMes: numero(p.daysInMonth),
      diasDecorridos: numero(p.daysElapsed),
      diasRestantes: numero(p.daysLeft),
      despesasPagas: dinheiro(p.spent),
      despesasPlanejadas: dinheiro(p.planned),
      variavelAteAgora: dinheiro(p.variableSoFar),
      ritmoDiario: dinheiro(p.pacePerDay),
      extraRitmo: dinheiro(p.paceExtra),
      projetado: dinheiro(p.projected),
    },
    tesouraria: tesouraria(r.treasury),
    compromissos: compromissos.map((item) => {
      const i = item as Registro
      return {
        id: texto(i.id),
        descricao: texto(i.description),
        origem: texto(i.source),
        tipoOrigem: texto(i.sourceType),
        mes: texto(i.month),
        moeda: texto(i.currency),
        valor: dinheiro(i.amount),
      }
    }),
  }
}
