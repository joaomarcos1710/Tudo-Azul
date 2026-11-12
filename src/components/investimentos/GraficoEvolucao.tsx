import { useState } from 'react'
import type { PointerEvent } from 'react'
import type { Cents } from '../../lib/format'
import type { MoedaInvestimento, PontoEvolucao } from '../../lib/investimentos'
import { Card } from '../ui/Card'
import { COR_CONTORNO, COR_EIXO, COR_GRADE, COR_LINHA, COR_TEXTO_EIXO } from '../graficos/cores'
import { topoRedondo } from '../graficos/LinhaAcumulada'

const mesCurto = (mes: string) => new Intl.DateTimeFormat('pt-BR', { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(new Date(`${mes}T12:00:00Z`))
const mesLongo = (mes: string) => new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${mes}T12:00:00Z`))

/**
 * Evolução da carteira numa moeda (etapa 3 do redesenho de Investimentos): duas linhas, o valor atual (azul, cheia) e o
 * aportado (cinza, tracejada), mês a mês. O aportado é o aporte líquido (o que o dono pôs menos o que tirou, igual ao resumo; migration 114);
 * em banco sem ela, é o custo do que ainda está investido, e uma nota avisa. A diferença entre as duas é o rendimento, que o leitor vê no espaço entre as linhas;
 * a tela NÃO subtrai nem soma nada (os dois números vêm de investment_history, no banco). Legenda sempre visível (a cor não é a
 * única pista: o aportado é tracejado), cursor com tooltip no toque e no mouse, e a tabela dos mesmos pontos logo abaixo.
 */
export function GraficoEvolucao({ moedaCodigo, pontos, formatar }: {
  moedaCodigo: MoedaInvestimento
  pontos: PontoEvolucao[]
  formatar: (c: Cents, moeda: MoedaInvestimento) => string
}) {
  const [ativo, setAtivo] = useState<number | null>(null)
  const L = 640, A = 220, esq = 64, dir = 14, topo = 14, base = 30
  const fmt = (v: number) => formatar(v as Cents, moedaCodigo)
  const max = topoRedondo(Math.max(0, ...pontos.map((p) => Math.max(p.valorAtual, p.aportado))))
  const x = (i: number) => esq + (pontos.length <= 1 ? 0 : (i / (pontos.length - 1)) * (L - esq - dir))
  const y = (v: number) => topo + (1 - Math.max(0, v) / max) * (A - topo - base)
  const trilha = (f: (p: PontoEvolucao) => number) => pontos.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(f(p)).toFixed(1)}`).join(' ')
  const ultimo = pontos[pontos.length - 1]
  const aportadoLiquido = pontos.every((q) => q.aportadoLiquido)

  function mover(e: PointerEvent<SVGRectElement>) {
    const caixa = e.currentTarget.ownerSVGElement!.getBoundingClientRect()
    const px = ((e.clientX - caixa.left) / caixa.width) * L
    const i = Math.round(((px - esq) / (L - esq - dir)) * (pontos.length - 1))
    setAtivo(Math.min(pontos.length - 1, Math.max(0, i)))
  }
  const p = ativo !== null ? pontos[ativo] : null

  return (
    <Card>
      <h3 className="mb-1 font-semibold">Evolução em {moedaCodigo}</h3>
      <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600" aria-label="Legenda">
        <li className="flex items-center gap-1.5">
          <svg width="22" height="8" aria-hidden="true"><line x1="0" x2="22" y1="4" y2="4" stroke={COR_LINHA} strokeWidth="3" strokeLinecap="round" /></svg>
          Valor atual
        </li>
        <li className="flex items-center gap-1.5">
          <svg width="22" height="8" aria-hidden="true"><line x1="0" x2="22" y1="4" y2="4" stroke={COR_TEXTO_EIXO} strokeWidth="2" strokeDasharray="4 3" /></svg>
          Aportado
        </li>
      </ul>
      {!aportadoLiquido && (
        <p className="mb-2 text-xs text-slate-500">Aportado, aqui, é o custo do que ainda está investido: ele cai a cada resgate.</p>
      )}
      <div className="relative">
        <svg viewBox={`0 0 ${L} ${A}`} className="h-auto w-full" role="img"
          aria-label={`Evolução da carteira em ${moedaCodigo}: valor atual ${ultimo ? fmt(ultimo.valorAtual) : '—'}, aportado ${ultimo ? fmt(ultimo.aportado) : '—'}`}>
          {[0, 0.5, 1].map((f) => (
            <g key={f}>
              <line x1={esq} x2={L - dir} y1={y(max * f)} y2={y(max * f)} stroke={COR_GRADE} strokeWidth="1" />
              <text x={esq - 7} y={y(max * f) + 4} textAnchor="end" fontSize="10" fill={COR_TEXTO_EIXO}>{fmt(max * f)}</text>
            </g>
          ))}
          <path d={trilha((q) => q.aportado)} fill="none" stroke={COR_TEXTO_EIXO} strokeWidth="2" strokeDasharray="5 4" strokeLinecap="round" strokeLinejoin="round" />
          <path d={trilha((q) => q.valorAtual)} fill="none" stroke={COR_LINHA} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          {pontos.map((q, i) => (i === 0 || i === pontos.length - 1 || i % 3 === 0) && (
            // o último rótulo termina na borda do gráfico: centrado no último ponto ele passava do SVG e era cortado (conferido a 400 px)
            <text key={q.mes} x={x(i)} y={A - 8} textAnchor={i === pontos.length - 1 && i > 0 ? 'end' : 'middle'} fontSize="10" fill={COR_TEXTO_EIXO}>{mesCurto(q.mes)}</text>
          ))}
          {ultimo && <circle cx={x(pontos.length - 1)} cy={y(ultimo.valorAtual)} r="4" fill={COR_LINHA} stroke={COR_CONTORNO} strokeWidth="2" />}
          {p && ativo !== null && (
            <g>
              <line x1={x(ativo)} x2={x(ativo)} y1={topo} y2={y(0)} stroke={COR_EIXO} strokeWidth="1" strokeDasharray="3 3" />
              <circle cx={x(ativo)} cy={y(p.aportado)} r="4" fill={COR_TEXTO_EIXO} stroke={COR_CONTORNO} strokeWidth="2" />
              <circle cx={x(ativo)} cy={y(p.valorAtual)} r="5" fill={COR_LINHA} stroke={COR_CONTORNO} strokeWidth="2" />
            </g>
          )}
          <rect data-testid="area-evolucao" x={esq} y={topo} width={L - esq - dir} height={A - topo - base} fill="transparent"
            onPointerMove={mover} onPointerDown={mover} onPointerLeave={() => setAtivo(null)} />
        </svg>
        {p && ativo !== null && (
          <div role="status" className="pointer-events-none absolute top-0 rounded-lg bg-white px-3 py-2 text-xs shadow-card ring-1 ring-slate-200"
            style={{ left: `${Math.min(62, Math.max(2, (x(ativo) / L) * 100 - 10))}%` }}>
            <p className="font-semibold capitalize text-marinho">{mesLongo(p.mes)}</p>
            <p className="tabular-nums text-slate-600">Valor atual: <strong className="text-marinho">{fmt(p.valorAtual)}</strong></p>
            <p className="tabular-nums text-slate-600">Aportado: <strong className="text-marinho">{fmt(p.aportado)}</strong></p>
          </div>
        )}
      </div>
      {ultimo && (
        <p className="mt-1 text-xs text-slate-500">
          Último mês: valor atual <strong>{fmt(ultimo.valorAtual)}</strong> · aportado <strong>{fmt(ultimo.aportado)}</strong>
        </p>
      )}
      <details className="mt-2 text-sm">
        <summary className="flex min-h-11 cursor-pointer items-center font-semibold text-azul">Ver como tabela</summary>
        <table className="w-full text-left text-xs">
          <caption className="sr-only">Valor atual e aportado por mês em {moedaCodigo}</caption>
          <thead>
            <tr className="border-b border-slate-200 text-slate-500">
              <th scope="col" className="py-1 font-medium">Mês</th>
              <th scope="col" className="py-1 text-right font-medium">Valor atual</th>
              <th scope="col" className="py-1 text-right font-medium">Aportado</th>
            </tr>
          </thead>
          <tbody>
            {pontos.map((q) => (
              <tr key={q.mes} className="border-b border-slate-100">
                <th scope="row" className="py-1 font-normal capitalize">{mesCurto(q.mes)}</th>
                <td className="py-1 text-right tabular-nums">{fmt(q.valorAtual)}</td>
                <td className="py-1 text-right tabular-nums">{fmt(q.aportado)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </Card>
  )
}
