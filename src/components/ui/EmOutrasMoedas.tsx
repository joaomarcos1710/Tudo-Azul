import { outrasMoedas } from '../../lib/contas'
import type { TotalPorMoeda } from '../../lib/contas'
import { formatMoeda } from '../../lib/format'

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
  const outras = outrasMoedas(porMoeda)
  if (outras.length === 0) return null
  return (
    <div className={className} role="group" aria-label="Em outras moedas">
      <p className="text-xs font-semibold text-slate-500">Em outras moedas</p>
      <ul className="flex flex-wrap gap-x-4">
        {outras.map((m) => (
          <li key={m.moeda} className="tabular-nums text-sm font-semibold">{formatMoeda(ativas ? m.totalAtivas : m.total, m.moeda)}</li>
        ))}
      </ul>
      <p className="text-xs text-slate-500">Separado, sem conversão: não entra no total em reais.</p>
    </div>
  )
}
