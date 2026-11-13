import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Aviso } from '../components/ui/Aviso'
import { Card } from '../components/ui/Card'
import { EmptyState } from '../components/ui/EmptyState'
import { useFamilia } from '../lib/FamiliaContext'
import { listarCartoes, rotaCartao } from '../lib/cartoes'
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

const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

type Aba = 'todos' | 'conta' | 'cartao'
const abas: [Aba, string][] = [['todos', 'Todos'], ['conta', 'Conta'], ['cartao', 'Cartão']]
/** Filtro por natureza (3ª PR de Recorrentes): 'todas' não filtra; 'none' = sem natureza. Transferência não tem natureza: sai quando há filtro. */
type FiltroNatureza = 'todas' | NaturezaRecorrencia | 'none'
const ordemNaturezas: NaturezaRecorrencia[] = ['fixed', 'subscription', 'variable', 'reimbursement']
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
  const [natureza, setNatureza] = useState<FiltroNatureza>('todas')
  const [porNatureza, setPorNatureza] = useState<LinhaNatureza[]>([])
  // visão por mês e por ano (migration 116): null = banco ainda sem a função (a tela mostra o resumo de antes)
  const [visao, setVisao] = useState<LinhaVisao[] | null>(null)

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
  const terminadas = ativas.filter((r) => r.fim && r.fim < hoje)
  const emOutraMoeda = vigentes.filter((r) => r.tipo !== 'card' && (moedaConta.get(r.contaId ?? '') ?? 'BRL') !== 'BRL').length

  // filtro por natureza: a contagem é da lista (não é dinheiro); os totais vêm de recurrence_nature_summary
  const filtrando = natureza !== 'todas'
  const daNatureza = (r: Recorrencia) => !filtrando || (r.tipo !== 'transfer' && (r.nature ?? 'none') === natureza)
  const contagemNatureza = (n: FiltroNatureza) => vigentes.filter((r) => n === 'todas' || (r.tipo !== 'transfer' && (r.nature ?? 'none') === n)).length
  const temNatureza = vigentes.some((r) => r.nature)
  const chipsNatureza: FiltroNatureza[] = ['todas', ...ordemNaturezas, 'none']
  const linhasDaNatureza = filtrando ? porNatureza.filter((l) => l.natureza === natureza) : []

  const proxima = (r: Recorrencia) => proximasOcorrencias(r, hoje, 1)[0] ?? null
  const proximaPrimeiro = (a: { r: Recorrencia; prox: string | null }, b: { r: Recorrencia; prox: string | null }) =>
    (a.prox ?? '9999').localeCompare(b.prox ?? '9999') || a.r.descricao.localeCompare(b.r.descricao, 'pt-BR')
  // as abas filtram quais cards aparecem: Cartão = assinaturas; Conta = contas fixas, receitas e transferências
  const cards = cardsPorTipo
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
    return (
      <li key={r.id} className="flex items-center gap-1 py-1.5 pl-4 pr-1 sm:pl-5">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-3">
            <p className="min-w-0 flex-1 truncate font-medium" title={r.descricao}>{r.descricao}</p>
            {r.nature && (
              <span data-testid="selo-natureza" className={`shrink-0 whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium ${SELO.neutro}`}>
                {rotuloNatureza[r.nature]}
              </span>
            )}
            <span className={`shrink-0 whitespace-nowrap text-right font-semibold tabular-nums ${corDoTipo(r.tipo === 'card' ? 'expense' : r.tipo)}`}>
              {r.tipo === 'income' ? '+' : r.tipo === 'transfer' ? '⇄ ' : '−'}{formatMoeda(r.valor, moeda)}
            </span>
          </div>
          {/* relative: o texto sr-only (absolute) fica preso ao corte da linha; sem isso ele vazava e alargava a página no celular */}
          <p className="relative truncate text-xs text-slate-500" title={completo} data-testid="meta-recorrente">
            {/* a próxima data abre a linha: no fim ela era a primeira a sumir nas reticências do celular (auditoria 5h) */}
            {prox && <><span className="text-agendado">próxima {dataCurta(prox, hoje)}</span> · </>}
            {quando(r)} · {onde(r)}
            {curta && <> · <span aria-hidden="true">{curta}</span><span className="sr-only">{caminho}</span></>}
            {fimTexto && <> · {fimTexto}</>}
          </p>
        </div>
        <Link to={r.tipo === 'card' && r.cartaoId ? rotaCartao(r.cartaoId) : '/lancamentos'}
          aria-label={`Abrir ${r.descricao} em ${r.tipo === 'card' ? 'Cartões' : 'Lançamentos'}`}
          title={r.tipo === 'card' ? 'Ver na fatura do cartão (mudar o dia ou encerrar)' : 'Ver em Lançamentos (editar ou parar de repetir)'}
          className="inline-flex min-h-11 shrink-0 items-center rounded-lg px-2 text-sm font-semibold text-azul hover:bg-azul-claro">
          Abrir <span aria-hidden="true" className="ml-1">›</span>
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

      {recorrencias === null && !erro && <p className="text-sm text-slate-600" role="status">Carregando…</p>}

      {recorrencias !== null && ativas.length === 0 && (
        <EmptyState
          titulo="Nenhum recorrente ainda"
          descricao="Aluguel, luz, salário, condomínio e assinaturas aparecem aqui quando você usa Repetir ao lançar (na conta ou no cartão)."
          acao={<Link to="/lancamentos" className="inline-flex min-h-11 items-center justify-center rounded-lg bg-azul px-4 text-sm font-semibold text-white hover:bg-blue-700">Ir para Lançamentos</Link>}
        />
      )}

      {vigentes.length > 0 && (
        <section aria-labelledby="resumo-recorrentes" className="mb-4">
          <h2 id="resumo-recorrentes" className="sr-only">Resumo por mês</h2>
          {visao !== null && visao.length > 0 ? <VisaoGeral linhas={visao} /> : (
          <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
            <CartaoResumo titulo="No cartão, por mês" linha={linha('medium', 'card', 'expense')} unidade="assinatura" tipo="expense" />
            <CartaoResumo titulo="Na conta, por mês — saídas" linha={linha('medium', 'account', 'expense')} unidade="despesa" tipo="expense" />
            <CartaoResumo titulo="Na conta, por mês — entradas" linha={linha('medium', 'account', 'income')} unidade="receita" tipo="income" />
            {linha('medium', 'account', 'transfer') && (
              <CartaoResumo titulo="Transferências, por mês" linha={linha('medium', 'account', 'transfer')} unidade="transferência" tipo="transfer"
                nota="à parte, fora dos gastos" />
            )}
          </div>
          )}
          {emOutraMoeda > 0 && (
            <p className="mt-2 text-xs text-slate-600">
              {emOutraMoeda === 1 ? '1 recorrente em outra moeda fica' : `${emOutraMoeda} recorrentes em outra moeda ficam`} fora dos totais (que são em reais).
            </p>
          )}
          {porAlvo.length > 0 && (
            <details className="mt-2 rounded-xl border border-slate-200 bg-white text-sm">
              <summary className="flex min-h-11 cursor-pointer items-center px-4 font-semibold text-azul">Por cartão e por conta</summary>
              <ul className="divide-y divide-slate-100 border-t border-slate-100">
                {porAlvo.map((l) => (
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
          {porNatureza.some((l) => l.natureza !== 'all' && l.natureza !== 'none') && (
            <details className="mt-2 rounded-xl border border-slate-200 bg-white text-sm">
              <summary className="flex min-h-11 cursor-pointer items-center px-4 font-semibold text-azul">Por natureza</summary>
              <ul className="divide-y divide-slate-100 border-t border-slate-100" data-testid="resumo-natureza">
                {porNatureza.filter((l) => l.natureza !== 'all').map((l) => (
                  <li key={`${l.natureza}-${l.tipo}`} className="flex items-baseline gap-3 px-4 py-2">
                    <span className="min-w-0 flex-1 truncate">
                      {rotuloFiltroNatureza(l.natureza as FiltroNatureza)} <span className="text-slate-500">· {l.tipo === 'income' ? 'entradas' : 'saídas'} · {l.qtde}</span>
                    </span>
                    <span className={`shrink-0 whitespace-nowrap text-right tabular-nums ${corDoTipo(l.tipo)}`}><strong>{formatBRL(l.porMes)}</strong>/mês</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}

      {ativas.length > 0 && (
        <>
          <div role="group" aria-label="Mostrar recorrentes" className="mb-3 flex gap-2">
            {abas.map(([chave, rotulo]) => (
              <button key={chave} type="button" aria-pressed={aba === chave} onClick={() => setAba(chave)}
                className={`min-h-11 rounded-full px-4 text-sm font-semibold transition-colors ${aba === chave
                  ? 'bg-azul text-white' : 'border border-slate-200 bg-white text-marinho hover:bg-azul-claro'}`}>
                {rotulo}
              </button>
            ))}
          </div>
          {temNatureza && (
            <div role="group" aria-label="Filtrar por natureza" className="mb-3 flex flex-wrap gap-2">
              {chipsNatureza.filter((n) => n === 'todas' || n === natureza || contagemNatureza(n) > 0).map((n) => (
                <button key={n} type="button" aria-pressed={natureza === n} onClick={() => setNatureza(n)}
                  className={`min-h-11 rounded-full px-3 text-sm font-semibold transition-colors ${natureza === n
                    ? 'bg-marinho text-white' : 'border border-slate-200 bg-white text-marinho hover:bg-azul-claro'}`}>
                  {rotuloFiltroNatureza(n)} <span className="font-normal opacity-80">· {contagemNatureza(n)}</span>
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
            {cards.length === 0 && (
              <Card><p className="text-sm text-slate-600">Nenhum recorrente {aba === 'cartao' ? 'no cartão' : 'em conta'}.</p></Card>
            )}
            {cards.map((t, i) => {
              const secao = t.tipo === 'card' || t.tipo === 'expense' ? 'Saídas' : t.tipo === 'income' ? 'Entradas' : 'Transferências · à parte, fora dos gastos'
              const anterior = cards[i - 1]
              const novaSecao = !anterior || (anterior.tipo === 'card' || anterior.tipo === 'expense' ? 'Saídas' : anterior.tipo === 'income' ? 'Entradas' : 'Transferências · à parte, fora dos gastos') !== secao
              // total do banco (só reais); sem linha (ex.: todos em outra moeda) a tela mostra só a contagem, nunca soma
              const doTipo = filtrando ? undefined : linha('medium', t.meio, t.tipoResumo)
              return (
                <Fragment key={t.tipo}>
                {novaSecao && <h2 className="pt-2 text-lg font-bold text-marinho">{secao}</h2>}
                <Card semPadding>
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
                          <div className="flex flex-wrap items-baseline justify-between gap-x-3 bg-slate-50 px-4 py-2 sm:px-5">
                            <h3 id={`grupo-${t.tipo}-${g.f}`} className="text-sm font-semibold text-marinho">
                              {rotuloGrupoFrequencia[g.f]} <span className="font-normal text-slate-500">· {g.itens.length}</span>
                            </h3>
                            {daFrequencia && <p className="text-xs text-slate-600 tabular-nums">{total(daFrequencia, g.f)}</p>}
                          </div>
                          <ul className="divide-y divide-slate-100">{g.itens.map(({ r, prox }) => item(r, prox))}</ul>
                        </section>
                      )
                    })}
                  </section>
                </Card>
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
          {familiaId && <ProjecaoCompromissos familiaId={familiaId} hoje={hojeSP()} />}
        </>
      )}

      {recorrencias !== null && <ParcelasAtivas familiaId={familiaId} />}
    </>
  )
}

/** Cartão do topo: equivalente por mês (grande) e o total por ocorrência (pequeno), os dois do banco. */
function CartaoResumo({ titulo, linha, unidade, tipo, nota }: {
  titulo: string; linha: LinhaResumoRecorrencia | undefined; unidade: string; tipo: 'income' | 'expense' | 'transfer'; nota?: string
}) {
  const qtde = linha?.qtde ?? 0
  return (
    <Card semPadding className="p-3 sm:p-4">
      <h3 className="text-xs font-semibold text-slate-600 sm:text-sm">{titulo}</h3>
      <p className={`mt-1 whitespace-nowrap text-lg font-bold tabular-nums sm:text-2xl ${corDoTipo(tipo)}`}>
        {formatBRL(linha?.porMes ?? (0 as Cents))}
      </p>
      <p className="text-xs text-slate-500">
        equivalente por mês · {formatBRL(linha?.porOcorrencia ?? (0 as Cents))} por ocorrência · {qtde} {unidade}{qtde === 1 ? '' : 's'}
        {nota && <> · {nota}</>}
      </p>
    </Card>
  )
}

/**
 * Topo da página: quanto se gasta por mês e por ano (com fixo × variável) e quanto entra por mês e por ano. Os valores vêm do banco
 * (recurrence_overview); a tela não soma. "Sugerido" = o app decidiu pelo histórico, porque a pessoa não marcou a natureza.
 */
function VisaoGeral({ linhas }: { linhas: LinhaVisao[] }) {
  const achar = (tipo: LinhaVisao['tipo'], recorte: LinhaVisao['recorte']) => linhas.find((l) => l.tipo === tipo && l.recorte === recorte)
  const saidas = achar('expense', 'all')
  const entradas = achar('income', 'all')
  const fixo = achar('expense', 'fixed')
  const variavel = achar('expense', 'variable')
  const parte = (rotulo: string, l: LinhaVisao | undefined) => l && (
    <li className="flex items-baseline justify-between gap-3" data-testid={`visao-${rotulo.toLowerCase()}`}>
      <span className="text-slate-700">
        {rotulo} <span className="text-slate-500">· {l.qtde}{l.sugeridas > 0 && <> · {l.sugeridas === l.qtde ? 'sugerido' : `${l.sugeridas} sugerido${l.sugeridas === 1 ? '' : 's'}`}</>}</span>
      </span>
      <span className="whitespace-nowrap tabular-nums">
        <strong>{formatBRL(l.porMes)}</strong>/mês <span className="text-slate-500">· {formatBRL(l.porAno)}/ano</span>
      </span>
    </li>
  )
  return (
    <div className="grid gap-2 sm:grid-cols-2 sm:gap-3" data-testid="visao-geral">
      {saidas && (
        <Card semPadding className="p-4">
          <h3 className="text-sm font-semibold text-slate-600">Você gasta</h3>
          <p className={`mt-1 whitespace-nowrap text-2xl font-bold tabular-nums ${corDoTipo('expense')}`} data-testid="visao-saidas-mes">
            {formatBRL(saidas.porMes)}<span className="text-base font-semibold">/mês</span>
          </p>
          <p className="text-sm text-slate-600 tabular-nums" data-testid="visao-saidas-ano">{formatBRL(saidas.porAno)} por ano · {saidas.qtde} recorrente{saidas.qtde === 1 ? '' : 's'}</p>
          {(fixo || variavel) && (
            <ul className="mt-3 space-y-1 border-t border-slate-100 pt-3 text-sm">
              {parte('Fixo', fixo)}
              {parte('Variável', variavel)}
            </ul>
          )}
          {(fixo?.sugeridas ?? 0) + (variavel?.sugeridas ?? 0) > 0 && (
            <p className="mt-2 text-xs text-slate-500">
              "Sugerido": o app decidiu pelo histórico (valor sempre igual = fixo; valores diferentes = variável). A natureza que você marcou vale mais.
            </p>
          )}
        </Card>
      )}
      {entradas && (
        <Card semPadding className="p-4">
          <h3 className="text-sm font-semibold text-slate-600">Vai entrar</h3>
          <p className={`mt-1 whitespace-nowrap text-2xl font-bold tabular-nums ${corDoTipo('income')}`} data-testid="visao-entradas-mes">
            {formatBRL(entradas.porMes)}<span className="text-base font-semibold">/mês</span>
          </p>
          <p className="text-sm text-slate-600 tabular-nums" data-testid="visao-entradas-ano">{formatBRL(entradas.porAno)} por ano · {entradas.qtde} recorrente{entradas.qtde === 1 ? '' : 's'}</p>
        </Card>
      )}
    </div>
  )
}
