import { centsFromDb, centsToDecimal } from './format'
import type { Cents } from './format'
import { supabase } from './supabase'

export type TipoConta = 'checking' | 'savings' | 'cash' | 'other'

export const rotuloTipoConta: Record<TipoConta, string> = {
  checking: 'Conta corrente',
  savings: 'Poupança',
  cash: 'Dinheiro',
  other: 'Outra',
}

export interface Conta {
  id: string
  nome: string
  tipo: TipoConta
  saldoInicial: Cents
  /** AAAA-MM-DD: o saldo inicial vale no início deste dia. */
  abertura: string
  ativa: boolean
  /** Chave do banco escolhido (accounts.bank); null = não escolhido (o app tenta pelo nome). */
  banco: string | null
  /** Saldo calculado no banco (account_balances); null se a conta abre depois da data de referência. */
  saldo: Cents | null
}

export interface DadosConta {
  nome: string
  tipo: TipoConta
  saldoInicial: Cents
  abertura: string
  /** Chave do banco (src/lib/bancos.ts) ou null. Carteira em dinheiro nunca tem banco. */
  banco?: string | null
}

function cliente() {
  if (!supabase) throw new Error('Supabase não configurado')
  return supabase
}

/** Hoje (AAAA-MM-DD) no fuso de São Paulo, usado como data de referência dos saldos. */
export function hojeSP(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(agora)
}

/** Código do PostgreSQL para coluna inexistente: o banco ainda sem a migration 017 (banco da conta). */
export const COLUNA_INEXISTENTE = '42703'

interface LinhaConta { id: string; name: string; type: TipoConta; initial_balance: number | string; opening_date: string; active: boolean; bank?: string | null }

/** Lê as contas com o banco escolhido; se a coluna ainda não existe, lê sem ela (a tela segue como antes, só sem o banco gravado). */
async function lerContas(db: NonNullable<typeof supabase>, familiaId: string): Promise<{ data: LinhaConta[]; error: { code?: string } | null }> {
  const r = await db.from('accounts').select('id, name, type, initial_balance, opening_date, active, bank').eq('household_id', familiaId).order('name')
  if (r.error?.code !== COLUNA_INEXISTENTE) return { data: (r.data ?? []) as LinhaConta[], error: r.error }
  const sem = await db.from('accounts').select('id, name, type, initial_balance, opening_date, active').eq('household_id', familiaId).order('name')
  return { data: (sem.data ?? []) as LinhaConta[], error: sem.error }
}

/**
 * Contas da família com o saldo de hoje. O saldo e o total vêm do banco
 * (account_balances e balance_totals): o front nunca soma dinheiro.
 */
export async function listarContas(familiaId: string, dataRef: string = hojeSP()): Promise<{ contas: Conta[]; total: Cents }> {
  const db = cliente()
  const [contas, saldos, totais] = await Promise.all([
    lerContas(db, familiaId),
    db.rpc('account_balances', { p_household: familiaId, p_as_of: dataRef }),
    db.rpc('balance_totals', { p_household: familiaId, p_as_of: dataRef }),
  ])
  for (const r of [contas, saldos, totais]) if (r.error) throw r.error

  const saldoPorConta = new Map<string, Cents>(
    ((saldos.data ?? []) as { account_id: string; balance: number | string }[]).map((s) => [s.account_id, centsFromDb(s.balance)]),
  )
  const linhaTotal = ((totais.data ?? []) as { total: number | string }[])[0]
  return {
    contas: contas.data.map((c) => ({
      id: c.id,
      nome: c.name,
      tipo: c.type,
      saldoInicial: centsFromDb(c.initial_balance),
      abertura: c.opening_date,
      ativa: c.active,
      banco: c.bank ?? null,
      saldo: saldoPorConta.get(c.id) ?? null,
    })),
    total: centsFromDb(linhaTotal?.total ?? 0),
  }
}

function linha(d: DadosConta) {
  return {
    name: d.nome.trim(),
    type: d.tipo,
    // string decimal montada dos centavos, nunca cents / 100 (MODELO-DE-DADOS.md §5)
    initial_balance: centsToDecimal(d.saldoInicial),
    opening_date: d.abertura,
    // só entra no envio quando há o que gravar ou limpar: assim criar/editar conta segue funcionando no banco sem a coluna
    ...(d.banco === undefined ? {} : { bank: d.tipo === 'cash' ? null : d.banco }),
  }
}

export async function criarConta(familiaId: string, d: DadosConta): Promise<void> {
  const { error } = await cliente().from('accounts').insert({ household_id: familiaId, ...linha(d) })
  if (error) throw error
}

export async function editarConta(id: string, d: DadosConta): Promise<void> {
  const { error } = await cliente().from('accounts').update(linha(d)).eq('id', id)
  if (error) throw error
}

/** Exclui de vez a conta que nunca teve movimento. Com qualquer histórico o banco recusa (23503): só arquivar. */
export async function excluirConta(id: string): Promise<void> {
  const { error } = await cliente().rpc('account_delete', { p_id: id })
  if (error) throw error
}

/** Conta com histórico é arquivada, nunca apagada: continua nos saldos e no histórico. */
export async function definirAtiva(id: string, ativa: boolean): Promise<void> {
  const { error } = await cliente().from('accounts').update({ active: ativa }).eq('id', id)
  if (error) throw error
}
