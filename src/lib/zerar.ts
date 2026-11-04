import { supabase } from './supabase'

/** Frase que o dono precisa escrever. O banco confere de novo (reset_household), a tela só evita o clique sem querer. */
export const FRASE_ZERAR = 'zerar tudo'

/** Quanto existe hoje, para a tela mostrar o que será apagado. São contagens, não dinheiro. */
export interface PreviaZerar {
  lancamentos: number
  contas: number
  cartoesEDividas: number
  parcelas: number
  eventos: number
  recorrencias: number
  conciliacoes: number
  orcamentos: number
  /** Agenda de parcelas do contrato de empréstimo/financiamento (migration 037). */
  agendaContrato: number
  ativosInvestimento: number
  operacoesInvestimento: number
  avaliacoesInvestimento: number
  proventos: number
  bens: number
  avaliacoesBens: number
}

function cliente() {
  if (!supabase) throw new Error('Supabase não configurado')
  return supabase
}

type Contagens = Record<string, number | string>
const n = (c: Contagens, k: string) => Number(c[k] ?? 0)
function paraPrevia(c: Contagens): PreviaZerar {
  return {
    lancamentos: n(c, 'transactions'), contas: n(c, 'accounts'), cartoesEDividas: n(c, 'debts'), parcelas: n(c, 'installments'),
    eventos: n(c, 'events'), recorrencias: n(c, 'recurrences'), conciliacoes: n(c, 'reconciliations'), orcamentos: n(c, 'budgets'),
    // chaves da migration 054; num banco sem ela chegam ausentes e contam 0
    agendaContrato: n(c, 'schedule'), ativosInvestimento: n(c, 'investment_assets'), operacoesInvestimento: n(c, 'investment_operations'),
    avaliacoesInvestimento: n(c, 'investment_valuations'), proventos: n(c, 'investment_distributions'), bens: n(c, 'family_assets'),
    avaliacoesBens: n(c, 'family_asset_valuations'),
  }
}

/** Soma de contagens de itens (não é dinheiro). Zero = não há o que zerar. */
export function totalDaPrevia(p: PreviaZerar): number {
  return p.lancamentos + p.contas + p.cartoesEDividas + p.parcelas + p.eventos + p.recorrencias + p.conciliacoes + p.orcamentos
    + p.agendaContrato + p.ativosInvestimento + p.operacoesInvestimento + p.avaliacoesInvestimento + p.proventos + p.bens + p.avaliacoesBens
}

export async function previaZerar(familiaId: string): Promise<PreviaZerar> {
  const { data, error } = await cliente().rpc('reset_preview', { p_household: familiaId })
  if (error) throw error
  return paraPrevia((data ?? {}) as Contagens)
}

/** Apaga TUDO o que é financeiro da família (irreversível). Só o dono; o banco confere a frase. Devolve o que sumiu. */
export async function zerarTudo(familiaId: string, frase: string): Promise<PreviaZerar> {
  const { data, error } = await cliente().rpc('reset_household', { p_household: familiaId, p_confirmation: frase })
  if (error) throw error
  return paraPrevia((data ?? {}) as Contagens)
}
