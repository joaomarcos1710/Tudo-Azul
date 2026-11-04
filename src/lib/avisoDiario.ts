import { centsFromDb, formatBRL, formatDate } from './format'
import type { Cents } from './format'
import { supabase } from './supabase'

/**
 * Aviso diário por e-mail (migration 047). A preferência é de cada pessoa; o resumo vem pronto do banco
 * (daily_digest, com as mesmas fontes do Início). O texto do e-mail é montado aqui e reaproveitado pela
 * Edge Function, para a prévia na tela ser exatamente o que chega.
 */
function cliente() {
  if (!supabase) throw new Error('Supabase não configurado')
  return supabase
}

export interface PreferenciaAviso {
  ligado: boolean
  hora: number
  esconderValores: boolean
}

export const PREFERENCIA_PADRAO: PreferenciaAviso = { ligado: false, hora: 7, esconderValores: true }

export async function carregarPreferenciaAviso(userId: string): Promise<PreferenciaAviso | null> {
  const { data, error } = await cliente().from('daily_digest_settings')
    .select('enabled, send_hour, hide_values').eq('user_id', userId).maybeSingle()
  if (error) throw error
  return data ? { ligado: data.enabled, hora: data.send_hour, esconderValores: data.hide_values } : null
}

export async function salvarPreferenciaAviso(userId: string, familiaId: string, p: PreferenciaAviso): Promise<void> {
  if (!Number.isInteger(p.hora) || p.hora < 5 || p.hora > 22) throw new Error('Escolha um horário entre 5h e 22h.')
  const { error } = await cliente().from('daily_digest_settings').upsert(
    { user_id: userId, household_id: familiaId, enabled: p.ligado, send_hour: p.hora, hide_values: p.esconderValores },
    { onConflict: 'user_id' },
  )
  if (error) throw error
}

export interface ResumoDoDia {
  vencidos: number
  vencidosSaida: Cents
  hoje: number
  hojeSaida: Cents
  faturas: number
  faturasValor: Cents
  proximaFatura: string | null
  fimDoMes: string
  saldoPrevisto: Cents | null
}

export async function resumoDoDia(familiaId: string, data: string): Promise<ResumoDoDia | null> {
  const { data: linhas, error } = await cliente().rpc('daily_digest', { p_household: familiaId, p_date: data })
  if (error) throw error
  const r = ((linhas ?? []) as Record<string, string | number | null>[])[0]
  if (!r) return null
  return {
    vencidos: Number(r.overdue_count), vencidosSaida: centsFromDb(r.overdue_expense ?? 0),
    hoje: Number(r.today_count), hojeSaida: centsFromDb(r.today_expense ?? 0),
    faturas: Number(r.invoices_count), faturasValor: centsFromDb(r.invoices_due ?? 0),
    proximaFatura: (r.next_invoice_date as string | null) ?? null,
    fimDoMes: r.month_end as string,
    saldoPrevisto: r.projected_balance === null ? null : centsFromDb(r.projected_balance),
  }
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`

/**
 * Linhas do aviso. Vazio = não há o que avisar (o e-mail não sai). Com `esconderValores`, nenhum R$ aparece:
 * e-mail e tela de bloqueio podem ser vistos por outras pessoas.
 */
export function linhasDoAviso(r: ResumoDoDia, esconderValores: boolean): string[] {
  const v = (c: Cents) => (esconderValores ? '' : ` (${formatBRL(c)})`)
  const linhas: string[] = []
  if (r.vencidos > 0) linhas.push(`⚠️ ${plural(r.vencidos, 'compromisso vencido', 'compromissos vencidos')}${v(r.vencidosSaida)}`)
  if (r.hoje > 0) linhas.push(`📅 ${plural(r.hoje, 'compromisso para hoje', 'compromissos para hoje')}${v(r.hojeSaida)}`)
  if (r.faturas > 0) {
    const quando = r.proximaFatura ? `, a primeira em ${formatDate(r.proximaFatura).slice(0, 5)}` : ''
    linhas.push(`💳 ${plural(r.faturas, 'fatura vence', 'faturas vencem')} nos próximos 3 dias${quando}${v(r.faturasValor)}`)
  }
  // o saldo previsto só entra se houver algo a avisar e, com valores escondidos, só como "no vermelho"
  if (linhas.length > 0 && r.saldoPrevisto !== null) {
    const fim = formatDate(r.fimDoMes).slice(0, 5)
    if (!esconderValores) linhas.push(`📉 Saldo previsto em ${fim}: ${formatBRL(r.saldoPrevisto)}`)
    else if (r.saldoPrevisto < 0) linhas.push(`📉 O saldo previsto para ${fim} está no vermelho`)
  }
  return linhas
}
