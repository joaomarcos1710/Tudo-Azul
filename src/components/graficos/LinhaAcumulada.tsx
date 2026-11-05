import { useState } from 'react'
import type { PointerEvent } from 'react'
import { formatBRL, formatDate } from '../../lib/format'
import { MASCARA, valoresOcultos } from '../../lib/privacidade'
import type { Cents } from '../../lib/format'
import { COR_LINHA } from './cores'

export interface PontoDia {
  dia: string
  valor: Cents
  acumulado: Cents
}

/** "R$ 1,5 mil" para os rótulos do eixo (os valores exatos ficam no tooltip). */
export function brlCompacto(c: number): string {
  if (valoresOcultos()) return MASCARA
  const reais = c / 100
  if (Math.abs(reais) >= 1000) return `R$ ${(reais / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`
  return `R$ ${Math.round(reais).toLocaleString('pt-BR')}`
}

/** Escala "redonda" para o eixo: 1, 2 ou 5 × 10^n acima do máximo. */
export function topoRedondo(max: number): number {
  if (max <= 0) return 10000
  const pot = 10 ** Math.floor(Math.log10(max))
  for (const m of [1, 2, 2.5, 5, 10]) if (m * pot >= max) return m * pot
  return 10 * pot
}

/**
 * Despesa acumulada no mês, um ponto por dia até `ate` (hoje). Linha única de 2px, área suave,
 * cursor com linha vertical e tooltip com o dia, o gasto do dia e o acumulado.
 */
export function LinhaAcumulada({ pontos, ate }: { pontos: PontoDia[]; ate: string }) {
  const [ativo, setAtivo] = useState<number | null>(null)
  const L = 640, A = 220, esq = 64, dir = 12, topo = 12, base = 28
  const visiveis = pontos.filter((p) => p.dia <= ate)
  const max = topoRedondo(Math.max(0, ...visiveis.map((p) => p.acumulado)))
  const x = (i: number) => esq + (pontos.length <= 1 ? 0 : (i / (pontos.length - 1)) * (L - esq - dir))
  const y = (v: number) => topo + (1 - Math.max(0, v) / max) * (A - topo - base)
  const caminho = visiveis.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.acumulado).toFixed(1)}`).join(' ')
  const area = visiveis.length ? `${caminho} L${x(visiveis.length - 1).toFixed(1)},${y(0)} L${x(0)},${y(0)} Z` : ''
  const linhasGrade = [0, 0.5, 1].map((f) => f * max)
  const marcasX = pontos.map((p, i) => ({ p, i })).filter(({ i }) => i === 0 || (i + 1) % 7 === 0 || i === pontos.length - 1)

  function mover(e: PointerEvent<SVGRectElement>) {
    const caixa = e.currentTarget.ownerSVGElement!.getBoundingClientRect()
    const px = ((e.clientX - caixa.left) / caixa.width) * L
    const i = Math.round(((px - esq) / (L - esq - dir)) * (pontos.length - 1))
    setAtivo(Math.min(visiveis.length - 1, Math.max(0, i)))
  }

  const p = ativo !== null ? visiveis[ativo] : null
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${L} ${A}`} className="h-auto w-full" role="img"
        aria-label={`Despesa acumulada no mês: ${visiveis.length ? formatBRL(visiveis[visiveis.length - 1].acumulado) : 'R$ 0,00'} até ${formatDate(ate)}`}>
        <defs>
          <linearGradient id="area-acumulada" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={COR_LINHA} stopOpacity="0.18" />
            <stop offset="1" stopColor={COR_LINHA} stopOpacity="0" />
          </linearGradient>
        </defs>
        {linhasGrade.map((v) => (
          <g key={v}>
            <line x1={esq} x2={L - dir} y1={y(v)} y2={y(v)} stroke="#e2e8f0" strokeWidth="1" />
            <text x={esq - 8} y={y(v) + 4} textAnchor="end" fontSize="11" className="fill-slate-500">{brlCompacto(v)}</text>
          </g>
        ))}
        {marcasX.map(({ p: m, i }) => (
          <text key={m.dia} x={x(i)} y={A - 8} textAnchor="middle" fontSize="11" className="fill-slate-500">{Number(m.dia.slice(8))}</text>
        ))}
        {area && <path d={area} fill="url(#area-acumulada)" />}
        {caminho && <path d={caminho} fill="none" stroke={COR_LINHA} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />}
        {p && ativo !== null && (
          <g>
            <line x1={x(ativo)} x2={x(ativo)} y1={topo} y2={y(0)} stroke="#94a3b8" strokeWidth="1" strokeDasharray="3 3" />
            <circle cx={x(ativo)} cy={y(p.acumulado)} r="5" fill={COR_LINHA} stroke="#fff" strokeWidth="2" />
          </g>
        )}
        <rect x={esq} y={topo} width={L - esq - dir} height={A - topo - base} fill="transparent"
          onPointerMove={mover} onPointerDown={mover} onPointerLeave={() => setAtivo(null)} />
      </svg>
      {p && ativo !== null && (
        <div role="status" className="pointer-events-none absolute top-0 rounded-lg bg-white px-3 py-2 text-xs shadow-card ring-1 ring-slate-200"
          style={{ left: `${Math.min(70, Math.max(2, (x(ativo) / L) * 100 - 10))}%` }}>
          <p className="font-semibold text-marinho">{formatDate(p.dia)}</p>
          <p className="tabular-nums text-slate-600">No dia: {formatBRL(p.valor)}</p>
          <p className="tabular-nums text-slate-600">Acumulado: <strong className="text-marinho">{formatBRL(p.acumulado)}</strong></p>
        </div>
      )}
    </div>
  )
}
