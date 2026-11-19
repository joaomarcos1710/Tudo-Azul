/**
 * Ciclo do orçamento: do dia em que o mês da pessoa começa (Preferências, 1 a 28) até a véspera do mesmo dia no mês seguinte.
 * A chave é o mês em que o ciclo COMEÇA (decisão de 16/11/2026): com dia 20, "2026-11" vai de 20/11 a 19/12. Com dia 1 é o
 * mês de calendário. Só datas e rótulos; o gasto e a projeção do ciclo vêm do banco (migration 144).
 */
export interface CicloOrcamento { inicio: string; fim: string }

const doisDigitos = (n: number) => String(n).padStart(2, '0')
const iso = (d: Date) => `${d.getUTCFullYear()}-${doisDigitos(d.getUTCMonth() + 1)}-${doisDigitos(d.getUTCDate())}`

/** Início e fim (AAAA-MM-DD) do ciclo da chave (AAAA-MM) para o dia escolhido. */
export function cicloDoOrcamento(chave: string, dia: number): CicloOrcamento {
  const [ano, mes] = chave.split('-').map(Number)
  // mês 1-based como índice = o mês seguinte; dia − 1 = a véspera (dia 0 = último dia do mês da chave)
  return { inicio: `${chave}-${doisDigitos(dia)}`, fim: iso(new Date(Date.UTC(ano, mes, dia - 1))) }
}

/** Chave (AAAA-MM) do ciclo em que `hoje` (AAAA-MM-DD) cai: antes do dia escolhido ainda vale o ciclo do mês anterior. */
export function chaveDoCicloDe(hoje: string, dia: number): string {
  const [ano, mes, d] = hoje.split('-').map(Number)
  if (d >= dia) return hoje.slice(0, 7)
  const anterior = new Date(Date.UTC(ano, mes - 2, 1))
  return `${anterior.getUTCFullYear()}-${doisDigitos(anterior.getUTCMonth() + 1)}`
}

/** Dia do ciclo em que `hoje` está (1 no primeiro dia). Fora do ciclo, o primeiro dia dele (nunca menos de 1). */
export function diaDoCiclo(hoje: string, chave: string, dia: number): number {
  const { inicio } = cicloDoOrcamento(chave, dia)
  const dias = (Date.parse(`${hoje}T00:00:00Z`) - Date.parse(`${inicio}T00:00:00Z`)) / 86400000
  return Math.max(1, Math.round(dias) + 1)
}

/** "20/11 a 19/12". */
export function rotuloDoCiclo(chave: string, dia: number): string {
  const { inicio, fim } = cicloDoOrcamento(chave, dia)
  const br = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}`
  return `${br(inicio)} a ${br(fim)}`
}
