import { centsFromDb } from './format'
import type { Cents } from './format'
import { supabase } from './supabase'

export type TipoLinhaCompromisso = 'item' | 'total'

export interface LinhaProjecaoCompromisso {
  id: string | null
  descricao: string
  origem: string | null
  tipoOrigem: string
  mes: string
  moeda: string
  valor: Cents
  tipoLinha: TipoLinhaCompromisso
}

/**
 * Matriz dos compromissos de despesas dos próximos meses.
 * O PostgreSQL é responsável pela consolidação, pela eliminação de duplicidades e pelos totais mensais.
 * Moedas diferentes retornam em linhas de total separadas, sem conversão implícita.
 */
export async function carregarProjecaoCompromissos(
  familiaId: string,
  dataReferencia: string,
  meses: 3 | 6 = 6,
): Promise<LinhaProjecaoCompromisso[]> {
  if (!supabase) throw new Error('Supabase não configurado')

  const { data, error } = await supabase.rpc('dashboard_commitment_matrix', {
    p_household: familiaId,
    p_from: dataReferencia,
    p_months: meses,
  })
  if (error) throw error

  return ((data ?? []) as {
    commitment_id: string | null
    description: string
    source_name: string | null
    source_type: string
    period_month: string
    currency_code: string
    amount: string | number
    row_type: TipoLinhaCompromisso
  }[]).map((row) => ({
    id: row.commitment_id,
    descricao: row.description,
    origem: row.source_name,
    tipoOrigem: row.source_type,
    mes: row.period_month.slice(0, 7),
    moeda: row.currency_code,
    valor: centsFromDb(row.amount),
    tipoLinha: row.row_type,
  }))
}
