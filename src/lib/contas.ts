import { centsFromDb, centsToDecimal } from './format'
import type { Cents } from './format'
import { supabase } from './supabase'

export type TipoConta = 'checking' | 'savings' | 'investment' | 'cash' | 'other'

export const rotuloTipoConta: Record<TipoConta, string> = {
  checking: 'Conta corrente',
  savings: 'Poupança',
  investment: 'Investimento',
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
  /** Moeda da conta (accounts.currency_code, migration 055): BRL, USD, EUR. Só se escolhe na criação. */
  moeda: string
  /** Saldo calculado no banco (account_balances), NA MOEDA DA CONTA; null se a conta abre depois da data de referência. */
  saldo: Cents | null
}

/** Moedas que a conta pode ter (catálogo public.currencies, migration 027). */
export const MOEDAS_CONTA = [
  ['BRL', 'Real (R$)'],
  ['USD', 'Dólar (US$)'],
  ['EUR', 'Euro (€)'],
] as const

/**
 * Multimoeda F1 (migration 055): por enquanto só conta em reais aceita lançamento, recorrente, pagamento de cartão ou
 * de dívida e provento (o banco recusa nas outras). Os formulários usam isto para nem oferecer a conta estrangeira.
 * atalho: bloqueio provisório, liberado na F2 (receita/despesa) e F3 (transferência entre moedas).
 */
export function aceitaLancamento(c: { moeda?: string }): boolean {
  return (c.moeda ?? 'BRL') === 'BRL'
}

export interface DadosConta {
  nome: string
  tipo: TipoConta
  saldoInicial: Cents
  abertura: string
  /** Chave do banco (src/lib/bancos.ts) ou null. Carteira em dinheiro nunca tem banco. */
  banco?: string | null
  /** Só na criação (a moeda não muda na edição). Ausente = BRL, o padrão do banco. */
  moeda?: string
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

interface LinhaConta { id: string; name: string; type: TipoConta; initial_balance: number | string; opening_date: string; active: boolean; bank?: string | null; currency_code?: string }

const COLUNAS_BASE = 'id, name, type, initial_balance, opening_date, active'

/**
 * Lê as contas com o banco escolhido e a moeda; se uma coluna ainda não existe (banco sem a migration 017 ou 055),
 * tenta sem ela: a tela segue como antes, só sem o banco gravado ou com tudo em BRL.
 */
async function lerContas(db: NonNullable<typeof supabase>, familiaId: string): Promise<{ data: LinhaConta[]; error: { code?: string } | null }> {
  const ler = async (colunas: string): Promise<{ data: unknown; error: { code?: string } | null }> =>
    db.from('accounts').select(colunas).eq('household_id', familiaId).order('name')
  let r = await ler(`${COLUNAS_BASE}, bank, currency_code`)
  for (const colunas of [`${COLUNAS_BASE}, bank`, COLUNAS_BASE]) {
    if (r.error?.code !== COLUNA_INEXISTENTE) break
    r = await ler(colunas)
  }
  return { data: (r.data ?? []) as LinhaConta[], error: r.error }
}

/**
 * Contas da família com o saldo de hoje. O saldo e o total vêm do banco
 * (account_balances e balance_totals): o front nunca soma dinheiro.
 */
/** Saldo somado por tipo de conta, calculado no banco (balance_totals_by_type, migration 044). Só contas em BRL (055). */
export interface TotalPorTipo { tipo: TipoConta; total: Cents; totalAtivas: Cents }

/** Saldo somado por moeda, sem conversão (balance_totals_by_currency, migration 055). Nunca somar moedas diferentes. */
export interface TotalPorMoeda { moeda: string; total: Cents; totalAtivas: Cents }

/** Só as moedas que não são BRL: o bloco "Em outras moedas" (o total em reais já vem de balance_totals). */
export function outrasMoedas(porMoeda: TotalPorMoeda[]): TotalPorMoeda[] {
  return porMoeda.filter((m) => m.moeda !== 'BRL')
}

/** Função ainda não aplicada no banco (o front sobe antes da migration): a tela segue sem os subtotais. */
const FUNCAO_INEXISTENTE = ['PGRST202', '42883']

/** Total das contas por moeda na data, do banco (balance_totals_by_currency). Banco sem a migration 055: lista vazia. */
export async function totaisPorMoeda(familiaId: string, dataRef: string = hojeSP()): Promise<TotalPorMoeda[]> {
  const { data, error } = await cliente().rpc('balance_totals_by_currency', { p_household: familiaId, p_as_of: dataRef })
  if (error) {
    if (FUNCAO_INEXISTENTE.includes(error.code ?? '')) return []
    throw error
  }
  return ((data ?? []) as { currency_code: string; total: number | string; total_active: number | string }[])
    .map((m) => ({ moeda: m.currency_code, total: centsFromDb(m.total), totalAtivas: centsFromDb(m.total_active) }))
}

export async function listarContas(familiaId: string, dataRef: string = hojeSP()): Promise<{ contas: Conta[]; total: Cents; porTipo: TotalPorTipo[]; porMoeda: TotalPorMoeda[] }> {
  const db = cliente()
  const [contas, saldos, totais, porTipo, porMoeda] = await Promise.all([
    lerContas(db, familiaId),
    db.rpc('account_balances', { p_household: familiaId, p_as_of: dataRef }),
    db.rpc('balance_totals', { p_household: familiaId, p_as_of: dataRef }),
    db.rpc('balance_totals_by_type', { p_household: familiaId, p_as_of: dataRef }),
    totaisPorMoeda(familiaId, dataRef),
  ])
  for (const r of [contas, saldos, totais]) if (r.error) throw r.error
  if (porTipo.error && !FUNCAO_INEXISTENTE.includes(porTipo.error.code ?? '')) throw porTipo.error

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
      moeda: c.currency_code ?? 'BRL',
      saldo: saldoPorConta.get(c.id) ?? null,
    })),
    total: centsFromDb(linhaTotal?.total ?? 0),
    porTipo: porTipo.error ? [] : ((porTipo.data ?? []) as { account_type: TipoConta; total: number | string; total_active: number | string }[])
      .map((t) => ({ tipo: t.account_type, total: centsFromDb(t.total), totalAtivas: centsFromDb(t.total_active) })),
    porMoeda,
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
  // a moeda só vai quando não é BRL (o padrão do banco): criar conta em reais segue funcionando sem a migration 055
  const moeda = d.moeda && d.moeda !== 'BRL' ? { currency_code: d.moeda } : {}
  const { error } = await cliente().from('accounts').insert({ household_id: familiaId, ...linha(d), ...moeda })
  if (error) throw error
}

/** Edição nunca envia a moeda: ela só se escolhe na criação (o banco também recusa trocar com movimento). */
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
