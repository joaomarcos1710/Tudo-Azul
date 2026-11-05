import { Link } from 'react-router-dom'
import { formatBRL, formatMonth } from '../../lib/format'
import type { Cents } from '../../lib/format'
import { COR_LINHA } from './cores'

export interface BarraCategoria {
  /** null = "Outros" (o resto, somado no banco). */
  categoriaId: string | null
  nome: string
  valor: Cents
  /** % do total do período, já arredondado no banco. */
  percentual: number
}

const pct = (v: number) => `${v.toLocaleString('pt-BR')}%`

/**
 * Despesas por categoria em barras horizontais: uma série só (uma cor), nome e valor ao lado de cada barra.
 * Valores, "Outros" e % vêm prontos do banco (expenses_by_category com p_top); a largura da barra é só a razão
 * entre o valor e o maior valor da lista (apresentação, nenhum dinheiro é somado aqui).
 * Cada linha leva aos lançamentos de despesa do mês.
 */
export function BarrasCategorias({ barras, mes }: { barras: BarraCategoria[]; mes: string }) {
  const maior = Math.max(...barras.map((b) => b.valor as number), 0)
  const destino = `/lancamentos?mes=${mes}&tipo=despesa`
  return (
    <div>
      <ul className="space-y-1" aria-label={`Despesas por categoria em ${formatMonth(mes)}`}>
        {barras.map((b) => {
          // barra visível mesmo para valor bem pequeno (2%); valor zero ou negativo fica sem barra
          const largura = maior > 0 && b.valor > 0 ? Math.max(2, (b.valor / maior) * 100) : 0
          return (
            <li key={b.categoriaId ?? 'outros'}>
              <Link to={destino} aria-label={`${b.nome}: ${formatBRL(b.valor)}, ${pct(b.percentual)} das despesas. Ver lançamentos de despesa do mês`}
                className="group block rounded-lg px-2 py-1.5 hover:bg-azul-claro focus-visible:bg-azul-claro focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul">
                <span className="flex items-baseline justify-between gap-3 text-sm">
                  <span className={`min-w-0 truncate ${b.categoriaId === null ? 'text-slate-500' : 'text-slate-700'}`}>{b.nome}</span>
                  <span className="shrink-0 whitespace-nowrap">
                    <span className="tabular-nums font-semibold text-marinho">{formatBRL(b.valor)}</span>
                    <span className="ml-2 inline-block w-12 text-right tabular-nums text-slate-500">{pct(b.percentual)}</span>
                  </span>
                </span>
                {/* barra de 12px: base reta à esquerda, ponta arredondada de 4px; uma cor só (uma série; o nome identifica) */}
                <span className="mt-1 block h-3 w-full" aria-hidden="true">
                  <span data-testid="barra-categoria" className="block h-3 rounded-r" style={{ width: `${largura}%`, background: COR_LINHA }} />
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
      <details className="mt-2 text-sm">
        <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold text-azul">Ver como tabela</summary>
        <table className="mt-1 w-full text-left">
          <caption className="sr-only">Despesas por categoria em {formatMonth(mes)}</caption>
          <thead><tr className="text-xs text-slate-500">
            <th scope="col" className="py-1 font-medium">Categoria</th>
            <th scope="col" className="py-1 text-right font-medium">Valor</th>
            <th scope="col" className="py-1 text-right font-medium">%</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {barras.map((b) => (
              <tr key={b.categoriaId ?? 'outros'}>
                <td className="py-1">{b.nome}</td>
                <td className="py-1 text-right tabular-nums">{formatBRL(b.valor)}</td>
                <td className="py-1 text-right tabular-nums">{pct(b.percentual)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  )
}
