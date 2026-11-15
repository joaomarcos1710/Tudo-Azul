import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Folha } from './ui/Folha'
import { Aviso } from './ui/Aviso'
import { detalheDaCategoria } from '../lib/painel'
import type { DetalheCategoria as Detalhe } from '../lib/painel'
import type { BaseGastosCartao } from '../lib/baseGastosCartao'
import { formatBRL, formatDate, formatMonth } from '../lib/format'
import { mensagemErroBanco } from '../lib/erros'

/**
 * O que compõe a barra de uma categoria (migration 127). Mostra os MESMOS itens do gráfico, por dia e categoria, e o total
 * calculado no banco: ele é igual ao valor da barra. A lista de Lançamentos não serve para isso (filtra a categoria exata,
 * põe o cartão no vencimento e mostra planejados e outras moedas), por isso há um link só para quem quer a lista do mês.
 * atalho: sem a descrição de cada compra; melhorar quando expense_items carregar a origem (ver a migration 127).
 */
export function DetalheCategoria({ familiaId, categoriaId, nome, mes, de, ate, base, aoFechar }: {
  familiaId: string; categoriaId: string; nome: string
  /** AAAA-MM do gráfico (só para o título e o link da lista do mês). */
  mes: string; de: string; ate: string; base: BaseGastosCartao
  aoFechar: () => void
}) {
  const [detalhe, setDetalhe] = useState<Detalhe | null>(null)
  const [erro, setErro] = useState('')
  // só a resposta do último pedido vale: trocar a categoria, o mês ou a base com a folha aberta não pode deixar valor velho
  const pedido = useRef(0)
  const carregar = useCallback(() => {
    const meu = ++pedido.current
    setErro('')
    setDetalhe(null)
    detalheDaCategoria(familiaId, de, ate, categoriaId, base)
      .then((d) => { if (meu === pedido.current) setDetalhe(d) })
      .catch((e) => { if (meu === pedido.current) setErro(mensagemErroBanco(e)) })
  }, [familiaId, de, ate, categoriaId, base])
  useEffect(() => { carregar(); return () => { pedido.current++ } }, [carregar])

  return (
    <Folha titulo={`${nome} em ${formatMonth(mes)}`} aoFechar={aoFechar}>
      <div data-testid="detalhe-categoria">
        {erro && (
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <Aviso tipo="erro">Não foi possível carregar o detalhe: {erro}</Aviso>
            <button type="button" onClick={carregar} className="min-h-11 rounded-lg px-3 text-sm font-semibold text-azul hover:bg-azul-claro">Tentar de novo</button>
          </div>
        )}
        {!erro && detalhe === null && <p className="py-4 text-sm text-slate-600" role="status">Carregando…</p>}
        {detalhe && detalhe.linhas.length === 0 && <p className="py-4 text-sm text-slate-500">Nenhum item com valor nesta categoria no período (se a barra mostra R$ 0,00, a soma é zero).</p>}
        {detalhe && detalhe.linhas.length > 0 && (
          <>
            <p className="mb-2 flex items-baseline justify-between gap-3 text-sm">
              <span className="font-semibold text-marinho">Total (o mesmo valor da barra)</span>
              <span className="whitespace-nowrap tabular-nums text-base font-bold text-marinho" data-testid="detalhe-total">{detalhe.total === null ? '—' : formatBRL(detalhe.total)}</span>
            </p>
            <ul className="divide-y divide-slate-100" aria-label={`Itens de ${nome}`}>
              {detalhe.linhas.map((l) => (
                <li key={`${l.dia}-${l.categoriaId}`} className="flex items-baseline justify-between gap-3 py-2 text-sm">
                  <span className="min-w-0">
                    <span className="tabular-nums text-slate-500">{formatDate(l.dia).slice(0, 5)}</span>
                    {' '}
                    <span className="break-words text-slate-700">{l.principal ? `${l.principal} › ${l.nome}` : l.nome}</span>
                  </span>
                  <span className="shrink-0 whitespace-nowrap tabular-nums font-semibold text-marinho">{formatBRL(l.valor)}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-slate-500">
              Soma por dia e categoria, em reais, só o que já foi pago ou cobrado, com o cartão pela base escolhida em Análises
              (estorno entra negativo). Sem a descrição de cada compra por enquanto.
            </p>
          </>
        )}
        <Link to={`/lancamentos?mes=${mes}&tipo=despesa`} onClick={aoFechar}
          className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-azul hover:underline">
          Ver todos os lançamentos de despesa do mês
        </Link>
      </div>
    </Folha>
  )
}
