import { Fragment, useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Aviso } from '../components/ui/Aviso'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { EmptyState } from '../components/ui/EmptyState'
import { Field } from '../components/ui/Field'
import { Folha } from '../components/ui/Folha'
import { Selecao } from '../components/ui/Selecao'
import { Chip, Chips, GrupoFiltro, TelaFiltros } from '../components/ui/TelaFiltros'
import { BANCOS_POR_NOME, tipoSemBanco } from '../lib/bancos'
import { IconeConta } from '../components/ui/IconeConta'
import { EmOutrasMoedas } from '../components/ui/EmOutrasMoedas'
import { useFamilia } from '../lib/FamiliaContext'
import { ajudaTipoConta, criarConta, definirAtiva, editarConta, ehReais, ehTipoConta, excluirConta, GRUPOS_TIPO_CONTA, hojeSP, listarContas, MOEDAS_CONTA, outrasMoedas, rotuloDoTipo, rotuloTipoConta, TIPOS_CONTA } from '../lib/contas'
import type { Conta, TipoConta, TotalPorMoeda, TotalPorTipo } from '../lib/contas'
import { mensagemErroBanco } from '../lib/erros'
import { apagarEtiqueta, criarEtiqueta, definirEtiquetasDaConta, erroNomeEtiqueta, listarEtiquetas, MAX_ETIQUETAS_CONTA, MAX_ETIQUETAS_FAMILIA, MAX_NOME_ETIQUETA, mesmasEtiquetas, renomearEtiqueta } from '../lib/etiquetas'
import type { Etiqueta, EtiquetasDaFamilia } from '../lib/etiquetas'
import { formatBRL, formatBRLCampo, formatDate, formatMoeda, parseBRL, simboloMoeda } from '../lib/format'
import type { Cents } from '../lib/format'
import { CabecalhoPagina } from '../components/ui/CabecalhoPagina'
import { MoverParaCarteira, podeMoverParaCarteira } from '../components/MoverParaCarteira'
import { corDoValor } from '../lib/cores'
import { converterParaReais, textoCotacao } from '../lib/cambio'
import type { EmReais } from '../lib/cambio'
import { codigoDoErro, registrarFalhaConsulta } from '../lib/consultaOpcional'
import { criarAtivoInvestimento, registrarOperacaoPorValor } from '../lib/investimentos'
import type { ClasseAtivo } from '../lib/investimentos'

/**
 * Tipos que, na criação, não viram conta: viram o ATIVO em Investimentos (pedido do dono, 19/11/2026: "se eu escolher uma opção de
 * investimento, ele atualiza lá nos Investimentos"). Decisão de 10/11/2026: conta é só a corrente; o que rende é investimento, e a
 * mesma aplicação como conta e como ativo contaria duas vezes no Patrimônio. Corretora (saldo a aplicar) e Poupança / reserva seguem
 * como conta. Só em reais: conta em dólar ou euro continua conta (decisão da Nomad, de 10/11).
 */
const CLASSE_DO_TIPO_DE_CONTA: Partial<Record<TipoConta, ClasseAtivo>> = { fixed_income: 'fixed_income', variable_income: 'equity', crypto: 'crypto' }

/** Saldo na moeda da conta (BRL continua com formatBRL). */
function textoSaldo(c: Conta): string {
  return c.saldo === null ? `abre em ${formatDate(c.abertura)}` : formatMoeda(c.saldo, c.moeda ?? 'BRL')
}

/** Selo da moeda, só nas contas que não são em reais. */
function SeloMoeda({ conta }: { conta: Conta }) {
  if (ehReais(conta)) return null
  return (
    <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 align-middle text-xs font-semibold text-slate-700"
      title={`Conta em ${conta.moeda}: o saldo fica fora do total em reais`}>
      {conta.moeda}
    </span>
  )
}

/** Etiquetas da conta como selos discretos (só organização: não mexem em nenhum valor). */
function SelosEtiquetas({ ids, porId }: { ids: string[] | undefined; porId: Map<string, Etiqueta> }) {
  const nomes = (ids ?? []).map((id) => porId.get(id)?.nome).filter((n): n is string => !!n).sort((a, b) => a.localeCompare(b, 'pt-BR'))
  if (nomes.length === 0) return null
  return (
    <ul className="flex flex-wrap gap-1" aria-label="Etiquetas">
      {nomes.map((n) => (
        <li key={n} className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-xs font-medium text-slate-700">{n}</li>
      ))}
    </ul>
  )
}

/** Linha do tipo, com as etiquetas logo ao lado. */
function LinhaTipo({ conta, tags, porId }: { conta: Conta; tags: EtiquetasDaFamilia; porId: Map<string, Etiqueta> }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <p className="text-sm text-slate-500">{rotuloDoTipo(conta.tipo)} · desde {formatDate(conta.abertura)}</p>
      <SelosEtiquetas ids={tags.porConta.get(conta.id)} porId={porId} />
    </div>
  )
}

const SEM_ETIQUETAS: EtiquetasDaFamilia = { disponivel: false, etiquetas: [], porConta: new Map() }

/** Título de cada grupo da lista (um por tipo, na ordem de TIPOS_CONTA). */
const TITULO_GRUPO: Record<TipoConta, string> = {
  checking: 'Contas correntes',
  savings: 'Poupança / reserva',
  brokerage: 'Corretora (saldo a aplicar)',
  fixed_income: 'Renda fixa',
  variable_income: 'Renda variável',
  crypto: 'Cripto',
  cash: 'Dinheiro (carteira)',
}

export default function Contas() {
  const { familia } = useFamilia()
  const familiaId = familia?.id
  const [contas, setContas] = useState<Conta[] | null>(null)
  const [total, setTotal] = useState<Cents | null>(null)
  const [porTipo, setPorTipo] = useState<TotalPorTipo[]>([])
  const [porMoeda, setPorMoeda] = useState<TotalPorMoeda[]>([])
  // saldo das contas em outra moeda convertido para reais (PTAX, migration 108); só para mostrar, fora de todo total
  const [emReais, setEmReais] = useState<Map<string, EmReais>>(new Map())
  const [erro, setErro] = useState('')
  // null = formulário fechado; 'nova' = criando; Conta = editando
  const [editando, setEditando] = useState<Conta | 'nova' | null>(null)
  const [excluindo, setExcluindo] = useState<Conta | null>(null)
  const [movendo, setMovendo] = useState<Conta | null>(null)
  const [tags, setTags] = useState<EtiquetasDaFamilia>(SEM_ETIQUETAS)
  // '' = todas as contas; senão, o id da etiqueta escolhida no filtro
  const [filtro, setFiltro] = useState('')
  // arquivadas ficam escondidas atrás do botão "Arquivadas (N)" (pedido do dono, 06/11/2026)
  const [verArquivadas, setVerArquivadas] = useState(false)

  const carregarEtiquetas = useCallback(async () => {
    if (!familiaId) return
    setTags(await listarEtiquetas(familiaId))
  }, [familiaId])

  const carregar = useCallback(async () => {
    if (!familiaId) return
    try {
      // falha nas etiquetas não esconde as contas: avisa e a lista segue sem os selos
      let falhaEtiquetas = ''
      const [r] = await Promise.all([
        listarContas(familiaId),
        carregarEtiquetas().catch((err: unknown) => { falhaEtiquetas = `As etiquetas não carregaram: ${mensagemErroBanco(err)}` }),
      ])
      setContas(r.contas)
      setTotal(r.total)
      setPorTipo(r.porTipo ?? [])
      setPorMoeda(r.porMoeda ?? [])
      setErro(falhaEtiquetas)
      // "≈ R$" ao lado do saldo em dólar e euro, convertido no banco. Opcional: sem ele a lista segue igual.
      const estrangeiras = r.contas.filter((c) => c.ativa && !ehReais(c) && c.saldo !== null)
      try {
        const conv = await converterParaReais(estrangeiras.map((c) => ({ moeda: c.moeda ?? 'BRL', valor: c.saldo as Cents })), hojeSP())
        setEmReais(new Map(conv.flatMap((x, i) => (x.reais === null ? [] : [[estrangeiras[i].id, x] as [string, EmReais]]))))
      } catch (e) {
        if (codigoDoErro(e) !== 'PGRST202') void registrarFalhaConsulta('fx_to_brl', e)
        setEmReais(new Map())
      }
    } catch (err) {
      setErro(mensagemErroBanco(err))
    }
  }, [familiaId, carregarEtiquetas])

  useEffect(() => { void carregar() }, [carregar])

  async function alternarAtiva(c: Conta) {
    try {
      await definirAtiva(c.id, !c.ativa)
      await carregar()
    } catch (err) {
      setErro(mensagemErroBanco(err))
    }
  }

  async function confirmarExclusao(c: Conta) {
    try {
      await excluirConta(c.id)
      setExcluindo(null)
      await carregar()
    } catch (err) {
      setErro(mensagemErroBanco(err))
      setExcluindo(null)
    }
  }

  const etiquetaPorId = new Map(tags.etiquetas.map((e) => [e.id, e]))
  // filtro por etiqueta: só esconde contas da lista; nenhum valor muda (etiqueta não entra em cálculo)
  const etiquetaFiltro = filtro ? etiquetaPorId.get(filtro) : undefined
  const passaFiltro = (c: Conta) => !etiquetaFiltro || (tags.porConta.get(c.id) ?? []).includes(etiquetaFiltro.id)
  const visiveis = contas?.filter(passaFiltro) ?? []
  // contas em reais agrupadas por tipo (o subtotal do banco só soma BRL); as de outra moeda ficam num grupo à parte
  const ativas = visiveis.filter((c) => c.ativa && ehReais(c))
  const ativasOutras = visiveis.filter((c) => c.ativa && !ehReais(c))
  const arquivadas = visiveis.filter((c) => !c.ativa)
  const outras = outrasMoedas(porMoeda)
  // agrupadas pelos 7 tipos (onde o dinheiro está), na ordem de TIPOS_CONTA; o subtotal vem do banco
  // subtotal: cada valor com a sua cor (negativo vermelho, corDoValor); vários só nas outras moedas, nunca somados
  const grupos: { chave: string; titulo: string; contas: Conta[]; subtotal: { texto: string; valor: number }[] | null }[] = TIPOS_CONTA
    .map((tipo) => {
      const sub = porTipo.find((t) => t.tipo === tipo)?.totalAtivas
      // com filtro o subtotal do banco (de todas as contas do tipo) não vale para as contas mostradas: some, sem somar no front
      return { chave: tipo, titulo: TITULO_GRUPO[tipo], contas: ativas.filter((c) => c.tipo === tipo),
        subtotal: sub === undefined || etiquetaFiltro ? null : [{ texto: formatBRL(sub), valor: sub }] }
    })
    .filter((g) => g.contas.length > 0)
  // tipo de antes da 070 (front no ar antes da migration): a conta não some; fica num grupo próprio, sem subtotal
  const tipoAntigo = ativas.filter((c) => !ehTipoConta(c.tipo))
  if (tipoAntigo.length > 0) grupos.push({ chave: 'tipo-antigo', titulo: 'Tipo a revisar', contas: tipoAntigo, subtotal: null })
  // subtotal por moeda (do banco, sem conversão), nunca somando moedas diferentes
  if (ativasOutras.length > 0) {
    grupos.push({ chave: 'outras-moedas', titulo: 'Contas em outras moedas', contas: ativasOutras,
      subtotal: outras.length > 0 && !etiquetaFiltro ? outras.map((m) => ({ texto: formatMoeda(m.totalAtivas, m.moeda), valor: m.totalAtivas })) : null })
  }

  if (!familia) return null
  return (
    <>
      <CabecalhoPagina titulo="Contas" descricao="Saldo de cada conta, vindo do banco."
        acoes={editando === null && <Button onClick={() => setEditando('nova')}>Nova conta</Button>} />

      {erro && <div className="mb-4"><Aviso tipo="erro">{erro}</Aviso></div>}

      {editando !== null && (
        <FormConta
          conta={editando === 'nova' ? null : editando}
          familiaId={familia.id}
          etiquetas={tags}
          aoCriarEtiqueta={(e) => setTags((t) => ({ ...t, etiquetas: [...t.etiquetas, e].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')) }))}
          aoSalvar={async (aviso) => {
            setEditando(null)
            await carregar()
            if (aviso) setErro(aviso)
          }}
          aoCancelar={() => setEditando(null)}
        />
      )}

      {contas === null && !erro && <p className="text-sm text-slate-600" role="status">Carregando…</p>}

      {contas?.length === 0 && editando === null && (
        <EmptyState
          titulo="Nenhuma conta ainda"
          descricao="Cadastre as contas da família (corrente, reserva, corretora, investimentos, dinheiro) com o saldo do dia em que você começar a usar o app."
          acao={<Button onClick={() => setEditando('nova')}>Cadastrar a primeira conta</Button>}
        />
      )}

      {contas && contas.length > 0 && (
        <>
          <Card className="mb-4">
            <p className="text-sm font-semibold text-slate-500">{outras.length > 0 ? 'Saldo total em reais hoje' : 'Saldo total hoje'}</p>
            <p className="tabular-nums text-3xl font-bold">{total !== null ? formatBRL(total) : '—'}</p>
            <p className="mt-1 text-xs text-slate-500">Inclui contas arquivadas: o dinheiro continua lá.</p>
            <EmOutrasMoedas porMoeda={porMoeda} className="mt-3 border-t border-slate-200 pt-3" />
          </Card>
          {movendo && (
            <MoverParaCarteira conta={movendo} aoCancelar={() => setMovendo(null)}
              aoConcluir={() => { setMovendo(null); void carregar() }} />
          )}
          {excluindo && (
            <Folha titulo={`Excluir ${excluindo.nome}`} aoFechar={() => setExcluindo(null)}>
              <div role="group" aria-label="Excluir conta">
                <p className="text-sm">
                  Excluir a conta <strong>{excluindo.nome}</strong> de vez. Só é possível se ela nunca teve lançamento, transferência
                  nem recorrente; se tiver, o app avisa e você pode <strong>arquivar</strong> em vez de excluir. Não dá para desfazer.
                </p>
                <div className="mt-3 flex gap-2">
                  <Button variante="perigo" onClick={() => void confirmarExclusao(excluindo)}>Excluir conta</Button>
                  <Button variante="secundario" onClick={() => setExcluindo(null)}>Cancelar</Button>
                </div>
              </div>
            </Folha>
          )}
          {tags.disponivel && (
            <GerenciarEtiquetas
              familiaId={familia.id}
              tags={tags}
              filtro={etiquetaFiltro ? filtro : ''}
              aoFiltrar={setFiltro}
              aoMudar={async () => {
                try { await carregarEtiquetas() } catch (err) { setErro(mensagemErroBanco(err)) }
              }}
            />
          )}
          {etiquetaFiltro && (
            <p className="mb-4 text-sm text-slate-600" role="status">
              {visiveis.length === 0
                ? `Nenhuma conta com a etiqueta "${etiquetaFiltro.nome}".`
                : `Mostrando ${visiveis.length} conta${visiveis.length === 1 ? '' : 's'} com a etiqueta "${etiquetaFiltro.nome}". Os subtotais por tipo somem com o filtro; o saldo total continua o da família.`}
            </p>
          )}
          {grupos.map((g) => (
            <section key={g.chave} className="mb-6" aria-labelledby={`titulo-contas-${g.chave}`}>
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <h2 id={`titulo-contas-${g.chave}`} className="text-lg font-semibold">{g.titulo}</h2>
                {g.subtotal !== null && (
                  <span className="tabular-nums text-sm font-semibold" data-testid={`subtotal-${g.chave}`}>
                    {g.subtotal.map((v, i) => <Fragment key={i}>{i > 0 && <span className="text-slate-500"> · </span>}<span className={corDoValor(v.valor)}>{v.texto}</span></Fragment>)}
                  </span>
                )}
              </div>
              <ul className="flex flex-col gap-3">
                {g.contas.map((c) => (
                  <li key={c.id}>
                    <Card className={`flex flex-wrap items-center justify-between gap-3 ${c.ativa ? '' : 'opacity-70'}`}>
                      <div className="flex min-w-0 items-center gap-3">
                        <IconeConta nome={c.nome} tipo={c.tipo} banco={c.banco} />
                        <div className="min-w-0">
                          <p className="font-semibold">
                            {c.nome}<SeloMoeda conta={c} />
                          </p>
                          <LinhaTipo conta={c} tags={tags} porId={etiquetaPorId} />
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`tabular-nums text-lg font-semibold ${c.saldo === null ? '' : corDoValor(c.saldo)}`}>
                          {textoSaldo(c)}
                        </span>
                        {emReais.get(c.id)?.valor === c.saldo && c.saldo !== 0 && (
                          // fica fora do total em reais: é só para ter ideia do valor (PTAX de compra, com a data)
                          <span className="text-xs text-slate-500" title={textoCotacao(emReais.get(c.id)!, simboloMoeda(c.moeda ?? 'BRL'))}>
                            ≈ <span className="tabular-nums font-semibold text-slate-700">{formatBRL(emReais.get(c.id)!.reais!)}</span>
                            <span className="block">{textoCotacao(emReais.get(c.id)!, simboloMoeda(c.moeda ?? 'BRL'))}</span>
                          </span>
                        )}
                        {/* as três ações quebram juntas: o "Excluir" nunca cai sozinho numa linha (auditoria 5h) */}
                        <div className="flex items-center gap-1" data-acoes-conta>
                          <Button variante="fantasma" compacto onClick={() => setEditando(c)}>Editar</Button>
                          <Button variante="fantasma" compacto onClick={() => alternarAtiva(c)}>Arquivar</Button>
                          <Button variante="perigoTexto" compacto onClick={() => setExcluindo(c)}>Excluir</Button>
                        </div>
                        {podeMoverParaCarteira(c) && (
                          <Button variante="pilula" compacto onClick={() => setMovendo(c)} aria-label={`Mover ${c.nome} para a carteira`}>Mover para a carteira</Button>
                        )}
                      </div>
                    </Card>
                  </li>
                ))}
              </ul>
            </section>
          ))}

          {arquivadas.length > 0 && (
            <div className="mt-8">
              <Button variante="fantasma" aria-expanded={verArquivadas} aria-controls="secao-contas-arquivadas"
                onClick={() => setVerArquivadas((v) => !v)}>
                {`Arquivadas (${arquivadas.length})`} <span aria-hidden="true">{verArquivadas ? '▴' : '▾'}</span>
              </Button>
            </div>
          )}
          {arquivadas.length > 0 && verArquivadas && (
            <section id="secao-contas-arquivadas" className="mt-3" aria-labelledby="titulo-contas-arquivadas">
              <h2 id="titulo-contas-arquivadas" className="mb-1 text-lg font-semibold">Arquivadas</h2>
              <p className="mb-3 text-sm text-slate-600">Não aparecem nas escolhas de lançamento. O saldo e o histórico continuam valendo.</p>
              <ul className="flex flex-col gap-2">
                {arquivadas.map((c) => (
                  <li key={c.id}>
                    <Card className="flex flex-wrap items-center justify-between gap-3 opacity-80">
                      <div className="flex min-w-0 items-center gap-3">
                        <IconeConta nome={c.nome} tipo={c.tipo} banco={c.banco} />
                        <div className="min-w-0">
                          <p className="font-semibold">{c.nome}<SeloMoeda conta={c} /></p>
                          <LinhaTipo conta={c} tags={tags} porId={etiquetaPorId} />
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`tabular-nums text-lg font-semibold ${c.saldo === null ? '' : corDoValor(c.saldo)}`}>
                          {textoSaldo(c)}
                        </span>
                        <Button variante="secundario" onClick={() => alternarAtiva(c)}>Reativar</Button>
                      </div>
                    </Card>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </>
  )
}

interface PropsGerenciar {
  familiaId: string
  tags: EtiquetasDaFamilia
  filtro: string
  aoFiltrar: (id: string) => void
  aoMudar: () => Promise<void>
}

/**
 * Filtro por etiqueta e a seção recolhível para criar, renomear e apagar as etiquetas da família.
 * Apagar só tira a etiqueta das contas: nenhuma conta, saldo ou lançamento muda.
 */
function GerenciarEtiquetas({ familiaId, tags, filtro, aoFiltrar, aoMudar }: PropsGerenciar) {
  const [nova, setNova] = useState('')
  const [tentouNova, setTentouNova] = useState(false)
  const [renomeando, setRenomeando] = useState<{ id: string; nome: string } | null>(null)
  const [apagando, setApagando] = useState<Etiqueta | null>(null)
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [filtrosAbertos, setFiltrosAbertos] = useState(false)
  const nomeFiltro = tags.etiquetas.find((t) => t.id === filtro)?.nome
  const uso = (id: string) => [...tags.porConta.values()].filter((ids) => ids.includes(id)).length
  const textoUso = (id: string) => {
    const n = uso(id)
    return n === 0 ? 'em nenhuma conta' : `em ${n} conta${n === 1 ? '' : 's'}`
  }
  const erroNova = tentouNova ? erroNomeEtiqueta(nova, tags.etiquetas) : null
  const erroRenomear = renomeando ? erroNomeEtiqueta(renomeando.nome, tags.etiquetas, renomeando.id) : null
  const cheia = tags.etiquetas.length >= MAX_ETIQUETAS_FAMILIA

  async function executar(acao: () => Promise<unknown>): Promise<boolean> {
    setErro('')
    setEnviando(true)
    try {
      await acao()
      await aoMudar()
      return true
    } catch (err) {
      setErro(mensagemErroBanco(err))
      return false
    } finally {
      setEnviando(false)
    }
  }

  async function criar(e: FormEvent) {
    e.preventDefault()
    setTentouNova(true)
    if (erroNomeEtiqueta(nova, tags.etiquetas)) return
    if (await executar(() => criarEtiqueta(familiaId, nova))) { setNova(''); setTentouNova(false) }
  }

  async function salvarNome(e: FormEvent) {
    e.preventDefault()
    if (!renomeando || erroRenomear) return
    const { id, nome } = renomeando
    if (await executar(() => renomearEtiqueta(id, nome))) setRenomeando(null)
  }

  async function confirmarApagar(t: Etiqueta) {
    if (await executar(() => apagarEtiqueta(t.id))) {
      setApagando(null)
      if (filtro === t.id) aoFiltrar('')
    }
  }

  return (
    <div className="mb-4 flex flex-col gap-3">
      {tags.etiquetas.length > 0 && (
        // filtro na tela cheia compartilhada (pedido do dono, 10/11/2026, como em Lançamentos): só esconde contas da lista,
        // nenhum valor muda; cada toque vale na hora
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setFiltrosAbertos(true)} aria-haspopup="dialog" aria-expanded={filtrosAbertos}
            className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold text-azul hover:bg-azul-claro">
            Filtrar{filtro && <span className="ml-1.5 rounded-full bg-azul px-1.5 text-xs text-white">1</span>}
          </button>
          {nomeFiltro && (
            <button type="button" onClick={() => aoFiltrar('')} aria-label={`Tirar o filtro ${nomeFiltro}`}
              className="inline-flex min-h-9 items-center gap-1 rounded-full bg-azul-claro px-3 text-xs font-semibold text-marinho">
              {nomeFiltro}<span aria-hidden="true">×</span>
            </button>
          )}
        </div>
      )}
      {filtrosAbertos && (
        <TelaFiltros titulo="Filtrar contas" aoFechar={() => setFiltrosAbertos(false)}
          acaoPrincipal={{ rotulo: 'Filtrar', nomeAcessivel: 'Filtrar: ver as contas', aoAcionar: () => setFiltrosAbertos(false) }}
          rodape={<button type="button" onClick={() => aoFiltrar('')} disabled={!filtro}
            className="min-h-11 text-sm font-semibold text-azul hover:underline disabled:text-slate-400 disabled:no-underline">Limpar filtros</button>}>
          <GrupoFiltro titulo="Etiquetas">
            <Chips>
              {tags.etiquetas.map((t) => (
                <Chip key={t.id} pressionado={filtro === t.id} onClick={() => aoFiltrar(filtro === t.id ? '' : t.id)}>{t.nome}</Chip>
              ))}
            </Chips>
          </GrupoFiltro>
        </TelaFiltros>
      )}
      <details className="rounded-lg border border-slate-200 bg-white">
        <summary className="flex min-h-11 cursor-pointer items-center px-4 text-sm font-semibold text-marinho">
          Etiquetas ({tags.etiquetas.length})
        </summary>
        <div className="flex flex-col gap-4 border-t border-slate-200 p-4">
          <p className="text-sm text-slate-600">
            Organize as contas do seu jeito (ex.: Reserva de emergência, Conjunta, PJ). A etiqueta não muda o tipo da conta
            nem nenhum valor: os saldos e os indicadores continuam pelo tipo.
          </p>
          {erro && <Aviso tipo="erro">{erro}</Aviso>}
          <form onSubmit={criar} className="flex flex-wrap items-end gap-2" noValidate>
            <div className="min-w-0 flex-1">
              <Field rotulo="Nova etiqueta" maxLength={MAX_NOME_ETIQUETA} value={nova} placeholder="Ex.: Viagem 2027"
                onChange={(e) => setNova(e.target.value)} erro={erroNova ?? undefined} disabled={cheia} />
            </div>
            <Button type="submit" variante="secundario" carregando={enviando} disabled={cheia}>Criar etiqueta</Button>
          </form>
          {cheia && <p className="text-sm text-slate-600">Limite de {MAX_ETIQUETAS_FAMILIA} etiquetas: apague uma que não usa para criar outra.</p>}
          {tags.etiquetas.length === 0 && <p className="text-sm text-slate-600">Nenhuma etiqueta ainda.</p>}
          {tags.etiquetas.length > 0 && (
            <ul className="flex flex-col divide-y divide-slate-200">
              {tags.etiquetas.map((t) => (
                <li key={t.id} className="py-2">
                  {renomeando?.id === t.id ? (
                    <form onSubmit={salvarNome} className="flex flex-wrap items-end gap-2" noValidate>
                      <div className="min-w-0 flex-1">
                        <Field rotulo={`Novo nome para ${t.nome}`} maxLength={MAX_NOME_ETIQUETA} value={renomeando.nome} autoFocus
                          onChange={(e) => setRenomeando({ id: t.id, nome: e.target.value })} erro={erroRenomear ?? undefined} />
                      </div>
                      <Button type="submit" carregando={enviando}>Salvar nome</Button>
                      <Button variante="secundario" onClick={() => setRenomeando(null)}>Cancelar</Button>
                    </form>
                  ) : apagando?.id === t.id ? (
                    <div className="rounded-lg border border-negativo-borda bg-negativo-fundo p-3" role="group" aria-label={`Apagar a etiqueta ${t.nome}`}>
                      <p className="text-sm">
                        Apagar a etiqueta <strong>{t.nome}</strong>? Ela está {textoUso(t.id)} e só sai delas: as contas, os saldos e os
                        lançamentos não mudam. Não dá para desfazer.
                      </p>
                      <div className="mt-2 flex gap-2">
                        <Button variante="perigo" carregando={enviando} onClick={() => void confirmarApagar(t)}>Apagar etiqueta</Button>
                        <Button variante="secundario" onClick={() => setApagando(null)}>Cancelar</Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm">
                        <span className="font-semibold">{t.nome}</span>
                        <span className="text-slate-600"> · {textoUso(t.id)}</span>
                      </p>
                      <div className="flex gap-1">
                        <Button variante="fantasma" compacto aria-label={`Renomear ${t.nome}`}
                          onClick={() => { setApagando(null); setRenomeando({ id: t.id, nome: t.nome }) }}>Renomear</Button>
                        <Button variante="discreto" compacto aria-label={`Apagar ${t.nome}`}
                          onClick={() => { setRenomeando(null); setApagando(t) }}>Apagar</Button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </details>
    </div>
  )
}

interface PropsForm {
  conta: Conta | null
  familiaId: string
  etiquetas: EtiquetasDaFamilia
  aoCriarEtiqueta: (e: Etiqueta) => void
  /** `aviso`: a conta foi salva, mas algo secundário (as etiquetas) falhou. */
  aoSalvar: (aviso?: string) => Promise<void>
  aoCancelar: () => void
}

function FormConta({ conta, familiaId, etiquetas, aoCriarEtiqueta, aoSalvar, aoCancelar }: PropsForm) {
  const [nome, setNome] = useState(conta?.nome ?? '')
  const [tipo, setTipo] = useState<TipoConta>(conta?.tipo ?? 'checking')
  const [saldoTexto, setSaldoTexto] = useState(conta ? formatBRLCampo(conta.saldoInicial) : '0,00')
  const [abertura, setAbertura] = useState(conta?.abertura ?? hojeSP())
  const [banco, setBanco] = useState(conta?.banco ?? '')
  // a moeda só se escolhe na criação; na edição fica travada (o banco também recusa trocar com movimento)
  const [moeda, setMoeda] = useState(conta?.moeda ?? 'BRL')
  const simbolo = simboloMoeda(moeda)
  const navegar = useNavigate()
  // criação em reais de renda fixa, renda variável ou cripto: cria o ativo em Investimentos, não uma conta
  const criaAtivo = !conta && moeda === 'BRL' && CLASSE_DO_TIPO_DE_CONTA[tipo] !== undefined
  const [tentou, setTentou] = useState(false)
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [iniciais] = useState<string[]>(() => (conta ? etiquetas.porConta.get(conta.id) ?? [] : []))
  const [marcadas, setMarcadas] = useState<string[]>(iniciais)
  const [novaEtiqueta, setNovaEtiqueta] = useState('')
  const [erroEtiqueta, setErroEtiqueta] = useState('')
  const [criandoEtiqueta, setCriandoEtiqueta] = useState(false)
  const contaCheia = marcadas.length >= MAX_ETIQUETAS_CONTA

  function alternarEtiqueta(id: string) {
    setMarcadas((m) => (m.includes(id) ? m.filter((x) => x !== id) : [...m, id]))
  }

  async function criarEMarcar() {
    const problema = erroNomeEtiqueta(novaEtiqueta, etiquetas.etiquetas)
    if (problema) { setErroEtiqueta(problema); return }
    if (contaCheia) { setErroEtiqueta(`Cada conta tem até ${MAX_ETIQUETAS_CONTA} etiquetas.`); return }
    setErroEtiqueta('')
    setCriandoEtiqueta(true)
    try {
      const nova = await criarEtiqueta(familiaId, novaEtiqueta)
      aoCriarEtiqueta(nova)
      setMarcadas((m) => [...m, nova.id])
      setNovaEtiqueta('')
    } catch (err) {
      setErroEtiqueta(mensagemErroBanco(err))
    } finally {
      setCriandoEtiqueta(false)
    }
  }

  // campo vazio = zero: a máscara esvazia o campo quando só há zeros, e o saldo inicial nasce "0,00"
  const saldoInicial = parseBRL(saldoTexto.trim() === '' ? '0' : saldoTexto)
  const erroNome = tentou && !nome.trim() ? 'Informe o nome da conta.' : undefined
  const erroSaldo = tentou && saldoInicial === null ? 'Valor inválido. Exemplo: 1.250,50 ou -300,00.'
    : tentou && criaAtivo && saldoInicial !== null && saldoInicial < 0 ? 'Um investimento não tem valor negativo. Exemplo: 1.250,50.' : undefined
  const erroData = tentou && !abertura ? 'Informe a data.'
    : tentou && criaAtivo && abertura > hojeSP() ? 'A data não pode ser futura: é o valor que você já tem aplicado.' : undefined

  async function salvar(e: FormEvent) {
    e.preventDefault()
    setTentou(true)
    if (!nome.trim() || saldoInicial === null || !abertura) return
    // antes de criar qualquer coisa: o aporte recusaria a data futura e deixaria o ativo criado sem valor
    if (criaAtivo && (saldoInicial < 0 || abertura > hojeSP())) return
    setErro('')
    setEnviando(true)
    try {
      if (criaAtivo) {
        // o ativo nasce em Investimentos; o valor que você já tem aplicado entra como aporte pelo valor, sem conta (a conta de onde veio
        // o dinheiro não existe no app). Se criar falhar, o erro fica no formulário; depois de criado, o resto vira aviso (reenviar duplicaria).
        const ativoId = await criarAtivoInvestimento({ familiaId, nome, ticker: '', classe: CLASSE_DO_TIPO_DE_CONTA[tipo] as ClasseAtivo, moeda: 'BRL' })
        if (saldoInicial > 0) {
          try {
            await registrarOperacaoPorValor({ ativoId, data: abertura, tipo: 'buy', valor: saldoInicial, observacao: 'Saldo inicial' })
          } catch (err) {
            await aoSalvar(`O ativo "${nome.trim()}" foi criado em Investimentos, mas o valor inicial não entrou: ${mensagemErroBanco(err)} Lance o aporte pelo valor lá, em Investimentos.`)
            return
          }
        }
        navegar('/investimentos')
        return
      }
      // só envia o banco quando há o que gravar ou limpar (conta sem banco e sem escolha não toca na coluna)
      const dados = { nome, tipo, saldoInicial, abertura, ...((!tipoSemBanco(tipo) && banco) || conta?.banco ? { banco: tipoSemBanco(tipo) || !banco ? null : banco } : {}),
        ...(conta || moeda === 'BRL' ? {} : { moeda }) }
      let id: string
      if (conta) { await editarConta(conta.id, dados); id = conta.id }
      else id = await criarConta(familiaId, dados)
      // a conta já está salva: se só as etiquetas falharem, fecha o formulário e avisa (reenviar criaria outra conta)
      let aviso: string | undefined
      if (etiquetas.disponivel && !mesmasEtiquetas(marcadas, iniciais)) {
        try { await definirEtiquetasDaConta(id, marcadas) } catch (err) { aviso = `A conta foi salva, mas as etiquetas não: ${mensagemErroBanco(err)}` }
      }
      await aoSalvar(aviso)
    } catch (err) {
      setErro(mensagemErroBanco(err))
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Folha titulo={conta ? `Editar ${conta.nome}` : 'Nova conta'} aoFechar={aoCancelar}>
      <form onSubmit={salvar} className="grid gap-4 md:grid-cols-2" noValidate>
        {erro && <div className="md:col-span-2"><Aviso tipo="erro">{erro}</Aviso></div>}
        <Field rotulo="Nome" maxLength={60} placeholder="Ex.: Itaú João" value={nome} onChange={(e) => setNome(e.target.value)} erro={erroNome} />
        <div className="flex flex-col gap-1">
          <label htmlFor="tipo-conta" className="text-sm font-medium">Tipo</label>
          <select
            id="tipo-conta"
            value={tipo}
            onChange={(e) => setTipo(e.target.value as TipoConta)}
            aria-describedby="tipo-conta-ajuda"
            className="min-h-11 rounded-lg border border-slate-500 bg-white px-3 text-base"
          >
            {/* conta de tipo antigo (antes da 070): mostra o atual em vez de trocar sem avisar */}
            {!ehTipoConta(tipo) && <option value={tipo}>{rotuloDoTipo(tipo)}</option>}
            {GRUPOS_TIPO_CONTA.map((g) => (
              <optgroup key={g.rotulo} label={g.rotulo}>
                {g.tipos.map((t) => <option key={t} value={t}>{rotuloTipoConta[t]}</option>)}
              </optgroup>
            ))}
          </select>
          <p id="tipo-conta-ajuda" className="text-xs text-slate-600">
            {ehTipoConta(tipo) ? ajudaTipoConta[tipo] : 'Tipo antigo: escolha onde o dinheiro está.'}
            {criaAtivo && <> <strong>Isto cria o investimento em Investimentos</strong>, não uma conta: o valor aparece lá e entra no patrimônio uma vez só.</>}
          </p>
        </div>
        {!criaAtivo && (
          <Selecao rotulo="Banco" valor={tipoSemBanco(tipo) ? '' : banco} aoMudar={setBanco} desabilitado={tipoSemBanco(tipo)}
            todos={tipoSemBanco(tipo) ? 'Dinheiro não tem banco' : 'Automático (pelo nome da conta)'} opcoes={BANCOS_POR_NOME.map((b) => [b.chave, b.nome])} />
        )}
        <div className="flex flex-col gap-1">
          <label htmlFor="moeda-conta" className="text-sm font-medium">Moeda</label>
          <select
            id="moeda-conta"
            value={moeda}
            onChange={(e) => setMoeda(e.target.value)}
            disabled={conta !== null}
            aria-describedby="moeda-conta-ajuda"
            className="min-h-11 rounded-lg border border-slate-500 bg-white px-3 text-base disabled:bg-slate-100"
          >
            {MOEDAS_CONTA.map(([v, r]) => <option key={v} value={v}>{r}</option>)}
          </select>
          <p id="moeda-conta-ajuda" className="text-xs text-slate-600">
            {conta
              ? 'A moeda não muda depois de criada.'
              : moeda === 'BRL'
                ? 'O saldo entra no total em reais.'
                : 'O saldo fica separado, na moeda da conta, fora do total em reais. Aceita receita, despesa e transferência com outra conta da mesma moeda; cartão, dívida e provento seguem só em reais.'}
          </p>
        </div>
        <Field rotulo={criaAtivo ? `Quanto você já tem aplicado (${simbolo})` : `Saldo inicial (${simbolo})`} valorEmReais value={saldoTexto} onChange={(e) => setSaldoTexto(e.target.value)} erro={erroSaldo} />
        <Field rotulo={criaAtivo ? 'Data deste valor' : 'Data do saldo inicial'} type="date" value={abertura} onChange={(e) => setAbertura(e.target.value)} erro={erroData} />
        {etiquetas.disponivel && !criaAtivo && (
          <fieldset className="flex flex-col gap-2 md:col-span-2" aria-describedby="etiquetas-conta-ajuda">
            <legend className="text-sm font-medium">Etiquetas (opcional)</legend>
            <p id="etiquetas-conta-ajuda" className="text-xs text-slate-600">
              Só organizam a lista: não mudam o tipo nem nenhum valor. Até {MAX_ETIQUETAS_CONTA} por conta.
            </p>
            {etiquetas.etiquetas.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {etiquetas.etiquetas.map((t) => {
                  const marcada = marcadas.includes(t.id)
                  return (
                    <label key={t.id} className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-3 text-sm focus-within:ring-2 focus-within:ring-azul ${marcada ? 'border-azul bg-azul-claro font-semibold text-marinho' : 'border-slate-300 bg-white text-slate-700'}`}>
                      <input type="checkbox" checked={marcada} disabled={!marcada && contaCheia} onChange={() => alternarEtiqueta(t.id)} className="h-4 w-4" />
                      {t.nome}
                    </label>
                  )
                })}
              </div>
            )}
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-0 flex-1">
                <Field rotulo="Criar etiqueta nova" maxLength={MAX_NOME_ETIQUETA} placeholder="Ex.: Conjunta" value={novaEtiqueta}
                  onChange={(e) => setNovaEtiqueta(e.target.value)} erro={erroEtiqueta || undefined}
                  // Enter aqui cria a etiqueta, em vez de enviar o formulário da conta
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void criarEMarcar() } }} />
              </div>
              <Button variante="secundario" carregando={criandoEtiqueta} onClick={() => void criarEMarcar()}>Criar e marcar</Button>
            </div>
          </fieldset>
        )}
        {criaAtivo ? (
          <p className="text-sm text-slate-600 md:col-span-2">
            O valor entra em <strong>Investimentos</strong> como o que você já tem aplicado, na data escolhida. Depois, use <strong>Aporte</strong>, <strong>Resgate</strong> e <strong>Atualizar valor</strong> por lá.
            Etiquetas e banco ficam só para contas; a instituição você põe no ativo.
          </p>
        ) : (
          <p className="text-sm text-slate-600 md:col-span-2">
            O saldo inicial é o valor <strong>no início do dia</strong> escolhido. Lançamentos a partir dessa data mudam o saldo; lançamentos anteriores entram nos relatórios, mas não no saldo.
          </p>
        )}
        <div className="flex gap-2 md:col-span-2">
          <Button type="submit" carregando={enviando}>{conta ? 'Salvar' : criaAtivo ? 'Cadastrar investimento' : 'Cadastrar conta'}</Button>
          <Button variante="secundario" onClick={aoCancelar}>Cancelar</Button>
        </div>
      </form>
    </Folha>
  )
}
