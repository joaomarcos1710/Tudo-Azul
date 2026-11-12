import { centsFromDb, centsToDecimal } from './format'
import type { Cents } from './format'
import { supabase } from './supabase'

/**
 * Lançamentos recorrentes (migrations 006 e 016). O banco gera as ocorrências (recurrence_materialize):
 * em conta, planejados até o fim do mês daqui a 12 meses (migration 022), ou até a data final da regra, no máximo 360 meses
 * (24 na semanal); no cartão, a compra no dia da ocorrência.
 * Frequência = unidade (mês ou semana) + "a cada N". Frequência, dia e início não mudam depois de criados.
 */
export type TipoRecorrencia = 'expense' | 'income' | 'transfer' | 'card'
export type UnidadeFrequencia = 'month' | 'week' | 'day'

export const rotuloTipoRecorrencia: Record<TipoRecorrencia, string> = {
  expense: 'Despesa em conta',
  income: 'Receita em conta',
  transfer: 'Transferência entre contas',
  card: 'Assinatura no cartão',
}

/**
 * Natureza da recorrência (migration 20261112120000): classificação analítica escolhida pelo dono, sem efeito em valor,
 * data ou relatório. null = sem classificação. Receita só aceita 'reimbursement'; despesa e cartão, as outras três;
 * transferência nenhuma (o banco recusa o resto).
 */
export type NaturezaRecorrencia = 'fixed' | 'subscription' | 'variable' | 'reimbursement'
export const rotuloNatureza: Record<NaturezaRecorrencia, string> = {
  fixed: 'Custo fixo',
  subscription: 'Assinatura ou app',
  variable: 'Gasto variável',
  reimbursement: 'Ressarcimento a receber',
}
export function naturezasDoTipo(tipo: TipoRecorrencia): NaturezaRecorrencia[] {
  if (tipo === 'income') return ['reimbursement']
  if (tipo === 'transfer') return []
  return ['fixed', 'subscription', 'variable']
}

/** Limites aceitos pelo banco (constraint recurrences_frequency). */
export const MAX_CADA: Record<UnidadeFrequencia, number> = { month: 12, week: 4, day: 365 }

/** As opções da tela. Quinzenal = a cada 14 dias (não "duas vezes por mês": isso são duas regras mensais). */
export const frequencias: { chave: string; rotulo: string; unidade: UnidadeFrequencia; cada: number }[] = [
  { chave: 'diaria', rotulo: 'Diária', unidade: 'day', cada: 1 },
  { chave: 'semanal', rotulo: 'Semanal', unidade: 'week', cada: 1 },
  { chave: 'quinzenal', rotulo: 'Quinzenal (a cada 14 dias)', unidade: 'week', cada: 2 },
  { chave: 'mensal', rotulo: 'Mensal', unidade: 'month', cada: 1 },
  { chave: 'bimestral', rotulo: 'Bimestral', unidade: 'month', cada: 2 },
  { chave: 'trimestral', rotulo: 'Trimestral', unidade: 'month', cada: 3 },
  { chave: 'semestral', rotulo: 'Semestral', unidade: 'month', cada: 6 },
  { chave: 'anual', rotulo: 'Anual', unidade: 'month', cada: 12 },
]

export interface Recorrencia {
  id: string
  tipo: TipoRecorrencia
  descricao: string
  valor: Cents
  /** Dia do mês (1–31) na unidade mês; null na unidade semana. */
  dia: number | null
  unidade: UnidadeFrequencia
  cada: number
  inicio: string
  fim: string | null
  contaId: string | null
  destinoId: string | null
  cartaoId: string | null
  categoriaId: string | null
  ativa: boolean
  personId?: string | null
  isSharedExpense?: boolean
  nature?: NaturezaRecorrencia | null
}

export type DadosRecorrencia = Omit<Recorrencia, 'id' | 'ativa'>

const DIAS_SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

function partes(iso: string): [number, number, number] {
  const [a, m, d] = iso.split('-').map(Number)
  return [a, m, d]
}
function iso(a: number, m: number, d: number): string {
  return `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}
function ultimoDia(a: number, m: number): number {
  return new Date(Date.UTC(a, m, 0)).getUTCDate()
}
/** Dia da semana de uma data AAAA-MM-DD (sem fuso: a data é só data). */
export function diaDaSemana(data: string): string {
  const [a, m, d] = partes(data)
  return DIAS_SEMANA[new Date(Date.UTC(a, m - 1, d)).getUTCDay()]
}
function somarDias(data: string, n: number): string {
  const [a, m, d] = partes(data)
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10)
}
function diasEntre(de: string, ate: string): number {
  const [a1, m1, d1] = partes(de)
  const [a2, m2, d2] = partes(ate)
  return Math.round((Date.UTC(a2, m2 - 1, d2) - Date.UTC(a1, m1 - 1, d1)) / 86_400_000)
}

/**
 * Próximas n datas da regra a partir de `desde` (inclusive), respeitando início e fim. Mesma regra do banco
 * (private.recurrence_occurrences, migration 016): mês com âncora no dia fixo (dia que o mês não tem = último dia),
 * meses = mês do início + k×N; semana = início + k×7×N. Só para mostrar na tela: quem gera é o banco.
 */
export function proximasOcorrencias(
  r: Pick<Recorrencia, 'unidade' | 'cada' | 'dia' | 'inicio' | 'fim'>, desde: string, n: number,
): string[] {
  const de = desde > r.inicio ? desde : r.inicio
  const fora = (d: string) => r.fim !== null && d > r.fim
  const out: string[] = []
  if (r.unidade === 'week' || r.unidade === 'day') {
    const passo = (r.unidade === 'week' ? 7 : 1) * r.cada
    let k = Math.max(0, Math.ceil(diasEntre(r.inicio, de) / passo))
    while (out.length < n) {
      const d = somarDias(r.inicio, k * passo)
      if (fora(d)) break
      out.push(d)
      k++
    }
    return out
  }
  if (r.dia === null) return out
  const [ai, mi] = partes(r.inicio)
  for (let k = 0; out.length < n && k < 1300; k++) {
    const total = (mi - 1) + k * r.cada
    const a = ai + Math.floor(total / 12)
    const m = (total % 12) + 1
    const d = iso(a, m, Math.min(r.dia, ultimoDia(a, m)))
    if (fora(d)) break
    if (d >= de) out.push(d)
  }
  return out
}

/** "Todo dia 10", "Trimestral · dia 31", "Toda sexta", "A cada 3 semanas · terça"… */
export function rotuloFrequencia(r: Pick<Recorrencia, 'unidade' | 'cada' | 'dia' | 'inicio'>): string {
  if (r.unidade === 'day') return r.cada === 1 ? 'Todo dia' : `A cada ${r.cada} dias`
  if (r.unidade === 'week') {
    const dia = diaDaSemana(r.inicio)
    if (r.cada === 1) return `${dia === 'sábado' || dia === 'domingo' ? 'Todo' : 'Toda'} ${dia}`
    if (r.cada === 2) return `Quinzenal · ${dia}`
    return `A cada ${r.cada} semanas · ${dia}`
  }
  if (r.cada === 1) return `Todo dia ${r.dia}`
  // anual: o mês é sempre o do início (meses da série = mês do início + k×12)
  if (r.cada === 12) return `Anual · ${r.dia} de ${MESES[partes(r.inicio)[1] - 1]}`
  const nome = frequencias.find((f) => f.unidade === 'month' && f.cada === r.cada)?.rotulo
  return `${nome ?? `A cada ${r.cada} meses`} · dia ${r.dia}`
}

function cliente() {
  if (!supabase) throw new Error('Supabase não configurado')
  return supabase
}

export async function listarRecorrencias(familiaId: string): Promise<Recorrencia[]> {
  const db = cliente()
  const consultar = (colunas: string) => db.from('recurrences').select(colunas)
    .eq('household_id', familiaId).order('active', { ascending: false }).order('day').order('description')
  type LinhaRecorrenciaDb = {
    id: string; kind: TipoRecorrencia; description: string; amount: number | string; day: number | null;
    freq_unit: UnidadeFrequencia; freq_every: number; start_date: string; end_date: string | null;
    account_id: string | null; destination_account_id: string | null; debt_id: string | null;
    category_id: string | null; active: boolean; person_id?: string | null; is_shared_expense?: boolean;
    nature?: NaturezaRecorrencia | null
  }
  let data: LinhaRecorrenciaDb[] | null = null
  let error: { code?: string; message?: string } | null = null
  // do mais novo para o mais antigo: com natureza (migration 20261112120000), só com pessoa, sem nenhum dos dois
  const base = 'id, kind, description, amount, day, freq_unit, freq_every, start_date, end_date, account_id, destination_account_id, debt_id, category_id, active'
  for (const colunas of [`${base}, person_id, is_shared_expense, nature`, `${base}, person_id, is_shared_expense`, base]) {
    const r = await consultar(colunas)
    data = r.data as unknown as LinhaRecorrenciaDb[] | null
    error = r.error
    if (!error || !['42703', 'PGRST204'].includes(error.code ?? '')) break
  }
  if (error) throw error
  return (data ?? []).map((r) => ({
    id: r.id,
    tipo: r.kind,
    descricao: r.description,
    valor: centsFromDb(r.amount),
    dia: r.day,
    unidade: r.freq_unit,
    cada: r.freq_every,
    inicio: r.start_date,
    fim: r.end_date,
    contaId: r.account_id,
    destinoId: r.destination_account_id,
    cartaoId: r.debt_id,
    categoriaId: r.category_id,
    ativa: r.active,
    personId: r.person_id ?? null,
    isSharedExpense: r.is_shared_expense ?? false,
    nature: r.nature ?? null,
  }))
}

export async function criarRecorrencia(d: DadosRecorrencia): Promise<void> {
  const db = cliente()
  const args = {
    p_kind: d.tipo, p_description: d.descricao.trim(), p_amount: centsToDecimal(d.valor),
    p_day: d.unidade === 'month' ? d.dia : null, p_start: d.inicio,
    p_account: d.tipo === 'card' ? null : d.contaId,
    p_destination: d.tipo === 'transfer' ? d.destinoId : null,
    p_debt: d.tipo === 'card' ? d.cartaoId : null,
    p_category: d.tipo === 'transfer' ? null : d.categoriaId,
    p_end: d.fim, p_freq_unit: d.unidade, p_freq_every: d.cada,
    p_person_id: d.tipo === 'expense' || d.tipo === 'card' ? d.personId ?? null : null,
    p_is_shared_expense: d.tipo === 'expense' || d.tipo === 'card' ? d.isSharedExpense ?? false : false,
  }
  // com natureza: função própria (atômica); sem natureza o caminho é o de sempre, que funciona também em banco sem a migration
  let { error } = d.nature
    ? await db.rpc('recurrence_create_with_nature', { ...args, p_nature: d.nature })
    : await db.rpc('recurrence_create_classified', args)
  if (error && ['PGRST202', '42883'].includes(error.code ?? '') && !args.p_person_id && !args.p_is_shared_expense && !d.nature) {
    const antigo = await db.rpc('recurrence_create', {
      p_kind: args.p_kind, p_description: args.p_description, p_amount: args.p_amount,
      p_day: args.p_day, p_start: args.p_start, p_account: args.p_account, p_destination: args.p_destination,
      p_debt: args.p_debt, p_category: args.p_category, p_end: args.p_end,
      p_freq_unit: args.p_freq_unit, p_freq_every: args.p_freq_every,
    })
    error = antigo.error
  }
  if (error) throw error
  // a regra já está gravada: se só a geração falhar, ela roda de novo ao abrir as telas. Lançar erro aqui faria a pessoa reenviar e duplicar a regra.
  await gerarOcorrencias().catch(() => undefined)
}

/**
 * Novo valor/descrição/categoria. Valor e descrição valem para os planejados não pagos de hoje em diante; a categoria vale para
 * todas as ocorrências (pagas, passadas e parcelas de cartão também). Campo a campo, sem desfazer o que foi corrigido à mão
 * (migrations 015 e 036).
 */
export async function editarRecorrencia(id: string, d: { descricao: string; valor: Cents; categoriaId: string | null; personId?: string | null; isSharedExpense?: boolean; nature?: NaturezaRecorrencia | null }): Promise<void> {
  const args = {
    p_id: id, p_description: d.descricao.trim(), p_amount: centsToDecimal(d.valor), p_category: d.categoriaId,
    p_person_id: d.personId ?? null, p_is_shared_expense: d.isSharedExpense ?? false,
  }
  // nature: undefined = não mexe (caminho de sempre); null = limpa; valor = grava (função própria, atômica com a edição)
  let { error } = d.nature !== undefined
    ? await cliente().rpc('recurrence_update_with_nature', { ...args, p_nature: d.nature })
    : await cliente().rpc('recurrence_update_classified', args)
  if (error && ['PGRST202', '42883'].includes(error.code ?? '') && !args.p_person_id && !args.p_is_shared_expense && !d.nature) {
    const antigo = await cliente().rpc('recurrence_update', {
      p_id: id, p_description: args.p_description, p_amount: args.p_amount, p_category: args.p_category,
    })
    error = antigo.error
  }
  if (error) throw error
}

export async function definirPessoaRecorrencia(id: string, personId: string | null, isSharedExpense: boolean): Promise<void> {
  const { error } = await cliente().rpc('recurrence_set_person', {
    p_id: id, p_person_id: personId, p_is_shared_expense: isSharedExpense,
  })
  if (error && ['PGRST202', '42883'].includes(error.code ?? '') && !personId && !isSharedExpense) return
  if (error) throw error
}

/**
 * Exclui o recorrente (ativo ou já encerrado): a regra some, os planejados de hoje em diante vão para a lixeira e o que já foi
 * pago ou lançado no cartão fica no histórico, sem o vínculo com a regra (migration 018). Devolve quantos planejados foram para a lixeira.
 */
export async function excluirRecorrencia(id: string): Promise<number> {
  const { data, error } = await cliente().rpc('recurrence_delete', { p_id: id })
  if (error) throw error
  return (data as number) ?? 0
}

export async function gerarOcorrencias(): Promise<number> {
  const { data, error } = await cliente().rpc('recurrence_materialize', {})
  if (error) throw error
  return (data as number) ?? 0
}

/**
 * Frequência normalizada (mesma regra de public.recurrence_summary, migration 063): dia → 'daily', semana → 'weekly',
 * mês 1/2/3/6/12 → mensal/bimestral/trimestral/semestral/anual, outro "a cada N meses" → 'custom'. Só classifica (agrupa a
 * lista); os totais de cada grupo vêm do banco.
 */
export type FrequenciaResumo = 'daily' | 'weekly' | 'monthly' | 'bimonthly' | 'quarterly' | 'semiannual' | 'yearly' | 'custom'
export const ordemFrequencias: FrequenciaResumo[] = ['daily', 'weekly', 'monthly', 'bimonthly', 'quarterly', 'semiannual', 'yearly', 'custom']
export const rotuloGrupoFrequencia: Record<FrequenciaResumo, string> = {
  daily: 'Diários / a cada N dias', weekly: 'Semanais / quinzenais', monthly: 'Mensais', bimonthly: 'Bimestrais',
  quarterly: 'Trimestrais', semiannual: 'Semestrais', yearly: 'Anuais', custom: 'Personalizados',
}
const porMeses: Record<number, FrequenciaResumo> = { 1: 'monthly', 2: 'bimonthly', 3: 'quarterly', 6: 'semiannual', 12: 'yearly' }
export function frequenciaResumo(r: Pick<Recorrencia, 'unidade' | 'cada'>): FrequenciaResumo {
  if (r.unidade === 'day') return 'daily'
  if (r.unidade === 'week') return 'weekly'
  return porMeses[r.cada] ?? 'custom'
}

/** Uma linha de public.recurrence_summary (migration 063). Meio nulo = conta + cartão (nível 'frequency_all'). */
export interface LinhaResumoRecorrencia {
  nivel: 'detail' | 'target' | 'frequency' | 'medium' | 'frequency_all'
  meio: 'account' | 'card' | null
  alvoId: string | null
  alvoNome: string | null
  tipo: 'expense' | 'income' | 'transfer'
  frequencia: FrequenciaResumo | null
  qtde: number
  /** Soma dos valores de uma ocorrência de cada regra. */
  porOcorrencia: Cents
  /** Equivalente por mês: round(x, 2) por regra no banco, depois a soma. */
  porMes: Cents
}

/** Totais dos recorrentes ativos em reais, por meio, conta/cartão, tipo e frequência. Tudo somado no banco (a tela não soma). */
export async function resumoRecorrencias(familiaId: string): Promise<LinhaResumoRecorrencia[]> {
  const { data, error } = await cliente().rpc('recurrence_summary', { p_household: familiaId })
  if (error) throw error
  return ((data ?? []) as {
    grouping_level: LinhaResumoRecorrencia['nivel']; medium: LinhaResumoRecorrencia['meio']; target_id: string | null
    target_name: string | null; kind: LinhaResumoRecorrencia['tipo']; frequency: FrequenciaResumo | null; item_count: number
    total_per_occurrence: number | string; total_monthly: number | string
  }[]).map((l) => ({
    nivel: l.grouping_level, meio: l.medium, alvoId: l.target_id, alvoNome: l.target_name, tipo: l.kind,
    frequencia: l.frequency, qtde: l.item_count,
    porOcorrencia: centsFromDb(l.total_per_occurrence), porMes: centsFromDb(l.total_monthly),
  }))
}

/** Recorte do resumo por natureza: 'none' = regra sem natureza; 'all' = total do tipo (despesa em conta e cartão, ou receita). */
export type NaturezaResumo = NaturezaRecorrencia | 'none' | 'all'
export interface LinhaNatureza {
  natureza: NaturezaResumo
  tipo: 'expense' | 'income'
  qtde: number
  /** Equivalente por mês, em centavos, somado no banco (round(x, 2) por regra, só reais, sem transferência). */
  porMes: Cents
}

/** Totais mensais dos recorrentes ativos por natureza (migration 20261112150000). Tudo somado no banco (a tela não soma). */
export async function resumoPorNatureza(familiaId: string): Promise<LinhaNatureza[]> {
  const { data, error } = await cliente().rpc('recurrence_nature_summary', { p_household: familiaId })
  if (error) throw error
  return ((data ?? []) as { nature: NaturezaResumo; kind: LinhaNatureza['tipo']; item_count: number; total_monthly: number | string }[])
    .map((l) => ({ natureza: l.nature, tipo: l.kind, qtde: l.item_count, porMes: centsFromDb(l.total_monthly) }))
}
