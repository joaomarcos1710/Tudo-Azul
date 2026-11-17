import { useState } from 'react'
import type { PointerEvent } from 'react'
import { formatBRL, formatDate } from '../../lib/format'
import type { Cents } from '../../lib/format'
import { COR_EIXO, COR_GRADE, COR_LINHA } from './cores'
import { useLargura } from './useLargura'
import { brlCompacto, topoRedondo } from './LinhaAcumulada'

export interface BarraDia {
  dia: string
  valor: Cents
}

/**
 * Gasto de cada dia (barras finas, uma série, azul), com a linha de "hoje" e o valor do dia ao tocar ou passar o mouse.
 * Os valores vêm prontos do banco; aqui só se desenha. Dias sem gasto ficam sem barra (não somem do eixo). "Ver tabela"
 * lista só os dias com gasto.
 */
export function BarrasDiarias({ titulo, dias, hoje }: { titulo: string; dias: BarraDia[]; hoje: string }) {
  const [ativo, setAtivo] = useState<number | null>(null)
  const [caixa, L] = useLargura<HTMLDivElement>()
  if (dias.length === 0) return null
  const A = 180, esq = 64, dir = 8, topo = 10, base = 24
  const max = topoRedondo(Math.max(...dias.map((d) => d.valor as number), 0))
  const n = dias.length
  const passo = (L - esq - dir) / n
  const larg = Math.max(2, Math.min(14, passo - 2))
  const x = (i: number) => esq + i * passo + (passo - larg) / 2
  const y = (v: number) => topo + (1 - v / max) * (A - topo - base)
  const iHoje = dias.findIndex((d) => d.dia === hoje)
  const comGasto = dias.filter((d) => d.valor > 0)
  // rótulos do eixo x: o primeiro, o último e uns no meio, sem encostar (no mínimo ~44 px entre eles)
  const salto = Math.max(1, Math.ceil(44 / passo))

  function mover(e: PointerEvent<SVGRectElement>) {
    const r = e.currentTarget.ownerSVGElement!.getBoundingClientRect()
    const px = ((e.clientX - r.left) / r.width) * L
    setAtivo(Math.min(n - 1, Math.max(0, Math.floor((px - esq) / passo))))
  }

  return (
    <div className="relative" ref={caixa}>
      <svg viewBox={`0 0 ${L} ${A}`} className="h-auto w-full" role="img"
        aria-label={`${titulo}. ${comGasto.length} dia(s) com compra. Os valores de cada dia estão na tabela abaixo.`}>
        {[0, max / 2, max].map((v) => (
          <g key={v}>
            <line x1={esq} x2={L - dir} y1={y(v)} y2={y(v)} stroke={v === 0 ? COR_EIXO : COR_GRADE} strokeWidth="1" />
            <text x={esq - 6} y={y(v) + 4} textAnchor="end" fontSize="12" className="fill-slate-500">{brlCompacto(v)}</text>
          </g>
        ))}
        {dias.map((d, i) => d.valor > 0 && (
          <rect key={d.dia} x={x(i)} y={y(d.valor)} width={larg} height={Math.max(1, y(0) - y(d.valor))} rx="2"
            fill={COR_LINHA} opacity={ativo === null || ativo === i ? 1 : 0.55} />
        ))}
        {iHoje >= 0 && (
          <g>
            <line x1={x(iHoje) + larg / 2} x2={x(iHoje) + larg / 2} y1={topo} y2={A - base} stroke={COR_EIXO} strokeWidth="1" strokeDasharray="3 3" />
            <text x={x(iHoje) + larg / 2} y={topo + 2} textAnchor="middle" fontSize="11" className="fill-slate-600">hoje</text>
          </g>
        )}
        {dias.map((d, i) => (i % salto === 0 || i === n - 1) && (n - 1 - i >= salto / 2 || i === n - 1) && (
          <text key={`r-${d.dia}`} x={x(i) + larg / 2} y={A - 6} textAnchor="middle" fontSize="12" className="fill-slate-500">{d.dia.slice(8, 10)}/{d.dia.slice(5, 7)}</text>
        ))}
        <rect x={esq} y={topo} width={L - esq - dir} height={A - topo - base} fill="transparent"
          onPointerMove={mover} onPointerDown={mover} onPointerLeave={() => setAtivo(null)} />
      </svg>
      {ativo !== null && (
        <div role="status" className="pointer-events-none absolute top-2 rounded-lg bg-white px-3 py-2 text-xs shadow-card ring-1 ring-slate-200"
          style={{ left: `${Math.min(70, Math.max(2, (x(ativo) / L) * 100 - 10))}%` }}>
          <p className="font-semibold text-marinho">{formatDate(dias[ativo].dia)}</p>
          <p className="tabular-nums text-slate-700">{dias[ativo].valor > 0 ? formatBRL(dias[ativo].valor) : 'sem compra'}</p>
        </div>
      )}
      <details className="mt-2 text-sm">
        <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold text-azul">Ver tabela</summary>
        {comGasto.length === 0 ? <p className="text-slate-600">Nenhuma compra neste ciclo.</p> : (
          <table className="mt-1 w-full text-left">
            <thead><tr className="text-xs text-slate-500"><th className="py-1 font-medium">Dia</th><th className="py-1 text-right font-medium">Gasto</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {comGasto.map((d) => (
                <tr key={d.dia}><td className="py-1">{formatDate(d.dia)}</td><td className="py-1 text-right tabular-nums">{formatBRL(d.valor)}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </details>
    </div>
  )
}
