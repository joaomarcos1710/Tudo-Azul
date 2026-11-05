import { useState } from 'react'
import { formatBRL, formatMonth, primeiraMaiuscula } from '../../lib/format'
import type { Cents } from '../../lib/format'
import { MASCARA, valoresOcultos } from '../../lib/privacidade'
import { COR_DESPESA, COR_EIXO, COR_FOCO, COR_FOCO_SOBRE_AREA, COR_GRADE, COR_RECEITA, COR_SALDO_AREA, COR_SALDO_BORDA } from './cores'
import { useLargura } from './useLargura'
import { brlCompacto, topoRedondo } from './LinhaAcumulada'

export interface MesBalanco {
  /** AAAA-MM */
  mes: string
  receitas: Cents
  despesas: Cents
  /** Receitas − despesas do mês, calculado no banco (cash_flow_report.balance). */
  resultado: Cents
  /** Rótulo curto do eixo (ex.: "dez/25", "05/10"). Sem ele: as 3 letras do mês. */
  rotulo?: string
  /** Nome por extenso no tooltip e no leitor de tela. Sem ele: "Dezembro de 2025". */
  rotuloLongo?: string
}

/** Nomes das duas séries e do período (Início: Receitas/Despesas por mês; Relatórios: Entradas/Saídas por dia, semana ou mês). */
export interface TermosBalanco {
  entradas: string
  saidas: string
  /** "mês", "dia", "semana": só aparece na legenda do resultado. */
  periodo: string
}
const TERMOS_PADRAO: TermosBalanco = { entradas: 'Receitas', saidas: 'Despesas', periodo: 'mês' }

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
export function BalancoMensal({ meses, termos = TERMOS_PADRAO, tabelaAbaixo = false, cores, saldo }: {
  meses: MesBalanco[]
  termos?: TermosBalanco
  /** A tela já mostra a tabela logo abaixo do gráfico: não repete o "Ver como tabela". */
  tabelaAbaixo?: boolean
  /** Cores das barras (Relatórios: entrada azul, saída vermelha, #179). Sem elas: a paleta do Início. */
  cores?: { entradas: string; saidas: string }
  /**
   * Saldo das contas no fim de cada período, como área clara ao fundo (Relatórios, #179, como no Organizze). Tem escala
   * própria, sem eixo (o eixo é o das barras): o valor está no toque/tooltip e na tabela logo abaixo.
   */
  saldo?: { valores: Cents[]; rotulo: string }
}) {
  const [ativo, setAtivo] = useState<number | null>(null)
  const [caixa, L] = useLargura<HTMLDivElement>()
  const A = 240, esq = 64, dir = 12, topo = 30, base = 28
  const max = topoRedondo(Math.max(0, ...meses.flatMap((m) => [m.receitas as number, m.despesas as number])))
  const largGrupo = (L - esq - dir) / Math.max(1, meses.length)
  const larg = Math.min(24, Math.floor(largGrupo * 0.3))
  const y = (v: number) => topo + (1 - Math.max(0, v) / max) * (A - topo - base)
  const centro = (i: number) => esq + largGrupo * i + largGrupo / 2
  const grade = [0, 0.5, 1].map((f) => f * max)
  const m = ativo !== null ? meses[ativo] : null
  // o resultado em texto acima de cada par só cabe com coluna larga (6 meses); com 12 meses, semanas ou dias, fica no
  // tooltip e na tabela (senão os rótulos se encavalam). Os rótulos do eixo pulam (de 2 em 2, de 3 em 3) quando não cabem todos.
  const resultadoVisivel = largGrupo >= 72
  const saltoEixo = Math.max(1, Math.ceil(46 / largGrupo))
  const longo = (x: MesBalanco) => x.rotuloLongo ?? primeiraMaiuscula(formatMonth(x.mes))
  const { entradas, saidas, periodo } = termos
  const corEntradas = cores?.entradas ?? COR_RECEITA, corSaidas = cores?.saidas ?? COR_DESPESA
  // área do saldo: escala própria entre o menor e o maior valor (com o zero dentro); só com 2 ou mais pontos
  const valoresSaldo = saldo && saldo.valores.length === meses.length && meses.length > 1 ? saldo.valores : null
  const sMin = Math.min(0, ...(valoresSaldo ?? [0])), sMax = Math.max(0, ...(valoresSaldo ?? [0]))
  const ys = (v: number) => topo + ((sMax - v) / (sMax - sMin || 1)) * (A - topo - base)
  const areaSaldo = valoresSaldo && sMax !== sMin
    ? `M${centro(0)},${ys(0)} ${valoresSaldo.map((v, i) => `L${centro(i)},${ys(v)}`).join(' ')} L${centro(valoresSaldo.length - 1)},${ys(0)} Z`
    : ''

  return (
    <div>
      <p className="mb-2 flex flex-wrap gap-4 text-xs text-slate-600" aria-hidden="true">
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm" style={{ background: corEntradas }} />{entradas}</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm" style={{ background: corSaidas }} />{saidas}</span>
        {areaSaldo && <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm border" style={{ background: COR_SALDO_AREA, borderColor: COR_SALDO_BORDA }} />{saldo!.rotulo}</span>}
        <span className="inline-flex items-center gap-1.5"><span className="font-semibold text-marinho">±</span>{resultadoVisivel ? `Resultado de cada ${periodo}, acima do par` : 'Toque numa barra para ver o resultado'}</span>
      </p>
      <div className="relative" ref={caixa}>
        <svg viewBox={`0 0 ${L} ${A}`} className="h-auto w-full" role="group"
          aria-label={`${entradas} e ${saidas.toLowerCase()} de cada ${periodo}, com o resultado. Os valores também estão na tabela abaixo.`}>
          {grade.map((v) => (
            <g key={v} aria-hidden="true">
              <line x1={esq} x2={L - dir} y1={y(v)} y2={y(v)} stroke={v === 0 ? COR_EIXO : COR_GRADE} strokeWidth="1" />
              <text x={esq - 8} y={y(v) + 4} textAnchor="end" fontSize="12" className="fill-slate-500">{brlCompacto(v)}</text>
            </g>
          ))}
          {areaSaldo && (
            <path d={areaSaldo} fill={COR_SALDO_AREA} stroke={COR_SALDO_BORDA} strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true" data-testid="area-saldo" />
          )}
          {meses.map((x, i) => {
            const c = centro(i)
            const xr = c - larg - 1, xd = c + 1 // 2px de fundo entre as duas barras do par
            const topoPar = y(Math.max(x.receitas, x.despesas))
            const rotulo = `${longo(x)}: ${entradas.toLowerCase()} ${formatBRL(x.receitas)}, ${saidas.toLowerCase()} ${formatBRL(x.despesas)}, resultado ${formatBRL(x.resultado)}`
              + (valoresSaldo ? `, ${saldo!.rotulo.toLowerCase()} ${formatBRL(valoresSaldo[i])}` : '')
            return (
              <g key={x.mes} tabIndex={0} role="img" aria-label={rotulo} data-testid="par-balanco"
                onPointerEnter={() => setAtivo(i)} onPointerLeave={() => setAtivo(null)} onPointerDown={() => setAtivo(i)}
                onFocus={() => setAtivo(i)} onBlur={() => setAtivo(null)} className="cursor-default outline-none">
                {/* alvo do toque/hover maior que as barras: a coluna inteira do mês */}
                <rect x={esq + largGrupo * i} y={topo - 24} width={largGrupo} height={A - topo - base + 24}
                  fill={ativo === i ? (areaSaldo ? COR_FOCO_SOBRE_AREA : COR_FOCO) : 'transparent'} rx="6" />
                <path d={barra(xr, y(x.receitas), larg, y(0) - y(x.receitas))} fill={corEntradas} />
                <path d={barra(xd, y(x.despesas), larg, y(0) - y(x.despesas))} fill={corSaidas} />
                {resultadoVisivel && (
                  <text x={c} y={topoPar - 8} textAnchor="middle" fontSize="12" fontWeight="600"
                    className={x.resultado < 0 ? 'fill-prejuizo' : 'fill-marinho'}>{resultadoCompacto(x.resultado)}</text>
                )}
                {(meses.length - 1 - i) % saltoEixo === 0 && (
                  <text x={c} y={A - 8} textAnchor="middle" fontSize="12" className="fill-slate-500">{x.rotulo ?? mesCurto(x.mes)}</text>
                )}
              </g>
            )
          })}
        </svg>
        {m && ativo !== null && (
          <div role="status" className="pointer-events-none absolute top-0 rounded-lg bg-white px-3 py-2 text-xs shadow-card ring-1 ring-slate-200"
            style={{ left: `${Math.min(68, Math.max(2, (centro(ativo) / L) * 100 - 14))}%` }}>
            <p className="font-semibold text-marinho">{longo(m)}</p>
            <p className="whitespace-nowrap tabular-nums text-slate-700">{entradas}: {formatBRL(m.receitas)}</p>
            <p className="whitespace-nowrap tabular-nums text-slate-700">{saidas}: {formatBRL(m.despesas)}</p>
            <p className={`whitespace-nowrap tabular-nums font-semibold ${m.resultado < 0 ? 'text-prejuizo' : 'text-marinho'}`}>Resultado: {formatBRL(m.resultado)}</p>
            {valoresSaldo && <p className={`whitespace-nowrap tabular-nums ${valoresSaldo[ativo] < 0 ? 'text-prejuizo' : 'text-slate-700'}`}>{saldo!.rotulo}: {formatBRL(valoresSaldo[ativo])}</p>}
          </div>
        )}
      </div>
      {!tabelaAbaixo && <details className="mt-2 text-sm">
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
                <td className={`py-1 text-right tabular-nums ${x.resultado < 0 ? 'text-prejuizo' : ''}`}>{formatBRL(x.resultado)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>}
    </div>
  )
}
