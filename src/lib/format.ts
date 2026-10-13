/** Formatadores pt-BR. Valores monetários em BRL, datas em DD/MM/AAAA. */

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

/** 1250.5 -> "R$ 1.250,50" (espaço comum, não-quebrável normalizado). */
export function formatBRL(value: number): string {
  return brl.format(value).replace(/ /g, ' ')
}

/**
 * Converte texto digitado em número. Aceita "1.250,50", "1250,50" e "1250.50".
 * Retorna null se o texto não for um número válido.
 */
export function parseBRL(input: string): number | null {
  const limpo = input.replace(/[R$\s]/g, '')
  if (limpo === '') return null
  let normalizado: string
  if (limpo.includes(',')) {
    normalizado = limpo.replace(/\./g, '').replace(',', '.')
  } else if ((limpo.match(/\./g) ?? []).length > 1) {
    normalizado = limpo.replace(/\./g, '')
  } else {
    normalizado = limpo
  }
  if (!/^-?\d+(\.\d+)?$/.test(normalizado)) return null
  const n = Number(normalizado)
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null
}

/** "2026-10-13" -> "13/10/2026" (sem passar por Date, evita deslocamento de fuso). */
export function formatDate(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${a}`
}

/** "2026-10" -> "outubro de 2026" */
export function formatMonth(ym: string): string {
  const [a, m] = ym.split('-').map(Number)
  const nome = new Date(a, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long' })
  return `${nome} de ${a}`
}

/** Mês atual (YYYY-MM) no fuso de São Paulo. */
export function currentMonth(now: Date = new Date()): string {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit',
  }).format(now)
  return partes.slice(0, 7)
}
