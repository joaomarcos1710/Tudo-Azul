import { centsFromDb } from './format'
import type { Cents } from './format'
import { supabase } from './supabase'

/**
 * Saldo em qualquer data. Toda soma é do banco: a tela só mostra os números.
 * Parcelas com débito automático reduzem a conta contratual; boleto/manual sem conta reduzem só o total;
 * consignado aparece como compromisso, sem duplicar a saída de um salário já registrado líquido.
 */
function cliente() {
  if (!supabase) throw new Error('Supabase não configurado')
  return supabase
}

export interface SaldoDaConta {
  id: string
  nome: string
  ativa: boolean
  /** Moeda da conta (migration 055): os valores desta linha estão nela. Banco sem a 055: BRL. */
  moeda: string
  efetuado: Cents
  planejado: Cents
  faturas: Cents
  saldo: Cents
}

export interface SaldoTotal {
  efetuado: Cents
  planejado: Cents
  faturas: Cents
  /** Faturas e parcelas sem conta definida: entram no total, nunca em uma conta específica. */
  faturasSemConta: Cents
  saldo: Cents
}

export interface SaldoProjetado {
  contas: SaldoDaConta[]
  total: SaldoTotal | null
}

type Linha = Record<string, string | number | boolean | null>
const dinheiro = (v: string | number | boolean | null | undefined) => centsFromDb((v ?? 0) as string | number)

/** Saldo até a data (inclusive). `incluirPlanejados = false` é o saldo só do que já foi efetuado. */
export async function saldosProjetados(familiaId: string, ate: string, incluirPlanejados: boolean): Promise<SaldoProjetado> {
  const db = cliente()
  const [contas, total] = await Promise.all([
    db.rpc('account_balances_projected', { p_household: familiaId, p_as_of: ate, p_include_planned: incluirPlanejados }),
    db.rpc('balance_totals_projected', { p_household: familiaId, p_as_of: ate, p_include_planned: incluirPlanejados }),
  ])
  if (contas.error) throw contas.error
  if (total.error) throw total.error
  const t = ((total.data ?? []) as Linha[])[0]
  return {
    contas: ((contas.data ?? []) as Linha[]).map((c) => ({
      id: c.account_id as string, nome: c.name as string, ativa: c.active as boolean, moeda: (c.currency_code as string | undefined) ?? 'BRL',
      efetuado: dinheiro(c.realized), planejado: dinheiro(c.planned), faturas: dinheiro(c.invoices), saldo: dinheiro(c.balance),
    })),
    total: t ? {
      efetuado: dinheiro(t.realized), planejado: dinheiro(t.planned), faturas: dinheiro(t.invoices),
      faturasSemConta: dinheiro(t.unassigned_invoices), saldo: dinheiro(t.total),
    } : null,
  }
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
