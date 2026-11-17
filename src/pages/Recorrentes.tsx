import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Aviso } from '../components/ui/Aviso'
import { Card } from '../components/ui/Card'
import { EmptyState } from '../components/ui/EmptyState'
import { useFamilia } from '../lib/FamiliaContext'
import { faturaDaProximaCobranca, listarCartoes, rotaCartao, rotaFatura } from '../lib/cartoes'
import { listarProventosAcabando, listarProventosPrevistos } from '../lib/investimentos'
import type { ProventoAcabando, ProventoPrevisto } from '../lib/investimentos'
import type { Cartao } from '../lib/cartoes'
import { listarCategorias, nomesCompletos } from '../lib/categorias'
import type { Categoria } from '../lib/categorias'
import { hojeSP, listarContas } from '../lib/contas'
import type { Conta } from '../lib/contas'
import { mensagemErroBanco } from '../lib/erros'
import { formatBRL, formatDate, formatMoeda } from '../lib/format'
import { somarDias } from '../lib/periodoRelatorio'
import type { Cents } from '../lib/format'
import {
  diaDaSemana, frequenciaResumo, listarRecorrencias, proximasDatasDasContas, proximasOcorrencias, resumoPorNatureza, resumoRecorrencias, resumoVisaoGeral, sobraDepoisDasParcelas, sobraDosRecorrentes,
  rotuloFrequencia, rotuloNatureza, rotuloTipoRecorrencia,
} from '../lib/recorrencias'
import type { SobraDepoisDasParcelas, SobraRecorrentes, FrequenciaResumo, LinhaNatureza, LinhaVisao, LinhaResumoRecorrencia, NaturezaRecorrencia, Recorrencia } from '../lib/recorrencias'
import { CabecalhoPagina } from '../components/ui/CabecalhoPagina'
import { corDoTipo, corDoValor, NATUREZA, SELO } from '../lib/cores'
import { resumoParcelasDoMes } from '../lib/parcelasAtivas'
import type { ResumoParcelasDoMes } from '../lib/parcelasAtivas'
import { FolhaNatureza } from '../components/recorrentes/FolhaNatureza'
import { IconeCategoria, visualPorId } from '../lib/visualCategoria'

const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

/** As três seções da página (abas de cima): a lista de recorrentes, a projeção dos próximos meses e as parcelas em andamento. */
/** As duas visões da página: o que sai e o que entra (pedido do dono, 14/11/2026). Vai na URL (?v=entradas) para dar para linkar. */
type Lado = 'saidas' | 'entradas'

/**
 * As naturezas de cada lado, na ordem da legenda e da lista (pedido do dono, 17/11/2026: "o que eu pago mensalmente, fixo e variável").
 * Cor categórica fixa por natureza (lib/cores, NATUREZA: fora das cores de status).
 */
type ChaveNatureza = NaturezaRecorrencia | 'none'
const NATUREZAS_DO_LADO: Record<Lado, ChaveNatureza[]> = {
  saidas: ['fixed', 'subscription', 'variable', 'none'],
  entradas: ['reimbursement', 'none'],
}
const rotuloGrupoNatureza: Record<ChaveNatureza, string> = {
  fixed: 'Custos fixos', subscription: 'Assinaturas', variable: 'Gastos variáveis', reimbursement: 'A ressarcir', none: 'Sem natureza',
}
const COR_NATUREZA: Record<ChaveNatureza, string> = NATUREZA

type Aba = 'todos' | 'conta' | 'cartao'
const abas: [Aba, string][] = [['todos', 'Todos'], ['conta', 'Conta'], ['cartao', 'Cartão']]
/** Filtro por natureza (3ª PR de Recorrentes): 'todas' não filtra; 'none' = sem natureza. Transferência não tem natureza: sai quando há filtro. */
type FiltroNatureza = 'todas' | ChaveNatureza

/**
 * Selo da frequência, no singular, só quando NÃO é mensal (o mensal é o normal da tela e não leva selo).
 * A família vem de frequenciaResumo (a mesma do banco); semanal e diário dizem o "a cada N" quando não é 1.
 */
function seloFrequencia(r: Recorrencia): string | null {
  const f = frequenciaResumo(r)
  if (f === 'monthly') return null
  if (f === 'daily') return r.cada === 1 ? 'Diário' : `A cada ${r.cada} dias`
  if (f === 'weekly') return r.cada === 1 ? 'Semanal' : r.cada === 2 ? 'Quinzenal' : `A cada ${r.cada} semanas`
  if (f === 'custom') return `A cada ${r.cada} meses`
  return rotuloSingular[f]
}
const rotuloSingular: Record<Exclude<FrequenciaResumo, 'monthly' | 'daily' | 'weekly' | 'custom'>, string> = {
  bimonthly: 'Bimestral', quarterly: 'Trimestral', semiannual: 'Semestral', yearly: 'Anual',
}
/** O valor da linha é o de cada vez (não convertido para o mês): fora do mensal, diz de quanto em quanto tempo ele é. */
function porVez(r: Recorrencia): string | null {
  const f = frequenciaResumo(r)
  if (f === 'monthly') return null
  if (f === 'daily') return r.cada === 1 ? 'por dia' : 'por vez'
  if (f === 'weekly') return r.cada === 1 ? 'por semana' : r.cada === 2 ? 'por quinzena' : 'por vez'
  return ({ bimonthly: 'por bimestre', quarterly: 'por trimestre', semiannual: 'por semestre', yearly: 'por ano', custom: 'por vez' } as const)[f]
}

/** Quando acontece, curto (a frequência vai no selo, fora do mensal): "dia 10", "20 de fev", "sexta", "a cada 10 dias". */
function quando(r: Recorrencia): string {
  if (r.unidade === 'day') return r.cada === 1 ? 'todo dia' : `a cada ${r.cada} dias`
  if (r.unidade === 'week') {
    const dia = diaDaSemana(r.inicio)
    return r.cada === 1 ? dia : r.cada === 2 ? `quinzenal · ${dia}` : `a cada ${r.cada} semanas · ${dia}`
  }
  if (r.cada === 12) return `${r.dia} de ${MESES_CURTOS[Number(r.inicio.slice(5, 7)) - 1]}`
  if (frequenciaResumo(r) === 'custom') return `a cada ${r.cada} meses · dia ${r.dia}`
  return `dia ${r.dia}`
}

/** "01/12" no ano corrente; "20/02/2027" em outro ano. */
function dataCurta(iso: string, hoje: string): string {
  return iso.slice(0, 4) === hoje.slice(0, 4) ? formatDate(iso).slice(0, 5) : formatDate(iso)
}

/** Ícone (i) que mostra a explicação completa logo abaixo da frase (abre e fecha no clique; Esc fecha e devolve o foco). */
function Explicacao({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  const [aberto, setAberto] = useState(false)
  const id = useId()
  const botao = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!aberto) return
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setAberto(false); botao.current?.focus() } }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [aberto])
  return (
    <>
      <button ref={botao} type="button" aria-label={rotulo} title={rotulo} aria-expanded={aberto} aria-controls={aberto ? id : undefined}
        onClick={() => setAberto((v) => !v)}
        className="-my-3 ml-0.5 inline-flex min-h-11 min-w-11 items-center justify-center rounded-full align-middle text-azul hover:bg-azul-claro">
        <span aria-hidden="true" className="inline-flex h-5 w-5 items-center justify-center rounded-full border-2 border-current text-xs font-bold italic leading-none">i</span>
      </button>
      {/* renderização condicional: a classe "block" venceria o atributo hidden */}
      {aberto && <span id={id} className="mt-2 block rounded-lg bg-azul-claro p-3 text-marinho">{children}</span>}
    </>
  )
}

/** "Já terminaram" mostra só o que acabou nesse prazo; o mais antigo fica atrás de um botão (nada é apagado). */
const DIAS_TERMINADAS_RECENTES = 90

export default function Recorrentes() {
  const { familia } = useFamilia()
  const familiaId = familia?.id
  const [recorrencias, setRecorrencias] = useState<Recorrencia[] | null>(null)
  const [resumo, setResumo] = useState<LinhaResumoRecorrencia[]>([])
  const [contas, setContas] = useState<Conta[]>([])
  const [cartoes, setCartoes] = useState<Cartao[]>([])
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [erro, setErro] = useState('')
  // bloco secundário que falha NÃO pode parecer "sem dados" (some o card, a linha cai na data da regra): fica num aviso
  const [blocosFalharam, setBlocosFalharam] = useState<string[]>([])
  const [aba, setAba] = useState<Aba>('todos')
  const [verAntigas, setVerAntigas] = useState(false)
  const [params, setParams] = useSearchParams()
  const lado: Lado = params.get('v') === 'entradas' ? 'entradas' : 'saidas'
  function mudarLado(novo: Lado) {
    setParams(novo === 'saidas' ? {} : { v: 'entradas' }, { replace: true })
    setNatureza('todas')
    setAba('todos')
  }
  // corrigir a natureza (a única edição que esta página aceita: só classifica)
  const [corrigindo, setCorrigindo] = useState<Recorrencia | null>(null)
  const [natureza, setNatureza] = useState<FiltroNatureza>('todas')
  const [porNatureza, setPorNatureza] = useState<LinhaNatureza[]>([])
  // visão por mês e por ano (migration 116): null = banco ainda sem a função (a tela mostra o resumo de antes)
  const [visao, setVisao] = useState<LinhaVisao[] | null>(null)
  // a sobra por mês (entra − sai) vem do banco; sem ela (falha ou banco sem a migration 140) a linha some
  const [sobra, setSobra] = useState<SobraRecorrentes | null>(null)
  // e a sobra DESTE mês depois das parcelas (migration 141); sem ela (falha, banco sem a migration) só essa linha some
  const [depoisParcelas, setDepoisParcelas] = useState<SobraDepoisDasParcelas | null>(null)
  // proventos de investimento previstos (planejados) de hoje a 12 meses: só informação, fora do total "Vai entrar" (migration 117)
  const [proventos, setProventos] = useState<ProventoPrevisto[]>([])
  // ativos cuja previsão de proventos acaba em até 60 dias (migration 122): só um aviso, opcional (banco sem a função ou falha: some)
  const [proventosAcabando, setProventosAcabando] = useState<ProventoAcabando[]>([])
  // assinatura → mês da fatura da próxima cobrança, para o link "Abrir" cair direto onde se muda o dia (sem o mapa, abre o cartão)
  const [faturaDe, setFaturaDe] = useState<Map<string, string>>(new Map())
  // próxima cobrança real das contas (migration 125); null = ainda não veio ou o banco não tem a função: a tela cai na data da regra
  const [proximasReais, setProximasReais] = useState<Map<string, string> | null>(null)
  // peso dos parcelamentos neste mês (migration 120, somado no banco): o card "Parcelas e carnês" em Saídas; falha ou banco sem a função: some
  const [parcelasMes, setParcelasMes] = useState<ResumoParcelasDoMes[]>([])

  const carregar = useCallback(async () => {
    if (!familiaId) return
    try {
      const [r, c, k, cat, s] = await Promise.all([
        listarRecorrencias(familiaId), listarContas(familiaId), listarCartoes(familiaId), listarCategorias(familiaId),
        resumoRecorrencias(familiaId),
      ])
      setRecorrencias(r)
      setContas(c.contas)
      setCartoes(k)
      setCategorias(cat)
      setResumo(s)
      // falha só num bloco secundário: o resto da tela segue, mas o aviso (blocosFalharam) diz o que ficou de fora
      setBlocosFalharam([])
      const marcar = (bloco: string) => setBlocosFalharam((a) => (a.includes(bloco) ? a : [...a, bloco]))
      void resumoPorNatureza(familiaId).then(setPorNatureza).catch(() => { setPorNatureza([]); marcar('resumo por natureza') })
      void resumoVisaoGeral(familiaId).then(setVisao).catch(() => { setVisao(null); marcar('visão por mês e por ano') })
      void sobraDosRecorrentes(familiaId).then(setSobra).catch(() => { setSobra(null); marcar('sobra por mês') })
      void sobraDepoisDasParcelas(familiaId).then(setDepoisParcelas).catch(() => { setDepoisParcelas(null); marcar('sobra depois das parcelas') })
      void listarProventosPrevistos(familiaId).then(setProventos).catch(() => { setProventos([]); marcar('proventos previstos') })
      void listarProventosAcabando(familiaId, 60).then(setProventosAcabando).catch(() => { setProventosAcabando([]); marcar('aviso de proventos acabando') })
      // se a consulta falhar a linha mostra a data da regra (que pode estar defasada) e o aviso diz isso
      void proximasDatasDasContas(familiaId).then(setProximasReais).catch(() => { setProximasReais(null); marcar('próxima cobrança das contas') })
      void resumoParcelasDoMes(familiaId).then(setParcelasMes).catch(() => { setParcelasMes([]); marcar('card Parcelas & carnês') })
      void faturaDaProximaCobranca(r.filter((x) => x.tipo === 'card' && x.ativa).map((x) => x.id)).then(setFaturaDe).catch(() => { setFaturaDe(new Map()); marcar('fatura da próxima cobrança das assinaturas') })
      setErro('')
    } catch (err) {
      setErro(mensagemErroBanco(err))
    }
  }, [familiaId])

  useEffect(() => { void carregar() }, [carregar])

  const nomeConta = useMemo(() => new Map(contas.map((c) => [c.id, c.nome])), [contas])
  // valor na moeda da conta (multimoeda F2); cartão é sempre em reais
  const moedaConta = useMemo(() => new Map(contas.map((c) => [c.id, c.moeda ?? 'BRL'])), [contas])
  const nomeCartao = useMemo(() => new Map(cartoes.map((c) => [c.id, c.nome])), [cartoes])
  const nomeCategoria = useMemo(() => nomesCompletos(categorias), [categorias])
  // só a subcategoria (o próprio nome) na linha; o caminho completo vai no title e para o leitor de tela
  const nomeCurtoCategoria = useMemo(() => new Map(categorias.map((c) => [c.id, c.nome])), [categorias])
  const categoriaPorId = useMemo(() => new Map(categorias.map((c) => [c.id, c])), [categorias])

  if (!familiaId) return null
  const hoje = hojeSP()
  const ativas = recorrencias?.filter((r) => r.ativa) ?? []
  // mesma base do banco (migration 063): data final passada fica fora dos grupos e dos totais (aparece só em "Já terminaram")
  const vigentes = ativas.filter((r) => !r.fim || r.fim >= hoje)
  const terminadasTodas = ativas.filter((r) => r.fim && r.fim < hoje)
  const emOutraMoeda = vigentes.filter((r) => r.tipo !== 'card' && (moedaConta.get(r.contaId ?? '') ?? 'BRL') !== 'BRL').length

  // filtro por natureza (a legenda do topo): mostra só o grupo escolhido; os totais vêm de recurrence_nature_summary
  const filtrando = natureza !== 'todas'
  // cada visão só vê o que é dela: saídas = cartão, despesa e transferência (à parte); entradas = receita
  const doLado = (r: Recorrencia) => (lado === 'saidas') === (r.tipo !== 'income')
  const terminadas = terminadasTodas.filter(doLado)
  // "Já terminaram" só mostra o que acabou nos últimos 90 dias; o mais antigo fica atrás de um botão (Recorrentes é só de consulta, sem Excluir)
  const limiteRecentes = somarDias(hoje, -DIAS_TERMINADAS_RECENTES)
  const terminadasRecentes = terminadas.filter((r) => (r.fim ?? '') >= limiteRecentes)
  const terminadasAntigas = terminadas.length - terminadasRecentes.length
  const terminadasVisiveis = verAntigas ? terminadas : terminadasRecentes
  // as naturezas do lado (do banco: recurrence_nature_summary); a legenda e a lista seguem a mesma ordem. Transferência não tem natureza.
  const tipoDoLado = lado === 'saidas' ? 'expense' : 'income'
  const naturezaDe = (r: Recorrencia): ChaveNatureza => r.nature ?? 'none'
  const totalNatureza = (n: ChaveNatureza) => porNatureza.find((l) => l.natureza === n && l.tipo === tipoDoLado)?.porMes ?? null
  // só aparecem as naturezas que têm recorrente vigente neste lado (a presença vem da lista; o dinheiro, do banco)
  const naturezasPresentes = NATUREZAS_DO_LADO[lado].filter((n) => vigentes.some((r) => doLado(r) && r.tipo !== 'transfer' && naturezaDe(r) === n))

  // conta: a próxima real do banco (já descontada a paga adiantada); cartão, ou sem a resposta do banco: a data da regra
  const proxima = (r: Recorrencia) => r.tipo !== 'card' && proximasReais ? (proximasReais.get(r.id) ?? null) : (proximasOcorrencias(r, hoje, 1)[0] ?? null)
  // dentro do grupo, do maior valor (de cada vez) para o menor; empate pelo nome. Não converte para o mês: isso é conta do banco.
  const maiorPrimeiro = (a: { r: Recorrencia }, b: { r: Recorrencia }) => b.r.valor - a.r.valor || a.r.descricao.localeCompare(b.r.descricao, 'pt-BR')
  // as abas Todos/Conta/Cartão filtram a lista (Cartão = assinaturas no cartão; Conta = despesas, receitas e transferências)
  const daAba = (r: Recorrencia) => aba === 'todos' || (aba === 'cartao') === (r.tipo === 'card')
  const grupos = naturezasPresentes
    .filter((n) => !filtrando || natureza === n)
    .map((n) => ({
      n,
      itens: vigentes.filter((r) => doLado(r) && r.tipo !== 'transfer' && naturezaDe(r) === n && daAba(r))
        .map((r) => ({ r, prox: proxima(r) })).sort(maiorPrimeiro),
    }))
    .filter((g) => g.itens.length > 0)
  const transferencias = lado === 'saidas' && !filtrando
    ? vigentes.filter((r) => r.tipo === 'transfer' && daAba(r)).map((r) => ({ r, prox: proxima(r) })).sort(maiorPrimeiro)
    : []
  const temItensNaLista = grupos.length > 0 || transferencias.length > 0

  const linha = (meio: LinhaResumoRecorrencia['meio'], tipo: LinhaResumoRecorrencia['tipo']) =>
    resumo.find((l) => l.nivel === 'medium' && l.meio === meio && l.tipo === tipo)

  function onde(r: Recorrencia) {
    if (r.tipo === 'card') {
      const nome = nomeCartao.get(r.cartaoId ?? '') ?? '?'
      // o grupo não diz mais se é cartão ou conta: a linha diz ("Cartão Nubank"), sem repetir quando o nome já começa assim
      return /^cart[aã]o\b/i.test(nome) ? nome : `Cartão ${nome}`
    }
    if (r.tipo === 'transfer') return `${nomeConta.get(r.contaId ?? '') ?? '?'} → ${nomeConta.get(r.destinoId ?? '') ?? '?'}`
    return nomeConta.get(r.contaId ?? '') ?? '?'
  }

  function item(r: Recorrencia, prox: string | null) {
    const caminho = r.categoriaId ? nomeCategoria.get(r.categoriaId) ?? 'Sem categoria' : null
    const curta = r.categoriaId ? nomeCurtoCategoria.get(r.categoriaId) ?? 'Sem categoria' : null
    const fimTexto = r.fim ? (r.fim < hoje ? `terminou em ${formatDate(r.fim)}` : `até ${formatDate(r.fim)}`) : null
    const completo = [rotuloFrequencia(r), onde(r), caminho, rotuloTipoRecorrencia[r.tipo],
      prox && `próxima ${formatDate(prox)}`, fimTexto].filter(Boolean).join(' · ')
    const moeda = r.tipo === 'card' ? 'BRL' : moedaConta.get(r.contaId ?? '') ?? 'BRL'
    const valorTexto = `${r.tipo === 'income' ? '+' : r.tipo === 'transfer' ? '⇄ ' : '−'}${formatMoeda(r.valor, moeda)}`
    const corpo = (
      <>
        <span className="flex items-baseline gap-2">
          {/* até 2 linhas (antes 1, com reticências): "Google One 100 GB" e "Google Drive 2 TB" só se distinguem no fim do nome */}
          <span className="line-clamp-2 min-w-0 flex-1 break-words font-medium" title={r.descricao}>{r.descricao}</span>
          {/* frequência num selo neutro só quando não é mensal (antes era a faixa "MENSAIS · 2" que incomodava o dono) */}
          {seloFrequencia(r) && (
            <span data-testid="selo-frequencia"
              className={`shrink-0 whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium ${SELO.neutro}`}>
              {seloFrequencia(r)}
            </span>
          )}
        </span>
        {/* relative: o texto sr-only (absolute) fica preso ao corte da linha; sem isso ele vazava e alargava a página no celular */}
        <span className="relative block truncate text-xs text-slate-500" title={completo} data-testid="meta-recorrente">
          {/* a próxima data abre a linha: no fim ela era a primeira a sumir nas reticências do celular (auditoria 5h) */}
          {/* selo verde com a palavra "próxima" (regra #183: verde = agendado, nunca sozinho) */}
          {prox && <><span data-testid="selo-proxima" className={`rounded px-1 py-0.5 font-medium ${SELO.planejado}`}>próxima {dataCurta(prox, hoje)}</span> · </>}
          {/* onde vem antes do "quando": o grupo não diz mais se é cartão ou conta, e o fim da linha é o primeiro a sumir no celular */}
          {onde(r)} · {quando(r)}
          {curta && <> · <span aria-hidden="true">{curta}</span><span className="sr-only">{caminho}</span></>}
          {fimTexto && <> · {fimTexto}</>}
        </span>
      </>
    )
    return (
      <li key={r.id} className="flex items-center gap-2 pl-4 pr-1 sm:pl-5">
        {/* ícone da categoria, o mesmo de Lançamentos (transferência: setas) */}
        <span className="shrink-0" aria-hidden="true">
          {r.tipo === 'transfer' ? <IconeCategoria fixo="transferencia" />
            : <IconeCategoria visual={visualPorId(r.categoriaId, categoriaPorId, r.tipo === 'income' ? 'income' : 'expense')} />}
        </span>
        {/* a linha é o botão da natureza (transferência não tem): toque para corrigir; o › leva ao lugar onde se muda o resto */}
        {r.tipo === 'transfer' ? (
          <div className="min-w-0 flex-1 py-2">{corpo}</div>
        ) : (
          <button type="button" onClick={() => setCorrigindo(r)} title="Corrigir a natureza"
            aria-label={`Natureza de ${r.descricao}: ${r.nature ? rotuloNatureza[r.nature] : 'sugerida pelo app'}. Corrigir`}
            className="-ml-2 min-w-0 flex-1 rounded-lg px-2 py-2 text-left hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-azul">
            {corpo}
          </button>
        )}
        {/* valor em cima e "Gerenciar" embaixo, numa coluna só: lado a lado eles comiam o nome no celular (prévia de 17/11) */}
        <span className="flex shrink-0 flex-col items-end py-1.5">
        <span className={`whitespace-nowrap text-right text-sm font-semibold tabular-nums ${corDoTipo(r.tipo === 'card' ? 'expense' : r.tipo)}`}>{valorTexto}</span>
        {/* o valor é o de cada vez (não convertido): fora do mensal, diz "por ano", "por semana"… */}
        {porVez(r) && <span className="whitespace-nowrap text-[11px] text-slate-500" data-testid="por-vez">{porVez(r)}</span>}
        {/* "Gerenciar" escrito (antes era só "›" e o dono não achou onde encerrar o Google Drive anual, 17/11/2026):
            assinatura de cartão → a fatura da próxima cobrança; conta → Lançamentos no mês da próxima ocorrência */}
        <Link to={r.tipo === 'card' && r.cartaoId ? (faturaDe.get(r.id) ? rotaFatura(r.cartaoId, faturaDe.get(r.id)!) : rotaCartao(r.cartaoId))
                  : prox ? `/lancamentos?mes=${prox.slice(0, 7)}` : '/lancamentos'}
          aria-label={`Gerenciar ${r.descricao} em ${r.tipo === 'card' ? 'Cartões' : 'Lançamentos'}`}
          title={r.tipo === 'card' ? 'Abre a fatura da próxima cobrança: ⋯ → Editar (valor ou dia) ou Cancelar cobrança (esta e as próximas)'
            : 'Abre Lançamentos no mês da próxima: ⋯ → Editar ou Parar de repetir a partir daqui'}
          className="-mr-1 inline-flex min-h-8 items-center gap-0.5 rounded-lg px-1 text-xs font-semibold text-azul hover:bg-azul-claro">
          Gerenciar<span aria-hidden="true" className="text-base leading-none">›</span>
        </Link>
        {/* "Natureza" escrito, embaixo do "Gerenciar" (lado a lado eles alargavam a coluna e cortavam o nome no celular): tocar
            no nome também abre a folha, mas o dono não achou (17/11/2026, Flora Energia), e o "Gerenciar" leva a Lançamentos,
            onde não há natureza. Transferência não tem natureza. */}
        {r.tipo !== 'transfer' && (
          <button type="button" onClick={() => setCorrigindo(r)} data-testid="botao-natureza"
            aria-label={`Mudar a natureza de ${r.descricao}`}
            className="-mr-1 inline-flex min-h-7 items-center rounded-lg px-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-azul">
            Natureza
          </button>
        )}
        </span>
      </li>
    )
  }

  /**
   * Um card por natureza (mesma ordem e nomes da legenda), com o total por mês do banco à direita, sem contador.
   * O total do banco junta conta e cartão: com a aba Conta ou Cartão ele não vale para o recorte e não aparece (a tela não soma).
   */
  function cartaoDoGrupo(g: (typeof grupos)[number]) {
    const total = aba === 'todos' ? totalNatureza(g.n) : null
    return (
      <Card key={g.n} semPadding>
        <section aria-labelledby={`grupo-${g.n}`} data-testid={`grupo-${g.n}`}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 px-4 py-3 sm:px-5">
            <h2 id={`grupo-${g.n}`} className="flex items-center gap-2 text-base font-semibold text-marinho">
              <span aria-hidden="true" className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: COR_NATUREZA[g.n] }} />
              {rotuloGrupoNatureza[g.n]}
            </h2>
            {total !== null && (
              <p className={`text-sm font-semibold tabular-nums ${corDoTipo(tipoDoLado)}`} data-testid={`total-grupo-${g.n}`}>
                {formatBRL(total)}/mês
              </p>
            )}
          </div>
          <ul className="divide-y divide-slate-100 border-t border-slate-100">{g.itens.map(({ r, prox }) => item(r, prox))}</ul>
        </section>
      </Card>
    )
  }

  function cartaoTransferencias() {
    // total do banco (nível medium da conta, só reais); com a aba Cartão não há transferência nenhuma
    const total = aba === 'todos' || aba === 'conta' ? linha('account', 'transfer') : undefined
    return (
      <Card key="transferencias" semPadding>
        <section aria-labelledby="grupo-transferencias" data-testid="grupo-transferencias">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 px-4 py-3 sm:px-5">
            <h2 id="grupo-transferencias" className="text-base font-semibold text-marinho">
              Transferências <span className="font-normal text-slate-500">· à parte, fora dos gastos</span>
            </h2>
            {total && (
              <p className={`text-sm font-semibold tabular-nums ${corDoTipo('transfer')}`} data-testid="total-transferencias">{formatBRL(total.porMes)}/mês</p>
            )}
          </div>
          <ul className="divide-y divide-slate-100 border-t border-slate-100">{transferencias.map(({ r, prox }) => item(r, prox))}</ul>
        </section>
      </Card>
    )
  }

  function cartaoProventos() {
    return (
      <Card semPadding key="proventos">
        <section aria-labelledby="card-proventos">
          <div className="px-4 py-3 sm:px-5">
            <h3 id="card-proventos" className="text-base font-semibold text-marinho">Proventos previstos</h3>
            <p className="text-xs text-slate-500">
              Investimentos · {proventos.length} ativo{proventos.length === 1 ? '' : 's'} · previsão dos próximos 12 meses: você digita o valor e nada vira pago sozinho. Fora do total "Vai entrar".
            </p>
          </div>
          {proventosAcabando.length > 0 && (
            <div role="status" data-testid="aviso-proventos-acabando"
              className={`mx-4 mb-3 rounded-lg px-3 py-2 text-sm sm:mx-5 ${SELO.atencao}`}>
              <strong>A previsão de {proventosAcabando.length} ativo{proventosAcabando.length === 1 ? '' : 's'} está acabando</strong> nos próximos 60 dias.
              A previsão cobre 12 meses por vez: para continuar, registre de novo com "Repetir" em{' '}
              <Link to="/investimentos" className="font-semibold underline">Investimentos</Link>.
            </div>
          )}
          <ul className="divide-y divide-slate-100 border-t border-slate-100" data-testid="proventos-previstos">
            {proventos.map((p) => {
              const fim = proventosAcabando.find((a) => a.ativoId === p.ativoId)
              return (
              <li key={p.ativoId} className="flex items-center gap-2 py-2 pl-4 pr-1 sm:pl-5">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium" title={p.nome}>{p.nome}</p>
                  <p className="truncate text-xs text-slate-500">
                    <span className="text-agendado">próximo {dataCurta(p.proximaData, hojeSP())}</span> · {formatBRL(p.proximoValor)} · {p.qtde} previsto{p.qtde === 1 ? '' : 's'} em 12 meses
                  </p>
                  {fim && (
                    <p className="mt-0.5" data-testid={`acabando-${p.ativoId}`}>
                      <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${SELO.atencao}`}>Previsão termina em {dataCurta(fim.ultimaData, hojeSP())}</span>
                    </p>
                  )}
                </div>
                <span className={`shrink-0 whitespace-nowrap text-right text-sm font-semibold tabular-nums ${corDoTipo('income')}`}>+{formatBRL(p.total12m)}</span>
                <Link to="/investimentos" aria-label={`Abrir ${p.nome} em Investimentos`} title="Ver em Investimentos (registrar ou repetir o provento)"
                  className="inline-flex min-h-11 min-w-9 shrink-0 items-center justify-center rounded-lg text-lg font-semibold text-azul hover:bg-azul-claro">
                  <span aria-hidden="true">›</span>
                </Link>
              </li>
              )
            })}
          </ul>
        </section>
      </Card>
    )
  }

  return (
    <>
      <CabecalhoPagina titulo="Recorrentes"
        descricao={<>
          O que se repete na conta e no cartão, só para consulta. Para cadastrar, use <strong>Repetir</strong> em{' '}
          <Link to="/lancamentos" className="font-semibold text-azul hover:underline">Lançamentos</Link>; para mudar o dia ou encerrar, o próprio
          lançamento ou a fatura do <Link to="/cartoes" className="font-semibold text-azul hover:underline">cartão</Link>.
          <Explicacao rotulo="Como funcionam os recorrentes">
            Repetem toda semana, a cada 14 dias, todo mês, a cada 2, 3 ou 6 meses, todo ano ou a cada N dias.
            Em conta, os próximos 12 meses aparecem como <strong>Planejado</strong> (ou, se houver data final, todas as parcelas até ela) em{' '}
            <Link to="/lancamentos" className="font-semibold text-azul hover:underline">Lançamentos</Link>: quando a conta chegar,
            corrija o valor e marque como pago. No cartão, a compra entra no dia, na fatura certa.
            Os totais do topo são o <strong>equivalente por mês</strong> e o <strong>total por ano</strong> (valor × vezes por ano, exato por recorrente): anual ÷ 12, a cada N meses ÷ N, semanal × 52 ÷ 12,
            a cada N dias × 365 ÷ 12 ÷ N, arredondado no centavo em cada recorrente. Só contam os recorrentes em reais e sem data final passada;
            transferências ficam à parte, fora dos gastos.
          </Explicacao>
        </>} />

      {erro && <div className="mb-4"><Aviso tipo="erro">{erro}</Aviso></div>}
      {blocosFalharam.length > 0 && !erro && (
        <div className="mb-4" data-testid="recorrentes-blocos-falharam">
          <Aviso tipo="erro">Não foi possível carregar: {blocosFalharam.join(', ')}. A tela pode estar incompleta ou com datas da regra em vez da cobrança real; recarregue a página para tentar de novo.</Aviso>
        </div>
      )}
      {corrigindo !== null && (
        <FolhaNatureza recorrencia={corrigindo} aoCancelar={() => setCorrigindo(null)}
          aoConcluir={async () => { setCorrigindo(null); await carregar() }} />
      )}

      {recorrencias === null && !erro && <p className="text-sm text-slate-600" role="status">Carregando…</p>}

      {recorrencias !== null && ativas.length === 0 && proventos.length === 0 && (
        <EmptyState
          titulo="Nenhum recorrente ainda"
          descricao="Aluguel, luz, salário, condomínio e assinaturas aparecem aqui quando você usa Repetir ao lançar (na conta ou no cartão)."
          acao={<Link to="/lancamentos" className="inline-flex min-h-11 items-center justify-center rounded-lg bg-azul px-4 text-sm font-semibold text-white hover:bg-blue-700">Ir para Lançamentos</Link>}
        />
      )}

      {(vigentes.length > 0 || proventos.length > 0) && (
        <ResumoDoMes
          visao={visao !== null && visao.length > 0 ? visao : null} sobra={sobra} depoisParcelas={depoisParcelas} lado={lado} aoMudarLado={mudarLado}
          naturezas={naturezasPresentes.map((n) => ({ chave: n, rotulo: rotuloGrupoNatureza[n], cor: COR_NATUREZA[n], porMes: totalNatureza(n) }))}
          escolhida={natureza}
          aoEscolher={(n) => setNatureza(n)}
          noCartao={lado === 'saidas' ? linha('card', 'expense')?.porMes ?? null : null}
          naConta={lado === 'saidas' ? linha('account', 'expense')?.porMes ?? null : null}
          parcelas={lado === 'saidas' ? parcelasMes : []}
          rodape={emOutraMoeda > 0 && (
            <p className="mt-2 text-xs text-slate-600">
              {emOutraMoeda === 1 ? '1 recorrente em outra moeda fica' : `${emOutraMoeda} recorrentes em outra moeda ficam`} fora dos totais (que são em reais).
            </p>
          )} />
      )}

      {(ativas.length > 0 || proventos.length > 0) && (
        <div id="painel-lista">
          {lado === 'saidas' && (
            <div role="group" aria-label="Mostrar recorrentes" className="mb-3 flex gap-2">
              {abas.map(([chave, rotulo]) => (
                <button key={chave} type="button" aria-pressed={aba === chave} onClick={() => setAba(chave)}
                  className={`min-h-11 rounded-full px-4 text-sm font-semibold transition-colors md:min-h-9 ${aba === chave
                    ? 'bg-azul text-white' : 'border border-slate-200 bg-white text-marinho hover:bg-azul-claro'}`}>
                  {rotulo}
                </button>
              ))}
            </div>
          )}
          {temItensNaLista && (
            <p className="mb-3 text-xs text-slate-500" data-testid="ajuda-gerenciar">
              Para mudar o valor ou o dia, ou encerrar, toque em <strong className="font-semibold text-azul">Gerenciar</strong>: no cartão
              abre a fatura da próxima cobrança (⋯ → Cancelar cobrança → esta e as próximas); na conta, Lançamentos no mês da
              próxima (⋯ → Parar de repetir a partir daqui). Para mudar de grupo (custo fixo, assinatura ou gasto variável),
              toque em <strong className="font-semibold text-slate-700">Natureza</strong>.
            </p>
          )}
          <div className="space-y-4">
            {!temItensNaLista && ativas.length > 0 && !(lado === 'entradas' && proventos.length > 0) && (
              <Card><p className="text-sm text-slate-600">Nenhum recorrente {lado === 'entradas' ? 'de entrada' : aba === 'cartao' ? 'no cartão' : 'em conta'}.</p></Card>
            )}
            {/* no computador os cards ficam lado a lado (a lista de uma coluna só deixava metade da tela em branco);
                os proventos previstos são uma ENTRADA prevista: ficam junto dos grupos de Entradas */}
            {(grupos.length > 0 || (lado === 'entradas' && proventos.length > 0 && !filtrando)) && (
              <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2" data-testid="grade-grupos">
                {grupos.map((g) => cartaoDoGrupo(g))}
                {lado === 'entradas' && proventos.length > 0 && !filtrando && cartaoProventos()}
              </div>
            )}
            {transferencias.length > 0 && cartaoTransferencias()}
            {terminadas.length > 0 && aba === 'todos' && !filtrando && (
              <Card semPadding>
                <section aria-labelledby="grupo-terminados">
                  <div className="px-4 py-3 sm:px-5">
                    <h2 id="grupo-terminados" className="text-base font-semibold text-marinho">
                      Já terminaram <span className="font-normal text-slate-500">· fora dos totais</span>
                    </h2>
                  </div>
                  {terminadasVisiveis.length > 0
                    ? <ul className="divide-y divide-slate-100 border-t border-slate-100">{terminadasVisiveis.map((r) => item(r, null))}</ul>
                    : <p className="border-t border-slate-100 px-4 py-3 text-sm text-slate-500 sm:px-5" data-testid="terminadas-vazio">Nenhum terminou nos últimos {DIAS_TERMINADAS_RECENTES} dias.</p>}
                  {terminadasAntigas > 0 && (
                    <div className="border-t border-slate-100 px-4 py-1 sm:px-5">
                      <button type="button" aria-expanded={verAntigas} onClick={() => setVerAntigas((v) => !v)} data-testid="terminadas-antigas"
                        className="min-h-11 text-sm font-semibold text-azul hover:underline">
                        {verAntigas
                          ? 'Esconder os mais antigos'
                          : terminadasAntigas === 1
                            ? `Mostrar 1 que terminou há mais de ${DIAS_TERMINADAS_RECENTES} dias`
                            : `Mostrar os ${terminadasAntigas} que terminaram há mais de ${DIAS_TERMINADAS_RECENTES} dias`}
                      </button>
                    </div>
                  )}
                </section>
              </Card>
            )}
          </div>
        </div>
      )}

    </>
  )
}



/**
 * Topo da página: "Todo mês, com o que se repete" (pedido do dono, 17/11/2026: "o que eu pago mensalmente, fixo e variável,
 * no cartão e na conta, e quanto entra"). Os dois números grandes (recurrence_overview, recorte 'all') são também o seletor
 * Saídas/Entradas (abas; as setas trocam). Embaixo, do lado ativo: a barra dividida pelas naturezas (recurrence_nature_summary;
 * cada parte cresce na proporção do seu valor, só desenho), a legenda que filtra a lista, "No cartão · Na conta"
 * (recurrence_summary, nível medium) e a linha das parcelas (installment_month_summary). A tela não soma dinheiro.
 */
function ResumoDoMes({ visao, sobra, depoisParcelas, lado, aoMudarLado, naturezas, escolhida, aoEscolher, noCartao, naConta, parcelas, rodape }: {
  visao: LinhaVisao[] | null
  /** Entra − sai por mês e por ano (do banco); null = sem a linha. */
  sobra: SobraRecorrentes | null
  /** A sobra deste mês depois das parcelas (do banco); só aparece quando há parcela no mês. */
  depoisParcelas: SobraDepoisDasParcelas | null
  lado: Lado
  aoMudarLado: (l: Lado) => void
  naturezas: { chave: ChaveNatureza; rotulo: string; cor: string; porMes: Cents | null }[]
  escolhida: FiltroNatureza
  aoEscolher: (n: FiltroNatureza) => void
  noCartao: Cents | null
  naConta: Cents | null
  /** "Parcelas e carnês" (uma linha por moeda): não é natureza nem entra no "Sai"; tocar leva a Compromissos › Parcelas. */
  parcelas: ResumoParcelasDoMes[]
  rodape?: ReactNode
}) {
  const achar = (tipo: LinhaVisao['tipo']) => visao?.find((l) => l.tipo === tipo && l.recorte === 'all')
  const aba = (chave: Lado, curto: string, rotulo: string, tipo: 'expense' | 'income') => {
    const ativo = lado === chave
    const l = achar(tipo)
    return (
      <button type="button" role="tab" id={`lado-${chave}`} aria-selected={ativo} tabIndex={ativo ? 0 : -1} onClick={() => aoMudarLado(chave)}
        className={`min-w-0 rounded-xl px-3 py-2 text-left transition-colors ${ativo
          ? (tipo === 'expense' ? 'bg-prejuizo-fundo ring-2 ring-inset ring-prejuizo' : 'bg-azul-claro ring-2 ring-inset ring-azul')
          : 'bg-slate-50 hover:bg-slate-100'}`}>
        <span className={`block text-sm font-semibold ${ativo ? corDoTipo(tipo) : 'text-slate-600'}`}>
          <span aria-hidden="true">{curto} ≈</span><span className="sr-only">{rotulo} por mês, aproximado:</span>
        </span>
        {l ? (
          <>
            {/* text-xl no celular: a 390 px os dois números lado a lado não cabem em text-2xl (medido na prévia) */}
            <span className={`block whitespace-nowrap text-xl font-bold tabular-nums sm:text-2xl ${corDoTipo(tipo)}`} data-testid={`visao-${chave}-mes`}>
              {formatBRL(l.porMes)}
            </span>
            <span className="block whitespace-nowrap text-xs text-slate-600 tabular-nums" data-testid={`visao-${chave}-ano`}>{formatBRL(l.porAno)} por ano</span>
          </>
        ) : <span className="mt-1 block text-sm text-slate-500">sem total ainda</span>}
      </button>
    )
  }
  const naBarra = naturezas.filter((n) => n.porMes !== null && n.porMes > 0)
  // com uma natureza só a legenda é informação, não filtro (filtrar daria a mesma lista)
  const filtra = naturezas.length > 1
  const linhaLegenda = (n: (typeof naturezas)[number]) => {
    const conteudo = (
      <>
        <span aria-hidden="true" className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: n.cor }} />
        <span className="min-w-0 flex-1 truncate text-slate-700">{n.rotulo}</span>
        <span className={`whitespace-nowrap font-semibold tabular-nums ${n.porMes === null ? 'text-slate-400' : 'text-marinho'}`}>
          {n.porMes === null ? '—' : <>{formatBRL(n.porMes)}<span className="text-xs font-normal text-slate-500">/mês</span></>}
        </span>
      </>
    )
    const ativo = escolhida === n.chave
    return (
      <li key={n.chave}>
        {filtra ? (
          <button type="button" aria-pressed={ativo} onClick={() => aoEscolher(ativo ? 'todas' : n.chave)} data-testid={`natureza-${n.chave}`}
            className={`flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left text-sm transition-colors md:min-h-9 ${ativo
              ? 'bg-azul-claro ring-1 ring-inset ring-azul' : 'hover:bg-slate-50'}`}>
            {conteudo}
          </button>
        ) : <div className="flex min-h-9 items-center gap-2 px-2 text-sm" data-testid={`natureza-${n.chave}`}>{conteudo}</div>}
      </li>
    )
  }
  return (
    <Card semPadding className="mb-4 p-4 sm:p-5">
      <section aria-labelledby="resumo-recorrentes" data-testid="resumo-do-mes">
        <h2 id="resumo-recorrentes" className="mb-2 text-sm font-semibold text-slate-600">Todo mês, com o que se repete</h2>
        <div role="tablist" aria-label="Saídas ou entradas" data-testid="visao-geral" className="grid grid-cols-2 gap-2"
          onKeyDown={(e) => {
            if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
            const novo: Lado = lado === 'saidas' ? 'entradas' : 'saidas'
            aoMudarLado(novo)
            document.getElementById(`lado-${novo}`)?.focus()
          }}>
          {aba('saidas', 'Sai', 'Saídas', 'expense')}
          {aba('entradas', 'Entra', 'Entradas', 'income')}
        </div>
        {sobra !== null && visao !== null && (
          // a diferença é do banco (recurrence_net); só aparece junto dos dois números que a explicam (se a visão geral falhou, some);
          // a cor e o sinal seguem o valor, sempre com a palavra "sobra" ou "falta" ao lado
          <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700" data-testid="sobra-recorrentes">
            <span className="font-semibold text-marinho">{sobra.porMes < 0 ? 'Falta' : 'Sobra'} ≈ </span>
            <strong className={`whitespace-nowrap tabular-nums ${corDoValor(sobra.porMes)}`} data-testid="sobra-mes">{formatBRL(sobra.porMes < 0 ? (-sobra.porMes as Cents) : sobra.porMes)}</strong>
            <span className="text-xs text-slate-600"> por mês · <span className="whitespace-nowrap"><span className="tabular-nums" data-testid="sobra-ano">{formatBRL(sobra.porAno < 0 ? (-sobra.porAno as Cents) : sobra.porAno)}</span> por ano</span></span>
            <span className="mt-0.5 block text-xs text-slate-500">Entra menos sai, só do que se repete: parcelas, proventos previstos e gastos avulsos ficam de fora.</span>
            {depoisParcelas !== null && depoisParcelas.parcelasMes > 0 && (
              // o dono pediu (17/11/2026) um segundo número com as parcelas; elas mudam de mês para mês, então é "deste mês".
              // A conta é do banco (recurrence_net_after_installments); aqui só se mostra, com o sinal tirado de um valor já pronto.
              <span className="mt-2 block border-t border-slate-200 pt-2" data-testid="sobra-depois-parcelas">
                <span className="font-semibold text-marinho">Este mês, depois das parcelas: {depoisParcelas.depois < 0 ? 'Falta' : 'Sobra'} ≈ </span>
                <strong className={`whitespace-nowrap tabular-nums ${corDoValor(depoisParcelas.depois)}`} data-testid="sobra-depois-valor">
                  {formatBRL(depoisParcelas.depois < 0 ? (-depoisParcelas.depois as Cents) : depoisParcelas.depois)}
                </strong>
                <span className="mt-0.5 block text-xs text-slate-500">
                  Desconta <span className="whitespace-nowrap tabular-nums" data-testid="sobra-parcelas-mes">{formatBRL(depoisParcelas.parcelasMes)}</span> em
                  parcelas de compras e carnês que vencem este mês (pagas ou não). Muda de mês para mês; empréstimos e financiamentos ficam de fora.
                </span>
              </span>
            )}
          </p>
        )}
        {naBarra.length > 0 && (
          // só desenho (a legenda diz os valores): cada parte cresce na proporção do seu valor, com 2 px entre elas
          <div aria-hidden="true" className="mt-4 flex h-3 w-full gap-[2px] overflow-hidden rounded-full" data-testid="barra-naturezas">
            {naBarra.map((n) => (
              <span key={n.chave} data-natureza={n.chave} className="h-full min-w-1"
                style={{ flexGrow: n.porMes ?? 0, flexBasis: 0, backgroundColor: n.cor }} />
            ))}
          </div>
        )}
        {naturezas.length > 0 && (
          <ul className="mt-2 space-y-0.5" {...(filtra ? { role: 'group', 'aria-label': 'Filtrar por natureza' } : {})}>
            {naturezas.map(linhaLegenda)}
          </ul>
        )}
        {(noCartao !== null || naConta !== null) && (
          <p className="mt-2 border-t border-slate-100 px-2 pt-2 text-sm text-slate-700 tabular-nums" data-testid="no-cartao-na-conta">
            {noCartao !== null && <span className="whitespace-nowrap">No cartão <strong className="font-semibold text-marinho">{formatBRL(noCartao)}</strong></span>}
            {noCartao !== null && naConta !== null && ' · '}
            {naConta !== null && <span className="whitespace-nowrap">Na conta <strong className="font-semibold text-marinho">{formatBRL(naConta)}</strong></span>}
          </p>
        )}
        {parcelas.map((c) => (
          <Link key={c.moeda} to="/compromissos?aba=parcelas" data-testid={`card-parcelas-${c.moeda}`}
            aria-label={`Parcelas e carnês${parcelas.length > 1 ? ` (${c.moeda})` : ''}: ${formatMoeda(c.totalMes, c.moeda)} por mês. Ver em Compromissos, Parcelas`}
            className="mt-2 flex min-h-11 w-full items-center gap-2 rounded-lg border-t border-slate-100 px-2 pt-2 text-left text-sm hover:bg-slate-50">
            <span className="min-w-0 flex-1">
              <span className="block text-slate-700">Parcelas e carnês{parcelas.length > 1 ? ` (${c.moeda})` : ''}</span>
              <span className="block break-words text-xs text-slate-500" data-testid={`parcelas-falta-${c.moeda}`}>
                fora do "Sai" · {c.comParcelaNoMes === 0 ? 'nenhuma parcela neste mês' : c.faltaMes > 0 ? `faltam ${formatMoeda(c.faltaMes, c.moeda)} neste mês` : 'tudo pago neste mês'}
              </span>
            </span>
            <span className={`whitespace-nowrap font-semibold tabular-nums ${corDoTipo('expense')}`}>
              {formatMoeda(c.totalMes, c.moeda)}<span className="text-xs font-normal">/mês</span>
            </span>
            <span aria-hidden="true" className="whitespace-nowrap text-xs font-semibold text-azul">Ver ›</span>
          </Link>
        ))}
        {lado === 'saidas' && (
          // a projeção dos próximos meses e as parcelas saíram de Recorrentes (17/11/2026): não são só o que se repete
          <p className="mt-2 text-xs text-slate-600" data-testid="link-compromissos">
            Quanto já está comprometido nos próximos meses (parcelas, financiamentos e o que se repete):{' '}
            <Link to="/compromissos" className="font-semibold text-azul hover:underline">ver Compromissos</Link>.
          </p>
        )}
        <p className="mt-3 text-xs text-slate-500" data-testid="nota-aproximado">
          ≈ por mês: anuais divididos por 12; variáveis pelo valor cadastrado (a conta de verdade pode mudar).
        </p>
        {rodape}
      </section>
    </Card>
  )
}
