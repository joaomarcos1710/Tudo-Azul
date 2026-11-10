import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Aviso } from '../components/ui/Aviso'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { EmptyState } from '../components/ui/EmptyState'
import { Field } from '../components/ui/Field'
import { MenuAcoes } from '../components/ui/MenuAcoes'
import { Selecao } from '../components/ui/Selecao'
import { SeletorCategoria } from '../components/SeletorCategoria'
import { useFamilia } from '../lib/FamiliaContext'
import { listarCartoes } from '../lib/cartoes'
import type { Cartao } from '../lib/cartoes'
import { listarCategorias, nomesCompletos } from '../lib/categorias'
import type { Categoria } from '../lib/categorias'
import { aceitaLancamento, hojeSP, listarContas, mesmaMoeda } from '../lib/contas'
import type { Conta } from '../lib/contas'
import { mensagemErroBanco } from '../lib/erros'
import { formatBRL, formatBRLCampo, formatDate, formatMoeda, parseBRL, simboloMoeda } from '../lib/format'
import type { Cents } from '../lib/format'
import {
  criarRecorrencia, diaDaSemana, editarRecorrencia, excluirRecorrencia, frequenciaResumo, frequencias, listarRecorrencias, MAX_CADA,
  ordemFrequencias, proximasOcorrencias, resumoRecorrencias, rotuloFrequencia, rotuloGrupoFrequencia, rotuloTipoRecorrencia,
} from '../lib/recorrencias'
import type {
  FrequenciaResumo, LinhaResumoRecorrencia, Recorrencia, TipoRecorrencia, UnidadeFrequencia,
} from '../lib/recorrencias'
import { CabecalhoPagina } from '../components/ui/CabecalhoPagina'
import { corDoTipo } from '../lib/cores'
import { PessoaSelectField } from '../components/PessoaSelectField'
import { ProjecaoCompromissos } from '../components/ui/ProjecaoCompromissos'
import { listarPessoasFamilia } from '../lib/pessoasFamilia'
import { useAuth } from '../lib/auth'
import type { PessoaFamilia } from '../lib/pessoasFamilia'

const dias: [string, string][] = Array.from({ length: 31 }, (_, i) => [String(i + 1), `Dia ${i + 1}`])
const toda = (diaSemana: string) => `${diaSemana === 'sábado' || diaSemana === 'domingo' ? 'todo' : 'toda'} ${diaSemana}`
const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

type Aba = 'todos' | 'conta' | 'cartao'
const abas: [Aba, string][] = [['todos', 'Todos'], ['conta', 'Conta'], ['cartao', 'Cartão']]
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
  const [pessoas, setPessoas] = useState<PessoaFamilia[]>([])
  const [erro, setErro] = useState('')
  const [editando, setEditando] = useState<Recorrencia | 'nova' | null>(null)
  const [aba, setAba] = useState<Aba>('todos')

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
      void listarPessoasFamilia(familiaId).then(setPessoas).catch(() => setPessoas([]))
      setResumo(s)
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

  async function excluir(r: Recorrencia) {
    if (!window.confirm(`Excluir "${r.descricao}"? Os próximos planejados vão para a lixeira; o que já foi pago ou lançado no cartão continua no histórico.`)) return
    try {
      await excluirRecorrencia(r.id)
      await carregar()
    } catch (err) {
      setErro(mensagemErroBanco(err))
    }
  }

  if (!familiaId) return null
  const hoje = hojeSP()
  const ativas = recorrencias?.filter((r) => r.ativa) ?? []
  // mesma base do banco (migration 063): data final passada fica fora dos grupos e dos totais, mas continua à mão para excluir
  const vigentes = ativas.filter((r) => !r.fim || r.fim >= hoje)
  const terminadas = ativas.filter((r) => r.fim && r.fim < hoje)
  const emOutraMoeda = vigentes.filter((r) => r.tipo !== 'card' && (moedaConta.get(r.contaId ?? '') ?? 'BRL') !== 'BRL').length

  const proxima = (r: Recorrencia) => proximasOcorrencias(r, hoje, 1)[0] ?? null
  const proximaPrimeiro = (a: { r: Recorrencia; prox: string | null }, b: { r: Recorrencia; prox: string | null }) =>
    (a.prox ?? '9999').localeCompare(b.prox ?? '9999') || a.r.descricao.localeCompare(b.r.descricao, 'pt-BR')
  // as abas filtram quais cards aparecem: Cartão = assinaturas; Conta = contas fixas, receitas e transferências
  const cards = cardsPorTipo
    .filter((t) => aba === 'todos' || (aba === 'cartao') === (t.tipo === 'card'))
    .map((t) => {
      const doTipo = vigentes.filter((r) => r.tipo === t.tipo)
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
        <MenuAcoes rotulo={`Ações de ${r.descricao}`} acoes={[
          { rotulo: 'Editar', aoEscolher: () => setEditando(r), desabilitado: editando !== null },
          { rotulo: 'Excluir', aoEscolher: () => { void excluir(r) }, perigo: true },
        ]} />
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
        acoes={editando === null && <Button onClick={() => setEditando('nova')}>Novo recorrente</Button>}
        descricao={<>
          Contas, salários e assinaturas que se repetem, separados por frequência.
          <Explicacao rotulo="Como funcionam os recorrentes">
            Repetem toda semana, a cada 14 dias, todo mês, a cada 2, 3 ou 6 meses, todo ano ou a cada N dias.
            Em conta, os próximos 12 meses aparecem como <strong>Planejado</strong> (ou, se você informar a data final, todas as parcelas até ela) em{' '}
            <Link to="/lancamentos" className="font-semibold text-azul hover:underline">Lançamentos</Link>: quando a conta chegar,
            corrija o valor e marque como pago. No cartão, a compra entra no dia, na fatura certa.
            Os totais do topo são o <strong>equivalente por mês</strong>: anual ÷ 12, a cada N meses ÷ N, semanal × 52 ÷ 12,
            a cada N dias × 365 ÷ 12 ÷ N, arredondado no centavo em cada recorrente. Só contam os recorrentes em reais e sem data final passada;
            transferências ficam à parte, fora dos gastos.
          </Explicacao>
        </>} />

      {erro && <div className="mb-4"><Aviso tipo="erro">{erro}</Aviso></div>}

      {editando !== null && (
        <FormRecorrencia
          recorrencia={editando === 'nova' ? null : editando}
          contas={contas} cartoes={cartoes} categorias={categorias} pessoas={pessoas}
          aoSalvar={async () => { setEditando(null); await carregar() }}
          aoCancelar={() => setEditando(null)}
          aoCategoriaCriada={(c) => setCategorias((atual) => [...atual, c])}
        />
      )}

      {recorrencias === null && !erro && <p className="text-sm text-slate-600" role="status">Carregando…</p>}

      {recorrencias !== null && ativas.length === 0 && editando === null && (
        <EmptyState
          titulo="Nenhum recorrente ainda"
          descricao="Cadastre aluguel, luz, salário, PLR, condomínio e assinaturas (Netflix, Spotify) uma vez só: o app lança nas datas certas."
          acao={<Button onClick={() => setEditando('nova')}>Cadastrar o primeiro</Button>}
        />
      )}

      {vigentes.length > 0 && (
        <section aria-labelledby="resumo-recorrentes" className="mb-4">
          <h2 id="resumo-recorrentes" className="sr-only">Resumo por mês</h2>
          <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
            <CartaoResumo titulo="No cartão, por mês" linha={linha('medium', 'card', 'expense')} unidade="assinatura" tipo="expense" />
            <CartaoResumo titulo="Na conta, por mês — saídas" linha={linha('medium', 'account', 'expense')} unidade="despesa" tipo="expense" />
            <CartaoResumo titulo="Na conta, por mês — entradas" linha={linha('medium', 'account', 'income')} unidade="receita" tipo="income" />
            {linha('medium', 'account', 'transfer') && (
              <CartaoResumo titulo="Transferências, por mês" linha={linha('medium', 'account', 'transfer')} unidade="transferência" tipo="transfer"
                nota="à parte, fora dos gastos" />
            )}
          </div>
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
          <div className="space-y-4">
            {cards.length === 0 && (
              <Card><p className="text-sm text-slate-600">Nenhum recorrente {aba === 'cartao' ? 'no cartão' : 'em conta'}.</p></Card>
            )}
            {cards.map((t) => {
              // total do banco (só reais); sem linha (ex.: todos em outra moeda) a tela mostra só a contagem, nunca soma
              const doTipo = linha('medium', t.meio, t.tipoResumo)
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
                      const daFrequencia = linha('frequency', t.meio, t.tipoResumo, g.f)
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
              )
            })}
            {terminadas.length > 0 && aba === 'todos' && (
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

interface PropsForm {
  recorrencia: Recorrencia | null
  contas: Conta[]
  cartoes: Cartao[]
  categorias: Categoria[]
  pessoas: PessoaFamilia[]
  aoSalvar: () => Promise<void>
  aoCancelar: () => void
  /** Categoria criada pelo seletor: a página acrescenta à lista dela. */
  aoCategoriaCriada: (c: Categoria) => void
}

function FormRecorrencia({ recorrencia: r, contas, cartoes, categorias, pessoas, aoSalvar, aoCancelar, aoCategoriaCriada }: PropsForm) {
  const { sessao } = useAuth()
  const editando = r !== null
  // multimoeda F2: receita, despesa e transferência em qualquer moeda; o destino da transferência só na moeda da origem
  const contasAtivas = contas.filter((c) => c.ativa && aceitaLancamento(c, 'lancamento'))
  const cartoesComCiclo = cartoes.filter((c) => c.ativo && c.fechamento !== null)
  const [tipo, setTipo] = useState<TipoRecorrencia>(r?.tipo ?? 'expense')
  const [descricao, setDescricao] = useState(r?.descricao ?? '')
  const [valorTexto, setValorTexto] = useState(r ? formatBRLCampo(r.valor) : '')
  const [dia, setDia] = useState(r?.dia ? String(r.dia) : '')
  const [inicio, setInicio] = useState(r?.inicio ?? hojeSP())
  const [fim, setFim] = useState(r?.fim ?? '')
  // frequência: uma das opções prontas ou "personalizada" (a cada N semanas/meses)
  const [freq, setFreq] = useState(r ? (frequencias.find((f) => f.unidade === r.unidade && f.cada === r.cada)?.chave ?? 'personalizada') : 'mensal')
  const [unidadeP, setUnidadeP] = useState<UnidadeFrequencia>(r?.unidade ?? 'month')
  const [cadaP, setCadaP] = useState(r ? String(r.cada) : '2')
  const [contaId, setContaId] = useState(r?.contaId ?? contasAtivas[0]?.id ?? '')
  const [destinoId, setDestinoId] = useState(r?.destinoId ?? '')
  const [cartaoId, setCartaoId] = useState(r?.cartaoId ?? cartoesComCiclo[0]?.id ?? '')
  const [categoriaId, setCategoriaId] = useState(r?.categoriaId ?? '')
  const [personId, setPersonId] = useState<string | null>(r?.personId ?? null)
  const [isSharedExpense, setIsSharedExpense] = useState(r?.isSharedExpense ?? false)
  const pessoaEscolhidaManualmente = useRef(false)
  useEffect(() => {
    if (editando || pessoaEscolhidaManualmente.current || !sessao?.user.id) return
    const propria = pessoas.find((pessoa) => pessoa.userId === sessao.user.id && pessoa.ativo)
    if (propria) setPersonId((atual) => atual ?? propria.id)
  }, [editando, pessoas, sessao?.user.id])
  const [tentou, setTentou] = useState(false)
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)

  const valor = parseBRL(valorTexto)
  const pronta = frequencias.find((f) => f.chave === freq)
  const unidade: UnidadeFrequencia = pronta ? pronta.unidade : unidadeP
  const cada = pronta ? pronta.cada : Number(cadaP)
  const cadaValido = Number.isInteger(cada) && cada >= 1 && cada <= MAX_CADA[unidade]
  const hoje = hojeSP()
  // prévia (mesma regra do banco); frequência nova com início no passado começa no dia do cadastro (migration 016)
  const previa = !editando && cadaValido && inicio && (unidade !== 'month' || dia)
    ? proximasOcorrencias({ unidade, cada, dia: unidade === 'month' ? Number(dia) : null, inicio, fim: fim || null }, hoje, 3)
    : []
  const mensal = unidade === 'month' && cada === 1
  const tipoCategoria = tipo === 'income' ? 'income' : 'expense'
  const categoriasDoTipo = categorias.filter((c) => c.tipo === tipoCategoria && (c.ativa || c.id === r?.categoriaId))
  const precisaCategoria = tipo !== 'transfer'
  const conta = contas.find((c) => c.id === contaId)
  const moeda = tipo === 'card' ? 'BRL' : conta?.moeda ?? 'BRL'
  // transferência entre moedas diferentes só na F3 (o banco recusa)
  const destinos = contasAtivas.filter((c) => c.id !== contaId && (!conta || mesmaMoeda(c, conta)))

  const problemas = {
    descricao: !descricao.trim() ? 'Informe a descrição.' : undefined,
    valor: valor === null || valor <= 0 ? 'Valor inválido. Exemplo: 180,00' : undefined,
    dia: !editando && unidade === 'month' && !dia ? 'Escolha o dia do mês.' : undefined,
    cada: !editando && !cadaValido ? `Use de 1 a ${MAX_CADA[unidade]} ${unidade === 'week' ? 'semanas' : unidade === 'day' ? 'dias' : 'meses'}.` : undefined,
    inicio: !editando && !inicio ? 'Informe a data.' : undefined,
    fim: !editando && fim && inicio && fim < inicio ? 'A data final não pode ser antes do início.' : undefined,
    categoria: precisaCategoria && !categoriaId ? 'Escolha a categoria.' : undefined,
    conta: !editando && tipo !== 'card' && !contaId ? 'Escolha a conta.' : undefined,
    destino: !editando && tipo === 'transfer' && (!destinoId || destinoId === contaId) ? 'Escolha uma conta de destino diferente.'
      : !editando && tipo === 'transfer' && !destinos.some((c) => c.id === destinoId) ? 'Transferência só entre contas da mesma moeda.' : undefined,
    cartao: !editando && tipo === 'card' && !cartaoId ? 'Escolha o cartão.' : undefined,
  }

  async function salvar(e: FormEvent) {
    e.preventDefault()
    setTentou(true)
    if (Object.values(problemas).some(Boolean) || valor === null) return
    setErro('')
    setEnviando(true)
    try {
      if (r) {
        await editarRecorrencia(r.id, { descricao, valor, categoriaId: precisaCategoria ? categoriaId : null, personId: tipo === 'expense' || tipo === 'card' ? personId : null, isSharedExpense: tipo === 'expense' || tipo === 'card' ? isSharedExpense : false })
      } else {
        await criarRecorrencia({
          tipo, descricao, valor, dia: unidade === 'month' ? Number(dia) : null, inicio, fim: fim || null, unidade, cada,
          contaId: tipo === 'card' ? null : contaId,
          destinoId: tipo === 'transfer' ? destinoId : null,
          cartaoId: tipo === 'card' ? cartaoId : null,
          categoriaId: precisaCategoria ? categoriaId : null,
          personId: tipo === 'expense' || tipo === 'card' ? personId : null,
          isSharedExpense: tipo === 'expense' || tipo === 'card' ? isSharedExpense : false,
        })
      }
      await aoSalvar()
    } catch (err) {
      setErro(mensagemErroBanco(err))
    } finally {
      setEnviando(false)
    }
  }

  const erroDe = (k: keyof typeof problemas) => (tentou ? problemas[k] : undefined)

  return (
    <Card className="mb-6">
      <h2 className="mb-4 text-lg font-semibold">{r ? `Editar ${r.descricao}` : 'Novo recorrente'}</h2>
      <form onSubmit={salvar} className="grid gap-4 md:grid-cols-2" noValidate>
        {erro && <div className="md:col-span-2"><Aviso tipo="erro">{erro}</Aviso></div>}
        {!editando && (
          <Selecao rotulo="Tipo" valor={tipo} aoMudar={(v) => { setTipo(v as TipoRecorrencia); setCategoriaId('') }}
            opcoes={Object.entries(rotuloTipoRecorrencia) as [string, string][]} />
        )}
        <Field rotulo="Descrição" maxLength={80} placeholder="Ex.: Conta de luz" value={descricao}
          onChange={(e) => setDescricao(e.target.value)} erro={erroDe('descricao')} />
        <Field rotulo={tipo === 'card' ? 'Valor (R$)' : `Valor estimado (${simboloMoeda(moeda)})`} inputMode="decimal" value={valorTexto}
          onChange={(e) => setValorTexto(e.target.value)} erro={erroDe('valor')} />
        {!editando && (
          <>
            <Selecao rotulo="Frequência" valor={freq} aoMudar={setFreq}
              opcoes={[...frequencias.map((f): [string, string] => [f.chave, f.rotulo]), ['personalizada', 'Personalizada…']]} />
            {freq === 'personalizada' && (
              <div className="grid grid-cols-2 gap-2">
                <Field rotulo="A cada" type="number" inputMode="numeric" min={1} max={MAX_CADA[unidadeP]} value={cadaP}
                  onChange={(e) => setCadaP(e.target.value)} erro={erroDe('cada')} />
                <Selecao rotulo="Unidade" valor={unidadeP} aoMudar={(v) => setUnidadeP(v as UnidadeFrequencia)}
                  opcoes={[['month', 'meses'], ['week', 'semanas'], ['day', 'dias']]} />
              </div>
            )}
            {unidade === 'month' && (
              <>
                <Selecao rotulo="Dia do mês" valor={dia} aoMudar={setDia} opcoes={dias} todos="Escolha…" />
                {erroDe('dia') && <p role="alert" className="text-sm text-negativo">{erroDe('dia')}</p>}
              </>
            )}
            <Field rotulo={unidade !== 'month' ? 'Primeira vez em' : 'A partir de'} type="date" value={inicio}
              onChange={(e) => setInicio(e.target.value)} erro={erroDe('inicio')} />
            <Field rotulo="Até (opcional)" type="date" value={fim} onChange={(e) => setFim(e.target.value)} erro={erroDe('fim')} />
            {tipo === 'card' ? (
              <>
                <Selecao rotulo="Cartão" valor={cartaoId} aoMudar={setCartaoId} opcoes={cartoesComCiclo.map((c) => [c.id, c.nome])} todos="Escolha…" />
                {erroDe('cartao') && <p role="alert" className="text-sm text-negativo">{erroDe('cartao')}</p>}
              </>
            ) : (
              <>
                <Selecao rotulo={tipo === 'transfer' ? 'Da conta' : 'Conta'} valor={contaId} aoMudar={(v) => {
                  setContaId(v)
                  // o destino de outra moeda deixa de valer ao trocar a origem
                  const nova = contas.find((c) => c.id === v)
                  const destino = contas.find((c) => c.id === destinoId)
                  if (nova && destino && !mesmaMoeda(nova, destino)) setDestinoId('')
                }}
                  opcoes={contasAtivas.map((c) => [c.id, c.nome])} todos="Escolha…" />
                {erroDe('conta') && <p role="alert" className="text-sm text-negativo">{erroDe('conta')}</p>}
              </>
            )}
            {tipo === 'transfer' && (
              <>
                <Selecao rotulo="Para a conta" valor={destinoId} aoMudar={setDestinoId}
                  opcoes={destinos.map((c) => [c.id, c.nome])} todos="Escolha…" />
                {erroDe('destino') && <p role="alert" className="text-sm text-negativo">{erroDe('destino')}</p>}
              </>
            )}
          </>
        )}
        {precisaCategoria && (
          <>
            <SeletorCategoria rotulo="Categoria" valor={categoriaId} aoMudar={setCategoriaId} opcoes={categoriasDoTipo} categorias={categorias}
              tipo={tipoCategoria} aoCriada={aoCategoriaCriada} />
            {erroDe('categoria') && <p role="alert" className="text-sm text-negativo">{erroDe('categoria')}</p>}
          </>
        )}
        {(tipo === 'expense' || tipo === 'card') && (
          <PessoaSelectField pessoas={pessoas} personId={personId} isSharedExpense={isSharedExpense}
            onChange={(value) => { pessoaEscolhidaManualmente.current = true; setPersonId(value.personId); setIsSharedExpense(value.isSharedExpense) }} />
        )}
        <p className="text-sm text-slate-600 md:col-span-2">
          {editando
            ? `${rotuloFrequencia(r!)}. Valor e descrição valem para os planejados ainda não pagos de hoje em diante. A categoria vale para todos os meses, inclusive os já pagos e os passados. Em qualquer caso, o que você corrigiu à mão em um mês fica como está. Para mudar o dia, edite em Lançamentos a ocorrência a partir da qual ele muda e escolha "Este e os próximos" (só recorrente em conta). Para mudar a frequência, exclua este recorrente e cadastre outro.`
            : unidade === 'day'
              ? `Repete a cada ${cadaValido ? cada : 1} dia${cadaValido && cada > 1 ? 's' : ''}, a partir da primeira data.`
              : unidade === 'week'
              ? `Repete ${inicio ? toda(diaDaSemana(inicio)) : 'no mesmo dia da semana da primeira data'}, a cada ${7 * (cadaValido ? cada : 1)} dias.`
              : 'Dia 29, 30 ou 31 em mês mais curto cai no último dia do mês.'}
          {!editando && inicio && inicio < hoje && (mensal
            ? ' Os meses desde o início que já passaram também entram, como planejados atrasados.'
            : ' Datas antes de hoje não são criadas.')}
          {!editando && tipo === 'card' && cartoesComCiclo.length === 0 && ' Cadastre um cartão com fechamento e vencimento em Cartões antes.'}
        </p>
        {previa.length > 0 && (
          <p className="text-sm text-marinho md:col-span-2" aria-live="polite">
            <strong>Próximas datas:</strong> {previa.map(formatDate).join(' · ')}
          </p>
        )}
        <div className="flex gap-2 md:col-span-2">
          <Button type="submit" carregando={enviando}>{r ? 'Salvar' : 'Cadastrar recorrente'}</Button>
          <Button variante="secundario" onClick={aoCancelar}>Cancelar</Button>
        </div>
      </form>
    </Card>
  )
}
