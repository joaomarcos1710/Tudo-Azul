import { aPartirDaqui } from './cartoes'
import { hojeSP } from './contas'
import { centsFromDb, centsToDecimal } from './format'
import type { Cents } from './format'
import { editarRecorrencia } from './recorrencias'
import type { Recorrencia } from './recorrencias'
import { supabase } from './supabase'

/**
 * Mudar o DIA de um recorrente mensal "daqui pra frente" (pedido do dono, 13/11/2026: "poder mudar a data da recorrência
 * daquele mês pra frente"). Nada novo no banco: usa o "esta e as próximas" que já existe.
 *   * conta (despesa, receita, transferência): public.recurrence_update_from (migration 074). A mesma regra é reancorada
 *     na ocorrência escolhida; as próximas planejadas que ninguém corrigiu acompanham; pagas, excluídas e corrigidas à mão ficam.
 *   * cartão: public.card_scheduled_from_here (migration 20261110050000). A regra antiga termina na véspera e uma nova começa
 *     na data escolhida, porque parcela é imutável. O que já virou compra na fatura fica como está.
 * Só entram na lista as ocorrências que ainda seguem a regra (valor, descrição e categoria iguais): uma que a pessoa corrigiu à
 * mão não é sobrescrita em silêncio. Atalho: o dia novo só vale até o último dia do mês da ocorrência escolhida (o banco
 * guarda o dia da data nova; dia 31 em fevereiro viraria dia 28 para sempre). Melhorar se o dono pedir dia 29–31 em mês curto.
 */
export interface OcorrenciaMovivel {
  /** id da ocorrência: lançamento planejado (conta) ou item agendado (cartão). */
  id: string
  /** Data em que ela cai hoje (AAAA-MM-DD). */
  data: string
  /** Só conta: o que a edição do banco regrava junto, igual ao que a ocorrência já tem. */
  restante?: { status: string; notes: string | null; accountId: string | null; destinationId: string | null }
}

function cliente() {
  if (!supabase) throw new Error('Supabase não configurado')
  return supabase
}

/** Só mensal tem "dia do mês" para mudar; semanal e a cada N dias seguem a data da primeira vez. */
export function podeMudarODia(r: Pick<Recorrencia, 'unidade' | 'ativa'>): boolean {
  return r.ativa && r.unidade === 'month'
}

/** Data com o dia novo no mês da data dada. O chamador garante dia ≤ último dia do mês (ver `diasDoMes`). */
export function dataComODia(data: string, dia: number): string {
  return `${data.slice(0, 8)}${String(dia).padStart(2, '0')}`
}

/** Dias que o mês da data tem (1..último), para o seletor de "novo dia". */
export function diasDoMes(data: string): number[] {
  const [a, m] = data.split('-').map(Number)
  return Array.from({ length: new Date(Date.UTC(a, m, 0)).getUTCDate() }, (_, i) => i + 1)
}

/**
 * As próximas ocorrências que ainda dá para mover, da mais próxima para a mais distante (até 24). Conta: planejados fora da
 * lixeira do mês atual em diante. Cartão: itens agendados ainda não editados à mão.
 */
export async function listarOcorrenciasMoviveis(r: Recorrencia): Promise<OcorrenciaMovivel[]> {
  const db = cliente()
  if (r.tipo === 'card') {
    const { data, error } = await db.from('card_scheduled_items')
      .select('id, charge_date, amount, description, category_id, edited')
      .eq('recurrence_id', r.id).eq('status', 'scheduled').eq('edited', false)
      .order('occurrence_date').limit(24)
    if (error) throw error
    return ((data ?? []) as { id: string; charge_date: string; amount: number | string; description: string; category_id: string }[])
      .filter((i) => igualARegra(r, i.amount, i.description, i.category_id))
      .map((i) => ({ id: i.id, data: i.charge_date }))
  }
  const { data, error } = await db.from('transactions')
    .select('id, date, amount, description, category_id, status, notes, account_id, destination_account_id')
    .eq('recurrence_id', r.id).eq('status', 'planned').is('deleted_at', null)
    .gte('date', `${hojeSP().slice(0, 8)}01`)
    .order('date').limit(24)
  if (error) throw error
  return ((data ?? []) as {
    id: string; date: string; amount: number | string; description: string; category_id: string | null; status: string
    notes: string | null; account_id: string | null; destination_account_id: string | null
  }[])
    .filter((t) => igualARegra(r, t.amount, t.description, t.category_id))
    .map((t) => ({
      id: t.id, data: t.date,
      restante: { status: t.status, notes: t.notes, accountId: t.account_id, destinationId: t.destination_account_id },
    }))
}

function igualARegra(r: Recorrencia, valor: number | string, descricao: string, categoriaId: string | null): boolean {
  const cents: Cents = centsFromDb(valor)
  return cents === r.valor && descricao.trim() === r.descricao.trim() && (categoriaId ?? null) === (r.categoriaId ?? null)
}

/**
 * Muda o dia desta ocorrência em diante. Devolve `naturezaPerdida: true` quando a assinatura de cartão tinha natureza e o
 * banco não conseguiu devolvê-la à regra nova (a divisão da regra cria uma regra sem natureza). Atalho: restaurada aqui no
 * app, não no banco; melhorar levando a natureza para card_scheduled_from_here (anotado em docs/projeto/40).
 */
export async function mudarODiaDaquiPraFrente(r: Recorrencia, o: OcorrenciaMovivel, dia: number): Promise<{ naturezaPerdida: boolean }> {
  const nova = dataComODia(o.data, dia)
  if (r.tipo !== 'card') {
    if (!o.restante) throw new Error('ocorrência sem os dados da conta')
    const { error } = await cliente().rpc('recurrence_update_from', {
      p_transaction: o.id, p_date: nova, p_description: r.descricao.trim(), p_amount: centsToDecimal(r.valor),
      p_category: r.categoriaId, p_status: o.restante.status, p_notes: o.restante.notes,
      p_account: o.restante.accountId, p_destination: o.restante.destinationId,
    })
    if (error) throw error
    return { naturezaPerdida: false }
  }
  if (!r.categoriaId) throw new Error('assinatura de cartão sem categoria')
  await aPartirDaqui(o.id, 'update', { data: nova, valor: r.valor, descricao: r.descricao, categoriaId: r.categoriaId })
  if (!r.nature) return { naturezaPerdida: false }
  try {
    const { data, error } = await cliente().from('recurrences').select('id')
      .eq('debt_id', r.cartaoId ?? '').eq('start_date', nova).eq('description', r.descricao.trim()).is('nature', null).limit(1)
    if (error) throw error
    const criada = (data ?? [])[0] as { id: string } | undefined
    if (!criada) return { naturezaPerdida: true }
    await editarRecorrencia(criada.id, {
      descricao: r.descricao, valor: r.valor, categoriaId: r.categoriaId,
      personId: r.personId ?? null, isSharedExpense: r.isSharedExpense ?? false, nature: r.nature,
    })
    return { naturezaPerdida: false }
  } catch {
    return { naturezaPerdida: true }
  }
}
