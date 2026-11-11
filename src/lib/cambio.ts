import { supabase } from './supabase'
import { centsFromDb, centsToDecimal, formatDate } from './format'
import type { Cents } from './format'

function db() {
  if (!supabase) throw new Error('Supabase não configurado')
  return supabase
}

/**
 * Um valor em moeda estrangeira convertido para reais pela PTAX de compra (migration 108, decisão do dono de 04/11/2026).
 * A conta é do banco (public.fx_to_brl): o front só pede e mostra. `reais` nulo = sem cotação nos últimos 7 dias, e a
 * tela não mostra o "≈ R$" (não inventa número).
 */
export interface EmReais {
  moeda: string
  valor: Cents
  reais: Cents | null
  /** reais por 1 unidade da moeda, como o banco guardou (texto, para não perder casas) */
  taxa: string | null
  /** dia da cotação (AAAA-MM-DD) */
  dataTaxa: string | null
}

/** Converte a lista para reais na data, na mesma ordem. Item em reais volta igual (taxa 1). */
export async function converterParaReais(itens: { moeda: string; valor: Cents }[], data: string): Promise<EmReais[]> {
  if (itens.length === 0) return []
  const { data: linhas, error } = await db().rpc('fx_to_brl', {
    p_currencies: itens.map((i) => i.moeda),
    p_amounts: itens.map((i) => centsToDecimal(i.valor)),
    p_date: data,
  })
  if (error) throw error
  const porOrdem = new Map(((linhas ?? []) as Record<string, unknown>[]).map((l) => [Number(l.ord), l]))
  return itens.map((item, i) => {
    const l = porOrdem.get(i + 1)
    const reais = l?.amount_brl
    return {
      moeda: item.moeda,
      valor: item.valor,
      reais: reais === null || reais === undefined ? null : centsFromDb(reais as string | number),
      taxa: l?.rate === null || l?.rate === undefined ? null : String(l.rate),
      dataTaxa: (l?.rate_date as string | null | undefined) ?? null,
    }
  })
}

/** "PTAX de 10/11/2026: € 1 = R$ 6,2305" — a fonte e a data sempre ao lado do valor convertido. */
export function textoCotacao(c: EmReais, simbolo: string): string {
  if (!c.taxa || !c.dataTaxa) return ''
  const taxa = Number(c.taxa).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
  return `PTAX de ${formatDate(c.dataTaxa)}: ${simbolo} 1 = R$ ${taxa}`
}
