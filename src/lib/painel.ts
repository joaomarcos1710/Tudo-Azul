import { centsFromDb } from './format'
import type { Cents } from './format'
import { supabase } from './supabase'

/** Patrimônio do modelo B (net_worth): disponível + crédito a receber − dívida. */
export interface Patrimonio {
  disponivel: Cents
  creditoAReceber: Cents
  divida: Cents
  patrimonio: Cents
  /** Bens familiares avaliados em BRL e ponderados pela participação da família. */
  bens: Cents
  /** Parcelas de cartão ainda não cobradas: aparecem à parte e não entram no patrimônio. */
  compromissos: Cents
}

export interface ProximoPlanejado {
  id: string
  tipo: 'income' | 'expense' | 'transfer'
  descricao: string
  valor: Cents
  data: string
  categoriaId: string | null
}

function cliente() {
  if (!supabase) throw new Error('Supabase não configurado')
  return supabase
}

export async function carregarPatrimonio(familiaId: string, dataRef: string): Promise<Patrimonio> {
  let { data, error } = await cliente().rpc('net_worth_with_assets', { p_household: familiaId, p_as_of: dataRef })
  if (error && (error.code === 'PGRST202' || error.code === '42883')) {
    // Compatibilidade durante o intervalo entre o deploy do front e a aplicação da migration.
    const legado = await cliente().rpc('net_worth', { p_household: familiaId, p_as_of: dataRef })
    if (legado.error) throw legado.error
    data = legado.data
  } else if (error) {
    throw error
  }
  const r = ((data ?? []) as Record<string, number | string>[])[0] ?? {}
  return {
    disponivel: centsFromDb(r.available ?? 0),
    creditoAReceber: centsFromDb(r.credit_receivable ?? 0),
    divida: centsFromDb(r.debt ?? 0),
    patrimonio: centsFromDb(r.net_worth ?? 0),
    bens: centsFromDb(r.family_assets_brl ?? 0),
    compromissos: centsFromDb(r.planned_commitments ?? 0),
  }
}

/** Próximos lançamentos planejados (contas a pagar e a receber) a partir de hoje. */
export async function proximosPlanejados(familiaId: string, deData: string, limite = 5): Promise<ProximoPlanejado[]> {
  const { data, error } = await cliente()
    .from('transactions')
    .select('id, type, description, amount, date, category_id')
    .eq('household_id', familiaId)
    .eq('status', 'planned')
    .is('deleted_at', null)
    .gte('date', deData)
    .order('date')
    .limit(limite)
  if (error) throw error
  return (data ?? []).map((t) => ({ id: t.id, tipo: t.type, descricao: t.description, valor: centsFromDb(t.amount), data: t.date, categoriaId: t.category_id ?? null }))
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

/** Renda regular × eventual de um período e quanto da despesa a renda regular cobre (income_regularity). */
export interface RegularidadeRenda {
  regular: Cents
  eventual: Cents
  despesas: Cents
  /** % da despesa coberta pela renda regular, já arredondado no banco (1 casa). null sem despesa no período. */
  cobertura: number | null
}

export async function regularidadeRenda(familiaId: string, de: string, ate: string): Promise<RegularidadeRenda> {
  const { data, error } = await cliente().rpc('income_regularity', { p_household: familiaId, p_from: de, p_to: ate })
  if (error) throw error
  const r = ((data ?? []) as Record<string, number | string | null>[])[0] ?? {}
  return {
    regular: centsFromDb(r.income_regular ?? 0),
    eventual: centsFromDb(r.income_eventual ?? 0),
    despesas: centsFromDb(r.expense_paid ?? 0),
    cobertura: r.coverage_pct === null || r.coverage_pct === undefined ? null : Number(r.coverage_pct),
  }
}

/** Projeção do mês (month_projection): já gasto + já previsto + ritmo do que é variável × dias que faltam. */
export interface ProjecaoMes {
  diasNoMes: number
  diasDecorridos: number
  diasRestantes: number
  gasto: Cents
  previsto: Cents
  /** Pago no mês e que não é recorrente (base do ritmo). */
  variavelAteAgora: Cents
  ritmoPorDia: Cents
  /** Ritmo × dias que faltam. */
  ritmoRestante: Cents
  projetado: Cents
}

export async function projecaoDoMes(familiaId: string, mes: string, hoje: string): Promise<ProjecaoMes | null> {
  const { data, error } = await cliente().rpc('month_projection', { p_household: familiaId, p_month: `${mes}-01`, p_today: hoje })
  if (error) throw error
  const r = ((data ?? []) as Record<string, number | string>[])[0]
  if (!r) return null
  return {
    diasNoMes: Number(r.days_in_month), diasDecorridos: Number(r.days_elapsed), diasRestantes: Number(r.days_left),
    gasto: centsFromDb(r.spent), previsto: centsFromDb(r.planned), variavelAteAgora: centsFromDb(r.variable_so_far),
    ritmoPorDia: centsFromDb(r.pace_per_day), ritmoRestante: centsFromDb(r.pace_extra), projetado: centsFromDb(r.projected),
  }
}

/** Planejado que já passou da data e continua sem ser pago/recebido. */
export interface Vencidos {
  /** Os mais antigos primeiro (até o limite pedido). */
  itens: ProximoPlanejado[]
  /** Quantos vencidos existem no total (pode ser maior que itens.length). */
  total: number
}

export async function vencidosPlanejados(familiaId: string, hoje: string, limite = 5): Promise<Vencidos> {
  const base = () => cliente().from('transactions').select('id, type, description, amount, date, category_id', { count: 'exact' })
    .eq('household_id', familiaId).eq('status', 'planned').is('deleted_at', null).lt('date', hoje)
  const { data, error, count } = await base().order('date').order('id').limit(limite)
  if (error) throw error
  return {
    itens: (data ?? []).map((t) => ({ id: t.id, tipo: t.type, descricao: t.description, valor: centsFromDb(t.amount), data: t.date, categoriaId: t.category_id ?? null })),
    total: count ?? (data ?? []).length,
  }
}


export interface ResumoInvestimento {
  moeda: 'BRL' | 'USD' | 'EUR'
  valorAtual: Cents
}

/** Saldo investido por moeda, sem conversão implícita entre BRL, USD e EUR. */
export async function carregarResumoInvestimentos(familiaId: string, dataRef: string): Promise<ResumoInvestimento[]> {
  const { data, error } = await cliente().rpc('investment_totals', {
    p_household: familiaId, p_as_of: dataRef,
  })
  if (error) throw error
  return ((data ?? []) as Record<string, string | number>[]).map((r) => ({
    moeda: r.currency_code as ResumoInvestimento['moeda'],
    valorAtual: centsFromDb(r.market_value ?? 0),
  }))
}
