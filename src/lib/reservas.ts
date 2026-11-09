import { centsFromDb, centsToDecimal } from './format'
import type { Cents } from './format'
import { supabase } from './supabase'

export type StatusReserva = 'active' | 'completed' | 'archived'

export interface MovimentoReserva {
  id: string
  valor: Cents
  data: string
  descricao: string | null
  criadoEm: string
}

export interface Reserva {
  id: string
  nome: string
  moeda: string
  meta: Cents | null
  dataMeta: string | null
  icone: string | null
  cor: string | null
  status: StatusReserva
  saldo: Cents
  movimentos: MovimentoReserva[]
}

type LinhaReserva = {
  reserve_id: string
  name: string
  currency_code: string
  target_amount: number | string | null
  target_date: string | null
  icon: string | null
  color: string | null
  status: StatusReserva
  balance: number | string
  allocation_id: string | null
  allocation_amount: number | string | null
  allocation_date: string | null
  allocation_description: string | null
  allocation_created_at: string | null
}

function cliente() {
  if (!supabase) throw new Error('Supabase não configurado')
  return supabase
}

/** Saldo integral do ledger e até 20 movimentos recentes vêm agregados do PostgreSQL. */
export async function listarReservas(familiaId: string): Promise<Reserva[]> {
  const { data, error } = await cliente().rpc('reserve_overview', { p_household: familiaId })
  if (error) throw error
  const linhas = (data ?? []) as LinhaReserva[]
  const porId = new Map<string, Reserva>()

  for (const l of linhas) {
    let reserva = porId.get(l.reserve_id)
    if (!reserva) {
      reserva = {
        id: l.reserve_id,
        nome: l.name,
        moeda: l.currency_code,
        meta: l.target_amount === null ? null : centsFromDb(l.target_amount),
        dataMeta: l.target_date,
        icone: l.icon,
        cor: l.color,
        status: l.status,
        saldo: centsFromDb(l.balance),
        movimentos: [],
      }
      porId.set(l.reserve_id, reserva)
    }
    if (l.allocation_id && l.allocation_amount !== null && l.allocation_date && l.allocation_created_at) {
      reserva.movimentos.push({
        id: l.allocation_id,
        valor: centsFromDb(l.allocation_amount),
        data: l.allocation_date,
        descricao: l.allocation_description,
        criadoEm: l.allocation_created_at,
      })
    }
  }
  return [...porId.values()]
}

export async function criarReserva(
  familiaId: string,
  nome: string,
  moeda: string,
  meta: Cents | null,
  dataMeta: string | null,
): Promise<void> {
  const { error } = await cliente().from('reserves').insert({
    household_id: familiaId,
    name: nome.trim(),
    currency_code: moeda,
    target_amount: meta === null ? null : centsToDecimal(meta),
    target_date: dataMeta,
  })
  if (error) throw error
}

export async function registrarAlocacaoReserva(
  reservaId: string,
  valor: Cents,
  data: string,
  descricao: string,
  chaveIdempotencia: string,
): Promise<string> {
  const { data: id, error } = await cliente().rpc('record_reserve_allocation', {
    p_reserve_id: reservaId,
    p_amount: centsToDecimal(valor),
    p_date: data,
    p_description: descricao.trim() || null,
    p_idempotency_key: chaveIdempotencia,
  })
  if (error) throw error
  if (typeof id !== 'string' || !id) throw new Error('O banco não retornou o identificador da alocação.')
  return id
}
