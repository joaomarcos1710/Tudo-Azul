import { centsFromDb, centsToDecimal } from './format'
import type { Cents } from './format'
import { supabase } from './supabase'

/** Conciliação com o extrato (migration 007): o saldo e os movimentos vêm do banco. */
export interface Movimento {
  origem: 'transaction' | 'debt'
  id: string
  data: string
  descricao: string
  /** Com sinal do ponto de vista da conta: + entra, − sai. */
  valor: Cents
  conferido: boolean
}

export interface Conciliacao {
  data: string
  saldoExtrato: Cents
  lancamentos: number
  criadaEm: string
}

function cliente() {
  if (!supabase) throw new Error('Supabase não configurado')
  return supabase
}

export async function saldoNaData(familiaId: string, contaId: string, data: string): Promise<Cents | null> {
  const { data: linhas, error } = await cliente().rpc('account_balances', { p_household: familiaId, p_as_of: data })
  if (error) throw error
  const l = ((linhas ?? []) as { account_id: string; balance: number | string }[]).find((x) => x.account_id === contaId)
  return l ? centsFromDb(l.balance) : null
}

export async function movimentosAte(contaId: string, data: string): Promise<Movimento[]> {
  const { data: linhas, error } = await cliente().rpc('account_movements', { p_account: contaId, p_to: data })
  if (error) throw error
  return ((linhas ?? []) as Record<string, string | number | boolean>[]).map((m) => ({
    origem: m.source as Movimento['origem'],
    id: m.id as string,
    data: m.date as string,
    descricao: (m.description as string) || 'Sem descrição',
    valor: centsFromDb(m.amount as string | number),
    conferido: Boolean(m.reconciled),
  }))
}

export async function ultimasConciliacoes(contaId: string, limite = 5): Promise<Conciliacao[]> {
  const { data, error } = await cliente()
    .from('account_reconciliations')
    .select('as_of, statement_balance, transactions, created_at')
    .eq('account_id', contaId)
    .order('as_of', { ascending: false })
    .limit(limite)
  if (error) throw error
  return (data ?? []).map((c) => ({
    data: c.as_of, saldoExtrato: centsFromDb(c.statement_balance), lancamentos: c.transactions, criadaEm: c.created_at,
  }))
}

/** Fecha a conciliação; o banco recusa se o saldo do app na data for diferente do extrato. */
export async function conciliar(contaId: string, data: string, saldoExtrato: Cents): Promise<void> {
  const { error } = await cliente().rpc('reconcile_account', {
    p_account: contaId, p_as_of: data, p_statement_balance: centsToDecimal(saldoExtrato),
  })
  if (error) throw error
}

export async function desfazerConferencia(lancamentoId: string): Promise<void> {
  const { error } = await cliente().rpc('unreconcile_transaction', { p_transaction: lancamentoId })
  if (error) throw error
}
