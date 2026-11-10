import { useState } from 'react'
import { GRAFICO } from '../../lib/cores'
import type { Cents } from '../../lib/format'
import { MACROS } from '../../lib/investimentos'
import type { LinhaAlocacao, LinhaLiquidez, PosicaoInvestimento } from '../../lib/investimentos'

type Aba = 'classe' | 'liquidez' | 'ativos'
interface Fatia { chave: string; nome: string; valor: Cents; percentual: number; detalhes?: { nome: string; valor: Cents; percentual: number }[] }

const R = 40
const VOLTA = 2 * Math.PI * R
/** 2px de folga entre fatias, como pedem as regras de gráfico. */
const FOLGA = 2
const pct = (v: number) => `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`

/**
 * "Minha carteira" (pedido do dono, 10/11/2026, a partir da tela da XP): rosca e lista com abas Classe, Liquidez e Ativos,
 * só em reais (as outras moedas ficam à parte, sem conversão). Valores vêm do banco; em Classe o % também vem do banco
 * (investment_allocation). Em Liquidez e Ativos o % é só valor ÷ valor de mercado total (do banco): apresentação, nenhum
 * dinheiro é somado aqui. Cores em ordem fixa (as 4 validadas da rosca do Início); a cor nunca é a única informação: a
 * lista ao lado leva nome, valor e %. Mais de 4 fatias (Ativos) mostra só a lista, sem rosca: inventar cor ou somar
 * "Outros" no front não vale.
 */
export function MinhaCarteira({ total, alocacao, liquidez, posicoes, formatar }: {
  total: Cents
  alocacao: LinhaAlocacao[]
  liquidez: LinhaLiquidez[]
  posicoes: PosicaoInvestimento[]
  formatar: (c: Cents) => string
}) {
  const [aba, setAba] = useState<Aba>('classe')
  const proporcao = (v: Cents) => (total > 0 ? (v * 100) / total : 0)

  const porAba: Record<Aba, Fatia[]> = {
    classe: alocacao.filter((l) => l.nivel === 'macro').map((m) => ({
      chave: m.macro, nome: MACROS.find((x) => x.chave === m.macro)?.rotulo ?? m.macro, valor: m.valor, percentual: m.percentual,
      detalhes: alocacao.filter((l) => l.nivel === 'subclass' && l.macro === m.macro)
        .map((s) => ({ nome: s.subclasse ?? 'Sem subclasse', valor: s.valor, percentual: s.percentual })),
    })),
    liquidez: liquidez.filter((l) => l.valor > 0).map((l) => ({
      chave: l.liquidez, nome: l.liquidez === 'restricted' ? 'Restrito (previdência, FGTS)' : 'Líquido', valor: l.valor, percentual: proporcao(l.valor),
    })),
    ativos: [...posicoes].sort((a, b) => b.valorAtual - a.valorAtual).map((p) => ({
      chave: p.assetId, nome: p.nome, valor: p.valorAtual, percentual: proporcao(p.valorAtual),
    })),
  }
  const fatias = porAba[aba]
  const comRosca = fatias.length > 0 && fatias.length <= GRAFICO.rosca.length
  const positivas = fatias.filter((f) => f.percentual > 0)
  const somaPct = positivas.reduce((a, f) => a + f.percentual, 0)
  let acumulado = 0
  const abas: [Aba, string][] = [['classe', 'Classe'], ['liquidez', 'Liquidez'], ['ativos', 'Ativos']]

  return (
    <section className="mt-6" aria-labelledby="titulo-minha-carteira">
      <h2 id="titulo-minha-carteira" className="mb-2 text-lg font-semibold">Minha carteira</h2>
      <div role="tablist" aria-label="Ver a carteira por" className="mb-3 flex gap-2 overflow-x-auto">
        {abas.map(([chave, rotulo]) => (
          <button key={chave} type="button" role="tab" aria-selected={aba === chave} onClick={() => setAba(chave)}
            className={`min-h-11 shrink-0 rounded-full px-4 text-sm font-semibold transition-colors ${aba === chave ? 'bg-marinho text-white' : 'bg-slate-100 text-slate-600 hover:bg-azul-claro'}`}>
            {rotulo}
          </button>
        ))}
      </div>
      <div role="tabpanel" aria-label={`Carteira por ${abas.find(([c]) => c === aba)?.[1].toLowerCase()}`}
        className="flex flex-col items-center gap-4 rounded-2xl bg-white p-4 shadow-card sm:flex-row sm:items-start">
        {comRosca && (
          <svg viewBox="0 0 100 100" className="h-36 w-36 shrink-0 -rotate-90" role="img"
            aria-label={`Carteira em reais por ${aba}: ${fatias.map((f) => `${f.nome} ${pct(f.percentual)}`).join(', ')}`}>
            {somaPct > 0 && positivas.map((f) => {
              const parte = (f.percentual / somaPct) * VOLTA
              const tamanho = positivas.length > 1 ? Math.max(parte - FOLGA, 0.5) : parte
              const inicio = acumulado
              acumulado += parte
              return <circle key={f.chave} data-fatia cx="50" cy="50" r={R} fill="none" strokeWidth="16"
                stroke={GRAFICO.rosca[fatias.indexOf(f)]} strokeDasharray={`${tamanho} ${VOLTA - tamanho}`} strokeDashoffset={-inicio} />
            })}
          </svg>
        )}
        {fatias.length === 0
          ? <p className="text-sm text-slate-500">Nada para mostrar ainda.</p>
          : (
            <ul className="w-full min-w-0 flex-1 divide-y divide-slate-100" aria-label={`Lista da carteira por ${aba}`}>
              {fatias.map((f, i) => (
                <li key={f.chave} className="py-2">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      {comRosca && <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-sm" style={{ background: GRAFICO.rosca[i] }} />}
                      <span className="truncate font-medium text-slate-800">{f.nome}</span>
                    </span>
                    <span className="shrink-0 whitespace-nowrap">
                      <span className="tabular-nums font-semibold text-marinho">{formatar(f.valor)}</span>
                      <span className="ml-2 inline-block w-12 text-right tabular-nums text-slate-500">{pct(f.percentual)}</span>
                    </span>
                  </div>
                  {f.detalhes && f.detalhes.length > 0 && (
                    <ul className="mt-1 border-l-2 border-slate-100 pl-3">
                      {f.detalhes.map((d) => (
                        <li key={d.nome} className="flex justify-between gap-2 text-xs text-slate-600">
                          <span className="truncate">{d.nome}</span>
                          <span className="shrink-0 tabular-nums">{formatar(d.valor)} · {pct(d.percentual)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
      </div>
    </section>
  )
}
