import { centsFromDb, centsToDecimal } from './format'
import type { Cents } from './format'
import { supabase } from './supabase'

export type TipoLancamento = 'income' | 'expense' | 'transfer'
export type StatusLancamento = 'paid' | 'planned'

export interface Lancamento {
  id: string
  tipo: TipoLancamento
  contaId: string
  /** Só em transferência. */
  destinoId: string | null
  /** Obrigatória em receita e despesa; nula em transferência (regra do banco). */
  categoriaId: string | null
  descricao: string
  valor: Cents
  /** AAAA-MM-DD */
  data: string
  status: StatusLancamento
  notas: string
  /** Gerado por uma regra recorrente (só leitura: o vínculo é gravado pelo banco). */
  recorrente?: boolean
}

export type DadosLancamento = Omit<Lancamento, 'id' | 'recorrente'>

/** Totais do mês calculados no banco (period_summary): a tela não soma dinheiro. */
export interface ResumoMes {
  receitas: Cents
  despesas: Cents
  resultado: Cents
  receitasPrevistas: Cents
  despesasPrevistas: Cents
}

function cliente() {
  if (!supabase) throw new Error('Supabase não configurado')
  return supabase
}

/** "2026-10" -> ["2026-10-01", "2026-10-31"] sem passar por fuso horário. */
export function limitesDoMes(mes: string): [string, string] {
  const [a, m] = mes.split('-').map(Number)
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate()
  return [`${mes}-01`, `${mes}-${String(ultimo).padStart(2, '0')}`]
}

/** "2026-10" + 1 -> "2026-11"; "2026-01" - 1 -> "2025-12". */
export function somarMeses(mes: string, n: number): string {
  const [a, m] = mes.split('-').map(Number)
  const d = new Date(Date.UTC(a, m - 1 + n, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export interface Filtros {
  contaId?: string
  categoriaId?: string
  tipo?: TipoLancamento
}

export async function listarLancamentos(familiaId: string, mes: string, f: Filtros = {}): Promise<Lancamento[]> {
  const [de, ate] = limitesDoMes(mes)
  let consulta = cliente()
    .from('transactions')
    .select('id, type, account_id, destination_account_id, category_id, description, amount, date, status, notes, recurrence_id')
    .eq('household_id', familiaId)
    .is('deleted_at', null)
    .gte('date', de)
    .lte('date', ate)
  // conta filtra origem ou destino: a transferência aparece nas duas contas
  if (f.contaId) consulta = consulta.or(`account_id.eq.${f.contaId},destination_account_id.eq.${f.contaId}`)
  if (f.categoriaId) consulta = consulta.eq('category_id', f.categoriaId)
  if (f.tipo) consulta = consulta.eq('type', f.tipo)
  const { data, error } = await consulta.order('date', { ascending: false }).order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map((t) => ({
    id: t.id,
    tipo: t.type,
    contaId: t.account_id,
    destinoId: t.destination_account_id,
    categoriaId: t.category_id,
    descricao: t.description,
    valor: centsFromDb(t.amount),
    data: t.date,
    status: t.status,
    notas: t.notes ?? '',
    recorrente: t.recurrence_id != null,
  }))
}

export async function resumoDoMes(familiaId: string, mes: string): Promise<ResumoMes> {
  const [de, ate] = limitesDoMes(mes)
  const { data, error } = await cliente().rpc('period_summary', { p_household: familiaId, p_from: de, p_to: ate })
  if (error) throw error
  const r = ((data ?? []) as Record<string, number | string>[])[0] ?? {}
  return {
    receitas: centsFromDb(r.income_paid ?? 0),
    despesas: centsFromDb(r.expense_paid ?? 0),
    resultado: centsFromDb(r.result ?? 0),
    receitasPrevistas: centsFromDb(r.income_planned ?? 0),
    despesasPrevistas: centsFromDb(r.expense_planned ?? 0),
  }
}

function linha(d: DadosLancamento) {
  const transferencia = d.tipo === 'transfer'
  return {
    type: d.tipo,
    account_id: d.contaId,
    destination_account_id: transferencia ? d.destinoId : null,
    category_id: transferencia ? null : d.categoriaId,
    description: d.descricao.trim(),
    // string decimal montada dos centavos, nunca cents / 100 (MODELO-DE-DADOS.md §5)
    amount: centsToDecimal(d.valor),
    date: d.data,
    status: d.status,
    notes: d.notas.trim() || null,
  }
}

export async function criarLancamento(familiaId: string, d: DadosLancamento): Promise<void> {
  const { error } = await cliente().from('transactions').insert({ household_id: familiaId, ...linha(d) })
  if (error) throw error
}

export async function editarLancamento(id: string, d: DadosLancamento): Promise<void> {
  const { error } = await cliente().from('transactions').update(linha(d)).eq('id', id)
  if (error) throw error
}

export async function marcarComoPago(id: string): Promise<void> {
  const { error } = await cliente().from('transactions').update({ status: 'paid' }).eq('id', id)
  if (error) throw error
}

/** O cliente nunca apaga lançamento: vai para a lixeira (deleted_at) e pode ser restaurado. */
export async function moverParaLixeira(id: string): Promise<void> {
  const { error } = await cliente().from('transactions').update({ deleted_at: new Date().toISOString() }).eq('id', id)
  if (error) throw error
}

export async function restaurarDaLixeira(id: string): Promise<void> {
  const { error } = await cliente().from('transactions').update({ deleted_at: null }).eq('id', id)
  if (error) throw error
}
