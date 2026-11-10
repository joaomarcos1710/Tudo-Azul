import { Link } from 'react-router-dom'
import { formatBRL, formatMonth } from '../../lib/format'
import { GRAFICO } from '../../lib/cores'
import type { BarraCategoria } from './BarrasCategorias'

const pct = (v: number) => `${v.toLocaleString('pt-BR')}%`
const R = 40
const VOLTA = 2 * Math.PI * R
/** Espaço entre fatias (2px no viewBox de 100), como pedem as regras de gráfico. */
const FOLGA = 2

/** Cor da fatia: ordem fixa pela posição; "Outros" (categoriaId nulo) é sempre cinza. */
export function corDaFatia(f: BarraCategoria, i: number): string {
  return f.categoriaId === null ? GRAFICO.roscaOutros : GRAFICO.rosca[i % GRAFICO.rosca.length]
}

/**
 * Maiores gastos em rosca (Início). Valores, "Outros" e % vêm prontos do banco (expenses_by_category com p_top);
 * o ângulo de cada fatia é só a razão entre o % dela e a soma dos % (apresentação, nenhum dinheiro é somado aqui).
 * A cor nunca é a única informação: a legenda ao lado leva nome, valor e %, cada linha é um link para os
 * lançamentos de despesa do mês e há tabela com os mesmos números.
 */
export function RoscaCategorias({ fatias, mes }: { fatias: BarraCategoria[]; mes: string }) {
  const positivas = fatias.filter((f) => f.percentual > 0)
  const total = positivas.reduce((a, f) => a + f.percentual, 0)
  const destino = `/lancamentos?mes=${mes}&tipo=despesa`
  let acumulado = 0
  return (
    <div>
      <div className="flex flex-col items-center gap-4 sm:flex-row">
        <svg viewBox="0 0 100 100" className="h-36 w-36 shrink-0 -rotate-90" role="img"
          aria-label={`Despesas por categoria em ${formatMonth(mes)}: ${fatias.map((f) => `${f.nome} ${pct(f.percentual)}`).join(', ')}`}>
          {total > 0 && positivas.map((f) => {
            const parte = (f.percentual / total) * VOLTA
            const tamanho = positivas.length > 1 ? Math.max(parte - FOLGA, 0.5) : parte
            const inicio = acumulado
            acumulado += parte
            return (
              <circle key={f.categoriaId ?? 'outros'} data-testid="fatia-categoria" cx="50" cy="50" r={R} fill="none" strokeWidth="16"
                stroke={corDaFatia(f, fatias.indexOf(f))} strokeDasharray={`${tamanho} ${VOLTA - tamanho}`} strokeDashoffset={-inicio} />
            )
          })}
        </svg>
        <ul className="w-full min-w-0 flex-1 space-y-1" aria-label={`Legenda: despesas por categoria em ${formatMonth(mes)}`}>
          {fatias.map((f, i) => (
            <li key={f.categoriaId ?? 'outros'}>
              <Link to={destino} aria-label={`${f.nome}: ${formatBRL(f.valor)}, ${pct(f.percentual)} das despesas. Ver lançamentos de despesa do mês`}
                className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-azul-claro focus-visible:bg-azul-claro focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul">
                <span className="flex min-w-0 items-center gap-2">
                  <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-sm" style={{ background: corDaFatia(f, i) }} />
                  <span className={`truncate ${f.categoriaId === null ? 'text-slate-500' : 'text-slate-700'}`}>{f.nome}</span>
                </span>
                <span className="shrink-0 whitespace-nowrap">
                  <span className="tabular-nums font-semibold text-marinho">{formatBRL(f.valor)}</span>
                  <span className="ml-2 inline-block w-12 text-right tabular-nums text-slate-500">{pct(f.percentual)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
      <details className="mt-2 text-sm">
        <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold text-azul">Ver como tabela</summary>
        <table className="mt-1 w-full text-left">
          <caption className="sr-only">Maiores gastos em {formatMonth(mes)}</caption>
          <thead><tr className="text-xs text-slate-500">
            <th scope="col" className="py-1 font-medium">Categoria</th>
            <th scope="col" className="py-1 text-right font-medium">Valor</th>
            <th scope="col" className="py-1 text-right font-medium">%</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {fatias.map((f) => (
              <tr key={f.categoriaId ?? 'outros'}>
                <td className="py-1">{f.nome}</td>
                <td className="py-1 text-right tabular-nums">{formatBRL(f.valor)}</td>
                <td className="py-1 text-right tabular-nums">{pct(f.percentual)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  )
}
