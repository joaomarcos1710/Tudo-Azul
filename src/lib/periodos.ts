/**
 * Períodos financeiros: mês-calendário, ciclo (dia de início 1–31) e intervalo personalizado.
 *
 * Camada pura: só calcula intervalos de datas. Não lê banco, não conhece tela e não mexe em
 * dinheiro. Datas são texto "AAAA-MM-DD" (como no resto do app) e os intervalos são
 * inclusivos nos dois lados: [de, ate].
 *
 * Entrada inválida nunca vira outro período em silêncio: as funções de cálculo lançam
 * `PeriodoInvalidoError` e `validarPersonalizado` devolve o motivo (para a tela mostrar).
 */

export type DataISO = string // "AAAA-MM-DD"
export type MesISO = string // "AAAA-MM"

export interface PeriodoMes {
  tipo: 'mes'
  mes: MesISO
}
/** `ref` é o mês-calendário em que o ciclo COMEÇA (o nome do ciclo). */
export interface PeriodoCiclo {
  tipo: 'ciclo'
  dia: number // 1..31
  ref: MesISO
}
export interface PeriodoPersonalizado {
  tipo: 'personalizado'
  de: DataISO
  ate: DataISO
}
export type Periodo = PeriodoMes | PeriodoCiclo | PeriodoPersonalizado

export interface Intervalo {
  de: DataISO
  ate: DataISO
}

/** Preferência da família: `dia` nulo = mês-calendário (comportamento atual). */
export interface ConfigPeriodo {
  dia: number | null
}

/**
 * Faixa de datas aceita pelo personalizado e por `periodoQueContem`. Atenção: o banco só grava datas de
 * 2000-01-01 a 2100-01-01 (CHECK das tabelas), então de 2100-01-02 em diante não há dado para mostrar.
 */
export const DATA_MIN: DataISO = '2000-01-01'
export const DATA_MAX: DataISO = '2100-12-31'
/** Meses de referência de mês/ciclo: de 2000-01 a 2099-12 (1.200 meses). */
export const MES_MIN: MesISO = '2000-01'
export const MES_MAX: MesISO = '2099-12'
/** Limite do personalizado, contando os dois extremos. */
export const MAX_DIAS_PERSONALIZADO = 366

export class PeriodoInvalidoError extends Error {
  constructor(mensagem: string) {
    super(mensagem)
    this.name = 'PeriodoInvalidoError'
  }
}

export type MotivoInvalido = 'formato' | 'data_inexistente' | 'fora_da_faixa' | 'invertido' | 'muito_longo'

export type ValidacaoPersonalizado =
  | { ok: true; intervalo: Intervalo; dias: number }
  | { ok: false; motivo: MotivoInvalido; mensagem: string }

const MS_DIA = 86_400_000
const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
]

// --- datas (aritmética em dias inteiros, sem fuso horário) -------------------------------

function bissexto(a: number): boolean {
  return (a % 4 === 0 && a % 100 !== 0) || a % 400 === 0
}

function diasNoMes(a: number, m: number): number {
  if (m === 2) return bissexto(a) ? 29 : 28
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31
}

const dd = (n: number) => String(n).padStart(2, '0')

/** Dias desde 1970-01-01; só chamar com ano já dentro da faixa (2000–2101). */
function epoca(a: number, m: number, d: number): number {
  return Math.round(Date.UTC(a, m - 1, d) / MS_DIA)
}

function dataDeEpoca(n: number): DataISO {
  const x = new Date(n * MS_DIA)
  return `${x.getUTCFullYear()}-${dd(x.getUTCMonth() + 1)}-${dd(x.getUTCDate())}`
}

/** Mesma conversão de `limitesDoMes` (lancamentos.ts), mantida aqui para a camada ficar pura. */
function ultimoDiaDoMes(a: number, m: number): DataISO {
  return `${a}-${dd(m)}-${dd(diasNoMes(a, m))}`
}

function somarMes(a: number, m: number, n: number): [number, number] {
  const t = a * 12 + (m - 1) + n
  return [Math.floor(t / 12), (t % 12) + 1]
}

// --- validação de entrada ----------------------------------------------------------------

type Falha = { motivo: MotivoInvalido; mensagem: string }

function lerData(texto: unknown): { a: number; m: number; d: number } | Falha {
  if (typeof texto !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(texto)) {
    return { motivo: 'formato', mensagem: 'Data inválida. Use o formato AAAA-MM-DD.' }
  }
  const [a, m, d] = texto.split('-').map(Number)
  if (m < 1 || m > 12 || d < 1 || d > diasNoMes(a, m)) {
    return { motivo: 'data_inexistente', mensagem: `A data ${texto} não existe.` }
  }
  if (texto < DATA_MIN || texto > DATA_MAX) {
    return { motivo: 'fora_da_faixa', mensagem: 'Use datas entre 01/01/2000 e 31/12/2100.' }
  }
  return { a, m, d }
}

const falhou = (x: object): x is Falha => 'motivo' in x

function lerMes(texto: unknown): { a: number; m: number } {
  if (typeof texto !== 'string' || !/^\d{4}-\d{2}$/.test(texto)) {
    throw new PeriodoInvalidoError('Mês inválido. Use o formato AAAA-MM.')
  }
  const [a, m] = texto.split('-').map(Number)
  if (m < 1 || m > 12) throw new PeriodoInvalidoError(`O mês ${texto} não existe.`)
  if (texto < MES_MIN || texto > MES_MAX) throw new PeriodoInvalidoError('Use meses entre 01/2000 e 12/2099.')
  return { a, m }
}

function lerDia(dia: unknown): number {
  if (typeof dia !== 'number' || !Number.isInteger(dia) || dia < 1 || dia > 31) {
    throw new PeriodoInvalidoError('O dia de início do ciclo deve ser um número inteiro de 1 a 31.')
  }
  return dia
}

/** Número de dias do intervalo contando os dois extremos (mesmo dia = 1). */
export function diasDoIntervalo(de: DataISO, ate: DataISO): number {
  const x = lerData(de)
  const y = lerData(ate)
  if (falhou(x)) throw new PeriodoInvalidoError(x.mensagem)
  if (falhou(y)) throw new PeriodoInvalidoError(y.mensagem)
  return epoca(y.a, y.m, y.d) - epoca(x.a, x.m, x.d) + 1
}

/** Valida o intervalo livre. Quem usa mostra `mensagem`; nada é corrigido por conta própria. */
export function validarPersonalizado(de: unknown, ate: unknown): ValidacaoPersonalizado {
  const x = lerData(de)
  if (falhou(x)) return { ok: false, ...x }
  const y = lerData(ate)
  if (falhou(y)) return { ok: false, ...y }
  const dias = epoca(y.a, y.m, y.d) - epoca(x.a, x.m, x.d) + 1
  if (dias < 1) return { ok: false, motivo: 'invertido', mensagem: 'A data inicial não pode ser depois da final.' }
  if (dias > MAX_DIAS_PERSONALIZADO) {
    return {
      ok: false,
      motivo: 'muito_longo',
      mensagem: `Máximo de ${MAX_DIAS_PERSONALIZADO} dias (contagem inclusiva). Este período tem ${dias}.`,
    }
  }
  return { ok: true, intervalo: { de: de as DataISO, ate: ate as DataISO }, dias }
}

// --- intervalos --------------------------------------------------------------------------

/** Dia em que o ciclo `ref` começa: o dia pedido, ou o último do mês se ele for mais curto. */
function inicioDoCiclo(a: number, m: number, dia: number): number {
  return epoca(a, m, Math.min(dia, diasNoMes(a, m)))
}

function intervaloDoCiclo(dia: number, ref: MesISO): Intervalo {
  const { a, m } = lerMes(ref)
  lerDia(dia)
  const [pa, pm] = somarMes(a, m, 1)
  return { de: dataDeEpoca(inicioDoCiclo(a, m, dia)), ate: dataDeEpoca(inicioDoCiclo(pa, pm, dia) - 1) }
}

/** Intervalo inclusivo do período. Lança `PeriodoInvalidoError` se o período for inválido. */
export function intervaloDoPeriodo(p: Periodo): Intervalo {
  switch (p?.tipo) {
    case 'mes': {
      const { a, m } = lerMes(p.mes)
      return { de: `${p.mes}-01`, ate: ultimoDiaDoMes(a, m) }
    }
    case 'ciclo':
      return intervaloDoCiclo(p.dia, p.ref)
    case 'personalizado': {
      const v = validarPersonalizado(p.de, p.ate)
      if (!v.ok) throw new PeriodoInvalidoError(v.mensagem)
      return v.intervalo
    }
    default:
      throw new PeriodoInvalidoError('Tipo de período desconhecido.')
  }
}

/**
 * Período da configuração que contém `data`: mês-calendário (dia nulo) ou o ciclo.
 * Lança se a data for inválida ou se o período cair fora de 2000-01 a 2099-12.
 */
export function periodoQueContem(data: DataISO, cfg: ConfigPeriodo): Periodo {
  const x = lerData(data)
  if (falhou(x)) throw new PeriodoInvalidoError(x.mensagem)
  const mes = `${x.a}-${dd(x.m)}`
  if (cfg?.dia == null) {
    lerMes(mes)
    return { tipo: 'mes', mes }
  }
  const dia = lerDia(cfg.dia)
  const [ra, rm] = x.d >= Math.min(dia, diasNoMes(x.a, x.m)) ? [x.a, x.m] : somarMes(x.a, x.m, -1)
  const ref = `${ra}-${dd(rm)}`
  lerMes(ref)
  const p: PeriodoCiclo = { tipo: 'ciclo', dia, ref }
  intervaloDoCiclo(dia, ref) // garante que o ciclo inteiro (inclusive o fim) está na faixa
  return p
}

function vizinho(p: Periodo, passo: 1 | -1): Periodo {
  switch (p?.tipo) {
    case 'mes': {
      const { a, m } = lerMes(p.mes)
      const [na, nm] = somarMes(a, m, passo)
      const mes = `${na}-${dd(nm)}`
      lerMes(mes)
      return { tipo: 'mes', mes }
    }
    case 'ciclo': {
      lerDia(p.dia)
      const { a, m } = lerMes(p.ref)
      const [na, nm] = somarMes(a, m, passo)
      const ref = `${na}-${dd(nm)}`
      lerMes(ref)
      return { tipo: 'ciclo', dia: p.dia, ref }
    }
    case 'personalizado': {
      // Mesma duração, colado no período atual: o seguinte começa um dia depois do fim.
      const { de, ate } = intervaloDoPeriodo(p)
      const dias = diasDoIntervalo(de, ate)
      const [da, dm, dd1] = de.split('-').map(Number)
      const [aa, am, ad] = ate.split('-').map(Number)
      const novo =
        passo === 1
          ? { de: dataDeEpoca(epoca(aa, am, ad) + 1), ate: dataDeEpoca(epoca(aa, am, ad) + dias) }
          : { de: dataDeEpoca(epoca(da, dm, dd1) - dias), ate: dataDeEpoca(epoca(da, dm, dd1) - 1) }
      const v = validarPersonalizado(novo.de, novo.ate)
      if (!v.ok) throw new PeriodoInvalidoError(v.mensagem)
      return { tipo: 'personalizado', ...novo }
    }
    default:
      throw new PeriodoInvalidoError('Tipo de período desconhecido.')
  }
}

export const periodoAnterior = (p: Periodo): Periodo => vizinho(p, -1)
export const periodoSeguinte = (p: Periodo): Periodo => vizinho(p, 1)

// --- rótulos -----------------------------------------------------------------------------

const brCurta = (iso: DataISO) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
const brCompleta = (iso: DataISO) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`

/**
 * Texto do período, sempre com as datas efetivas fora do mês-calendário:
 *  - mês: "Outubro de 2026"
 *  - ciclo: "Ciclo de outubro/2026 · 20/10 a 19/11" (com o ano nas duas datas se virar o ano:
 *    "Ciclo de dezembro/2026 · 20/12/2026 a 19/01/2027")
 *  - personalizado: "20/10/2026 a 05/11/2026"
 */
export function rotuloDoPeriodo(p: Periodo): string {
  const { de, ate } = intervaloDoPeriodo(p)
  if (p.tipo === 'mes') {
    const { a, m } = lerMes(p.mes)
    const nome = MESES[m - 1]
    return `${nome.charAt(0).toUpperCase()}${nome.slice(1)} de ${a}`
  }
  if (p.tipo === 'ciclo') {
    const { a, m } = lerMes(p.ref)
    const viraAno = de.slice(0, 4) !== ate.slice(0, 4)
    const datas = viraAno ? `${brCompleta(de)} a ${brCompleta(ate)}` : `${brCurta(de)} a ${brCurta(ate)}`
    return `Ciclo de ${MESES[m - 1]}/${a} · ${datas}`
  }
  return `${brCompleta(de)} a ${brCompleta(ate)}`
}
