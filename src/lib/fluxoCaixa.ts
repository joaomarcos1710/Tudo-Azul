import { supabase } from './supabase'
import type { Cents } from './format'
import { centsFromDb } from './format'

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

/** Uma linha do relatório Entradas x Saídas do período escolhido (cash_flow_series, migration 066). */
export interface LinhaSerie {
  /** O balde inteiro, só para o rótulo (a 1ª e a última semana podem passar do período; os valores, não). */
  inicio: string
  fim: string
  entradas: Cents
  saidas: Cents
  resultado: Cents
  /** Saldo total em reais no último dia da linha (cortado no fim do período); null com filtro de conta ou de quem lançou. */
  saldo: Cents | null
}

export interface SerieFluxo {
  linhas: LinhaSerie[]
  /** Do período inteiro, calculados no banco (o front não soma dinheiro de relatório). */
  totalEntradas: Cents
  totalSaidas: Cents
  totalResultado: Cents
}

/**
 * Entradas x Saídas SÓ do período [de, até], fatiado por dia, semana, mês ou numa linha (total = acumulado), com o saldo
 * no fim de cada linha: uma chamada só (antes, uma de balance_totals_projected por linha). Todo valor vem do banco.
 */
export async function serieFluxo(familiaId: string, de: string, ate: string, divisao: Passo | 'total', filtros: FiltrosFluxo = {}): Promise<SerieFluxo> {
  if (!supabase) throw new Error('Supabase não configurado')
  const { data, error } = await supabase.rpc('cash_flow_series', {
    p_household: familiaId, p_from: de, p_to: ate, p_step: divisao,
    p_accounts: filtros.contas && filtros.contas.length > 0 ? filtros.contas : null,
    p_member: filtros.membro || null,
    p_include_planned: filtros.incluirNaoPagos === true,
  })
  if (error) throw error
  const linhas = ((data ?? []) as Record<string, string | number | null>[])
  return {
    linhas: linhas.map((r) => ({
      inicio: r.period_start as string,
      fim: r.period_end as string,
      entradas: centsFromDb(r.income ?? 0),
      saidas: centsFromDb(r.expense ?? 0),
      resultado: centsFromDb(r.result ?? 0),
      saldo: r.closing_balance === null || r.closing_balance === undefined ? null : centsFromDb(r.closing_balance),
    })),
    totalEntradas: centsFromDb(linhas[0]?.total_income ?? 0),
    totalSaidas: centsFromDb(linhas[0]?.total_expense ?? 0),
    totalResultado: centsFromDb(linhas[0]?.total_result ?? 0),
  }
}

/** Uma conta do Relatório › Contas (account_flow_report, migration 068). Tudo em centavos, calculado no banco. */
export interface LinhaConta {
  contaId: string
  nome: string
  tipo: string
  saldoInicial: Cents
  /** O que entrou na conta no período, INCLUSIVE transferência de outra conta. */
  entradas: Cents
  /** O que saiu da conta no período, INCLUSIVE transferência para outra conta (positivo, como vem do banco). */
  saidas: Cents
  transferenciasEntrada: Cents
  transferenciasSaida: Cents
  saldoFinal: Cents
}

export interface RelatorioContas {
  linhas: LinhaConta[]
  totalInicial: Cents
  /** Do banco, SEM as transferências entre contas (não inflam o total da família). */
  totalEntradas: Cents
  totalSaidas: Cents
  /** Entradas − saídas por transferência das contas listadas: zero quando as duas pontas estão na lista. */
  totalTransferencias: Cents
  totalFinal: Cents
}

/**
 * Relatório › Contas do período [de, até]: uma linha por conta ativa em reais (saldo no início, entradas, saídas e saldo
 * no fim) e o total, numa chamada só. Com não pagos: planejados, faturas a pagar e assinaturas previstas no vencimento e
 * lançamentos fixos ainda não gerados. Todo valor e total vem do banco (o front não soma).
 */
export async function relatorioContas(familiaId: string, de: string, ate: string, incluirNaoPagos: boolean): Promise<RelatorioContas> {
  if (!supabase) throw new Error('Supabase não configurado')
  const { data, error } = await supabase.rpc('account_flow_report', {
    p_household: familiaId, p_from: de, p_to: ate, p_include_planned: incluirNaoPagos,
  })
  if (error) throw error
  const linhas = ((data ?? []) as Record<string, string | number>[])
  const t = linhas[0]
  return {
    linhas: linhas.map((r) => ({
      contaId: r.account_id as string,
      nome: r.name as string,
      tipo: r.type as string,
      saldoInicial: centsFromDb(r.opening_balance ?? 0),
      entradas: centsFromDb(r.income ?? 0),
      saidas: centsFromDb(r.expense ?? 0),
      transferenciasEntrada: centsFromDb(r.transfer_in ?? 0),
      transferenciasSaida: centsFromDb(r.transfer_out ?? 0),
      saldoFinal: centsFromDb(r.closing_balance ?? 0),
    })),
    totalInicial: centsFromDb(t?.total_opening ?? 0),
    totalEntradas: centsFromDb(t?.total_income ?? 0),
    totalSaidas: centsFromDb(t?.total_expense ?? 0),
    totalTransferencias: centsFromDb(t?.total_transfers ?? 0),
    totalFinal: centsFromDb(t?.total_closing ?? 0),
  }
}
