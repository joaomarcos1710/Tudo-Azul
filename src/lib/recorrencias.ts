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
export type UnidadeFrequencia = 'month' | 'week'

export const rotuloTipoRecorrencia: Record<TipoRecorrencia, string> = {
  expense: 'Despesa em conta',
  income: 'Receita em conta',
  transfer: 'Transferência entre contas',
  card: 'Assinatura no cartão',
}

/** Limites aceitos pelo banco (constraint recurrences_frequency). */
export const MAX_CADA: Record<UnidadeFrequencia, number> = { month: 12, week: 4 }

/** As opções da tela. Quinzenal = a cada 14 dias (não "duas vezes por mês": isso são duas regras mensais). */
export const frequencias: { chave: string; rotulo: string; unidade: UnidadeFrequencia; cada: number }[] = [
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
  if (r.unidade === 'week') {
    const passo = 7 * r.cada
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
  const { data, error } = await cliente()
    .from('recurrences')
    .select('id, kind, description, amount, day, freq_unit, freq_every, start_date, end_date, account_id, destination_account_id, debt_id, category_id, active')
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
    unidade: r.freq_unit,
    cada: r.freq_every,
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
    p_kind: d.tipo, p_description: d.descricao.trim(), p_amount: centsToDecimal(d.valor),
    p_day: d.unidade === 'week' ? null : d.dia, p_start: d.inicio,
    p_account: d.tipo === 'card' ? null : d.contaId,
    p_destination: d.tipo === 'transfer' ? d.destinoId : null,
    p_debt: d.tipo === 'card' ? d.cartaoId : null,
    p_category: d.tipo === 'transfer' ? null : d.categoriaId,
    p_end: d.fim,
    p_freq_unit: d.unidade, p_freq_every: d.cada,
  })
  if (error) throw error
  // a regra já está gravada: se só a geração falhar, ela roda de novo ao abrir as telas. Lançar erro aqui faria a pessoa reenviar e duplicar a regra.
  await gerarOcorrencias().catch(() => undefined)
}

/** Novo valor/descrição/categoria: vale para os planejados não pagos de hoje em diante, campo a campo, sem desfazer o que foi corrigido à mão (migration 015). */
export async function editarRecorrencia(id: string, d: { descricao: string; valor: Cents; categoriaId: string | null }): Promise<void> {
  const { error } = await cliente().rpc('recurrence_update', {
    p_id: id, p_description: d.descricao.trim(), p_amount: centsToDecimal(d.valor), p_category: d.categoriaId,
  })
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
