import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { BandeiraCartao, IconeEmissor } from '../components/ui/IconeConta'
import { BANCOS_POR_NOME, BANDEIRAS } from '../lib/bancos'
import { IconeCategoria, visualPorId } from '../lib/visualCategoria'
import { Aviso } from '../components/ui/Aviso'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { EmptyState } from '../components/ui/EmptyState'
import { Field } from '../components/ui/Field'
import { Selecao } from '../components/ui/Selecao'
import { useFamilia } from '../lib/FamiliaContext'
import {
  arquivarCartao, criarCartao, definirCiclo, definirContaPagamento, definirIdentidade, definirLimite, editarParcela, excluirCartao, excluirCompra, listarCartoes, listarFaturas, listarItens, proximaFatura, reativarCartao, renomearCartao,
  novaChave, pagarFatura, previaExclusao, reabrirFatura, registrarCompra, situacaoFatura,
  anularMovimentoCartao, listarMovimentosDoCartao,
} from '../lib/cartoes'
import type { Cartao, Fatura, ItemFatura, ItemPrevia, MovimentoCartao, ProximaFatura } from '../lib/cartoes'
import { listarCategorias, nomesCompletos, opcoesDeCategoria } from '../lib/categorias'
import { atualizarAutomaticos } from '../lib/automaticos'
import type { Categoria } from '../lib/categorias'
import { hojeSP, listarContas } from '../lib/contas'
import type { Conta } from '../lib/contas'
import { mensagemErroBanco } from '../lib/erros'
import { asCents, formatBRL, formatBRLCampo, formatDate, formatMonth, parseBRL, primeiraMaiuscula } from '../lib/format'
import type { Cents } from '../lib/format'
import { CabecalhoPagina } from '../components/ui/CabecalhoPagina'

type Painel =
  | { tipo: 'novo' }
  | { tipo: 'ciclo'; cartao: Cartao }
  | { tipo: 'limite'; cartao: Cartao }
  | { tipo: 'identidade'; cartao: Cartao }
  | { tipo: 'compra'; cartao: Cartao }
  | { tipo: 'pagar'; cartao: Cartao }
  | { tipo: 'renomear'; cartao: Cartao }
  | { tipo: 'contapag'; cartao: Cartao }
  | { tipo: 'arquivar'; cartao: Cartao }
  | { tipo: 'excluir'; cartao: Cartao }

const dias: [string, string][] = Array.from({ length: 31 }, (_, i) => [String(i + 1), `Dia ${i + 1}`])

/** Fatura como extrato: compras agrupadas pelo dia da compra, o mais recente primeiro; sem data no fim. */
function comprasPorDia(itens: ItemFatura[]): [string | null, ItemFatura[]][] {
  const grupos = new Map<string | null, ItemFatura[]>()
  for (const i of itens) grupos.set(i.dataCompra, [...(grupos.get(i.dataCompra) ?? []), i])
  return [...grupos.entries()].sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : a < b ? 1 : a > b ? -1 : 0))
}

export default function Cartoes() {
  const { familia } = useFamilia()
  const familiaId = familia?.id
  const [cartoes, setCartoes] = useState<Cartao[] | null>(null)
  const [contas, setContas] = useState<Conta[]>([])
  const [categorias, setCategorias] = useState<Categoria[]>([])
  // próxima fatura (aberta) de cada cartão; falha ao ler as faturas de um cartão não derruba a tela
  const [proximas, setProximas] = useState<Map<string, ProximaFatura | null>>(new Map())
  const [erro, setErro] = useState('')
  const [aviso, setAviso] = useState('')
  const [painel, setPainel] = useState<Painel | null>(null)
  const [aberto, setAberto] = useState<string | null>(null)
  // muda a cada gravação para as faturas abertas recarregarem
  const [versao, setVersao] = useState(0)

  const carregar = useCallback(async () => {
    if (!familiaId) return
    try {
      // gera as assinaturas de hoje e cobra o que já fechou antes de mostrar: os valores ficam em dia.
      // Se falhar, mostra o que há com um aviso (não esconde os cartões nem engole o erro).
      const r = await atualizarAutomaticos()
      setAviso(
        !r.faturasOk ? 'Não foi possível fechar as faturas agora; os valores podem estar defasados. Tente de novo em instantes.'
        : !r.recorrentesOk ? 'Não foi possível lançar as assinaturas de hoje agora; tente de novo em instantes.'
        : '',
      )
      const [c, cs, cats] = await Promise.all([listarCartoes(familiaId), listarContas(familiaId), listarCategorias(familiaId)])
      setCartoes(c)
      const hoje = hojeSP()
      const lidas = await Promise.all(c.filter((x) => x.ativo).map(async (x): Promise<[string, ProximaFatura | null]> => {
        try { return [x.id, proximaFatura(await listarFaturas(x.id), hoje)] } catch { return [x.id, null] }
      }))
      setProximas(new Map(lidas))
      setContas(cs.contas)
      setCategorias(cats)
      setErro('')
      setVersao((v) => v + 1)
    } catch (err) {
      setErro(mensagemErroBanco(err))
    }
  }, [familiaId])

  useEffect(() => { void carregar() }, [carregar])

  async function aoSalvar() {
    setPainel(null)
    await carregar()
  }

  async function reativar(c: Cartao) {
    try {
      await reativarCartao(c.id)
      await carregar()
    } catch (err) {
      setErro(mensagemErroBanco(err))
    }
  }

  const nomeConta = new Map(contas.map((c) => [c.id, c.nome]))
  const ativos = cartoes?.filter((c) => c.ativo) ?? []
  const arquivados = cartoes?.filter((c) => !c.ativo) ?? []

  if (!familia) return null
  return (
    <>
      <CabecalhoPagina titulo="Cartões" descricao="Fatura, parcelas e limite de cada cartão. A compra vira despesa no mês do fechamento."
        acoes={painel === null && <Button onClick={() => setPainel({ tipo: 'novo' })}>Novo cartão</Button>} />

      {erro && <div className="mb-4"><Aviso tipo="erro">{erro}</Aviso></div>}
      {aviso && !erro && <div className="mb-4"><Aviso tipo="erro">{aviso}</Aviso></div>}

      {painel?.tipo === 'novo' && <FormCartao contas={contas} aoSalvar={aoSalvar} aoCancelar={() => setPainel(null)} />}
      {painel?.tipo === 'ciclo' && <FormCiclo cartao={painel.cartao} aoSalvar={aoSalvar} aoCancelar={() => setPainel(null)} />}
      {painel?.tipo === 'limite' && <FormLimite cartao={painel.cartao} aoSalvar={aoSalvar} aoCancelar={() => setPainel(null)} />}
      {painel?.tipo === 'contapag' && <FormContaPagamento cartao={painel.cartao} contas={contas} aoSalvar={aoSalvar} aoCancelar={() => setPainel(null)} />}
      {painel?.tipo === 'renomear' && <FormRenomear cartao={painel.cartao} aoSalvar={aoSalvar} aoCancelar={() => setPainel(null)} />}
      {painel?.tipo === 'identidade' && <FormIdentidade cartao={painel.cartao} aoSalvar={aoSalvar} aoCancelar={() => setPainel(null)} />}
      {painel?.tipo === 'compra' && (
        <FormCompra cartao={painel.cartao} categorias={categorias} aoSalvar={aoSalvar} aoCancelar={() => setPainel(null)} />
      )}
      {painel?.tipo === 'pagar' && (
        <FormPagar cartao={painel.cartao} contas={contas} aoSalvar={aoSalvar} aoCancelar={() => setPainel(null)} />
      )}
      {(painel?.tipo === 'arquivar' || painel?.tipo === 'excluir') && (
        <PainelRemoverCartao tipo={painel.tipo} cartao={painel.cartao} aoConcluir={aoSalvar} aoFechar={() => setPainel(null)} />
      )}

      {cartoes === null && !erro && <p className="text-sm text-slate-600" role="status">Carregando…</p>}

      {cartoes !== null && cartoes.length > 0 && ativos.length === 0 && painel === null && (
        <EmptyState
          titulo="Nenhum cartão ativo"
          descricao="Todos os seus cartões estão arquivados. Reative um abaixo ou cadastre um novo."
          acao={<Button onClick={() => setPainel({ tipo: 'novo' })}>Novo cartão</Button>}
        />
      )}

      {cartoes?.length === 0 && painel === null && (
        <EmptyState
          titulo="Nenhum cartão ainda"
          descricao="Cadastre o cartão com o dia de fechamento e de vencimento. Cada compra entra na fatura certa e vira despesa no mês do fechamento."
          acao={<Button onClick={() => setPainel({ tipo: 'novo' })}>Cadastrar o primeiro cartão</Button>}
        />
      )}

      <ul className="flex flex-col gap-4">
        {ativos.map((c) => (
          <li key={c.id}>
            <Card>
              <div className="flex items-start gap-3">
                <IconeEmissor nome={c.nome} emissor={c.emissor} />
                <div className="min-w-0">
                  <h2 className="flex flex-wrap items-center gap-2 text-lg font-semibold">{c.nome} <BandeiraCartao bandeira={c.bandeira} /></h2>
                  {c.fechamento !== null ? (
                    <p className="text-sm text-slate-500">
                      Fecha dia {c.fechamento} · vence dia {c.vencimento}
                      {c.contaPagamentoId && nomeConta.get(c.contaPagamentoId) && <> · paga com {nomeConta.get(c.contaPagamentoId)}</>}
                    </p>
                  ) : (
                    <p className="text-sm text-planejado">Defina o dia de fechamento e de vencimento para lançar compras.</p>
                  )}
                </div>
              </div>

              {/* destaque: a fatura fechada a pagar, com a ação de pagar ao lado */}
              <div className="mt-4 flex flex-col gap-3 rounded-lg bg-fundo p-4 sm:flex-row sm:items-center sm:justify-between">
                <dl>
                  <dt className="text-sm text-slate-500">Fatura a pagar</dt>
                  <dd className={`tabular-nums text-3xl font-bold tracking-tight ${c.divida > 0 ? 'text-negativo' : 'text-marinho'}`}>{formatBRL(c.divida)}</dd>
                  {proximas.get(c.id) && (
                    <dd className="mt-1 text-sm text-slate-600" data-testid={`proxima-${c.id}`}>
                      Próxima fatura{proximas.get(c.id)!.vencimento ? ` (vence ${formatDate(proximas.get(c.id)!.vencimento!).slice(0, 5)})` : ''}:{' '}
                      <strong className="tabular-nums text-marinho">{formatBRL(proximas.get(c.id)!.total)}</strong>
                    </dd>
                  )}
                </dl>
                <Button variante={c.divida > 0 ? 'primario' : 'secundario'} onClick={() => setPainel({ tipo: 'pagar', cartao: c })}
                  disabled={c.fechamento === null || painel !== null}
                  aria-describedby={c.divida <= 0 && c.fechamento !== null ? `sem-fatura-${c.id}` : undefined}>Pagar fatura</Button>
              </div>

              <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
                <div className="flex gap-2">
                  <dt className="text-slate-500">Parcelas futuras</dt>
                  <dd className="tabular-nums font-semibold text-planejado">{formatBRL(c.compromissos)}</dd>
                </div>
                {c.credito > 0 && (
                  <div className="flex gap-2">
                    <dt className="text-slate-500">Crédito a receber</dt>
                    <dd className="tabular-nums font-semibold text-positivo">{formatBRL(c.credito)}</dd>
                  </div>
                )}
              </dl>
              {c.limite !== null && c.limiteComprometido !== null && c.limiteDisponivel !== null && (
                <Limite limite={c.limite} comprometido={c.limiteComprometido} disponivel={c.limiteDisponivel} />
              )}
              {c.divida <= 0 && c.fechamento !== null && (
                <p id={`sem-fatura-${c.id}`} className="mt-3 text-sm text-slate-600">
                  {c.compromissos > 0
                    ? <>Não há fatura fechada. Você tem {formatBRL(c.compromissos)} em parcelas futuras: cada uma entra na fatura que fecha no dia {c.fechamento} do seu mês. Se pagar agora, o valor <strong>vira crédito no cartão</strong> e abate as próximas faturas.</>
                    : <>Não há fatura fechada. Se pagar agora, o valor <strong>vira crédito no cartão</strong> e abate as próximas faturas.</>}
                </p>
              )}

              <div className="mt-4 flex flex-wrap items-center gap-1 border-t border-slate-100 pt-3">
                <Button variante={c.divida > 0 ? 'secundario' : 'primario'} onClick={() => setPainel({ tipo: 'compra', cartao: c })}
                  disabled={c.fechamento === null || painel !== null}>Nova compra</Button>
                <Button variante="fantasma" compacto onClick={() => setAberto(aberto === c.id ? null : c.id)} aria-expanded={aberto === c.id}>
                  {aberto === c.id ? 'Ocultar faturas' : 'Ver faturas'}
                </Button>
                <Button variante="fantasma" compacto onClick={() => setPainel({ tipo: 'ciclo', cartao: c })} disabled={painel !== null}>
                  {c.fechamento === null ? 'Definir fechamento' : 'Alterar dias'}
                </Button>
                <Button variante="fantasma" compacto onClick={() => setPainel({ tipo: 'limite', cartao: c })} disabled={painel !== null}>
                  {c.limite === null ? 'Definir limite' : 'Alterar limite'}
                </Button>
                <Button variante="fantasma" compacto onClick={() => setPainel({ tipo: 'identidade', cartao: c })} disabled={painel !== null}>
                  {c.emissor === null && c.bandeira === null ? 'Escolher banco e bandeira' : 'Banco e bandeira'}
                </Button>
                <Button variante="fantasma" compacto onClick={() => setPainel({ tipo: 'contapag', cartao: c })} disabled={painel !== null}>
                  {c.contaPagamentoId ? 'Conta de pagamento' : 'Escolher conta de pagamento'}
                </Button>
                <Button variante="fantasma" compacto onClick={() => setPainel({ tipo: 'renomear', cartao: c })} disabled={painel !== null}>Renomear</Button>
                <Button variante="fantasma" compacto onClick={() => setPainel({ tipo: 'arquivar', cartao: c })} disabled={painel !== null}>Arquivar</Button>
                <Button variante="fantasma" compacto onClick={() => setPainel({ tipo: 'excluir', cartao: c })} disabled={painel !== null}>Excluir</Button>
              </div>
              {aberto === c.id && <Faturas cartaoId={c.id} versao={versao} categorias={categorias} contas={contas} aoAlterar={carregar} />}
              {aberto === c.id && <MovimentosCartao cartaoId={c.id} versao={versao} aoAlterar={carregar} />}
            </Card>
          </li>
        ))}
      </ul>

      {arquivados.length > 0 && (
        <section className="mt-8" aria-labelledby="titulo-arquivados">
          <h2 id="titulo-arquivados" className="mb-1 text-lg font-semibold">Arquivados</h2>
          <p className="mb-3 text-sm text-slate-600">Não aparecem nas escolhas de compra. O histórico e as faturas antigas continuam valendo.</p>
          <ul className="flex flex-col gap-2">
            {arquivados.map((c) => (
              <li key={c.id}>
                <Card className="flex flex-wrap items-center justify-between gap-3 opacity-80">
                  <div className="flex min-w-0 items-center gap-3">
                    <IconeEmissor nome={c.nome} emissor={c.emissor} />
                    <p className="font-semibold">{c.nome} <BandeiraCartao bandeira={c.bandeira} className="ml-1 inline-block align-middle" /></p>
                  </div>
                  <Button variante="secundario" compacto disabled={painel !== null} onClick={() => void reativar(c)}>Reativar</Button>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}

/** Confirmação de arquivar ou excluir o cartão; o banco é quem decide se pode (saldo, parcelas, recorrente, histórico). */
function PainelRemoverCartao({ tipo, cartao, aoConcluir, aoFechar }: {
  tipo: 'arquivar' | 'excluir'; cartao: Cartao; aoConcluir: () => Promise<void>; aoFechar: () => void
}) {
  const { erro, enviando, enviar } = useEnvio(aoConcluir)
  const excluir = tipo === 'excluir'
  return (
    <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4" role="group" aria-label={excluir ? 'Excluir cartão' : 'Arquivar cartão'}>
      {erro && <div className="mb-3"><Aviso tipo="erro">{erro}</Aviso></div>}
      {excluir ? (
        <p className="text-sm">
          Excluir o cartão <strong>{cartao.nome}</strong> de vez. Só é possível se ele nunca teve compra, fatura nem assinatura;
          se tiver, o app avisa e você pode <strong>arquivar</strong> em vez de excluir. Não dá para desfazer.
        </p>
      ) : (
        <p className="text-sm">
          Arquivar o cartão <strong>{cartao.nome}</strong>: ele sai da lista e das escolhas de compra, e o histórico fica guardado.
          Só é possível sem fatura em aberto, sem parcelas a vencer e sem assinatura ativa. Você pode reativar depois.
        </p>
      )}
      <div className="mt-3 flex gap-2">
        <Button variante="perigo" carregando={enviando}
          onClick={() => void enviar(() => (excluir ? excluirCartao(cartao.id) : arquivarCartao(cartao.id)))}>
          {excluir ? 'Excluir cartão' : 'Arquivar cartão'}
        </Button>
        <Button variante="secundario" onClick={aoFechar}>Cancelar</Button>
      </div>
    </div>
  )
}

/** Barra do limite: a proporção é só apresentação; os três valores vêm calculados do banco (card_limits). */
function Limite({ limite, comprometido, disponivel }: { limite: Cents; comprometido: Cents; disponivel: Cents }) {
  const passou = disponivel < 0
  const pct = Math.max(0, Math.min(100, (comprometido / limite) * 100))
  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 text-sm">
        <span className="text-slate-500">Limite {formatBRL(limite)}</span>
        <span className={`tabular-nums font-semibold ${passou ? 'text-negativo' : ''}`}>
          {passou ? `Passou do limite em ${formatBRL(-disponivel as Cents)}` : `Disponível ${formatBRL(disponivel)}`}
        </span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100" role="img"
        aria-label={`Comprometido ${formatBRL(comprometido)} de ${formatBRL(limite)}`}>
        <div className={`h-full rounded-full ${passou ? 'bg-negativo' : 'bg-azul'}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Comprometido {formatBRL(comprometido)}: faturas a pagar + parcelas futuras − crédito no cartão. É só acompanhamento: o app não bloqueia compras.
      </p>
    </div>
  )
}

const rotuloSituacao = {
  aberta: { texto: 'Aberta', estilo: 'bg-planejado-fundo text-planejado' },
  fechada: { texto: 'Fechada', estilo: 'bg-red-50 text-negativo' },
  paga: { texto: 'Paga', estilo: 'bg-pago-fundo text-pago' },
}

type Acao =
  | { tipo: 'reabrir'; fatura: Fatura }
  | { tipo: 'editar'; item: ItemFatura }
  | { tipo: 'excluir'; item: ItemFatura }

/** Pagamentos e devoluções do cartão, com "Anular" para corrigir lançamento errado (ex.: crédito de teste). */
function MovimentosCartao({ cartaoId, versao, aoAlterar }: { cartaoId: string; versao: number; aoAlterar: () => Promise<void> }) {
  const [movs, setMovs] = useState<MovimentoCartao[] | null>(null)
  const [erro, setErro] = useState('')
  const [anulando, setAnulando] = useState<string | null>(null)

  useEffect(() => {
    listarMovimentosDoCartao(cartaoId).then(setMovs).catch((err) => setErro(mensagemErroBanco(err)))
  }, [cartaoId, versao])

  async function anular(m: MovimentoCartao) {
    const rotulo = m.tipo === 'devolucao' ? 'devolução' : m.tipo === 'amortizacao' ? 'amortização' : 'pagamento'
    if (!window.confirm(`Anular ${rotulo} de ${formatBRL(m.valor)} de ${formatDate(m.data)}? O dinheiro volta para a conta e a dívida ou o crédito são recalculados. Fica registrado.`)) return
    setErro('')
    setAnulando(m.id)
    try {
      await anularMovimentoCartao(m.id, 'anulado pela tela (correção)')
      await aoAlterar()
    } catch (err) {
      setErro(mensagemErroBanco(err))
    } finally {
      setAnulando(null)
    }
  }

  return (
    <div className="mt-4 border-t border-slate-100 pt-4">
      <h3 className="mb-2 text-sm font-semibold text-slate-600">Pagamentos e devoluções</h3>
      {erro && <div className="mb-2"><Aviso tipo="erro">{erro}</Aviso></div>}
      {movs === null && !erro && <p className="text-sm text-slate-500" role="status">Carregando…</p>}
      {movs?.length === 0 && <p className="text-sm text-slate-500">Nenhum pagamento ou devolução lançado.</p>}
      <ul className="flex flex-col gap-2">
        {movs?.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm">
            <span>
              {formatDate(m.data)} · {m.tipo === 'devolucao' ? 'Devolução em dinheiro' : m.tipo === 'amortizacao' ? 'Amortização' : 'Pagamento'}
              {m.ligadoAFatura ? ' (fatura)' : ' (sem fatura: adiantado)'} · <span className="tabular-nums font-semibold">{formatBRL(m.valor)}</span>
            </span>
            <Button variante="perigo" carregando={anulando === m.id} disabled={anulando !== null} onClick={() => void anular(m)}>
              Anular
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Faturas({ cartaoId, versao, categorias, contas, aoAlterar }: {
  cartaoId: string; versao: number; categorias: Categoria[]; contas: Conta[]; aoAlterar: () => Promise<void>
}) {
  const [acao, setAcao] = useState<Acao | null>(null)
  const [faturas, setFaturas] = useState<Fatura[] | null>(null)
  const [mes, setMes] = useState<string | null>(null)
  const [itens, setItens] = useState<ItemFatura[] | null>(null)
  const [erro, setErro] = useState('')
  const hoje = hojeSP()

  useEffect(() => {
    listarFaturas(cartaoId)
      .then((f) => {
        setFaturas(f)
        // abre a primeira fatura ainda não paga (ou a última, se todas pagas)
        setMes((atual) => atual ?? (f.find((x) => situacaoFatura(x, hoje) !== 'paga') ?? f[f.length - 1])?.mes ?? null)
      })
      .catch((err) => setErro(mensagemErroBanco(err)))
  }, [cartaoId, versao, hoje])

  useEffect(() => {
    if (!mes) return
    // resposta de uma fatura que já não é a escolhida não pode preencher a lista da outra (Editar/Excluir ficariam no item errado)
    let vivo = true
    setItens(null)
    listarItens(cartaoId, mes)
      .then((i) => { if (vivo) setItens(i) })
      .catch((err) => { if (vivo) setErro(mensagemErroBanco(err)) })
    return () => { vivo = false }
  }, [cartaoId, mes, versao])

  const nomeCategoria = nomesCompletos(categorias)
  const categoriaPorId = new Map(categorias.map((c) => [c.id, c]))
  if (erro) return <div className="mt-4"><Aviso tipo="erro">{erro}</Aviso></div>
  if (!faturas) return <p className="mt-4 text-sm text-slate-600" role="status">Carregando faturas…</p>
  if (faturas.length === 0) return <p className="mt-4 text-sm text-slate-500">Nenhuma compra lançada neste cartão.</p>

  return (
    <div className="mt-4 border-t border-slate-100 pt-4">
      <div className="flex gap-2 overflow-x-auto pb-2" role="tablist" aria-label="Faturas">
        {faturas.map((f) => {
          const s = rotuloSituacao[situacaoFatura(f, hoje)]
          return (
            <button key={f.mes} type="button" role="tab" aria-selected={mes === f.mes} onClick={() => setMes(f.mes)}
              className={`min-w-32 shrink-0 rounded-lg border px-3 py-2 text-left text-sm ${mes === f.mes ? 'border-azul bg-azul-claro' : 'border-slate-200'}`}>
              <span className="block font-semibold">{primeiraMaiuscula(formatMonth(f.mes))}</span>
              <span className="block tabular-nums">{formatBRL(f.total)}</span>
              <span className={`mt-1 inline-block rounded px-1.5 text-xs font-medium ${s.estilo}`}>{s.texto}</span>
            </button>
          )
        })}
      </div>
      {mes && (() => {
        const f = faturas.find((x) => x.mes === mes)!
        return (
          <section aria-label={`Fatura de ${formatMonth(mes)}`} className="mt-3">
            <p className="text-sm text-slate-600">
              Fecha em {formatDate(f.fechamento)}{f.vencimento && <> · vence em {formatDate(f.vencimento)}</>}
              {f.pago > 0 && <> · pago {formatBRL(f.pago)}</>}
            </p>
            {f.aCobrar > 0 && f.cobrado > 0 && (
              <p className="text-xs text-planejado">Ainda vai entrar nesta fatura: {formatBRL(f.aCobrar)}</p>
            )}
            {f.saldoAnterior > 0 && <p className="text-xs text-negativo">Saldo anterior (faltou pagar antes): {formatBRL(f.saldoAnterior)}</p>}
            {f.adiantamentoEntrada > 0 && <p className="text-xs text-positivo">Adiantamento usado nesta fatura: até {formatBRL(f.adiantamentoEntrada)}</p>}
            {f.adiantamentoSaida > 0 && <p className="text-xs text-positivo">Sobra de adiantamento para as próximas: {formatBRL(f.adiantamentoSaida)}</p>}
            {f.pago > 0 && f.faturaId && !acao && (
              <div className="mt-2">
                <Button variante="fantasma" onClick={() => setAcao({ tipo: 'reabrir', fatura: f })}>Reabrir fatura</Button>
              </div>
            )}
            {acao?.tipo === 'reabrir' && acao.fatura.mes === f.mes && (
              <PainelReabrir cartaoId={cartaoId} fatura={f} aoFechar={() => setAcao(null)} aoConcluir={async () => { setAcao(null); await aoAlterar() }} />
            )}
            {acao?.tipo === 'editar' && (
              <PainelEditar item={acao.item} aoFechar={() => setAcao(null)} aoConcluir={async () => { setAcao(null); await aoAlterar() }} />
            )}
            {acao?.tipo === 'excluir' && (
              <PainelExcluir cartaoId={cartaoId} item={acao.item} contas={contas} aoFechar={() => setAcao(null)}
                aoConcluir={async () => { setAcao(null); setMes(null); await aoAlterar() }} />
            )}
            {itens === null ? <p className="mt-2 text-sm text-slate-600" role="status">Carregando…</p> : (
              <div className="mt-3 flex flex-col gap-4">
                {comprasPorDia(itens).map(([dia, doDia]) => (
                  <div key={dia ?? 'sem-data'} role="group" aria-label={dia ? formatDate(dia) : 'Sem data da compra'}>
                    <h4 className="mb-1 text-sm font-semibold text-slate-500">{dia ? formatDate(dia) : 'Sem data da compra'}</h4>
                    <ul className="divide-y divide-slate-100">
                      {doDia.map((i) => (
                        <li key={i.parcelaId} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:gap-3">
                          <div className="flex min-w-0 flex-1 items-start gap-3">
                            <IconeCategoria visual={visualPorId(i.categoriaId, categoriaPorId, 'expense')} tamanho="pequeno" />
                            <div className="min-w-0 flex-1">
                              <p className="font-medium">
                                {i.descricao}
                                {i.deParcelas > 1 && <span className="ml-2 whitespace-nowrap rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{i.parcela}/{i.deParcelas}</span>}
                              </p>
                              <p className="text-sm text-slate-500">
                                {nomeCategoria.get(i.categoriaId) ?? 'Sem categoria'}
                                {i.falta > 0 && ' · a cobrar no fechamento'}
                              </p>
                            </div>
                            <span className="shrink-0 whitespace-nowrap tabular-nums font-semibold text-negativo">−{formatBRL(i.valor)}</span>
                          </div>
                          <div className="ml-7 flex items-center gap-1 sm:ml-0 sm:shrink-0">
                            <Button variante="fantasma" compacto disabled={acao !== null} aria-label={`Editar valor de ${i.descricao}`}
                              onClick={() => setAcao({ tipo: 'editar', item: i })}>Editar</Button>
                            <Button variante="discreto" compacto disabled={acao !== null} aria-label={`Excluir compra ${i.descricao}`}
                              onClick={() => setAcao({ tipo: 'excluir', item: i })}>Excluir</Button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </section>
        )
      })()}
    </div>
  )
}

interface PropsBase { aoSalvar: () => Promise<void>; aoCancelar: () => void }

function useEnvio(aoSalvar: () => Promise<void>) {
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  async function enviar(acao: () => Promise<void>) {
    setErro('')
    setEnviando(true)
    try {
      await acao()
      await aoSalvar()
    } catch (err) {
      setErro(mensagemErroBanco(err))
    } finally {
      setEnviando(false)
    }
  }
  return { erro, enviando, enviar }
}

function Botoes({ rotulo, enviando, aoCancelar }: { rotulo: string; enviando: boolean; aoCancelar: () => void }) {
  return (
    <div className="flex gap-2 md:col-span-2">
      <Button type="submit" carregando={enviando}>{rotulo}</Button>
      <Button variante="secundario" onClick={aoCancelar}>Cancelar</Button>
    </div>
  )
}

function FormCartao({ contas, aoSalvar, aoCancelar }: PropsBase & { contas: Conta[] }) {
  const [nome, setNome] = useState('')
  const [fechamento, setFechamento] = useState('')
  const [vencimento, setVencimento] = useState('')
  const [saldoTexto, setSaldoTexto] = useState('0,00')
  const [emissor, setEmissor] = useState('')
  const [bandeira, setBandeira] = useState('')
  const [contaPagamento, setContaPagamento] = useState('')
  const [tentou, setTentou] = useState(false)
  const { erro, enviando, enviar } = useEnvio(aoSalvar)
  const saldo = parseBRL(saldoTexto)
  const erroSaldo = tentou && (saldo === null || saldo < 0) ? 'Valor inválido. Exemplo: 1.250,50' : undefined

  function salvar(e: FormEvent) {
    e.preventDefault()
    setTentou(true)
    if (!nome.trim() || !fechamento || !vencimento || saldo === null || saldo < 0) return
    void enviar(async () => { await criarCartao({ nome, fechamento: Number(fechamento), vencimento: Number(vencimento), saldoAtual: saldo, emissor: emissor || null, bandeira: bandeira || null, contaPagamentoId: contaPagamento || null }) })
  }

  return (
    <Card className="mb-6">
      <h2 className="mb-4 text-lg font-semibold">Novo cartão</h2>
      <form onSubmit={salvar} className="grid gap-4 md:grid-cols-2" noValidate>
        {erro && <div className="md:col-span-2"><Aviso tipo="erro">{erro}</Aviso></div>}
        <Field rotulo="Nome" maxLength={60} placeholder="Ex.: Nubank João" value={nome} onChange={(e) => setNome(e.target.value)}
          erro={tentou && !nome.trim() ? 'Informe o nome do cartão.' : undefined} />
        <Field rotulo="Faturas fechadas e não pagas hoje (R$)" inputMode="decimal" value={saldoTexto}
          onChange={(e) => setSaldoTexto(e.target.value)} erro={erroSaldo} />
        <SelecoesIdentidade emissor={emissor} bandeira={bandeira} aoMudarEmissor={setEmissor} aoMudarBandeira={setBandeira} />
        <Selecao rotulo="Dia do fechamento" valor={fechamento} aoMudar={setFechamento} opcoes={dias} todos="Escolha…" />
        <Selecao rotulo="Dia do vencimento" valor={vencimento} aoMudar={setVencimento} opcoes={dias} todos="Escolha…" />
        <Selecao rotulo="Conta que paga a fatura (opcional)" valor={contaPagamento} aoMudar={setContaPagamento} todos="Escolher depois"
          opcoes={contas.filter((c) => c.ativa).map((c) => [c.id, c.nome])} />
        {tentou && (!fechamento || !vencimento) && <p role="alert" className="text-sm text-negativo md:col-span-2">Escolha o dia de fechamento e o de vencimento.</p>}
        <p className="text-sm text-slate-600 md:col-span-2">
          As compras da <strong>fatura aberta</strong> (e as parcelas que ainda vão vir) você lança depois, em <strong>Nova compra</strong>:
          assim cada uma cai no mês certo.
        </p>
        <Botoes rotulo="Cadastrar cartão" enviando={enviando} aoCancelar={aoCancelar} />
      </form>
    </Card>
  )
}

function SelecoesIdentidade({ emissor, bandeira, aoMudarEmissor, aoMudarBandeira }: {
  emissor: string; bandeira: string; aoMudarEmissor: (v: string) => void; aoMudarBandeira: (v: string) => void
}) {
  return (
    <>
      <Selecao rotulo="Banco emissor" valor={emissor} aoMudar={aoMudarEmissor} todos="Automático (pelo nome do cartão)"
        opcoes={BANCOS_POR_NOME.map((b) => [b.chave, b.nome])} />
      <Selecao rotulo="Bandeira" valor={bandeira} aoMudar={aoMudarBandeira} todos="Não informar" opcoes={BANDEIRAS.map((b) => [b.chave, b.nome])} />
    </>
  )
}

function FormIdentidade({ cartao, aoSalvar, aoCancelar }: PropsBase & { cartao: Cartao }) {
  const [emissor, setEmissor] = useState(cartao.emissor ?? '')
  const [bandeira, setBandeira] = useState(cartao.bandeira ?? '')
  const { erro, enviando, enviar } = useEnvio(aoSalvar)

  function salvar(e: FormEvent) {
    e.preventDefault()
    void enviar(() => definirIdentidade(cartao.id, emissor || null, bandeira || null))
  }

  return (
    <Card className="mb-6">
      <h2 className="mb-4 text-lg font-semibold">Banco e bandeira · {cartao.nome}</h2>
      <form onSubmit={salvar} className="grid gap-4 md:grid-cols-2" noValidate>
        {erro && <div className="md:col-span-2"><Aviso tipo="erro">{erro}</Aviso></div>}
        <SelecoesIdentidade emissor={emissor} bandeira={bandeira} aoMudarEmissor={setEmissor} aoMudarBandeira={setBandeira} />
        <p className="text-sm text-slate-600 md:col-span-2">Só muda o desenho do cartão na tela: faturas, parcelas e valores não são afetados.</p>
        <Botoes rotulo="Salvar" enviando={enviando} aoCancelar={aoCancelar} />
      </form>
    </Card>
  )
}

function FormCiclo({ cartao, aoSalvar, aoCancelar }: PropsBase & { cartao: Cartao }) {
  const [fechamento, setFechamento] = useState(cartao.fechamento ? String(cartao.fechamento) : '')
  const [vencimento, setVencimento] = useState(cartao.vencimento ? String(cartao.vencimento) : '')
  const { erro, enviando, enviar } = useEnvio(aoSalvar)

  function salvar(e: FormEvent) {
    e.preventDefault()
    if (!fechamento || !vencimento) return
    void enviar(() => definirCiclo(cartao.id, Number(fechamento), Number(vencimento)))
  }

  return (
    <Card className="mb-6">
      <h2 className="mb-4 text-lg font-semibold">Fechamento e vencimento · {cartao.nome}</h2>
      <form onSubmit={salvar} className="grid gap-4 md:grid-cols-2" noValidate>
        {erro && <div className="md:col-span-2"><Aviso tipo="erro">{erro}</Aviso></div>}
        <Selecao rotulo="Dia do fechamento" valor={fechamento} aoMudar={setFechamento} opcoes={dias} todos="Escolha…" />
        <Selecao rotulo="Dia do vencimento" valor={vencimento} aoMudar={setVencimento} opcoes={dias} todos="Escolha…" />
        <p className="text-sm text-slate-600 md:col-span-2">Vale para as próximas compras. Parcelas já lançadas continuam nas faturas em que estão.</p>
        <Botoes rotulo="Salvar" enviando={enviando} aoCancelar={aoCancelar} />
      </form>
    </Card>
  )
}

function FormContaPagamento({ cartao, contas, aoSalvar, aoCancelar }: PropsBase & { cartao: Cartao; contas: Conta[] }) {
  const ativas = contas.filter((c) => c.ativa)
  const [contaId, setContaId] = useState(cartao.contaPagamentoId ?? '')
  const { erro, enviando, enviar } = useEnvio(aoSalvar)

  function salvar(e: FormEvent) {
    e.preventDefault()
    void enviar(() => definirContaPagamento(cartao.id, contaId || null))
  }

  return (
    <Card className="mb-6">
      <h2 className="mb-4 text-lg font-semibold">Conta de pagamento · {cartao.nome}</h2>
      <form onSubmit={salvar} className="grid gap-4 md:grid-cols-2" noValidate>
        {erro && <div className="md:col-span-2"><Aviso tipo="erro">{erro}</Aviso></div>}
        <Selecao rotulo="Conta que paga a fatura" valor={contaId} aoMudar={setContaId} todos="Nenhuma (escolher a cada pagamento)"
          opcoes={ativas.map((c) => [c.id, c.nome])} />
        <p className="text-sm text-slate-600 md:col-span-2">
          É a conta sugerida em "Pagar fatura" e a que o saldo projetado considera para descontar a fatura no vencimento.
          Você ainda pode escolher outra conta na hora de pagar.
        </p>
        <Botoes rotulo="Salvar" enviando={enviando} aoCancelar={aoCancelar} />
      </form>
    </Card>
  )
}

function FormRenomear({ cartao, aoSalvar, aoCancelar }: PropsBase & { cartao: Cartao }) {
  const [nome, setNome] = useState(cartao.nome)
  const [tentou, setTentou] = useState(false)
  const { erro, enviando, enviar } = useEnvio(aoSalvar)
  const aparado = nome.trim()
  const invalido = aparado === '' || aparado.length > 60

  function salvar(e: FormEvent) {
    e.preventDefault()
    setTentou(true)
    if (invalido) return
    void enviar(() => renomearCartao(cartao.id, aparado))
  }

  return (
    <Card className="mb-6">
      <h2 className="mb-4 text-lg font-semibold">Renomear · {cartao.nome}</h2>
      <form onSubmit={salvar} className="grid gap-4 md:grid-cols-2" noValidate>
        {erro && <div className="md:col-span-2"><Aviso tipo="erro">{erro}</Aviso></div>}
        <Field rotulo="Nome do cartão" value={nome} maxLength={60} onChange={(e) => setNome(e.target.value)}
          erro={tentou && invalido ? 'Use de 1 a 60 caracteres.' : undefined} />
        <p className="text-sm text-slate-600 md:col-span-2">Só o nome muda: fatura, parcelas, limite e histórico continuam como estão.</p>
        <Botoes rotulo="Salvar" enviando={enviando} aoCancelar={aoCancelar} />
      </form>
    </Card>
  )
}

function FormLimite({ cartao, aoSalvar, aoCancelar }: PropsBase & { cartao: Cartao }) {
  const [texto, setTexto] = useState(cartao.limite !== null ? formatBRLCampo(cartao.limite) : '')
  const [tentou, setTentou] = useState(false)
  const { erro, enviando, enviar } = useEnvio(aoSalvar)
  const vazio = texto.trim() === ''
  const valor = vazio ? null : parseBRL(texto)
  const invalido = !vazio && (valor === null || valor <= 0)

  function salvar(e: FormEvent) {
    e.preventDefault()
    setTentou(true)
    if (invalido) return
    void enviar(() => definirLimite(cartao.id, valor))
  }

  return (
    <Card className="mb-6">
      <h2 className="mb-4 text-lg font-semibold">Limite · {cartao.nome}</h2>
      <form onSubmit={salvar} className="grid gap-4 md:grid-cols-2" noValidate>
        {erro && <div className="md:col-span-2"><Aviso tipo="erro">{erro}</Aviso></div>}
        <Field rotulo="Limite do cartão (R$)" inputMode="decimal" placeholder="Ex.: 5.800,00" value={texto}
          onChange={(e) => setTexto(e.target.value)} erro={tentou && invalido ? 'Valor inválido. Exemplo: 5.800,00' : undefined} />
        <p className="text-sm text-slate-600 md:col-span-2">
          Use o limite total que o banco informa. O app mostra quanto sobra descontando faturas a pagar e parcelas futuras.
          Deixe em branco para remover o limite. Nenhuma compra é bloqueada por causa dele.
        </p>
        <Botoes rotulo="Salvar" enviando={enviando} aoCancelar={aoCancelar} />
      </form>
    </Card>
  )
}

function FormCompra({ cartao, categorias, aoSalvar, aoCancelar }: PropsBase & { cartao: Cartao; categorias: Categoria[] }) {
  const hoje = hojeSP()
  const [andamento, setAndamento] = useState(false)
  const [descricao, setDescricao] = useState('')
  const [valorTexto, setValorTexto] = useState('')
  const [parcelasTexto, setParcelasTexto] = useState('1')
  const [data, setData] = useState(hoje)
  const [categoriaId, setCategoriaId] = useState('')
  const [tentou, setTentou] = useState(false)
  const [chave] = useState(novaChave)
  const { erro, enviando, enviar } = useEnvio(aoSalvar)

  const valor = parseBRL(valorTexto)
  const parcelas = Number(parcelasTexto)
  const parcelasOk = Number.isInteger(parcelas) && parcelas >= 1 && parcelas <= 72
  // em andamento: o valor informado é o de cada parcela que ainda falta
  const total: Cents | null = valor === null || !parcelasOk ? null : andamento ? asCents(valor * parcelas) : valor
  const despesas = categorias.filter((c) => c.tipo === 'expense' && c.ativa)

  const erroValor = tentou && (valor === null || valor <= 0 || total === null) ? 'Valor inválido. Exemplo: 1.250,50' : undefined
  const erroParcelas = tentou && !parcelasOk ? 'De 1 a 72 parcelas.' : undefined

  function salvar(e: FormEvent) {
    e.preventDefault()
    setTentou(true)
    if (!descricao.trim() || total === null || total <= 0 || !parcelasOk || !categoriaId || (!andamento && !data)) return
    void enviar(() => registrarCompra(cartao.id, { descricao, data: andamento ? hoje : data, total, parcelas, categoriaId }, chave))
  }

  return (
    <Card className="mb-6">
      <h2 className="mb-4 text-lg font-semibold">Nova compra · {cartao.nome}</h2>
      <form onSubmit={salvar} className="grid gap-4 md:grid-cols-2" noValidate>
        {erro && <div className="md:col-span-2"><Aviso tipo="erro">{erro}</Aviso></div>}
        <fieldset className="flex flex-wrap gap-4 md:col-span-2">
          <legend className="mb-1 text-sm font-medium">Tipo de compra</legend>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="radio" name="modo" checked={!andamento} onChange={() => setAndamento(false)} /> Compra nova
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="radio" name="modo" checked={andamento} onChange={() => setAndamento(true)} /> Parcelamento já em andamento
          </label>
        </fieldset>
        <Field rotulo="Descrição" maxLength={80} placeholder="Ex.: TV da sala" value={descricao} onChange={(e) => setDescricao(e.target.value)}
          erro={tentou && !descricao.trim() ? 'Informe a descrição.' : undefined} />
        <Selecao rotulo="Categoria" valor={categoriaId} aoMudar={setCategoriaId} todos="Escolha…"
          opcoes={opcoesDeCategoria(despesas, categorias).map((o) => [o.id, o.rotulo])} />
        {tentou && !categoriaId && <p role="alert" className="text-sm text-negativo md:col-span-2">Escolha a categoria.</p>}
        <Field rotulo={andamento ? 'Valor de cada parcela (R$)' : 'Valor total (R$)'} inputMode="decimal" value={valorTexto}
          onChange={(e) => setValorTexto(e.target.value)} erro={erroValor} />
        <Field rotulo={andamento ? 'Parcelas que ainda faltam (incluindo a da fatura aberta)' : 'Parcelas'} type="number" min={1} max={72}
          inputMode="numeric" value={parcelasTexto} onChange={(e) => setParcelasTexto(e.target.value)} erro={erroParcelas} />
        {!andamento && (
          <Field rotulo="Data da compra" type="date" value={data} onChange={(e) => setData(e.target.value)} erro={tentou && !data ? 'Informe a data.' : undefined} />
        )}
        <p className="text-sm text-slate-600 md:col-span-2">
          {andamento
            ? 'As parcelas restantes entram a partir da fatura aberta, uma por mês.'
            : `Compra antes do dia ${cartao.fechamento} entra na fatura deste mês; no dia do fechamento ou depois, na seguinte. Cada parcela vira despesa no mês da fatura.`}
          {total !== null && parcelasOk && parcelas > 1 && <> Total: <strong className="tabular-nums">{formatBRL(total)}</strong>.</>}
        </p>
        <Botoes rotulo="Lançar compra" enviando={enviando} aoCancelar={aoCancelar} />
      </form>
    </Card>
  )
}

function FormPagar({ cartao, contas, aoSalvar, aoCancelar }: PropsBase & { cartao: Cartao; contas: Conta[] }) {
  const ativas = contas.filter((c) => c.ativa)
  // a conta de pagamento do cartão, se existir e ainda estiver ativa; senão a primeira ativa
  const [contaId, setContaId] = useState(ativas.find((c) => c.id === cartao.contaPagamentoId)?.id ?? ativas[0]?.id ?? '')
  // com fatura fechada, sugere a dívida; sem fatura, é pagamento adiantado e o valor fica por conta do dono
  const [valorTexto, setValorTexto] = useState(cartao.divida > 0 ? formatBRLCampo(cartao.divida) : '')
  const [data, setData] = useState(hojeSP())
  const [fatura, setFatura] = useState<Fatura | null>(null)
  // 'carregando' bloqueia o envio: sem saber qual fatura quitar, o pagamento viraria adiantamento (crédito) em vez de quitar a fatura
  const [faturaEstado, setFaturaEstado] = useState<'carregando' | 'ok' | 'falhou'>('carregando')
  const [tentou, setTentou] = useState(false)
  const [chave] = useState(novaChave)
  const { erro, enviando, enviar } = useEnvio(aoSalvar)

  useEffect(() => {
    const hoje = hojeSP()
    // fatura mais antiga já fechada e não paga: é a que o pagamento quita
    let vivo = true
    listarFaturas(cartao.id)
      .then((fs) => { if (vivo) { setFatura(fs.find((f) => situacaoFatura(f, hoje) === 'fechada') ?? null); setFaturaEstado('ok') } })
      .catch(() => { if (vivo) { setFatura(null); setFaturaEstado('falhou') } })
    return () => { vivo = false }
  }, [cartao.id])

  const valor = parseBRL(valorTexto)
  const erroValor = tentou && (valor === null || valor <= 0) ? 'Valor inválido.' : undefined

  function salvar(e: FormEvent) {
    e.preventDefault()
    setTentou(true)
    if (!contaId || valor === null || valor <= 0 || !data) return
    if (cartao.divida > 0 && faturaEstado !== 'ok') return
    // só liga a uma fatura quando há dívida fechada; sem ela, é adiantamento (vira crédito no cartão)
    void enviar(() => pagarFatura(cartao.id, { contaId, data, valor, faturaId: cartao.divida > 0 ? fatura?.faturaId ?? null : null }, chave))
  }

  // comparações entre valores exatos em centavos; o banco é quem decide e recalcula o crédito
  const adiantado = valor !== null && valor > 0 && valor > cartao.divida
  // o crédito que o cartão já tem também cobre parcelas futuras: só avisa quando passa de (dívida + parcelas futuras − crédito)
  const maisQueTudo = valor !== null && valor > cartao.divida + cartao.compromissos - cartao.credito

  return (
    <Card className="mb-6">
      <h2 className="mb-4 text-lg font-semibold">Pagar fatura · {cartao.nome}</h2>
      <form onSubmit={salvar} className="grid gap-4 md:grid-cols-2" noValidate>
        {erro && <div className="md:col-span-2"><Aviso tipo="erro">{erro}</Aviso></div>}
        <Selecao rotulo="Pagar com a conta" valor={contaId} aoMudar={setContaId} opcoes={ativas.map((c) => [c.id, c.nome])} todos="Escolha…" />
        <Field rotulo="Valor (R$)" inputMode="decimal" value={valorTexto} onChange={(e) => setValorTexto(e.target.value)} erro={erroValor} />
        <Field rotulo="Data do pagamento" type="date" value={data} onChange={(e) => setData(e.target.value)} />
        <p className="text-sm text-slate-600 md:col-span-2">
          {cartao.divida > 0 && fatura ? <>Quita a fatura de <strong>{formatMonth(fatura.mes)}</strong>. </> : null}
          {adiantado && cartao.divida > 0 && <>O que passar da fatura fechada ({formatBRL(cartao.divida)}) <strong>fica como crédito no cartão</strong> e abate as próximas faturas. </>}
          {adiantado && cartao.divida <= 0 && <>Não há fatura fechada: o valor <strong>fica como crédito no cartão</strong> e abate as próximas faturas. </>}
          O pagamento sai da conta na data escolhida e reduz a dívida do cartão. Não é despesa: as compras contam no mês de cada fatura.
        </p>
        {maisQueTudo && (
          <div className="md:col-span-2">
            <Aviso tipo="info">É mais do que tudo o que este cartão tem a pagar hoje (fatura fechada e parcelas futuras). Confira o valor antes de registrar.</Aviso>
          </div>
        )}
        {cartao.divida > 0 && faturaEstado === 'falhou' && (
          <div className="md:col-span-2">
            <Aviso tipo="erro">Não foi possível ver qual fatura este pagamento quita. Feche e abra de novo; registrar agora o deixaria como adiantamento.</Aviso>
          </div>
        )}
        <Botoes rotulo="Registrar pagamento" enviando={enviando || (cartao.divida > 0 && faturaEstado !== 'ok')} aoCancelar={aoCancelar} />
      </form>
    </Card>
  )
}

function PainelReabrir({ cartaoId, fatura, aoFechar, aoConcluir }: {
  cartaoId: string; fatura: Fatura; aoFechar: () => void; aoConcluir: () => Promise<void>
}) {
  const { erro, enviando, enviar } = useEnvio(aoConcluir)
  return (
    <div className="mt-3 rounded-lg border border-slate-200 bg-azul-claro p-4" role="group" aria-label="Reabrir fatura">
      {erro && <div className="mb-3"><Aviso tipo="erro">{erro}</Aviso></div>}
      <p className="text-sm">
        Reabrir a fatura de <strong>{formatMonth(fatura.mes)}</strong> desfaz os pagamentos dela
        ({formatBRL(fatura.pago)}), <strong>inclusive a parte que passou da fatura e ficou como crédito</strong>, e o dinheiro volta para as contas de onde saiu. Depois você pode editar as parcelas e pagar de novo.
      </p>
      <div className="mt-3 flex gap-2">
        <Button variante="perigo" carregando={enviando} onClick={() => void enviar(async () => { await reabrirFatura(cartaoId, fatura.mes) })}>
          Reabrir fatura
        </Button>
        <Button variante="secundario" onClick={aoFechar}>Cancelar</Button>
      </div>
    </div>
  )
}

function PainelEditar({ item, aoFechar, aoConcluir }: { item: ItemFatura; aoFechar: () => void; aoConcluir: () => Promise<void> }) {
  const [valorTexto, setValorTexto] = useState(formatBRLCampo(item.valor).replace(/\u00a0/g, ''))
  const [tentou, setTentou] = useState(false)
  const { erro, enviando, enviar } = useEnvio(aoConcluir)
  const valor = parseBRL(valorTexto)
  const erroValor = tentou && (valor === null || valor <= 0) ? 'Valor inválido. Exemplo: 100,01' : undefined

  function salvar(e: FormEvent) {
    e.preventDefault()
    setTentou(true)
    if (valor === null || valor <= 0) return
    void enviar(() => editarParcela(item.parcelaId, valor))
  }

  return (
    <form onSubmit={salvar} noValidate className="mt-3 grid gap-3 rounded-lg border border-slate-200 bg-azul-claro p-4 md:grid-cols-2"
      aria-label="Editar parcela">
      {erro && <div className="md:col-span-2"><Aviso tipo="erro">{erro}</Aviso></div>}
      <p className="text-sm md:col-span-2">
        Corrigir o valor desta parcela: <strong>{item.descricao}{item.deParcelas > 1 && ` ${item.parcela}/${item.deParcelas}`}</strong>.
        As outras parcelas não mudam. Em fatura já paga, reabra a fatura antes.
      </p>
      <Field rotulo="Valor da parcela (R$)" inputMode="decimal" value={valorTexto} onChange={(e) => setValorTexto(e.target.value)} erro={erroValor} />
      <Botoes rotulo="Salvar valor" enviando={enviando} aoCancelar={aoFechar} />
    </form>
  )
}

const rotuloPrevia: Record<string, string> = {
  charge: 'Cobrança na fatura será anulada',
  credit: 'Estorno será anulado',
  payment: 'Pagamento será desfeito',
  extra_principal: 'Pagamento extra será desfeito',
  cancel: 'Parcelas ainda não cobradas serão canceladas',
}

function PainelExcluir({ cartaoId, item, contas, aoFechar, aoConcluir }: {
  cartaoId: string; item: ItemFatura; contas: Conta[]; aoFechar: () => void; aoConcluir: () => Promise<void>
}) {
  const [previa, setPrevia] = useState<ItemPrevia[] | null>(null)
  const [erroPrevia, setErroPrevia] = useState('')
  const { erro, enviando, enviar } = useEnvio(aoConcluir)
  const nomeConta = new Map(contas.map((c) => [c.id, c.nome]))

  useEffect(() => {
    previaExclusao(cartaoId, item.compra).then(setPrevia).catch((err) => setErroPrevia(mensagemErroBanco(err)))
  }, [cartaoId, item.compra])

  return (
    <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-4" role="group" aria-label="Excluir compra">
      {(erro || erroPrevia) && <div className="mb-3"><Aviso tipo="erro">{erro || erroPrevia}</Aviso></div>}
      <p className="text-sm">
        Excluir a compra <strong>{item.descricao}</strong> inteira (todas as parcelas). Isto será desfeito:
      </p>
      {previa === null && !erroPrevia && <p className="mt-2 text-sm text-slate-600" role="status">Calculando…</p>}
      {previa && (
        <ul className="mt-2 list-disc pl-5 text-sm">
          {previa.map((p, k) => (
            <li key={k}>
              {rotuloPrevia[p.tipo] ?? p.tipo}: <span className="tabular-nums font-semibold">{formatBRL(p.valor)}</span>
              {p.fatura && <> (fatura {formatMonth(p.fatura)})</>}
              {(p.tipo === 'payment' || p.tipo === 'extra_principal') && p.contaId && (
                <> — o dinheiro volta para <strong>{nomeConta.get(p.contaId) ?? 'a conta'}</strong></>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs text-slate-600">Nada é recriado depois. O histórico fica guardado para auditoria.</p>
      <div className="mt-3 flex gap-2">
        <Button variante="perigo" carregando={enviando} disabled={previa === null}
          onClick={() => void enviar(() => excluirCompra(cartaoId, item.compra))}>Excluir compra</Button>
        <Button variante="secundario" onClick={aoFechar}>Cancelar</Button>
      </div>
    </div>
  )
}
