import type { ReactNode } from 'react'
import { outrasMoedas } from '../../lib/contas'
import type { TotalPorMoeda } from '../../lib/contas'
import { formatMoeda } from '../../lib/format'
import type { ResumoPorMoeda } from '../../lib/lancamentos'

/** Moldura comum: título, uma linha por moeda e o aviso de que nada disso entra no total em reais. */
function Bloco({ linhas, className }: { linhas: { moeda: string; conteudo: ReactNode }[]; className: string }) {
  if (linhas.length === 0) return null
  return (
    <div className={className} role="group" aria-label="Em outras moedas">
      <p className="text-xs font-semibold text-slate-500">Em outras moedas</p>
      <ul className="flex flex-wrap gap-x-4">
        {linhas.map((l) => <li key={l.moeda} className="tabular-nums text-sm font-semibold">{l.conteudo}</li>)}
      </ul>
      <p className="text-xs text-slate-500">Separado, sem conversão: não entra no total em reais.</p>
    </div>
  )
}

/**
 * Saldo das contas em outras moedas, cada uma separada e sem conversão (balance_totals_by_currency, migration 055).
 * Fica ao lado de um total em reais e nunca é somado a ele. Sem conta fora do BRL, não aparece.
 */
export function EmOutrasMoedas({ porMoeda, ativas = false, className = '' }: {
  porMoeda: TotalPorMoeda[]
  /** true = só as contas ativas (total_active); padrão: todas, como o total em reais ao lado. */
  ativas?: boolean
  className?: string
}) {
  return <Bloco className={className} linhas={outrasMoedas(porMoeda).map((m) => ({ moeda: m.moeda, conteudo: formatMoeda(ativas ? m.totalAtivas : m.total, m.moeda) }))} />
}

/**
 * Receitas, despesas e resultado PAGOS do período em outras moedas (period_summary_by_currency, migration 056), cada
 * moeda separada e sem conversão. Fica ao lado dos totais em reais (period_summary) e nunca é somado a eles. Sem
 * movimento fora do BRL no período, não aparece.
 */
export function ResultadoEmOutrasMoedas({ porMoeda, className = '' }: { porMoeda: ResumoPorMoeda[]; className?: string }) {
  return <Bloco className={className} linhas={porMoeda.filter((m) => m.moeda !== 'BRL').map((m) => ({
    moeda: m.moeda,
    conteudo: (
      <span className="flex flex-wrap gap-x-1.5">
        <span className="whitespace-nowrap text-lucro">+{formatMoeda(m.receitas, m.moeda)}</span>
        <span className="whitespace-nowrap text-prejuizo">−{formatMoeda(m.despesas, m.moeda)}</span>
        <span className="whitespace-nowrap">= {formatMoeda(m.resultado, m.moeda)}</span>
      </span>
    ),
  }))} />
}
