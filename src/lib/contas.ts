import { centsFromDb, centsToDecimal } from './format'
import type { Cents } from './format'
import { supabase } from './supabase'
import { tipoSemBanco } from './bancos'

/**
 * Tipo da conta = onde o dinheiro está (migration 070, decisão do dono de 05/11/2026). A moeda é separada (`moeda`).
 * 'savings' é a "Poupança / reserva" (chave mantida da 001). 'investment' e 'other' não existem mais: a 070 converteu
 * investment -> fixed_income e other -> checking (genérico; o dono ajusta conta por conta).
 */
export type TipoConta = 'checking' | 'savings' | 'brokerage' | 'fixed_income' | 'variable_income' | 'crypto' | 'cash'

/** Os 7 tipos na ordem de sempre (a mesma de balance_totals_by_type). */
export const TIPOS_CONTA: readonly TipoConta[] = ['checking', 'savings', 'brokerage', 'fixed_income', 'variable_income', 'crypto', 'cash']

export const rotuloTipoConta: Record<TipoConta, string> = {
  checking: 'Conta corrente',
  savings: 'Poupança / reserva',
  brokerage: 'Corretora (saldo a aplicar)',
  fixed_income: 'Renda fixa',
  variable_income: 'Renda variável',
  crypto: 'Cripto',
  cash: 'Dinheiro (carteira)',
}

/** Explicação curta de cada tipo, embaixo do seletor do formulário. */
export const ajudaTipoConta: Record<TipoConta, string> = {
  checking: 'Conta do dia a dia: salário, contas a pagar, cartão.',
  savings: 'Reserva de emergência ou poupança.',
  brokerage: 'Dinheiro parado na corretora esperando ser aplicado: não rende. O que já foi aplicado vai em Renda fixa, Renda variável ou Cripto.',
  fixed_income: 'Tesouro, CDB, LCI/LCA e parecidos.',
  variable_income: 'Ações, FII, ETF e stocks.',
  crypto: 'Criptomoedas.',
  cash: 'Dinheiro em espécie. Não tem banco.',
}

/** Os tipos agrupados no seletor do formulário (cada grupo vira um <optgroup>). */
export const GRUPOS_TIPO_CONTA: readonly { rotulo: string; tipos: readonly TipoConta[] }[] = [
  { rotulo: 'Dia a dia', tipos: ['checking', 'cash'] },
  { rotulo: 'Reserva', tipos: ['savings'] },
  { rotulo: 'Investimentos', tipos: ['brokerage', 'fixed_income', 'variable_income', 'crypto'] },
]

export function ehTipoConta(tipo: string): tipo is TipoConta {
  return (TIPOS_CONTA as readonly string[]).includes(tipo)
}

/**
 * Rótulo de qualquer tipo, inclusive os de antes da 070 (o front pode subir antes da migration ser aplicada):
 * nunca some com a conta nem mostra a chave crua.
 */
export function rotuloDoTipo(tipo: string): string {
  if (ehTipoConta(tipo)) return rotuloTipoConta[tipo]
  return tipo === 'investment' ? 'Investimento (tipo antigo)' : tipo === 'other' ? 'Outra (tipo antigo)' : tipo
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

/** Para que a conta vai ser usada: lançamento (receita, despesa, parcelado, recorrente e transferência) ou cartão/dívida/provento. */
export type UsoConta = 'lancamento' | 'cartao_divida_provento'

/** Conta em reais (sem moeda conhecida = BRL, o padrão do banco). */
export function ehReais(c: { moeda?: string }): boolean {
  return (c.moeda ?? 'BRL') === 'BRL'
}

/**
 * Multimoeda F2 (migration 056): receita e despesa (avulsa, parcelada e recorrente) e transferência aceitam conta em
 * qualquer moeda; cartão (conta de pagamento), dívida (evento e conta de pagamento) e provento seguem só em reais (o
 * banco recusa nas outras). Os formulários usam isto para nem oferecer a conta que o banco recusaria.
 * Transferência: além disto, destino só na mesma moeda da origem (`mesmaMoeda`).
 * atalho: transferência entre moedas diferentes fica para a F3 (com a cotação); cartão, dívida e provento em outra
 * moeda não têm fase prevista.
 */
export function aceitaLancamento(c: { moeda?: string }, uso: UsoConta): boolean {
  return uso === 'lancamento' || ehReais(c)
}

/** Duas contas na mesma moeda: a única transferência aceita até a F3. */
export function mesmaMoeda(a: { moeda?: string }, b: { moeda?: string }): boolean {
  return (a.moeda ?? 'BRL') === (b.moeda ?? 'BRL')
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
    ...(d.banco === undefined ? {} : { bank: tipoSemBanco(d.tipo) ? null : d.banco }),
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
