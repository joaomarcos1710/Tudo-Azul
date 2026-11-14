import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
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
import type { Cents } from '../lib/format'
import {
  diaDaSemana, frequenciaResumo, listarRecorrencias, ordemFrequencias, proximasOcorrencias, resumoPorNatureza, resumoRecorrencias, resumoVisaoGeral,
  rotuloFrequencia, rotuloGrupoFrequencia, rotuloNatureza, rotuloTipoRecorrencia,
} from '../lib/recorrencias'
import type { FrequenciaResumo, LinhaNatureza, LinhaVisao, LinhaResumoRecorrencia, NaturezaRecorrencia, Recorrencia, TipoRecorrencia } from '../lib/recorrencias'
import { CabecalhoPagina } from '../components/ui/CabecalhoPagina'
import { corDoTipo, SELO } from '../lib/cores'
import { ProjecaoCompromissos } from '../components/ui/ProjecaoCompromissos'
import { ParcelasAtivas } from '../components/recorrentes/ParcelasAtivas'
import { resumoParcelasDoMes } from '../lib/parcelasAtivas'
import type { ResumoParcelasDoMes } from '../lib/parcelasAtivas'
import { FolhaNatureza } from '../components/recorrentes/FolhaNatureza'

const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

/** As três seções da página (abas de cima): a lista de recorrentes, a projeção dos próximos meses e as parcelas em andamento. */
/** As duas visões da página: o que sai e o que entra (pedido do dono, 14/11/2026). Vai na URL (?v=entradas) para dar para linkar. */
type Lado = 'saidas' | 'entradas'
type Secao = 'lista' | 'projecao' | 'parcelas'
const SECOES: [Secao, string][] = [['lista', 'Recorrentes'], ['projecao', 'Projeção'], ['parcelas', 'Parcelas']]

/** Blocos da lista, na ordem. Os proventos previstos (investimentos) são uma ENTRADA prevista: ficam ao lado das receitas. */
const SECOES_LISTA: { titulo: string | null; tipos: TipoRecorrencia[]; proventos?: boolean }[] = [
  { titulo: null, tipos: ['card', 'expense'] },
  { titulo: null, tipos: ['income'], proventos: true },
  { titulo: 'Transferências · à parte, fora dos gastos', tipos: ['transfer'] },
]
const rotuloCartaoNatureza: Record<FiltroNatureza, string> = {
  todas: 'Todas', fixed: 'Custos fixos', subscription: 'Assinaturas & apps', variable: 'Gastos variáveis', reimbursement: 'A ressarcir', none: 'Sem natureza',
}
const rotuloNaturezaCurto: Record<NaturezaRecorrencia, string> = { fixed: 'Fixo', subscription: 'Assinatura', variable: 'Variável', reimbursement: 'Ressarcimento' }

type Aba = 'todos' | 'conta' | 'cartao'
const abas: [Aba, string][] = [['todos', 'Todos'], ['conta', 'Conta'], ['cartao', 'Cartão']]
/** Filtro por natureza (3ª PR de Recorrentes): 'todas' não filtra; 'none' = sem natureza. Transferência não tem natureza: sai quando há filtro. */
type FiltroNatureza = 'todas' | NaturezaRecorrencia | 'none'
const rotuloFiltroNatureza = (n: FiltroNatureza) => n === 'todas' ? 'Todas' : n === 'none' ? 'Sem natureza' : rotuloNatureza[n]
type TipoResumo = LinhaResumoRecorrencia['tipo']
const rotuloTipoResumo: Record<TipoResumo, string> = { expense: 'saídas', income: 'entradas', transfer: 'transferências' }
/**
 * Um card por tipo de recorrente (pedido do dono, #189). `meio` e `tipoResumo` apontam para as linhas de
 * public.recurrence_summary (migration 063): o total do título é o nível 'medium' e o de cada frequência, o 'frequency'.
 */
const cardsPorTipo: { tipo: TipoRecorrencia; titulo: string; meio: 'card' | 'account'; tipoResumo: TipoResumo }[] = [
  { tipo: 'card', titulo: 'Assinaturas no cartão', meio: 'card', tipoResumo: 'expense' },
  { tipo: 'expense', titulo: 'Contas fixas', meio: 'account', tipoResumo: 'expense' },
  { tipo: 'income', titulo: 'Receitas', meio: 'account', tipoResumo: 'income' },
  { tipo: 'transfer', titulo: 'Transferências', meio: 'account', tipoResumo: 'transfer' },
]

/** Quando acontece, curto (o cabeçalho do grupo já diz a frequência): "dia 10", "20 de fev", "sexta", "a cada 10 dias". */
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

export default function Recorrentes() {
  const { familia } = useFamilia()
  const familiaId = familia?.id
  const [recorrencias, setRecorrencias] = useState<Recorrencia[] | null>(null)
  const [resumo, setResumo] = useState<LinhaResumoRecorrencia[]>([])
  const [contas, setContas] = useState<Conta[]>([])
  const [cartoes, setCartoes] = useState<Cartao[]>([])
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [erro, setErro] = useState('')
  const [aba, setAba] = useState<Aba>('todos')
  const [secao, setSecao] = useState<Secao>('lista')
  const [params, setParams] = useSearchParams()
  const lado: Lado = params.get('v') === 'entradas' ? 'entradas' : 'saidas'
  function mudarLado(novo: Lado) {
    setParams(novo === 'saidas' ? {} : { v: 'entradas' }, { replace: true })
    setNatureza('todas')
    setAba('todos')
    setSecao('lista')
  }
  // corrigir a natureza (a única edição que esta página aceita: só classifica)
  const [corrigindo, setCorrigindo] = useState<Recorrencia | null>(null)
  const [natureza, setNatureza] = useState<FiltroNatureza>('todas')
  const [porNatureza, setPorNatureza] = useState<LinhaNatureza[]>([])
  // visão por mês e por ano (migration 116): null = banco ainda sem a função (a tela mostra o resumo de antes)
  const [visao, setVisao] = useState<LinhaVisao[] | null>(null)
  // proventos de investimento previstos (planejados) de hoje a 12 meses: só informação, fora do total "Vai entrar" (migration 117)
  const [proventos, setProventos] = useState<ProventoPrevisto[]>([])
  // ativos cuja previsão de proventos acaba em até 60 dias (migration 122): só um aviso, opcional (banco sem a função ou falha: some)
  const [proventosAcabando, setProventosAcabando] = useState<ProventoAcabando[]>([])
  // assinatura → mês da fatura da próxima cobrança, para o link "Abrir" cair direto onde se muda o dia (sem o mapa, abre o cartão)
  const [faturaDe, setFaturaDe] = useState<Map<string, string>>(new Map())
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
      // banco sem a migration (ou falha só aqui): o resumo por natureza some, o resto da tela segue
      void resumoPorNatureza(familiaId).then(setPorNatureza).catch(() => setPorNatureza([]))
      void resumoVisaoGeral(familiaId).then(setVisao).catch(() => setVisao(null))
      void listarProventosPrevistos(familiaId).then(setProventos).catch(() => setProventos([]))
      void listarProventosAcabando(familiaId, 60).then(setProventosAcabando).catch(() => setProventosAcabando([]))
      void resumoParcelasDoMes(familiaId).then(setParcelasMes).catch(() => setParcelasMes([]))
      void faturaDaProximaCobranca(r.filter((x) => x.tipo === 'card' && x.ativa).map((x) => x.id)).then(setFaturaDe).catch(() => setFaturaDe(new Map()))
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

  if (!familiaId) return null
  const hoje = hojeSP()
  const ativas = recorrencias?.filter((r) => r.ativa) ?? []
  // mesma base do banco (migration 063): data final passada fica fora dos grupos e dos totais, mas continua à mão para excluir
  const vigentes = ativas.filter((r) => !r.fim || r.fim >= hoje)
  const terminadasTodas = ativas.filter((r) => r.fim && r.fim < hoje)
  const emOutraMoeda = vigentes.filter((r) => r.tipo !== 'card' && (moedaConta.get(r.contaId ?? '') ?? 'BRL') !== 'BRL').length

  // filtro por natureza: a contagem é da lista (não é dinheiro); os totais vêm de recurrence_nature_summary
  const filtrando = natureza !== 'todas'
  const daNatureza = (r: Recorrencia) => !filtrando || (r.tipo !== 'transfer' && (r.nature ?? 'none') === natureza)
  // cada visão só vê o que é dela: saídas = cartão, despesa e transferência (à parte); entradas = receita
  const doLado = (r: Recorrencia) => (lado === 'saidas') === (r.tipo !== 'income')
  const terminadas = terminadasTodas.filter(doLado)
  const temNatureza = vigentes.some((r) => doLado(r) && r.tipo !== 'transfer' && r.nature)
  // cards por natureza (do banco: recurrence_nature_summary); tocar filtra a lista
  const tipoDoLado = lado === 'saidas' ? 'expense' : 'income'
  const itensNatureza = (lado === 'saidas' ? ['fixed', 'subscription', 'variable', 'none'] as const : ['reimbursement', 'none'] as const).map((n) => {
    const doGrupo = vigentes.filter((r) => doLado(r) && r.tipo !== 'transfer' && (r.nature ?? 'none') === n)
    return {
      chave: n as FiltroNatureza, rotulo: rotuloCartaoNatureza[n], qtde: doGrupo.length, tipo: tipoDoLado as 'expense' | 'income',
      porMes: porNatureza.find((l) => l.natureza === n && l.tipo === tipoDoLado)?.porMes ?? null,
      exemplos: [...doGrupo].sort((a, b) => b.valor - a.valor).slice(0, 3).map((r) => r.descricao),
    }
  }).filter((c) => c.qtde > 0)
  const linhasDaNatureza = filtrando ? porNatureza.filter((l) => l.natureza === natureza) : []

  const proxima = (r: Recorrencia) => proximasOcorrencias(r, hoje, 1)[0] ?? null
  const proximaPrimeiro = (a: { r: Recorrencia; prox: string | null }, b: { r: Recorrencia; prox: string | null }) =>
    (a.prox ?? '9999').localeCompare(b.prox ?? '9999') || a.r.descricao.localeCompare(b.r.descricao, 'pt-BR')
  // as abas filtram quais cards aparecem: Cartão = assinaturas; Conta = contas fixas, receitas e transferências
  const cards = cardsPorTipo
    .filter((t) => (lado === 'saidas') === (t.tipo !== 'income'))
    .filter((t) => aba === 'todos' || (aba === 'cartao') === (t.tipo === 'card'))
    .map((t) => {
      const doTipo = vigentes.filter((r) => r.tipo === t.tipo && daNatureza(r))
      const grupos = ordemFrequencias
        .map((f) => ({ f, itens: doTipo.filter((r) => frequenciaResumo(r) === f).map((r) => ({ r, prox: proxima(r) })).sort(proximaPrimeiro) }))
        .filter((g) => g.itens.length > 0)
      return { ...t, qtde: doTipo.length, grupos }
    })
    .filter((t) => t.qtde > 0)

  const linha = (nivel: LinhaResumoRecorrencia['nivel'], meio: LinhaResumoRecorrencia['meio'], tipo: TipoResumo, f?: FrequenciaResumo) =>
    resumo.find((l) => l.nivel === nivel && l.meio === meio && l.tipo === tipo && (f === undefined || l.frequencia === f))

  function onde(r: Recorrencia) {
    if (r.tipo === 'card') return nomeCartao.get(r.cartaoId ?? '') ?? '?'
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
          <span className="min-w-0 flex-1 truncate font-medium" title={r.descricao}>{r.descricao}</span>
          {r.nature && (
            <span data-testid="selo-natureza" title={rotuloNatureza[r.nature]}
              className={`shrink-0 whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium ${SELO.neutro}`}>
              {rotuloNaturezaCurto[r.nature]}
            </span>
          )}
        </span>
        {/* relative: o texto sr-only (absolute) fica preso ao corte da linha; sem isso ele vazava e alargava a página no celular */}
        <span className="relative block truncate text-xs text-slate-500" title={completo} data-testid="meta-recorrente">
          {/* a próxima data abre a linha: no fim ela era a primeira a sumir nas reticências do celular (auditoria 5h) */}
          {prox && <><span className="text-agendado">próxima {dataCurta(prox, hoje)}</span> · </>}
          {quando(r)} · {onde(r)}
          {curta && <> · <span aria-hidden="true">{curta}</span><span className="sr-only">{caminho}</span></>}
          {fimTexto && <> · {fimTexto}</>}
        </span>
      </>
    )
    return (
      <li key={r.id} className="flex items-center gap-2 pl-4 pr-1 sm:pl-5">
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
        <span className={`shrink-0 whitespace-nowrap text-right text-sm font-semibold tabular-nums ${corDoTipo(r.tipo === 'card' ? 'expense' : r.tipo)}`}>{valorTexto}</span>
        <Link to={r.tipo === 'card' && r.cartaoId ? (faturaDe.get(r.id) ? rotaFatura(r.cartaoId, faturaDe.get(r.id)!) : rotaCartao(r.cartaoId)) : '/lancamentos'}
          aria-label={`Abrir ${r.descricao} em ${r.tipo === 'card' ? 'Cartões' : 'Lançamentos'}`}
          title={r.tipo === 'card' ? 'Ver a fatura da próxima cobrança (mudar o dia ou encerrar: ⋯ → Editar)' : 'Ver em Lançamentos (editar ou parar de repetir)'}
          className="inline-flex min-h-11 min-w-9 shrink-0 items-center justify-center rounded-lg text-lg font-semibold text-azul hover:bg-azul-claro">
          <span aria-hidden="true">›</span>
        </Link>
      </li>
    )
  }

  /** Total de um recorte com os números do banco: mensal só "R$ X/mês"; os demais "R$ 300,00 por vez · ≈ R$ 99,99/mês". */
  function total(l: LinhaResumoRecorrencia, f?: FrequenciaResumo) {
    return f === undefined || f === 'monthly'
      ? `${formatBRL(l.porMes)}/mês`
      : `${formatBRL(l.porOcorrencia)} por vez · ≈ ${formatBRL(l.porMes)}/mês`
  }

  const porAlvo = resumo.filter((l) => l.nivel === 'target')

  function cartaoDoTipo(t: (typeof cards)[number]) {
    // total do banco (só reais); sem linha (ex.: todos em outra moeda) a tela mostra só a contagem, nunca soma
    const doTipo = filtrando ? undefined : linha('medium', t.meio, t.tipoResumo)
    return (
      <Card key={t.tipo} semPadding>
        <section aria-labelledby={`card-${t.tipo}`}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 px-4 py-3 sm:px-5">
            <h2 id={`card-${t.tipo}`} className="text-base font-semibold text-marinho">
              {t.titulo} <span className="font-normal text-slate-500">· {t.qtde}</span>
            </h2>
            {doTipo && (
              <p className={`text-sm font-semibold tabular-nums ${corDoTipo(t.tipoResumo)}`} data-testid={`total-${t.tipo}`}>
                {total(doTipo)}
              </p>
            )}
          </div>
          {t.grupos.map((g) => {
            const daFrequencia = filtrando ? undefined : linha('frequency', t.meio, t.tipoResumo, g.f)
            return (
              // o nome do card no rótulo: "Mensais" aparece em mais de um card e duas regiões com o mesmo nome confundem o leitor de tela
              <section key={g.f} aria-label={`${rotuloGrupoFrequencia[g.f]} · ${g.itens.length} · ${t.titulo}`} className="border-t border-slate-100">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 bg-slate-50 px-4 py-1.5 sm:px-5">
                  <h3 id={`grupo-${t.tipo}-${g.f}`} className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                    {rotuloGrupoFrequencia[g.f]} <span className="font-normal normal-case text-slate-500">· {g.itens.length}</span>
                  </h3>
                  {daFrequencia && <p className="text-xs text-slate-600 tabular-nums">{total(daFrequencia, g.f)}</p>}
                </div>
                <ul className="divide-y divide-slate-100">{g.itens.map(({ r, prox }) => item(r, prox))}</ul>
              </section>
            )
          })}
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
        <section aria-labelledby="resumo-recorrentes">
          <h2 id="resumo-recorrentes" className="sr-only">Saídas e entradas por mês</h2>
          {visao !== null && visao.length > 0
            ? <SeletorLado linhas={visao} lado={lado} aoMudar={mudarLado} />
            : <SeletorLado linhas={null} lado={lado} aoMudar={mudarLado} />}
          {lado === 'saidas' && visao !== null && visao.length > 0 && <FixoVariavel linhas={visao} />}
          {emOutraMoeda > 0 && (
            <p className="mb-3 text-xs text-slate-600">
              {emOutraMoeda === 1 ? '1 recorrente em outra moeda fica' : `${emOutraMoeda} recorrentes em outra moeda ficam`} fora dos totais (que são em reais).
            </p>
          )}
          {lado === 'saidas' && porAlvo.length > 0 && (
            <details className="mb-4 rounded-xl border border-slate-200 bg-white text-sm">
              <summary className="flex min-h-11 cursor-pointer items-center px-4 font-semibold text-azul">Por cartão e por conta</summary>
              <ul className="divide-y divide-slate-100 border-t border-slate-100">
                {porAlvo.filter((l) => l.tipo !== 'income').map((l) => (
                  <li key={`${l.meio}-${l.alvoId}-${l.tipo}`} className="flex items-baseline gap-3 px-4 py-2">
                    <span className="min-w-0 flex-1 truncate">
                      {l.alvoNome} <span className="text-slate-500">· {l.meio === 'card' ? 'cartão' : rotuloTipoResumo[l.tipo]} · {l.qtde}</span>
                    </span>
                    <span className="shrink-0 whitespace-nowrap text-right tabular-nums">
                      <strong>{formatBRL(l.porMes)}</strong>/mês
                      <span className="block text-xs text-slate-500">{formatBRL(l.porOcorrencia)} por vez</span>
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}

      {recorrencias !== null && lado === 'saidas' && (
        <div role="tablist" aria-label="Seções de Recorrentes" className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200"
          onKeyDown={(e) => {
            // setas movem entre as abas (padrão de abas): a aba nova recebe o foco e abre
            if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
            const i = SECOES.findIndex(([chave]) => chave === secao)
            const novo = SECOES[(i + (e.key === 'ArrowRight' ? 1 : SECOES.length - 1)) % SECOES.length][0]
            setSecao(novo)
            document.getElementById(`aba-${novo}`)?.focus()
          }}>
          {SECOES.map(([chave, rotulo]) => (
            <button key={chave} id={`aba-${chave}`} type="button" role="tab" aria-selected={secao === chave} aria-controls={`painel-${chave}`}
              tabIndex={secao === chave ? 0 : -1} onClick={() => setSecao(chave)}
              className={`min-h-11 shrink-0 whitespace-nowrap border-b-2 px-4 text-sm font-semibold transition-colors ${secao === chave
                ? 'border-azul text-azul' : 'border-transparent text-slate-600 hover:text-marinho'}`}>
              {rotulo}
            </button>
          ))}
        </div>
      )}

      {(lado === 'entradas' || secao === 'lista') && (ativas.length > 0 || proventos.length > 0) && (
        <div role="tabpanel" id="painel-lista" aria-labelledby="aba-lista">
          {((temNatureza && itensNatureza.length > 0) || (lado === 'saidas' && parcelasMes.length > 0)) && (
            <CartoesNatureza itens={temNatureza ? itensNatureza : []} escolhida={natureza} aoEscolher={setNatureza}
              parcelas={lado === 'saidas' ? parcelasMes : []} aoAbrirParcelas={() => setSecao('parcelas')} />
          )}
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
          {filtrando && (
            <p className="mb-3 text-sm text-slate-700" data-testid="total-natureza">
              <strong>{rotuloFiltroNatureza(natureza)}</strong>
              {linhasDaNatureza.length === 0
                ? ' · sem total em reais (recorrentes em outra moeda ficam fora)'
                : linhasDaNatureza.map((l) => (
                    <span key={l.tipo}> · <span className={`font-semibold tabular-nums ${corDoTipo(l.tipo)}`}>{formatBRL(l.porMes)}/mês</span>{' '}
                      em {l.tipo === 'income' ? 'entradas' : 'saídas'} ({l.qtde})</span>
                  ))}
            </p>
          )}
          <div className="space-y-4">
            {cards.length === 0 && ativas.length > 0 && !(lado === 'entradas' && proventos.length > 0) && (
              <Card><p className="text-sm text-slate-600">Nenhum recorrente {lado === 'entradas' ? 'de entrada' : aba === 'cartao' ? 'no cartão' : 'em conta'}.</p></Card>
            )}
            {SECOES_LISTA.filter((sec) => (lado === 'saidas') === !sec.tipos.includes('income')).map((sec) => {
              const doGrupo = cards.filter((t) => sec.tipos.includes(t.tipo))
              const comProventos = sec.proventos && proventos.length > 0 && aba === 'todos' && !filtrando
              if (doGrupo.length === 0 && !comProventos) return null
              return (
                <Fragment key={sec.titulo ?? sec.tipos.join('-')}>
                  {sec.titulo && <h2 className="pt-2 text-lg font-bold text-marinho">{sec.titulo}</h2>}
                  {/* no computador os cards ficam lado a lado (a lista de uma coluna só deixava metade da tela em branco) */}
                  <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
                    {doGrupo.map((t) => cartaoDoTipo(t))}
                    {comProventos && cartaoProventos()}
                  </div>
                </Fragment>
              )
            })}
            {terminadas.length > 0 && aba === 'todos' && !filtrando && (
              <Card semPadding>
                <section aria-labelledby="grupo-terminados">
                  <div className="px-4 py-3 sm:px-5">
                    <h2 id="grupo-terminados" className="text-base font-semibold text-marinho">
                      Já terminaram <span className="font-normal text-slate-500">· fora dos totais</span>
                    </h2>
                  </div>
                  <ul className="divide-y divide-slate-100 border-t border-slate-100">{terminadas.map((r) => item(r, null))}</ul>
                </section>
              </Card>
            )}
          </div>
        </div>
      )}

      {/* a projeção e as parcelas só carregam quando a aba é aberta (menos consulta ao banco ao abrir a página) */}
      {lado === 'saidas' && secao === 'projecao' && recorrencias !== null && (
        <div role="tabpanel" id="painel-projecao" aria-labelledby="aba-projecao">
          <ProjecaoCompromissos familiaId={familiaId} hoje={hojeSP()} />
        </div>
      )}
      {lado === 'saidas' && secao === 'parcelas' && recorrencias !== null && (
        <div role="tabpanel" id="painel-parcelas" aria-labelledby="aba-parcelas">
          <ParcelasAtivas familiaId={familiaId} />
        </div>
      )}
    </>
  )
}


/**
 * Topo da página: duas visões, **Saídas** e **Entradas**, cada uma com o total por mês e por ano do banco (recurrence_overview).
 * É o seletor da página (pedido do dono, 14/11/2026: "páginas diferentes para entradas e saídas"). A tela não soma nada.
 */
function SeletorLado({ linhas, lado, aoMudar }: { linhas: LinhaVisao[] | null; lado: Lado; aoMudar: (l: Lado) => void }) {
  const achar = (tipo: LinhaVisao['tipo']) => linhas?.find((l) => l.tipo === tipo && l.recorte === 'all')
  const botao = (chave: Lado, titulo: string, l: LinhaVisao | undefined, tipo: 'expense' | 'income', setaSobe: boolean) => {
    const ativo = lado === chave
    return (
      <button type="button" role="tab" id={`lado-${chave}`} aria-selected={ativo} onClick={() => aoMudar(chave)}
        className={`min-w-0 rounded-xl border px-4 py-3 text-left transition-colors ${ativo
          ? (tipo === 'expense' ? 'border-prejuizo bg-prejuizo-fundo' : 'border-azul bg-azul-claro') : 'border-slate-200 bg-white hover:bg-slate-50'}`}>
        <span className={`flex items-center gap-2 text-sm font-semibold ${ativo ? corDoTipo(tipo) : 'text-slate-600'}`}>
          <span aria-hidden="true">{setaSobe ? '↗' : '↘'}</span>{titulo}
        </span>
        {l ? (
          <>
            <span className={`mt-1 block whitespace-nowrap text-lg font-bold tabular-nums sm:text-2xl ${corDoTipo(tipo)}`} data-testid={`visao-${chave}-mes`}>
              {formatBRL(l.porMes)}<span className="text-sm font-semibold">/mês</span>
            </span>
            <span className="block text-xs text-slate-600 tabular-nums sm:text-sm" data-testid={`visao-${chave}-ano`}>
              {formatBRL(l.porAno)} por ano · {l.qtde} recorrente{l.qtde === 1 ? '' : 's'}
            </span>
          </>
        ) : <span className="mt-1 block text-sm text-slate-500">sem total ainda</span>}
      </button>
    )
  }
  return (
    <div role="tablist" aria-label="Saídas ou entradas" data-testid="visao-geral" className="mb-4 grid grid-cols-2 gap-2 sm:gap-3"
      onKeyDown={(e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
        const novo: Lado = lado === 'saidas' ? 'entradas' : 'saidas'
        aoMudar(novo)
        document.getElementById(`lado-${novo}`)?.focus()
      }}>
      {botao('saidas', 'Saídas', achar('expense'), 'expense', false)}
      {botao('entradas', 'Entradas', achar('income'), 'income', true)}
    </div>
  )
}

/** Fixo × variável das saídas (o app sugere pelo histórico; a natureza marcada vale mais). Números do banco. */
function FixoVariavel({ linhas }: { linhas: LinhaVisao[] }) {
  const achar = (recorte: LinhaVisao['recorte']) => linhas.find((l) => l.tipo === 'expense' && l.recorte === recorte)
  const fixo = achar('fixed')
  const variavel = achar('variable')
  if (!fixo && !variavel) return null
  const parte = (rotulo: string, l: LinhaVisao | undefined) => l && (
    <li className="flex flex-wrap items-baseline justify-between gap-x-3" data-testid={`visao-${rotulo.toLowerCase()}`}>
      <span className="text-slate-700">
        {rotulo} <span className="text-slate-500">· {l.qtde}{l.sugeridas > 0 && <> · {l.sugeridas === l.qtde ? 'sugerido' : `${l.sugeridas} sugerido${l.sugeridas === 1 ? '' : 's'}`}</>}</span>
      </span>
      <span className="whitespace-nowrap tabular-nums">
        <strong>{formatBRL(l.porMes)}</strong>/mês <span className="text-slate-500">· {formatBRL(l.porAno)}/ano</span>
      </span>
    </li>
  )
  return (
    <Card semPadding className="mb-4 p-4">
      <ul className="space-y-1 text-sm">{parte('Fixo', fixo)}{parte('Variável', variavel)}</ul>
      {(fixo?.sugeridas ?? 0) + (variavel?.sugeridas ?? 0) > 0 && (
        <p className="mt-2 text-xs text-slate-500">
          "Sugerido": o app decidiu pelo histórico (valor sempre igual = fixo; valores diferentes = variável). A natureza que você marcou vale mais.
        </p>
      )}
    </Card>
  )
}

/**
 * Cards por natureza, como na referência do dono: cada um mostra o total por mês (do banco), quantos são e exemplos; tocar filtra a
 * lista, tocar de novo limpa. Só aparece quando há natureza marcada (sem nenhuma, seria um card só).
 */
function CartoesNatureza({ itens, escolhida, aoEscolher, parcelas = [], aoAbrirParcelas }: {
  itens: { chave: FiltroNatureza; rotulo: string; qtde: number; porMes: Cents | null; exemplos: string[]; tipo: 'expense' | 'income' }[]
  escolhida: FiltroNatureza
  aoEscolher: (n: FiltroNatureza) => void
  /** Card "Parcelas e carnês" (um por moeda): não é natureza, então não filtra; tocar abre a aba Parcelas. */
  parcelas?: ResumoParcelasDoMes[]
  aoAbrirParcelas?: () => void
}) {
  return (
    <div role="group" aria-label="Filtrar por natureza" className="mb-4 grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4" data-testid="cartoes-natureza">
      {itens.map((c) => {
        const ativo = escolhida === c.chave
        return (
          <button key={c.chave} type="button" aria-pressed={ativo} onClick={() => aoEscolher(ativo ? 'todas' : c.chave)} data-testid={`natureza-${c.chave}`}
            className={`min-w-0 rounded-xl border px-3 py-3 text-left transition-colors ${ativo ? 'border-azul bg-azul-claro' : 'border-slate-200 bg-white hover:bg-slate-50'}`}>
            <span className={`block text-[11px] font-semibold uppercase tracking-wide ${ativo ? 'text-azul' : 'text-slate-500'}`}>{c.rotulo} <span className="font-normal normal-case">· {c.qtde}</span></span>
            <span className={`mt-1 block whitespace-nowrap text-lg font-bold tabular-nums ${c.porMes === null ? 'text-slate-400' : corDoTipo(c.tipo)}`}>
              {c.porMes === null ? '—' : <>{formatBRL(c.porMes)}<span className="text-xs font-semibold">/mês</span></>}
            </span>
            <span className="block truncate text-xs text-slate-500">{c.exemplos.join(', ') || ' '}</span>
          </button>
        )
      })}
      {parcelas.map((c) => (
        <button key={c.moeda} type="button" onClick={aoAbrirParcelas} data-testid={`card-parcelas-${c.moeda}`}
          aria-label={`Parcelas e carnês${parcelas.length > 1 ? ` (${c.moeda})` : ''}: ${c.ativos} em andamento. Abrir a aba Parcelas`}
          className="min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-3 text-left transition-colors hover:bg-slate-50">
          <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Parcelas &amp; carnês{parcelas.length > 1 ? ` (${c.moeda})` : ''} <span className="font-normal normal-case">· {c.ativos}</span>
          </span>
          <span className={`mt-1 block whitespace-nowrap text-lg font-bold tabular-nums ${corDoTipo('expense')}`}>
            {formatMoeda(c.totalMes, c.moeda)}<span className="text-xs font-semibold">/mês</span>
          </span>
          <span className="block truncate text-xs text-slate-500" data-testid={`parcelas-falta-${c.moeda}`}>
            {c.comParcelaNoMes === 0 ? 'Nenhuma parcela neste mês' : c.faltaMes > 0 ? `Faltam ${formatMoeda(c.faltaMes, c.moeda)} neste mês` : 'Tudo pago neste mês'}
          </span>
          <span className="block truncate text-xs text-slate-400">{c.exemplos.join(', ') || ' '}</span>
        </button>
      ))}
    </div>
  )
}
