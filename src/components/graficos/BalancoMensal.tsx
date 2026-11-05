import { useState } from 'react'
import { formatBRL, formatMonth, primeiraMaiuscula } from '../../lib/format'
import type { Cents } from '../../lib/format'
import { MASCARA, valoresOcultos } from '../../lib/privacidade'
import { COR_DESPESA, COR_RECEITA } from './cores'
import { brlCompacto, topoRedondo } from './LinhaAcumulada'

export interface MesBalanco {
  /** AAAA-MM */
  mes: string
  receitas: Cents
  despesas: Cents
  /** Receitas − despesas do mês, calculado no banco (cash_flow_report.balance). */
  resultado: Cents
}

const mesCurto = (mes: string) => primeiraMaiuscula(formatMonth(mes).slice(0, 3))

/** "+R$ 3,5 mil" / "−R$ 1,2 mil": o sinal vem em texto, nunca só na cor. Com valores ocultos, a máscara. */
export function resultadoCompacto(v: Cents): string {
  if (valoresOcultos()) return MASCARA
  if (v === 0) return brlCompacto(0)
  return `${v > 0 ? '+' : '−'}${brlCompacto(Math.abs(v))}`
}

/** Retângulo com os dois cantos de cima arredondados (4px) e a base reta, apoiado na linha do zero. */
function barra(x: number, y: number, w: number, h: number): string {
  if (h <= 0) return ''
  const r = Math.min(4, h, w / 2)
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`
}

/**
 * Balanço mês a mês: barras agrupadas receita × despesa e, acima de cada par, o resultado do mês (do banco).
 * Eixo começa no zero (barra mede tamanho). Nada é somado aqui: o front só desenha os números do banco.
 */
export function BalancoMensal({ meses }: { meses: MesBalanco[] }) {
  const [ativo, setAtivo] = useState<number | null>(null)
  const L = 640, A = 240, esq = 64, dir = 12, topo = 30, base = 28
  const max = topoRedondo(Math.max(0, ...meses.flatMap((m) => [m.receitas as number, m.despesas as number])))
  const largGrupo = (L - esq - dir) / Math.max(1, meses.length)
  const larg = Math.min(24, Math.floor(largGrupo * 0.3))
  const y = (v: number) => topo + (1 - Math.max(0, v) / max) * (A - topo - base)
  const centro = (i: number) => esq + largGrupo * i + largGrupo / 2
  const grade = [0, 0.5, 1].map((f) => f * max)
  const m = ativo !== null ? meses[ativo] : null

  return (
    <div>
      <p className="mb-2 flex flex-wrap gap-4 text-xs text-slate-600" aria-hidden="true">
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm" style={{ background: COR_RECEITA }} />Receitas</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm" style={{ background: COR_DESPESA }} />Despesas</span>
        <span className="inline-flex items-center gap-1.5"><span className="font-semibold text-marinho">±</span>Resultado do mês, acima de cada par</span>
      </p>
      <div className="relative">
        <svg viewBox={`0 0 ${L} ${A}`} className="h-auto w-full" role="group"
          aria-label="Receitas e despesas de cada mês, com o resultado. Os valores também estão na tabela abaixo.">
          {grade.map((v) => (
            <g key={v} aria-hidden="true">
              <line x1={esq} x2={L - dir} y1={y(v)} y2={y(v)} stroke={v === 0 ? '#94a3b8' : '#e2e8f0'} strokeWidth="1" />
              <text x={esq - 8} y={y(v) + 4} textAnchor="end" fontSize="12" className="fill-slate-500">{brlCompacto(v)}</text>
            </g>
          ))}
          {meses.map((x, i) => {
            const c = centro(i)
            const xr = c - larg - 1, xd = c + 1 // 2px de fundo entre as duas barras do par
            const topoPar = y(Math.max(x.receitas, x.despesas))
            const rotulo = `${primeiraMaiuscula(formatMonth(x.mes))}: receitas ${formatBRL(x.receitas)}, despesas ${formatBRL(x.despesas)}, resultado ${formatBRL(x.resultado)}`
            return (
              <g key={x.mes} tabIndex={0} role="img" aria-label={rotulo} data-testid="par-balanco"
                onPointerEnter={() => setAtivo(i)} onPointerLeave={() => setAtivo(null)} onPointerDown={() => setAtivo(i)}
                onFocus={() => setAtivo(i)} onBlur={() => setAtivo(null)} className="cursor-default outline-none">
                {/* alvo do toque/hover maior que as barras: a coluna inteira do mês */}
                <rect x={esq + largGrupo * i} y={topo - 24} width={largGrupo} height={A - topo - base + 24}
                  fill={ativo === i ? '#eaf2ff' : 'transparent'} rx="6" />
                <path d={barra(xr, y(x.receitas), larg, y(0) - y(x.receitas))} fill={COR_RECEITA} />
                <path d={barra(xd, y(x.despesas), larg, y(0) - y(x.despesas))} fill={COR_DESPESA} />
                <text x={c} y={topoPar - 8} textAnchor="middle" fontSize="12" fontWeight="600"
                  className={x.resultado < 0 ? 'fill-negativo' : 'fill-marinho'}>{resultadoCompacto(x.resultado)}</text>
                <text x={c} y={A - 8} textAnchor="middle" fontSize="12" className="fill-slate-500">{mesCurto(x.mes)}</text>
              </g>
            )
          })}
        </svg>
        {m && ativo !== null && (
          <div role="status" className="pointer-events-none absolute top-0 rounded-lg bg-white px-3 py-2 text-xs shadow-card ring-1 ring-slate-200"
            style={{ left: `${Math.min(68, Math.max(2, (centro(ativo) / L) * 100 - 14))}%` }}>
            <p className="font-semibold text-marinho">{primeiraMaiuscula(formatMonth(m.mes))}</p>
            <p className="tabular-nums text-slate-700">Receitas: {formatBRL(m.receitas)}</p>
            <p className="tabular-nums text-slate-700">Despesas: {formatBRL(m.despesas)}</p>
            <p className={`tabular-nums font-semibold ${m.resultado < 0 ? 'text-negativo' : 'text-marinho'}`}>Resultado: {formatBRL(m.resultado)}</p>
          </div>
        )}
      </div>
      <details className="mt-2 text-sm">
        <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold text-azul">Ver como tabela</summary>
        <table className="mt-1 w-full text-left">
          <caption className="sr-only">Balanço dos últimos {meses.length} meses</caption>
          <thead><tr className="text-xs text-slate-500">
            <th scope="col" className="py-1 font-medium">Mês</th>
            <th scope="col" className="py-1 text-right font-medium">Receitas</th>
            <th scope="col" className="py-1 text-right font-medium">Despesas</th>
            <th scope="col" className="py-1 text-right font-medium">Resultado</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {meses.map((x) => (
              <tr key={x.mes}>
                <td className="py-1">{primeiraMaiuscula(formatMonth(x.mes))}</td>
                <td className="py-1 text-right tabular-nums">{formatBRL(x.receitas)}</td>
                <td className="py-1 text-right tabular-nums">{formatBRL(x.despesas)}</td>
                <td className={`py-1 text-right tabular-nums ${x.resultado < 0 ? 'text-negativo' : ''}`}>{formatBRL(x.resultado)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  )
}
