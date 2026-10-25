import { centsFromDb, centsToDecimal } from './format'
import type { Cents } from './format'
import { supabase } from './supabase'

/** Conciliação com o extrato (migration 007): o saldo e os movimentos vêm do banco. */
export interface Movimento {
  /** opening = saldo inicial da conta (saldo inicial + movimentos = saldo do app). */
  origem: 'opening' | 'transaction' | 'debt'
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

/** Desfaz a ÚLTIMA conciliação da conta (destrava o período). Devolve a nova data travada, se houver. */
export async function desfazerUltimaConciliacao(contaId: string): Promise<string | null> {
  const { data, error } = await cliente().rpc('reconciliation_undo', { p_account: contaId })
  if (error) throw error
  return (data as string | null) ?? null
}

/**
 * Data da última conferência de cada conta (as nunca conferidas ficam de fora do mapa). Uma consulta por conta, só a mais
 * recente: um limite global de linhas faria uma conta antiga parecer "nunca conferida" depois de anos de uso.
 */
export async function ultimasConferencias(familiaId: string): Promise<Map<string, string>> {
  const db = cliente()
  const contas = await db.from('accounts').select('id').eq('household_id', familiaId)
  if (contas.error) throw contas.error
  const linhas = await Promise.all((contas.data ?? []).map(async (c) => {
    const { data, error } = await db.from('account_reconciliations').select('as_of')
      .eq('account_id', c.id).order('as_of', { ascending: false }).limit(1)
    if (error) throw error
    return [c.id as string, (data ?? [])[0]?.as_of as string | undefined] as const
  }))
  const mapa = new Map<string, string>()
  for (const [id, data] of linhas) if (data) mapa.set(id, data)
  return mapa
}
