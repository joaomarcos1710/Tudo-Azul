import { centsFromDb } from './format'
import type { Cents } from './format'
import { supabase } from './supabase'

/**
 * Saldo em qualquer data. Toda soma é do banco: a tela só mostra os números. Com os planejados, desde a migration 069
 * o banco também conta as assinaturas de cartão previstas e os lançamentos fixos ainda não gerados (como os Relatórios).
 * Parcelas com débito automático reduzem a conta contratual; boleto/manual sem conta reduzem só o total;
 * consignado aparece como compromisso, sem duplicar a saída de um salário já registrado líquido.
 */
function cliente() {
  if (!supabase) throw new Error('Supabase não configurado')
  return supabase
}

export interface SaldoTotal {
  efetuado: Cents
  planejado: Cents
  faturas: Cents
  /** Faturas e parcelas sem conta definida: entram no total, nunca em uma conta específica. */
  faturasSemConta: Cents
  saldo: Cents
}

type Linha = Record<string, string | number | boolean | null>
const dinheiro = (v: string | number | boolean | null | undefined) => centsFromDb((v ?? 0) as string | number)

/**
 * Saldo total em reais até a data (inclusive), do banco (balance_totals_projected). `incluirPlanejados = false` é o saldo
 * só do que já foi efetuado. Uma chamada só: o Início e o Calendário mostram só o total; o saldo de cada conta
 * (account_balances_projected) era lido e descartado, uma chamada a mais por abertura (melhoria de 13/11/2026).
 */
export async function saldoTotalProjetado(familiaId: string, ate: string, incluirPlanejados: boolean): Promise<SaldoTotal | null> {
  const { data, error } = await cliente().rpc('balance_totals_projected', { p_household: familiaId, p_as_of: ate, p_include_planned: incluirPlanejados })
  if (error) throw error
  const t = ((data ?? []) as Linha[])[0]
  return t ? {
    efetuado: dinheiro(t.realized), planejado: dinheiro(t.planned), faturas: dinheiro(t.invoices),
    faturasSemConta: dinheiro(t.unassigned_invoices), saldo: dinheiro(t.total),
  } : null
}

export interface FaturaQueVence {
  cartaoId: string
  cartao: string
  vencimento: string
  total: Cents
  pago: Cents
  falta: Cents
  contaPagamentoId: string | null
}

/** Faturas de todos os cartões que vencem entre as duas datas (inclusive), na ordem do vencimento. */
export async function faturasQueVencem(familiaId: string, de: string, ate: string): Promise<FaturaQueVence[]> {
  const { data, error } = await cliente().rpc('card_invoices_due', { p_household: familiaId, p_from: de, p_to: ate })
  if (error) throw error
  return ((data ?? []) as Linha[]).map((f) => ({
    cartaoId: f.debt_id as string, cartao: f.card_name as string, vencimento: f.due_date as string,
    total: dinheiro(f.total), pago: dinheiro(f.paid), falta: dinheiro(f.remaining), contaPagamentoId: (f.pay_account_id as string | null) ?? null,
  }))
}

/** Totais de um dia do Calendário numa moeda, somados no banco (calendar_day_totals, migration 130). */
export interface TotalDoDia {
  data: string
  moeda: string
  entradas: Cents
  saidas: Cents
  /** A parte das saídas que é fatura ou parcela (filtro "Faturas e Parcelas"). */
  faturasEParcelas: Cents
}

/** Totais de cada dia entre as duas datas (no máximo 62 dias), por moeda; só os dias com algo. */
export async function totaisDoDia(familiaId: string, de: string, ate: string): Promise<TotalDoDia[]> {
  const { data, error } = await cliente().rpc('calendar_day_totals', { p_household: familiaId, p_from: de, p_to: ate })
  if (error) throw error
  return ((data ?? []) as Linha[]).map((d) => ({
    data: d.day as string, moeda: d.currency as string,
    entradas: dinheiro(d.income), saidas: dinheiro(d.expense), faturasEParcelas: dinheiro(d.bills),
  }))
}
