import { useState } from 'react'
import { GRAFICO } from '../../lib/cores'
import type { Cents } from '../../lib/format'
import { MACROS } from '../../lib/investimentos'
import type { LinhaAlocacao, LinhaInstituicao, LinhaLiquidez, PosicaoInvestimento } from '../../lib/investimentos'

type Aba = 'classe' | 'liquidez' | 'instituicao' | 'ativos'
interface Fatia { chave: string; nome: string; valor: Cents; percentual: number; detalhes?: { nome: string; valor: Cents; percentual: number }[] }

const R = 40
const VOLTA = 2 * Math.PI * R
/** 2px de folga entre fatias, como pedem as regras de gráfico. */
const FOLGA = 2
const pct = (v: number) => `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`

/**
 * "Minha carteira" (pedido do dono, 10/11/2026, a partir da tela da XP): rosca e lista com abas Classe, Liquidez,
 * Instituição e Ativos, só em reais (as outras moedas ficam à parte, sem conversão). Valores vêm do banco; em Classe o %
 * também vem do banco (investment_allocation). Em Liquidez, Instituição e Ativos o % é só valor ÷ valor de mercado total
 * (do banco): apresentação, nenhum dinheiro é somado aqui. A aba Instituição (migration 106) soma no banco
 * (investment_institution_totals) e só aparece quando o banco respondeu. Cores em ordem fixa (as 4 validadas da rosca do Início); a cor nunca é a única informação: a
 * lista ao lado leva nome, valor e %. Mais de 4 fatias (Ativos) mostra só a lista, sem rosca: inventar cor ou somar
 * "Outros" no front não vale.
 */
export function MinhaCarteira({ total, alocacao, liquidez, instituicoes, posicoes, formatar }: {
  total: Cents
  alocacao: LinhaAlocacao[]
  liquidez: LinhaLiquidez[]
  /** vazio = banco ainda sem a migration 106: a aba não aparece */
  instituicoes: LinhaInstituicao[]
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
    instituicao: instituicoes.filter((l) => l.valor > 0).map((l) => ({
      chave: l.instituicao === null ? 'sem' : `i:${l.instituicao}`, nome: l.instituicao ?? 'Sem instituição', valor: l.valor, percentual: proporcao(l.valor),
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
  const abas: [Aba, string][] = [['classe', 'Classe'], ['liquidez', 'Liquidez'],
    ...(instituicoes.length > 0 ? [['instituicao', 'Instituição'] as [Aba, string]] : []), ['ativos', 'Ativos']]
  // nome para leitor de tela, com acento ("instituição", não a chave interna)
  const nomeAba = abas.find(([c]) => c === aba)?.[1].toLowerCase() ?? aba

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
      {aba === 'classe' && fatias.length > 0 ? (
        <div role="tabpanel" aria-label={`Carteira por ${nomeAba}`} className="rounded-2xl bg-white p-4 shadow-card">
          <BarraAlocacao fatias={fatias} formatar={formatar} />
        </div>
      ) : (
      <div role="tabpanel" aria-label={`Carteira por ${nomeAba}`}
        className="flex flex-col items-center gap-4 rounded-2xl bg-white p-4 shadow-card sm:flex-row sm:items-start">
        {comRosca && (
          <svg viewBox="0 0 100 100" className="h-36 w-36 shrink-0 -rotate-90" role="img"
            aria-label={`Carteira em reais por ${nomeAba}: ${fatias.map((f) => `${f.nome} ${pct(f.percentual)}`).join(', ')}`}>
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
            <ul className="w-full min-w-0 flex-1 divide-y divide-slate-100" aria-label={`Lista da carteira por ${nomeAba}`}>
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
      )}
    </section>
  )
}

/**
 * Alocação por classe em barra (pedido do dono, 10/11/2026, a partir de um desenho): em cima, um quadro por macroclasse
 * com valor e %; embaixo, uma barra com um trecho por subclasse e a legenda. Valores e % vêm do banco
 * (investment_allocation): a largura de cada trecho é o % do banco, nada é somado aqui. A cor é a da macroclasse (as 4
 * validadas da rosca, em ordem fixa) e os trechos da mesma macroclasse se separam por 2px: assim cabem quantas
 * subclasses houver sem inventar cor, e a legenda diz o nome de cada uma (a cor nunca é a única informação).
 */
function BarraAlocacao({ fatias: doBanco, formatar }: { fatias: Fatia[]; formatar: (c: Cents) => string }) {
  // a cor segue a macroclasse, nunca a posição na lista: Renda fixa é sempre a 1ª cor, mesmo que o banco mande outra ordem
  const ordem = (chave: string) => { const i = MACROS.findIndex((m) => m.chave === chave); return i < 0 ? MACROS.length : i }
  const corDe = (chave: string) => GRAFICO.rosca[ordem(chave)] ?? GRAFICO.roscaOutros
  const fatias = [...doBanco].sort((a, b) => ordem(a.chave) - ordem(b.chave))
  const trechos = fatias.flatMap((f) => (f.detalhes && f.detalhes.length > 0 ? f.detalhes : [{ nome: f.nome, valor: f.valor, percentual: f.percentual }])
    .filter((d) => d.percentual > 0).map((d) => ({ ...d, chave: `${f.chave}:${d.nome}`, macro: f.nome, cor: corDe(f.chave) })))
  return (
    <div className="flex flex-col gap-4">
      <ul className="grid gap-2 sm:grid-cols-3" aria-label="Lista da carteira por classe">
        {fatias.map((f) => (
          <li key={f.chave} className="rounded-xl border border-slate-100 bg-fundo p-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-marinho">
              <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-sm" style={{ background: corDe(f.chave) }} />
              <span className="truncate">{f.nome}</span>
            </div>
            <p className="mt-1 flex items-baseline justify-between gap-2">
              <span className="tabular-nums font-bold text-marinho">{formatar(f.valor)}</span>
              <span className="tabular-nums text-sm text-slate-500">{pct(f.percentual)}</span>
            </p>
          </li>
        ))}
      </ul>
      <div>
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Composição por subclasse</p>
        <div role="img" className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-slate-100"
          aria-label={`Carteira em reais por subclasse: ${trechos.map((t) => `${t.nome} (${t.macro}) ${pct(t.percentual)}`).join(', ')}`}>
          {/* largura mínima de 6px: num trecho de 0,2% a cor sumiria; o % certo está na legenda */}
          {trechos.map((t) => <span key={t.chave} data-fatia className="h-full shrink-0" style={{ width: `${t.percentual}%`, minWidth: '6px', background: t.cor }} />)}
        </div>
        <ul className="mt-3 grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3" aria-label="Subclasses">
          {trechos.map((t) => (
            <li key={t.chave} className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2">
                <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: t.cor }} />
                <span className="truncate text-slate-700">{t.nome}</span>
              </span>
              <span className="shrink-0 whitespace-nowrap tabular-nums text-slate-600">{formatar(t.valor)} · {pct(t.percentual)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
