import { centsFromDb, formatBRL, formatDate } from './format'
import type { Cents } from './format'
import { supabase } from './supabase'

/** Tipos de aviso do topo do Início (migration 057, public.home_alerts). */
export type TipoAviso = 'overdue_payable' | 'overdue_receivable' | 'invoice' | 'payable' | 'receivable'

/** Uma linha de public.home_alerts: contagem, total e datas vêm do banco (a tela não soma). */
export interface AvisoInicio {
  tipo: TipoAviso
  quantidade: number
  total: Cents
  /** AAAA-MM-DD: o mais antigo (vencidos) ou o mais próximo (a pagar/receber); na fatura, o vencimento. */
  data: string
  /** Só na fatura: o cartão. */
  cartaoId: string | null
  cartaoNome: string | null
}

const TIPOS: TipoAviso[] = ['overdue_payable', 'overdue_receivable', 'invoice', 'payable', 'receivable']

export async function avisosDoInicio(familiaId: string, hoje: string): Promise<AvisoInicio[]> {
  if (!supabase) throw new Error('Supabase não configurado')
  const { data, error } = await supabase.rpc('home_alerts', { p_household: familiaId, p_today: hoje })
  if (error) throw error
  return ((data ?? []) as { kind: string; item_count: number; total: number | string; first_date: string; target_id: string | null; target_name: string | null }[])
    // tipo que esta versão do app não conhece (banco mais novo) é ignorado em vez de virar um cartão sem texto
    .filter((r) => (TIPOS as string[]).includes(r.kind))
    .map((r) => ({
      tipo: r.kind as TipoAviso, quantidade: r.item_count, total: centsFromDb(r.total), data: r.first_date,
      cartaoId: r.target_id ?? null, cartaoNome: r.target_name ?? null,
    }))
}

export interface TextoAviso {
  titulo: string
  texto: string
  /** Para onde o cartão leva: rota do app ou âncora na própria tela (#vencidos). */
  destino: string
}

const contas = (n: number, adjetivo: string) => `${n} ${n === 1 ? 'conta' : 'contas'} ${adjetivo}`

/** Dias corridos entre duas datas AAAA-MM-DD (contagem de dias, não dinheiro). */
function dias(de: string, ate: string): number {
  const t = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)))
  return Math.round((t(ate) - t(de)) / 86_400_000)
}

/**
 * Texto e destino de cada aviso. O valor passa pelo formatBRL, então "ocultar valores" mascara também o texto lido
 * pelo leitor de tela (aria-label).
 */
export function textoDoAviso(a: AvisoInicio, hoje: string): TextoAviso {
  const valor = formatBRL(a.total)
  const mes = a.data.slice(0, 7)
  switch (a.tipo) {
    case 'receivable':
      return { titulo: 'Contas a receber', texto: `Você tem ${contas(a.quantidade, 'a receber')} no total de ${valor} nos próximos 7 dias.`,
        destino: `/lancamentos?mes=${mes}&tipo=receita` }
    case 'payable':
      return { titulo: 'Contas a pagar', texto: `Você tem ${contas(a.quantidade, 'a pagar')} no total de ${valor} nos próximos 7 dias.`,
        destino: `/lancamentos?mes=${mes}&tipo=despesa` }
    case 'overdue_payable':
      return { titulo: 'Contas vencidas', texto: `Você tem ${contas(a.quantidade, 'a pagar')} já ${a.quantidade === 1 ? 'vencida' : 'vencidas'} no total de ${valor}.`,
        destino: '#vencidos' }
    case 'overdue_receivable':
      return { titulo: 'Recebimentos atrasados', texto: `Você tem ${contas(a.quantidade, 'a receber')} com a data já passada no total de ${valor}.`,
        destino: '#vencidos' }
    case 'invoice': {
      const d = dias(hoje, a.data)
      const quando = d <= 0 ? 'vence hoje' : d === 1 ? 'vence amanhã' : `vence em ${formatDate(a.data).slice(0, 5)}`
      return { titulo: 'Fatura do cartão', texto: `A fatura do ${a.cartaoNome ?? 'cartão'} de ${valor} ${quando}.`,
        destino: a.cartaoId ? `/cartoes?cartao=${a.cartaoId}` : '/cartoes' }
    }
  }
}
