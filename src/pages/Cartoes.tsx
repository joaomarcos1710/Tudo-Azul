import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { excluirRecorrencia } from '../lib/recorrencias'
import type { FormEvent, ReactNode } from 'react'
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'
import { BandeiraCartao, IconeEmissor } from '../components/ui/IconeConta'
import { BANCOS_POR_NOME, BANDEIRAS } from '../lib/bancos'
import { IconeCategoria, visualPorId } from '../lib/visualCategoria'
import { Aviso } from '../components/ui/Aviso'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { EmptyState } from '../components/ui/EmptyState'
import { FaturasDoMes } from '../components/ui/FaturasDoMes'
import { Field } from '../components/ui/Field'
import { Folha } from '../components/ui/Folha'
import { MenuAcoes } from '../components/ui/MenuAcoes'
import { MenuNovo, useAtalhosNovo } from '../components/ui/MenuNovo'
import type { ItemNovo } from '../components/ui/MenuNovo'
import { Selecao } from '../components/ui/Selecao'
import { SeletorCategoria } from '../components/SeletorCategoria'
import { useFamilia } from '../lib/FamiliaContext'
import {
  arquivarCartao, criarCartao, definirCiclo, definirContaPagamento, definirIdentidade, definirLimite, editarParcela, excluirCartao, excluirCompra, listarCartoes, aPartirDaqui, cancelarAgendada, editarAgendada, listarFaturas, listarFaturasAgendadas, listarItens, listarOcorrenciasPrevistas, proximaFatura, reativarCartao, renomearCartao,
  fechamentoNoCiclo, inicioDaTroca, moverPagamentoDeFatura, moverParcelaDeFatura, novaChave, opcoesDeFatura, pagarFatura, textoDiaFechamento, previaExclusao, reabrirFatura, registrarCompra, situacaoFatura,
  anularMovimentoCartao, lancarCreditoNoCartao, listarCreditosDaFatura, listarMovimentosDoCartao, trocarCategoriaDoCredito,
  estornarParcela, faturaTravada, faturaVencida, listarPagamentosDaFatura, melhorDiaDeCompra, podeAnularPagamentoTravado, totalFaturasDoMes,
  visaoDosCartoes, LIMITE_MOVIMENTOS, rotaCartao, rotaFatura,
} from '../lib/cartoes'
import type { Cartao, CreditoFatura, DirecaoDaParcela, Fatura, FaturaAgendada, ItemFatura, ItemPrevia, OcorrenciaPrevista, MovimentoCartao, PagamentoFatura, ProximaFatura, TotalFaturasMes, VisaoCartoes } from '../lib/cartoes'
import { IconeCadeadoAberto, IconeCadeadoFechado, IconeCadeadoPago, IconeCadeadoVencido } from '../components/layout/icons'
import { somarMeses } from '../lib/lancamentos'
import { listarCategorias, nomesCompletos } from '../lib/categorias'
import { atualizarAutomaticos } from '../lib/automaticos'
import type { Categoria } from '../lib/categorias'
import { aceitaLancamento, hojeSP, listarContas } from '../lib/contas'
import type { Conta } from '../lib/contas'
import { mensagemErroBanco } from '../lib/erros'
import { asCents, formatBRL, formatBRLCampo, formatDate, formatMonth, parseBRL, primeiraMaiuscula } from '../lib/format'
import type { Cents } from '../lib/format'
import { CabecalhoPagina } from '../components/ui/CabecalhoPagina'
import { SELO, SELO_FATURA } from '../lib/cores'

type Painel =
  | { tipo: 'novo' }
  | { tipo: 'ciclo'; cartao: Cartao }
  | { tipo: 'limite'; cartao: Cartao }
  | { tipo: 'identidade'; cartao: Cartao }
  | { tipo: 'compra'; cartao: Cartao }
  | { tipo: 'credito'; cartao: Cartao }
  | { tipo: 'pagar'; cartao: Cartao }
  | { tipo: 'renomear'; cartao: Cartao }
  | { tipo: 'contapag'; cartao: Cartao }
  | { tipo: 'arquivar'; cartao: Cartao }
  | { tipo: 'excluir'; cartao: Cartao }

/** Compra e crédito abrem numa folha por cima da tela (como o "+ Lançamento" de Lançamentos); os outros painéis ficam na página. */
type PainelFolha = Extract<Painel, { tipo: 'compra' | 'credito' }>
const emFolha = (p: Painel | null): p is PainelFolha => p?.tipo === 'compra' || p?.tipo === 'credito'

/** O "+ Lançamento" do cartão: despesa (compra, parcelada ou não) e receita (crédito / reembolso), com as teclas D e R. */
const ITENS_NOVO: ItemNovo<PainelFolha['tipo']>[] = [
  { chave: 'compra', rotulo: 'Nova despesa', tecla: 'D' }, { chave: 'credito', rotulo: 'Nova receita', tecla: 'R' },
]

/**
 * Botão "+ Lançamento" do cabeçalho do cartão e da fatura: o item abre a folha de compra ou de crédito. Fica desabilitado
 * enquanto outro painel (limite, pagamento…) está aberto na página; com a folha aberta ele só fica atrás dela, para o foco
 * poder voltar a ele ao fechar. As teclas só valem com `atalhos` e sem nada aberto.
 */
function NovoNoCartao({ cartao, painel, setPainel, forma, desabilitado = false, atalhos = true }: {
  cartao: Cartao
  painel: Painel | null
  setPainel: (p: Painel | null) => void
  forma: 'primario' | 'secundario'
  desabilitado?: boolean
  atalhos?: boolean
}) {
  const bloqueado = desabilitado || (painel !== null && !emFolha(painel))
  const abrir = (tipo: PainelFolha['tipo']) => setPainel({ tipo, cartao })
  useAtalhosNovo(ITENS_NOVO, !bloqueado && painel === null && atalhos, abrir)
  return <MenuNovo itens={ITENS_NOVO} forma={forma} desabilitado={bloqueado} aoEscolher={abrir} />
}

const dias: [string, string][] = Array.from({ length: 31 }, (_, i) => [String(i + 1), `Dia ${i + 1}`])

/** Fatura como extrato: compras agrupadas pelo dia da compra, o mais recente primeiro; sem data no fim. */
function comprasPorDia(itens: ItemFatura[]): [string | null, ItemFatura[]][] {
  const grupos = new Map<string | null, ItemFatura[]>()
  for (const i of itens) grupos.set(i.dataCompra, [...(grupos.get(i.dataCompra) ?? []), i])
  return [...grupos.entries()].sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : a < b ? 1 : a > b ? -1 : 0))
}

/**
 * Foco de volta: `lembrar()` guarda o botão que abriu o painel (antes de abrir); quando `aberto` volta a false, o foco
 * volta para ele (se ainda estiver na tela). Sem isso, ao fechar o formulário o foco cai no começo da página.
 */
function useFocoDeVolta(aberto: boolean) {
  const origem = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (aberto) return
    const o = origem.current
    origem.current = null
    if (o?.isConnected) o.focus()
  }, [aberto])
  return useCallback(() => { origem.current = document.activeElement instanceof HTMLElement ? document.activeElement : null }, [])
}

/**
 * Painel aberto junto do que o abriu (dentro do cartão ou da linha da compra): ao aparecer, leva o foco ao título dele
 * (ou ao grupo/formulário) e rola até ele. No celular, sem isso, parecia que o botão não tinha feito nada.
 */
function PainelJunto({ children, className = 'mt-4' }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const alvo = ref.current?.querySelector<HTMLElement>('h2, [role="group"], form')
    if (!alvo) return
    if (!alvo.hasAttribute('tabindex')) alvo.setAttribute('tabindex', '-1')
    alvo.focus()
    alvo.scrollIntoView?.({ block: 'nearest' })
  }, [])
  return <div ref={ref} className={className}>{children}</div>
}

/**
 * Painel de resumo da aba (referência do Mobills, pedido do dono): a próxima fatura que vence (uma DATA, nada somado) e,
 * com a migration 065, o resumo de todos os cartões do mês escolhido (card_overview): valor das faturas, limite total,
 * usado e disponível — todas as somas vêm do banco. Banco ainda sem a 065: as faturas que vencem no mês
 * (card_invoices_month), como antes.
 */
function ResumoCartoes({ cartoes, faturasDe, faturasMes, visao, mes, aoMudarMes, carregandoMes, hoje, aoVerFatura }: {
  cartoes: Cartao[]; faturasDe: Map<string, FaturasDoCartao | null>; faturasMes: TotalFaturasMes | null
  visao: VisaoCartoes | null; mes: string; aoMudarMes: (m: string) => void; carregandoMes: boolean; hoje: string
  aoVerFatura: (cartaoId: string, mes: string | null) => void
}) {
  // só cartão com algo a pagar (fechada ou atual com valor); a lista já vem na ordem de vencimento
  let proxima: { data: string; cartao: Cartao; mes: string | null } | null = null
  for (const c of cartoes) {
    const f = faturasDe.get(c.id)
    if (c.divida <= 0 && !(f?.atual && f.atual.total > 0)) continue
    const data = proximoVencimento(c, f)
    if (data && (!proxima || data < proxima.data)) proxima = { data, cartao: c, mes: faturaEmFoco(c, f) }
  }
  if (!visao && !proxima && !(faturasMes && faturasMes.faturas > 0)) return null
  const vencida = proxima !== null && proxima.data < hoje
  return (
    <Card className="flex flex-col gap-3">
      {visao && <ResumoDoMes visao={visao} mes={mes} aoMudarMes={aoMudarMes} carregando={carregandoMes} hoje={hoje} aoVerFatura={aoVerFatura} />}
      {proxima && (
        // #181: sem o selo "Vencida" (o título já diz); o botão leva à fatura daquele cartão
        <div className="flex items-center justify-between gap-3 rounded-lg bg-fundo p-3" data-testid="proxima-fatura">
          <div className="min-w-0">
            <p className="text-sm text-slate-500">{vencida ? 'Fatura vencida desde' : 'Próxima fatura vence em'}</p>
            <p className={`tabular-nums whitespace-nowrap text-2xl font-bold tracking-tight ${vencida ? 'text-prejuizo' : ''}`}>{formatDate(proxima.data)}</p>
            <p className="truncate text-xs text-slate-500" title={comCartao(proxima.cartao.nome)}>{comCartao(proxima.cartao.nome)}</p>
          </div>
          <Button variante="pilula" compacto className="shrink-0" aria-label={rotuloVerFatura(proxima.cartao.nome, proxima.mes)}
            onClick={() => aoVerFatura(proxima.cartao.id, proxima.mes)}>Ver fatura</Button>
        </div>
      )}
      {!visao && <FaturasDoMes mes={hoje.slice(0, 7)} dados={faturasMes} />}
    </Card>
  )
}

/**
 * Mês do resumo como cabeçalho compacto do bloco: "‹ Novembro de 2026 ›" (#181, pedido do dono). Não usa o SeletorMes
 * dos Relatórios porque ele sempre mostra os meses vizinhos ("Out", "Dez") e não tem prop para escondê-los; os nomes
 * deles ficam no aria-label das setas.
 */
function MesDoResumo({ mes, aoMudar }: { mes: string; aoMudar: (m: string) => void }) {
  const anterior = somarMeses(mes, -1), seguinte = somarMeses(mes, 1)
  const seta = 'min-h-11 min-w-11 rounded-full text-xl leading-none text-azul hover:bg-azul-claro'
  return (
    <div className="-mx-2 -mt-2 flex items-center justify-between gap-1" role="group" aria-label="Mês do resumo dos cartões">
      <button type="button" aria-label={`Mês anterior (${formatMonth(anterior)})`} onClick={() => aoMudar(anterior)} className={seta}>‹</button>
      <span className="whitespace-nowrap text-sm font-semibold text-marinho" aria-live="polite">{primeiraMaiuscula(formatMonth(mes))}</span>
      <button type="button" aria-label={`Próximo mês (${formatMonth(seguinte)})`} onClick={() => aoMudar(seguinte)} className={seta}>›</button>
    </div>
  )
}

type SituacaoVisual = 'aberta' | 'fechada' | 'paga' | 'vencida'

/** Situação da fatura em cadeado (#181): a forma muda em cada uma (não depende só da cor); a cor reforça. */
const cadeados: Record<SituacaoVisual, { rotulo: string; cor: string; Icone: (p: { tamanho?: number }) => ReactNode }> = {
  // #183: aberta = agendado (verde, a pagar no futuro); fechada = atenção; paga = tudo certo (azul); vencida = prejuízo
  aberta: { rotulo: 'Fatura aberta', cor: 'text-agendado', Icone: IconeCadeadoAberto },
  fechada: { rotulo: 'Fatura fechada', cor: 'text-atencao', Icone: IconeCadeadoFechado },
  paga: { rotulo: 'Fatura paga', cor: 'text-lucro', Icone: IconeCadeadoPago },
  vencida: { rotulo: 'Fatura vencida', cor: 'text-prejuizo', Icone: IconeCadeadoVencido },
}

function CadeadoFatura({ situacao }: { situacao: SituacaoVisual }) {
  const { rotulo, cor, Icone } = cadeados[situacao]
  return <span role="img" aria-label={rotulo} title={rotulo} className={`inline-flex shrink-0 ${cor}`}><Icone tamanho={18} /></span>
}

/**
 * Resumo de todos os cartões no mês escolhido (card_overview): a fatura de cada cartão que fecha naquele mês (o mês da
 * fatura, como nas abas), o total delas e o limite total. A tela não soma: total, pago e limites vêm da linha de totais.
 */
function ResumoDoMes({ visao, mes, aoMudarMes, carregando, hoje, aoVerFatura }: {
  visao: VisaoCartoes; mes: string; aoMudarMes: (m: string) => void; carregando: boolean; hoje: string
  aoVerFatura: (cartaoId: string, mes: string | null) => void
}) {
  const t = visao.totais
  return (
    <section aria-labelledby="titulo-resumo-mes" aria-busy={carregando} data-testid="resumo-do-mes">
      <h2 id="titulo-resumo-mes" className="sr-only">Resumo de todos os cartões</h2>
      <div className="rounded-lg bg-fundo p-3" data-testid="bloco-faturas-mes">
        <MesDoResumo mes={mes} aoMudar={aoMudarMes} />
        <div className={carregando ? 'opacity-60' : ''}>
          {/* #181: o título diz o critério ("fecham em"); a nota de rodapé que repetia isso saiu */}
          <p className="text-sm text-slate-500">Faturas que fecham em {nomeDoMes(mes)}</p>
          <p className="tabular-nums whitespace-nowrap text-2xl font-bold tracking-tight" data-testid="total-faturas-mes">{formatBRL(t.faturasDoMes)}</p>
          {t.pagoDoMes > 0 && <p className="text-xs text-slate-500">já pago <span className="tabular-nums whitespace-nowrap">{formatBRL(t.pagoDoMes)}</span></p>}
          {visao.cartoes.length > 0 && (
            <ul className="-mx-2 mt-1 flex flex-col text-sm">
              {visao.cartoes.map((c) => {
                if (!c.doMes) return null
                const f = c.doMes
                const sit: SituacaoVisual = f.situacao === 'fechada' && f.vencimento !== null && f.vencimento < hoje ? 'vencida' : f.situacao
                return (
                  <li key={c.id}>
                    <button type="button" onClick={() => aoVerFatura(c.id, f.mes)}
                      aria-label={`${rotuloVerFatura(c.nome, f.mes)}: ${cadeados[sit].rotulo.toLowerCase()}, ${formatBRL(f.total)}`}
                      className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left hover:bg-azul-claro">
                      <CadeadoFatura situacao={sit} />
                      {/* sem o selo de texto, o nome cabe inteiro; só corta se não couber, com o nome completo no title */}
                      <span className="min-w-0 flex-1 truncate text-slate-600" title={c.nome} data-testid={`nome-resumo-${c.id}`}>{c.nome}</span>
                      <span className="tabular-nums whitespace-nowrap font-medium">{formatBRL(f.total)}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
      {t.limite !== null && t.limiteUsado !== null && t.limiteDisponivel !== null && (
        <div className="mt-3 rounded-lg bg-fundo p-3" data-testid="limite-total">
          {/* #181: a nota não repete o limite total (já está no título da barra) */}
          <Limite titulo="Limite total" limite={t.limite} comprometido={t.limiteUsado} disponivel={t.limiteDisponivel}
            nota={<>Usado <span className="tabular-nums whitespace-nowrap">{formatBRL(t.limiteUsado)}</span> · soma dos cartões com limite, hoje.</>} />
        </div>
      )}
    </section>
  )
}

/** Próximo vencimento do cartão, para a ordem da lista: o da fatura fechada a pagar (vencida primeiro); senão o da atual. */
function proximoVencimento(c: Cartao, f: FaturasDoCartao | null | undefined): string | null {
  return (c.divida > 0 ? f?.vencimentoFechada : null) ?? f?.atual?.vencimento ?? null
}

/** Título da aba do navegador enquanto a página está aberta (cartão, fatura); ao sair, volta o de antes. */
function useTitulo(titulo: string | null) {
  useEffect(() => {
    if (!titulo) return
    const antes = document.title
    document.title = `${titulo} · Tudo Azul`
    return () => { document.title = antes }
  }, [titulo])
}

/** "‹ Cartões" (e, na fatura, o cartão) no topo da página: no celular é o jeito de voltar sem o menu. */
function Caminho({ itens }: { itens: { rotulo: string; to: string }[] }) {
  return (
    <nav aria-label="Voltar" className="mb-2 flex flex-wrap items-center gap-x-1 text-sm">
      {itens.map((i, k) => (
        <span key={i.to} className="flex min-w-0 items-center gap-x-1">
          {k > 0 && <span aria-hidden="true" className="text-slate-400">/</span>}
          <Link to={i.to} className="inline-flex min-h-11 min-w-0 items-center gap-1 font-semibold text-azul hover:underline">
            {k === 0 && <span aria-hidden="true">‹</span>}<span className="truncate">{i.rotulo}</span>
          </Link>
        </span>
      ))}
    </nav>
  )
}

/** Link com o visual do botão secundário (Abrir cartão): é navegação, então é um link, não um botão. */
const linkSecundario = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-marinho transition-colors hover:bg-azul-claro'
/** Link com o visual da pílula azul (Abrir fatura), igual ao Button variante="pilula". */
const linkPilula = 'inline-flex min-h-11 shrink-0 items-center justify-center whitespace-nowrap rounded-full bg-azul-claro px-4 text-sm font-semibold text-azul transition-colors hover:bg-blue-100'

/** O que as três páginas compartilham: dados lidos uma vez pelo `Cartoes` e o painel (formulário) aberto. */
interface Comum {
  cartoes: Cartao[] | null
  contas: Conta[]
  categorias: Categoria[]
  faturasDe: Map<string, FaturasDoCartao | null>
  painel: Painel | null
  setPainel: (p: Painel | null) => void
  carregar: () => Promise<void>
  aoSalvar: () => Promise<void>
  erro: string
  aviso: string
  versao: number
  hoje: string
  nomeConta: Map<string, string>
  painelDoCartao: (p: Painel) => ReactNode
}

/**
 * Cartões em três páginas (#203, pedido do dono: "cada cartão podia ser a sua própria página … abrir fatura ia direto pra
 * fatura separado"): `/cartoes` (lista com o resumo do mês), `/cartoes/:id` (o cartão: faturas, limite, compras,
 * pagamentos) e `/cartoes/:id/fatura/:mes` (o extrato de uma fatura). Este componente lê o que as três usam (cartões,
 * contas, categorias, resumo) uma vez e escolhe a página pelo endereço; o voltar do navegador funciona porque cada
 * página é um endereço.
 */
export default function Cartoes() {
  const { familia } = useFamilia()
  const familiaId = familia?.id
  const { id: cartaoId, mes: mesFatura } = useParams()
  const { pathname, search } = useLocation()
  const [cartoes, setCartoes] = useState<Cartao[] | null>(null)
  const [contas, setContas] = useState<Conta[]>([])
  const [categorias, setCategorias] = useState<Categoria[]>([])
  // fatura atual (aberta) e vencimento da fechada a pagar de cada cartão; null = a leitura falhou (não derruba a tela)
  const [faturasDe, setFaturasDe] = useState<Map<string, FaturasDoCartao | null>>(new Map())
  const [erro, setErro] = useState('')
  const [aviso, setAviso] = useState('')
  const [painel, setPainelBruto] = useState<Painel | null>(null)
  // faturas de todos os cartões que vencem neste mês (card_invoices_month); null = sem a função ou a leitura falhou
  const [faturasMes, setFaturasMes] = useState<TotalFaturasMes | null>(null)
  // resumo de todos os cartões (card_overview, migration 065); null = banco sem a função ou a leitura falhou
  const [visao, setVisao] = useState<VisaoCartoes | null>(null)
  // mês do resumo (AAAA-MM do fechamento): começa no de hoje; o ref deixa carregar() ler o mês sem recriar a função
  const [mesResumo, setMesResumo] = useState(() => hojeSP().slice(0, 7))
  const mesResumoRef = useRef(mesResumo)
  const [carregandoMes, setCarregandoMes] = useState(false)
  const lembrarOrigem = useFocoDeVolta(painel !== null)
  const setPainel = useCallback((p: Painel | null) => { if (p) lembrarOrigem(); setPainelBruto(p) }, [lembrarOrigem])
  // muda a cada gravação para as faturas abertas recarregarem
  const [versao, setVersao] = useState(0)

  // o formulário é da página em que abriu: trocar de página (voltar do navegador, link) fecha
  useEffect(() => { setPainelBruto(null) }, [pathname])

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
      const [c, cs, cats, v] = await Promise.all([
        listarCartoes(familiaId), listarContas(familiaId), listarCategorias(familiaId),
        // uma chamada para todos os cartões; se falhar, a tela volta a ler card_months por cartão (abaixo)
        visaoDosCartoes(familiaId, mesResumoRef.current).catch(() => null),
      ])
      const hoje = hojeSP()
      let lidas: [string, FaturasDoCartao | null][]
      let doMes: TotalFaturasMes | null = null
      if (v) {
        lidas = v.cartoes.map((x) => [x.id, {
          atual: x.atual, vencimentoFechada: x.fechadaVencimento, mesFechada: x.fechadaMes,
          assinaturasPrevistas: x.assinaturasPrevistas, atualComAssinaturas: x.atualComAssinaturas,
        }])
      } else {
        // atalho: banco sem a migration 065 (ou card_overview falhou) lê card_months por cartão (N+1), como antes da #175;
        // remover depois que a 065 estiver aplicada em produção (ver 40 - Pendências)
        const pedidoMes = totalFaturasDoMes(familiaId, hoje.slice(0, 7)).catch(() => null)
        lidas = await Promise.all(c.filter((x) => x.ativo).map(async (x): Promise<[string, FaturasDoCartao | null]> => {
          try {
            const fs = await listarFaturas(x.id)
            // só escolhe linhas que o banco já calculou (card_months): a fechada mais antiga não paga e a aberta que fecha primeiro
            const fechada = fs.find((f) => situacaoFatura(f, hoje) === 'fechada')
            return [x.id, { atual: proximaFatura(fs, hoje, x), vencimentoFechada: fechada?.vencimento ?? null, mesFechada: fechada?.mes ?? null }]
          } catch { return [x.id, null] }
        }))
        doMes = await pedidoMes
      }
      // cartões e faturas juntos: sem o intervalo em que o cartão apareceria como "Sem fatura em aberto" antes de ler as faturas
      setCartoes(c)
      setFaturasDe(new Map(lidas))
      setVisao(v)
      setFaturasMes(doMes)
      setContas(cs.contas)
      setCategorias(cats)
      setErro('')
      setVersao((v) => v + 1)
    } catch (err) {
      setErro(mensagemErroBanco(err))
    }
  }, [familiaId])

  useEffect(() => { void carregar() }, [carregar])

  // troca o mês do resumo: uma chamada de card_overview; só o resumo muda (o destaque de cada cartão é a fatura atual)
  async function mudarMesResumo(m: string) {
    if (!familiaId) return
    mesResumoRef.current = m
    setMesResumo(m)
    setCarregandoMes(true)
    try {
      const v = await visaoDosCartoes(familiaId, m)
      // resposta atrasada de um mês que já não é o escolhido: descarta
      if (mesResumoRef.current === m && v) setVisao(v)
    } catch (err) {
      if (mesResumoRef.current === m) setErro(mensagemErroBanco(err))
    } finally {
      if (mesResumoRef.current === m) setCarregandoMes(false)
    }
  }

  async function aoSalvar() {
    setPainel(null)
    await carregar()
  }

  const nomeConta = new Map(contas.map((c) => [c.id, c.nome]))
  const hoje = hojeSP()
  const fechar = () => setPainel(null)

  /** O formulário aberto para um cartão: aparece na página do cartão (ou da fatura, no caso de Pagar), logo abaixo do cabeçalho; compra e crédito abrem numa folha por cima da tela. */
  function painelDoCartao(p: Painel) {
    switch (p.tipo) {
      case 'novo': return null
      case 'ciclo': return <FormCiclo cartao={p.cartao} aoSalvar={aoSalvar} aoCancelar={fechar} />
      case 'limite': return <FormLimite cartao={p.cartao} aoSalvar={aoSalvar} aoCancelar={fechar} />
      case 'contapag': return <FormContaPagamento cartao={p.cartao} contas={contas} aoSalvar={aoSalvar} aoCancelar={fechar} />
      case 'renomear': return <FormRenomear cartao={p.cartao} aoSalvar={aoSalvar} aoCancelar={fechar} />
      case 'identidade': return <FormIdentidade cartao={p.cartao} aoSalvar={aoSalvar} aoCancelar={fechar} />
      case 'compra': return (
        <Folha titulo={`Nova compra · ${p.cartao.nome}`} aoFechar={fechar} larga>
          <FormCompra cartao={p.cartao} categorias={categorias} aoSalvar={aoSalvar} aoCancelar={fechar}
            aoCategoriaCriada={(c) => setCategorias((atual) => [...atual, c])} />
        </Folha>
      )
      case 'credito': return (
        <Folha titulo={`Crédito / reembolso · ${p.cartao.nome}`} aoFechar={fechar} larga>
          <FormCredito cartao={p.cartao} categorias={categorias} aoSalvar={aoSalvar} aoCancelar={fechar} />
        </Folha>
      )
      case 'pagar': return <FormPagar cartao={p.cartao} contas={contas} aoSalvar={aoSalvar} aoCancelar={fechar} />
      case 'arquivar':
      case 'excluir': return <PainelRemoverCartao tipo={p.tipo} cartao={p.cartao} aoConcluir={aoSalvar} aoFechar={fechar} />
    }
  }

  if (!familia) return null
  const comum: Comum = { cartoes, contas, categorias, faturasDe, painel, setPainel, carregar, aoSalvar, erro, aviso, versao, hoje, nomeConta, painelDoCartao }

  if (!cartaoId) {
    // endereço de antes da #203 (`/cartoes?cartao=<id>`, avisos do Início e favoritos): vai para a página do cartão
    const antigo = new URLSearchParams(search).get('cartao')
    if (antigo) return <Navigate to={rotaCartao(antigo)} replace />
    return (
      <PaginaLista {...comum} faturasMes={faturasMes} visao={visao} mesResumo={mesResumo}
        aoMudarMes={(m) => void mudarMesResumo(m)} carregandoMes={carregandoMes} />
    )
  }
  const cartao = cartoes?.find((c) => c.id === cartaoId)
  if (!cartao) {
    return (
      <>
        <Caminho itens={[{ rotulo: 'Cartões', to: '/cartoes' }]} />
        {erro && <div className="mb-4"><Aviso tipo="erro">{erro}</Aviso></div>}
        {cartoes === null && !erro && <p className="text-sm text-slate-600" role="status">Carregando…</p>}
        {cartoes !== null && (
          <EmptyState titulo="Cartão não encontrado" descricao="Este cartão não existe mais ou o endereço está errado."
            acao={<Link to="/cartoes" className={linkSecundario}>Ver os cartões</Link>} />
        )}
      </>
    )
  }
  if (mesFatura) return <PaginaFatura {...comum} cartao={cartao} mes={mesFatura} />
  return <PaginaCartao {...comum} cartao={cartao} />
}

/**
 * `/cartoes`: o resumo do mês (como antes) e um card compacto por cartão — nome, fecha/vence, a fatura em destaque, o
 * limite e os links **Abrir cartão** e **Abrir fatura**. Nada de extrato aqui: ele mora na página da fatura.
 */
function PaginaLista({ cartoes, contas, faturasDe, painel, setPainel, carregar, aoSalvar, erro, aviso, hoje, nomeConta, faturasMes, visao, mesResumo, aoMudarMes, carregandoMes }: Comum & {
  faturasMes: TotalFaturasMes | null; visao: VisaoCartoes | null; mesResumo: string; aoMudarMes: (m: string) => void; carregandoMes: boolean
}) {
  const navigate = useNavigate()
  const [erroReativar, setErroReativar] = useState('')
  useTitulo('Cartões')

  async function reativar(c: Cartao) {
    try {
      await reativarCartao(c.id)
      setErroReativar('')
      await carregar()
    } catch (err) {
      setErroReativar(mensagemErroBanco(err))
    }
  }

  // ordem: o que vence primeiro em cima (fatura vencida antes de tudo); empate (ou sem vencimento), pelo nome
  const ativos = (cartoes?.filter((c) => c.ativo) ?? []).sort((a, b) => {
    const va = proximoVencimento(a, faturasDe.get(a.id))
    const vb = proximoVencimento(b, faturasDe.get(b.id))
    if (va !== vb) {
      if (va === null) return 1
      if (vb === null) return -1
      return va < vb ? -1 : 1
    }
    return a.nome.localeCompare(b.nome, 'pt-BR')
  })
  const arquivados = cartoes?.filter((c) => !c.ativo) ?? []
  const fechar = () => setPainel(null)
  const mensagem = erro || erroReativar

  return (
    <>
      <CabecalhoPagina titulo="Cartões" descricao="Fatura, parcelas e limite de cada cartão. A compra vira despesa no mês do fechamento."
        acoes={painel === null && <Button onClick={() => setPainel({ tipo: 'novo' })}>Novo cartão</Button>} />

      {mensagem && <div className="mb-4"><Aviso tipo="erro">{mensagem}</Aviso></div>}
      {aviso && !mensagem && <div className="mb-4"><Aviso tipo="erro">{aviso}</Aviso></div>}

      {/* computador: cartões em grade de 2 colunas e o resumo ao lado; celular: resumo em cima e cartões em lista */}
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start lg:gap-6">
      {ativos.length > 0 && (
        <aside className="mb-4 lg:sticky lg:top-4 lg:order-2 lg:mb-0" aria-label="Resumo dos cartões">
          <ResumoCartoes cartoes={ativos} faturasDe={faturasDe} faturasMes={faturasMes} hoje={hoje}
            visao={visao} mes={mesResumo} aoMudarMes={aoMudarMes} carregandoMes={carregandoMes}
            aoVerFatura={(id, mes) => navigate(mes ? rotaFatura(id, mes) : rotaCartao(id))} />
        </aside>
      )}
      <div className="min-w-0 lg:order-1">
      {painel?.tipo === 'novo' && <PainelJunto className=""><FormCartao contas={contas} aoSalvar={aoSalvar} aoCancelar={fechar} /></PainelJunto>}

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

      {/* #201: grid-cols-1 (= minmax(0, 1fr)) e min-w-0 no li: sem coluna explícita, a coluna implícita do grid é `auto` e
          cresce até a largura mínima do conteúdo, alargando a página inteira no celular */}
      <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2" data-testid="lista-cartoes">
        {ativos.map((c) => {
          const foco = faturaEmFoco(c, faturasDe.get(c.id))
          return (
            <li key={c.id} id={`cartao-${c.id}`} className="min-w-0">
              <Card>
                <CabecalhoCartao cartao={c} nomeConta={nomeConta} hoje={hoje} />
                {/* destaque: a fatura fechada a pagar, se houver; senão a fatura atual (aberta), como no Organizze */}
                <div className="mt-4 rounded-lg bg-fundo p-4">
                  <DestaqueFatura cartao={c} faturas={faturasDe.get(c.id)} hoje={hoje} />
                </div>
                {c.limite !== null && c.limiteComprometido !== null && c.limiteDisponivel !== null && (
                  <Limite limite={c.limite} comprometido={c.limiteComprometido} disponivel={c.limiteDisponivel}
                    nota={<>Usado <span className="tabular-nums whitespace-nowrap">{formatBRL(c.limiteComprometido)}</span></>} />
                )}
                <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                  <Link to={rotaCartao(c.id)} className={linkSecundario} aria-label={`Abrir cartão ${c.nome}`}>Abrir cartão</Link>
                  {/* "Abrir fatura" vai direto ao extrato da fatura em foco (fechada a pagar ou a atual); sem fatura, ao cartão */}
                  <Link to={foco ? rotaFatura(c.id, foco) : rotaCartao(c.id)} className={linkPilula}
                    aria-label={rotuloAbrirFatura(c.nome, foco)} data-testid={`abrir-fatura-${c.id}`}>Abrir fatura</Link>
                </div>
              </Card>
            </li>
          )
        })}
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
      </div>
      </div>
    </>
  )
}

/** Dias do cartão ("Fecha dia 17 · vence dia 25 · paga com …") e o "Melhor dia de compra" (lista e página do cartão). */
function DiasDoCartao({ cartao: c, nomeConta, hoje }: { cartao: Cartao; nomeConta: Map<string, string>; hoje: string }) {
  const melhor = melhorDiaDeCompra(hoje, c.fechamento, c.cicloAnterior)
  return (
    <>
      {c.fechamento !== null ? (
        <span className="block">
          Fecha dia {c.fechamento} · vence dia {c.vencimento}
          {c.contaPagamentoId && nomeConta.get(c.contaPagamentoId) && <> · paga com {nomeConta.get(c.contaPagamentoId)}</>}
        </span>
      ) : (
        <span className="block text-atencao">Defina o dia de fechamento e de vencimento para lançar compras.</span>
      )}
      {melhor !== null && <span className="block">Melhor dia de compra: {String(melhor).padStart(2, '0')}</span>}
    </>
  )
}

/** Cabeçalho do card na lista: selo do emissor, nome, bandeira e os dias. */
function CabecalhoCartao({ cartao: c, nomeConta, hoje }: { cartao: Cartao; nomeConta: Map<string, string>; hoje: string }) {
  return (
    <div className="flex items-start gap-3">
      <IconeEmissor nome={c.nome} emissor={c.emissor} />
      <div className="min-w-0">
        <h2 className="flex flex-wrap items-center gap-2 text-lg font-semibold">{c.nome} <BandeiraCartao bandeira={c.bandeira} /></h2>
        <p className="text-sm text-slate-500"><DiasDoCartao cartao={c} nomeConta={nomeConta} hoje={hoje} /></p>
      </div>
    </div>
  )
}

/**
 * `/cartoes/:id`: o cartão inteiro — cabeçalho com o "+ Lançamento" e o menu ⋯ (editar, arquivar…), a fatura em destaque,
 * "A cobrar", limite, a fileira de faturas (cada uma leva à sua página) e "Pagamentos e devoluções". Os formulários do
 * menu abrem aqui, abaixo do cabeçalho; compra e crédito abrem numa folha por cima da tela.
 */
function PaginaCartao({ cartao: c, faturasDe, painel, setPainel, carregar, erro, aviso, versao, hoje, nomeConta, painelDoCartao }: Comum & { cartao: Cartao }) {
  useTitulo(c.nome)
  const foco = faturaEmFoco(c, faturasDe.get(c.id))
  const meu = painel && painel.tipo !== 'novo' && painel.cartao.id === c.id ? painel : null
  return (
    <>
      <Caminho itens={[{ rotulo: 'Cartões', to: '/cartoes' }]} />
      <CabecalhoPagina
        titulo={<span className="flex items-center gap-3"><IconeEmissor nome={c.nome} emissor={c.emissor} /><span className="flex min-w-0 flex-wrap items-center gap-2">{c.nome} <BandeiraCartao bandeira={c.bandeira} /></span></span>}
        descricao={<DiasDoCartao cartao={c} nomeConta={nomeConta} hoje={hoje} />}
        acoes={<>
          <NovoNoCartao cartao={c} painel={painel} setPainel={setPainel} forma={c.divida > 0 ? 'secundario' : 'primario'} desabilitado={c.fechamento === null} />
          <MenuAcoes rotulo={`Mais opções do cartão ${c.nome}`} desabilitado={painel !== null} acoes={[
            { rotulo: c.fechamento === null ? 'Definir fechamento' : 'Alterar dias', aoEscolher: () => setPainel({ tipo: 'ciclo', cartao: c }) },
            { rotulo: c.limite === null ? 'Definir limite' : 'Alterar limite', aoEscolher: () => setPainel({ tipo: 'limite', cartao: c }) },
            { rotulo: 'Banco e bandeira', aoEscolher: () => setPainel({ tipo: 'identidade', cartao: c }) },
            { rotulo: 'Conta de pagamento', aoEscolher: () => setPainel({ tipo: 'contapag', cartao: c }) },
            { rotulo: 'Renomear', aoEscolher: () => setPainel({ tipo: 'renomear', cartao: c }) },
            { rotulo: 'Arquivar', aoEscolher: () => setPainel({ tipo: 'arquivar', cartao: c }) },
            { rotulo: 'Excluir', aoEscolher: () => setPainel({ tipo: 'excluir', cartao: c }), perigo: true },
          ]} />
        </>} />

      {erro && <div className="mb-4"><Aviso tipo="erro">{erro}</Aviso></div>}
      {aviso && !erro && <div className="mb-4"><Aviso tipo="erro">{aviso}</Aviso></div>}

      {emFolha(meu) && painelDoCartao(meu)}
      {meu && meu.tipo !== 'pagar' && !emFolha(meu) && <PainelJunto className="mb-4">{painelDoCartao(meu)}</PainelJunto>}

      <Card>
        {/* destaque: a fatura fechada a pagar, se houver; senão a fatura atual (aberta), como no Organizze */}
        <div className="flex flex-col gap-3 rounded-lg bg-fundo p-4 sm:flex-row sm:items-center sm:justify-between">
          <DestaqueFatura cartao={c} faturas={faturasDe.get(c.id)} hoje={hoje} />
          <Link to={foco ? rotaFatura(c.id, foco) : rotaCartao(c.id)} className={`${linkPilula} self-start sm:self-auto`}
            aria-label={rotuloAbrirFatura(c.nome, foco)} data-testid={`abrir-fatura-${c.id}`}>Abrir fatura</Link>
        </div>

        <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <dt className="text-slate-500">A cobrar (atual + futuras)</dt>
            {/* #183: verde só com o rótulo "Agendado" ao lado (ainda vai ser cobrado nas próximas faturas) */}
            <dd className="flex items-center gap-2"><span className="tabular-nums font-semibold text-agendado">{formatBRL(c.compromissos)}</span><SeloAgendado /></dd>
          </div>
          {c.credito > 0 && (
            <div className="flex gap-2">
              <dt className="text-slate-500">Crédito a receber</dt>
              <dd className="tabular-nums font-semibold text-lucro">{formatBRL(c.credito)}</dd>
            </div>
          )}
        </dl>
        {/* fora do <dl>: texto solto dentro de <dl> não é termo nem definição (axe) */}
        <p className="mt-1 text-xs text-slate-500">Inclui as compras da fatura atual, que ainda não fechou, e as parcelas dos próximos meses.</p>
        {c.limite !== null && c.limiteComprometido !== null && c.limiteDisponivel !== null && (
          <Limite limite={c.limite} comprometido={c.limiteComprometido} disponivel={c.limiteDisponivel} />
        )}

        <FileiraFaturas cartao={c} versao={versao} foco={foco}
          pagar={{
            aoAbrir: () => setPainel({ tipo: 'pagar', cartao: c }),
            desabilitado: painel !== null,
            formulario: meu?.tipo === 'pagar' ? <PainelJunto>{painelDoCartao(meu)}</PainelJunto> : null,
          }} />
        <FaturasAgendadas cartaoId={c.id} versao={versao} />
        <MovimentosCartao cartaoId={c.id} versao={versao} aoAlterar={carregar} />
      </Card>
    </>
  )
}

/**
 * Próximas faturas com assinaturas já agendadas (recorrência no cartão estilo Organizze, etapa 2). Total e quantidade
 * vêm do banco (card_scheduled_invoices); nada é somado aqui. Ainda não ocupam o limite nem entram no "A cobrar": viram
 * compra no dia da cobrança. Consulta opcional: se falhar ou não houver nada, a seção não aparece.
 */
function FaturasAgendadas({ cartaoId, versao }: { cartaoId: string; versao: number }) {
  const [faturas, setFaturas] = useState<FaturaAgendada[]>([])
  useEffect(() => {
    let vivo = true
    listarFaturasAgendadas(cartaoId)
      .then((f) => { if (vivo) setFaturas(f) })
      .catch(() => { if (vivo) setFaturas([]) })
    return () => { vivo = false }
  }, [cartaoId, versao])
  if (faturas.length === 0) return null
  return (
    <section className="mt-4 border-t border-slate-100 pt-4" aria-label="Assinaturas agendadas nas próximas faturas" data-testid="faturas-agendadas">
      <h2 className="mb-1 text-sm font-semibold text-slate-600">Assinaturas nas próximas faturas <SeloAgendado /></h2>
      <p className="mb-1 text-xs text-slate-500">Já estão em cada fatura, pelo dia da cobrança. Ainda não ocupam o limite.</p>
      <ListaRecolhida itens={faturas} rotulo="Próximas faturas com assinaturas" className="divide-y divide-slate-100">
        {(f) => (
          <li key={f.mes} className="flex items-baseline justify-between gap-3 py-1.5 text-sm" data-testid="fatura-agendada">
            <span className="min-w-0">
              <span className="font-medium">{primeiraMaiuscula(formatMonth(f.mes))}</span>
              <span className="block text-xs text-slate-500">vence em {formatDate(f.vencimento)} · {f.itens === 1 ? '1 assinatura' : `${f.itens} assinaturas`}</span>
            </span>
            <span className="shrink-0 whitespace-nowrap tabular-nums font-semibold text-prejuizo">−{formatBRL(f.total)}</span>
          </li>
        )}
      </ListaRecolhida>
    </section>
  )
}


interface FaturasDoCartao {
  /** A fatura do ciclo atual (proximaFatura; R$ 0,00 se o ciclo ainda não tem compra); null só em cartão sem ciclo e sem aberta. */
  atual: ProximaFatura | null
  /** Vencimento da fatura fechada mais antiga ainda não paga; null se não há (ou se a dívida é só o saldo de referência). */
  vencimentoFechada: string | null
  /** AAAA-MM dessa fatura fechada (a que "Pagar fatura" quita); null se não há. */
  mesFechada?: string | null
  /** Assinaturas previstas na fatura atual e a atual com elas (card_overview, somadas no banco); ausentes sem a 065. */
  assinaturasPrevistas?: Cents
  atualComAssinaturas?: Cents
}

const diaMes = (data: string) => formatDate(data).slice(0, 5)
/** "novembro" (sem o ano) de AAAA-MM. */
const nomeDoMes = (mes: string) => formatMonth(mes).split(' de ')[0]

/**
 * A fatura que o "Abrir fatura" do cartão abre (#181; é a que o antigo "Pagar fatura de <mês>" dizia, pedido do dono de
 * 05/11/2026): com dívida, a fechada mais antiga não paga (a que FormPagar quita); sem dívida, a atual. Null sem fatura.
 */
function faturaEmFoco(c: Cartao, f: FaturasDoCartao | null | undefined): string | null {
  return (c.divida > 0 ? f?.mesFechada : null) ?? f?.atual?.mes ?? null
}

/** "Cartão Nubank", mas sem repetir quando o nome já começa com "Cartão" (#181: saía "Cartão Cartão Verde"). */
const comCartao = (nome: string) => (/^cart[aã]o\b/i.test(nome) ? nome : `Cartão ${nome}`)

/** Nome acessível do "Ver fatura" (resumo) e do "Abrir fatura" (cartão): começa pelo texto visível e diz de qual mês e cartão. */
const rotuloVerFatura = (nome: string, mes: string | null) => (mes ? `Ver fatura de ${nomeDoMes(mes)}, ${nome}` : `Ver fatura, ${nome}`)
const rotuloAbrirFatura = (nome: string, mes: string | null) => (mes ? `Abrir fatura de ${nomeDoMes(mes)}, ${nome}` : `Abrir fatura, ${nome}`)

/**
 * O valor em destaque no cartão. Nada é somado aqui: a fechada a pagar é a dívida do banco (debt_balances) e a atual é o
 * `total` da fatura aberta (card_months). Com fatura fechada, ela vem primeiro e a atual fica embaixo, menor.
 */
function DestaqueFatura({ cartao: c, faturas, hoje }: { cartao: Cartao; faturas: FaturasDoCartao | null | undefined; hoje: string }) {
  const ciclo = faturas?.atual ?? null
  const atual = ciclo && ciclo.total > 0 ? ciclo : null
  const vence = (data: string | null | undefined) => (data ? ` (vence ${diaMes(data)})` : '')
  if (c.divida > 0) {
    // mesma regra do aviso do Início (resumoDosCartoes): vencimento da fechada mais antiga não paga já passou
    const venc = faturas?.vencimentoFechada ?? null
    const vencida = venc !== null && venc < hoje
    return (
      <dl>
        <dt className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
          {vencida && venc ? `Fatura fechada a pagar (venceu ${diaMes(venc)})` : `Fatura fechada a pagar${vence(venc)}`}
          {vencida && <span className="rounded-full bg-prejuizo px-2 text-xs font-semibold text-white">Vencida</span>}
        </dt>
        <dd className={`tabular-nums text-3xl font-bold tracking-tight ${vencida ? 'text-prejuizo' : 'text-atencao'}`} data-testid={`fechada-a-pagar-${c.id}`}>{formatBRL(c.divida)}</dd>
        {ciclo && (
          <dd className="mt-1 text-sm text-slate-600" data-testid={`atual-${c.id}`}>
            Fatura atual (aberta{ciclo.vencimento ? `, vence ${diaMes(ciclo.vencimento)}` : ''}):{' '}
            <strong className="tabular-nums whitespace-nowrap text-marinho">{formatBRL(ciclo.total)}</strong>
          </dd>
        )}
        {ciclo && <Previstas cartaoId={c.id} faturas={faturas} />}
      </dl>
    )
  }
  if (atual) {
    return (
      <dl>
        <dt className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
          Fatura atual{vence(atual.vencimento)}
          {c.fechamento !== null && (
            <span className="rounded-full bg-white px-2 text-xs font-medium text-slate-600 ring-1 ring-slate-200">aberta — fecha dia {c.fechamento}</span>
          )}
        </dt>
        <dd className="tabular-nums text-3xl font-bold tracking-tight text-marinho">{formatBRL(atual.total)}</dd>
        <Previstas cartaoId={c.id} faturas={faturas} />
      </dl>
    )
  }
  // leitura das faturas falhou: não afirma "sem fatura" sem saber
  if (faturas === null) return <p className="text-sm text-slate-600">Não foi possível ler a fatura atual agora.</p>
  return (
    <div>
      <p className="text-lg font-semibold text-marinho">Sem fatura em aberto</p>
      {ciclo?.vencimento && (
        <p className="mt-1 text-sm text-slate-600" data-testid={`atual-${c.id}`}>Fatura atual{vence(ciclo.vencimento)}: sem compras ainda</p>
      )}
      <Previstas cartaoId={c.id} faturas={faturas} comoParagrafo />
    </div>
  )
}

/**
 * "inclui R$ X de assinaturas previstas": as assinaturas só viram parcela no dia da cobrança (migration 058), então a
 * fatura atual ainda não as tem. Os dois valores vêm somados do banco (card_overview); nada aparece sem previstas.
 */
function Previstas({ cartaoId, faturas, comoParagrafo = false }: { cartaoId: string; faturas: FaturasDoCartao | null | undefined; comoParagrafo?: boolean }) {
  const x = faturas?.assinaturasPrevistas
  const com = faturas?.atualComAssinaturas
  if (!x || x <= 0 || com === undefined) return null
  const Tag = comoParagrafo ? 'p' : 'dd'
  return (
    <Tag className="mt-1 text-sm text-slate-600" data-testid={`previstas-${cartaoId}`}>
      Prevista até o fechamento: <strong className="tabular-nums whitespace-nowrap text-agendado">{formatBRL(com)}</strong> <SeloAgendado />
      {' '}— inclui <span className="tabular-nums whitespace-nowrap">{formatBRL(x)}</span> de assinaturas previstas
    </Tag>
  )
}

/** O rótulo que acompanha todo valor em verde (#183): verde é "agendado", nunca "entrou" como nos bancos. */
function SeloAgendado() {
  return <span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium ${SELO.planejado}`}>Agendado</span>
}

/** Confirmação de arquivar ou excluir o cartão; o banco é quem decide se pode (saldo, parcelas, recorrente, histórico). */
function PainelRemoverCartao({ tipo, cartao, aoConcluir, aoFechar }: {
  tipo: 'arquivar' | 'excluir'; cartao: Cartao; aoConcluir: () => Promise<void>; aoFechar: () => void
}) {
  const { erro, enviando, enviar } = useEnvio(aoConcluir)
  const excluir = tipo === 'excluir'
  return (
    <div className="mb-6 rounded-lg border border-negativo-borda bg-negativo-fundo p-4" role="group" aria-label={excluir ? 'Excluir cartão' : 'Arquivar cartão'}>
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
function Limite({ limite, comprometido, disponivel, titulo = 'Limite', nota }: {
  limite: Cents; comprometido: Cents; disponivel: Cents; titulo?: string; nota?: ReactNode
}) {
  const passou = disponivel < 0
  const pct = Math.max(0, Math.min(100, (comprometido / limite) * 100))
  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 text-sm">
        <span className="whitespace-nowrap tabular-nums text-slate-500">{`${titulo} ${formatBRL(limite)}`}</span>
        <span className={`whitespace-nowrap tabular-nums font-semibold ${passou ? 'text-prejuizo' : ''}`}>
          {passou ? `Passou do limite em ${formatBRL(-disponivel as Cents)}` : `Disponível ${formatBRL(disponivel)}`}
        </span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100" role="img"
        aria-label={`Comprometido ${formatBRL(comprometido)} de ${formatBRL(limite)}`}>
        <div className={`h-full rounded-full ${passou ? 'bg-prejuizo-marca' : 'bg-azul'}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 text-xs text-slate-500">
        {nota ?? <>Comprometido {formatBRL(comprometido)}: faturas a pagar + a cobrar (atual + futuras) − crédito no cartão. É só acompanhamento: o app não bloqueia compras.</>}
      </p>
    </div>
  )
}

const c0 = 0 as Cents

const rotuloSituacao = { aberta: SELO_FATURA.aberta, fechada: SELO_FATURA.fechada, paga: SELO_FATURA.paga }

// resumo da fatura (#183): empilhado = linha "nome … valor"; em 3 colunas = nome em cima do valor
const itemResumo = 'flex items-baseline justify-between gap-3 sm:block md:flex xl:block'
const valorResumo = 'shrink-0 whitespace-nowrap tabular-nums font-semibold'

/**
 * Uma compra ou um crédito da fatura, compacta (#201, queixa do dono no iPhone): ícone | nome (até 2 linhas, reticências;
 * nome inteiro no `title`) e o valor NA MESMA LINHA do começo do nome, à direita (nowrap, tabular, nunca encolhe) | ⋯ ao lado. Embaixo,
 * menor, a categoria (e "a cobrar no fechamento") com a parcela num selo. Sem `acoes` (fatura paga, travada) não há ⋯.
 * O painel (Estornar) abre na linha toda.
 */
function LinhaDaFatura({ testId, icone, titulo, detalhe, parcela = null, valor, corValor, acoes, painel }: {
  testId: string; icone: ReactNode; titulo: string; detalhe: string; parcela?: string | null
  valor: string; corValor: string; acoes: ReactNode; painel?: ReactNode
}) {
  return (
    <li className="py-1.5" data-testid={testId}>
      <div className="flex min-w-0 items-center gap-x-3">
        <span className="shrink-0">{icone}</span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start gap-2" data-linha-principal>
            <p className="line-clamp-2 min-w-0 flex-1 break-words font-medium leading-snug" title={titulo}>{titulo}</p>
            <span data-valor className={`shrink-0 whitespace-nowrap tabular-nums font-semibold ${corValor}`}>{valor}</span>
          </div>
          <p className="flex min-w-0 items-center gap-1.5 text-xs text-slate-500">
            <span className="min-w-0 truncate" title={detalhe}>{detalhe}</span>
            {parcela && <span className="shrink-0 whitespace-nowrap rounded bg-neutro-fundo px-1.5 font-medium text-neutro">{parcela}</span>}
          </p>
        </div>
        {acoes && <div className="-mr-2 flex shrink-0 items-center gap-1">{acoes}</div>}
      </div>
      {painel}
    </li>
  )
}

/** Quantos itens as listas longas da fatura mostram antes do "Ver todos (N)". */
const VISIVEIS_NA_LISTA = 5

/**
 * Lista longa recolhida (#201: no celular, 30 créditos de IOF ou o histórico de pagamentos empurravam a fatura para longe):
 * mostra os primeiros VISIVEIS_NA_LISTA (a lista já vem na ordem certa, o mais recente primeiro) e "Ver todos (N)", que
 * expande e recolhe (aria-expanded). Só apresentação: nenhum total é somado aqui.
 */
function ListaRecolhida<T>({ itens, rotulo, className, children }: {
  itens: T[]; rotulo: string; className?: string; children: (item: T) => ReactNode
}) {
  const [todos, setTodos] = useState(false)
  const id = useId()
  const mostrar = todos ? itens : itens.slice(0, VISIVEIS_NA_LISTA)
  const texto = todos ? 'Mostrar menos' : `Ver todos (${itens.length})`
  return (
    <>
      <ul id={id} aria-label={rotulo} className={className}>{mostrar.map(children)}</ul>
      {itens.length > VISIVEIS_NA_LISTA && (
        // o nome acessível começa pelo texto visível e diz de qual lista é (há mais de um "Ver todos" na tela)
        <Button variante="fantasma" compacto aria-expanded={todos} aria-controls={id} aria-label={`${texto} — ${rotulo.toLowerCase()}`}
          onClick={() => setTodos(!todos)}>{texto}</Button>
      )}
    </>
  )
}

type Acao =
  | { tipo: 'reabrir'; fatura: Fatura }
  | { tipo: 'moverPagamento'; pagamento: PagamentoFatura }
  | { tipo: 'estornar'; item: ItemFatura; faturaId: string | null }
  | { tipo: 'editar'; item: ItemFatura }
  | { tipo: 'excluir'; item: ItemFatura }
  | { tipo: 'categoria'; credito: CreditoFatura }

/** Pagamentos e devoluções do cartão, com "Anular" para corrigir lançamento errado (ex.: crédito de teste). */
function MovimentosCartao({ cartaoId, versao, aoAlterar }: { cartaoId: string; versao: number; aoAlterar: () => Promise<void> }) {
  const [movs, setMovs] = useState<MovimentoCartao[] | null>(null)
  // faturas pagas (travadas, migration 064): os pagamentos delas não se anulam pela tela, exceto o recém-lançado.
  // atalho: pagamento sem fatura (adiantamento) que quitou uma fatura travada mantém "Anular" e o banco recusa com a
  // mensagem; melhorar se o banco passar a dizer quais eventos estão travados (ver 40 - Pendências).
  const [travadas, setTravadas] = useState<Set<string>>(new Set())
  const [erro, setErro] = useState('')
  const [anulando, setAnulando] = useState<string | null>(null)

  useEffect(() => {
    listarMovimentosDoCartao(cartaoId).then(setMovs).catch((err) => setErro(mensagemErroBanco(err)))
    const hoje = hojeSP()
    listarFaturas(cartaoId)
      .then((fs) => setTravadas(new Set(fs.filter((f) => f.faturaId && faturaTravada(f, hoje)).map((f) => f.faturaId as string))))
      // sem saber, mostra o botão: o banco recusa o que estiver travado (com a mensagem)
      .catch(() => setTravadas(new Set()))
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
      {/* #201: a lista é do cartão (não da fatura escolhida), então começa recolhida nos mais recentes */}
      {movs && movs.length > 0 && (
        <ListaRecolhida itens={movs} rotulo="Pagamentos e devoluções" className="divide-y divide-slate-100">
          {(m) => (
            <li key={m.id} className="flex min-w-0 items-center gap-2 py-1.5 text-sm" data-testid="movimento-cartao">
              <span className="min-w-0 flex-1">
                <span className="block truncate">
                  {m.tipo === 'devolucao' ? 'Devolução em dinheiro' : m.tipo === 'amortizacao' ? 'Amortização' : 'Pagamento'}
                </span>
                <span className="block truncate text-xs text-slate-500">{formatDate(m.data)} · {m.ligadoAFatura ? 'fatura' : 'sem fatura: adiantado'}</span>
              </span>
              <span data-valor className="shrink-0 whitespace-nowrap tabular-nums font-semibold">{formatBRL(m.valor)}</span>
              {m.faturaId && travadas.has(m.faturaId) && !podeAnularPagamentoTravado(m, movs) ? (
                <span className="w-20 shrink-0 leading-tight text-right text-xs font-medium text-lucro">Fatura paga — travada</span>
              ) : (
                <Button variante="discreto" compacto className="w-20 shrink-0" carregando={anulando === m.id} disabled={anulando !== null} onClick={() => void anular(m)}>
                  Anular
                </Button>
              )}
            </li>
          )}
        </ListaRecolhida>
      )}
      {movs && movs.length >= LIMITE_MOVIMENTOS && (
        // atalho: a leitura traz só os LIMITE_MOVIMENTOS mais recentes (listarMovimentosDoCartao); "Ver todos" não passa
        // disso. Melhorar filtrando por fatura no banco (ver 40 - Pendências)
        <p className="text-xs text-slate-500">Mostrando os {LIMITE_MOVIMENTOS} mais recentes.</p>
      )}
    </div>
  )
}

/** Fatura que a fileira abre destacada: a atual (a do ciclo de hoje); sem linha dela, a próxima que existe; senão a última. */
function faturaInicial(fs: Fatura[], hoje: string, cartao: Cartao): string | null {
  const atual = proximaFatura(fs, hoje, cartao)?.mes
  return (atual ? fs.find((f) => f.mes >= atual)?.mes : undefined) ?? fs[fs.length - 1]?.mes ?? null
}

/** Quantas faturas antes da atual aparecem sem clicar em "Ver mais antigas". */
const ANTERIORES_VISIVEIS = 6

/** Selo da fatura na fileira e no cabeçalho: Vencida (vermelho cheio) ou Aberta/Fechada/Paga (SELO_FATURA). */
const seloDaFatura = (f: Fatura, hoje: string) =>
  faturaVencida(f, hoje) ? { texto: 'Vencida', estilo: 'bg-prejuizo text-white' } : rotuloSituacao[situacaoFatura(f, hoje)]

/** Com dívida, a fechada mais antiga não paga é a que "Pagar fatura" quita (só ela mostra o botão); sem dívida, nenhuma. */
const fechadaAPagarDe = (cartao: Cartao, faturas: Fatura[], hoje: string) =>
  cartao.divida > 0 ? faturas.find((x) => situacaoFatura(x, hoje) === 'fechada')?.mes ?? null : null

/**
 * "Pagar fatura" (#181) só onde o pagamento vale para a fatura à vista, pela mesma regra do FormPagar: com dívida, ele
 * quita a fechada mais antiga não paga; sem dívida é adiantamento (vira crédito), em qualquer fatura ainda não paga.
 * Fatura paga (travada, migration 064) nunca mostra.
 */
const pagaNaFatura = (cartao: Cartao, f: Fatura, fechadaAPagar: string | null, hoje: string) =>
  cartao.fechamento !== null && !faturaTravada(f, hoje) && (fechadaAPagar === null || f.mes === fechadaAPagar)

/**
 * Fileira de faturas do cartão (#201: rola dentro dela, com sombra no lado que ainda tem faturas): cada fatura é um link
 * para a página dela. Abre rolada na fatura em foco, com as 6 anteriores e as próximas; "Ver mais antigas" mostra o resto
 * (fechada não paga nunca fica escondida). Sem fatura nenhuma, ou com todas pagas e sem dívida, o "Pagar fatura"
 * (adiantamento) fica aqui, fora de qualquer fatura.
 */
function FileiraFaturas({ cartao, versao, foco, pagar }: {
  cartao: Cartao; versao: number
  /** AAAA-MM da fatura em destaque (fechada a pagar ou a atual); null sem fatura. */
  foco: string | null
  /** "Pagar fatura" fora das faturas (sem fatura, ou todas pagas e sem dívida): abre o FormPagar, que aparece aqui (`formulario`). */
  pagar: { aoAbrir: () => void; desabilitado: boolean; formulario: ReactNode }
}) {
  const cartaoId = cartao.id
  const [todas, setTodas] = useState(false)
  const faixa = useRef<HTMLUListElement>(null)
  const [faturas, setFaturas] = useState<Fatura[] | null>(null)
  const [erro, setErro] = useState('')
  const hoje = hojeSP()

  useEffect(() => {
    // vivo: uma resposta antiga (gravação anterior) não sobrescreve a nova; e o erro de antes some ao tentar de novo
    let vivo = true
    setErro('')
    listarFaturas(cartaoId)
      .then((f) => { if (vivo) setFaturas(f) })
      .catch((err) => { if (vivo) setErro(mensagemErroBanco(err)) })
    return () => { vivo = false }
  }, [cartaoId, versao])

  // a fatura em foco fica à vista na faixa rolável; a sombra no lado que ainda tem faturas escondidas avisa que dá para deslizar
  const [mais, setMais] = useState({ antes: false, depois: false })
  const medir = useCallback(() => {
    const el = faixa.current
    if (!el) return
    const antes = el.scrollLeft > 1, depois = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
    setMais((m) => (m.antes === antes && m.depois === depois ? m : { antes, depois }))
  }, [])
  useEffect(() => {
    faixa.current?.querySelector<HTMLElement>('[aria-current="true"]')?.scrollIntoView?.({ block: 'nearest', inline: 'center' })
    medir()
  }, [foco, faturas, todas, medir])
  useEffect(() => {
    window.addEventListener('resize', medir)
    return () => window.removeEventListener('resize', medir)
  }, [medir])

  if (erro) return <div className="mt-4"><Aviso tipo="erro">{erro}</Aviso></div>
  if (!faturas) return <p className="mt-4 text-sm text-slate-600" role="status">Carregando faturas…</p>
  // sem nenhuma fatura ainda dá para pagar adiantado (vira crédito), como antes da #181
  if (faturas.length === 0) {
    return (
      <div className="mt-4 border-t border-slate-100 pt-4">
        <p className="text-sm text-slate-500">Nenhuma compra lançada neste cartão.</p>
        {cartao.fechamento !== null && (
          <Button variante="pilula" className="mt-2" onClick={pagar.aoAbrir} disabled={pagar.desabilitado}>Pagar fatura</Button>
        )}
        {pagar.formulario}
      </div>
    )
  }
  // janela padrão: as 6 faturas antes da atual, a atual e as próximas; nunca esconde fechada não paga nem a em foco
  const base = faturas.findIndex((f) => f.mes === faturaInicial(faturas, hoje, cartao))
  let inicio = Math.max(0, base - ANTERIORES_VISIVEIS)
  for (const k of [faturas.findIndex((f) => situacaoFatura(f, hoje) === 'fechada'), faturas.findIndex((f) => f.mes === foco)]) {
    if (k >= 0) inicio = Math.min(inicio, k)
  }
  if (todas) inicio = 0
  const visiveis = faturas.slice(inicio)
  const fechadaAPagar = fechadaAPagarDe(cartao, faturas, hoje)
  // todas pagas e sem dívida: o adiantamento continua possível, fora das faturas (como era no cartão antes da #181)
  const pagarForaDasFaturas = cartao.fechamento !== null && !faturas.some((f) => pagaNaFatura(cartao, f, fechadaAPagar, hoje))

  return (
    <section className="mt-4 border-t border-slate-100 pt-4" aria-labelledby={`faturas-${cartaoId}`}>
      <h3 id={`faturas-${cartaoId}`} className="mb-2 text-sm font-semibold text-slate-600">Faturas</h3>
      {inicio > 0 && (
        <Button variante="fantasma" compacto onClick={() => setTodas(true)}>
          Ver mais antigas ({inicio === 1 ? '1 fatura' : `${inicio} faturas`})
        </Button>
      )}
      {pagarForaDasFaturas && (
        <div className="mb-2">
          <Button variante="pilula" onClick={pagar.aoAbrir} disabled={pagar.desabilitado}>Pagar fatura</Button>
          {/* o formulário fica junto do botão que o abriu */}
          {pagar.formulario}
        </div>
      )}
      <div className="relative min-w-0" data-testid="faixa-faturas">
        {mais.antes && <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 z-10 w-8 bg-gradient-to-r from-white" data-testid="sombra-antes" />}
        {mais.depois && <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 z-10 w-8 bg-gradient-to-l from-white" data-testid="sombra-depois" />}
        <ul ref={faixa} onScroll={medir} className="flex snap-x gap-2 overflow-x-auto overscroll-x-contain pb-2" aria-label="Faturas">
          {visiveis.map((f) => {
            const s = seloDaFatura(f, hoje)
            const emFoco = foco === f.mes
            return (
              <li key={f.mes} className="shrink-0 snap-start">
                <Link to={rotaFatura(cartaoId, f.mes)} aria-current={emFoco ? 'true' : undefined}
                  aria-label={`Fatura de ${formatMonth(f.mes)}: ${formatBRL(f.total)}, ${s.texto.toLowerCase()}`}
                  className={`block min-w-32 rounded-lg border px-3 py-2 text-left text-sm hover:bg-azul-claro ${emFoco ? 'border-azul bg-azul-claro' : 'border-slate-200'}`}>
                  <span className="block whitespace-nowrap font-semibold">{primeiraMaiuscula(formatMonth(f.mes))}</span>
                  <span className="block whitespace-nowrap tabular-nums">{formatBRL(f.total)}</span>
                  <span className={`mt-1 inline-block rounded px-1.5 text-xs font-medium ${s.estilo}`}>{s.texto}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      </div>
      <p className="text-xs text-slate-500">Toque numa fatura para abrir o extrato dela.</p>
    </section>
  )
}

/**
 * `/cartoes/:id/fatura/:mes`: o extrato de uma fatura (pedido do dono, #203). Cabeçalho (cartão · mês · situação,
 * fecha/vence, setas ‹ › para a anterior e a seguinte), "Pagar fatura" e o resumo (Saldo anterior, Gasto do mês, Valor
 * pago, de card_months) e o extrato em três blocos, nesta ordem: **Pagamentos** (os desta fatura, com a data em que
 * foram feitos), **Entradas — estornos e reembolsos** (créditos; o total é o do banco) e **Saídas** (compras e
 * parcelas, agrupadas pelo dia). Nenhum valor é somado aqui.
 */
function PaginaFatura({ cartao, mes, categorias, contas, painel, setPainel, carregar, erro: erroGeral, aviso, versao, painelDoCartao }: Comum & { cartao: Cartao; mes: string }) {
  const cartaoId = cartao.id
  const navigate = useNavigate()
  const [acao, setAcaoBruta] = useState<Acao | null>(null)
  const lembrarOrigem = useFocoDeVolta(acao !== null)
  const setAcao = (a: Acao | null) => { if (a) lembrarOrigem(); setAcaoBruta(a) }
  const idBase = useId()
  const [faturas, setFaturas] = useState<Fatura[] | null>(null)
  const [itens, setItens] = useState<ItemFatura[] | null>(null)
  // assinaturas ainda não cobradas desta fatura (só leitura; se a consulta falhar, a seção some e o resto segue)
  const [previstas, setPrevistas] = useState<OcorrenciaPrevista[]>([])
  const [erroPrevistas, setErroPrevistas] = useState('')
  // "só esta" / "esta e as próximas": o painel aberto numa linha das assinaturas previstas
  const [painelPrevista, setPainelPrevista] = useState<{ tipo: 'editar' | 'cancelar'; ocorrencia: OcorrenciaPrevista } | null>(null)
  const [creditos, setCreditos] = useState<CreditoFatura[]>([])
  const [pagamentos, setPagamentos] = useState<PagamentoFatura[]>([])
  const [erroPagamentos, setErroPagamentos] = useState('')
  const [erro, setErro] = useState('')
  const [erroItens, setErroItens] = useState('')
  const [erroCreditos, setErroCreditos] = useState('')
  const [anulando, setAnulando] = useState<string | null>(null)
  // "Enviar para a fatura anterior / próxima" (migration 111): a parcela que está sendo enviada, a recusa do banco e o aviso
  const [movendo, setMovendo] = useState<string | null>(null)
  const [erroMover, setErroMover] = useState('')
  const [avisoMover, setAvisoMover] = useState('')
  const hoje = hojeSP()
  useTitulo(`${cartao.nome} · ${primeiraMaiuscula(formatMonth(mes))}`)

  useEffect(() => {
    let vivo = true
    setErro('')
    listarFaturas(cartaoId)
      .then((f) => { if (vivo) setFaturas(f) })
      .catch((err) => { if (vivo) setErro(mensagemErroBanco(err)) })
    return () => { vivo = false }
  }, [cartaoId, versao])

  useEffect(() => {
    // resposta de uma fatura que já não é a escolhida não pode preencher a lista da outra (Editar/Excluir ficariam no item errado)
    let vivo = true
    setItens(null)
    setErroItens('')
    listarItens(cartaoId, mes)
      .then((i) => { if (vivo) setItens(i) })
      .catch((err) => { if (vivo) setErroItens(mensagemErroBanco(err)) })
    return () => { vivo = false }
  }, [cartaoId, mes, versao])

  useEffect(() => {
    let vivo = true
    setPrevistas([])
    listarOcorrenciasPrevistas(cartaoId, mes)
      .then((o) => { if (vivo) setPrevistas(o) })
      .catch(() => { /* opcional: sem a função no banco, a fatura segue sem a lista de previstas */ })
    return () => { vivo = false }
  }, [cartaoId, mes, versao])

  useEffect(() => {
    // créditos avulsos (receita) da fatura: falha aqui não esconde as compras
    let vivo = true
    setCreditos([])
    setErroCreditos('')
    listarCreditosDaFatura(cartaoId, mes)
      .then((c) => { if (vivo) setCreditos(c) })
      .catch((err) => { if (vivo) setErroCreditos(mensagemErroBanco(err)) })
    return () => { vivo = false }
  }, [cartaoId, mes, versao])

  // pagamentos ligados à fatura (lista do banco; o "Valor pago" vem de card_months)
  const faturaId = faturas?.find((x) => x.mes === mes)?.faturaId ?? null
  useEffect(() => {
    let vivo = true
    setPagamentos([])
    setErroPagamentos('')
    if (!faturaId) return
    listarPagamentosDaFatura(cartaoId, faturaId)
      .then((p) => { if (vivo) setPagamentos(p) })
      .catch((err) => { if (vivo) setErroPagamentos(mensagemErroBanco(err)) })
    return () => { vivo = false }
  }, [cartaoId, faturaId, versao])

  // trocar de fatura (setas, link) fecha o que estava aberto numa linha da outra
  useEffect(() => { setAcaoBruta(null); setPainelPrevista(null); setErroMover('') }, [mes])

  // assinatura cancelada na vida real: exclui a regra inteira (o que já foi cobrado continua no histórico)
  async function excluirAssinatura(o: OcorrenciaPrevista) {
    if (!window.confirm(`Excluir a assinatura "${o.descricao}"? Ela deixa de ser cobrada daqui em diante; o que já foi lançado no cartão continua no histórico.`)) return
    setErroPrevistas('')
    try {
      await excluirRecorrencia(o.recorrenciaId)
      await carregar()
    } catch (err) {
      setErroPrevistas(mensagemErroBanco(err))
    }
  }

  // Manda uma parcela para a fatura vizinha. Sem confirmação: não cria evento nenhum e dá para mandar de volta. O banco decide
  // (parcela já cobrada, fatura fechada ou paga) e a recusa aparece na lista. O aviso diz para onde foi, porque a linha some daqui.
  async function moverParcela(i: ItemFatura, direcao: DirecaoDaParcela) {
    setErroMover('')
    setAvisoMover('')
    setMovendo(i.parcelaId)
    try {
      const fechamento = await moverParcelaDeFatura(i.parcelaId, direcao)
      const parte = i.deParcelas > 1 ? ` (parcela ${i.parcela}/${i.deParcelas})` : ''
      setAvisoMover(`"${i.descricao}"${parte} foi para a fatura de ${formatMonth(fechamento.slice(0, 7))}.`)
      await carregar()
    } catch (err) {
      setErroMover(mensagemErroBanco(err))
    } finally {
      setMovendo(null)
    }
  }

  async function anularCredito(c: CreditoFatura) {
    if (!window.confirm(`Anular o crédito "${c.descricao}" de ${formatBRL(c.valor)}? A fatura e a receita do mês são recalculadas. Fica registrado.`)) return
    setErroCreditos('')
    setAnulando(c.id)
    try {
      await anularMovimentoCartao(c.id, 'crédito anulado pela tela (correção)')
      await carregar()
    } catch (err) {
      setErroCreditos(mensagemErroBanco(err))
    } finally {
      setAnulando(null)
    }
  }

  const nomeCategoria = nomesCompletos(categorias)
  const categoriaPorId = new Map(categorias.map((c) => [c.id, c]))
  const caminho = <Caminho itens={[{ rotulo: 'Cartões', to: '/cartoes' }, { rotulo: cartao.nome, to: rotaCartao(cartaoId) }]} />

  if (erro) return <>{caminho}<Aviso tipo="erro">{erro}</Aviso></>
  if (!faturas) return <>{caminho}<p className="text-sm text-slate-600" role="status">Carregando fatura…</p></>
  const k = faturas.findIndex((x) => x.mes === mes)
  const f = k >= 0 ? faturas[k] : null
  if (!f) {
    // card_months só tem linha para mês com parcela ou crédito: a fatura atual de um ciclo ainda sem compra não existe
    // como linha. "Abrir fatura" aponta para ela mesmo assim; aqui cai na fatura mais próxima dela (a primeira a partir
    // desse mês; senão a última), a mesma regra da fileira de antes da #203. Sem fatura nenhuma, volta ao cartão, onde
    // "Nenhuma compra lançada" e o "Pagar fatura" adiantado moram.
    const proxima = faturas.find((x) => x.mes >= mes)?.mes ?? faturas[faturas.length - 1]?.mes ?? null
    return <Navigate to={proxima ? rotaFatura(cartaoId, proxima) : rotaCartao(cartaoId)} replace />
  }
  const anterior = k > 0 ? faturas[k - 1] : null
  const seguinte = k < faturas.length - 1 ? faturas[k + 1] : null
  // fatura fechada e paga: só leitura (migration 064; o banco também recusa)
  const travada = faturaTravada(f, hoje)
  const sit = seloDaFatura(f, hoje)
  const fechou = f.fechamento <= hoje
  const venceu = f.vencimento !== null && f.vencimento < hoje
  const ultimoPagamento = pagamentos.length > 0 ? pagamentos[pagamentos.length - 1] : null
  // para onde um pagamento desta fatura pode ir: qualquer outra fatura do cartão que não esteja fechada e paga (migration 110)
  const destinosPagamento = faturas.filter((x) => x.mes !== f.mes && !faturaTravada(x, hoje))
  // mandar a parcela para outra fatura (migration 111): só parcela ainda não cobrada, de fatura que não fechou. "Anterior" só
  // existe se a anterior ainda está aberta, ou seja, se esta não é a fatura aberta de hoje (a de um mês antes já fechou)
  const mesAberto = fechamentoNoCiclo(hoje, cartao)?.slice(0, 7) ?? null
  const podeMover = !fechou && mesAberto !== null
  const podeAnterior = podeMover && f.mes > mesAberto
  const fechadaAPagar = fechadaAPagarDe(cartao, faturas, hoje)
  const pagaAqui = pagaNaFatura(cartao, f, fechadaAPagar, hoje)
  const formularioPagar = painel?.tipo === 'pagar' && painel.cartao.id === cartaoId ? <PainelJunto>{painelDoCartao(painel)}</PainelJunto> : null
  const formularioRapido = emFolha(painel) && painel.cartao.id === cartaoId ? painelDoCartao(painel) : null
  const seta = 'inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-xl leading-none text-azul hover:bg-azul-claro disabled:cursor-not-allowed disabled:opacity-40'
  const idPagamentos = `${idBase}-pagamentos`, idEntradas = `${idBase}-entradas`, idSaidas = `${idBase}-saidas`

  return (
    <>
      {caminho}
      <CabecalhoPagina
        titulo={<span className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 break-words">{cartao.nome} · {primeiraMaiuscula(formatMonth(f.mes))}</span>
          <span className={`rounded px-1.5 text-sm font-medium ${sit.estilo}`}>{sit.texto}</span>
        </span>}
        descricao={<>{fechou ? 'Fechou' : 'Fecha'} em {formatDate(f.fechamento)}{f.vencimento && <> · {venceu ? 'Venceu' : 'Vence'} em {formatDate(f.vencimento)}</>}</>}
        acoes={
          <div className="flex flex-wrap items-center justify-end gap-2 print:hidden">
            {pagaAqui && <Button variante="pilula" compacto onClick={() => setPainel({ tipo: 'pagar', cartao })} disabled={painel !== null}>Pagar fatura</Button>}
            {!travada && <NovoNoCartao cartao={cartao} painel={painel} setPainel={setPainel} forma="secundario" atalhos={acao === null && painelPrevista === null} />}
            <Button variante="fantasma" compacto aria-label="Imprimir fatura" title="Imprimir fatura" onClick={() => window.print()}>Imprimir</Button>
            <nav aria-label="Outras faturas" className="flex items-center gap-1">
              <button type="button" className={seta} disabled={!anterior} aria-label={anterior ? `Fatura anterior (${formatMonth(anterior.mes)})` : 'Fatura anterior (não há)'}
                onClick={() => anterior && navigate(rotaFatura(cartaoId, anterior.mes))}>‹</button>
              <button type="button" className={seta} disabled={!seguinte} aria-label={seguinte ? `Fatura seguinte (${formatMonth(seguinte.mes)})` : 'Fatura seguinte (não há)'}
                onClick={() => seguinte && navigate(rotaFatura(cartaoId, seguinte.mes))}>›</button>
            </nav>
          </div>
        } />

      {erroGeral && <div className="mb-4"><Aviso tipo="erro">{erroGeral}</Aviso></div>}
      {aviso && !erroGeral && <div className="mb-4"><Aviso tipo="erro">{aviso}</Aviso></div>}

      <Card>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="rounded-lg bg-fundo p-3">
            {/* #181: "Pagar fatura" só na fatura que o pagamento quita; paga (travada) não tem */}
            {pagaAqui && <p className="text-sm font-medium text-slate-600">Use o botão Pagar no cabeçalho para quitar esta fatura.</p>}
            {!travada && fechadaAPagar !== null && f.mes !== fechadaAPagar && (
              <p className="text-sm text-slate-600">
                Para pagar, abra a <Link to={rotaFatura(cartaoId, fechadaAPagar)} className="font-semibold text-azul underline">fatura de {formatMonth(fechadaAPagar)}</Link>: o pagamento quita primeiro a mais antiga.
              </p>
            )}
            {travada && (
              <div className="text-sm" data-testid="fatura-travada">
                <p className="font-semibold text-lucro">
                  {ultimoPagamento ? `Paga em ${diaMes(ultimoPagamento.data)}` : 'Paga'} · Fatura paga — travada
                </p>
                <p className="text-xs text-slate-600">
                  Fatura paga não muda mais. Para corrigir algo dela, lance um crédito ou estorno na fatura atual.
                </p>
              </div>
            )}
            {f.aCobrar > 0 && f.cobrado > 0 && (
              <p className="mt-2 text-xs text-agendado">Ainda vai entrar nesta fatura: {formatBRL(f.aCobrar)} <SeloAgendado /></p>
            )}
            {f.adiantamentoEntrada > 0 && <p className="mt-2 text-xs text-lucro">Adiantamento usado nesta fatura: até {formatBRL(f.adiantamentoEntrada)}</p>}
            {f.adiantamentoSaida > 0 && <p className="mt-2 text-xs text-lucro">Sobra de adiantamento para as próximas: {formatBRL(f.adiantamentoSaida)}</p>}
            {f.pago > 0 && f.faturaId && !acao && !travada && (
              <div className="mt-2">
                <Button variante="fantasma" compacto onClick={() => setAcao({ tipo: 'reabrir', fatura: f })}>Reabrir fatura</Button>
              </div>
            )}
          </div>
          {/* #183: o valor nunca quebra (nowrap). Três colunas só com largura de sobra; no resto, empilha: nome à esquerda, valor à direita */}
          <dl className="grid grid-cols-1 content-start gap-x-4 gap-y-1 rounded-lg bg-fundo p-3 text-sm sm:grid-cols-3 md:grid-cols-1 xl:grid-cols-3" aria-label="Resumo da fatura">
            <div className={itemResumo}>
              <dt className="text-xs text-slate-500">Saldo anterior</dt>
              <dd className={`${valorResumo} ${f.saldoAnterior > 0 ? 'text-prejuizo' : f.adiantamentoEntrada > 0 ? 'text-lucro' : ''}`}>
                {f.saldoAnterior > 0 ? formatBRL(f.saldoAnterior) : f.adiantamentoEntrada > 0 ? `crédito ${formatBRL(f.adiantamentoEntrada)}` : formatBRL(c0)}
              </dd>
            </div>
            <div className={itemResumo}>
              <dt className="text-xs text-slate-500">Gasto do mês</dt>
              <dd className={valorResumo}>{formatBRL(f.total)}</dd>
            </div>
            <div className={itemResumo}>
              <dt className="text-xs text-slate-500">Valor pago</dt>
              <dd className={`${valorResumo} ${f.pago > 0 ? 'text-lucro' : ''}`}>{formatBRL(f.pago)}</dd>
            </div>
          </dl>
        </div>
        {formularioPagar}
        {formularioRapido}
        {acao?.tipo === 'reabrir' && acao.fatura.mes === f.mes && (
          <PainelReabrir cartaoId={cartaoId} fatura={f} aoFechar={() => setAcao(null)} aoConcluir={async () => { setAcao(null); await carregar() }} />
        )}
        {acao?.tipo === 'moverPagamento' && (
          <PainelMoverPagamento pagamento={acao.pagamento} mesAtual={f.mes} destinos={destinosPagamento} hoje={hoje}
            aoFechar={() => setAcao(null)} aoConcluir={async () => { setAcao(null); await carregar() }} />
        )}
        {acao?.tipo === 'editar' && (
          <PainelEditar item={acao.item} aoFechar={() => setAcao(null)} aoConcluir={async () => { setAcao(null); await carregar() }} />
        )}
        {acao?.tipo === 'excluir' && (
          // sem a compra a fatura pode deixar de existir: volta para o cartão depois de excluir
          <PainelExcluir cartaoId={cartaoId} item={acao.item} contas={contas} aoFechar={() => setAcao(null)}
            aoConcluir={async () => { setAcao(null); await carregar(); navigate(rotaCartao(cartaoId)) }} />
        )}

        {/* extrato em três blocos, nesta ordem (pedido do dono): pagamentos, entradas, saídas */}
        <section className="mt-4 border-t border-slate-100 pt-4" aria-labelledby={idPagamentos} data-testid="bloco-pagamentos">
          <h2 id={idPagamentos} className="mb-1 text-sm font-semibold text-slate-600">Pagamentos</h2>
          {erroPagamentos && <div className="mb-2"><Aviso tipo="erro">{erroPagamentos}</Aviso></div>}
          {pagamentos.length === 0 && !erroPagamentos && <p className="text-sm text-slate-500">Sem pagamento ainda.</p>}
          {pagamentos.length > 0 && (
            <ListaRecolhida key={mes} itens={pagamentos} rotulo="Pagamentos da fatura" className="flex flex-col gap-1 text-sm">
              {(p) => (
                <li key={p.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded border border-slate-100 px-3 py-1.5" data-testid="pagamento-fatura">
                  <span className="min-w-0 truncate">Pagamento recebido em {formatDate(p.data)}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span data-valor className="whitespace-nowrap tabular-nums font-semibold text-lucro">{formatBRL(p.valor)}</span>
                    {/* fatura paga não muda (migration 064); nem aparece o botão */}
                    {!travada && !acao && destinosPagamento.length > 0 && (
                      <Button variante="fantasma" compacto onClick={() => setAcao({ tipo: 'moverPagamento', pagamento: p })}
                        aria-label={`Mudar a fatura do pagamento de ${formatDate(p.data)}`}>Mudar fatura</Button>
                    )}
                  </span>
                </li>
              )}
            </ListaRecolhida>
          )}
        </section>

        <section className="mt-4 border-t border-slate-100 pt-4" aria-labelledby={idEntradas} data-testid="bloco-entradas">
          <h2 id={idEntradas} className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 text-sm font-semibold text-slate-600">
            <span>Entradas — estornos e reembolsos</span>
            {/* o total dos créditos é o do banco (card_months.creditos): a tela não soma a lista */}
            {f.creditos > 0 && <span className="whitespace-nowrap tabular-nums text-lucro" data-testid="total-entradas">+{formatBRL(f.creditos)}</span>}
          </h2>
          {f.creditos > 0 && <p className="mb-1 text-xs text-slate-500">Contam como receita no mês do fechamento desta fatura.</p>}
          {erroCreditos && <div className="mb-2"><Aviso tipo="erro">{erroCreditos}</Aviso></div>}
          {creditos.length === 0 && !erroCreditos && <p className="text-sm text-slate-500">Nenhum estorno ou reembolso nesta fatura.</p>}
          {creditos.length > 0 && (
            <ListaRecolhida key={mes} itens={creditos} rotulo="Entradas da fatura" className="divide-y divide-slate-100">
              {(cr) => (
                <LinhaDaFatura key={cr.id} testId="credito-fatura"
                  icone={<IconeCategoria visual={visualPorId(cr.categoriaId, categoriaPorId, 'income')} tamanho="pequeno" />}
                  titulo={cr.descricao}
                  detalhe={`${formatDate(cr.dataCredito)} · ${nomeCategoria.get(cr.categoriaId) ?? 'Sem categoria'} · receita`}
                  valor={`+${formatBRL(cr.valor)}`} corValor="text-lucro"
                  // #202: trocar a categoria vale também em fatura paga (migration 077: só a classificação muda); anular, não (064)
                  acoes={<>
                    {anulando === cr.id && <span role="status" className="text-xs text-slate-500">Anulando…</span>}
                    <MenuAcoes rotulo={`Ações do crédito ${cr.descricao}`} desabilitado={anulando !== null || acao !== null}
                      acoes={[
                        { rotulo: 'Trocar categoria', aoEscolher: () => setAcao({ tipo: 'categoria', credito: cr }) },
                        ...(travada ? [] : [{ rotulo: 'Anular crédito', aoEscolher: () => void anularCredito(cr), perigo: true }]),
                      ]} />
                  </>}
                  painel={acao?.tipo === 'categoria' && acao.credito.id === cr.id && (
                    <PainelJunto className="mt-2 w-full">
                      <PainelCategoriaCredito credito={acao.credito} categorias={categorias} aoFechar={() => setAcao(null)}
                        aoConcluir={async () => { setAcao(null); await carregar() }} />
                    </PainelJunto>
                  )} />
              )}
            </ListaRecolhida>
          )}
        </section>

        <section className="mt-4 border-t border-slate-100 pt-4" aria-labelledby={idSaidas} data-testid="bloco-saidas">
          <h2 id={idSaidas} className="mb-1 text-sm font-semibold text-slate-600">Saídas</h2>
          {erroMover && <div className="mt-2"><Aviso tipo="erro">{erroMover}</Aviso></div>}
          {avisoMover && <div className="mt-2"><Aviso tipo="sucesso">{avisoMover}</Aviso></div>}
          {erroItens ? <div className="mt-2"><Aviso tipo="erro">{erroItens}</Aviso></div> : itens === null ? <p className="mt-2 text-sm text-slate-600" role="status">Carregando…</p> : itens.length === 0 ? (
            <p className="text-sm text-slate-500">Nenhuma compra nesta fatura.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {comprasPorDia(itens).map(([dia, doDia]) => (
                <div key={dia ?? 'sem-data'} role="group" aria-label={dia ? formatDate(dia) : 'Sem data da compra'}>
                  <h3 className="mb-1 text-xs font-semibold text-slate-500">{dia ? formatDate(dia) : 'Sem data da compra'}</h3>
                  <ul className="divide-y divide-slate-100">
                    {doDia.map((i) => (
                      <LinhaDaFatura key={i.parcelaId} testId="compra-fatura"
                        icone={<IconeCategoria visual={visualPorId(i.categoriaId, categoriaPorId, 'expense')} tamanho="pequeno" />}
                        titulo={i.descricao}
                        detalhe={`${nomeCategoria.get(i.categoriaId) ?? 'Sem categoria'}${i.falta > 0 ? ' · a cobrar no fechamento' : ''}`}
                        parcela={i.deParcelas > 1 ? `${i.parcela}/${i.deParcelas}` : null}
                        valor={`−${formatBRL(i.valor)}`} corValor="text-prejuizo"
                        // fatura paga (travada, migration 064): sem ⋯; o banco também recusa
                        acoes={travada ? null : (
                          <MenuAcoes rotulo={`Ações de ${i.descricao}`} desabilitado={acao !== null || movendo !== null} acoes={[
                            { rotulo: 'Estornar', aoEscolher: () => setAcao({ tipo: 'estornar', item: i, faturaId: f.faturaId }) },
                            { rotulo: 'Editar valor', aoEscolher: () => setAcao({ tipo: 'editar', item: i }) },
                            ...(podeMover && i.falta > 0 ? [
                              ...(podeAnterior ? [{ rotulo: 'Enviar para a fatura anterior', aoEscolher: () => { void moverParcela(i, 'previous') } }] : []),
                              { rotulo: 'Enviar para a próxima fatura', aoEscolher: () => { void moverParcela(i, 'next') } },
                            ] : []),
                            { rotulo: 'Excluir compra', aoEscolher: () => setAcao({ tipo: 'excluir', item: i }), perigo: true },
                          ]} />
                        )}
                        painel={acao?.tipo === 'estornar' && acao.item.parcelaId === i.parcelaId && (
                          <PainelJunto className="mt-2 w-full">
                            <PainelEstornar item={acao.item} faturaId={acao.faturaId} aoFechar={() => setAcao(null)}
                              aoConcluir={async () => { setAcao(null); await carregar() }} />
                          </PainelJunto>
                        )} />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>

        {previstas.length > 0 && (
          <section className="mt-4 border-t border-slate-100 pt-4" aria-label="Assinaturas previstas nesta fatura" data-testid="bloco-previstas">
            <h2 className="mb-1 text-sm font-semibold text-slate-600">Assinaturas previstas <SeloAgendado /></h2>
            <p className="mb-1 text-xs text-slate-500">Ainda não cobradas: entram nesta fatura no dia indicado. Cancelou? Use ⋯ na linha para excluir a assinatura; para mudar valor ou descrição, abra Recorrentes.</p>
            {erroPrevistas && <div className="mb-2"><Aviso tipo="erro">{erroPrevistas}</Aviso></div>}
            <ul className="divide-y divide-slate-100">
              {previstas.map((o) => (
                <LinhaDaFatura key={`${o.recorrenciaId}-${o.data}`} testId="assinatura-prevista"
                  icone={<IconeCategoria visual={visualPorId(o.categoriaId, categoriaPorId, 'expense')} tamanho="pequeno" />}
                  titulo={o.descricao}
                  detalhe={`${nomeCategoria.get(o.categoriaId) ?? 'Sem categoria'} · cobrança em ${formatDate(o.data)}${o.editada ? ' · alterada' : ''}`}
                  valor={`−${formatBRL(o.valor)}`} corValor="text-prejuizo"
                  acoes={(
                    <MenuAcoes rotulo={`Ações de ${o.descricao}`} desabilitado={acao !== null || painelPrevista !== null} acoes={[
                      ...(o.itemId ? [
                        { rotulo: 'Editar…', aoEscolher: () => setPainelPrevista({ tipo: 'editar', ocorrencia: o }) },
                        { rotulo: 'Cancelar cobrança…', aoEscolher: () => setPainelPrevista({ tipo: 'cancelar', ocorrencia: o }) },
                      ] : []),
                      { rotulo: 'Abrir Recorrentes', aoEscolher: () => navigate('/recorrentes') },
                      { rotulo: 'Excluir assinatura', aoEscolher: () => { void excluirAssinatura(o) }, perigo: true },
                    ]} />
                  )} />
              ))}
            </ul>
            {painelPrevista && (
              <PainelJunto>
                <PainelAgendada tipo={painelPrevista.tipo} ocorrencia={painelPrevista.ocorrencia} categorias={categorias} hoje={hoje}
                  aoFechar={() => setPainelPrevista(null)}
                  aoConcluir={async () => { setPainelPrevista(null); await carregar() }} />
              </PainelJunto>
            )}
          </section>
        )}
      </Card>
    </>
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
          opcoes={contas.filter((c) => c.ativa && aceitaLancamento(c, 'cartao_divida_provento')).map((c) => [c.id, c.nome])} />
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
  const desde = fechamento && vencimento ? inicioDaTroca(hojeSP(), cartao, Number(fechamento), Number(vencimento)) : null

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
        {desde && <p className="text-sm font-medium text-slate-700 md:col-span-2">A mudança vale a partir da fatura que fecha em {formatDate(desde)}.</p>}
        <Botoes rotulo="Salvar" enviando={enviando} aoCancelar={aoCancelar} />
      </form>
    </Card>
  )
}

function FormContaPagamento({ cartao, contas, aoSalvar, aoCancelar }: PropsBase & { cartao: Cartao; contas: Conta[] }) {
  // só contas em reais pagam cartão (multimoeda F2: cartão, dívida e provento seguem em reais; o banco também recusa)
  const ativas = contas.filter((c) => c.ativa && aceitaLancamento(c, 'cartao_divida_provento'))
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

function FormCompra({ cartao, categorias, aoSalvar, aoCancelar, aoCategoriaCriada }: PropsBase & { cartao: Cartao; categorias: Categoria[]; aoCategoriaCriada?: (c: Categoria) => void }) {
  const hoje = hojeSP()
  const [andamento, setAndamento] = useState(false)
  const [descricao, setDescricao] = useState('')
  const [valorTexto, setValorTexto] = useState('')
  const [parcelasTexto, setParcelasTexto] = useState('1')
  const [data, setData] = useState(hoje)
  const [categoriaId, setCategoriaId] = useState('')
  const [deslocamento, setDeslocamento] = useState(0)
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
    const desloc = andamento ? 0 : deslocamento
    void enviar(() => registrarCompra(cartao.id,
      { descricao, data: andamento ? hoje : data, total, parcelas, categoriaId, ...(desloc !== 0 ? { deslocamento: desloc } : {}) }, chave))
  }

  return (
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
      <SeletorCategoria rotulo="Categoria" valor={categoriaId} aoMudar={setCategoriaId} opcoes={despesas} categorias={categorias}
        tipo="expense" aoCriada={aoCategoriaCriada} />
      {tentou && !categoriaId && <p role="alert" className="text-sm text-negativo md:col-span-2">Escolha a categoria.</p>}
      <Field rotulo={andamento ? 'Valor de cada parcela (R$)' : 'Valor total (R$)'} inputMode="decimal" value={valorTexto}
        onChange={(e) => setValorTexto(e.target.value)} erro={erroValor} />
      <Field rotulo={andamento ? 'Parcelas que ainda faltam (incluindo a da fatura aberta)' : 'Parcelas'} type="number" min={1} max={72}
        inputMode="numeric" value={parcelasTexto} onChange={(e) => setParcelasTexto(e.target.value)} erro={erroParcelas} />
      {!andamento && (
        <Field rotulo="Data da compra" type="date" value={data} onChange={(e) => setData(e.target.value)} erro={tentou && !data ? 'Informe a data.' : undefined} />
      )}
      {!andamento && cartao.fechamento !== null && data && (
        <Selecao rotulo="Fatura" valor={String(deslocamento)} aoMudar={(v) => setDeslocamento(Number(v))}
          opcoes={opcoesDeFatura(data, cartao.fechamento, cartao.cicloAnterior).map((o) => [String(o.deslocamento), o.rotulo])} />
      )}
      <p className="text-sm text-slate-600 md:col-span-2">
        {andamento
          ? 'As parcelas restantes entram a partir da fatura aberta, uma por mês.'
          : `Compra antes do fechamento (${textoDiaFechamento(cartao.fechamento ?? 0)}) entra na fatura deste mês; no dia do fechamento ou depois, na seguinte. Cada parcela vira despesa no mês da fatura. Se o banco lançou em outra fatura, escolha-a acima (até 3 antes ou 3 depois).`}
        {total !== null && parcelasOk && parcelas > 1 && <> Total: <strong className="tabular-nums">{formatBRL(total)}</strong>.</>}
      </p>
      <Botoes rotulo="Lançar compra" enviando={enviando} aoCancelar={aoCancelar} />
    </form>
  )
}

/**
 * Crédito no cartão que não é estorno de compra (estorno de IOF, cashback, reembolso da empresa ou do plano de saúde).
 * Decisão do dono (04/11/2026): conta como RECEITA no mês do fechamento da fatura em que entra e abate essa fatura.
 */
function FormCredito({ cartao, categorias, aoSalvar, aoCancelar }: PropsBase & { cartao: Cartao; categorias: Categoria[] }) {
  const hoje = hojeSP()
  const [descricao, setDescricao] = useState('')
  const [valorTexto, setValorTexto] = useState('')
  const [data, setData] = useState(hoje)
  const [categoriaId, setCategoriaId] = useState('')
  const [fechamento, setFechamento] = useState('')
  const [faturas, setFaturas] = useState<Fatura[]>([])
  const [tentou, setTentou] = useState(false)
  const [chave] = useState(novaChave)
  const { erro, enviando, enviar } = useEnvio(aoSalvar)

  useEffect(() => {
    // as faturas já existentes servem de opção de fatura posterior; se não carregar, fica só a automática
    listarFaturas(cartao.id).then(setFaturas).catch(() => setFaturas([]))
  }, [cartao.id])

  const valor = parseBRL(valorTexto)
  const receitas = categorias.filter((c) => c.tipo === 'income' && c.ativa)
  // só faturas que fecham depois do crédito (no dia do fechamento ele já vai para a seguinte) e até 3 depois da aberta:
  // a aberta fecha em menos de um mês, então "até 4 meses depois da data" cobre as 4 (o banco confere a regra exata)
  const limite = data ? (() => { const [a, m, d] = data.split('-').map(Number); return new Date(Date.UTC(a, m + 3, d)).toISOString().slice(0, 10) })() : ''
  const posteriores = faturas.filter((f) => f.fechamento > data && f.fechamento <= limite)
  const escolhida = posteriores.some((f) => f.fechamento === fechamento) ? fechamento : ''

  const erroValor = tentou && (valor === null || valor <= 0) ? 'Valor inválido. Exemplo: 1.250,50' : undefined

  function salvar(e: FormEvent) {
    e.preventDefault()
    setTentou(true)
    if (!descricao.trim() || valor === null || valor <= 0 || !categoriaId || !data) return
    void enviar(async () => {
      await lancarCreditoNoCartao(cartao.id, { descricao, data, valor, categoriaId, fechamento: escolhida || null }, chave)
    })
  }

  return (
    <form onSubmit={salvar} className="grid gap-4 md:grid-cols-2" noValidate>
      {erro && <div className="md:col-span-2"><Aviso tipo="erro">{erro}</Aviso></div>}
      <Field rotulo="Descrição" maxLength={80} placeholder="Ex.: Estorno de IOF, cashback, reembolso do plano" value={descricao}
        onChange={(e) => setDescricao(e.target.value)} erro={tentou && !descricao.trim() ? 'Informe a descrição.' : undefined} />
      <SeletorCategoria rotulo="Categoria de receita" valor={categoriaId} aoMudar={setCategoriaId} opcoes={receitas} categorias={categorias} tipo="income" />
      {tentou && !categoriaId && <p role="alert" className="text-sm text-negativo md:col-span-2">Escolha a categoria de receita.</p>}
      <Field rotulo="Valor (R$)" inputMode="decimal" value={valorTexto} onChange={(e) => setValorTexto(e.target.value)} erro={erroValor} />
      <Field rotulo="Data do crédito" type="date" value={data} onChange={(e) => setData(e.target.value)} erro={tentou && !data ? 'Informe a data.' : undefined} />
      <Selecao rotulo="Fatura" valor={escolhida} aoMudar={setFechamento} todos="A aberta na data do crédito (automática)"
        opcoes={posteriores.map((f) => [f.fechamento, `${primeiraMaiuscula(formatMonth(f.mes))} (fecha ${formatDate(f.fechamento)})`])} />
      <p className="text-sm text-slate-600 md:col-span-2">
        O crédito abate a fatura e conta como <strong>receita</strong> no mês do fechamento dela (o mesmo mês em que as compras
        dessa fatura viram despesa). Crédito antes do fechamento ({cartao.fechamento !== null && textoDiaFechamento(cartao.fechamento)}) entra na fatura deste mês; no dia do fechamento ou
        depois, na seguinte. Para estorno de uma compra específica, use <strong>Estornar</strong> na linha da compra, em Ver faturas.
      </p>
      <Botoes rotulo="Lançar crédito" enviando={enviando} aoCancelar={aoCancelar} />
    </form>
  )
}

/** O que falta pagar de uma fatura: diferença de dois valores da mesma linha de card_months (permitido; não é soma de relatório). */
const abertoDa = (f: Fatura): number => Math.max(0, f.total - f.pago)

function FormPagar({ cartao, contas, aoSalvar, aoCancelar }: PropsBase & { cartao: Cartao; contas: Conta[] }) {
  const ativas = contas.filter((c) => c.ativa && aceitaLancamento(c, 'cartao_divida_provento'))
  // a conta de pagamento do cartão, se existir e ainda estiver ativa; senão a primeira ativa
  const [contaId, setContaId] = useState(ativas.find((c) => c.id === cartao.contaPagamentoId)?.id ?? ativas[0]?.id ?? '')
  // com fatura fechada, sugere a dívida; sem fatura, é pagamento adiantado e o valor fica por conta do dono
  const [valorTexto, setValorTexto] = useState(cartao.divida > 0 ? formatBRLCampo(cartao.divida) : '')
  // se a pessoa já mexeu no valor, a sugestão que chega depois (aberto da fatura) não sobrescreve
  const editouValor = useRef(false)
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
      .then((fs) => {
        if (!vivo) return
        const f = fs.find((x) => situacaoFatura(x, hoje) === 'fechada') ?? null
        setFatura(f)
        setFaturaEstado('ok')
        // #306: com pagamento movido para fatura seguinte, a dívida (debt_balances) fica menor que o aberto desta fatura,
        // até zero ou crédito; sugerir só a dívida deixaria a fatura fechada em aberto
        const a = f ? abertoDa(f) : 0
        if (a > Math.max(cartao.divida, 0) && !editouValor.current) setValorTexto(formatBRLCampo(a as Cents))
      })
      .catch(() => { if (vivo) { setFatura(null); setFaturaEstado('falhou') } })
    return () => { vivo = false }
  }, [cartao.id, cartao.divida])

  // o que falta pagar da fatura que este pagamento quita: diferença de dois valores da mesma linha (card_months)
  const aberto = fatura ? abertoDa(fatura) : 0
  // a referência das mensagens: a dívida do cartão, ou o aberto da fatura quando ele é maior (pagamento movido para a seguinte)
  const referencia = aberto > Math.max(cartao.divida, 0) ? (aberto as Cents) : cartao.divida
  // fatura fechada ainda em aberto, mesmo com o cartão sem dívida (o pagamento movido deixou a dívida em zero ou crédito)
  const fechadaSemDivida = cartao.divida <= 0 && fatura !== null && aberto > 0
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
  const adiantado = valor !== null && valor > 0 && valor > referencia
  // o crédito que o cartão já tem também cobre parcelas futuras: só avisa quando passa de (dívida + parcelas futuras − crédito).
  // Aqui fica a dívida, não a referência: o pagamento movido já abate o total do cartão, e somar o aberto o contaria duas vezes
  const maisQueTudo = valor !== null && valor > cartao.divida + cartao.compromissos - cartao.credito

  return (
    <Card className="mb-6">
      <h2 className="mb-4 text-lg font-semibold">Pagar fatura · {cartao.nome}</h2>
      <form onSubmit={salvar} className="grid gap-4 md:grid-cols-2" noValidate>
        {erro && <div className="md:col-span-2"><Aviso tipo="erro">{erro}</Aviso></div>}
        <Selecao rotulo="Pagar com a conta" valor={contaId} aoMudar={setContaId} opcoes={ativas.map((c) => [c.id, c.nome])} todos="Escolha…" />
        <Field rotulo="Valor (R$)" inputMode="decimal" value={valorTexto} onChange={(e) => { editouValor.current = true; setValorTexto(e.target.value) }} erro={erroValor} />
        <Field rotulo="Data do pagamento" type="date" value={data} max={hojeSP()} onChange={(e) => setData(e.target.value)} />
        <p className="text-sm text-slate-600 md:col-span-2">
          {cartao.divida > 0 && fatura ? <>Quita a fatura de <strong>{formatMonth(fatura.mes)}</strong>. </> : null}
          {cartao.divida > 0 && referencia > cartao.divida && fatura && (
            <>Ela tem <strong>{formatBRL(referencia)}</strong> em aberto; a dívida do cartão ({formatBRL(cartao.divida)}) é menor porque há pagamento ligado a uma fatura seguinte. </>
          )}
          {fechadaSemDivida && fatura && (
            <>A fatura de <strong>{formatMonth(fatura.mes)}</strong> tem <strong>{formatBRL(referencia)}</strong> em aberto, mesmo com o cartão sem dívida, porque há pagamento ligado a uma fatura seguinte. Este pagamento abate primeiro ela. </>
          )}
          {adiantado && (cartao.divida > 0 || fechadaSemDivida) && <>O que passar da fatura fechada ({formatBRL(referencia)}) <strong>fica como crédito no cartão</strong> e abate as próximas faturas. </>}
          {cartao.divida <= 0 && !fechadaSemDivida && <>Não há fatura fechada: pagar antes do fechamento <strong>vira crédito no cartão</strong> e abate as próximas faturas. </>}
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

/**
 * Mudar a fatura de um pagamento (migration 110, pedido do dono): o mesmo pagamento passa a quitar outra fatura, sem anular
 * e lançar de novo. Data, valor e conta não mudam. Só aparecem destinos que não estão fechados e pagos; o banco confere
 * de novo (origem e destino) e recusa o que mudar fatura paga.
 */
function PainelMoverPagamento({ pagamento, mesAtual, destinos, hoje, aoFechar, aoConcluir }: {
  pagamento: PagamentoFatura; mesAtual: string; destinos: Fatura[]; hoje: string; aoFechar: () => void; aoConcluir: () => Promise<void>
}) {
  // o pedido do dono era "deveria ser na seguinte": começa na primeira fatura depois desta, se houver
  const [mes, setMes] = useState(destinos.find((x) => x.mes > mesAtual)?.mes ?? destinos[0]?.mes ?? '')
  const { erro, enviando, enviar } = useEnvio(aoConcluir)
  function salvar(e: FormEvent) {
    e.preventDefault()
    if (!mes) return
    void enviar(() => moverPagamentoDeFatura(pagamento.id, mes))
  }
  return (
    <form onSubmit={salvar} noValidate className="mt-3 grid gap-3 rounded-lg border border-slate-200 bg-azul-claro p-4 md:grid-cols-2"
      aria-label="Mudar a fatura do pagamento">
      {erro && <div className="md:col-span-2"><Aviso tipo="erro">{erro}</Aviso></div>}
      <p className="text-sm md:col-span-2">
        O pagamento de <strong>{formatBRL(pagamento.valor)}</strong>, recebido em {formatDate(pagamento.data)}, passa a quitar a fatura escolhida.
        A data, o valor e a conta não mudam. Fatura fechada e paga não aparece aqui.
      </p>
      <Selecao rotulo="Fatura de destino" valor={mes} aoMudar={setMes}
        opcoes={destinos.map((x) => [x.mes, `${primeiraMaiuscula(formatMonth(x.mes))} · ${seloDaFatura(x, hoje).texto} · ${formatBRL(x.total)}`])} />
      <Botoes rotulo="Mudar fatura" enviando={enviando} aoCancelar={aoFechar} />
    </form>
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

/**
 * Mudar ou cancelar uma assinatura de cartão que ainda não virou compra, como no Organizze: a pergunta é "só esta" ou
 * "esta e as próximas". "Esta e as próximas" mudando divide a regra: a antiga termina na véspera e uma nova começa na data
 * nova. O que já virou compra não passa por aqui. Validações finais no banco (card_scheduled_*).
 */
function PainelAgendada({ tipo, ocorrencia: o, categorias, hoje, aoFechar, aoConcluir }: {
  tipo: 'editar' | 'cancelar'; ocorrencia: OcorrenciaPrevista; categorias: Categoria[]; hoje: string
  aoFechar: () => void; aoConcluir: () => Promise<void>
}) {
  const [escopo, setEscopo] = useState<'esta' | 'proximas'>('esta')
  const [descricao, setDescricao] = useState(o.descricao)
  const [valorTexto, setValorTexto] = useState(formatBRLCampo(o.valor).replace(/\u00a0/g, ''))
  const [data, setData] = useState(o.data)
  const [categoriaId, setCategoriaId] = useState(o.categoriaId)
  const [tentou, setTentou] = useState(false)
  const { erro, enviando, enviar } = useEnvio(aoConcluir)
  const valor = parseBRL(valorTexto)
  const despesas = categorias.filter((c) => c.tipo === 'expense' && c.ativa)
  const editar = tipo === 'editar'
  const erroValor = tentou && (valor === null || valor <= 0) ? 'Valor inválido. Exemplo: 49,90' : undefined
  const erroData = tentou && (!data || data <= hoje) ? 'A data precisa ser depois de hoje.' : undefined

  function enviarForm(e: FormEvent) {
    e.preventDefault()
    if (!o.itemId) return
    const itemId = o.itemId
    if (!editar) {
      void enviar(async () => { if (escopo === 'esta') await cancelarAgendada(itemId); else await aPartirDaqui(itemId, 'end') })
      return
    }
    setTentou(true)
    if (valor === null || valor <= 0 || !descricao.trim() || !data || data <= hoje || !categoriaId) return
    const dados = { data, valor, descricao, categoriaId }
    void enviar(async () => { if (escopo === 'esta') await editarAgendada(itemId, dados); else await aPartirDaqui(itemId, 'update', dados) })
  }

  return (
    <form onSubmit={enviarForm} noValidate className="grid gap-3 rounded-lg border border-slate-200 bg-azul-claro p-4 md:grid-cols-2"
      aria-label={editar ? `Editar ${o.descricao}` : `Cancelar ${o.descricao}`}>
      {erro && <div className="md:col-span-2"><Aviso tipo="erro">{erro}</Aviso></div>}
      <p className="text-sm md:col-span-2">
        {editar ? 'Mudar' : 'Cancelar'} a cobrança de <strong>{o.descricao}</strong> em {formatDate(o.data)}. O que já virou compra na fatura não muda por aqui.
      </p>
      <fieldset className="flex flex-wrap gap-4 md:col-span-2">
        <legend className="mb-1 text-sm font-medium">Vale para</legend>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="radio" name="escopo-agendada" checked={escopo === 'esta'} onChange={() => setEscopo('esta')} /> Só esta cobrança
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="radio" name="escopo-agendada" checked={escopo === 'proximas'} onChange={() => setEscopo('proximas')} /> Esta e as próximas
        </label>
      </fieldset>
      {editar && (
        <>
          <Field rotulo="Descrição" maxLength={80} value={descricao} onChange={(e) => setDescricao(e.target.value)}
            erro={tentou && !descricao.trim() ? 'Informe a descrição.' : undefined} />
          <SeletorCategoria rotulo="Categoria" valor={categoriaId} aoMudar={setCategoriaId} opcoes={despesas} categorias={categorias} tipo="expense" />
          <Field rotulo="Valor (R$)" inputMode="decimal" value={valorTexto} onChange={(e) => setValorTexto(e.target.value)} erro={erroValor} />
          <Field rotulo="Data da cobrança" type="date" value={data} onChange={(e) => setData(e.target.value)} erro={erroData} />
        </>
      )}
      <p className="text-sm text-slate-600 md:col-span-2">
        {editar
          ? (escopo === 'esta'
            ? 'Só esta cobrança muda; as outras seguem como estão.'
            : 'Esta e as próximas passam a seguir os dados novos (a assinatura antiga termina na véspera e uma nova começa na data nova). As anteriores não mudam.')
          : (escopo === 'esta'
            ? 'Esta cobrança deixa de existir; as outras seguem.'
            : 'A assinatura termina aqui: esta e as próximas deixam de ser cobradas. O que já foi cobrado fica.')}
      </p>
      <Botoes rotulo={editar ? 'Salvar' : 'Cancelar cobrança'} enviando={enviando} aoCancelar={aoFechar} />
    </form>
  )
}

/** Trocar a categoria de receita de um crédito/reembolso (card_credit_set_category, 077): só a classificação muda. */
function PainelCategoriaCredito({ credito, categorias, aoFechar, aoConcluir }: {
  credito: CreditoFatura; categorias: Categoria[]; aoFechar: () => void; aoConcluir: () => Promise<void>
}) {
  const [categoriaId, setCategoriaId] = useState(credito.categoriaId)
  const { erro, enviando, enviar } = useEnvio(aoConcluir)
  const receitas = categorias.filter((c) => c.tipo === 'income' && c.ativa)

  function salvar(e: FormEvent) {
    e.preventDefault()
    if (!categoriaId) return
    void enviar(async () => { await trocarCategoriaDoCredito([credito.id], categoriaId) })
  }

  return (
    <form onSubmit={salvar} noValidate className="mt-3 grid gap-3 rounded-lg border border-slate-200 bg-azul-claro p-4 md:grid-cols-2"
      aria-label="Trocar categoria do crédito">
      {erro && <div className="md:col-span-2"><Aviso tipo="erro">{erro}</Aviso></div>}
      <p className="text-sm md:col-span-2">
        Só a categoria de <strong>{credito.descricao}</strong> muda: valor, data e fatura ficam como estão (vale também em fatura paga).
      </p>
      <SeletorCategoria rotulo="Categoria de receita" valor={categoriaId} aoMudar={setCategoriaId} opcoes={receitas} categorias={categorias} tipo="income" />
      <Botoes rotulo="Salvar categoria" enviando={enviando} aoCancelar={aoFechar} />
    </form>
  )
}

/**
 * Estorno (total ou parcial) de uma parcela, na linha da compra (debt_refund). Abate a despesa da compra; o banco decide se
 * cancela o que ainda não foi cobrado ou vira crédito na fatura. Aqui só se confere o básico: valor > 0 e até o da parcela.
 */
function PainelEstornar({ item, faturaId, aoFechar, aoConcluir }: {
  item: ItemFatura; faturaId: string | null; aoFechar: () => void; aoConcluir: () => Promise<void>
}) {
  const [valorTexto, setValorTexto] = useState('')
  const [data, setData] = useState(hojeSP())
  const [tentou, setTentou] = useState(false)
  const { erro, enviando, enviar } = useEnvio(aoConcluir)
  const valor = parseBRL(valorTexto)
  const invalido = valor === null || valor <= 0 || valor > item.valor
  const erroValor = tentou && invalido
    ? (valor !== null && valor > item.valor ? `No máximo o valor da parcela (${formatBRL(item.valor)}).` : 'Valor inválido. Exemplo: 50,00')
    : undefined

  function salvar(e: FormEvent) {
    e.preventDefault()
    setTentou(true)
    if (invalido || valor === null || !data) return
    void enviar(() => estornarParcela(item.parcelaId, { data, valor, faturaId }))
  }

  return (
    <form onSubmit={salvar} noValidate className="mt-2 grid gap-3 rounded-lg border border-slate-200 bg-azul-claro p-4 md:grid-cols-2"
      aria-label={`Estornar ${item.descricao}`}>
      {erro && <div className="md:col-span-2"><Aviso tipo="erro">{erro}</Aviso></div>}
      <p className="text-sm md:col-span-2">
        Estorno de <strong>{item.descricao}{item.deParcelas > 1 && ` ${item.parcela}/${item.deParcelas}`}</strong> (parcela de{' '}
        <span className="tabular-nums">{formatBRL(item.valor)}</span>). Abate a despesa da compra; não é receita. Pode ser parcial.
      </p>
      <Field rotulo="Valor do estorno (R$)" inputMode="decimal" value={valorTexto} onChange={(e) => setValorTexto(e.target.value)} erro={erroValor} />
      <Field rotulo="Data do estorno" type="date" value={data} onChange={(e) => setData(e.target.value)} erro={tentou && !data ? 'Informe a data.' : undefined} />
      <Botoes rotulo="Estornar" enviando={enviando} aoCancelar={aoFechar} />
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
    <div className="mt-3 rounded-lg border border-negativo-borda bg-negativo-fundo p-4" role="group" aria-label="Excluir compra">
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
