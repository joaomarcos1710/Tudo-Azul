import { centsFromDb } from './format'
import type { Cents } from './format'
import { supabase } from './supabase'

/** Patrimônio do modelo B (net_worth): disponível + crédito a receber − dívida. */
export interface Patrimonio {
  disponivel: Cents
  creditoAReceber: Cents
  divida: Cents
  patrimonio: Cents
  /** Parcelas de cartão ainda não cobradas: aparecem à parte e não entram no patrimônio. */
  compromissos: Cents
}

export interface ProximoPlanejado {
  id: string
  tipo: 'income' | 'expense' | 'transfer'
  descricao: string
  valor: Cents
  data: string
}

function cliente() {
  if (!supabase) throw new Error('Supabase não configurado')
  return supabase
}

export async function carregarPatrimonio(familiaId: string, dataRef: string): Promise<Patrimonio> {
  const { data, error } = await cliente().rpc('net_worth', { p_household: familiaId, p_as_of: dataRef })
  if (error) throw error
  const r = ((data ?? []) as Record<string, number | string>[])[0] ?? {}
  return {
    disponivel: centsFromDb(r.available ?? 0),
    creditoAReceber: centsFromDb(r.credit_receivable ?? 0),
    divida: centsFromDb(r.debt ?? 0),
    patrimonio: centsFromDb(r.net_worth ?? 0),
    compromissos: centsFromDb(r.planned_commitments ?? 0),
  }
}

/** Próximos lançamentos planejados (contas a pagar e a receber) a partir de hoje. */
export async function proximosPlanejados(familiaId: string, deData: string, limite = 5): Promise<ProximoPlanejado[]> {
  const { data, error } = await cliente()
    .from('transactions')
    .select('id, type, description, amount, date')
    .eq('household_id', familiaId)
    .eq('status', 'planned')
    .is('deleted_at', null)
    .gte('date', deData)
    .order('date')
    .limit(limite)
  if (error) throw error
  return (data ?? []).map((t) => ({ id: t.id, tipo: t.type, descricao: t.description, valor: centsFromDb(t.amount), data: t.date }))
}

/** Fatia do gráfico de categorias; categoriaId nulo = "Outros" (somado no banco). */
export interface DespesaCategoria {
  categoriaId: string | null
  nome: string
  valor: Cents
  /** % do total do mês, já arredondado no banco (1 casa). */
  percentual: number
}

export interface DespesaDia {
  dia: string
  valor: Cents
  acumulado: Cents
}

export async function despesasPorCategoria(familiaId: string, de: string, ate: string, top = 4): Promise<DespesaCategoria[]> {
  const { data, error } = await cliente().rpc('expenses_by_category', { p_household: familiaId, p_from: de, p_to: ate, p_top: top })
  if (error) throw error
  return ((data ?? []) as Record<string, string | number | null>[]).map((r) => ({
    categoriaId: (r.category_id as string | null) ?? null,
    nome: r.name as string,
    valor: centsFromDb(r.amount ?? 0),
    percentual: Number(r.share ?? 0),
  }))
}

export async function despesasPorDia(familiaId: string, de: string, ate: string): Promise<DespesaDia[]> {
  const { data, error } = await cliente().rpc('daily_expenses', { p_household: familiaId, p_from: de, p_to: ate })
  if (error) throw error
  return ((data ?? []) as Record<string, string | number>[]).map((r) => ({
    dia: r.day as string,
    valor: centsFromDb(r.amount ?? 0),
    acumulado: centsFromDb(r.cumulative ?? 0),
  }))
}
