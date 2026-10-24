import { useState } from 'react'
import { formatBRL } from '../../lib/format'
import type { Cents } from '../../lib/format'
import { CORES_CATEGORIAS, COR_OUTROS } from './cores'

export interface FatiaRosca {
  chave: string
  nome: string
  valor: Cents
  percentual: number
  outros?: boolean
}

/** Rosca de partes de um todo. Totais e % vêm prontos do banco; aqui só desenha. */
export function Rosca({ fatias, total, rotuloTotal = 'Total' }: { fatias: FatiaRosca[]; total: Cents; rotuloTotal?: string }) {
  const [ativa, setAtiva] = useState<number | null>(null)
  const r = 70
  const circ = 2 * Math.PI * r
  const lacuna = fatias.length > 1 ? 2 : 0 // 2px de fundo entre as fatias
  const cor = (i: number) => (fatias[i].outros ? COR_OUTROS : CORES_CATEGORIAS[i % CORES_CATEGORIAS.length])
  let inicio = 0
  const arcos = fatias.map((f, i) => {
    const tam = Math.max(0, (f.percentual / 100) * circ)
    const arco = { i, inicio, tam: Math.max(0, tam - lacuna) }
    inicio += tam
    return arco
  })
  const destaque = ativa !== null ? fatias[ativa] : null

  return (
    <div className="flex flex-col items-center gap-4 2xl:flex-row">
      <svg viewBox="0 0 200 200" className="h-40 w-40 shrink-0" role="img"
        aria-label={`Despesas por categoria: ${fatias.map((f) => `${f.nome} ${f.percentual.toLocaleString('pt-BR')}%`).join(', ')}`}>
        <circle cx="100" cy="100" r={r} fill="none" stroke="#eef2f7" strokeWidth="26" />
        {arcos.map(({ i, inicio: ini, tam }) => (
          <circle key={fatias[i].chave} cx="100" cy="100" r={r} fill="none" stroke={cor(i)}
            strokeWidth={ativa === i ? 30 : 26} strokeDasharray={`${tam} ${circ - tam}`} strokeDashoffset={-ini}
            transform="rotate(-90 100 100)" className="cursor-pointer transition-[stroke-width]"
            onMouseEnter={() => setAtiva(i)} onMouseLeave={() => setAtiva(null)} onClick={() => setAtiva(ativa === i ? null : i)} />
        ))}
        <text x="100" y="94" textAnchor="middle" className="fill-slate-500" fontSize="11">{destaque ? destaque.nome : rotuloTotal}</text>
        <text x="100" y="114" textAnchor="middle" className="fill-marinho tabular-nums" fontSize="16" fontWeight="700">
          {formatBRL(destaque ? destaque.valor : total)}
        </text>
        {destaque && <text x="100" y="131" textAnchor="middle" className="fill-slate-500" fontSize="11">{destaque.percentual.toLocaleString('pt-BR')}%</text>}
      </svg>
      <ul className="w-full flex-1 space-y-1 text-sm">
        {fatias.map((f, i) => (
          <li key={f.chave}>
            <button type="button" onMouseEnter={() => setAtiva(i)} onMouseLeave={() => setAtiva(null)} onFocus={() => setAtiva(i)} onBlur={() => setAtiva(null)}
              className={`flex min-h-9 w-full flex-wrap items-center gap-x-2 rounded-lg px-2 text-left ${ativa === i ? 'bg-azul-claro' : ''}`}>
              <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: cor(i) }} aria-hidden="true" />
              <span className="min-w-[7.5rem] flex-1 whitespace-nowrap py-1 text-slate-700">{f.nome}</span>
              <span className="ml-auto flex items-center gap-2">
                <span className="tabular-nums font-semibold text-marinho">{formatBRL(f.valor)}</span>
                <span className="w-12 text-right tabular-nums text-slate-500">{f.percentual.toLocaleString('pt-BR')}%</span>
              </span>
              </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
