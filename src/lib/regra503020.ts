import { supabase } from './supabase'
import type { Cents } from './format'
import { centsFromDb } from './format'

/** Grupo da regra 50-30-20 de uma categoria de despesa. null = sem grupo (a pessoa ainda não escolheu). */
export type GrupoOrcamento = 'essential' | 'lifestyle' | 'investment'

export const GRUPOS: { chave: GrupoOrcamento; rotulo: string; meta: number; dica: string }[] = [
  { chave: 'essential', rotulo: 'Necessidades', meta: 50, dica: 'moradia, mercado, saúde, transporte, contas básicas' },
  { chave: 'lifestyle', rotulo: 'Desejos', meta: 30, dica: 'lazer, restaurantes, viagens, assinaturas, compras' },
  { chave: 'investment', rotulo: 'Investir e poupar', meta: 20, dica: 'reserva, investimentos, previdência' },
]

export function rotuloGrupo(g: GrupoOrcamento): string {
  return GRUPOS.find((x) => x.chave === g)?.rotulo ?? g
}

const semAcento = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

const PALAVRAS: Record<GrupoOrcamento, string[]> = {
  essential: ['moradia', 'aluguel', 'condominio', 'mercado', 'supermercado', 'alimentacao', 'saude', 'farmacia', 'plano de saude',
    'transporte', 'combustivel', 'energia', 'luz', 'agua', 'gas', 'internet', 'telefone', 'educacao', 'escola', 'seguro', 'imposto', 'financiamento'],
  lifestyle: ['lazer', 'restaurante', 'viagem', 'assinatura', 'streaming', 'compras', 'vestuario', 'roupa', 'beleza', 'presente', 'bar', 'jogos', 'hobby'],
  investment: ['investimento', 'poupanca', 'reserva', 'previdencia', 'aporte'],
}

/**
 * Sugestão pelo nome da categoria. É só uma sugestão: o app NUNCA grava o grupo sozinho — quem escolhe é a pessoa.
 * Ordem: investir primeiro (evita "reserva de viagem" cair em desejos), depois necessidades, depois desejos.
 */
export function sugerirGrupo(nome: string): GrupoOrcamento | null {
  const n = semAcento(nome)
  for (const g of ['investment', 'essential', 'lifestyle'] as GrupoOrcamento[]) {
    if (PALAVRAS[g].some((p) => new RegExp(`(^|[^a-z])${p}([^a-z]|$)`).test(n))) return g
  }
  return null
}

export interface LinhaRegra {
  grupo: GrupoOrcamento | 'none'
  valor: Cents
  /** % da despesa do período, calculado no banco (1 casa). */
  percentualDespesa: number
  /** % da renda do período, calculado no banco (1 casa). null = sem renda paga no período. */
  percentualRenda: number | null
}

/** Despesa paga do período por grupo (budget_rule_report). Todo valor e percentual vem do banco; aqui só se lê. */
export async function relatorioRegra(familiaId: string, de: string, ate: string): Promise<LinhaRegra[]> {
  if (!supabase) throw new Error('Supabase não configurado')
  const { data, error } = await supabase.rpc('budget_rule_report', { p_household: familiaId, p_from: de, p_to: ate })
  if (error) throw error
  return ((data ?? []) as Record<string, string | number | null>[]).map((r) => ({
    grupo: r.grp as LinhaRegra['grupo'],
    valor: centsFromDb(r.amount ?? 0),
    percentualDespesa: Number(r.share_expense ?? 0),
    percentualRenda: r.share_income === null || r.share_income === undefined ? null : Number(r.share_income),
  }))
}
