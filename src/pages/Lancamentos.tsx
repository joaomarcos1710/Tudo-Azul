import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Aviso } from '../components/ui/Aviso'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { EmptyState } from '../components/ui/EmptyState'
import { Field } from '../components/ui/Field'
import { Folha } from '../components/ui/Folha'
import { useFocoPreso } from '../components/ui/useFocoPreso'
import { Selecao } from '../components/ui/Selecao'
import { MenuAcoes } from '../components/ui/MenuAcoes'
import type { AcaoMenu } from '../components/ui/MenuAcoes'
import { Link, useSearchParams } from 'react-router-dom'
import { useFamilia } from '../lib/FamiliaContext'
import { atualizarAutomaticos } from '../lib/automaticos'
import { listarCategorias, nomesCompletos, opcoesDeCategoria } from '../lib/categorias'
import { listarCartoes, novaChave, registrarCompra, rotaFatura } from '../lib/cartoes'
import type { Cartao } from '../lib/cartoes'
import type { Categoria } from '../lib/categorias'
import { IconeCategoria, visualPorId } from '../lib/visualCategoria'
import { IconeCalendario, IconeCartoes, IconeCategorias, IconeContas, IconeTransferir } from '../components/layout/icons'
import { lembrarEscolha, ultimaEscolha } from '../lib/ultimaEscolha'
import { aceitaLancamento, hojeSP, listarContas, mesmaMoeda } from '../lib/contas'
import type { Conta } from '../lib/contas'
import { mensagemErroBanco } from '../lib/erros'
import { currentMonth, formatBRL, formatBRLCampo, formatDate, formatMoeda, formatMonth, parseBRL, primeiraMaiuscula, simboloMoeda } from '../lib/format'
import type { Cents } from '../lib/format'
import {
  criarLancamento, criarParcelado, editarEsteEProximos, editarLancamento, limitesDoMes, listarComprasDasFaturas, listarCreditosDasFaturas, listarCreditosDeCartao, listarFaturasDoMes, listarLancamentos,
  listarMovimentosDeDivida, marcarComoPago,
  moverParaLixeira, perguntaSeRepete, restaurarDaLixeira, resumoDoMes, resumoPorMoeda, somarMeses, valoresDasParcelas,
} from '../lib/lancamentos'
// import à parte para não conflitar com outras branches que mexem na lista acima
import { situacaoDoLancamento } from '../lib/lancamentos'
import { listarParcelasDivida } from '../lib/dividas'
import type { ParcelaDivida } from '../lib/dividas'
import type { CompraDaFatura, CreditoDeCartao, DadosLancamento, FaturaDoMes, Filtros, Lancamento, MovimentoDivida, ResumoMes, ResumoPorMoeda, StatusLancamento, TipoLancamento } from '../lib/lancamentos'
import { ResultadoEmOutrasMoedas } from '../components/ui/EmOutrasMoedas'
import { CabecalhoPagina } from '../components/ui/CabecalhoPagina'
import { ComprasDaFatura, NomeCategoria, TabelaLancamentos, resumoDaFatura, rotuloSituacaoFatura, rotuloTipo, useComprasDaFatura, useTelaGrande, valorComSinal } from './LancamentosTabela'
import type { ItemLista } from './LancamentosTabela'
import { criarRecorrencia, definirPessoaRecorrencia, frequencias } from '../lib/recorrencias'
import { SELO, corDoValor } from '../lib/cores'
import { PessoaSelectField } from '../components/PessoaSelectField'
import { listarPessoasFamilia } from '../lib/pessoasFamilia'
import { useAuth } from '../lib/auth'
import type { PessoaFamilia } from '../lib/pessoasFamilia'

const totalCard = 'flex items-start justify-between gap-3 px-4 py-3 sm:block sm:p-5'
const totalRotulo = 'shrink-0 text-sm text-slate-500'
const totalValor = 'whitespace-nowrap tabular-nums text-base font-bold sm:text-xl'

export default function Lancamentos() {
  const { familia } = useFamilia()
  const familiaId = familia?.id
  const [params, setParams] = useSearchParams()
  // links do painel: ?mes=AAAA-MM abre o mês; ?novo=despesa|receita|transferencia|cartao abre o formulário já preenchido com o tipo
  const [mes, setMes] = useState(() => {
    const m = params.get('mes')
    return m && /^20\d\d-(0[1-9]|1[0-2])$/.test(m) ? m : currentMonth()
  })
  const [inicial, setInicial] = useState<InicialForm | undefined>(undefined)
  // ?tipo=receita|despesa (avisos do Início): abre já filtrado pelo tipo; o filtro continua editável na tela
  const [filtros, setFiltros] = useState<Filtros>(() => {
    const tipo = ({ receita: 'income', despesa: 'expense' } as Record<string, TipoLancamento>)[params.get('tipo') ?? '']
    return tipo ? { tipo } : {}
  })
  const [lancamentos, setLancamentos] = useState<Lancamento[] | null>(null)
  const [movimentosDivida, setMovimentosDivida] = useState<MovimentoDivida[]>([])
  // parcelas do contrato (empréstimo/financiamento) ainda planejadas no mês: só mostram, não entram em total nenhum
  const [parcelasContrato, setParcelasContrato] = useState<ParcelaDivida[]>([])
  // fatura do cartão: uma linha por fatura no dia do vencimento (total do banco); com filtro de categoria, as compras soltas
  const [faturas, setFaturas] = useState<FaturaDoMes[]>([])
  const [comprasCategoria, setComprasCategoria] = useState<CompraDaFatura[]>([])
  // crédito avulso no cartão (receita, migration 052): só mostra; o valor já está nos totais do mês
  const [creditosCartao, setCreditosCartao] = useState<CreditoDeCartao[]>([])
  const [cartoes, setCartoes] = useState<Cartao[]>([])
  const [comprasFalharam, setComprasFalharam] = useState(false)
  const [resumo, setResumo] = useState<ResumoMes | null>(null)
  // receitas e despesas pagas em outras moedas (multimoeda F2): à parte, nunca somadas ao resumo em reais
  const [porMoeda, setPorMoeda] = useState<ResumoPorMoeda[]>([])
  const [contas, setContas] = useState<Conta[]>([])
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [erro, setErro] = useState('')
  const [editando, setEditando] = useState<Lancamento | 'novo' | null>(null)
  // Renderização progressiva: mantém o mês completo no estado, mas limita o DOM a 50 linhas por etapa.
  const [limiteVisivel, setLimiteVisivel] = useState(50)
  useEffect(() => { setLimiteVisivel(50) }, [mes, filtros.contaId, filtros.tipo, filtros.categoriaId])

  /** Categorias oferecidas no filtro: só as do tipo escolhido; transferência não tem categoria. */
  const categoriasDoFiltro = filtros.tipo === 'transfer' ? [] : categorias.filter((c) => !filtros.tipo || c.tipo === filtros.tipo)
  /** Trocar o tipo limpa a categoria que deixou de combinar (e a de qualquer categoria, em transferência); o resto do filtro fica. */
  function mudarTipoDoFiltro(v: string) {
    const tipo = (v || undefined) as TipoLancamento | undefined
    const categoria = categorias.find((c) => c.id === filtros.categoriaId)
    const incompativel = tipo === 'transfer' || (tipo !== undefined && categoria !== undefined && categoria.tipo !== tipo)
    setFiltros({ ...filtros, tipo, categoriaId: incompativel ? undefined : filtros.categoriaId })
  }
  const [naLixeira, setNaLixeira] = useState<Lancamento | null>(null)
  const [pagando, setPagando] = useState<Lancamento | null>(null)

  useEffect(() => {
    const novo = params.get('novo')
    if (!novo || contas.length === 0) return
    const tipo = ({ despesa: 'expense', receita: 'income', transferencia: 'transfer', cartao: 'cartao' } as Record<string, InicialForm>)[novo]
    // não atropela um lançamento que já está sendo editado
    if (tipo && editando === null) { setInicial(tipo); setEditando('novo') }
    setParams((p) => { const n = new URLSearchParams(p); n.delete('novo'); return n }, { replace: true })
  }, [params, contas.length, setParams, editando])

  // atalhos de teclado como no Organizze: D despesa, R receita, T transferência, C compra no cartão (fora de campos de texto)
  useEffect(() => {
    if (editando !== null || contas.length === 0) return
    function tecla(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return
      const alvo = e.target as HTMLElement | null
      if (alvo && (alvo.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(alvo.tagName))) return
      const t = ATALHOS[e.key.toLowerCase()]
      if (!t) return
      e.preventDefault()
      setInicial(t)
      setEditando('novo')
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [editando, contas.length])

  // gera os recorrentes uma vez ao abrir a tela; depois recarrega a lista
  const [automaticosProntos, setAutomaticosProntos] = useState(false)
  const [avisoAutomaticos, setAvisoAutomaticos] = useState('')
  useEffect(() => {
    if (!familiaId) return
    void atualizarAutomaticos().then((r) => {
      // sem este aviso, planejados e parcelas de cartão poderiam faltar na lista sem ninguém perceber
      setAvisoAutomaticos(
        !r.faturasOk ? 'Não foi possível fechar as faturas dos cartões agora; compras de cartão podem faltar. Tente de novo em instantes.'
        : !r.recorrentesOk ? 'Não foi possível lançar os recorrentes agora; contas mensais e assinaturas podem faltar. Tente de novo em instantes.'
        : '',
      )
      setAutomaticosProntos(true)
    })
  }, [familiaId])

  useEffect(() => {
    if (!familiaId) return
    Promise.all([listarContas(familiaId), listarCategorias(familiaId)])
      .then(([c, cat]) => { setContas(c.contas); setCategorias(cat) })
      .catch((err) => setErro(mensagemErroBanco(err)))
    // cartões à parte: falha deles não tira contas e categorias da tela
    listarCartoes(familiaId).then(setCartoes).catch(() => setCartoes([]))
  }, [familiaId])

  // só a resposta do último pedido vale: trocar de mês ou de filtro rápido não pode deixar a lista de um mês sob o título de outro
  const pedido = useRef(0)
  const carregar = useCallback(async () => {
    if (!familiaId || !automaticosProntos) return
    const meu = ++pedido.current
    try {
      // faturas do cartão carregam à parte: se falharem, a lista de conta continua e só este bloco avisa.
      // Com filtro de categoria, as compras e os créditos daquela categoria saem um a um (o total da fatura mistura categorias).
      const categoria = filtros.categoriaId
      const hoje = hojeSP()
      const cartao = listarFaturasDoMes(familiaId, mes, filtros, hoje)
        .then(async (fs) => (categoria
          ? {
              faturas: [], compras: await listarComprasDasFaturas(fs, categoria),
              // falha nos créditos não tira as compras da tela
              creditos: await listarCreditosDasFaturas(fs, categoria, hoje).catch(() => [] as CreditoDeCartao[]),
            }
          : { faturas: fs, compras: [], creditos: [] as CreditoDeCartao[] }))
        .catch(() => null)
      // parcela de contrato não tem categoria nem é receita/transferência; com filtro de conta, só as debitadas nela
      const [deMes, ateMes] = limitesDoMes(mes)
      const parcelas = filtros.categoriaId || (filtros.tipo && filtros.tipo !== 'expense')
        ? Promise.resolve([] as ParcelaDivida[])
        : listarParcelasDivida(familiaId, deMes, ateMes).catch(() => [] as ParcelaDivida[])
            .then((ps) => (filtros.contaId ? ps.filter((p) => p.contaPagamentoId === filtros.contaId) : ps))
      // créditos do cartão (decisão do dono, 05/11/2026): sem filtro ficam DENTRO da fatura; soltos só com filtro de Receita
      // (no fechamento, o dia em que contam; a fatura não aparece em Receita, então não duplica) ou de categoria (acima).
      // Falha nos créditos não derruba a lista.
      const creditos = filtros.tipo === 'income'
        ? listarCreditosDeCartao(familiaId, mes, filtros, hoje).catch(() => [] as CreditoDeCartao[])
        : Promise.resolve([] as CreditoDeCartao[])
      // o bloco em outras moedas é à parte: se falhar, a lista e os totais em reais continuam
      const porMoedaDoMes = resumoPorMoeda(familiaId, deMes, ateMes).catch(() => [] as ResumoPorMoeda[])
      const [l, r, md, cc, pc, cr, pm] = await Promise.all([
        listarLancamentos(familiaId, mes, filtros), resumoDoMes(familiaId, mes), listarMovimentosDeDivida(familiaId, mes, filtros), cartao, parcelas,
        creditos, porMoedaDoMes,
      ])
      if (meu !== pedido.current) return
      setLancamentos(l)
      setMovimentosDivida(md)
      setParcelasContrato(pc)
      setCreditosCartao([...cr, ...(cc?.creditos ?? [])])
      setFaturas(cc?.faturas ?? [])
      setComprasCategoria(cc?.compras ?? [])
      setComprasFalharam(cc === null)
      setResumo(r)
      setPorMoeda(pm)
      setErro('')
    } catch (err) {
      if (meu === pedido.current) setErro(mensagemErroBanco(err))
    }
  }, [familiaId, mes, filtros, automaticosProntos])

  useEffect(() => { void carregar() }, [carregar])

  const nomeConta = useMemo(() => new Map(contas.map((c) => [c.id, c.nome])), [contas])
  const moedaConta = useMemo(() => new Map(contas.map((c) => [c.id, c.moeda ?? 'BRL'])), [contas])
  const nomeCategoria = useMemo(() => nomesCompletos(categorias), [categorias])
  const categoriaPorId = useMemo(() => new Map(categorias.map((c) => [c.id, c])), [categorias])
  // computador (lg): tabela com seleção de vários; celular: a lista por dia de sempre
  const telaGrande = useTelaGrande()

  async function agir(acao: () => Promise<void>) {
    try {
      await acao()
      await carregar()
    } catch (err) {
      setErro(mensagemErroBanco(err))
    }
  }

  async function excluir(l: Lancamento) {
    if (!window.confirm(`Enviar "${l.descricao || rotuloTipo[l.tipo]}" de ${formatMoeda(l.valor, moedaConta.get(l.contaId) ?? 'BRL')} para a lixeira?`)) return
    await agir(async () => { await moverParaLixeira(l.id); setNaLixeira(l) })
  }

  if (!familiaId) return null

  // agrupa por dia (mais recente primeiro); no mesmo dia, lançamentos antes dos movimentos de cartão/dívida
  type Item = ItemLista
  const itens: ItemLista[] = [
    ...(lancamentos ?? []).map((l) => ({ origem: 'lancamento' as const, l, data: l.data })),
    ...movimentosDivida.map((m) => ({ origem: 'divida' as const, m, data: m.data })),
    ...faturas.map((f) => ({ origem: 'fatura' as const, f, data: f.vencimento })),
    ...comprasCategoria.map((c) => ({ origem: 'cartao' as const, c, data: c.vencimento })),
    ...parcelasContrato.map((p) => ({ origem: 'contrato' as const, p, data: p.vencimento })),
    ...creditosCartao.map((k) => ({ origem: 'credito' as const, k, data: k.vencimento ?? k.data })),
  ].sort((x, y) => (x.data < y.data ? 1 : x.data > y.data ? -1 : 0))
  const hoje = hojeSP()
  const itensVisiveis = itens.slice(0, limiteVisivel)
  const porDia: [string, Item[]][] = []
  for (const it of itensVisiveis) {
    const ultimo = porDia[porDia.length - 1]
    if (ultimo && ultimo[0] === it.data) ultimo[1].push(it)
    else porDia.push([it.data, [it]])
  }

  return (
    <>
      <CabecalhoPagina titulo="Lançamentos" descricao="Receitas, despesas e transferências do mês, pagas e planejadas."
        // sempre montado: com o painel aberto ele fica atrás do fundo escuro e recebe o foco de volta quando o painel fecha
        acoes={<MenuNovo desabilitado={contas.length === 0} aoEscolher={(t) => { setInicial(t); setEditando('novo') }} />} />

      {contas.length === 0 && lancamentos !== null && (
        <div className="mb-4"><Aviso tipo="info">Cadastre uma conta em <strong>Contas</strong> antes do primeiro lançamento.</Aviso></div>
      )}

      <div className="sticky top-0 z-20 -mx-4 mb-4 flex items-center gap-2 border-b border-slate-100 bg-white/85 px-4 py-2 backdrop-blur supports-[backdrop-filter]:bg-white/75">
        <Button variante="secundario" className="min-w-11" aria-label="Mês anterior" onClick={() => setMes(somarMeses(mes, -1))}>‹</Button>
        <span className="min-w-44 text-center font-semibold">{primeiraMaiuscula(formatMonth(mes))}</span>
        <Button variante="secundario" className="min-w-11" aria-label="Próximo mês" onClick={() => setMes(somarMeses(mes, 1))}>›</Button>
      </div>

      {resumo && (
        <div className="mb-4 grid gap-2 sm:grid-cols-3 sm:gap-3">
          {/* celular: uma linha por total (rótulo à esquerda, valor à direita); a partir de sm: três painéis */}
          <Card semPadding className={totalCard}><p className={totalRotulo}>Receitas pagas</p><p className={`${totalValor} text-lucro`}>+{formatBRL(resumo.receitas)}</p></Card>
          <Card semPadding className={totalCard}><p className={totalRotulo}>Despesas pagas</p><p className={`${totalValor} text-neutro`}>−{formatBRL(resumo.despesas)}</p></Card>
          <Card semPadding className={totalCard}>
            <p className={totalRotulo}>Resultado do mês</p>
            <div className="min-w-0 text-right sm:text-left">
              <p className={`${totalValor} ${corDoValor(resumo.resultado)}`}>{formatBRL(resumo.resultado)}</p>
              {(resumo.receitasPrevistas > 0 || resumo.despesasPrevistas > 0) && (
                // cada valor é indivisível (nowrap) e a linha quebra entre eles: no celular o valor nunca fica cortado
                <p className="mt-1 flex flex-wrap justify-end gap-x-1.5 text-xs text-agendado sm:justify-start">
                  <span>Planejado:</span>
                  <span className="whitespace-nowrap">+{formatBRL(resumo.receitasPrevistas)}</span>
                  <span aria-hidden="true">/</span>
                  <span className="whitespace-nowrap">−{formatBRL(resumo.despesasPrevistas)}</span>
                </p>
              )}
            </div>
          </Card>
        </div>
      )}
      <ResultadoEmOutrasMoedas porMoeda={porMoeda} className="mb-4 rounded-xl border border-slate-200 bg-white px-4 py-3" />

      {movimentosDivida.length > 0 && (
        <Explicacao resumo="Cartão/dívida: está aqui para o extrato bater com o banco.">
          Itens <strong>Cartão/dívida</strong> mexem no saldo da conta, então aparecem aqui para o extrato bater com o banco.
          <strong> Pagamento de fatura e amortização não são despesa</strong>: a compra já contou no mês da fatura.
          {' '}<strong>Juros e tarifa são despesa</strong> e já estão em "Despesas pagas", na categoria deles.
        </Explicacao>
      )}


      {/* Filtros só com o formulário fechado: criar/editar ocupa o foco e "Novo lançamento" não deve mostrar filtro.
          Tipo vem antes da categoria porque ele decide quais categorias existem (receita × despesa; transferência não tem). */}
      {editando === null && (
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <Selecao rotulo="Filtrar por conta" valor={filtros.contaId ?? ''} aoMudar={(v) => setFiltros({ ...filtros, contaId: v || undefined })}
            opcoes={contas.map((c) => [c.id, c.nome])} todos="Todas as contas" />
          <Selecao rotulo="Filtrar por tipo" valor={filtros.tipo ?? ''} aoMudar={mudarTipoDoFiltro}
            opcoes={Object.entries(rotuloTipo)} todos="Todos os tipos" />
          <Selecao rotulo="Filtrar por categoria" valor={filtros.categoriaId ?? ''} aoMudar={(v) => setFiltros({ ...filtros, categoriaId: v || undefined })}
            opcoes={opcoesDeCategoria(categoriasDoFiltro, categorias).map((o) => [o.id, filtros.tipo ? o.rotulo : `${o.rotulo} (${categorias.find((c) => c.id === o.id)?.tipo === 'income' ? 'receita' : 'despesa'})`])}
            todos={filtros.tipo === 'transfer' ? 'Transferência não tem categoria' : 'Todas as categorias'}
            desabilitado={filtros.tipo === 'transfer'} />
        </div>
      )}

      {erro && <div className="mb-4"><Aviso tipo="erro">{erro}</Aviso></div>}
      {avisoAutomaticos && !erro && <div className="mb-4"><Aviso tipo="erro">{avisoAutomaticos}</Aviso></div>}

      {naLixeira && (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Aviso tipo="info">Lançamento enviado para a lixeira.</Aviso>
          <Button variante="fantasma" onClick={() => agir(async () => { await restaurarDaLixeira(naLixeira.id); setNaLixeira(null) })}>Desfazer</Button>
        </div>
      )}

      {editando !== null && (
        <PainelLancamento aoFechar={() => setEditando(null)}>
        <FormLancamento
          lancamento={editando === 'novo' ? null : editando}
          inicial={inicial}
          contas={contas}
          categorias={categorias}
          cartoes={cartoes}
          familiaId={familiaId}
          aoSalvar={async () => { setEditando(null); await carregar() }}
          aoRegistrarOutro={carregar}
          aoCancelar={() => setEditando(null)}
        />
        </PainelLancamento>
      )}

      {pagando !== null && (
        <PainelPagar
          lancamento={pagando}
          nomeConta={nomeConta.get(pagando.contaId) ?? '?'}
          moeda={moedaConta.get(pagando.contaId) ?? 'BRL'}
          aoConfirmar={async () => { setPagando(null); await carregar() }}
          aoCancelar={() => setPagando(null)}
        />
      )}

      {lancamentos === null && !erro && <p className="text-sm text-slate-600" role="status">Carregando…</p>}

      {comprasFalharam && (
        <div className="mb-4"><Aviso tipo="info">Não foi possível carregar as faturas dos cartões agora. Elas continuam em Cartões.</Aviso></div>
      )}
      {(faturas.length > 0 || comprasCategoria.length > 0) && (
        <Explicacao resumo="Fatura no vencimento, com compras e créditos dentro.">
          A <strong>fatura</strong> do cartão aparece no dia do vencimento, com o total calculado pelo banco (já descontados os
          créditos); toque nela para ver as compras e os <strong>créditos e reembolsos</strong>.
          {' '}Nos totais e relatórios, a compra conta como despesa e o crédito como receita no <strong>fechamento</strong> da fatura.
          {' '}<strong>Pagamento da fatura</strong> é o dinheiro saindo da conta: não é outra despesa.
        </Explicacao>
      )}

      {lancamentos?.length === 0 && movimentosDivida.length === 0 && parcelasContrato.length === 0 && creditosCartao.length === 0 && faturas.length === 0
        && comprasCategoria.length === 0 && editando === null && contas.length > 0 && (
        <EmptyState titulo="Nenhum lançamento neste mês" descricao="Registre receitas, despesas e transferências entre contas."
          acao={<Button onClick={() => setEditando('novo')}>Novo lançamento</Button>} />
      )}

      {telaGrande ? (
        <TabelaLancamentos itens={itensVisiveis} hoje={hoje} chaveSelecao={`${mes}|${filtros.contaId ?? ''}|${filtros.tipo ?? ''}|${filtros.categoriaId ?? ''}`}
          categorias={categorias} nomeConta={nomeConta} moedaConta={moedaConta} nomeCategoria={nomeCategoria} categoriaPorId={categoriaPorId}
          ocupado={pagando !== null} aoEditar={(l) => { setPagando(null); setEditando(l) }} aoPagar={(l) => { setEditando(null); setPagando(l) }}
          aoExcluir={excluir} aoAlterar={carregar} />
      ) : (
      <div className="flex flex-col gap-4">
        {porDia.map(([data, itens]) => (
          <section key={data} aria-label={formatDate(data)}>
            <h2 className="mb-2 text-sm font-semibold text-slate-500">{formatDate(data)}</h2>
            <Card semPadding>
              <ul className="divide-y divide-slate-100">
                {itens.map((item) => {
                  if (item.origem === 'fatura') {
                    return <LinhaFatura key={`fatura-${item.f.cartaoId}-${item.f.mes}`} fatura={item.f} categoriaPorId={categoriaPorId} nomeCategoria={nomeCategoria} />
                  }
                  if (item.origem === 'cartao') {
                    // só com filtro de categoria: a compra solta, no dia do vencimento da fatura em que está
                    const c = item.c
                    return (
                      <LinhaLista key={`cartao-${c.id}`} icone={<IconeCategoria visual={visualPorId(c.categoriaId, categoriaPorId, 'expense')} />}
                        titulo={<>{c.descricao}{c.deParcelas > 1 && <span className="ml-2 text-xs font-normal text-slate-500">parcela {c.parcela}/{c.deParcelas}</span>}</>}
                        categoria={<NomeCategoria id={c.categoriaId} categoriaPorId={categoriaPorId} nomeCategoria={nomeCategoria} />}
                        etiquetas={[<Etiqueta key="c" estilo="bg-azul-claro text-marinho">No cartão</Etiqueta>]}
                        detalhe={`fatura ${c.cartaoNome}${c.dataCompra ? ` · compra de ${formatDate(c.dataCompra)}` : ''} · a despesa conta em ${formatDate(c.fechamento)} (fechamento da fatura)`}
                        valor={formatBRL(c.valor)} corValor="text-neutro"
                        acoes={<Link to={rotaFatura(c.cartaoId, c.fechamento.slice(0, 7))} aria-label="Ver em Cartões" title="Ver em Cartões" className={linkCompacto}>Cartões</Link>} />
                    )
                  }
                  if (item.origem === 'credito') {
                    // solto só com filtro de categoria (no vencimento, como as compras) ou de Receita (no fechamento)
                    const k = item.k
                    return (
                      <LinhaLista key={`credito-${k.id}`} icone={<IconeCategoria visual={visualPorId(k.categoriaId, categoriaPorId, 'income')} />}
                        titulo={k.descricao}
                        categoria={<NomeCategoria id={k.categoriaId} categoriaPorId={categoriaPorId} nomeCategoria={nomeCategoria} />}
                        etiquetas={[
                          <Etiqueta key="c" estilo="bg-azul-claro text-marinho">Crédito no cartão</Etiqueta>,
                          ...(k.planejado ? [<Etiqueta key="p" estilo={SELO.planejado}>Planejado</Etiqueta>] : []),
                        ]}
                        detalhe={`${k.vencimento ? 'fatura ' : ''}${k.cartaoNome}${k.dataCredito !== k.data ? ` · crédito de ${formatDate(k.dataCredito)}` : ''} · a receita conta em ${formatDate(k.data)} (fechamento da fatura)`}
                        valor={`+${formatBRL(k.valor)}`} corValor="text-lucro"
                        acoes={<Link to="/cartoes" aria-label="Ver em Cartões" title="Ver em Cartões" className={linkCompacto}>Cartões</Link>} />
                    )
                  }
                  if (item.origem === 'contrato') {
                    const p = item.p
                    return (
                      <LinhaLista key={`contrato-${p.id}`} icone={<IconeCategoria fixo="cartao" />}
                        titulo={`${p.nomeDivida} · parcela ${p.numero}`}
                        etiquetas={[situacaoDoLancamento(false, p.vencimento, hoje) === 'vencido'
                          ? <Etiqueta key="p" estilo={SELO.vencido}>Vencido · contrato</Etiqueta>
                          : <Etiqueta key="p" estilo={SELO.planejado}>Planejado · contrato</Etiqueta>]}
                        detalhe={`${p.formaPagamento === 'account_debit' ? `Débito em ${nomeConta.get(p.contaPagamentoId ?? '') ?? 'conta'}` : p.formaPagamento === 'payroll' ? 'Desconto em folha' : p.formaPagamento === 'boleto' ? 'Boleto' : 'Pagamento manual'} · só entra no saldo e nas despesas quando você der baixa`}
                        valor={`−${formatBRL(p.valor)}`} corValor="text-neutro"
                        acoes={<Link to={`/dividas?baixar=${p.id}`} aria-label={`Baixar parcela ${p.numero} de ${p.nomeDivida}`} className={linkCompacto}>Baixar</Link>} />
                    )
                  }
                  if (item.origem === 'divida') {
                    const m = item.m
                    return (
                      <LinhaLista key={`divida-${m.id}`} icone={<IconeCategoria fixo="cartao" />} titulo={m.descricao}
                        categoria={<span>{nomeConta.get(m.contaId) ?? '?'}</span>}
                        etiquetas={[<Etiqueta key="d" estilo="bg-slate-100 text-slate-600">{m.jaEmDespesas ? 'Cartão/dívida · já em despesas' : 'Cartão/dívida'}</Etiqueta>]}
                        valor={`${m.valor < 0 ? '−' : '+'}${formatBRL(Math.abs(m.valor) as Cents)}`} corValor={m.valor < 0 ? 'text-neutro' : 'text-lucro'}
                        acoes={<Link to="/cartoes" aria-label="Ver em Cartões" title="Ver em Cartões" className={linkCompacto}>Cartões</Link>} />
                    )
                  }
                  const l = item.l
                  const v = valorComSinal(l, moedaConta.get(l.contaId) ?? 'BRL')
                  const nome = l.descricao || rotuloTipo[l.tipo]
                  // abaixo de 1024px: a ação principal (marcar pago) num botão compacto de 1 toque; tudo também no menu ⋯
                  const acoes: AcaoMenu[] = [
                    ...(l.status === 'planned' ? [{ rotulo: 'Marcar pago', aoEscolher: () => { setEditando(null); setPagando(l) }, desabilitado: pagando !== null }] : []),
                    { rotulo: 'Editar', aoEscolher: () => setEditando(l) },
                    { rotulo: 'Excluir', aoEscolher: () => { void excluir(l) }, perigo: true },
                  ]
                  return (
                    <LinhaLista key={l.id}
                      icone={l.tipo === 'transfer' ? <IconeCategoria fixo="transferencia" /> : <IconeCategoria visual={visualPorId(l.categoriaId, categoriaPorId, l.tipo)} />}
                      titulo={nome}
                      // só a categoria (a folha); a transferência não tem categoria, então mostra de qual conta para qual
                      categoria={l.tipo === 'transfer'
                        ? <span>{`${nomeConta.get(l.contaId) ?? '?'} → ${nomeConta.get(l.destinoId ?? '') ?? '?'}`}</span>
                        : <NomeCategoria id={l.categoriaId} categoriaPorId={categoriaPorId} nomeCategoria={nomeCategoria} />}
                      etiquetas={[
                        // planejado com a data já passada é vencido (vermelho), como na tabela do computador e no Início
                        ...(l.status === 'planned' ? [situacaoDoLancamento(false, l.data, hoje) === 'vencido'
                          ? <Etiqueta key="p" estilo={SELO.vencido}>Vencido</Etiqueta>
                          : <Etiqueta key="p" estilo={SELO.planejado}>Planejado</Etiqueta>] : []),
                        ...(l.recorrente ? [<span key="r" className="shrink-0" title="Gerado por um recorrente"><span aria-hidden="true">↻</span><span className="sr-only">recorrente</span></span>] : []),
                      ]}
                      valor={v.texto} corValor={v.cor}
                      acoes={<>
                        {l.status === 'planned' && (
                          <button type="button" aria-label="Marcar pago" title={`Marcar pago: ${nome}`} disabled={pagando !== null}
                            onClick={() => { setEditando(null); setPagando(l) }}
                            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-lg font-bold text-lucro hover:bg-lucro-fundo disabled:cursor-not-allowed disabled:opacity-50">
                            <span aria-hidden="true">✓</span>
                          </button>
                        )}
                        <MenuAcoes rotulo={`Ações de ${nome}`} acoes={acoes} />
                      </>} />
                  )
                })}
              </ul>
            </Card>
          </section>
        ))}
      </div>
      )}
      {itens.length > limiteVisivel && (
        <div className="flex flex-col items-center gap-2 py-4">
          <p className="text-xs text-slate-500">Mostrando {itensVisiveis.length} de {itens.length} lançamentos e movimentos</p>
          <Button variante="secundario" onClick={() => setLimiteVisivel((atual) => Math.min(atual + 50, itens.length))}>
            Carregar mais 50
          </Button>
        </div>
      )}
    </>
  )
}

const linkCompacto = 'inline-flex min-h-11 items-center rounded-lg px-2 text-sm font-semibold text-azul hover:bg-azul-claro'

function Etiqueta({ estilo, children }: { estilo: string; children: ReactNode }) {
  return <span className={`shrink-0 whitespace-nowrap rounded px-1 py-0.5 text-xs font-medium sm:px-1.5 ${estilo}`}>{children}</span>
}

/** Uma linha curta com (i): a explicação inteira abre embaixo (details/summary: teclado e leitor de tela de graça). */
function Explicacao({ resumo, children }: { resumo: string; children: ReactNode }) {
  return (
    <details className="mb-4 text-xs text-slate-500">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-slate-400 font-bold">i</span>
        <span className="min-w-0 truncate">{resumo}</span>
        <span className="sr-only">(mostrar explicação)</span>
      </summary>
      <p className="mt-1">{children}</p>
    </details>
  )
}

/**
 * Uma linha da lista (celular e tablet, abaixo de 1024px), no máximo 2 linhas de texto: título (até 2 linhas, corta com
 * reticências) e metadados numa linha só (categoria · etiquetas · detalhe, cortando o que não couber; o detalhe inteiro
 * fica no `title`). O valor tem coluna própria à direita (nowrap, tabular), nunca por cima do texto; as ações, embaixo dele.
 */
function LinhaLista({ icone, titulo, categoria, etiquetas = [], detalhe, valor, corValor, acoes }: {
  icone: ReactNode; titulo: ReactNode; categoria?: ReactNode; etiquetas?: ReactNode[]; detalhe?: string
  valor: string; corValor: string; acoes?: ReactNode
}) {
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 px-4 py-3 sm:px-5">
      {icone}
      <Corpo titulo={titulo} categoria={categoria} etiquetas={etiquetas} detalhe={detalhe} />
      <div className="flex shrink-0 flex-col items-end">
        <span data-valor className={`whitespace-nowrap tabular-nums font-semibold ${corValor}`}>{valor}</span>
        {acoes && <div className="-mr-2 flex items-center">{acoes}</div>}
      </div>
    </li>
  )
}

function Corpo({ titulo, categoria, etiquetas = [], detalhe }: { titulo: ReactNode; categoria?: ReactNode; etiquetas?: ReactNode[]; detalhe?: string }) {
  const partes: ReactNode[] = [
    // os selos nunca encolhem (shrink-0 na Etiqueta); a categoria (até 65%) corta com reticências antes deles; o detalhe
    // (flex-1, base 0) é o primeiro a sumir
    ...(categoria ? [<span key="cat" className="min-w-0 max-w-[65%] truncate">{categoria}</span>] : []),
    ...etiquetas,
    ...(detalhe ? [<span key="det" className="min-w-0 flex-1 truncate" title={detalhe}>{detalhe}</span>] : []),
  ]
  return (
    <span className="block min-w-0">
      <span className="line-clamp-2 break-words font-medium">{titulo}</span>
      {partes.length > 0 && (
        <span data-metadados className="mt-0.5 flex min-w-0 items-center gap-1 overflow-hidden whitespace-nowrap text-xs text-slate-500 sm:gap-1.5 sm:text-sm">
          {partes.map((p, i) => (
            <Fragment key={i}>{i > 0 && <span aria-hidden="true" className="shrink-0">·</span>}{p}</Fragment>
          ))}
        </span>
      )}
    </span>
  )
}

/**
 * Uma fatura de cartão na lista: total e situação vindos do banco (card_months, que já desconta os créditos). A linha
 * inteira abre e fecha as compras e os créditos da fatura (carregados só ao abrir); "Ver em Cartões" fica lá dentro.
 * Só leitura: não é dinheiro saindo da conta (isso é o "Pagamento da fatura").
 */
function LinhaFatura({ fatura: f, categoriaPorId, nomeCategoria }: {
  fatura: FaturaDoMes; categoriaPorId: Map<string, Categoria>; nomeCategoria: Map<string, string>
}) {
  const { aberto, compras, creditos, erro, alternar, idLista } = useComprasDaFatura(f)
  const s = rotuloSituacaoFatura[f.situacao]
  return (
    <li>
      <button type="button" onClick={alternar} aria-expanded={aberto} aria-controls={idLista}
        className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 px-4 py-3 text-left hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-azul sm:px-5">
        <IconeCategoria fixo="cartao" />
        <Corpo titulo={`Fatura ${f.cartaoNome}`} etiquetas={[<Etiqueta key="s" estilo={s.estilo}>{s.texto}</Etiqueta>]} detalhe={resumoDaFatura(f)} />
        <span className="flex shrink-0 items-start gap-1">
          <span data-valor className="whitespace-nowrap tabular-nums font-semibold text-neutro">{formatBRL(f.total)}</span>
          <span aria-hidden="true" className="w-4 text-center text-slate-500">{aberto ? '▾' : '▸'}</span>
          <span className="sr-only">{aberto ? 'Esconder compras' : 'Ver compras'}</span>
        </span>
      </button>
      {aberto && (
        <div className="px-4 pb-3 sm:px-5">
          <ComprasDaFatura f={f} compras={compras} creditos={creditos} erro={erro} idLista={idLista} categoriaPorId={categoriaPorId} nomeCategoria={nomeCategoria} />
          {/* #203: direto na página desta fatura */}
          <Link to={rotaFatura(f.cartaoId, f.mes)} aria-label={`Ver fatura ${f.cartaoNome} em Cartões`} className={linkCompacto}>Ver em Cartões</Link>
        </div>
      )}
    </li>
  )
}

/** Marcar pago: a pessoa confirma a data e o valor reais; o planejado é só a sugestão. */
function PainelPagar({ lancamento: l, nomeConta, moeda, aoConfirmar, aoCancelar }: {
  lancamento: Lancamento; nomeConta: string; moeda: string; aoConfirmar: () => Promise<void>; aoCancelar: () => void
}) {
  const [data, setData] = useState(hojeSP())
  const [valorTexto, setValorTexto] = useState(formatBRLCampo(l.valor))
  const [tentou, setTentou] = useState(false)
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  const valor = parseBRL(valorTexto)
  const erroValor = tentou && (valor === null || valor <= 0) ? 'Informe um valor maior que zero. Exemplo: 143,20.' : undefined
  const erroData = tentou && !data ? 'Informe a data.' : undefined
  const entrada = l.tipo === 'income'

  async function confirmar(e: FormEvent) {
    e.preventDefault()
    setTentou(true)
    if (valor === null || valor <= 0 || !data) return
    setErro('')
    setEnviando(true)
    try {
      await marcarComoPago(l.id, { data, valor })
      await aoConfirmar()
    } catch (err) {
      setErro(mensagemErroBanco(err))
    } finally {
      setEnviando(false)
    }
  }

  // Abre por cima da tela (Folha), não no topo da página: na tabela do iPad/computador a pessoa costuma estar rolada
  // para baixo e a confirmação ficava fora da vista, com o menu travado esperando por ela.
  return (
    <Folha titulo={`Marcar como pago · ${l.descricao || rotuloTipo[l.tipo]}`} aoFechar={aoCancelar}>
      <p className="mb-4 text-sm text-slate-600">
        Planejado: {formatDate(l.data)} · {formatMoeda(l.valor, moeda)} · {nomeConta}. Informe {entrada ? 'quando e quanto entrou' : 'quando e quanto saiu'} de
        verdade: o saldo da conta e o extrato usam esta data e este valor.
      </p>
      <form onSubmit={confirmar} className="grid gap-4 md:grid-cols-2" noValidate>
        {erro && <div className="md:col-span-2"><Aviso tipo="erro">{erro}</Aviso></div>}
        <Field rotulo={entrada ? 'Data do recebimento' : 'Data do pagamento'} type="date" value={data} onChange={(e) => setData(e.target.value)} erro={erroData} />
        <Field rotulo={`Valor (${simboloMoeda(moeda)})`} inputMode="decimal" value={valorTexto} onChange={(e) => setValorTexto(e.target.value)} erro={erroValor} />
        <div className="flex gap-2 md:col-span-2">
          <Button type="submit" carregando={enviando}>Confirmar pagamento</Button>
          <Button variante="secundario" onClick={aoCancelar}>Cancelar</Button>
        </div>
      </form>
    </Folha>
  )
}

/**
 * A pergunta do Organizze ao editar um lançamento que se repete (#194), na Folha do app (foco preso, Esc e × cancelam,
 * o foco começa no botão principal). Cancelar não grava nada e volta ao formulário com o que foi digitado.
 */
function PerguntaRecorrente({ aoEscolher, aoCancelar, contaMudou }: {
  aoEscolher: (escolha: 'este' | 'proximos') => void; aoCancelar: () => void
  /** a conta (ou o destino) mudou nesta edição: ela não vai para a regra (recurrence_update_from grava só neste) */
  contaMudou: boolean
}) {
  return (
    <Folha titulo="Lançamento recorrente" aoFechar={aoCancelar}>
      <p className="text-base font-medium text-marinho">Este lançamento se repete em outras datas. O que deseja fazer?</p>
      <p className="mt-2 text-sm text-slate-600">
        Em &quot;Este e os próximos&quot;, o recorrente passa a ter o valor, a descrição, a categoria e o dia novos. O que já foi pago, o que
        está na lixeira e o que você corrigiu à mão em outro mês ficam como estão.
      </p>
      {contaMudou && <p className="mt-2 text-sm text-slate-600">A troca de conta vale só para este lançamento.</p>}
      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button onClick={() => aoEscolher('este')}>Atualizar apenas este</Button>
        <Button variante="secundario" onClick={() => aoEscolher('proximos')}>Este e os próximos</Button>
        <Button variante="fantasma" onClick={aoCancelar}>Cancelar</Button>
      </div>
    </Folha>
  )
}

/** Como o formulário novo abre quando vem de um atalho do painel. */
type InicialForm = TipoLancamento | 'cartao'

interface PropsForm {
  lancamento: Lancamento | null
  inicial?: InicialForm
  contas: Conta[]
  categorias: Categoria[]
  cartoes: Cartao[]
  familiaId: string
  aoSalvar: () => Promise<void>
  /** "Registrar e lançar outro": recarrega a lista sem fechar o formulário. */
  aoRegistrarOutro: () => Promise<void>
  aoCancelar: () => void
}

const rotuloAcao: Record<TipoLancamento | 'cartao', string> = {
  expense: 'Registrar despesa', income: 'Registrar receita', transfer: 'Registrar transferência', cartao: 'Registrar compra',
}
const corAba: Record<TipoLancamento | 'cartao', string> = {
  expense: 'bg-prejuizo text-white', income: 'bg-lucro text-white', transfer: 'bg-transferencia text-white', cartao: 'bg-azul text-white',
}

/** Linha do formulário: ícone, nome do campo e o controle à direita (select/data nativos: no iPhone abrem a roda de opções). */
function Linha({ icone, rotulo, dica, htmlFor, fixo = false, children }: {
  icone: ReactNode; rotulo: string; dica?: string; htmlFor: string
  /** O controle tem largura fixa (data): ele não encolhe; o nome do campo quebra a linha. */
  fixo?: boolean; children: ReactNode
}) {
  return (
    <div className="flex min-h-14 items-center gap-3 px-3 py-2">
      <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-fundo text-slate-600">{icone}</span>
      <span className="flex min-w-0 flex-col">
        <label htmlFor={htmlFor} className="text-sm font-medium leading-tight text-marinho">{rotulo}</label>
        {dica && <span className="text-xs text-slate-500">{dica}</span>}
      </span>
      <div className={`flex flex-1 items-center justify-end gap-1 ${fixo ? 'shrink-0' : 'min-w-0'}`}>{children}</div>
    </div>
  )
}
const controleLinha = 'min-h-11 min-w-0 max-w-full appearance-none truncate rounded-md bg-transparent px-1 text-right text-base text-slate-700 focus:outline focus:outline-2 focus:outline-azul'
const seta = <span aria-hidden="true" className="text-lg text-slate-400">›</span>

function FormLancamento({ lancamento: l, inicial, contas, categorias, cartoes, familiaId, aoSalvar, aoRegistrarOutro, aoCancelar }: PropsForm) {
  const { sessao } = useAuth()
  const hoje = hojeSP()
  // multimoeda F2: receita, despesa e transferência aceitam conta em qualquer moeda (o destino da transferência, só na
  // mesma moeda da origem: ver `destinos`)
  const ativas = contas.filter((c) => aceitaLancamento(c, 'lancamento') && (c.ativa || c.id === l?.contaId || c.id === l?.destinoId))
  const [tipo, setTipo] = useState<TipoLancamento>(l?.tipo ?? (inicial && inicial !== 'cartao' ? inicial : 'expense'))
  const [valorTexto, setValorTexto] = useState(l ? formatBRLCampo(l.valor) : '')
  const [data, setData] = useState(l?.data ?? hoje)
  const [descricao, setDescricao] = useState(l?.descricao ?? '')
  // conta principal: o formulário novo abre na última conta usada neste aparelho (se ainda estiver ativa)
  const [contaId, setContaId] = useState(() => {
    if (l) return l.contaId
    const ultima = ultimaEscolha(familiaId, 'conta')
    return (ultima && ativas.some((c) => c.id === ultima) ? ultima : ativas[0]?.id) ?? ''
  })
  const [destinoId, setDestinoId] = useState(l?.destinoId ?? '')
  const [categoriaId, setCategoriaId] = useState(l?.categoriaId ?? '')
  // planejado por padrão quando a data é futura; a pessoa pode trocar
  const [status, setStatus] = useState<StatusLancamento | null>(l?.status ?? null)
  const statusEfetivo: StatusLancamento = status ?? (data > hoje ? 'planned' : 'paid')
  const [notas, setNotas] = useState(l?.notas ?? '')
  const [pessoas, setPessoas] = useState<PessoaFamilia[]>([])
  const [personId, setPersonId] = useState<string | null>(l?.personId ?? null)
  const [isSharedExpense, setIsSharedExpense] = useState(l?.isSharedExpense ?? false)
  const pessoaEscolhidaManualmente = useRef(false)
  useEffect(() => {
    let ativo = true
    void listarPessoasFamilia(familiaId).then((lista) => {
      if (!ativo) return
      setPessoas(lista)
      if (!l && !pessoaEscolhidaManualmente.current && sessao?.user.id) {
        const propria = lista.find((pessoa) => pessoa.userId === sessao.user.id && pessoa.ativo)
        if (propria) setPersonId(propria.id)
      }
    }).catch(() => { if (ativo) setPessoas([]) })
    return () => { ativo = false }
  }, [familiaId, l, sessao?.user.id])
  const [tentou, setTentou] = useState(false)
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  // Onde foi: conta (dinheiro saiu/entrou agora) ou cartão (compra parcelada; a despesa conta na fatura).
  // Só para lançamento novo: editar continua sendo conta, como antes.
  const [onde, setOnde] = useState<'conta' | 'cartao'>(!l && inicial === 'cartao' ? 'cartao' : 'conta')
  const [cartaoId, setCartaoId] = useState(() => {
    const ultimo = ultimaEscolha(familiaId, 'cartao')
    return ultimo && cartoes.some((c) => c.id === ultimo && c.ativo && c.fechamento !== null) ? ultimo : ''
  })
  const [registrado, setRegistrado] = useState('')
  // edição de um lançamento de recorrente que mudou valor, data, descrição ou categoria: a pergunta antes de gravar (#194)
  const [pergunta, setPergunta] = useState<DadosLancamento | null>(null)
  const outroRef = useRef(false)
  const [parcelasTexto, setParcelasTexto] = useState('1')
  // "Repetir → Lançamento fixo": cria a regra de recorrente (a mesma da tela Recorrentes) em vez de um lançamento solto
  const [repetir, setRepetir] = useState(false)
  const [modoRepetir, setModoRepetir] = useState<'fixo' | 'parcelado'>('fixo')
  const [nParcelasTexto, setNParcelasTexto] = useState('2')
  const [periodo, setPeriodo] = useState('meses')
  const [frequencia, setFrequencia] = useState('mensal')
  const [repetirAte, setRepetirAte] = useState('')
  const chaveRef = useRef<{ sig: string; chave: string } | null>(null)
  const cartaoMode = !l && onde === 'cartao'
  const fixo = !l && !cartaoMode && repetir && modoRepetir === 'fixo'
  const parcelado = !l && !cartaoMode && repetir && modoRepetir === 'parcelado'
  const nParcelas = Number(nParcelasTexto)
  const nParcelasOk = Number.isInteger(nParcelas) && nParcelas >= 2 && nParcelas <= 360
  const cartoesComCiclo = cartoes.filter((c) => c.ativo && c.fechamento !== null)
  const parcelas = Number(parcelasTexto)

  const valor = parseBRL(valorTexto)
  const transferencia = tipo === 'transfer'
  const categoriasDoTipo = categorias.filter((c) => c.tipo === tipo && (c.ativa || c.id === l?.categoriaId))
  const conta = contas.find((c) => c.id === contaId)
  const moeda = cartaoMode ? 'BRL' : conta?.moeda ?? 'BRL'
  // transferência entre moedas diferentes só na F3 (o banco recusa): o destino lista só contas da moeda da origem
  const destinos = ativas.filter((c) => c.id !== contaId && (!conta || mesmaMoeda(c, conta)))

  const erros = {
    valor: valor === null || valor <= 0 ? 'Informe um valor maior que zero. Exemplo: 1.250,50.' : undefined,
    conta: !cartaoMode && !contaId ? 'Escolha a conta.' : undefined,
    cartao: cartaoMode && !cartaoId ? 'Escolha o cartão.' : undefined,
    parcelas: cartaoMode && !(Number.isInteger(parcelas) && parcelas >= 1 && parcelas <= 72) ? 'De 1 a 72 parcelas.' : undefined,
    descricao: cartaoMode && !descricao.trim() ? 'Descreva a compra (ex.: Fone, Mercado).' : undefined,
    destino: transferencia && (!destinoId || destinoId === contaId) ? 'Escolha uma conta de destino diferente da origem.'
      : transferencia && !destinos.some((c) => c.id === destinoId) ? 'Transferência só entre contas da mesma moeda.' : undefined,
    categoria: !transferencia && !categoriaId ? 'Escolha a categoria.' : undefined,
    data: !data ? 'Informe a data.' : undefined,
    repetir: fixo && !descricao.trim() ? 'Dê um nome ao lançamento fixo (ex.: Aluguel, Internet).'
      : fixo && repetirAte && data && repetirAte < data ? 'O "até" não pode ser antes da data.'
      : parcelado && !descricao.trim() ? 'Dê um nome ao parcelado (ex.: Sofá, Curso).'
      : parcelado && !nParcelasOk ? 'De 2 a 360 parcelas.'
      : parcelado && valor !== null && valor > 0 && Math.floor(valor / nParcelas) < 1 ? 'Valor pequeno demais para tantas parcelas.' : undefined,
  }

  /** Depois de gravar: fecha o formulário, ou (em "Registrar e lançar outro") limpa valor, descrição e categoria e continua aberto. */
  async function concluir(mensagem: string) {
    if (!outroRef.current || l) { await aoSalvar(); return }
    setValorTexto(''); setDescricao(''); setCategoriaId(''); setNotas(''); setParcelasTexto('1'); setStatus(null); setPersonId(null); setIsSharedExpense(false)
    setTentou(false); chaveRef.current = null
    setRegistrado(mensagem)
    await aoRegistrarOutro()
  }

  async function salvar(e: FormEvent) {
    e.preventDefault()
    setRegistrado('')
    setTentou(true)
    if (Object.values(erros).some(Boolean) || valor === null) return
    setErro('')
    setEnviando(true)
    try {
      if (cartaoMode) {
        // mesma regra do cartão (card_purchase): parcela por fechamento; chave evita compra duplicada num reenvio
        // mesma chave só para o mesmo conteúdo reenviado; se algo mudou, é outra compra (evita gravar um valor diferente do mostrado)
        const sig = JSON.stringify([cartaoId, descricao.trim(), data, valor, parcelas, categoriaId])
        if (chaveRef.current?.sig !== sig) chaveRef.current = { sig, chave: novaChave() }
        await registrarCompra(cartaoId, { descricao: descricao.trim(), data, total: valor as Cents, parcelas, categoriaId, personId, isSharedExpense }, chaveRef.current.chave)
        lembrarEscolha(familiaId, 'cartao', cartaoId)
        await concluir('Compra registrada.')
        return
      }
      if (parcelado) {
        const p = PERIODOS.find((x) => x.chave === periodo) ?? PERIODOS[4]
        await criarParcelado({
          tipo, descricao, total: valor as Cents, parcelas: nParcelas, unidade: p.unidade, cada: p.cada, primeira: data,
          contaId, destinoId: transferencia ? destinoId : null, categoriaId: transferencia ? null : categoriaId,
          primeiraPaga: statusEfetivo === 'paid', personId: tipo === 'expense' ? personId : null,
          isSharedExpense: tipo === 'expense' ? isSharedExpense : false,
        })
        lembrarEscolha(familiaId, 'conta', contaId)
        setRepetir(false); setNParcelasTexto('2')
        await concluir(`${nParcelas} parcelas lançadas.`)
        return
      }
      if (fixo) {
        const f = frequencias.find((x) => x.chave === frequencia) ?? frequencias[2]
        await criarRecorrencia({
          tipo, descricao: descricao.trim(), valor: valor as Cents, dia: f.unidade === 'month' ? Number(data.slice(8, 10)) : null,
          unidade: f.unidade, cada: f.cada, inicio: data, fim: repetirAte || null,
          contaId, destinoId: transferencia ? destinoId : null, cartaoId: null, categoriaId: transferencia ? null : categoriaId,
          personId: tipo === 'expense' ? personId : null, isSharedExpense: tipo === 'expense' ? isSharedExpense : false,
        })
        lembrarEscolha(familiaId, 'conta', contaId)
        setRepetir(false); setRepetirAte('')
        await concluir(`Lançamento fixo criado (${f.rotulo.toLowerCase()}). As ocorrências entram como planejadas.`)
        return
      }
      const dados: DadosLancamento = {
        tipo, contaId, destinoId: transferencia ? destinoId : null, categoriaId: transferencia ? null : categoriaId,
        descricao, valor: valor as Cents, data, status: statusEfetivo, notas,
        personId: tipo === 'expense' ? personId : null, isSharedExpense: tipo === 'expense' ? isSharedExpense : false,
      }
      if (l && perguntaSeRepete(l, dados)) { setPergunta(dados); return }
      if (l) await editarLancamento(l.id, dados)
      else await criarLancamento(familiaId, dados)
      if (!l) lembrarEscolha(familiaId, 'conta', contaId)
      await concluir(`${rotuloTipo[tipo]} registrada.`)
    } catch (err) {
      setErro(mensagemErroBanco(err))
    } finally {
      setEnviando(false)
    }
  }

  /** Resposta da pergunta do recorrente: "Apenas este" (o UPDATE de sempre) ou "Este e os próximos" (a regra também). */
  async function gravarRecorrente(escolha: 'este' | 'proximos') {
    if (!l || !pergunta) return
    const dados = pergunta
    setPergunta(null)
    setErro('')
    setEnviando(true)
    try {
      if (escolha === 'proximos') {
        await editarEsteEProximos(l.id, dados)
        if (l.recorrenciaId) await definirPessoaRecorrencia(l.recorrenciaId, dados.tipo === 'expense' ? dados.personId ?? null : null, dados.tipo === 'expense' ? dados.isSharedExpense ?? false : false)
      } else await editarLancamento(l.id, dados)
      await concluir(`${rotuloTipo[dados.tipo]} registrada.`)
    } catch (err) {
      setErro(mensagemErroBanco(err))
    } finally {
      setEnviando(false)
    }
  }

  const aba: TipoLancamento | 'cartao' = cartaoMode ? 'cartao' : tipo
  const abas: [TipoLancamento | 'cartao', string, string][] = [
    ['expense', 'Despesa', 'Despesa'], ['income', 'Receita', 'Receita'], ['transfer', 'Transferência', 'Transferência'],
    ...(!l ? [['cartao', 'Cartão', 'Cartão de crédito'] as [TipoLancamento | 'cartao', string, string]] : []),
  ]
  const porId = useMemo(() => new Map(categorias.map((c) => [c.id, c])), [categorias])
  const sinal = aba === 'income' ? '+' : aba === 'transfer' ? '' : '−'
  const corValor = aba === 'income' ? 'text-lucro' : aba === 'transfer' ? 'text-transferencia' : 'text-prejuizo'

  return (
    <Card className="!shadow-none">
      {pergunta && (
        <PerguntaRecorrente aoEscolher={gravarRecorrente} aoCancelar={() => setPergunta(null)}
          contaMudou={!!l && (pergunta.contaId !== l.contaId || (pergunta.destinoId ?? null) !== (l.destinoId ?? null))} />
      )}
      <div className="mb-4 flex items-start justify-between gap-3">
        <h2 id="titulo-painel-lancamento" className="text-lg font-semibold">{l ? 'Editar lançamento' : 'Novo lançamento'}</h2>
        <button type="button" onClick={aoCancelar} aria-label="Fechar"
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-2xl leading-none text-slate-500 hover:bg-slate-100">×</button>
      </div>
      <form onSubmit={salvar} className="mx-auto flex max-w-xl flex-col gap-4" noValidate>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        {registrado && <p role="status" className="rounded-lg bg-lucro-fundo px-3 py-2 text-sm font-medium text-lucro">{registrado} Pode lançar o próximo.</p>}

        {/* uma linha só também a 390px (auditoria 5h): "Transf." abreviado no celular; o nome inteiro fica no aria-label */}
        <div role="radiogroup" aria-label="Tipo do lançamento" className="flex gap-1 rounded-xl bg-slate-100 p-1">
          {abas.map(([a, rotulo, nome]) => (
            <button key={a} type="button" role="radio" aria-checked={aba === a} aria-label={nome}
              onClick={() => {
                if (a === 'cartao') { setOnde('cartao'); setTipo('expense') } else { setOnde('conta'); setTipo(a) }
                setCategoriaId('')
              }}
              className={`min-h-11 min-w-0 flex-1 whitespace-nowrap rounded-lg px-1 text-sm font-semibold transition-colors sm:px-3 ${aba === a ? corAba[a] : 'text-slate-600 hover:bg-white'}`}>
              {a === 'transfer' ? <><span aria-hidden="true" className="sm:hidden">Transf.</span><span className="hidden sm:inline">{rotulo}</span></> : rotulo}
            </button>
          ))}
        </div>

        <div className="rounded-xl bg-fundo p-4">
          <div className="flex items-center gap-3">
            {transferencia
              ? <IconeCategoria fixo="transferencia" />
              : <IconeCategoria visual={visualPorId(categoriaId || null, porId, 'expense' === tipo || cartaoMode ? 'expense' : 'income')} />}
            <label htmlFor="lanc-descricao" className="sr-only">Descrição</label>
            <input id="lanc-descricao" maxLength={200} value={descricao} onChange={(e) => setDescricao(e.target.value)}
              placeholder={cartaoMode ? 'Ex.: Fone, mercado' : tipo === 'income' ? 'Ex.: Salário' : transferencia ? 'Ex.: Reserva' : 'Ex.: Supermercado'}
              aria-invalid={tentou && !!erros.descricao}
              className="min-h-11 min-w-0 flex-1 rounded-md bg-transparent px-1 text-lg font-medium text-marinho placeholder:text-slate-500 focus:outline focus:outline-2 focus:outline-azul" />
          </div>
          {tentou && erros.descricao && <p className="mt-1 text-sm text-negativo" role="alert">{erros.descricao}</p>}
          <div className={`mt-2 flex items-baseline gap-1 ${corValor}`}>
            <span aria-hidden="true" className="text-xl font-semibold">{sinal}{simboloMoeda(moeda)}</span>
            <label htmlFor="lanc-valor" className="sr-only">Valor ({simboloMoeda(moeda)})</label>
            <input id="lanc-valor" inputMode="decimal" placeholder="0,00" value={valorTexto} onChange={(e) => setValorTexto(e.target.value)}
              aria-invalid={tentou && !!erros.valor}
              className="min-h-14 w-full min-w-0 rounded-md bg-transparent px-1 text-4xl font-bold tabular-nums tracking-tight placeholder:text-current placeholder:opacity-40 focus:outline focus:outline-2 focus:outline-azul" />
          </div>
          {tentou && erros.valor && <p className="mt-1 text-sm text-negativo" role="alert">{erros.valor}</p>}
        </div>

        <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
          <Linha icone={<IconeCalendario />} rotulo={cartaoMode ? 'Data da compra' : 'Data'} dica={data === hoje ? 'Hoje' : undefined} htmlFor="lanc-data" fixo>
            <input id="lanc-data" type="date" value={data} onChange={(e) => setData(e.target.value)} aria-invalid={tentou && !!erros.data} className="min-h-11 w-36 shrink-0 appearance-none rounded-md bg-transparent px-1 text-right text-base text-slate-700 focus:outline focus:outline-2 focus:outline-azul" />
          </Linha>
          {cartaoMode ? (
            <>
              <Linha icone={<IconeCartoes />} rotulo="Cartão" htmlFor="lanc-cartao">
                <select id="lanc-cartao" value={cartaoId} onChange={(e) => setCartaoId(e.target.value)} className={controleLinha}>
                  <option value="">Escolher</option>
                  {cartoesComCiclo.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                </select>{seta}
              </Linha>
              <Linha icone={<IconeCartoes />} rotulo="Parcelas" htmlFor="lanc-parcelas">
                <input id="lanc-parcelas" type="number" min={1} max={72} value={parcelasTexto} onChange={(e) => setParcelasTexto(e.target.value)}
                  aria-invalid={tentou && !!erros.parcelas} className={`${controleLinha} w-20`} />
                <span className="text-sm text-slate-500">x</span>
              </Linha>
            </>
          ) : (
            <Linha icone={<IconeContas />} rotulo={transferencia ? 'Da conta' : 'Conta'} htmlFor="lanc-conta">
              <select id="lanc-conta" value={contaId} onChange={(e) => {
                setContaId(e.target.value)
                // o destino de outra moeda deixa de valer ao trocar a origem
                const nova = contas.find((c) => c.id === e.target.value)
                const destino = contas.find((c) => c.id === destinoId)
                if (nova && destino && !mesmaMoeda(nova, destino)) setDestinoId('')
              }} className={controleLinha}>
                {!contaId && <option value="">Escolher</option>}
                {ativas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>{seta}
            </Linha>
          )}
          {transferencia ? (
            <Linha icone={<IconeTransferir />} rotulo="Para a conta" htmlFor="lanc-destino">
              <select id="lanc-destino" value={destinoId} onChange={(e) => setDestinoId(e.target.value)} className={controleLinha}>
                <option value="">Escolher</option>
                {destinos.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>{seta}
            </Linha>
          ) : (
            <Linha icone={<IconeCategorias />} rotulo="Categoria" htmlFor="lanc-categoria">
              <select id="lanc-categoria" value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)} className={controleLinha}>
                <option value="">Escolher</option>
                {opcoesDeCategoria(categoriasDoTipo, categorias).map((o) => <option key={o.id} value={o.id}>{o.rotulo}</option>)}
              </select>{seta}
            </Linha>
          )}
          {!transferencia && tipo === 'expense' && (
            <details className="border-t border-slate-100 px-3 py-2">
              <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-slate-600">Opções avançadas · Pessoa responsável</summary>
              <div className="pb-2">
                <PessoaSelectField pessoas={pessoas} personId={personId} isSharedExpense={isSharedExpense}
                  onChange={(value) => { pessoaEscolhidaManualmente.current = true; setPersonId(value.personId); setIsSharedExpense(value.isSharedExpense) }} />
              </div>
            </details>
          )}
        </div>
        {tentou && (erros.data || erros.conta || erros.cartao || erros.parcelas || erros.destino || erros.categoria || erros.repetir) && (
          <div className="flex flex-col gap-1">
            {[erros.data, erros.conta, erros.cartao, erros.parcelas, erros.destino, erros.categoria, erros.repetir].filter(Boolean).map((m) => (
              <p key={m} className="text-sm text-negativo" role="alert">{m}</p>
            ))}
          </div>
        )}
        {cartaoMode && cartoesComCiclo.length === 0 && (
          <p className="text-sm text-slate-600">Nenhum cartão com fechamento definido. Defina em <Link to="/cartoes" className="font-semibold text-azul underline">Cartões</Link>.</p>
        )}

        {!l && !cartaoMode && (
          <details className="rounded-xl border border-slate-200 px-3 py-2">
            <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-slate-600">Opções avançadas · Recorrência e parcelamento</summary>
            <div className="pb-2">
            <button type="button" aria-pressed={repetir} onClick={() => setRepetir((v) => !v)}
              className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-semibold ${repetir ? 'border-azul bg-azul-claro text-azul' : 'border-slate-300 text-slate-600'}`}>
              <span aria-hidden="true">↻</span>Repetir
            </button>
            {repetir && (
              <fieldset className="mt-3 space-y-3">
                <legend className="text-sm font-semibold text-marinho">Repetir {tipo === 'income' ? 'receita' : tipo === 'transfer' ? 'transferência' : 'despesa'}</legend>
                <div className="flex flex-col gap-1">
                  {([['fixo', 'Lançamento fixo'], ['parcelado', 'Lançamento parcelado']] as const).map(([m, rotulo]) => (
                    <label key={m} className="flex min-h-11 items-center gap-3 text-sm">
                      <input type="radio" name="modo-repetir" className="h-5 w-5" checked={modoRepetir === m} onChange={() => setModoRepetir(m)} />{rotulo}
                    </label>
                  ))}
                </div>
                {modoRepetir === 'fixo' ? (<>
                  <p className="text-xs text-slate-500">Repete sem fim (ou até a data escolhida). Aparece também em Recorrentes, onde dá para editar ou encerrar.</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="flex flex-col gap-1 text-sm">
                      <span className="font-medium">Repetir</span>
                      <select value={frequencia} onChange={(e) => setFrequencia(e.target.value)} className="min-h-11 rounded-lg border border-slate-300 px-3">
                        {frequencias.map((f) => <option key={f.chave} value={f.chave}>{f.rotulo}</option>)}
                      </select>
                    </label>
                    <label className="flex flex-col gap-1 text-sm">
                      <span className="font-medium">Até (opcional)</span>
                      <input type="date" value={repetirAte} min={data || undefined} onChange={(e) => setRepetirAte(e.target.value)}
                        className="min-h-11 rounded-lg border border-slate-300 px-3" />
                    </label>
                  </div>
                </>) : (<>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="flex flex-col gap-1 text-sm">
                      <span className="font-medium">Parcelas</span>
                      <input type="number" min={2} max={360} value={nParcelasTexto} onChange={(e) => setNParcelasTexto(e.target.value)}
                        className="min-h-11 rounded-lg border border-slate-300 px-3" />
                    </label>
                    <label className="flex flex-col gap-1 text-sm">
                      <span className="font-medium">Período de lançamento</span>
                      <select value={periodo} onChange={(e) => setPeriodo(e.target.value)} className="min-h-11 rounded-lg border border-slate-300 px-3">
                        {PERIODOS.map((p) => <option key={p.chave} value={p.chave}>{p.rotulo}</option>)}
                      </select>
                    </label>
                  </div>
                  {valor !== null && valor > 0 && nParcelasOk && Math.floor(valor / nParcelas) >= 1 && (() => {
                    const v = valoresDasParcelas(valor as Cents, nParcelas)
                    return (
                      <p className="rounded-lg bg-slate-50 p-3 text-sm" data-testid="previa-parcelas">
                        Serão lançadas {nParcelas} parcelas de <strong className="tabular-nums">{formatMoeda(v[1], moeda)}</strong>
                        {v[0] !== v[1] && <> (a primeira de <strong className="tabular-nums">{formatMoeda(v[0], moeda)}</strong>, com a sobra dos centavos)</>}.
                        <span className="block text-xs text-slate-500">A primeira segue a situação escolhida abaixo; as outras entram como planejadas.</span>
                      </p>
                    )
                  })()}
                </>)}
              </fieldset>
            )}
            </div>
          </details>
        )}
        {!cartaoMode && !fixo && (
          <fieldset className="flex flex-wrap items-center gap-2">
            <legend className="sr-only">Situação</legend>
            {(['paid', 'planned'] as StatusLancamento[]).map((s) => (
              <label key={s} className="relative">
                <input type="radio" name="status" checked={statusEfetivo === s} onChange={() => setStatus(s)} className="peer sr-only" />
                <span className={`inline-flex min-h-11 cursor-pointer items-center rounded-full border px-4 text-sm font-semibold peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-azul ${
                  statusEfetivo === s ? (s === 'paid' ? `border-lucro ${SELO.pago}` : `border-agendado ${SELO.planejado}`) : 'border-slate-300 text-slate-600'}`}>
                  {s === 'paid' ? (aba === 'income' ? 'Recebido' : 'Pago') : 'Planejado'}
                </span>
              </label>
            ))}
          </fieldset>
        )}
        {!cartaoMode && (
          <details open={!!l?.notas} className="rounded-xl border border-slate-200 px-3 py-2">
            <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-slate-600">Mais detalhes</summary>
            <div className="pb-2"><Field rotulo="Observações (opcional)" maxLength={1000} value={notas} onChange={(e) => setNotas(e.target.value)} /></div>
          </details>
        )}

        {!transferencia && !cartaoMode && conta && data && data < conta.abertura && (
          <Aviso tipo="info">
            Data anterior ao saldo inicial de {conta.nome} ({formatDate(conta.abertura)}): o lançamento entra nos relatórios, mas <strong>não altera o saldo</strong> da conta.
          </Aviso>
        )}
        {fixo && (
          <p className="text-sm text-slate-600">Cada ocorrência entra como <strong>planejada</strong>, a partir da data escolhida; marque como pago quando acontecer.</p>
        )}
        {statusEfetivo === 'planned' && !cartaoMode && !fixo && (
          <p className="text-sm text-slate-600">Planejado não entra no saldo nem nos totais pagos até ser marcado como pago.</p>
        )}
        {cartaoMode && (
          <p className="text-sm text-slate-600">
            Compra no cartão: não mexe no saldo da conta agora. Cada parcela vira despesa no mês em que a fatura fecha, e o pagamento da fatura é separado.
          </p>
        )}

        <div className="flex flex-col gap-2">
          <Button type="submit" carregando={enviando} className="w-full" onClick={() => { outroRef.current = false }}>
            {l ? 'Salvar alterações' : fixo ? 'Criar lançamento fixo' : parcelado ? 'Lançar parcelas' : rotuloAcao[aba]}
          </Button>
          <div className="flex flex-wrap justify-center gap-2">
            {!l && <Button type="submit" variante="fantasma" disabled={enviando} onClick={() => { outroRef.current = true }}>Registrar e lançar outro</Button>}
            <Button variante="discreto" onClick={aoCancelar}>Cancelar</Button>
          </div>
        </div>
      </form>
    </Card>
  )
}

/** Períodos do parcelado, como no Organizze. */
const PERIODOS: { chave: string; rotulo: string; unidade: 'month' | 'week' | 'day'; cada: number }[] = [
  { chave: 'anos', rotulo: 'Anos', unidade: 'month', cada: 12 },
  { chave: 'semestres', rotulo: 'Semestres', unidade: 'month', cada: 6 },
  { chave: 'trimestres', rotulo: 'Trimestres', unidade: 'month', cada: 3 },
  { chave: 'bimestres', rotulo: 'Bimestres', unidade: 'month', cada: 2 },
  { chave: 'meses', rotulo: 'Meses', unidade: 'month', cada: 1 },
  { chave: 'quinzenas', rotulo: 'Quinzenas', unidade: 'week', cada: 2 },
  { chave: 'semanas', rotulo: 'Semanas', unidade: 'week', cada: 1 },
  { chave: 'dias', rotulo: 'Dias', unidade: 'day', cada: 1 },
]

const ATALHOS: Record<string, InicialForm> = { d: 'expense', r: 'income', t: 'transfer', c: 'cartao' }

/** "+ Lançamento": menu com os quatro tipos e a tecla de atalho de cada um. */
function MenuNovo({ desabilitado, aoEscolher }: { desabilitado: boolean; aoEscolher: (t: InicialForm) => void }) {
  const [aberto, setAberto] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!aberto) return
    const fora = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAberto(false) }
    document.addEventListener('mousedown', fora)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', fora); document.removeEventListener('keydown', esc) }
  }, [aberto])
  const itens: [InicialForm, string, string][] = [
    ['expense', 'Nova despesa', 'D'], ['income', 'Nova receita', 'R'], ['transfer', 'Nova transferência', 'T'], ['cartao', 'Compra no cartão', 'C'],
  ]
  return (
    <div className="relative" ref={ref}>
      <Button onClick={() => setAberto((v) => !v)} disabled={desabilitado} aria-haspopup="menu" aria-expanded={aberto}>+ Lançamento</Button>
      {aberto && (
        <div role="menu" aria-label="Novo lançamento" className="absolute left-0 z-40 mt-2 w-64 max-w-[calc(100vw-2rem)] rounded-xl bg-marinho p-2 shadow-card sm:left-auto sm:right-0">
          {itens.map(([t, rotulo, tecla]) => (
            <button key={t} type="button" role="menuitem"
              // o foco volta ao "+ Lançamento" antes do painel abrir: o painel o guarda como origem e o devolve ao fechar
              onClick={() => { setAberto(false); ref.current?.querySelector<HTMLButtonElement>('button')?.focus(); aoEscolher(t) }}
              className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-3 text-left text-sm font-semibold text-white hover:bg-white/10">
              {rotulo}
              {/* atalho de teclado físico: escondido no celular e em telas de toque */}
              <span className="hidden rounded-full border border-white/30 px-2 text-xs font-normal text-blue-100 sm:inline [@media(pointer:coarse)]:hidden" aria-label={`atalho: tecla ${tecla}`}>tecla {tecla}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Painel por cima da lista (como no Organizze): fecha no ×, no Esc ou clicando fora; a página de trás não rola; o foco
 * começa no formulário, o Tab não sai do painel e, ao fechar, volta para o botão que abriu (mesmo hook da Folha).
 */
function PainelLancamento({ aoFechar, children }: { aoFechar: () => void; children: ReactNode }) {
  const painel = useRef<HTMLDivElement>(null)
  const prenderTab = useFocoPreso(painel, aoFechar, () => painel.current?.querySelector('form'))
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 sm:items-center sm:p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) aoFechar() }}>
      <div ref={painel} role="dialog" aria-modal="true" aria-labelledby="titulo-painel-lancamento" onKeyDown={prenderTab}
        className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-t-2xl bg-white sm:rounded-2xl">
        {children}
      </div>
    </div>
  )
}
