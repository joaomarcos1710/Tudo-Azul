/** Formatadores pt-BR. Valores monetários em BRL, datas em DD/MM/AAAA. */
import { MASCARA, valoresOcultos } from './privacidade'

/**
 * Dinheiro no front é sempre `Cents`: centavos inteiros (decisão 11, MODELO-DE-DADOS.md §5).
 * Nenhuma função daqui faz conta com reais em ponto flutuante: texto -> centavos e
 * centavos -> texto são feitos com manipulação de dígitos.
 */
export type Cents = number & { readonly __brand: 'Cents' }

/** Limite de `numeric(14,2)` no banco: 999.999.999.999,99. */
export const MAX_CENTS = 99_999_999_999_999 as Cents

const milhar = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 })

/** Valida um inteiro de centavos (seguro e dentro do limite do banco). */
export function asCents(n: number): Cents | null {
  return Number.isSafeInteger(n) && Math.abs(n) <= MAX_CENTS ? (n as Cents) : null
}

function brlReal(cents: Cents): string {
  const abs = Math.abs(cents)
  const reais = milhar.format(Math.floor(abs / 100))
  const centavos = String(abs % 100).padStart(2, '0')
  return `${cents < 0 ? '-' : ''}R$ ${reais},${centavos}`
}

/**
 * 125050 -> "R$ 1.250,50"; -3000 -> "-R$ 30,00". Só formata, sem aritmética em reais.
 * Para MOSTRAR na tela: com "ocultar valores" ligado devolve a máscara. Nunca use para preencher campo de
 * edição ou qualquer coisa que depois seja lida de volta: para isso existe `formatBRLCampo`.
 */
export function formatBRL(cents: Cents): string {
  return valoresOcultos() ? MASCARA : brlReal(cents)
}

/**
 * Como `formatBRL`, mas o negativo sai com o sinal tipográfico de menos ("−R$ 200,00", U+2212), que não se separa
 * do número nem parece hífen. Para tabelas de relatório. Com "ocultar valores", só a máscara (sem revelar o sinal).
 */
export function formatBRLSinal(cents: Cents): string {
  if (valoresOcultos()) return MASCARA
  return cents < 0 ? `−${brlReal(Math.abs(cents) as Cents)}` : brlReal(cents)
}

/** Valor em centavos numa moeda (BRL, USD, EUR...), respeitando "ocultar valores" como o formatBRL. */
export function formatMoeda(cents: Cents, moeda: string): string {
  if (moeda === 'BRL') return formatBRL(cents)
  if (valoresOcultos()) return MASCARA
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: moeda }).format(cents / 100)
}

/** Símbolo da moeda para rótulo de campo: BRL → "R$", USD → "US$", EUR → "€"; outra → o próprio código. */
export function simboloMoeda(moeda: string): string {
  return ({ BRL: 'R$', USD: 'US$', EUR: '€' } as Record<string, string>)[moeda] ?? moeda
}

/** "1.250,50" / "-30,00": o valor de verdade (sem "R$ "), para preencher campos de edição; nunca é mascarado. */
export function formatBRLCampo(cents: Cents): string {
  return brlReal(cents).replace('R$ ', '')
}

/**
 * Converte texto digitado em centavos, de forma ESTRITA: formato inválido ou fora do limite
 * do banco retorna null, nunca um valor adivinhado. Aceita (com "R$" e sinal "-" opcionais):
 *   "1.250,50"  milhar com ponto + vírgula decimal (1 ou 2 casas)
 *   "1250,5"    vírgula decimal
 *   "1.250"     ponto + exatamente 3 dígitos = milhar (pt-BR) -> 125000
 *   "1.250.000" milhares agrupados de 3 em 3
 *   "1250.50"   ponto decimal com 1 ou 2 casas
 *   "1250"      inteiro
 * Recusa: "1.2.3", "1,2,3", "1,234" (3 casas decimais), "12..5", texto.
 */
export function parseBRL(input: string): Cents | null {
  // trim também tira o NBSP de valores colados; aceita "R$"/"r$" e o sinal antes dele ("-R$ 30,00"). Espaço no MEIO do número
  // continua recusado ("1 2" é ambíguo)
  const bruto = input.trim()
  const t = bruto.replace(/^(-?)\s*r\$\s*/i, '$1')
  const inteiroMilhar = '\\d{1,3}(?:\\.\\d{3})+'
  const comVirgula = new RegExp(`^(-?)(${inteiroMilhar}|\\d+),(\\d{1,2})$`)
  const semVirgulaMilhar = new RegExp(`^(-?)(${inteiroMilhar})()$`)
  const pontoDecimal = /^(-?)(\d+)\.(\d{1,2})$/
  const inteiro = /^(-?)(\d+)()$/

  const m = comVirgula.exec(t) ?? semVirgulaMilhar.exec(t) ?? pontoDecimal.exec(t) ?? inteiro.exec(t)
  if (!m) return null
  const [, sinal, parteInteira, decimais] = m
  const digitos = parteInteira.replace(/\./g, '').replace(/^0+(?=\d)/, '')
  if (digitos.length > 12) return null // além de numeric(14,2)
  const cents = Number(digitos) * 100 + Number(decimais.padEnd(2, '0'))
  return asCents(sinal === '-' && cents !== 0 ? -cents : cents)
}

/** Centavos -> string decimal para enviar ao banco: 125050 -> "1250.50" (nunca cents / 100). */
export function centsToDecimal(cents: Cents): string {
  const abs = Math.abs(cents)
  return `${cents < 0 ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

/**
 * Valor `numeric(14,2)` lido do banco (o PostgREST pode devolver número ou string) -> centavos.
 * Lê os dígitos do texto em vez de multiplicar por 100. Valor fora do formato é erro de
 * contrato com o banco, não entrada do usuário: lança exceção.
 */
export function centsFromDb(value: number | string): Cents {
  const texto = typeof value === 'number' ? String(value) : value.trim()
  const m = /^(-?)(\d+)(?:\.(\d{1,2})0*)?$/.exec(texto)
  const cents = m ? Number(m[2]) * 100 + Number((m[3] ?? '').padEnd(2, '0')) : NaN
  const resultado = m ? asCents(m[1] === '-' && cents !== 0 ? -cents : cents) : null
  if (resultado === null) throw new Error(`valor monetário inválido vindo do banco: ${texto}`)
  return resultado
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

/** Maiúscula só na primeira letra ("outubro de 2026" → "Outubro de 2026"). Não use a classe CSS capitalize: ela faz "Outubro De 2026". */
export function primeiraMaiuscula(texto: string): string {
  return texto.charAt(0).toLocaleUpperCase('pt-BR') + texto.slice(1)
}

/** Mês atual (YYYY-MM) no fuso de São Paulo. */
export function currentMonth(now: Date = new Date()): string {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit',
  }).format(now)
  return partes.slice(0, 7)
}
