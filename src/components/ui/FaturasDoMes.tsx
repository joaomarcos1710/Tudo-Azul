import type { TotalFaturasMes } from '../../lib/cartoes'
import { formatBRL, formatMonth } from '../../lib/format'

/**
 * "Faturas que vencem em <mês>": a soma das faturas de todos os cartões que vencem no mês (card_invoices_month, migration
 * 023). Nada é somado aqui: total, pago e falta vêm do banco. Usado no Início e no topo da aba Cartões.
 */
export function FaturasDoMes({ mes, dados, className = '' }: { mes: string; dados: TotalFaturasMes | null | undefined; className?: string }) {
  if (!dados || dados.faturas <= 0) return null
  return (
    <div className={`rounded-lg bg-fundo p-3 ${className}`} data-testid="faturas-do-mes">
      <p className="text-sm text-slate-500">Faturas que vencem em {formatMonth(mes).replace(/ de \d{4}$/, '')}</p>
      <p className="tabular-nums text-2xl font-bold tracking-tight">{formatBRL(dados.total)}</p>
      <p className="text-xs text-slate-500">
        {dados.faturas === 1 ? '1 fatura' : `${dados.faturas} faturas`}
        {dados.pago > 0 && <> · já pago {formatBRL(dados.pago)} · falta {formatBRL(dados.falta)}</>}
      </p>
    </div>
  )
}
