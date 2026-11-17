import { useState } from 'react'
import type { PointerEvent } from 'react'
import { formatBRL, formatMonth } from '../../lib/format'
import type { Cents } from '../../lib/format'
import { COR_CONTORNO, COR_EIXO, COR_GRADE } from './cores'
import { useLargura } from './useLargura'
import { brlCompacto } from './LinhaAcumulada'
import { faixaDoEixo } from './LinhaMensal'

export interface SerieMensal {
  id: string
  nome: string
  /** Cor da série (validada em cores.ts; ordem fixa, nunca pelo ranking). */
  cor: string
  /** Um valor por mês de `meses`; null = sem dado naquele mês (vazio no gráfico, nunca zero). */
  valores: (Cents | null)[]
}

const mesCurto = (mes: string) => formatMonth(mes).slice(0, 3)

/**
 * Várias séries mês a mês num eixo só (todas em reais): linhas de 2px, marcadores de 8px, legenda, nome na ponta de cada
 * linha (até 4 séries), cursor com o valor de cada série e a tabela. Mês sem dado fica vazio: a linha se interrompe.
 * Os valores vêm prontos do banco; aqui só se desenha.
 */
export function LinhasMensais({ titulo, meses, series }: { titulo: string; meses: string[]; series: SerieMensal[] }) {
  const [ativo, setAtivo] = useState<number | null>(null)
  const [caixa, L] = useLargura<HTMLDivElement>()
  const A = 220, esq = 88, dir = 16, topo = 16, base = 28
  const todos = series.flatMap((s) => s.valores.filter((v): v is Cents => v !== null)) as number[]
  if (todos.length === 0 || meses.length === 0) return null
  const { min, max, marcas } = faixaDoEixo(todos)
  const faixa = max - min || 1
  const n = meses.length
  const x = (i: number) => esq + (n <= 1 ? (L - esq - dir) / 2 : (i / (n - 1)) * (L - esq - dir))
  const y = (v: number) => topo + ((max - v) / faixa) * (A - topo - base)
  // um trecho por sequência de meses com dado: o vazio interrompe a linha
  const caminho = (vals: (Cents | null)[]) => {
    let d = '', aberto = false
    vals.forEach((v, i) => {
      if (v === null) { aberto = false; return }
      d += `${aberto ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)} `
      aberto = true
    })
    return d.trim()
  }
  // nome na ponta (último mês com dado), afastando os rótulos que ficariam um em cima do outro
  const rotulos = series.length <= 4 ? series.map((s) => {
    const i = s.valores.map((v) => v !== null).lastIndexOf(true)
    return i < 0 ? null : { id: s.id, nome: s.nome, i, yv: y(s.valores[i] as number) - 10 }
  }).filter((r): r is { id: string; nome: string; i: number; yv: number } => r !== null).sort((a, b) => a.yv - b.yv) : []
  for (let k = 1; k < rotulos.length; k++) if (rotulos[k].yv - rotulos[k - 1].yv < 15) rotulos[k].yv = rotulos[k - 1].yv + 15

  function mover(e: PointerEvent<SVGRectElement>) {
    const r = e.currentTarget.ownerSVGElement!.getBoundingClientRect()
    const px = ((e.clientX - r.left) / r.width) * L
    const i = Math.round(((px - esq) / (L - esq - dir)) * (n - 1))
    setAtivo(Math.min(n - 1, Math.max(0, i)))
  }
  const salto = Math.max(1, Math.ceil(48 / ((L - esq - dir) / Math.max(1, n - 1))))
  const resumo = series.map((s) => {
    const i = s.valores.map((v) => v !== null).lastIndexOf(true)
    return i < 0 ? `${s.nome}: sem dados` : `${s.nome}: ${formatBRL(s.valores[i] as Cents)} em ${formatMonth(meses[i])}`
  }).join('; ')

  return (
    <div className="relative" ref={caixa}>
      <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600" aria-label={`Legenda: ${titulo}`}>
        {series.map((s) => (
          <li key={s.id} className="flex items-center gap-1.5">
            <svg width="16" height="8" aria-hidden="true"><line x1="0" x2="16" y1="4" y2="4" stroke={s.cor} strokeWidth="2" strokeLinecap="round" /></svg>
            {s.nome}
          </li>
        ))}
      </ul>
      <svg viewBox={`0 0 ${L} ${A}`} className="h-auto w-full" role="img"
        aria-label={`${titulo}. ${resumo}. Os valores de cada mês estão na tabela abaixo.`}>
        {marcas.map((v) => (
          <g key={v}>
            <line x1={esq} x2={L - dir} y1={y(v)} y2={y(v)} stroke={v === 0 ? COR_EIXO : COR_GRADE} strokeWidth="1" />
            <text x={esq - 8} y={y(v) + 4} textAnchor="end" fontSize="13" className="fill-slate-500">{brlCompacto(v)}</text>
          </g>
        ))}
        {meses.map((m, i) => (n - 1 - i) % salto === 0 && (
          <text key={m} x={x(i)} y={A - 8} textAnchor="middle" fontSize="13" className="fill-slate-500">{mesCurto(m)}</text>
        ))}
        {series.map((s) => (
          <path key={s.id} d={caminho(s.valores)} fill="none" stroke={s.cor} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {series.map((s) => s.valores.map((v, i) => v !== null && (
          <circle key={`${s.id}-${i}`} cx={x(i)} cy={y(v)} r={ativo === i ? 5 : 4} fill={s.cor} stroke={COR_CONTORNO} strokeWidth="2" />
        )))}
        {rotulos.map((r) => (
          <text key={r.id} x={x(r.i) - 8} y={r.yv} textAnchor="end" fontSize="13" fontWeight="600" className="fill-marinho">{r.nome}</text>
        ))}
        {ativo !== null && <line x1={x(ativo)} x2={x(ativo)} y1={topo} y2={A - base} stroke={COR_EIXO} strokeWidth="1" strokeDasharray="3 3" />}
        <rect x={esq} y={topo} width={L - esq - dir} height={A - topo - base} fill="transparent"
          onPointerMove={mover} onPointerDown={mover} onPointerLeave={() => setAtivo(null)} />
      </svg>
      {ativo !== null && (
        <div role="status" className="pointer-events-none absolute top-6 rounded-lg bg-white px-3 py-2 text-xs shadow-card ring-1 ring-slate-200"
          style={{ left: `${Math.min(62, Math.max(2, (x(ativo) / L) * 100 - 12))}%` }}>
          <p className="font-semibold text-marinho">{formatMonth(meses[ativo])}</p>
          {series.map((s) => (
            <p key={s.id} className="flex items-center gap-1.5 whitespace-nowrap text-slate-700">
              <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: s.cor }} aria-hidden="true" />
              {s.nome}: <span className="tabular-nums">{s.valores[ativo] === null ? 'sem dado' : formatBRL(s.valores[ativo] as Cents)}</span>
            </p>
          ))}
        </div>
      )}
      <details className="mt-2 text-sm">
        <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold text-azul">Ver tabela</summary>
        <div className="overflow-x-auto">
          <table className="mt-1 w-full text-left">
            <thead><tr className="text-xs text-slate-500"><th className="py-1 font-medium">Mês</th>
              {series.map((s) => <th key={s.id} className="py-1 text-right font-medium">{s.nome}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">
              {meses.map((m, i) => (
                <tr key={m}><td className="py-1">{formatMonth(m)}</td>
                  {series.map((s) => <td key={s.id} className="py-1 text-right tabular-nums">{s.valores[i] === null ? '—' : formatBRL(s.valores[i] as Cents)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}
