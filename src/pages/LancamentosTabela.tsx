import { Fragment, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Aviso } from '../components/ui/Aviso'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Field } from '../components/ui/Field'
import { MenuAcoes } from '../components/ui/MenuAcoes'
import type { AcaoMenu } from '../components/ui/MenuAcoes'
import { Selecao } from '../components/ui/Selecao'
import { opcoesDeCategoria } from '../lib/categorias'
import type { Categoria } from '../lib/categorias'
import type { ParcelaDivida } from '../lib/dividas'
import { mensagemErroBanco } from '../lib/erros'
import { formatBRL, formatDate, formatMoeda } from '../lib/format'
import type { Cents } from '../lib/format'
import {
  LIMITE_LOTE, listarComprasDaFatura, listarCreditosDaFaturaDoMes, marcarPagoEmLote, moverParaLixeiraEmLote, mudarCategoriaEmLote,
  restaurarDaLixeiraEmLote, voltarPlanejadoEmLote,
} from '../lib/lancamentos'
import type { CompraDaFatura, CreditoDeCartao, FaturaDoMes, Lancamento, MovimentoDivida, TipoLancamento } from '../lib/lancamentos'
import { IconeCategoria, visualPorId } from '../lib/visualCategoria'
import { hojeSP } from '../lib/contas'
import { SELO, SELO_FATURA, corDoTipo } from '../lib/cores'

export const rotuloTipo: Record<TipoLancamento, string> = { expense: 'Despesa', income: 'Receita', transfer: 'Transferência' }

/** Sinal e cor por tipo: receita "+", despesa "−", transferência "⇄" sem sinal (design system). Valor na moeda da conta. */
export function valorComSinal(l: Lancamento, moeda: string) {
  if (l.tipo === 'income') return { texto: `+${formatMoeda(l.valor, moeda)}`, cor: corDoTipo('income') }
  if (l.tipo === 'expense') return { texto: `−${formatMoeda(l.valor, moeda)}`, cor: corDoTipo('expense') }
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

/** Computador (a partir de lg = 1024px) mostra a tabela; celular e tablet continuam com a lista. Sem matchMedia: lista. */
export function useTelaGrande(consulta = '(min-width: 1024px)'): boolean {
  const suporta = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  const [grande, setGrande] = useState(() => suporta && window.matchMedia(consulta).matches)
  useEffect(() => {
    if (!suporta) return
    const m = window.matchMedia(consulta)
    const mudou = () => setGrande(m.matches)
    mudou()
    m.addEventListener?.('change', mudou)
    return () => m.removeEventListener?.('change', mudou)
  }, [consulta, suporta])
  return grande
}

type Situacao = 'pago' | 'planejado' | 'atencao' | 'vencido'
// cada situação tem ícone e nome (leitor de tela e title), não só a cor
const visualSituacao: Record<Situacao, { icone: string; texto: string; cor: string }> = {
  pago: { icone: '✓', texto: 'Pago', cor: SELO.pago },
  planejado: { icone: '◷', texto: 'Planejado', cor: SELO.planejado },
  atencao: { icone: '◔', texto: 'A pagar', cor: SELO.atencao },
  vencido: { icone: '!', texto: 'Vencido', cor: SELO.vencido },
}

function IconeSituacao({ s, texto }: { s: Situacao; texto?: string }) {
  const v = visualSituacao[s]
  const rotulo = texto ?? v.texto
  return (
    <span title={rotulo} className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold ${v.cor}`}>
      <span aria-hidden="true">{v.icone}</span>
      <span className="sr-only">{rotulo}</span>
    </span>
  )
}

type Ordem = { campo: 'data' | 'valor'; direcao: 'asc' | 'desc' }

/** Valor com o sinal que a linha mostra, só para ORDENAR a exibição (nada é somado). Transferência conta como saída. */
function valorParaOrdenar(it: ItemLista): number {
  switch (it.origem) {
    case 'lancamento': return it.l.tipo === 'income' ? it.l.valor : -it.l.valor
    case 'divida': return it.m.valor
    case 'fatura': return -it.f.total
    case 'cartao': return -it.c.valor
    case 'contrato': return -it.p.valor
    case 'credito': return it.k.valor
  }
}

function ordenar(itens: ItemLista[], o: Ordem): ItemLista[] {
  const sinal = o.direcao === 'asc' ? 1 : -1
  // sort é estável: no mesmo dia (ou mesmo valor) fica a ordem que a lista já tinha
  return [...itens].sort((a, b) => {
    if (o.campo === 'valor') return sinal * (valorParaOrdenar(a) - valorParaOrdenar(b))
    return a.data === b.data ? 0 : sinal * (a.data < b.data ? -1 : 1)
  })
}

type AcaoLote = 'categoria' | 'pago' | 'lixeira'

interface PropsTabela {
  itens: ItemLista[]
  hoje: string
  /** Muda com o mês e os filtros: a seleção é "do mês/filtro" e começa vazia em outro. */
  chaveSelecao: string
  categorias: Categoria[]
  nomeConta: Map<string, string>
  moedaConta: Map<string, string>
  nomeCategoria: Map<string, string>
  categoriaPorId: Map<string, Categoria>
  /** Outro painel aberto (editar/pagar): as ações por linha ficam desligadas. */
  ocupado: boolean
  aoEditar: (l: Lancamento) => void
  aoPagar: (l: Lancamento) => void
  aoExcluir: (l: Lancamento) => void
  /** Recarrega a lista e os totais (vêm do banco). */
  aoAlterar: () => Promise<void>
}

const quantos = (n: number) => (n === 1 ? '1 lançamento' : `${n} lançamentos`)
const alterados = (n: number) => (n === 1 ? '1 lançamento alterado' : `${n} lançamentos alterados`)

/**
 * Lançamentos no computador (pedido do dono, 05/11/2026, como no Mobills): tabela com seleção de vários e ações em lote
 * (mudar categoria, marcar como pago, lixeira). Cada ação é UMA chamada ao banco, tudo ou nada; a confirmação mostra só
 * a quantidade (o front não soma dinheiro). Depois, "Desfazer" por alguns segundos.
 */
export function TabelaLancamentos(p: PropsTabela) {
  const [ordem, setOrdem] = useState<Ordem>({ campo: 'data', direcao: 'desc' })
  const [sel, setSel] = useState<Set<string>>(new Set())
  const ancora = useRef<string | null>(null)
  const [acao, setAcao] = useState<AcaoLote | null>(null)
  const [categoriaNova, setCategoriaNova] = useState('')
  const [dataPago, setDataPago] = useState(p.hoje)
  const [enviando, setEnviando] = useState(false)
  const [erroLote, setErroLote] = useState('')
  const [desfazer, setDesfazer] = useState<{ texto: string; executar: () => Promise<void> } | null>(null)
  const [desfazendo, setDesfazendo] = useState(false)
  const [erroDesfazer, setErroDesfazer] = useState('')

  // outro mês ou outro filtro: começa sem seleção
  useEffect(() => { setSel(new Set()); setAcao(null); setErroLote(''); ancora.current = null }, [p.chaveSelecao])

  // o aviso de desfazer some sozinho (não enquanto desfaz)
  useEffect(() => {
    if (!desfazer || desfazendo) return
    const t = window.setTimeout(() => { setDesfazer(null); setErroDesfazer('') }, 10_000)
    return () => window.clearTimeout(t)
  }, [desfazer, desfazendo])

  const linhas = ordenar(p.itens, ordem)
  const lancamentos = linhas.flatMap((it) => (it.origem === 'lancamento' ? [it.l] : []))
  // seleção válida = só o que ainda está na lista (depois de recarregar, o que sumiu sai da seleção)
  const escolhidos = lancamentos.filter((l) => sel.has(l.id))
  const n = escolhidos.length
  const todos = lancamentos.length > 0 && n === lancamentos.length
  const tipos = new Set(escolhidos.map((l) => l.tipo))
  const tipoUnico = tipos.size === 1 ? [...tipos][0] : null
  const podeCategoria = tipoUnico === 'income' || tipoUnico === 'expense'
  const motivoSemCategoria = tipos.has('transfer') ? 'Transferência não tem categoria: tire as transferências da seleção.'
    : tipos.size > 1 ? 'Receita e despesa têm categorias diferentes: selecione só um dos tipos.' : ''
  const planejados = escolhidos.filter((l) => l.status === 'planned')
  const acimaDoLimite = n > LIMITE_LOTE

  useEffect(() => {
    if (sel.size === 0 && acao === null) return
    function tecla(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      const ativo = document.activeElement
      // Esc de um menu aberto ou de um painel por cima é deles
      if (ativo?.closest('[role="menu"]') || document.querySelector('[role="dialog"]')) return
      if (acao !== null) { setAcao(null); setErroLote(''); return }
      setSel(new Set())
      ancora.current = null
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [sel, acao])

  function alternar(id: string, intervalo: boolean) {
    // lida agora: o atualizador do setSel roda depois, quando a âncora já é o id novo
    const de = ancora.current
    setSel((atual) => {
      const novo = new Set(atual)
      const marcar = !atual.has(id)
      if (intervalo && de && de !== id) {
        const ids = lancamentos.map((l) => l.id)
        const [a, b] = [ids.indexOf(de), ids.indexOf(id)].sort((x, y) => x - y)
        if (a >= 0) {
          for (const x of ids.slice(a, b + 1)) { if (marcar) novo.add(x); else novo.delete(x) }
          return novo
        }
      }
      if (marcar) novo.add(id); else novo.delete(id)
      return novo
    })
    ancora.current = id
  }

  function alternarTodos() {
    setSel(todos ? new Set() : new Set(lancamentos.map((l) => l.id)))
    ancora.current = null
  }

  function abrir(a: AcaoLote) {
    setErroLote('')
    setAcao(a)
    if (a === 'categoria') setCategoriaNova('')
    if (a === 'pago') setDataPago(p.hoje)
  }

  async function confirmar() {
    if (acao === 'categoria' && !categoriaNova) { setErroLote('Escolha a nova categoria.'); return }
    if (acao === 'pago' && !dataPago) { setErroLote('Informe a data do pagamento.'); return }
    setEnviando(true)
    setErroLote('')
    try {
      let feito: { texto: string; executar: () => Promise<void> }
      if (acao === 'categoria') {
        // guarda as categorias de antes para o desfazer (uma chamada por categoria antiga)
        const antes = new Map<string, string[]>()
        for (const l of escolhidos) {
          if (!l.categoriaId || l.categoriaId === categoriaNova) continue
          antes.set(l.categoriaId, [...(antes.get(l.categoriaId) ?? []), l.id])
        }
        const qtd = await mudarCategoriaEmLote(escolhidos.map((l) => l.id), categoriaNova)
        // atalho: o desfazer de categoria é uma chamada por categoria antiga (não é uma operação só); se uma falhar,
        // as anteriores já voltaram e o aviso mostra o erro (pode tentar de novo). Melhorar com uma função de pares no banco.
        feito = { texto: alterados(qtd), executar: async () => { for (const [cat, ids] of antes) await mudarCategoriaEmLote(ids, cat) } }
      } else if (acao === 'pago') {
        const ids = planejados.map((l) => l.id)
        const datas = planejados.map((l) => l.data)
        const qtd = await marcarPagoEmLote(ids, dataPago)
        feito = { texto: alterados(qtd), executar: async () => { await voltarPlanejadoEmLote(ids, datas) } }
      } else {
        const ids = escolhidos.map((l) => l.id)
        const qtd = await moverParaLixeiraEmLote(ids)
        feito = { texto: `${quantos(qtd)} na lixeira`, executar: async () => { await restaurarDaLixeiraEmLote(ids) } }
      }
      setAcao(null)
      setSel(new Set())
      ancora.current = null
      setErroDesfazer('')
      setDesfazer(feito)
      await p.aoAlterar()
    } catch (err) {
      // a seleção fica: a pessoa corrige (ou tira o item recusado) e tenta de novo
      setErroLote(mensagemErroBanco(err))
    } finally {
      setEnviando(false)
    }
  }

  async function executarDesfazer() {
    if (!desfazer) return
    setDesfazendo(true)
    setErroDesfazer('')
    try {
      await desfazer.executar()
      setDesfazer(null)
      await p.aoAlterar()
    } catch (err) {
      setErroDesfazer(mensagemErroBanco(err))
    } finally {
      setDesfazendo(false)
    }
  }

  const ariaSort = (campo: Ordem['campo']) => (ordem.campo !== campo ? 'none' : ordem.direcao === 'asc' ? 'ascending' : 'descending')
  const ordenarPor = (campo: Ordem['campo']) => setOrdem((o) => (o.campo === campo
    ? { campo, direcao: o.direcao === 'asc' ? 'desc' : 'asc' } : { campo, direcao: 'desc' }))
  const seta = (campo: Ordem['campo']) => (ordem.campo !== campo ? '↕' : ordem.direcao === 'asc' ? '↑' : '↓')
  const categoriasDoTipo = p.categorias.filter((c) => c.tipo === tipoUnico && c.ativa)

  return (
    <div className="flex flex-col gap-3">
      {desfazer && (
        <div className="flex flex-wrap items-center gap-3" role="status" aria-live="polite">
          <span className="rounded-lg bg-azul-claro px-4 py-3 text-sm text-marinho">{desfazer.texto}.</span>
          <Button variante="fantasma" onClick={executarDesfazer} carregando={desfazendo}>Desfazer</Button>
          {erroDesfazer && <Aviso tipo="erro">Não foi possível desfazer: {erroDesfazer}</Aviso>}
        </div>
      )}

      {n > 0 && (
        <section aria-label="Ações em lote" className="sticky top-0 z-30 flex flex-wrap items-center gap-2 rounded-xl border border-azul/30 bg-white px-4 py-2 shadow-card">
          <p className="mr-2 font-semibold text-marinho" aria-live="polite">{n === 1 ? '1 selecionado' : `${n} selecionados`}</p>
          <Button variante="secundario" compacto onClick={() => abrir('categoria')} disabled={!podeCategoria || enviando || acimaDoLimite}
            title={motivoSemCategoria || undefined}>Mudar categoria</Button>
          <Button variante="secundario" compacto onClick={() => abrir('pago')} disabled={planejados.length === 0 || enviando || acimaDoLimite}
            title={planejados.length === 0 ? 'Nenhum planejado na seleção.' : undefined}>Marcar como pago</Button>
          <Button variante="discreto" compacto onClick={() => abrir('lixeira')} disabled={enviando || acimaDoLimite}>Excluir</Button>
          <Button variante="fantasma" compacto onClick={() => { setSel(new Set()); setAcao(null); ancora.current = null }}>Limpar seleção</Button>
          {!podeCategoria && motivoSemCategoria && <p className="w-full text-xs text-slate-500">{motivoSemCategoria}</p>}
          {acimaDoLimite && <p className="w-full text-xs text-negativo">No máximo {LIMITE_LOTE} lançamentos por vez.</p>}
        </section>
      )}

      {acao !== null && n > 0 && (
        <Card>
          <h2 className="mb-2 text-lg font-semibold" id="titulo-confirmar-lote">
            {acao === 'categoria' ? `Mudar a categoria de ${quantos(n)}`
              : acao === 'pago' ? `Marcar ${quantos(planejados.length)} como ${planejados.length === 1 ? 'pago' : 'pagos'}`
              : `Enviar ${quantos(n)} para a lixeira`}
          </h2>
          <div className="flex flex-col gap-3" role="group" aria-labelledby="titulo-confirmar-lote">
            {acao === 'categoria' && (
              <Selecao rotulo={`Nova categoria (${tipoUnico === 'income' ? 'receita' : 'despesa'})`} valor={categoriaNova} aoMudar={setCategoriaNova}
                opcoes={opcoesDeCategoria(categoriasDoTipo, p.categorias).map((o) => [o.id, o.rotulo])} todos="Escolha…" />
            )}
            {acao === 'pago' && (
              <>
                <p className="text-sm text-slate-600">
                  {planejados.length < n ? `${quantos(n - planejados.length)} da seleção já ${n - planejados.length === 1 ? 'está pago' : 'estão pagos'} e não muda. ` : ''}
                  O valor de cada um continua o planejado; se algum saiu diferente, use "Marcar pago" naquele lançamento.
                </p>
                <Field rotulo="Data do pagamento" type="date" value={dataPago} onChange={(e) => setDataPago(e.target.value)} />
              </>
            )}
            {acao === 'lixeira' && <p className="text-sm text-slate-600">Eles vão para a lixeira e podem ser restaurados (há "Desfazer" logo depois).</p>}
            <p className="text-sm text-slate-600">É uma operação só: ou todos mudam, ou nenhum.</p>
            {erroLote && <Aviso tipo="erro">{erroLote}</Aviso>}
            <div className="flex gap-2">
              <Button variante={acao === 'lixeira' ? 'perigo' : 'primario'} onClick={confirmar} carregando={enviando}>
                {acao === 'lixeira' ? 'Enviar para a lixeira' : 'Confirmar'}
              </Button>
              <Button variante="secundario" onClick={() => { setAcao(null); setErroLote('') }} disabled={enviando}>Cancelar</Button>
            </div>
          </div>
        </Card>
      )}

      {linhas.length > 0 && (
        <Card semPadding>
          <table className="w-full text-sm">
            <caption className="sr-only">Lançamentos do mês. Espaço marca a linha, Shift+clique marca um intervalo, Esc limpa a seleção.</caption>
            <thead className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th scope="col" className="w-12 px-4 py-2">
                  <input type="checkbox" className="h-5 w-5 accent-azul" aria-label="Selecionar todos os lançamentos do mês e filtro"
                    checked={todos} disabled={lancamentos.length === 0}
                    ref={(el) => { if (el) el.indeterminate = n > 0 && !todos }} onChange={alternarTodos} />
                </th>
                <th scope="col" className="w-16 px-2 py-2">Situação</th>
                <th scope="col" aria-sort={ariaSort('data')} className="px-2 py-2">
                  <button type="button" onClick={() => ordenarPor('data')} className="inline-flex min-h-11 items-center gap-1 font-semibold uppercase hover:text-marinho">
                    Data <span aria-hidden="true">{seta('data')}</span>
                  </button>
                </th>
                <th scope="col" className="px-2 py-2">Descrição</th>
                <th scope="col" className="px-2 py-2">Categoria</th>
                <th scope="col" className="px-2 py-2">Conta</th>
                <th scope="col" aria-sort={ariaSort('valor')} className="px-2 py-2 text-right">
                  <button type="button" onClick={() => ordenarPor('valor')} className="inline-flex min-h-11 items-center gap-1 font-semibold uppercase hover:text-marinho">
                    Valor <span aria-hidden="true">{seta('valor')}</span>
                  </button>
                </th>
                <th scope="col" className="w-16 px-2 py-2"><span className="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {linhas.map((it) => (it.origem === 'fatura'
                ? <LinhaFaturaTabela key={`fatura-${it.f.cartaoId}-${it.f.mes}`} f={it.f} categoriaPorId={p.categoriaPorId} nomeCategoria={p.nomeCategoria} />
                : it.origem === 'lancamento'
                  ? <LinhaLancamento key={it.l.id} l={it.l} p={p} marcado={sel.has(it.l.id)} aoAlternar={alternar} />
                  : <LinhaSoLeitura key={`${it.origem}-${chaveItem(it)}`} it={it} p={p} />))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}

function chaveItem(it: ItemLista): string {
  switch (it.origem) {
    case 'lancamento': return it.l.id
    case 'divida': return it.m.id
    case 'fatura': return `${it.f.cartaoId}-${it.f.mes}`
    case 'cartao': return it.c.id
    case 'contrato': return it.p.id
    case 'credito': return it.k.id
  }
}

const td = 'px-2 py-2 align-middle'
const linkAcao = 'inline-flex min-h-11 items-center rounded-lg px-2 text-sm font-semibold text-azul hover:bg-azul-claro'

function CelulaCategoria({ icone, nome }: { icone: ReactNode; nome: ReactNode }) {
  return <span className="flex items-center gap-2">{icone}<span className="truncate">{nome}</span></span>
}

function LinhaLancamento({ l, p, marcado, aoAlternar }: {
  l: Lancamento; p: PropsTabela; marcado: boolean; aoAlternar: (id: string, intervalo: boolean) => void
}) {
  const v = valorComSinal(l, p.moedaConta.get(l.contaId) ?? 'BRL')
  const situacao: Situacao = l.status === 'paid' ? 'pago' : l.data < p.hoje ? 'vencido' : 'planejado'
  const nome = l.descricao || rotuloTipo[l.tipo]
  const acoes: AcaoMenu[] = [
    ...(l.status === 'planned' ? [{ rotulo: 'Marcar pago', aoEscolher: () => p.aoPagar(l), desabilitado: p.ocupado }] : []),
    { rotulo: 'Editar', aoEscolher: () => p.aoEditar(l) },
    { rotulo: 'Excluir', aoEscolher: () => p.aoExcluir(l), perigo: true },
  ]
  return (
    <tr tabIndex={0} className={`focus:outline focus:outline-2 focus:-outline-offset-2 focus:outline-azul ${marcado ? 'bg-azul-claro/60' : 'hover:bg-slate-50'}`}
      onKeyDown={(e) => { if (e.key === ' ' && e.target === e.currentTarget) { e.preventDefault(); aoAlternar(l.id, false) } }}>
      <td className="px-4 py-2 align-middle">
        <input type="checkbox" className="h-5 w-5 accent-azul" aria-label={`Selecionar ${nome}`} checked={marcado}
          onChange={(e) => aoAlternar(l.id, (e.nativeEvent as MouseEvent).shiftKey === true)} />
      </td>
      <td className={td}><IconeSituacao s={situacao} /></td>
      <td className={`${td} whitespace-nowrap tabular-nums`}>{formatDate(l.data)}</td>
      <td className={td}>
        <span className="font-medium">{nome}</span>
        {l.recorrente && <span className="ml-2 text-xs text-slate-500" title="Gerado por um recorrente">↻ recorrente</span>}
      </td>
      <td className={td}>
        {l.tipo === 'transfer'
          ? <CelulaCategoria icone={<IconeCategoria fixo="transferencia" tamanho="pequeno" />} nome="Transferência" />
          : <CelulaCategoria icone={<IconeCategoria visual={visualPorId(l.categoriaId, p.categoriaPorId, l.tipo)} tamanho="pequeno" />}
              nome={<NomeCategoria id={l.categoriaId} categoriaPorId={p.categoriaPorId} nomeCategoria={p.nomeCategoria} />} />}
      </td>
      <td className={td}>
        {l.tipo === 'transfer'
          ? `${p.nomeConta.get(l.contaId) ?? '?'} → ${p.nomeConta.get(l.destinoId ?? '') ?? '?'}`
          : p.nomeConta.get(l.contaId) ?? '?'}
      </td>
      <td className={`${td} whitespace-nowrap text-right tabular-nums font-semibold ${v.cor}`}>{v.texto}</td>
      <td className={`${td} text-right`}><MenuAcoes rotulo={`Ações de ${nome}`} acoes={acoes} /></td>
    </tr>
  )
}

/** Linhas que não são `transactions` (cartão, dívida, contrato, crédito): sem seleção, com o link para a tela delas. */
function LinhaSoLeitura({ it, p }: { it: Exclude<ItemLista, { origem: 'lancamento' } | { origem: 'fatura' }>; p: PropsTabela }) {
  let situacao: Situacao; let rotuloSituacao: string | undefined; let descricao: ReactNode; let categoria: ReactNode
  let conta: string; let valor: { texto: string; cor: string }; let acao: ReactNode
  if (it.origem === 'cartao') {
    const c = it.c
    situacao = 'pago'; rotuloSituacao = 'No cartão'
    descricao = <>{c.descricao}{c.deParcelas > 1 && <span className="ml-2 text-xs text-slate-500">parcela {c.parcela}/{c.deParcelas}</span>}
      <span className="block text-xs text-slate-500">a despesa conta em {formatDate(c.fechamento)} (fechamento da fatura)</span></>
    categoria = <CelulaCategoria icone={<IconeCategoria visual={visualPorId(c.categoriaId, p.categoriaPorId, 'expense')} tamanho="pequeno" />}
      nome={<NomeCategoria id={c.categoriaId} categoriaPorId={p.categoriaPorId} nomeCategoria={p.nomeCategoria} />} />
    conta = `Fatura ${c.cartaoNome}`
    valor = { texto: formatBRL(c.valor), cor: 'text-neutro' }
    acao = <Link to={`/cartoes?cartao=${c.cartaoId}`} className={linkAcao}>Ver em Cartões</Link>
  } else if (it.origem === 'credito') {
    const k = it.k
    situacao = k.planejado ? 'planejado' : 'pago'
    descricao = <>{k.descricao}<span className="block text-xs text-slate-500">Crédito no cartão{k.vencimento ? ` · fatura ${k.cartaoNome}` : ''} · a receita conta em {formatDate(k.data)}</span></>
    categoria = <CelulaCategoria icone={<IconeCategoria visual={visualPorId(k.categoriaId, p.categoriaPorId, 'income')} tamanho="pequeno" />}
      nome={<NomeCategoria id={k.categoriaId} categoriaPorId={p.categoriaPorId} nomeCategoria={p.nomeCategoria} />} />
    conta = k.cartaoNome
    valor = { texto: `+${formatBRL(k.valor)}`, cor: corDoTipo('income') }
    acao = <Link to="/cartoes" className={linkAcao}>Ver em Cartões</Link>
  } else if (it.origem === 'contrato') {
    const c = it.p
    situacao = c.vencimento < p.hoje ? 'vencido' : 'planejado'
    descricao = <>{c.nomeDivida} · parcela {c.numero}<span className="block text-xs text-slate-500">Contrato · só entra no saldo quando você der baixa</span></>
    categoria = <CelulaCategoria icone={<IconeCategoria fixo="cartao" tamanho="pequeno" />} nome="Contrato" />
    conta = c.formaPagamento === 'account_debit' ? p.nomeConta.get(c.contaPagamentoId ?? '') ?? 'conta' : '—'
    valor = { texto: `−${formatBRL(c.valor)}`, cor: 'text-neutro' }
    acao = <Link to={`/dividas?baixar=${c.id}`} aria-label={`Baixar parcela ${c.numero} de ${c.nomeDivida}`} className={linkAcao}>Baixar</Link>
  } else {
    const m = it.m
    situacao = 'pago'
    descricao = <>{m.descricao}<span className="block text-xs text-slate-500">{m.jaEmDespesas ? 'Cartão/dívida · já em despesas' : 'Cartão/dívida'}</span></>
    categoria = <CelulaCategoria icone={<IconeCategoria fixo="cartao" tamanho="pequeno" />} nome="Cartão/dívida" />
    conta = p.nomeConta.get(m.contaId) ?? '?'
    valor = { texto: `${m.valor < 0 ? '−' : '+'}${formatBRL(Math.abs(m.valor) as Cents)}`, cor: m.valor < 0 ? 'text-neutro' : 'text-lucro' }
    acao = <Link to="/cartoes" className={linkAcao}>Ver em Cartões</Link>
  }
  return (
    <tr className="hover:bg-slate-50">
      <td className="px-4 py-2" />
      <td className={td}><IconeSituacao s={situacao} texto={rotuloSituacao} /></td>
      <td className={`${td} whitespace-nowrap tabular-nums`}>{formatDate(it.data)}</td>
      <td className={td}><span className="font-medium">{descricao}</span></td>
      <td className={td}>{categoria}</td>
      <td className={td}>{conta}</td>
      <td className={`${td} whitespace-nowrap text-right tabular-nums font-semibold ${valor.cor}`}>{valor.texto}</td>
      <td className={`${td} text-right`}>{acao}</td>
    </tr>
  )
}

const situacaoDaFaturaNaTabela: Record<FaturaDoMes['situacao'], Situacao> = { aberta: 'planejado', fechada: 'atencao', vencida: 'vencido', paga: 'pago' }

/** A linha "Fatura <cartão>" (PR #164): total e situação do banco, sem seleção; "Ver compras" abre as parcelas embaixo. */
function LinhaFaturaTabela({ f, categoriaPorId, nomeCategoria }: { f: FaturaDoMes; categoriaPorId: Map<string, Categoria>; nomeCategoria: Map<string, string> }) {
  const { aberto, compras, creditos, erro, alternar, idLista } = useComprasDaFatura(f)
  const s = rotuloSituacaoFatura[f.situacao]
  const quando = resumoDaFatura(f)
  return (
    <Fragment>
      <tr className="hover:bg-slate-50">
        <td className="px-4 py-2" />
        <td className={td}><IconeSituacao s={situacaoDaFaturaNaTabela[f.situacao]} texto={`Fatura ${s.texto.toLowerCase()}`} /></td>
        <td className={`${td} whitespace-nowrap tabular-nums`}>{formatDate(f.vencimento)}</td>
        <td className={td}>
          <span className="font-medium">Fatura {f.cartaoNome}</span>
          <span className={`ml-2 rounded px-2 py-0.5 text-xs font-medium ${s.estilo}`}>{s.texto}</span>
          {(quando || (f.pago > 0 && f.situacao !== 'paga')) && (
            <span className="block text-xs text-slate-500">
              {[quando, f.pago > 0 && f.situacao !== 'paga' ? `pago ${formatBRL(f.pago)}` : null].filter(Boolean).join(' · ')}
            </span>
          )}
        </td>
        <td className={td}><CelulaCategoria icone={<IconeCategoria fixo="cartao" tamanho="pequeno" />} nome="Cartão de crédito" /></td>
        <td className={td}>{f.cartaoNome}</td>
        <td className={`${td} whitespace-nowrap text-right tabular-nums font-semibold text-neutro`}>{formatBRL(f.total)}</td>
        <td className={`${td} whitespace-nowrap text-right`}>
          <Button variante="fantasma" compacto onClick={alternar} aria-expanded={aberto} aria-controls={idLista}>
            {aberto ? 'Esconder compras' : 'Ver compras'}
          </Button>
          <Link to={`/cartoes?cartao=${f.cartaoId}`} aria-label={`Ver fatura ${f.cartaoNome} em Cartões`} className={linkAcao}>Cartões</Link>
        </td>
      </tr>
      {aberto && (
        <tr>
          <td colSpan={8} className="px-4 pb-3">
            <ComprasDaFatura f={f} compras={compras} creditos={creditos} erro={erro} idLista={idLista} categoriaPorId={categoriaPorId} nomeCategoria={nomeCategoria} />
          </td>
        </tr>
      )}
    </Fragment>
  )
}
