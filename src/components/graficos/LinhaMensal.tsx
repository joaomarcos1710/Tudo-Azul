import { useState } from 'react'
import type { PointerEvent } from 'react'
import { formatBRL, formatMonth } from '../../lib/format'
import type { Cents } from '../../lib/format'
import { COR_LINHA } from './cores'
import { useLargura } from './useLargura'
import { brlCompacto } from './LinhaAcumulada'
import { valoresOcultos } from '../../lib/privacidade'

export interface PontoMensal {
  mes: string
  valor: Cents
  /** Rótulo curto do eixo ("dez/25", "05/10"). Sem ele: as 3 letras do mês. */
  rotulo?: string
  /** Nome por extenso no tooltip. Sem ele: "dezembro de 2025". */
  rotuloLongo?: string
}

/** Passo "redondo" (1, 2, 2,5 ou 5 × 10^n) para dividir a faixa em ~2 partes. */
function passo(faixa: number): number {
  const bruto = faixa / 2 || 100
  const pot = 10 ** Math.floor(Math.log10(bruto))
  for (const m of [1, 2, 2.5, 5, 10]) if (m * pot >= bruto) return m * pot
  return 10 * pot
}

/**
 * Faixa do eixo: segue os valores (numa linha o que importa é a variação; começar no zero achataria o patrimônio),
 * arredondada para fora; inclui o zero quando a série cruza ou encosta nele.
 */
export function faixaDoEixo(valores: number[]): { min: number; max: number; marcas: number[] } {
  let lo = Math.min(...valores), hi = Math.max(...valores)
  if (lo < 0 && hi < 0) hi = 0
  if (lo === hi) { lo -= Math.abs(lo) * 0.1 || 1000; hi += Math.abs(hi) * 0.1 || 1000 }
  const p = passo(hi - lo)
  const min = Math.floor(lo / p) * p, max = Math.ceil(hi / p) * p
  const marcas: number[] = []
  for (let v = min; v <= max + p / 2; v += p) marcas.push(Math.round(v) || 0)
  return { min, max, marcas }
}

const mesCurto = (mes: string) => formatMonth(mes).slice(0, 3)

/**
 * Uma série por mês (linha de 2px, marcadores de 8px, cursor e tooltip). Aceita valores negativos: a linha do zero
 * aparece quando a série cruza o zero. Os valores vêm prontos do banco; aqui só se desenha.
 */
export function LinhaMensal({ titulo, pontos, cor = COR_LINHA, tabelaAbaixo = false }: {
  titulo: string
  pontos: PontoMensal[]
  /** Cor da série (validada em cores.ts). */
  cor?: string
  /** A tela já mostra os valores numa tabela logo abaixo: sem o "Ver tabela" e com o último valor escrito na ponta da linha. */
  tabelaAbaixo?: boolean
}) {
  const [ativo, setAtivo] = useState<number | null>(null)
  const [caixa, L] = useLargura<HTMLDivElement>()
  const A = 200, esq = 96, dir = 24, topo = 14, base = 28
  const { min, max, marcas } = faixaDoEixo(pontos.map((p) => p.valor as number))
  const faixa = max - min || 1
  const x = (i: number) => esq + (pontos.length <= 1 ? (L - esq - dir) / 2 : (i / (pontos.length - 1)) * (L - esq - dir))
  const y = (v: number) => topo + ((max - v) / faixa) * (A - topo - base)
  const caminho = pontos.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.valor).toFixed(1)}`).join(' ')

  function mover(e: PointerEvent<SVGRectElement>) {
    const caixa = e.currentTarget.ownerSVGElement!.getBoundingClientRect()
    const px = ((e.clientX - caixa.left) / caixa.width) * L
    const i = Math.round(((px - esq) / (L - esq - dir)) * (pontos.length - 1))
    setAtivo(Math.min(pontos.length - 1, Math.max(0, i)))
  }

  const p = ativo !== null ? pontos[ativo] : null
  const ultimo = pontos[pontos.length - 1]
  const longo = (m: PontoMensal) => m.rotuloLongo ?? formatMonth(m.mes)
  const curto = (m: PontoMensal) => m.rotulo ?? mesCurto(m.mes)
  // rótulos do eixo com pelo menos ~48px entre si (cabe "dez/25"), sempre terminando no último ponto
  const salto = Math.max(1, Math.ceil(48 / ((L - esq - dir) / Math.max(1, pontos.length - 1))))
  return (
    <div className="relative" ref={caixa}>
      <svg viewBox={`0 0 ${L} ${A}`} className="h-auto w-full" role="img"
        aria-label={`${titulo}: ${ultimo ? `${formatBRL(ultimo.valor)} em ${longo(ultimo)}` : 'sem dados'}. Os valores de cada período estão na tabela abaixo.`}>
        {marcas.map((v) => (
          <g key={v}>
            <line x1={esq} x2={L - dir} y1={y(v)} y2={y(v)} stroke={v === 0 ? '#94a3b8' : '#e2e8f0'} strokeWidth="1" />
            <text x={esq - 8} y={y(v) + 4} textAnchor="end" fontSize="13" className="fill-slate-500">{brlCompacto(v)}</text>
          </g>
        ))}
        {pontos.map((m, i) => (pontos.length - 1 - i) % salto === 0 && (
          <text key={m.mes} x={x(i)} y={A - 8} textAnchor="middle" fontSize="13" className="fill-slate-500">{curto(m)}</text>
        ))}
        {caminho && <path d={caminho} fill="none" stroke={cor} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />}
        {pontos.map((m, i) => (
          <circle key={m.mes} cx={x(i)} cy={y(m.valor)} r={ativo === i ? 5 : 4} fill={cor} stroke="#fff" strokeWidth="2" />
        ))}
        {tabelaAbaixo && ultimo && pontos.length <= 12 && (
          // rótulo direto só no último ponto (o valor que importa); os demais ficam no tooltip e na tabela.
          // Com muitos pontos (dias) a linha é densa demais para o rótulo não encostar nela: fica só a tabela
          <text x={x(pontos.length - 1) - 8} y={y(ultimo.valor) + (pontos.length > 1 && pontos[pontos.length - 2].valor > ultimo.valor ? 20 : -10)} textAnchor="end" fontSize="13" fontWeight="600"
            className={ultimo.valor < 0 ? 'fill-negativo' : 'fill-marinho'}>{ultimo.valor < 0 && !valoresOcultos() ? `−${brlCompacto(-ultimo.valor)}` : brlCompacto(ultimo.valor)}</text>
        )}
        {p && ativo !== null && <line x1={x(ativo)} x2={x(ativo)} y1={topo} y2={A - base} stroke="#94a3b8" strokeWidth="1" strokeDasharray="3 3" />}
        <rect x={esq} y={topo} width={L - esq - dir} height={A - topo - base} fill="transparent"
          onPointerMove={mover} onPointerDown={mover} onPointerLeave={() => setAtivo(null)} />
      </svg>
      {p && ativo !== null && (
        <div role="status" className="pointer-events-none absolute top-0 rounded-lg bg-white px-3 py-2 text-xs shadow-card ring-1 ring-slate-200"
          style={{ left: `${Math.min(70, Math.max(2, (x(ativo) / L) * 100 - 10))}%` }}>
          <p className="font-semibold text-marinho">{longo(p)}</p>
          <p className="whitespace-nowrap tabular-nums text-slate-700">{formatBRL(p.valor)}</p>
        </div>
      )}
      {!tabelaAbaixo && <details className="mt-2 text-sm">
        <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold text-azul">Ver tabela</summary>
        <table className="mt-1 w-full text-left">
          <thead><tr className="text-xs text-slate-500"><th className="py-1 font-medium">Mês</th><th className="py-1 text-right font-medium">{titulo}</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {pontos.map((m) => (
              <tr key={m.mes}><td className="py-1">{formatMonth(m.mes)}</td>
                <td className={`py-1 text-right tabular-nums ${m.valor < 0 ? 'text-negativo' : ''}`}>{formatBRL(m.valor)}</td></tr>
            ))}
          </tbody>
        </table>
      </details>}
    </div>
  )
}
