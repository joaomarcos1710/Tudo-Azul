import { centsFromDb, centsToDecimal } from './format'
import type { Cents } from './format'
import { supabase } from './supabase'

export type TipoDivida = 'loan' | 'financing'

export interface Divida {
  id: string
  nome: string
  tipo: TipoDivida
  saldo: Cents
  compromissos: Cents
  ativa: boolean
  taxaMensalBps: number
  pagamentoMinimo: Cents
}

export interface DadosDivida {
  nome: string
  tipo: TipoDivida
  dataReferencia: string
  saldoReferencia: Cents
}

function cliente() {
  if (!supabase) throw new Error('Supabase não configurado')
  return supabase
}

/** Dívidas e financiamentos usam o motor debts/debt_events já existente. Cartões continuam na tela Cartões. */
export async function listarDividas(familiaId: string, dataRef: string): Promise<Divida[]> {
  const db = cliente()
  const [cadastros, saldos] = await Promise.all([
    db.from('debts')
      .select('id, name, kind, active, monthly_rate_bps, minimum_payment')
      .eq('household_id', familiaId)
      .eq('active', true)
      .in('kind', ['loan', 'financing'])
      .order('name'),
    db.rpc('debt_balances', { p_household: familiaId, p_as_of: dataRef }),
  ])
  if (cadastros.error) throw cadastros.error
  if (saldos.error) throw saldos.error
  const porId = new Map(((saldos.data ?? []) as Record<string, unknown>[]).map((r) => [r.debt_id as string, r]))
  return ((cadastros.data ?? []) as Record<string, unknown>[])
    .flatMap((d) => {
      const s = porId.get(d.id as string)
      if (!s) return []
      return [{
        id: d.id as string,
        nome: d.name as string,
        tipo: d.kind as TipoDivida,
        saldo: centsFromDb((s.debt ?? 0) as string | number),
        compromissos: centsFromDb((s.planned_remaining ?? 0) as string | number),
        ativa: d.active as boolean,
        taxaMensalBps: Number(d.monthly_rate_bps ?? 0),
        pagamentoMinimo: centsFromDb((d.minimum_payment ?? 0) as string | number),
      }]
    })
}

export async function criarDivida(d: DadosDivida): Promise<string> {
  const { data, error } = await cliente().rpc('create_debt', {
    p_name: d.nome.trim(),
    p_kind: d.tipo,
    p_reference_date: d.dataReferencia,
    p_reference_balance: centsToDecimal(d.saldoReferencia),
  })
  if (error) throw error
  return data as string
}

export async function definirTermosDivida(id: string, taxaMensalBps: number, pagamentoMinimo: Cents): Promise<void> {
  const { error } = await cliente().rpc('debt_set_terms', {
    p_debt: id,
    p_monthly_rate_bps: taxaMensalBps,
    p_minimum_payment: centsToDecimal(pagamentoMinimo),
  })
  if (error) throw error
}

export async function registrarPagamentoDivida(d: {
  dividaId: string
  data: string
  contaId: string
  principal: Cents
  juros: Cents
  tarifa: Cents
  categoriaId: string | null
  extra: boolean
}): Promise<void> {
  const { error } = await cliente().rpc('debt_record_payment', {
    p_debt: d.dividaId,
    p_date: d.data,
    p_account: d.contaId,
    p_principal: centsToDecimal(d.principal),
    p_interest: centsToDecimal(d.juros),
    p_fee: centsToDecimal(d.tarifa),
    p_category: d.categoriaId,
    p_extra: d.extra,
  })
  if (error) throw error
}

/** Corrige o nome de um empréstimo ou financiamento (debt_rename, a mesma função dos cartões). O banco aceita de 1 a 60 caracteres. */
export async function renomearDivida(dividaId: string, nome: string): Promise<void> {
  const { error } = await cliente().rpc('debt_rename', { p_id: dividaId, p_name: nome.trim() })
  if (error) throw error
}
