import { centsFromDb, centsToDecimal } from './format'
import type { Cents } from './format'
import { supabase } from './supabase'

/**
 * Lançamentos recorrentes (migration 006): regras mensais num dia fixo. O banco gera as
 * ocorrências (recurrence_materialize): em conta, planejados dos próximos 2 meses; no cartão,
 * a compra no dia da ocorrência.
 */
export type TipoRecorrencia = 'expense' | 'income' | 'transfer' | 'card'

export const rotuloTipoRecorrencia: Record<TipoRecorrencia, string> = {
  expense: 'Despesa em conta',
  income: 'Receita em conta',
  transfer: 'Transferência entre contas',
  card: 'Assinatura no cartão',
}

export interface Recorrencia {
  id: string
  tipo: TipoRecorrencia
  descricao: string
  valor: Cents
  dia: number
  inicio: string
  fim: string | null
  contaId: string | null
  destinoId: string | null
  cartaoId: string | null
  categoriaId: string | null
  ativa: boolean
}

export type DadosRecorrencia = Omit<Recorrencia, 'id' | 'fim' | 'ativa'>

function cliente() {
  if (!supabase) throw new Error('Supabase não configurado')
  return supabase
}

export async function listarRecorrencias(familiaId: string): Promise<Recorrencia[]> {
  const { data, error } = await cliente()
    .from('recurrences')
    .select('id, kind, description, amount, day, start_date, end_date, account_id, destination_account_id, debt_id, category_id, active')
    .eq('household_id', familiaId)
    .order('active', { ascending: false })
    .order('day')
    .order('description')
  if (error) throw error
  return (data ?? []).map((r) => ({
    id: r.id,
    tipo: r.kind,
    descricao: r.description,
    valor: centsFromDb(r.amount),
    dia: r.day,
    inicio: r.start_date,
    fim: r.end_date,
    contaId: r.account_id,
    destinoId: r.destination_account_id,
    cartaoId: r.debt_id,
    categoriaId: r.category_id,
    ativa: r.active,
  }))
}

export async function criarRecorrencia(d: DadosRecorrencia): Promise<void> {
  const db = cliente()
  const { error } = await db.rpc('recurrence_create', {
    p_kind: d.tipo, p_description: d.descricao.trim(), p_amount: centsToDecimal(d.valor), p_day: d.dia, p_start: d.inicio,
    p_account: d.tipo === 'card' ? null : d.contaId,
    p_destination: d.tipo === 'transfer' ? d.destinoId : null,
    p_debt: d.tipo === 'card' ? d.cartaoId : null,
    p_category: d.tipo === 'transfer' ? null : d.categoriaId,
  })
  if (error) throw error
  // a regra já está gravada: se só a geração falhar, ela roda de novo ao abrir as telas. Lançar erro aqui faria a pessoa reenviar e duplicar a regra.
  await gerarOcorrencias().catch(() => undefined)
}

/** Novo valor/descrição/categoria: vale para os planejados não pagos de hoje em diante. */
export async function editarRecorrencia(id: string, d: { descricao: string; valor: Cents; categoriaId: string | null }): Promise<void> {
  const { error } = await cliente().rpc('recurrence_update', {
    p_id: id, p_description: d.descricao.trim(), p_amount: centsToDecimal(d.valor), p_category: d.categoriaId,
  })
  if (error) throw error
}

/** Para de gerar; planejados futuros não pagos vão para a lixeira. */
export async function encerrarRecorrencia(id: string): Promise<void> {
  const { error } = await cliente().rpc('recurrence_end', { p_id: id })
  if (error) throw error
}

export async function gerarOcorrencias(): Promise<number> {
  const { data, error } = await cliente().rpc('recurrence_materialize', {})
  if (error) throw error
  return (data as number) ?? 0
}
