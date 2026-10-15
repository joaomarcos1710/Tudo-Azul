/** Formatadores pt-BR. Valores monetários em BRL, datas em DD/MM/AAAA. */

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

/** 1250.5 -> "R$ 1.250,50" (espaço comum, não-quebrável normalizado). */
export function formatBRL(value: number): string {
  const arredondado = Math.round(value * 100) / 100
  // Evita "-R$ 0,00" (zero negativo ou valores que arredondam para zero).
  return brl.format(arredondado === 0 ? 0 : arredondado).replace(/\u00a0/g, ' ')
}

/**
 * Converte texto digitado em número, de forma ESTRITA: formato inválido retorna null,
 * nunca um valor adivinhado. Aceita (com "R$" e sinal "-" opcionais):
 *   "1.250,50"  milhar com ponto + vírgula decimal (1 ou 2 casas)
 *   "1250,5"    vírgula decimal
 *   "1.250"     ponto + exatamente 3 dígitos = milhar (pt-BR) -> 1250
 *   "1.250.000" milhares agrupados de 3 em 3
 *   "1250.50"   ponto decimal com 1 ou 2 casas
 *   "1250"      inteiro
 * Recusa: "1.2.3", "1,2,3", "1,234" (3 casas decimais), "12..5", texto.
 */
export function parseBRL(input: string): number | null {
  const bruto = input.trim()
  const t = bruto.startsWith('R$') ? bruto.slice(2).trim() : bruto
  const inteiroMilhar = '\\d{1,3}(?:\\.\\d{3})+'
  const comVirgula = new RegExp(`^-?(?:${inteiroMilhar}|\\d+),\\d{1,2}$`)
  const semVirgulaMilhar = new RegExp(`^-?(?:${inteiroMilhar})$`)
  const pontoDecimal = /^-?\d+\.\d{1,2}$/
  const inteiro = /^-?\d+$/

  let normalizado: string
  if (comVirgula.test(t)) normalizado = t.replace(/\./g, '').replace(',', '.')
  else if (semVirgulaMilhar.test(t)) normalizado = t.replace(/\./g, '')
  else if (pontoDecimal.test(t) || inteiro.test(t)) normalizado = t
  else return null

  const n = Number(normalizado)
  return Number.isFinite(n) ? n : null
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
