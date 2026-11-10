import { useState } from 'react'
import type { Categoria } from '../lib/categorias'
import type { ParcelaDivida } from '../lib/dividas'
import { formatBRL, formatDate, formatMoeda } from '../lib/format'
import { listarComprasDaFatura, listarCreditosDaFaturaDoMes } from '../lib/lancamentos'
import type { CompraDaFatura, CreditoDeCartao, FaturaDoMes, Lancamento, MovimentoDivida, TipoLancamento } from '../lib/lancamentos'
import { IconeCategoria, visualPorId } from '../lib/visualCategoria'
import { hojeSP } from '../lib/contas'
import { SELO, SELO_FATURA, corDoTipo } from '../lib/cores'

export const rotuloTipo: Record<TipoLancamento, string> = { expense: 'Despesa', income: 'Receita', transfer: 'Transferência' }

/** Sinal e cor por tipo: receita "+", despesa "−", transferência "⇄" sem sinal (design system). Valor na moeda da conta. */
export function valorComSinal(l: Lancamento, moeda: string) {
  if (l.tipo === 'income') return { texto: `+${formatMoeda(l.valor, moeda)}`, cor: corDoTipo('income') }
  if (l.tipo === 'expense') return { texto: `−${formatMoeda(l.valor, moeda)}`, cor: 'text-neutro' }
  return { texto: `⇄ ${formatMoeda(l.valor, moeda)}`, cor: corDoTipo('transfer') }
}

/** Um item da lista do mês: lançamento comum ou uma das linhas só de leitura (cartão, dívida, contrato, crédito). */
export type ItemLista = ({ origem: 'lancamento'; l: Lancamento } | { origem: 'divida'; m: MovimentoDivida } | { origem: 'fatura'; f: FaturaDoMes }
  | { origem: 'cartao'; c: CompraDaFatura } | { origem: 'contrato'; p: ParcelaDivida } | { origem: 'credito'; k: CreditoDeCartao }) & { data: string }

export const rotuloSituacaoFatura: Record<FaturaDoMes['situacao'], { texto: string; estilo: string }> = SELO_FATURA

/** A data que importa agora na fatura, curta e sem o ano (pedido do dono, 05/11/2026); paga não precisa de data. */
export function resumoDaFatura(f: FaturaDoMes): string | undefined {
  const ddmm = (iso: string) => formatDate(iso).slice(0, 5)
  switch (f.situacao) {
    case 'aberta': return `fecha ${ddmm(f.fechamento)}`
    case 'fechada': return `vence ${ddmm(f.vencimento)}`
    case 'vencida': return `venceu ${ddmm(f.vencimento)}`
    case 'paga': return undefined
  }
}

/**
 * Nome da categoria na lista e na tabela: só a folha ("Habitação", não "Financiamento e Empréstimos › Habitação"); o
 * ícone e a cor já dizem o grupo (pedido do dono, 05/11/2026). O caminho inteiro fica no `title` e no texto do leitor de
 * tela. Categoria sem pai: o próprio nome.
 */
export function NomeCategoria({ id, categoriaPorId, nomeCategoria }: {
  id: string | null; categoriaPorId: Map<string, Categoria>; nomeCategoria: Map<string, string>
}) {
  const completo = nomeCategoria.get(id ?? '') ?? 'Sem categoria'
  const folha = categoriaPorId.get(id ?? '')?.nome ?? completo
  if (folha === completo) return <span title={completo}>{folha}</span>
  return <span title={completo}><span aria-hidden="true">{folha}</span><span className="sr-only">{completo}</span></span>
}

/**
 * Compras e créditos de uma fatura, carregados só ao abrir (card_items e os créditos avulsos da fatura). Usado na lista do
 * celular e na tabela do computador. Os créditos só são pedidos quando o banco diz que a fatura tem (card_months.credits).
 */
export function useComprasDaFatura(f: FaturaDoMes) {
  const [aberto, setAberto] = useState(false)
  const [compras, setCompras] = useState<CompraDaFatura[] | null>(null)
  const [creditos, setCreditos] = useState<CreditoDeCartao[] | null>(null)
  const [erro, setErro] = useState(false)
  function alternar() {
    const abrir = !aberto
    setAberto(abrir)
    if (abrir && (compras === null || creditos === null || erro)) {
      setErro(false)
      Promise.all([listarComprasDaFatura(f), listarCreditosDaFaturaDoMes(f, hojeSP())])
        .then(([c, k]) => { setCompras(c); setCreditos(k) })
        .catch(() => setErro(true))
    }
  }
  return { aberto, compras, creditos, erro, alternar, idLista: `compras-${f.cartaoId}-${f.mes}` }
}

export function ComprasDaFatura({ f, compras, creditos = [], erro, idLista, categoriaPorId, nomeCategoria }: {
  f: FaturaDoMes; compras: CompraDaFatura[] | null; creditos?: CreditoDeCartao[] | null; erro: boolean; idLista: string
  categoriaPorId: Map<string, Categoria>; nomeCategoria: Map<string, string>
}) {
  return (
    <div id={idLista} className="mt-2 rounded-lg bg-slate-50 px-3 py-2">
      {erro && <p className="text-sm text-negativo" role="alert">Não foi possível carregar as compras. Veja em Cartões.</p>}
      {!erro && compras === null && <p className="text-sm text-slate-600" role="status">Carregando compras…</p>}
      {!erro && compras?.length === 0 && <p className="text-sm text-slate-500">Nenhuma compra nesta fatura.</p>}
      {!erro && compras && compras.length > 0 && (
        <ul aria-label={`Compras da fatura ${f.cartaoNome}`} className="divide-y divide-slate-200">
          {compras.map((c) => (
            <li key={c.id} className="flex items-start justify-between gap-3 py-2">
              <IconeCategoria visual={visualPorId(c.categoriaId, categoriaPorId, 'expense')} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {c.descricao}
                  {c.deParcelas > 1 && <span className="ml-2 text-xs text-slate-500">parcela {c.parcela}/{c.deParcelas}</span>}
                </p>
                <p className="truncate text-xs text-slate-500">
                  <NomeCategoria id={c.categoriaId} categoriaPorId={categoriaPorId} nomeCategoria={nomeCategoria} />
                  {c.dataCompra ? ` · compra de ${formatDate(c.dataCompra)}` : ''}
                </p>
              </div>
              <span className="shrink-0 whitespace-nowrap tabular-nums text-sm font-semibold text-neutro">{formatBRL(c.valor)}</span>
            </li>
          ))}
        </ul>
      )}
      {/* créditos avulsos da fatura (estorno de IOF, cashback, reembolso): receita, já descontada do total da fatura pelo banco */}
      {!erro && compras !== null && creditos && creditos.length > 0 && (
        <>
          <h3 className="mt-3 text-xs font-semibold uppercase tracking-wide text-lucro">Créditos e reembolsos</h3>
          <ul aria-label={`Créditos e reembolsos da fatura ${f.cartaoNome}`} className="divide-y divide-slate-200">
            {creditos.map((k) => (
              <li key={k.id} className="flex items-start justify-between gap-3 py-2">
                <IconeCategoria visual={visualPorId(k.categoriaId, categoriaPorId, 'income')} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {k.descricao}
                    {k.planejado && <span className={`ml-2 rounded px-1.5 py-0.5 text-xs font-medium ${SELO.planejado}`}>Planejado</span>}
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    <NomeCategoria id={k.categoriaId} categoriaPorId={categoriaPorId} nomeCategoria={nomeCategoria} />
                    {` · crédito de ${formatDate(k.dataCredito)}`}
                  </p>
                </div>
                <span className="shrink-0 whitespace-nowrap tabular-nums text-sm font-semibold text-lucro">+{formatBRL(k.valor)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

