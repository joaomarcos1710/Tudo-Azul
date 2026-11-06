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
  /** AAAA-MM-DD: o mês corrente (resultado do mês, até hoje) */
  inicioMes: string
  fimMes: string
  /** AAAA-MM-DD: o último mês fechado (taxa de poupança e comprometimento) */
  inicioMesFechado: string
  fimMesFechado: string
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
  /** Último mês fechado, sem as categorias "não conta como consumo". */
  receitasPoupanca: Cents
  despesasPoupanca: Cents
  resultadoPoupanca: Cents
  /** % com 1 casa; null = sem receita no mês fechado */
  taxaPoupanca: number | null
  faixaPoupanca: Faixa | null
  reserva: Cents
  mesesFechados: number
  /** Mediana da despesa mensal dos meses fechados (sem o que não é consumo); null = nenhum mês fechado */
  despesaTipica: Cents | null
  /** meses com 1 casa; null = sem despesa típica */
  coberturaReserva: number | null
  faixaReserva: Faixa | null
  parcelasDividas: Cents
  rendaEsperada: Cents
  rendaRecebida: Cents
  /** A maior entre a esperada (recorrentes) e a recebida no mês fechado */
  rendaRegular: Cents
  fonteRenda: 'recorrente' | 'recebida'
  /** % com 1 casa; null = sem renda regular no mês fechado */
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
    inicioMesFechado: String(r.closed_month_start), fimMesFechado: String(r.closed_month_end),
    contasAtivas: c('accounts_active'), faturasFechadas: c('card_bills_closed'), disponivel: c('available'),
    contasTodas: c('accounts_total'), creditoAReceber: c('credit_receivable'), bens: c('family_assets'),
    investimentos: c('investments'), dividas: c('debt_total'), compromissos: c('planned_commitments'), patrimonio: c('net_worth'),
    receitas: c('income'), despesas: c('expense'), resultado: c('result'),
    receitasPoupanca: c('savings_income'), despesasPoupanca: c('savings_expense'), resultadoPoupanca: c('savings_result'),
    taxaPoupanca: numero(r.savings_rate), faixaPoupanca: faixa(r.savings_band),
    reserva: c('reserve'), mesesFechados: Number(r.closed_months ?? 0),
    despesaTipica: r.typical_expense === null || r.typical_expense === undefined ? null : c('typical_expense'),
    coberturaReserva: numero(r.reserve_months), faixaReserva: faixa(r.reserve_band),
    parcelasDividas: c('debt_installments'), rendaEsperada: c('regular_income_expected'), rendaRecebida: c('regular_income_received'),
    rendaRegular: c('regular_income'), fonteRenda: r.regular_income_source === 'recurring' ? 'recorrente' : 'recebida',
    comprometimento: numero(r.commitment_pct), faixaComprometimento: faixa(r.commitment_band),
  }
}
