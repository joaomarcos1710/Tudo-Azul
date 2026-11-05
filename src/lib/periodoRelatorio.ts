import { formatDate, formatMonth, primeiraMaiuscula } from './format'
import { limitesDoMes, somarMeses } from './lancamentos'

/**
 * Período do relatório Entradas x Saídas (#179, como no Organizze): o período é a escolha principal e a divisão só
 * fatia o período. Aqui só há DATAS (nenhum dinheiro): os números vêm do banco (cash_flow_series).
 */
export type TipoPeriodo = 'dia' | 'semana' | 'mes' | 'meses' | 'ano' | 'livre'

export interface Periodo {
  tipo: TipoPeriodo
  /** AAAA-MM-DD, inclusive. */
  de: string
  ate: string
}

/** day/week/month = uma linha por dia, semana (segunda a domingo) ou mês; total = o período inteiro numa linha (acumulado). */
export type Divisao = 'day' | 'week' | 'month' | 'total'

/** Diário só até 62 dias (dois meses cheios): mais que isso vira uma tabela de rolar sem fim no celular. */
export const LIMITE_DIARIO = 62
/** O banco aceita até 10 anos (cash_flow_report); o "Escolher período" recusa antes. */
export const LIMITE_DIAS = 3660

const utc = (iso: string) => { const [a, m, d] = iso.split('-').map(Number); return Date.UTC(a, m - 1, d) }
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10)

export function somarDias(data: string, n: number): string {
  return iso(utc(data) + n * 86_400_000)
}

/** Quantos dias o período tem, contando o primeiro e o último. */
export function diasNoPeriodo(p: Pick<Periodo, 'de' | 'ate'>): number {
  return Math.round((utc(p.ate) - utc(p.de)) / 86_400_000) + 1
}

/** A segunda-feira da semana da data (a semana do banco: date_trunc('week'), segunda a domingo). */
export function segundaDaSemana(data: string): string {
  const dow = new Date(utc(data)).getUTCDay() // 0 = domingo
  return somarDias(data, dow === 0 ? -6 : 1 - dow)
}

export const periodoDoMes = (mes: string): Periodo => { const [de, ate] = limitesDoMes(mes); return { tipo: 'mes', de, ate } }
export const periodoDoAno = (ano: number): Periodo => ({ tipo: 'ano', de: `${ano}-01-01`, ate: `${ano}-12-31` })
/** Os N meses cheios que terminam no mês da data (ex.: últimos 3 meses em 05/11 = 01/09 a 30/11). */
export function ultimosMeses(hoje: string, n: number): Periodo {
  const mes = hoje.slice(0, 7)
  return { tipo: 'meses', de: limitesDoMes(somarMeses(mes, -(n - 1)))[0], ate: limitesDoMes(mes)[1] }
}

/** Os atalhos do menu, na ordem do Organizze. "Escolher período" (datas livres) fica à parte. */
export const ATALHOS: { chave: string; rotulo: string; criar: (hoje: string) => Periodo }[] = [
  { chave: 'hoje', rotulo: 'Hoje', criar: (h) => ({ tipo: 'dia', de: h, ate: h }) },
  { chave: 'semana', rotulo: 'Esta semana', criar: (h) => { const s = segundaDaSemana(h); return { tipo: 'semana', de: s, ate: somarDias(s, 6) } } },
  { chave: 'mes', rotulo: 'Este mês', criar: (h) => periodoDoMes(h.slice(0, 7)) },
  { chave: '3m', rotulo: 'Últimos 3 meses', criar: (h) => ultimosMeses(h, 3) },
  { chave: '6m', rotulo: 'Últimos 6 meses', criar: (h) => ultimosMeses(h, 6) },
  { chave: '12m', rotulo: 'Últimos 12 meses', criar: (h) => ultimosMeses(h, 12) },
  { chave: 'ano', rotulo: 'Este ano', criar: (h) => periodoDoAno(Number(h.slice(0, 4))) },
]

const mesesEntre = (de: string, ate: string) => {
  const [a1, m1] = de.split('-').map(Number), [a2, m2] = ate.split('-').map(Number)
  return (a2 - a1) * 12 + (m2 - m1) + 1
}

/** As setas: o período do mesmo tamanho, antes (−1) ou depois (+1). Mês, meses e ano andam por meses cheios. */
export function moverPeriodo(p: Periodo, sentido: 1 | -1): Periodo {
  if (p.tipo === 'ano') return periodoDoAno(Number(p.de.slice(0, 4)) + sentido)
  if (p.tipo === 'mes') return periodoDoMes(somarMeses(p.de.slice(0, 7), sentido))
  if (p.tipo === 'meses') {
    const n = mesesEntre(p.de, p.ate)
    return { tipo: 'meses', de: limitesDoMes(somarMeses(p.de.slice(0, 7), sentido * n))[0], ate: limitesDoMes(somarMeses(p.ate.slice(0, 7), sentido * n))[1] }
  }
  const n = diasNoPeriodo(p) * sentido
  return { tipo: p.tipo, de: somarDias(p.de, n), ate: somarDias(p.ate, n) }
}

const mes3 = (data: string) => primeiraMaiuscula(formatMonth(data.slice(0, 7)).slice(0, 3))

/** O nome do período no seletor: "Novembro de 2026", "2026", "Set a Nov de 2026", "02/11 a 08/11/2026", "05/11/2026". */
export function rotuloPeriodo(p: Periodo): string {
  if (p.tipo === 'ano') return p.de.slice(0, 4)
  if (p.tipo === 'mes') return primeiraMaiuscula(formatMonth(p.de.slice(0, 7)))
  if (p.tipo === 'meses') {
    return p.de.slice(0, 4) === p.ate.slice(0, 4)
      ? `${mes3(p.de)} a ${mes3(p.ate)} de ${p.ate.slice(0, 4)}`
      : `${mes3(p.de)}/${p.de.slice(2, 4)} a ${mes3(p.ate)}/${p.ate.slice(2, 4)}`
  }
  if (p.de === p.ate) return formatDate(p.de)
  if (p.de.slice(0, 4) === p.ate.slice(0, 4)) return `${formatDate(p.de).slice(0, 5)} a ${formatDate(p.ate)}`
  return `${formatDate(p.de)} a ${formatDate(p.ate)}`
}

export interface OpcaoDivisao {
  chave: Divisao
  rotulo: string
  ativa: boolean
  /** Por que está apagada (aparece na tela e no leitor de tela). */
  motivo?: string
}

/** Diário · Semanal · Mensal · Acumulado, apagando a que não faz sentido no período (como no Organizze). */
export function divisoes(p: Periodo): OpcaoDivisao[] {
  const dias = diasNoPeriodo(p)
  const umaSemana = segundaDaSemana(p.de) === segundaDaSemana(p.ate)
  const umMes = p.de.slice(0, 7) === p.ate.slice(0, 7)
  return [
    { chave: 'day', rotulo: 'Diário', ativa: dias <= LIMITE_DIARIO, motivo: dias <= LIMITE_DIARIO ? undefined : `Diário só em períodos de até ${LIMITE_DIARIO} dias.` },
    { chave: 'week', rotulo: 'Semanal', ativa: !umaSemana, motivo: umaSemana ? 'Semanal precisa de um período que passe de uma semana.' : undefined },
    { chave: 'month', rotulo: 'Mensal', ativa: !umMes, motivo: umMes ? 'Mensal precisa de um período com mais de um mês.' : undefined },
    { chave: 'total', rotulo: 'Acumulado', ativa: true },
  ]
}

/** Mantém a divisão escolhida se ela ainda vale no período; senão, diário (até 62 dias) ou mensal. */
export function ajustarDivisao(atual: Divisao, p: Periodo): Divisao {
  const opcoes = divisoes(p)
  if (opcoes.find((o) => o.chave === atual)?.ativa) return atual
  return opcoes[0].ativa ? 'day' : 'month'
}

/** Confere as datas do "Escolher período". null = pode. */
export function erroPeriodoLivre(de: string, ate: string): string | null {
  const data = /^\d{4}-\d{2}-\d{2}$/
  if (!data.test(de) || !data.test(ate)) return 'Escolha a data inicial e a final.'
  if (de > ate) return 'A data inicial não pode ser depois da final.'
  if (diasNoPeriodo({ de, ate }) > LIMITE_DIAS) return 'Escolha um período de até 10 anos.'
  return null
}

/** Rótulos de uma linha da tabela: curto (celular, iPad em retrato), por extenso (computador, tooltip) e do eixo do gráfico. */
export function rotulosLinha(inicio: string, fim: string, divisao: Divisao, periodo: Periodo): { curto: string; longo: string; eixo: string } {
  if (divisao === 'total') {
    const r = rotuloPeriodo(periodo)
    // mês: "Nov de 2026" no celular e no iPad (como no Organizze), por extenso no computador
    const curto = periodo.tipo === 'mes' ? `${mes3(periodo.de)} de ${periodo.de.slice(0, 4)}` : r
    return { curto, longo: r, eixo: curto }
  }
  if (divisao === 'month') {
    const ym = inicio.slice(0, 7), curto = `${formatMonth(ym).slice(0, 3)}/${ym.slice(2, 4)}`
    return { curto, longo: primeiraMaiuscula(formatMonth(ym)), eixo: curto }
  }
  const dm = (d: string) => formatDate(d).slice(0, 5)
  // semana: "26/10–01/11" no celular e no iPad (cabe na coluna), "26/10 a 01/11" no computador
  if (divisao === 'week') return { curto: `${dm(inicio)}–${dm(fim)}`, longo: `${dm(inicio)} a ${dm(fim)}`, eixo: dm(inicio) }
  return { curto: dm(inicio), longo: dm(inicio), eixo: inicio.slice(8, 10) }
}
