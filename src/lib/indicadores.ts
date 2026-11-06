import { centsFromDb } from './format'
import type { Cents } from './format'
import { supabase } from './supabase'

/**
 * Faixa de um indicador, calculada no banco (migration 071) sobre o valor já arredondado:
 * saudavel = azul, atencao = âmbar, critico = vermelho; null = sem dado ("—").
 */
export type Faixa = 'saudavel' | 'atencao' | 'critico'

/**
 * Os 7 indicadores do topo do Início e as parcelas que o (i) mostra (public.home_indicators, migration 071).
 * Todo valor em reais e toda razão vêm do banco: a tela não soma nem divide dinheiro.
 */
export interface Indicadores {
  /** AAAA-MM-DD */
  inicioMes: string
  fimMes: string
  contasAtivas: Cents
  faturasFechadas: Cents
  disponivel: Cents
  contasTodas: Cents
  creditoAReceber: Cents
  bens: Cents
  investimentos: Cents
  dividas: Cents
  compromissos: Cents
  patrimonio: Cents
  receitas: Cents
  despesas: Cents
  resultado: Cents
  /** % com 1 casa; null = sem receita no mês */
  taxaPoupanca: number | null
  faixaPoupanca: Faixa | null
  reserva: Cents
  despesaMesesFechados: Cents
  mesesFechados: number
  despesaMedia: Cents | null
  /** meses com 1 casa; null = sem despesa nos meses fechados */
  coberturaReserva: number | null
  faixaReserva: Faixa | null
  parcelasDividas: Cents
  rendaRegular: Cents
  /** % com 1 casa; null = sem renda regular no mês */
  comprometimento: number | null
  faixaComprometimento: Faixa | null
}

const FAIXAS: Faixa[] = ['saudavel', 'atencao', 'critico']
const faixa = (v: unknown): Faixa | null => ((FAIXAS as unknown[]).includes(v) ? (v as Faixa) : null)
const numero = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))

type Linha = Record<string, number | string | null>

export async function carregarIndicadores(familiaId: string, hoje: string): Promise<Indicadores> {
  if (!supabase) throw new Error('Supabase não configurado')
  const { data, error } = await supabase.rpc('home_indicators', { p_household: familiaId, p_as_of: hoje })
  if (error) throw error
  const r = ((data ?? []) as Linha[])[0]
  if (!r) throw new Error('indicadores indisponíveis')
  const c = (k: string) => centsFromDb((r[k] ?? 0) as number | string)
  return {
    inicioMes: String(r.month_start), fimMes: String(r.month_end),
    contasAtivas: c('accounts_active'), faturasFechadas: c('card_bills_closed'), disponivel: c('available'),
    contasTodas: c('accounts_total'), creditoAReceber: c('credit_receivable'), bens: c('family_assets'),
    investimentos: c('investments'), dividas: c('debt_total'), compromissos: c('planned_commitments'), patrimonio: c('net_worth'),
    receitas: c('income'), despesas: c('expense'), resultado: c('result'),
    taxaPoupanca: numero(r.savings_rate), faixaPoupanca: faixa(r.savings_band),
    reserva: c('reserve'), despesaMesesFechados: c('expense_closed_months'), mesesFechados: Number(r.closed_months ?? 0),
    despesaMedia: r.average_expense === null || r.average_expense === undefined ? null : c('average_expense'),
    coberturaReserva: numero(r.reserve_months), faixaReserva: faixa(r.reserve_band),
    parcelasDividas: c('debt_installments'), rendaRegular: c('regular_income'),
    comprometimento: numero(r.commitment_pct), faixaComprometimento: faixa(r.commitment_band),
  }
}
