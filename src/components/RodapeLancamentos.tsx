import { useId, useState } from 'react'
import type { ReactNode } from 'react'
import { formatBRL, formatMoeda } from '../lib/format'
import type { Cents } from '../lib/format'
import { corDoValor } from '../lib/cores'
import type { TotalBusca } from '../lib/lancamentos'

/** Totais do período em regime de caixa, todos do banco (cash_flow_series): o front só mostra. */
export interface TotaisCaixa {
  entradas: Cents
  saidas: Cents
  /** Saldo das contas no fim do período; null com filtro de conta (o banco não devolve saldo por conta aqui). */
  saldo: Cents | null
}

/**
 * Rodapé de Lançamentos (pedido do dono, 10/11/2026, como no Organizze): entradas, saídas e saldo do que já foi pago e,
 * na seta, o previsto (pagos e não pagos). Regime de caixa: a fatura do cartão conta no vencimento, como na lista e no
 * Relatório Entradas x Saídas com "Pagos e não pagos". undefined = carregando; null = não carregou.
 * Com `semTotais` (filtro que o banco não sabe somar), os números somem e fica só a frase: um total que não bate com a
 * lista filtrada engana mais do que não mostrar nada (handoff de Lançamentos, PR 3, parte só de tela).
 */
export function RodapeLancamentos({ realizado, previsto, semTotais, busca, acao }: {
  realizado: TotaisCaixa | null | undefined
  previsto: TotaisCaixa | null | undefined
  /** Frase no lugar dos totais quando eles não seguiriam algum filtro da lista (os números não aparecem). */
  semTotais?: string
  /**
   * Com busca (handoff, PR 2): no lugar dos totais do período, o que a busca achou, somado no banco
   * (ledger_search_totals) e por moeda. totais: undefined = carregando; null = não carregou.
   */
  busca?: { texto: string; totais: TotalBusca[] | null | undefined }
  /** O botão flutuante de novo lançamento, preso acima do rodapé. */
  acao?: ReactNode
}) {
  const [aberto, setAberto] = useState(false)
  const idPrevisto = useId()
  return (
    // acima da barra inferior do celular (3,5rem + área segura); no computador, colado no fim da tela
    <section aria-label="Totais do mês"
      className="sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-20 -mx-4 mt-4 border-t border-slate-200 bg-white/95 px-4 pb-2 pt-1 backdrop-blur md:bottom-0 md:-mx-8 md:px-8">
      {acao && <div className="absolute -top-16 right-4 md:right-8">{acao}</div>}
      {busca ? <TotaisDaBusca {...busca} /> : semTotais ? <p className="py-3 text-center text-sm text-slate-600" role="status">{semTotais}</p> : <>
        <button type="button" onClick={() => setAberto((v) => !v)} aria-expanded={aberto} aria-controls={idPrevisto}
          aria-label={aberto ? 'Esconder o previsto' : 'Mostrar o previsto'}
          className="mx-auto flex min-h-8 w-16 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100">
          <span aria-hidden="true" className={`inline-block transition-transform ${aberto ? 'rotate-180' : ''}`}>⌃</span>
        </button>
        {realizado === null
          ? <p className="py-2 text-center text-sm text-slate-500" role="status">Totais indisponíveis agora. A lista continua certa.</p>
          : <Linha totais={realizado} rotulos={['entradas', 'saídas', 'saldo']} />}
        <div id={idPrevisto} hidden={!aberto}>
          {previsto === null
            ? <p className="py-2 text-center text-sm text-slate-500" role="status">Previsto indisponível agora.</p>
            : <Linha totais={previsto} rotulos={['entradas previstas', 'saídas previstas', 'saldo previsto']} titulo="Previsto, com o que ainda não foi pago" />}
        </div>
      </>}
    </section>
  )
}

function Linha({ totais, rotulos, titulo }: { totais: TotaisCaixa | undefined; rotulos: [string, string, string]; titulo?: string }) {
  const valor = 'tabular-nums text-sm font-semibold whitespace-nowrap sm:text-lg'
  return (
    <dl className="grid grid-cols-3 gap-2 py-1 text-center" aria-label={titulo}>
      <div className="flex min-w-0 flex-col-reverse">
        <dt className="text-xs text-slate-500">{rotulos[0]}</dt>
        <dd className={`${valor} text-lucro`}>{totais ? formatBRL(totais.entradas) : '…'}</dd>
      </div>
      <div className="flex min-w-0 flex-col-reverse">
        <dt className="text-xs text-slate-500">{rotulos[1]}</dt>
        <dd className={`${valor} text-prejuizo`}>{totais ? `−${formatBRL(totais.saidas)}` : '…'}</dd>
      </div>
      <div className="flex min-w-0 flex-col-reverse">
        <dt className="text-xs text-slate-500">{rotulos[2]}</dt>
        <dd className={`${valor} ${totais && totais.saldo !== null ? corDoValor(totais.saldo) : 'text-slate-500'}`}
          title={totais && totais.saldo === null ? 'O saldo só aparece sem filtro de conta.' : undefined}>
          {!totais ? '…' : totais.saldo === null ? '—' : formatBRL(totais.saldo)}
        </dd>
      </div>
    </dl>
  )
}

/**
 * "Encontrados", entradas e saídas do que a busca achou (pagos e previstos; transferência só na quantidade, como diz a nota
 * acima da lista); outras moedas numa linha à parte.
 */
function TotaisDaBusca({ texto, totais }: { texto: string; totais: TotalBusca[] | null | undefined }) {
  if (totais === null) {
    return <p className="py-3 text-center text-sm text-slate-500" role="status">Total da busca indisponível agora. A lista continua certa.</p>
  }
  const reais = totais?.find((t) => t.moeda === 'BRL')
  const outras = (totais ?? []).filter((t) => t.moeda !== 'BRL')
  const valor = 'tabular-nums text-sm font-semibold whitespace-nowrap sm:text-lg'
  const n = totais ? reais?.quantidade ?? 0 : null
  return (
    <div className="pt-1" data-testid="totais-busca">
      <dl className="grid grid-cols-3 gap-2 py-1 text-center" aria-label={`Total do que a busca "${texto}" encontrou, pagos e previstos`}>
        <div className="flex min-w-0 flex-col-reverse">
          <dt className="text-xs text-slate-500">{n === 1 ? 'encontrado' : 'encontrados'}</dt>
          <dd className={`${valor} text-marinho`}>{n === null ? '…' : n}</dd>
        </div>
        <div className="flex min-w-0 flex-col-reverse">
          <dt className="text-xs text-slate-500">entradas</dt>
          <dd className={`${valor} text-lucro`}>{!totais ? '…' : formatBRL(reais?.entradas ?? (0 as Cents))}</dd>
        </div>
        <div className="flex min-w-0 flex-col-reverse">
          <dt className="text-xs text-slate-500">saídas</dt>
          <dd className={`${valor} text-prejuizo`}>{!totais ? '…' : `−${formatBRL(reais?.saidas ?? (0 as Cents))}`}</dd>
        </div>
      </dl>
      {outras.length > 0 && (
        <p className="pb-1 text-center text-xs text-slate-600" data-testid="totais-busca-outras-moedas">
          {/* nunca somado aos reais; valor zerado não aparece, para a linha caber no celular */}
          {outras.map((t) => [`Em ${t.moeda}, à parte: ${t.quantidade} ${t.quantidade === 1 ? 'encontrado' : 'encontrados'}`,
            ...(t.entradas !== 0 ? [`entradas ${formatMoeda(t.entradas, t.moeda)}`] : []),
            ...(t.saidas !== 0 ? [`saídas −${formatMoeda(t.saidas, t.moeda)}`] : [])].join(' · ')).join('; ')}
        </p>
      )}
    </div>
  )
}
