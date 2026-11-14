import { centsFromDb } from './format'
import type { Cents } from './format'
import { supabase } from './supabase'

/** De onde vem o parcelamento: compra parcelada num cartão, ou despesa parcelada numa conta. */
export type OrigemParcelamento = 'card' | 'account'
/** A parcela que vence neste mês: paga, pendente, ou nenhuma vence neste mês. */
export type SituacaoMes = 'paid' | 'pending' | 'none'

/** Um parcelamento em andamento. Tudo vem pronto de public.active_installment_plans (migration 20261112130000). */
export interface ParcelamentoAtivo {
  chave: string
  origem: OrigemParcelamento
  moeda: string
  descricao: string
  /** Cartão ou conta de onde a parcela sai. */
  origemId: string | null
  origemNome: string | null
  /** Valor líquido da parcela atual. */
  valorParcela: Cents
  /** "Parcela 6 de 10": posição entre as parcelas vivas (a cancelada/estornada inteira não conta). */
  parcelaAtual: number
  totalParcelas: number
  parcelasPagas: number
  /** 0 a 99, inteiro: calculado no banco (só chega a 100 quando tudo foi pago, e aí o parcelamento nem aparece). */
  percentualPago: number
  total: Cents
  pago: Cents
  saldoRestante: Cents
  /** Do restante, o que ainda não fechou (cartão) ou não venceu (conta): o "faturas futuras". */
  futuro: Cents
  situacaoMes: SituacaoMes
  proximoVencimento: string | null
  emAtraso: number
}

/** Um total por moeda: somado no banco, a tela só mostra. Moedas nunca se misturam. */
export interface TotalParcelamentos {
  moeda: string
  qtde: number
  saldoRestante: Cents
  futuro: Cents
}

export interface ParcelasAtivas {
  parcelamentos: ParcelamentoAtivo[]
  totais: TotalParcelamentos[]
}

interface LinhaBanco {
  row_kind: 'plan' | 'total'
  currency_code: string
  source_type: OrigemParcelamento | null
  plan_key: string | null
  description: string | null
  source_id: string | null
  source_name: string | null
  installment_amount: number | string | null
  current_number: number | null
  total_count: number | null
  paid_count: number | null
  percent_paid: number | null
  total_amount: number | string | null
  paid_amount: number | string | null
  remaining_amount: number | string
  future_amount: number | string
  month_status: SituacaoMes | null
  next_due: string | null
  overdue_count: number | null
  plan_count: number | null
}

/**
 * Parcelamentos em andamento da família (cartão e conta) e o total por moeda. O PostgreSQL decide o que é ativo,
 * o que está pago, o saldo restante e os totais; a tela não soma dinheiro (regra do projeto).
 */
export async function listarParcelasAtivas(familiaId: string): Promise<ParcelasAtivas> {
  if (!supabase) throw new Error('Supabase não configurado')
  const { data, error } = await supabase.rpc('active_installment_plans', { p_household: familiaId })
  if (error) throw error
  const linhas = (data ?? []) as LinhaBanco[]
  const parcelamentos: ParcelamentoAtivo[] = []
  const totais: TotalParcelamentos[] = []
  for (const l of linhas) {
    if (l.row_kind === 'total') {
      totais.push({
        moeda: l.currency_code, qtde: Number(l.plan_count ?? 0),
        saldoRestante: centsFromDb(l.remaining_amount), futuro: centsFromDb(l.future_amount),
      })
      continue
    }
    parcelamentos.push({
      chave: l.plan_key ?? `${l.currency_code}:${l.description}`,
      origem: l.source_type ?? 'account',
      moeda: l.currency_code,
      descricao: l.description ?? 'Parcelamento',
      origemId: l.source_id,
      origemNome: l.source_name,
      valorParcela: centsFromDb(l.installment_amount ?? 0),
      parcelaAtual: Number(l.current_number ?? 1),
      totalParcelas: Number(l.total_count ?? 0),
      parcelasPagas: Number(l.paid_count ?? 0),
      percentualPago: Number(l.percent_paid ?? 0),
      total: centsFromDb(l.total_amount ?? 0),
      pago: centsFromDb(l.paid_amount ?? 0),
      saldoRestante: centsFromDb(l.remaining_amount),
      futuro: centsFromDb(l.future_amount),
      situacaoMes: l.month_status ?? 'none',
      proximoVencimento: l.next_due,
      emAtraso: Number(l.overdue_count ?? 0),
    })
  }
  return { parcelamentos, totais }
}

/** Um parcelamento cuja última parcela vence em breve (installments_ending_soon, migration 20261114100000). */
export interface ParcelamentoQueAcaba {
  chave: string
  moeda: string
  descricao: string
  origemNome: string | null
  /** Vencimento da última parcela (a da fatura, no cartão). */
  ultimoVencimento: string
  /** Valor líquido da última parcela: o que sobra no orçamento por mês depois dela. */
  valor: Cents
}
export interface ParcelasQueAcabam {
  planos: ParcelamentoQueAcaba[]
  /** Por moeda: quantos terminam e quanto liberam por mês. Somado no banco; a tela não soma. */
  totais: { moeda: string; qtde: number; liberado: Cents }[]
}

/** Parcelamentos que terminam nos próximos `dias` dias e quanto liberam por mês. Falha aqui não deve esconder a lista (aviso opcional). */
export async function listarParcelasQueAcabam(familiaId: string, dias = 60): Promise<ParcelasQueAcabam> {
  if (!supabase) throw new Error('Supabase não configurado')
  const { data, error } = await supabase.rpc('installments_ending_soon', { p_household: familiaId, p_days: dias })
  if (error) throw error
  const planos: ParcelamentoQueAcaba[] = []
  const totais: ParcelasQueAcabam['totais'] = []
  for (const l of (data ?? []) as {
    row_kind: 'plan' | 'total'; currency_code: string; plan_key: string | null; description: string | null; source_name: string | null
    last_due: string | null; freed_monthly: number | string; plan_count: number | null
  }[]) {
    if (l.row_kind === 'total') {
      totais.push({ moeda: l.currency_code, qtde: Number(l.plan_count ?? 0), liberado: centsFromDb(l.freed_monthly) })
      continue
    }
    planos.push({
      chave: l.plan_key ?? `${l.currency_code}:${l.description}`, moeda: l.currency_code, descricao: l.description ?? 'Parcelamento',
      origemNome: l.source_name, ultimoVencimento: l.last_due ?? '', valor: centsFromDb(l.freed_monthly),
    })
  }
  return { planos, totais }
}

/** Situação de uma parcela na linha do tempo: paga, não paga e já vencida, ou ainda a vencer. */
export type EstadoParcela = 'paid' | 'overdue' | 'open'
/** Uma parcela viva de um parcelamento ativo (installment_plan_schedule, migration 20261114120000). */
export interface ParcelaDoCronograma {
  /** Posição entre as parcelas vivas (1 a N): a mesma do "Parcela n de N". */
  numero: number
  /** Cartão: vencimento da fatura; conta: data do lançamento. Pode faltar se o cartão não tiver essa fatura. */
  vencimento: string | null
  valor: Cents
  /** Cartão: rótulo (AAAA-MM) da fatura que a tela de Cartões abre. Conta: nulo. */
  faturaRotulo: string | null
  estado: EstadoParcela
  /** Vence no mês corrente (a "parcela do mês"). */
  noMes: boolean
}

/**
 * A linha do tempo de todos os parcelamentos ativos: as parcelas de cada um, em ordem, por chave do plano (a mesma de
 * active_installment_plans). Estado, vencimento e valores vêm do banco; a tela só mostra. Falha aqui não deve esconder a lista (opcional).
 */
export async function listarCronogramaParcelas(familiaId: string): Promise<Map<string, ParcelaDoCronograma[]>> {
  if (!supabase) throw new Error('Supabase não configurado')
  const { data, error } = await supabase.rpc('installment_plan_schedule', { p_household: familiaId })
  if (error) throw error
  const mapa = new Map<string, ParcelaDoCronograma[]>()
  for (const l of (data ?? []) as {
    plan_key: string; installment_number: number; due_date: string | null; amount: number | string
    invoice_label: string | null; state: EstadoParcela; in_month: boolean
  }[]) {
    const lista = mapa.get(l.plan_key) ?? []
    lista.push({
      numero: Number(l.installment_number), vencimento: l.due_date, valor: centsFromDb(l.amount),
      faturaRotulo: l.invoice_label, estado: l.state, noMes: Boolean(l.in_month),
    })
    mapa.set(l.plan_key, lista)
  }
  return mapa
}

/** O peso dos parcelamentos neste mês, por moeda (installment_month_summary, migration 20261114140000). Somado no banco. */
export interface ResumoParcelasDoMes {
  moeda: string
  /** Parcelamentos ativos. */
  ativos: number
  /** Quantos deles têm parcela que vence neste mês. */
  comParcelaNoMes: number
  /** Soma das parcelas que vencem neste mês (pagas e não pagas). */
  totalMes: Cents
  pagoMes: Cents
  /** O que falta pagar neste mês (inclui a parcela vencida e não paga). */
  faltaMes: Cents
  /** Até 3 descrições, dos parcelamentos de maior parcela. */
  exemplos: string[]
}

/** Resumo do mês para o card "Parcelas e carnês". Falha aqui não deve esconder a tela (opcional: banco sem a função, o card some). */
export async function resumoParcelasDoMes(familiaId: string): Promise<ResumoParcelasDoMes[]> {
  if (!supabase) throw new Error('Supabase não configurado')
  const { data, error } = await supabase.rpc('installment_month_summary', { p_household: familiaId })
  if (error) throw error
  return ((data ?? []) as {
    currency_code: string; active_count: number; month_count: number
    month_total: number | string; paid_total: number | string; pending_total: number | string; examples: string[] | null
  }[]).map((l) => ({
    moeda: l.currency_code, ativos: Number(l.active_count), comParcelaNoMes: Number(l.month_count),
    totalMes: centsFromDb(l.month_total), pagoMes: centsFromDb(l.paid_total), faltaMes: centsFromDb(l.pending_total),
    exemplos: l.examples ?? [],
  }))
}
