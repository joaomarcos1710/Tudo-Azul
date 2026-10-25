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
  }
}

/** Soma de contagens de itens (não é dinheiro). Zero = não há o que zerar. */
export function totalDaPrevia(p: PreviaZerar): number {
  return p.lancamentos + p.contas + p.cartoesEDividas + p.parcelas + p.eventos + p.recorrencias + p.conciliacoes + p.orcamentos
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
