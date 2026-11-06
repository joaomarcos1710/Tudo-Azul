import { centsFromDb } from './format'
import type { Cents } from './format'
import { supabase } from './supabase'
import type { BaseGastosCartao } from './baseGastosCartao'

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
  /** Conta de origem; usada para mostrar De → Para nas transferências. */
  contaId: string | null
  /** Conta de destino (só em transferência). */
  destinoId: string | null
}

function cliente() {
  if (!supabase) throw new Error('Supabase não configurado')
  return supabase
}

export async function carregarPatrimonio(familiaId: string, dataRef: string): Promise<Patrimonio> {
  let { data, error } = await cliente().rpc('net_worth_with_assets', { p_household: familiaId, p_as_of: dataRef })
  if (error && (error.code === 'PGRST202' || error.code === '42883')) {
    // Compatibilidade durante o intervalo entre o deploy do front e a aplicação da migration 039.
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

/** Próximos lançamentos e parcelas planejadas a partir de hoje. */
export async function proximosPlanejados(familiaId: string, deData: string, limite = 5): Promise<ProximoPlanejado[]> {
  const db = cliente()
  const [lancamentos, agenda] = await Promise.all([
    db.from('transactions')
      .select('id, type, description, amount, date, category_id, account_id, destination_account_id')
      .eq('household_id', familiaId)
      .eq('status', 'planned')
      .is('deleted_at', null)
      .gte('date', deData)
      .order('date')
      .limit(limite),
    db.from('debt_payment_schedule')
      .select('id, debt_id, installment_number, due_date, amount')
      .eq('household_id', familiaId)
      .eq('status', 'planned')
      .gte('due_date', deData)
      .order('due_date')
      .limit(limite),
  ])
  if (lancamentos.error) throw lancamentos.error
  // Compatibilidade durante deploy gradual do front e da migration 038.
  const agendaDisponivel = agenda.error
    ? (['PGRST205', '42P01'].includes(agenda.error.code) ? [] : (() => { throw agenda.error })())
    : agenda.data ?? []
  const ids = [...new Set(agendaDisponivel.map((p) => p.debt_id as string))]
  const dividas = ids.length
    ? await db.from('debts').select('id,name,payment_method,payment_account_id').eq('household_id', familiaId).eq('active', true).in('id', ids)
    : { data: [], error: null }
  if (dividas.error) throw dividas.error
  const porDivida = new Map((dividas.data ?? []).map((d) => [d.id, d]))
  const previstos: ProximoPlanejado[] = (lancamentos.data ?? []).map((t) => ({
    id: t.id, tipo: t.type, descricao: t.description, valor: centsFromDb(t.amount), data: t.date,
    categoriaId: t.category_id ?? null, contaId: t.account_id ?? null, destinoId: t.destination_account_id ?? null,
  }))
  for (const p of agendaDisponivel) {
    const d = porDivida.get(p.debt_id)
    if (!d) continue
    previstos.push({
      id: `debt-${p.id}`, tipo: 'expense',
      descricao: `Parcela ${p.installment_number} · ${d.name}`,
      valor: centsFromDb(p.amount), data: p.due_date, categoriaId: null,
      contaId: d.payment_method === 'account_debit' ? d.payment_account_id : null, destinoId: null,
    })
  }
  return previstos.sort((a, b) => a.data.localeCompare(b.data) || a.id.localeCompare(b.id)).slice(0, limite)
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

/**
 * Despesas por categoria com a base dos gastos de cartão (migration 062). Na base da fatura (padrão) chama
 * expenses_by_category, como sempre: o gráfico continua funcionando mesmo antes de a 062 ser aplicada no banco.
 */
export async function despesasPorCategoria(familiaId: string, de: string, ate: string, top = 4, base: BaseGastosCartao = 'invoice'): Promise<DespesaCategoria[]> {
  const { data, error } = base === 'invoice'
    ? await cliente().rpc('expenses_by_category', { p_household: familiaId, p_from: de, p_to: ate, p_top: top })
    : await cliente().rpc('expenses_by_category_basis', { p_household: familiaId, p_from: de, p_to: ate, p_basis: base, p_top: top })
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
  const db = cliente()
  const [lancs, ativas] = await Promise.all([
    db.from('transactions').select('id, type, description, amount, date, category_id, account_id, destination_account_id', { count: 'exact' })
      .eq('household_id', familiaId).eq('status', 'planned').is('deleted_at', null).lt('date', hoje)
      .order('date').order('id').limit(limite),
    db.from('debts').select('id, name, payment_method, payment_account_id').eq('household_id', familiaId).eq('active', true),
  ])
  if (lancs.error) throw lancs.error
  if (ativas.error) throw ativas.error
  const itens: ProximoPlanejado[] = (lancs.data ?? []).map((t) => ({ id: t.id, tipo: t.type, descricao: t.description, valor: centsFromDb(t.amount), data: t.date, categoriaId: t.category_id ?? null, contaId: t.account_id ?? null, destinoId: t.destination_account_id ?? null }))
  let totalParcelas = 0
  const porDivida = new Map((ativas.data ?? []).map((d) => [d.id as string, d]))
  if (porDivida.size) {
    // parcela de dívida ativa que passou da data sem baixa também é vencido
    const agenda = await db.from('debt_payment_schedule').select('id, debt_id, installment_number, due_date, amount', { count: 'exact' })
      .eq('household_id', familiaId).eq('status', 'planned').in('debt_id', [...porDivida.keys()]).lt('due_date', hoje)
      .order('due_date').order('id').limit(limite)
    // banco ainda sem a agenda de dívidas (migration 038): segue só com os lançamentos
    if (agenda.error && !['PGRST205', '42P01'].includes(agenda.error.code)) throw agenda.error
    for (const p of agenda.error ? [] : agenda.data ?? []) {
      const d = porDivida.get(p.debt_id)
      if (!d) continue
      itens.push({
        id: `debt-${p.id}`, tipo: 'expense', descricao: `Parcela ${p.installment_number} · ${d.name}`,
        valor: centsFromDb(p.amount), data: p.due_date, categoriaId: null,
        contaId: d.payment_method === 'account_debit' ? d.payment_account_id : null, destinoId: null,
      })
    }
    totalParcelas = agenda.error ? 0 : agenda.count ?? (agenda.data ?? []).length
  }
  return {
    itens: itens.sort((a, b) => a.data.localeCompare(b.data) || a.id.localeCompare(b.id)).slice(0, limite),
    total: (lancs.count ?? (lancs.data ?? []).length) + totalParcelas,
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

/** Um ponto por mês: patrimônio e saldo das contas no último dia do mês (ou hoje, no mês corrente). */
export interface PontoPatrimonio {
  mes: string
  data: string
  patrimonio: Cents
  disponivel: Cents
}

/** Evolução: os meses que vieram do banco e os que falharam (estes ficam de fora, nunca viram zero). */
export interface EvolucaoPatrimonio {
  pontos: PontoPatrimonio[]
  /** Meses (AAAA-MM) que não carregaram, com o erro de cada um (para o aviso e o Sentry). */
  falhas: { mes: string; erro: unknown }[]
}

/** No máximo 2 chamadas de net_worth_with_assets ao mesmo tempo: 12 em paralelo esgotavam o pool do banco (HTTP 500). */
export const EVOLUCAO_EM_VOO = 2

/** Roda `fn` em cada item com no máximo `limite` em voo; devolve, na ordem dos itens, o resultado ou o erro de cada um. */
async function emFila<T, R>(itens: T[], limite: number, fn: (item: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const res: PromiseSettledResult<R>[] = new Array(itens.length)
  let proximo = 0
  const trabalhador = async () => {
    while (proximo < itens.length) {
      const i = proximo++
      try {
        res[i] = { status: 'fulfilled', value: await fn(itens[i]) }
      } catch (reason) {
        res[i] = { status: 'rejected', reason }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limite, itens.length) }, trabalhador))
  return res
}

/**
 * Evolução dos últimos `meses` meses. Cada ponto é o próprio net_worth_with_assets na data (saldo, dívida e
 * bens como estavam naquele dia): nada é somado aqui. As chamadas vão em fila (EVOLUCAO_EM_VOO por vez).
 * Um mês que falhe fica de fora e aparece em `falhas` (a tela avisa); nunca vira zero nem é estimado.
 * atalho: uma chamada por mês (12 ao todo); trocar por uma RPC única de série (net_worth_series) — ver 40 - Pendências.
 */
export async function evolucaoPatrimonio(familiaId: string, hoje: string, meses = 12): Promise<EvolucaoPatrimonio> {
  const atual = hoje.slice(0, 7)
  const datas = Array.from({ length: meses }, (_, i) => {
    const [a, m] = atual.split('-').map(Number)
    const d = new Date(Date.UTC(a, m - 1 - (meses - 1 - i), 1))
    const mes = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
    const ultimo = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
    const fim = `${mes}-${String(ultimo).padStart(2, '0')}`
    return { mes, data: fim < hoje ? fim : hoje }
  })
  const resultados = await emFila(datas, EVOLUCAO_EM_VOO, (d) => carregarPatrimonio(familiaId, d.data))
  const pontos: PontoPatrimonio[] = []
  const falhas: EvolucaoPatrimonio['falhas'] = []
  resultados.forEach((r, i) => {
    if (r.status === 'fulfilled') pontos.push({ ...datas[i], patrimonio: r.value.patrimonio, disponivel: r.value.disponivel })
    else falhas.push({ mes: datas[i].mes, erro: r.reason })
  })
  return { pontos, falhas }
}
