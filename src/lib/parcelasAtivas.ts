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
