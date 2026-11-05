import { supabase } from './supabase'
import type { Cents } from './format'
import { centsFromDb } from './format'
import { limitesDoMes, somarMeses } from './lancamentos'

export type Passo = 'day' | 'week' | 'month'

export interface LinhaFluxo {
  /** Primeiro dia do balde (dia; segunda-feira da semana; dia 1 do mês). */
  inicio: string
  entradas: Cents
  saidas: Cents
  saldo: Cents
  acumulado: Cents
}

export interface FluxoCaixa {
  linhas: LinhaFluxo[]
  /** Totais do período inteiro, calculados no banco (o front não soma dinheiro de relatório). */
  totalEntradas: Cents
  totalSaidas: Cents
}

export interface FiltrosFluxo {
  /** Vazio ou ausente = todas as contas. */
  contas?: string[]
  /** Quem lançou; ausente = todos. */
  membro?: string
  /** Inclui lançamentos planejados e as parcelas de cartão que ainda vão ser cobradas. */
  incluirNaoPagos?: boolean
}

/**
 * Período do relatório: dia e semana mostram o mês escolhido; mês mostra os 12 meses que terminam nele.
 * O banco aceita no máximo 366 dias no passo diário e 10 anos nos demais.
 */
export function periodoDoFluxo(mes: string, passo: Passo): [string, string] {
  const fim = limitesDoMes(mes)[1]
  return passo === 'month' ? [limitesDoMes(somarMeses(mes, -11))[0], fim] : [limitesDoMes(mes)[0], fim]
}

/** Entradas x Saídas (cash_flow_report). Todo valor, saldo, acumulado e total vem do banco. */
export async function fluxoDeCaixa(familiaId: string, de: string, ate: string, passo: Passo, filtros: FiltrosFluxo = {}): Promise<FluxoCaixa> {
  if (!supabase) throw new Error('Supabase não configurado')
  const { data, error } = await supabase.rpc('cash_flow_report', {
    p_household: familiaId, p_from: de, p_to: ate, p_step: passo,
    p_accounts: filtros.contas && filtros.contas.length > 0 ? filtros.contas : null,
    p_member: filtros.membro || null,
    p_include_planned: filtros.incluirNaoPagos === true,
  })
  if (error) throw error
  const linhas = ((data ?? []) as Record<string, string | number>[])
  return {
    linhas: linhas.map((r) => ({
      inicio: r.period_start as string,
      entradas: centsFromDb(r.income ?? 0),
      saidas: centsFromDb(r.expense ?? 0),
      saldo: centsFromDb(r.balance ?? 0),
      acumulado: centsFromDb(r.cumulative ?? 0),
    })),
    totalEntradas: centsFromDb(linhas[0]?.total_income ?? 0),
    totalSaidas: centsFromDb(linhas[0]?.total_expense ?? 0),
  }
}

/**
 * Último dia de cada balde do relatório (só datas, nenhum dinheiro): o próprio dia; o domingo da semana; o último
 * dia do mês. Nunca passa do fim do período pedido (a última semana pode atravessar o mês).
 */
export function fimDoBalde(inicio: string, passo: Passo, ate: string): string {
  let fim = inicio
  if (passo === 'month') fim = limitesDoMes(inicio.slice(0, 7))[1]
  if (passo === 'week') {
    const [a, m, d] = inicio.split('-').map(Number)
    fim = new Date(Date.UTC(a, m - 1, d + 6)).toISOString().slice(0, 10)
  }
  return fim < ate ? fim : ate
}
