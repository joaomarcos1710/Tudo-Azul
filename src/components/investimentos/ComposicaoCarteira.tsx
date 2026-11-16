import { useId, useState } from 'react'
import type { KeyboardEvent } from 'react'
import type { Cents } from '../../lib/format'
import { MACROS } from '../../lib/investimentos'
import type { LinhaAlocacao, LinhaInstituicao, LinhaLiquidez, MoedaInvestimento, PosicaoInvestimento } from '../../lib/investimentos'

type Aba = 'classe' | 'liquidez' | 'instituicao' | 'ativos'
interface Fatia { chave: string; nome: string; valor: Cents; percentual: number; detalhes?: { nome: string; valor: Cents; percentual: number }[] }

const pct = (v: number) => `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
/** Ordem fixa dos seletores de moeda (a do dono: BRL, EUR, USD); só entram as moedas que têm posição. */
const ORDEM_MOEDAS: MoedaInvestimento[] = ['BRL', 'EUR', 'USD']
const EM_MOEDA: Record<MoedaInvestimento, string> = { BRL: 'reais', EUR: 'euros', USD: 'dólares' }

/**
 * Abas com o teclado do padrão ARIA: só a aba ativa entra na ordem do Tab; setas esquerda/direita, Home e End trocam e
 * levam o foco. Cada aba aponta para o painel (`aria-controls`) e o painel leva o nome da visão (aria-label, e não aria-labelledby, para a aba "Classe" não virar rótulo do campo "Classe" dos formulários).
 */
export function Abas<T extends string>({ rotulo, itens, ativa, aoEscolher, idBase, painelId, estilo }: {
  rotulo: string; itens: [T, string][]; ativa: T; aoEscolher: (c: T) => void; idBase: string; painelId: string; estilo: 'moeda' | 'visao'
}) {
  function teclas(e: KeyboardEvent<HTMLDivElement>) {
    const i = itens.findIndex(([c]) => c === ativa)
    const alvo = e.key === 'ArrowRight' ? (i + 1) % itens.length : e.key === 'ArrowLeft' ? (i - 1 + itens.length) % itens.length
      : e.key === 'Home' ? 0 : e.key === 'End' ? itens.length - 1 : -1
    if (alvo < 0) return
    e.preventDefault()
    aoEscolher(itens[alvo][0])
    e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')[alvo]?.focus()
  }
  const caixa = estilo === 'moeda' ? 'inline-flex gap-1 rounded-xl bg-slate-100 p-1' : 'flex gap-2 overflow-x-auto'
  return (
    <div role="tablist" aria-label={rotulo} onKeyDown={teclas} className={caixa}>
      {itens.map(([chave, nome]) => {
        const marcada = ativa === chave
        const cor = estilo === 'moeda'
          ? `min-w-16 rounded-lg px-4 ${marcada ? 'bg-white text-marinho shadow-card' : 'text-slate-600 hover:bg-azul-claro'}`
          : `rounded-full px-4 ${marcada ? 'bg-marinho text-white' : 'bg-slate-100 text-slate-600 hover:bg-azul-claro'}`
        return (
          <button key={chave} type="button" role="tab" id={`${idBase}-${chave}`} aria-selected={marcada} aria-controls={painelId}
            tabIndex={marcada ? 0 : -1} onClick={() => aoEscolher(chave)}
            className={`min-h-11 shrink-0 text-sm font-semibold transition-colors ${cor}`}>
            {nome}
          </button>
        )
      })}
    </div>
  )
}

/**
 * Composição da carteira (etapa 2 do redesenho, pedido do dono de 12/11/2026): uma área só, com um seletor de moeda
 * (BRL, EUR, USD; só as que têm posição) e, dentro, as visões Classe, Liquidez, Instituição e Ativos. Cada moeda
 * mostra os SEUS valores e percentuais, lidos do banco; nada é somado nem convertido entre moedas. Antes, só os reais
 * tinham as quatro visões ("Minha carteira") e as outras moedas ficavam numa seção à parte, só com a classe.
 *
 * Valores vêm do banco; em Classe o % também (investment_allocation). Em Liquidez, Instituição e Ativos o % é só valor ÷
 * valor de mercado da moeda (do banco): apresentação, nenhum dinheiro é somado aqui. A aba Instituição (migration 106)
 * soma no banco (investment_institution_totals) e só aparece quando o banco respondeu. Cores em ordem fixa (as 4
 * validadas da rosca do Início); a cor nunca é a única informação: a lista ao lado leva nome, valor e %. Mais de 4
 * fatias (Ativos) mostra só a lista, sem rosca: inventar cor ou somar "Outros" no front não vale.
 *
 * Só as moedas com posição entram no seletor (decisão: uma moeda sem posição abriria uma aba vazia, e o resumo acima já
 * mostra só as que existem); com uma moeda só, não há seletor. Se a moeda escolhida deixa de ter posição, vale a
 * primeira que tiver.
 */
export function ComposicaoCarteira({ totais, alocacao, liquidez, instituicoes, posicoes, formatar }: {
  /** valor de mercado de cada moeda com posição, do banco (base do % em Liquidez, Instituição e Ativos) */
  totais: { moeda: MoedaInvestimento; valorAtual: Cents }[]
  alocacao: LinhaAlocacao[]
  liquidez: LinhaLiquidez[]
  /** vazio = banco ainda sem a migration 106: a aba não aparece */
  instituicoes: LinhaInstituicao[]
  posicoes: PosicaoInvestimento[]
  formatar: (c: Cents, moeda: MoedaInvestimento) => string
}) {
  const [escolhida, setEscolhida] = useState<MoedaInvestimento>('BRL')
  const [abaEscolhida, setAba] = useState<Aba>('classe')
  const id = useId()
  const presentes = ORDEM_MOEDAS.filter((m) => totais.some((t) => t.moeda === m))
  if (presentes.length === 0) return null
  const codigo = presentes.includes(escolhida) ? escolhida : presentes[0]
  const total = totais.find((t) => t.moeda === codigo)!.valorAtual
  const doCodigo = {
    alocacao: alocacao.filter((l) => l.moeda === codigo),
    liquidez: liquidez.filter((l) => l.moeda === codigo),
    instituicoes: instituicoes.filter((l) => l.moeda === codigo),
    posicoes: posicoes.filter((p) => p.moeda === codigo),
  }
  const fmt = (c: Cents) => formatar(c, codigo)
  const proporcao = (v: Cents) => (total > 0 ? (v * 100) / total : 0)

  const porAba: Record<Aba, Fatia[]> = {
    classe: doCodigo.alocacao.filter((l) => l.nivel === 'macro').map((m) => ({
      chave: m.macro, nome: MACROS.find((x) => x.chave === m.macro)?.rotulo ?? m.macro, valor: m.valor, percentual: m.percentual,
      detalhes: doCodigo.alocacao.filter((l) => l.nivel === 'subclass' && l.macro === m.macro)
        .map((s) => ({ nome: s.subclasse ?? 'Sem subclasse', valor: s.valor, percentual: s.percentual })),
    })),
    liquidez: doCodigo.liquidez.filter((l) => l.valor > 0).map((l) => ({
      chave: l.liquidez, nome: l.liquidez === 'restricted' ? 'Restrito (previdência, FGTS)' : 'Líquido', valor: l.valor, percentual: proporcao(l.valor),
    })),
    instituicao: doCodigo.instituicoes.filter((l) => l.valor > 0).map((l) => ({
      chave: l.instituicao === null ? 'sem' : `i:${l.instituicao}`, nome: l.instituicao ?? 'Sem instituição', valor: l.valor, percentual: proporcao(l.valor),
    })),
    ativos: [...doCodigo.posicoes].sort((a, b) => b.valorAtual - a.valorAtual).map((p) => ({
      chave: p.assetId, nome: p.nome, valor: p.valorAtual, percentual: proporcao(p.valorAtual),
    })),
  }
  const abas: [Aba, string][] = [['classe', 'Classe'], ['liquidez', 'Liquidez'],
    ...(doCodigo.instituicoes.length > 0 ? [['instituicao', 'Instituição'] as [Aba, string]] : []), ['ativos', 'Ativos']]
  // a visão escolhida pode não existir nesta moeda (Instituição): volta para Classe
  const aba = abas.some(([c]) => c === abaEscolhida) ? abaEscolhida : 'classe'
  const fatias = porAba[aba]
  // Classe na ordem fixa das macroclasses (a do banco pode vir em outra); as demais visões já vêm do maior para o menor
  const itens = aba === 'classe'
    ? [...fatias].sort((x, y) => (MACROS.findIndex((m) => m.chave === x.chave) + 1 || 99) - (MACROS.findIndex((m) => m.chave === y.chave) + 1 || 99))
    : fatias
  // nome para leitor de tela, com acento ("instituição", não a chave interna)
  const nomeAba = abas.find(([c]) => c === aba)?.[1].toLowerCase() ?? aba
  const temRestrito = doCodigo.liquidez.some((l) => l.liquidez === 'restricted' && l.valor > 0)
  const painelMoeda = `${id}-painel-moeda`
  const painelVisao = `${id}-painel-visao`

  const visoes = (
    <>
      <div className="mb-3"><Abas rotulo="Ver a carteira por" itens={abas} ativa={aba} aoEscolher={setAba} idBase={`${id}-visao`} painelId={painelVisao} estilo="visao" /></div>
      <div role="tabpanel" id={painelVisao} aria-label={`Carteira em ${EM_MOEDA[codigo]} por ${nomeAba}`}>
        {fatias.length === 0 ? (
          <p className="rounded-2xl bg-white p-4 text-sm text-slate-500 shadow-card">Nada para mostrar ainda.</p>
        ) : (
          <div className="rounded-2xl bg-white p-4 shadow-card">
            <ul className="divide-y divide-slate-100" aria-label={`Lista da carteira por ${nomeAba}`}>
              {itens.map((f) => (
                <li key={f.chave} className="py-2.5">
                  <LinhaDeBarra nome={f.nome} valor={fmt(f.valor)} percentual={f.percentual} forte />
                  {f.detalhes && f.detalhes.length > 0 && (
                    <ul className="mt-1 flex flex-col gap-1.5 border-l-2 border-slate-100 pl-3" aria-label={`Subclasses de ${f.nome}`}>
                      {f.detalhes.map((d) => (
                        <li key={d.nome}><LinhaDeBarra nome={d.nome} valor={fmt(d.valor)} percentual={d.percentual} /></li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
            {aba === 'classe' && temRestrito && (
              // a previdência pode ser quase tudo e deixar o resto sem barra visível: a visão por liquidez mostra o restrito à parte
              <p className="mt-3 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
                <span>Parte da carteira é restrita (previdência, FGTS) e pode ocupar boa parte da carteira.</span>
                <button type="button" onClick={() => setAba('liquidez')} className="min-h-11 font-semibold text-azul hover:underline">Ver por liquidez</button>
              </p>
            )}
          </div>
        )}
      </div>
    </>
  )

  return (
    <section className="mt-6" aria-labelledby="titulo-composicao-carteira">
      <h2 id="titulo-composicao-carteira" className="mb-1 text-lg font-semibold">Composição da carteira</h2>
      <p className="mb-3 text-sm text-slate-500">Cada moeda mostra os seus valores e percentuais, sem conversão entre elas.</p>
      {presentes.length > 1 ? (
        <>
          <div className="mb-3">
            <Abas rotulo="Moeda da composição" itens={presentes.map((m): [MoedaInvestimento, string] => [m, m])} ativa={codigo}
              aoEscolher={setEscolhida} idBase={`${id}-moeda`} painelId={painelMoeda} estilo="moeda" />
          </div>
          <div role="tabpanel" id={painelMoeda} aria-label={`Composição em ${codigo}`}>{visoes}</div>
        </>
      ) : visoes}
    </section>
  )
}

/**
 * Uma linha da composição (mudança 4 do handoff de Investimentos, #374): nome e valor/% na primeira linha, e embaixo uma barra
 * horizontal de uma cor só. A largura da barra é o % que o banco mandou, com um mínimo de 1% para o item pequeno não sumir (o % exato
 * está em texto ao lado); nada é somado aqui. No iPad em pé (~500 px) nada precisa caber lado a lado: o nome quebra linha, nunca é cortado
 * com "…" (#357, #358), e o valor não quebra entre "R$" e o número.
 */
function LinhaDeBarra({ nome, valor, percentual, forte = false }: { nome: string; valor: string; percentual: number; forte?: boolean }) {
  const largura = Math.min(100, Math.max(1, percentual))
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className={`min-w-0 break-words ${forte ? 'font-semibold text-marinho' : 'text-slate-700'}`}>{nome}</span>
        <span className="shrink-0 whitespace-nowrap">
          <span className="tabular-nums font-semibold text-marinho">{valor}</span>
          <span className="ml-2 inline-block w-12 text-right tabular-nums text-slate-500">{pct(percentual)}</span>
        </span>
      </div>
      <div aria-hidden="true" className="mt-1 h-2 w-full overflow-hidden rounded-full bg-neutro-fundo">
        <span data-barra className="block h-2 rounded-full bg-lucro-marca" style={{ width: `${largura}%` }} />
      </div>
    </div>
  )
}
