import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Aviso } from '../components/ui/Aviso'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { EmptyState } from '../components/ui/EmptyState'
import { Field } from '../components/ui/Field'
import { Selecao } from '../components/ui/Selecao'
import { Link, useSearchParams } from 'react-router-dom'
import { useFamilia } from '../lib/FamiliaContext'
import { atualizarAutomaticos } from '../lib/automaticos'
import { listarCategorias } from '../lib/categorias'
import { listarCartoes, novaChave, registrarCompra } from '../lib/cartoes'
import type { Cartao } from '../lib/cartoes'
import type { Categoria } from '../lib/categorias'
import { hojeSP, listarContas } from '../lib/contas'
import type { Conta } from '../lib/contas'
import { mensagemErroBanco } from '../lib/erros'
import { currentMonth, formatBRL, formatBRLCampo, formatDate, formatMonth, parseBRL } from '../lib/format'
import type { Cents } from '../lib/format'
import {
  criarLancamento, editarLancamento, listarComprasDeCartao, listarLancamentos, listarMovimentosDeDivida, marcarComoPago,
  moverParaLixeira, restaurarDaLixeira, resumoDoMes, somarMeses,
} from '../lib/lancamentos'
import type { Filtros, Lancamento, MovimentoDivida, ParcelaDeCartao, ResumoMes, StatusLancamento, TipoLancamento } from '../lib/lancamentos'

const rotuloTipo: Record<TipoLancamento, string> = { expense: 'Despesa', income: 'Receita', transfer: 'Transferência' }

/** Sinal e cor por tipo: receita "+", despesa "−", transferência "⇄" sem sinal (design system). */
function valorComSinal(l: Lancamento) {
  if (l.tipo === 'income') return { texto: `+${formatBRL(l.valor)}`, cor: 'text-positivo' }
  if (l.tipo === 'expense') return { texto: `−${formatBRL(l.valor)}`, cor: 'text-negativo' }
  return { texto: `⇄ ${formatBRL(l.valor)}`, cor: 'text-slate-600' }
}

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
  const [filtros, setFiltros] = useState<Filtros>({})
  const [lancamentos, setLancamentos] = useState<Lancamento[] | null>(null)
  const [movimentosDivida, setMovimentosDivida] = useState<MovimentoDivida[]>([])
  const [compras, setCompras] = useState<ParcelaDeCartao[]>([])
  const [cartoes, setCartoes] = useState<Cartao[]>([])
  const [comprasFalharam, setComprasFalharam] = useState(false)
  const [semDataNoBanco, setSemDataNoBanco] = useState(0)
  const [resumo, setResumo] = useState<ResumoMes | null>(null)
  const [contas, setContas] = useState<Conta[]>([])
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [erro, setErro] = useState('')
  const [editando, setEditando] = useState<Lancamento | 'novo' | null>(null)

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
      // pagamento de fatura, juros e tarifa moram em outra tabela, mas mexem na conta: entram no extrato
      const semFiltroDeConta = !filtros.contaId && !filtros.categoriaId && !filtros.tipo
      // compras no cartão carregam à parte: se falharem, a lista de conta continua e só este bloco avisa
      const compras = semFiltroDeConta ? listarComprasDeCartao(familiaId, mes).catch(() => null) : Promise.resolve(null)
      const [l, r, md, cc] = await Promise.all([
        listarLancamentos(familiaId, mes, filtros), resumoDoMes(familiaId, mes), listarMovimentosDeDivida(familiaId, mes, filtros), compras,
      ])
      if (meu !== pedido.current) return
      setLancamentos(l)
      setMovimentosDivida(md)
      setCompras(cc?.parcelas ?? [])
      setComprasFalharam(semFiltroDeConta && cc === null)
      setSemDataNoBanco(cc?.semData ?? 0)
      setResumo(r)
      setErro('')
    } catch (err) {
      if (meu === pedido.current) setErro(mensagemErroBanco(err))
    }
  }, [familiaId, mes, filtros, automaticosProntos])

  useEffect(() => { void carregar() }, [carregar])

  const nomeConta = useMemo(() => new Map(contas.map((c) => [c.id, c.nome])), [contas])
  const nomeCategoria = useMemo(() => new Map(categorias.map((c) => [c.id, c.nome])), [categorias])

  async function agir(acao: () => Promise<void>) {
    try {
      await acao()
      await carregar()
    } catch (err) {
      setErro(mensagemErroBanco(err))
    }
  }

  async function excluir(l: Lancamento) {
    if (!window.confirm(`Enviar "${l.descricao || rotuloTipo[l.tipo]}" de ${formatBRL(l.valor)} para a lixeira?`)) return
    await agir(async () => { await moverParaLixeira(l.id); setNaLixeira(l) })
  }

  if (!familiaId) return null

  // agrupa por dia (mais recente primeiro); no mesmo dia, lançamentos antes dos movimentos de cartão/dívida
  type Item = { origem: 'lancamento'; l: Lancamento } | { origem: 'divida'; m: MovimentoDivida } | { origem: 'cartao'; c: ParcelaDeCartao }
  const itens: (Item & { data: string })[] = [
    ...(lancamentos ?? []).map((l) => ({ origem: 'lancamento' as const, l, data: l.data })),
    ...movimentosDivida.map((m) => ({ origem: 'divida' as const, m, data: m.data })),
    ...compras.map((c) => ({ origem: 'cartao' as const, c, data: c.data })),
  ].sort((x, y) => (x.data < y.data ? 1 : x.data > y.data ? -1 : 0))
  const porDia: [string, Item[]][] = []
  for (const it of itens) {
    const ultimo = porDia[porDia.length - 1]
    if (ultimo && ultimo[0] === it.data) ultimo[1].push(it)
    else porDia.push([it.data, [it]])
  }

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Lançamentos</h1>
        <div className="flex flex-wrap gap-2">
          <Link to="/recorrentes" className="inline-flex min-h-11 items-center rounded-lg px-4 text-sm font-semibold text-azul hover:bg-azul-claro">↻ Recorrentes</Link>
          {editando === null && <Button onClick={() => { setInicial(undefined); setEditando('novo') }} disabled={contas.length === 0}>Novo lançamento</Button>}
        </div>
      </div>

      {contas.length === 0 && lancamentos !== null && (
        <div className="mb-4"><Aviso tipo="info">Cadastre uma conta em <strong>Contas</strong> antes do primeiro lançamento.</Aviso></div>
      )}

      <div className="mb-4 flex items-center gap-2">
        <Button variante="secundario" aria-label="Mês anterior" onClick={() => setMes(somarMeses(mes, -1))}>‹</Button>
        <span className="min-w-44 text-center font-semibold capitalize">{formatMonth(mes)}</span>
        <Button variante="secundario" aria-label="Próximo mês" onClick={() => setMes(somarMeses(mes, 1))}>›</Button>
      </div>

      {resumo && (
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <Card><p className="text-sm text-slate-500">Receitas pagas</p><p className="tabular-nums text-xl font-bold text-positivo">+{formatBRL(resumo.receitas)}</p></Card>
          <Card><p className="text-sm text-slate-500">Despesas pagas</p><p className="tabular-nums text-xl font-bold text-negativo">−{formatBRL(resumo.despesas)}</p></Card>
          <Card>
            <p className="text-sm text-slate-500">Resultado do mês</p>
            <p className={`tabular-nums text-xl font-bold ${resumo.resultado < 0 ? 'text-negativo' : ''}`}>{formatBRL(resumo.resultado)}</p>
            {(resumo.receitasPrevistas > 0 || resumo.despesasPrevistas > 0) && (
              <p className="mt-1 text-xs text-planejado">
                Planejado: +{formatBRL(resumo.receitasPrevistas)} / −{formatBRL(resumo.despesasPrevistas)}
              </p>
            )}
          </Card>
        </div>
      )}

      {movimentosDivida.length > 0 && (
        <p className="mb-4 text-xs text-slate-500">
          Itens <strong>Cartão/dívida</strong> mexem no saldo da conta, então aparecem aqui para o extrato bater com o banco.
          <strong> Pagamento de fatura e amortização não são despesa</strong>: a compra já contou no mês da fatura.
          {' '}<strong>Juros e tarifa são despesa</strong> e já estão em "Despesas pagas", na categoria deles.
        </p>
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
            opcoes={categoriasDoFiltro.map((c) => [c.id, filtros.tipo ? c.nome : `${c.nome} (${c.tipo === 'income' ? 'receita' : 'despesa'})`])}
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
        <FormLancamento
          lancamento={editando === 'novo' ? null : editando}
          inicial={inicial}
          contas={contas}
          categorias={categorias}
          cartoes={cartoes}
          familiaId={familiaId}
          aoSalvar={async () => { setEditando(null); await carregar() }}
          aoCancelar={() => setEditando(null)}
        />
      )}

      {pagando !== null && (
        <PainelPagar
          lancamento={pagando}
          nomeConta={nomeConta.get(pagando.contaId) ?? '?'}
          aoConfirmar={async () => { setPagando(null); await carregar() }}
          aoCancelar={() => setPagando(null)}
        />
      )}

      {lancamentos === null && !erro && <p className="text-sm text-slate-600" role="status">Carregando…</p>}

      {comprasFalharam && (
        <div className="mb-4"><Aviso tipo="info">Não foi possível carregar as compras no cartão agora. Elas continuam em Cartões.</Aviso></div>
      )}
      {semDataNoBanco > 0 && (
        <div className="mb-4"><Aviso tipo="info">
          {semDataNoBanco === 1 ? '1 parcela de cartão' : `${semDataNoBanco} parcelas de cartão`} sem data de compra não aparece{semDataNoBanco === 1 ? '' : 'm'} aqui. Veja em <Link to="/cartoes" className="font-semibold underline">Cartões</Link>.
        </Aviso></div>
      )}

      {lancamentos?.length === 0 && movimentosDivida.length === 0 && editando === null && contas.length > 0 && (
        <EmptyState titulo="Nenhum lançamento neste mês" descricao="Registre receitas, despesas e transferências entre contas."
          acao={<Button onClick={() => setEditando('novo')}>Novo lançamento</Button>} />
      )}

      <div className="flex flex-col gap-4">
        {porDia.map(([data, itens]) => (
          <section key={data} aria-label={formatDate(data)}>
            <h2 className="mb-2 text-sm font-semibold text-slate-500">{formatDate(data)}</h2>
            <Card className="p-0">
              <ul className="divide-y divide-slate-100">
                {itens.map((item) => {
                  if (item.origem === 'cartao') {
                    const c = item.c
                    return (
                      <li key={`cartao-${c.id}`} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                        <div className="min-w-0">
                          <p className="font-medium">
                            {c.descricao}
                            {c.deParcelas > 1 && <span className="ml-2 text-xs text-slate-500">parcela {c.parcela}/{c.deParcelas}</span>}
                            <span className="ml-2 rounded bg-azul-claro px-2 py-0.5 text-xs font-medium text-marinho">No cartão</span>
                          </p>
                          <p className="text-sm text-slate-500">
                            {c.cartaoNome}
                            {c.compra !== c.data ? ` · compra de ${formatDate(c.compra)}` : ''}
                            {` · a despesa conta em ${formatDate(c.fechaEm)} (fechamento da fatura)`}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-1">
                          <span className="tabular-nums font-semibold text-slate-700">{formatBRL(c.valor)}</span>
                          <Link to="/cartoes" className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold text-azul hover:bg-azul-claro">Ver em Cartões</Link>
                        </div>
                      </li>
                    )
                  }
                  if (item.origem === 'divida') {
                    const m = item.m
                    return (
                      <li key={`divida-${m.id}`} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                        <div className="min-w-0">
                          <p className="font-medium">
                            {m.descricao}
                            <span className="ml-2 rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                              {m.jaEmDespesas ? 'Cartão/dívida · já em despesas' : 'Cartão/dívida'}
                            </span>
                          </p>
                          <p className="text-sm text-slate-500">{nomeConta.get(m.contaId) ?? '?'}</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-1">
                          <span className={`tabular-nums font-semibold ${m.valor < 0 ? 'text-slate-700' : 'text-positivo'}`}>
                            {m.valor < 0 ? '−' : '+'}{formatBRL(Math.abs(m.valor) as Cents)}
                          </span>
                          <Link to="/cartoes" className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold text-azul hover:bg-azul-claro">Ver em Cartões</Link>
                        </div>
                      </li>
                    )
                  }
                  const l = item.l
                  const v = valorComSinal(l)
                  const subtitulo = l.tipo === 'transfer'
                    ? `${nomeConta.get(l.contaId) ?? '?'} → ${nomeConta.get(l.destinoId ?? '') ?? '?'}`
                    : `${nomeCategoria.get(l.categoriaId ?? '') ?? 'Sem categoria'} · ${nomeConta.get(l.contaId) ?? '?'}`
                  return (
                    <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                      <div className="min-w-0">
                        <p className="font-medium">
                          {l.descricao || rotuloTipo[l.tipo]}
                          {l.status === 'planned' && <span className="ml-2 rounded bg-planejado-fundo px-2 py-0.5 text-xs font-medium text-planejado">Planejado</span>}
                          {l.recorrente && <span className="ml-2 text-xs text-slate-500" title="Gerado por um recorrente">↻ recorrente</span>}
                        </p>
                        <p className="text-sm text-slate-500">{subtitulo}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-1">
                        <span className={`tabular-nums font-semibold ${v.cor}`}>{v.texto}</span>
                        {l.status === 'planned' && <Button variante="fantasma" onClick={() => { setEditando(null); setPagando(l) }} disabled={pagando !== null}>Marcar pago</Button>}
                        <Button variante="fantasma" onClick={() => setEditando(l)}>Editar</Button>
                        <Button variante="fantasma" onClick={() => excluir(l)}>Excluir</Button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </Card>
          </section>
        ))}
      </div>
    </>
  )
}

/** Marcar pago: a pessoa confirma a data e o valor reais; o planejado é só a sugestão. */
function PainelPagar({ lancamento: l, nomeConta, aoConfirmar, aoCancelar }: {
  lancamento: Lancamento; nomeConta: string; aoConfirmar: () => Promise<void>; aoCancelar: () => void
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

  return (
    <Card className="mb-4">
      <h2 className="mb-1 text-lg font-semibold">Marcar como pago · {l.descricao || rotuloTipo[l.tipo]}</h2>
      <p className="mb-4 text-sm text-slate-600">
        Planejado: {formatDate(l.data)} · {formatBRL(l.valor)} · {nomeConta}. Informe {entrada ? 'quando e quanto entrou' : 'quando e quanto saiu'} de
        verdade: o saldo da conta e o extrato usam esta data e este valor.
      </p>
      <form onSubmit={confirmar} className="grid gap-4 md:grid-cols-2" noValidate>
        {erro && <div className="md:col-span-2"><Aviso tipo="erro">{erro}</Aviso></div>}
        <Field rotulo={entrada ? 'Data do recebimento' : 'Data do pagamento'} type="date" value={data} onChange={(e) => setData(e.target.value)} erro={erroData} />
        <Field rotulo="Valor (R$)" inputMode="decimal" value={valorTexto} onChange={(e) => setValorTexto(e.target.value)} erro={erroValor} />
        <div className="flex gap-2 md:col-span-2">
          <Button type="submit" carregando={enviando}>Confirmar pagamento</Button>
          <Button variante="secundario" onClick={aoCancelar}>Cancelar</Button>
        </div>
      </form>
    </Card>
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
  aoCancelar: () => void
}

function FormLancamento({ lancamento: l, inicial, contas, categorias, cartoes, familiaId, aoSalvar, aoCancelar }: PropsForm) {
  const hoje = hojeSP()
  const ativas = contas.filter((c) => c.ativa || c.id === l?.contaId || c.id === l?.destinoId)
  const [tipo, setTipo] = useState<TipoLancamento>(l?.tipo ?? (inicial && inicial !== 'cartao' ? inicial : 'expense'))
  const [valorTexto, setValorTexto] = useState(l ? formatBRLCampo(l.valor) : '')
  const [data, setData] = useState(l?.data ?? hoje)
  const [descricao, setDescricao] = useState(l?.descricao ?? '')
  const [contaId, setContaId] = useState(l?.contaId ?? ativas[0]?.id ?? '')
  const [destinoId, setDestinoId] = useState(l?.destinoId ?? '')
  const [categoriaId, setCategoriaId] = useState(l?.categoriaId ?? '')
  // planejado por padrão quando a data é futura; a pessoa pode trocar
  const [status, setStatus] = useState<StatusLancamento | null>(l?.status ?? null)
  const statusEfetivo: StatusLancamento = status ?? (data > hoje ? 'planned' : 'paid')
  const [notas, setNotas] = useState(l?.notas ?? '')
  const [tentou, setTentou] = useState(false)
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  // Onde foi: conta (dinheiro saiu/entrou agora) ou cartão (compra parcelada; a despesa conta na fatura).
  // Só para lançamento novo: editar continua sendo conta, como antes.
  const [onde, setOnde] = useState<'conta' | 'cartao'>(!l && inicial === 'cartao' ? 'cartao' : 'conta')
  const [cartaoId, setCartaoId] = useState('')
  const [parcelasTexto, setParcelasTexto] = useState('1')
  const chaveRef = useRef<{ sig: string; chave: string } | null>(null)
  const cartaoMode = !l && onde === 'cartao'
  const cartoesComCiclo = cartoes.filter((c) => c.ativo && c.fechamento !== null)
  const parcelas = Number(parcelasTexto)

  const valor = parseBRL(valorTexto)
  const transferencia = tipo === 'transfer'
  const categoriasDoTipo = categorias.filter((c) => c.tipo === tipo && (c.ativa || c.id === l?.categoriaId))
  const conta = contas.find((c) => c.id === contaId)

  const erros = {
    valor: valor === null || valor <= 0 ? 'Informe um valor maior que zero. Exemplo: 1.250,50.' : undefined,
    conta: !cartaoMode && !contaId ? 'Escolha a conta.' : undefined,
    cartao: cartaoMode && !cartaoId ? 'Escolha o cartão.' : undefined,
    parcelas: cartaoMode && !(Number.isInteger(parcelas) && parcelas >= 1 && parcelas <= 72) ? 'De 1 a 72 parcelas.' : undefined,
    descricao: cartaoMode && !descricao.trim() ? 'Descreva a compra (ex.: Fone, Mercado).' : undefined,
    destino: transferencia && (!destinoId || destinoId === contaId) ? 'Escolha uma conta de destino diferente da origem.' : undefined,
    categoria: !transferencia && !categoriaId ? 'Escolha a categoria.' : undefined,
    data: !data ? 'Informe a data.' : undefined,
  }

  async function salvar(e: FormEvent) {
    e.preventDefault()
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
        await registrarCompra(cartaoId, { descricao: descricao.trim(), data, total: valor as Cents, parcelas, categoriaId }, chaveRef.current.chave)
        await aoSalvar()
        return
      }
      const dados = {
        tipo, contaId, destinoId: transferencia ? destinoId : null, categoriaId: transferencia ? null : categoriaId,
        descricao, valor: valor as Cents, data, status: statusEfetivo, notas,
      }
      if (l) await editarLancamento(l.id, dados)
      else await criarLancamento(familiaId, dados)
      await aoSalvar()
    } catch (err) {
      setErro(mensagemErroBanco(err))
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Card className="mb-6">
      <h2 className="mb-4 text-lg font-semibold">{l ? 'Editar lançamento' : 'Novo lançamento'}</h2>
      <form onSubmit={salvar} className="grid gap-4 md:grid-cols-2" noValidate>
        {erro && <div className="md:col-span-2"><Aviso tipo="erro">{erro}</Aviso></div>}

        {!l && (
          <div role="radiogroup" aria-label="Onde foi lançado" className="inline-flex w-fit rounded-lg bg-slate-100 p-1 md:col-span-2">
            {([['conta', 'Conta'], ['cartao', 'Cartão de crédito']] as const).map(([valorOnde, rotulo]) => (
              <button key={valorOnde} type="button" role="radio" aria-checked={onde === valorOnde}
                onClick={() => { setOnde(valorOnde); if (valorOnde === 'cartao') { setTipo('expense'); setCategoriaId('') } }}
                className={`min-h-11 rounded-md px-4 text-sm font-semibold ${onde === valorOnde ? 'bg-white text-marinho shadow-card' : 'text-slate-600'}`}>
                {rotulo}
              </button>
            ))}
          </div>
        )}

        {!cartaoMode && (
        <div role="radiogroup" aria-label="Tipo do lançamento" className="inline-flex w-fit rounded-lg bg-slate-100 p-1 md:col-span-2">
          {(Object.keys(rotuloTipo) as TipoLancamento[]).map((t) => (
            <button key={t} type="button" role="radio" aria-checked={tipo === t}
              onClick={() => { setTipo(t); setCategoriaId('') }}
              className={`min-h-11 rounded-md px-4 text-sm font-semibold ${tipo === t ? 'bg-white text-marinho shadow-card' : 'text-slate-600'}`}>
              {rotuloTipo[t]}
            </button>
          ))}
        </div>
        )}

        <Field rotulo="Valor (R$)" inputMode="decimal" placeholder="0,00" value={valorTexto} onChange={(e) => setValorTexto(e.target.value)} erro={tentou ? erros.valor : undefined} />
        <Field rotulo={cartaoMode ? 'Data da compra' : 'Data'} type="date" value={data} onChange={(e) => setData(e.target.value)} erro={tentou ? erros.data : undefined} />
        <Field rotulo="Descrição" maxLength={200} placeholder="Ex.: Supermercado" value={descricao} onChange={(e) => setDescricao(e.target.value)}
          erro={tentou ? erros.descricao : undefined} />

        {cartaoMode ? (
          <>
            <Selecao rotulo="Cartão" valor={cartaoId} aoMudar={setCartaoId}
              opcoes={cartoesComCiclo.map((c) => [c.id, c.nome])} todos="Escolha…" />
            {tentou && erros.cartao && <p className="text-sm text-negativo md:col-span-2" role="alert">{erros.cartao}</p>}
            {cartoesComCiclo.length === 0 && (
              <p className="text-sm text-slate-600 md:col-span-2">Nenhum cartão com fechamento definido. Defina em <Link to="/cartoes" className="font-semibold text-azul underline">Cartões</Link>.</p>
            )}
            <Field rotulo="Parcelas" type="number" min={1} max={72} value={parcelasTexto} onChange={(e) => setParcelasTexto(e.target.value)}
              erro={tentou ? erros.parcelas : undefined} />
          </>
        ) : (
          <>
            <Selecao rotulo={transferencia ? 'Da conta' : 'Conta'} valor={contaId} aoMudar={setContaId}
              opcoes={ativas.map((c) => [c.id, c.nome])} todos={contaId ? undefined : 'Escolha…'} />
            {tentou && erros.conta && <p className="text-sm text-negativo md:col-span-2" role="alert">{erros.conta}</p>}
          </>
        )}

        {transferencia ? (
          <>
            <Selecao rotulo="Para a conta" valor={destinoId} aoMudar={setDestinoId}
              opcoes={ativas.filter((c) => c.id !== contaId).map((c) => [c.id, c.nome])} todos="Escolha…" />
            {tentou && erros.destino && <p className="text-sm text-negativo md:col-span-2" role="alert">{erros.destino}</p>}
          </>
        ) : (
          <>
            <Selecao rotulo="Categoria" valor={categoriaId} aoMudar={setCategoriaId}
              opcoes={categoriasDoTipo.map((c) => [c.id, c.paiId ? `↳ ${c.nome}` : c.nome])} todos="Escolha…" />
            {tentou && erros.categoria && <p className="text-sm text-negativo md:col-span-2" role="alert">{erros.categoria}</p>}
          </>
        )}

        {!cartaoMode && <fieldset className="flex flex-col gap-1">
          <legend className="text-sm font-medium">Situação</legend>
          <div className="flex gap-4">
            {(['paid', 'planned'] as StatusLancamento[]).map((s) => (
              <label key={s} className="flex min-h-11 items-center gap-2">
                <input type="radio" name="status" checked={statusEfetivo === s} onChange={() => setStatus(s)} />
                {s === 'paid' ? 'Pago' : 'Planejado'}
              </label>
            ))}
          </div>
        </fieldset>}
        {!cartaoMode && <Field rotulo="Observações (opcional)" maxLength={1000} value={notas} onChange={(e) => setNotas(e.target.value)} />}

        {!transferencia && !cartaoMode && conta && data && data < conta.abertura && (
          <div className="md:col-span-2">
            <Aviso tipo="info">
              Data anterior ao saldo inicial de {conta.nome} ({formatDate(conta.abertura)}): o lançamento entra nos relatórios, mas <strong>não altera o saldo</strong> da conta.
            </Aviso>
          </div>
        )}
        {statusEfetivo === 'planned' && !cartaoMode && (
          <p className="text-sm text-slate-600 md:col-span-2">Planejado não entra no saldo nem nos totais pagos até ser marcado como pago.</p>
        )}
        {cartaoMode && (
          <p className="text-sm text-slate-600 md:col-span-2">
            Compra no cartão: não mexe no saldo da conta agora. Cada parcela vira despesa no mês em que a fatura fecha, e o pagamento da fatura é separado.
          </p>
        )}

        <div className="flex gap-2 md:col-span-2">
          <Button type="submit" carregando={enviando}>{l ? 'Salvar' : 'Lançar'}</Button>
          <Button variante="secundario" onClick={aoCancelar}>Cancelar</Button>
        </div>
      </form>
    </Card>
  )
}
