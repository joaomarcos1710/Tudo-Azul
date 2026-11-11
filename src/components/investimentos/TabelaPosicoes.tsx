import { CLASSES_ATIVO } from '../../lib/investimentos'
import type { AportesCarteira, AtivoInvestimento, MoedaInvestimento, PosicaoInvestimento, TotalInvestimento } from '../../lib/investimentos'
import type { Cents } from '../../lib/format'
import { formatDate } from '../../lib/format'
import { valoresOcultos } from '../../lib/privacidade'
import { corDoValor } from '../../lib/cores'

const pct = (v: number) => `${v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`

/**
 * Rendimento ÷ aportado, só para exibir ao lado do valor (os dois números vêm do banco; nenhum dinheiro é somado aqui).
 * Não é rentabilidade: não considera quando cada aporte entrou. Por isso o rótulo é sempre "sobre o aportado".
 */
export function sobreOAportado(resultado: Cents, aportado: Cents): string | null {
  // com "ocultar valores" o percentual também some: junto com a cor ele entregaria quanto rendeu
  if (valoresOcultos() || aportado <= 0) return null
  // arredonda antes de decidir o sinal: 4 centavos sobre R$ 100 é "0,0%", não "+0,0%" nem "-0,0%"
  // `|| 0` tira o zero negativo, que sairia como "-0,0%"
  const decimos = Math.round((resultado * 1000) / aportado) || 0
  return `${decimos > 0 ? '+' : ''}${pct(decimos / 10)} sobre o aportado`
}

/** Cor do rendimento (azul ganho, vermelho perda); com "ocultar valores" fica neutra, para a cor não entregar o sinal. */
export function corDoResultado(valor: Cents): string {
  return valoresOcultos() ? 'text-neutro' : corDoValor(valor)
}

/** "+" na frente do ganho, como o "-" que o prejuízo já traz ("+R$ 32,21"); com "ocultar valores" fica só a máscara. */
export function comSinal(texto: string, valor: Cents): string {
  return valor > 0 && !valoresOcultos() ? `+${texto}` : texto
}

/**
 * Posições em tabela (pedido do dono, 10/11/2026, a partir de um desenho dele): por investimento, Aportado, Valor atual
 * e Rendimento, com a classe e a instituição embaixo do nome. Uma tabela por moeda, sem conversão. Tudo vem do banco.
 * Com `aportes` (migration 107): aportado = o que entrou menos o que saiu, rendimento = tudo o que rendeu contando o que
 * já foi resgatado, e a linha Total também vem de investment_contributions. Sem `aportes`: aportado = custo do que ainda
 * está investido (investment_portfolio) e Total = investment_totals. Nos dois casos o Total some quando há filtro: o
 * total do banco é da carteira inteira, não das linhas à vista.
 * Proventos do mês só aparecem quando existem (renda fixa não paga provento mensal: o juro fica no valor do título).
 * No celular ficam duas colunas, para caber sem rolagem lateral nem número cortado: "Aportado" vira uma linha embaixo do
 * nome e o rendimento vai embaixo do valor atual.
 */
export function TabelaPosicoes({ posicoes, ativos, totais, aportes, proventosDoMes, filtrada, formatar, formatarPreco, formatarQuantidade }: {
  posicoes: PosicaoInvestimento[]
  ativos: AtivoInvestimento[]
  totais: TotalInvestimento[]
  /**
   * aportes e resgates por ativo e por moeda (migration 107). Com eles, "Aportado" é o que entrou menos o que saiu e
   * "Rendimento" conta o ganho já resgatado; null = banco sem a função: vale o custo do que ainda está investido.
   */
  aportes: AportesCarteira | null
  /** recebido no mês corrente, por ativo (investment_income_by_asset) */
  proventosDoMes: Map<string, Cents>
  /** true = há filtro ligado: a linha Total não aparece */
  filtrada: boolean
  formatar: (c: Cents, moeda: MoedaInvestimento) => string
  formatarPreco: (v: string, moeda: MoedaInvestimento) => string
  formatarQuantidade: (v: string) => string
}) {
  const porId = new Map(ativos.map((a) => [a.id, a]))
  const moedas = [...new Set(posicoes.map((p) => p.moeda))]
  const numero = 'px-2 py-3 text-right align-top tabular-nums whitespace-nowrap'
  // um jeito só de contar na tabela inteira: se faltar o aporte de alguma posição (duas leituras em instantes
  // diferentes), todas as linhas ficam no custo, nunca metade de cada
  const porAporte = aportes !== null && posicoes.every((p) => aportes.porAtivo.has(p.assetId)) ? aportes : null
  return (
    <div className="flex flex-col gap-4">
      {moedas.map((moeda) => {
        const linhas = posicoes.filter((p) => p.moeda === moeda)
        const totalCusto = totais.find((t) => t.moeda === moeda)
        const totalAporte = porAporte?.totais.find((t) => t.moeda === moeda)
        const total = porAporte
          ? totalAporte && { aportado: totalAporte.liquido, valorAtual: totalAporte.valorAtual, rendimento: totalAporte.ganho }
          : totalCusto && { aportado: totalCusto.custoTotal, valorAtual: totalCusto.valorAtual, rendimento: totalCusto.resultado }
        return (
          <div key={moeda} className="overflow-hidden rounded-2xl bg-white shadow-card">
            <table className="w-full table-fixed text-sm">
              <caption className="sr-only">Posições em {moeda}: aportado, valor atual e rendimento por investimento</caption>
              <colgroup>
                <col />
                <col className="hidden w-32 sm:table-column" />
                <col className="w-36 sm:w-32" />
                <col className="hidden w-48 sm:table-column" />
              </colgroup>
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <th scope="col" className="px-3 py-2 text-left font-semibold">Investimento{moedas.length > 1 ? ` (${moeda})` : ''}</th>
                  <th scope="col" className="hidden px-2 py-2 text-right font-semibold sm:table-cell">Aportado</th>
                  <th scope="col" className="px-2 py-2 pr-3 text-right font-semibold sm:pr-2">Valor atual<span className="sm:hidden"> e rendimento</span></th>
                  <th scope="col" className="hidden px-2 py-2 pr-3 text-right font-semibold sm:table-cell">Rendimento</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {linhas.map((p) => {
                  const a = porId.get(p.assetId)
                  const classe = CLASSES_ATIVO.find(([v]) => v === p.classe)?.[1] ?? p.classe
                  const provento = proventosDoMes.get(p.assetId)
                  const ap = porAporte?.porAtivo.get(p.assetId)
                  const aportado = ap ? ap.liquido : p.custoTotal
                  const valorAtual = ap ? ap.valorAtual : p.valorAtual
                  const resultado = ap ? ap.ganho : p.resultado
                  const comResgate = ap !== undefined && ap.resgatado > 0
                  // com resgate, rendimento ÷ aportado líquido não quer dizer nada (o líquido pode ser quase zero): some
                  const relativo = comResgate ? null : sobreOAportado(resultado, aportado)
                  const rendimento = (
                    <>
                      <p className={`font-semibold ${corDoResultado(resultado)}`}>{comSinal(formatar(resultado, p.moeda), resultado)}</p>
                      {relativo && <p className="whitespace-normal text-xs text-slate-500">{relativo}</p>}
                      {provento !== undefined && provento > 0 && <p className="whitespace-normal text-xs text-slate-500">proventos {formatar(provento, p.moeda)} no mês</p>}
                    </>
                  )
                  return (
                    <tr key={p.assetId}>
                      <th scope="row" className="px-3 py-3 text-left align-top font-normal">
                        <p className="break-words font-semibold text-marinho">{p.nome}{p.ticker ? ` · ${p.ticker}` : ''}</p>
                        <p className="text-xs text-slate-500">{[...new Set([classe, a?.subclasse, a?.instituicao].filter(Boolean))].join(' · ')}</p>
                        {/* unidade e preço só fazem sentido em ativo com cota (migration 104) */}
                        {p.ticker && <p className="text-xs text-slate-500">{formatarQuantidade(p.quantidade)} un · preço {formatarPreco(p.precoAtual, p.moeda)}</p>}
                        <p className="text-xs text-slate-500 sm:hidden">Aportado {formatar(aportado, p.moeda)}</p>
                        {comResgate && <p className="text-xs text-slate-500">Pôs {formatar(ap.aportado, p.moeda)} · tirou {formatar(ap.resgatado, p.moeda)}</p>}
                        <p className="text-xs text-slate-500">
                          {p.dataAvaliacao ? `Valor de ${formatDate(p.dataAvaliacao)}${p.fonteAvaliacao ? ` · ${p.fonteAvaliacao}` : ''}` : 'Sem avaliação: vale o que custou'}
                        </p>
                      </th>
                      <td className={`hidden sm:table-cell ${numero}`}>{formatar(aportado, p.moeda)}</td>
                      <td className={`${numero} pr-3 sm:pr-2`}>
                        <p className="font-semibold text-marinho">{formatar(valorAtual, p.moeda)}</p>
                        <div className="sm:hidden">{rendimento}</div>
                      </td>
                      <td className={`hidden sm:table-cell ${numero} pr-3`}>{rendimento}</td>
                    </tr>
                  )
                })}
              </tbody>
              {!filtrada && total && (
                <tfoot>
                  <tr className="border-t-2 border-slate-200 font-semibold">
                    <th scope="row" className="px-3 py-3 text-left">
                      Total
                      <span className="block text-xs font-normal text-slate-500 sm:hidden">Aportado {formatar(total.aportado, moeda)}</span>
                    </th>
                    <td className={`hidden sm:table-cell ${numero}`}>{formatar(total.aportado, moeda)}</td>
                    <td className={`${numero} pr-3 sm:pr-2`}>
                      <span className="text-azul">{formatar(total.valorAtual, moeda)}</span>
                      <span className={`block sm:hidden ${corDoResultado(total.rendimento)}`}>{comSinal(formatar(total.rendimento, moeda), total.rendimento)}</span>
                    </td>
                    <td className={`hidden sm:table-cell ${numero} pr-3 ${corDoResultado(total.rendimento)}`}>{comSinal(formatar(total.rendimento, moeda), total.rendimento)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )
      })}
    </div>
  )
}
