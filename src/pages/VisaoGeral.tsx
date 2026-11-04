import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { LinhaAcumulada } from '../components/graficos/LinhaAcumulada'
import { Rosca } from '../components/graficos/Rosca'
import { Aviso } from '../components/ui/Aviso'
import { Card, CardTitle } from '../components/ui/Card'
import { BandeiraCartao, IconeConta, IconeEmissor } from '../components/ui/IconeConta'
import { useAuth } from '../lib/auth'
import { useFamilia } from '../lib/FamiliaContext'
import { atualizarAutomaticos } from '../lib/automaticos'
import { resumoDosCartoes, totalFaturasDoMes } from '../lib/cartoes'
import type { ResumoCartao, TotalFaturasMes } from '../lib/cartoes'
import { listarCategorias, nomesCompletos } from '../lib/categorias'
import type { Categoria } from '../lib/categorias'
import { IconeCategoria, visualPorId } from '../lib/visualCategoria'
import { hojeSP, listarContas } from '../lib/contas'
import type { Conta } from '../lib/contas'
import { mensagemErroBanco } from '../lib/erros'
import { currentMonth, formatBRL, formatMoeda, formatDate, formatMonth, primeiraMaiuscula } from '../lib/format'
import type { Cents } from '../lib/format'
import { limitesDoMes, listarLancamentos, mesmoDiaAnoPassado, mesmoDiaMesAnterior, resumoDoMes, resumoDoPeriodo, somarMeses } from '../lib/lancamentos'
import type { Lancamento, ResumoMes } from '../lib/lancamentos'
import { carregarPatrimonio, carregarResumoInvestimentos, despesasPorCategoria, despesasPorDia, proximosPlanejados, projecaoDoMes, regularidadeRenda, vencidosPlanejados } from '../lib/painel'
import type { DespesaCategoria, DespesaDia, Patrimonio, ProjecaoMes, ProximoPlanejado, RegularidadeRenda, ResumoInvestimento, Vencidos } from '../lib/painel'
import { CabecalhoPagina } from '../components/ui/CabecalhoPagina'
import { CabecalhoInicio } from '../components/ui/CabecalhoInicio'
import { saldosProjetados } from '../lib/saldoProjetado'
import type { SaldoTotal } from '../lib/saldoProjetado'
import { listarOrcamentos } from '../lib/orcamentos'
import type { OrcamentoMes } from '../lib/orcamentos'

/**
 * Cada tela carrega só o que mostra. Início: contas, lançamentos e planejados são essenciais (se falharem, a tela
 * avisa o erro); o resto é opcional. Análises: tudo é opcional — cada bloco some sozinho se a consulta dele falhar.
 * Campo da outra tela fica vazio (não é consultado).
 */
interface Dados {
  /** null = não carregou (ou não é desta tela) */
  patrimonio: Patrimonio | null
  investimentos: ResumoInvestimento[] | null
  mes: ResumoMes | null
  anterior: ResumoMes | null
  /** Mesmo recorte nos dois meses (dia 1 até hoje × dia 1 até o mesmo dia do mês anterior), só para a % dos indicadores. */
  comparacao: { atual: ResumoMes; anterior: ResumoMes } | null
  contas: Conta[]
  proximos: ProximoPlanejado[]
  /** null = os gráficos não carregaram (ex.: banco ainda sem as consultas novas); o resto da tela segue normal */
  categorias: DespesaCategoria[] | null
  dias: DespesaDia[] | null
  /** null = relatório indisponível (ex.: banco ainda sem a migration 012); [mês, últimos 12 meses] */
  regularidade: [RegularidadeRenda, RegularidadeRenda] | null
  /** null = comparação indisponível agora; o resto da tela segue. */
  anoPassado: ComparacaoAnual | null
  /** null = projeção indisponível agora (ex.: banco ainda sem a migration 013); o resto da tela segue. */
  projecao: ProjecaoMes | null
  /** null = não carregou agora; o resto da tela segue. */
  vencidos: Vencidos | null
  cartoes: ResumoCartao[] | null
  /** Faturas de todos os cartões que vencem neste mês (soma do banco); null = não carregou (ex.: banco ainda sem a migration 023) */
  faturasDoMes: TotalFaturasMes | null
  /** Saldo das contas até o fim do mês, com planejados e faturas (do banco); null = não carregou. */
  saldoPrevisto: SaldoTotal | null
  /** Orçamentos do mês (do banco); null = não carregou. */
  orcamentos: OrcamentoMes[] | null
  /** data da última conferência de cada conta (conta ausente = nunca conferida); null = não carregou */
  ultimos: Lancamento[]
  nomeCategoria: Map<string, string>
  categoriaPorId: Map<string, Categoria>
}

/** Quatro totais vindos do banco (period_summary): período de agora e o mesmo período um ano antes. */
interface ComparacaoAnual {
  mesAtual: ResumoMes
  mesAnterior: ResumoMes
  anoAtual: ResumoMes
  anoAnterior: ResumoMes
}

/** Dias corridos entre duas datas AAAA-MM-DD (contagem de dias, não dinheiro). */
function diasEntre(de: string, ate: string): number {
  const t = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)))
  return Math.round((t(ate) - t(de)) / 86_400_000)
}


/**
 * Variação percentual em relação ao mês anterior (apresentação: razão entre dois totais que já vêm
 * do banco; nenhum valor em reais é somado aqui). null quando não há base de comparação.
 */
function variacao(atual: Cents, anterior: Cents): number | null {
  if (anterior === 0) return null
  return ((atual - anterior) / Math.abs(anterior)) * 100
}

type WidgetDashboardId = 'patrimonio' | 'disponivel' | 'resultado'

const WIDGETS_DASHBOARD: { id: WidgetDashboardId; rotulo: string }[] = [
  { id: 'patrimonio', rotulo: 'Patrimônio líquido' },
  // receita e despesa do mês ficam só no cabeçalho do Início (antes apareciam duas vezes)
  { id: 'disponivel', rotulo: 'Saldo hoje e previsto' },
  { id: 'resultado', rotulo: 'Resultado do mês' },
]
const WIDGETS_DASHBOARD_PADRAO: WidgetDashboardId[] = WIDGETS_DASHBOARD.map((w) => w.id)
const CHAVE_WIDGETS_DASHBOARD = (usuarioId: string) => `tudo-azul:dashboard-widgets:${usuarioId}`

function validarWidgetsDashboard(valor: unknown): WidgetDashboardId[] {
  if (!Array.isArray(valor)) return [...WIDGETS_DASHBOARD_PADRAO]
  return [...new Set(valor.filter((id): id is WidgetDashboardId =>
    typeof id === 'string' && WIDGETS_DASHBOARD.some((w) => w.id === id),
  ))]
}

/** Painel: todo valor em reais vem calculado do banco (net_worth, period_summary, expenses_by_category, daily_expenses). */
/** Início ("o que fazer agora") e Análises ("como estou indo"): cada seção carrega e mostra só os seus blocos. */
export type SecaoResumo = 'inicio' | 'analises'

export default function VisaoGeral({ secao = 'inicio' }: { secao?: SecaoResumo }) {
  const noInicio = secao === 'inicio'
  const { familia } = useFamilia()
  const { sessao } = useAuth()
  const familiaId = familia?.id
  const [dados, setDados] = useState<Dados | null>(null)
  const [erro, setErro] = useState('')
  const [cobrancaFalhou, setCobrancaFalhou] = useState(false)
  const [recorrentesFalhou, setRecorrentesFalhou] = useState(false)
  const hoje = hojeSP()
  const mes = currentMonth()
  // até dois nomes ("João Marcos"), como no cabeçalho do Organizze
  const nome = ((sessao?.user?.user_metadata?.name as string | undefined) ?? '').trim().split(/\s+/).slice(0, 2).join(' ')

  const usuarioId = sessao?.user?.id ?? null
  const [preferenciasWidgets, setPreferenciasWidgets] = useState<{ usuarioId: string | null; ids: WidgetDashboardId[] }>({
    usuarioId: null, ids: [...WIDGETS_DASHBOARD_PADRAO],
  })
  const [preferenciasWidgetsCarregadas, setPreferenciasWidgetsCarregadas] = useState(false)
  const [personalizandoWidgets, setPersonalizandoWidgets] = useState(false)

  useEffect(() => {
    let ids = [...WIDGETS_DASHBOARD_PADRAO]
    if (usuarioId) {
      try {
        const salvo = window.localStorage.getItem(CHAVE_WIDGETS_DASHBOARD(usuarioId))
        if (salvo !== null) ids = validarWidgetsDashboard(JSON.parse(salvo))
      } catch { /* armazenamento indisponível ou preferência inválida: usa o padrão */ }
    }
    setPreferenciasWidgets({ usuarioId, ids })
    setPreferenciasWidgetsCarregadas(true)
  }, [usuarioId])

  useEffect(() => {
    if (!preferenciasWidgetsCarregadas || !usuarioId || preferenciasWidgets.usuarioId !== usuarioId) return
    try {
      window.localStorage.setItem(CHAVE_WIDGETS_DASHBOARD(usuarioId), JSON.stringify(preferenciasWidgets.ids))
    } catch { /* sem armazenamento: a personalização vale só nesta sessão */ }
  }, [preferenciasWidgets, preferenciasWidgetsCarregadas, usuarioId])

  // Nunca expõe por um render as preferências do usuário anterior durante uma troca de sessão.
  const widgetsVisiveis = preferenciasWidgets.usuarioId === usuarioId
    ? preferenciasWidgets.ids
    : [...WIDGETS_DASHBOARD_PADRAO]
  const adicionarWidget = (id: WidgetDashboardId) => {
    setPreferenciasWidgets({ usuarioId, ids: widgetsVisiveis.includes(id) ? widgetsVisiveis : [...widgetsVisiveis, id] })
  }
  const removerWidget = (id: WidgetDashboardId) => {
    setPreferenciasWidgets({ usuarioId, ids: widgetsVisiveis.filter((x) => x !== id) })
  }
  const moverWidget = (id: WidgetDashboardId, direcao: -1 | 1) => {
    const origem = widgetsVisiveis.indexOf(id)
    const destino = origem + direcao
    if (origem < 0 || destino < 0 || destino >= widgetsVisiveis.length) return
    const ids = [...widgetsVisiveis]
    ;[ids[origem], ids[destino]] = [ids[destino], ids[origem]]
    setPreferenciasWidgets({ usuarioId, ids })
  }
  const restaurarWidgets = () => setPreferenciasWidgets({ usuarioId, ids: [...WIDGETS_DASHBOARD_PADRAO] })


  useEffect(() => {
    if (!familiaId) return
    const [de, ate] = limitesDoMes(mes)
    const opcional = <T,>(p: Promise<T>) => p.catch(() => null)
    // no dia 3, comparar 3 dias com o mês anterior inteiro engana ("▼ 90%"): os dois lados vão até o mesmo dia
    const comparar = () => opcional(Promise.all([
      resumoDoPeriodo(familiaId, de, hoje),
      resumoDoPeriodo(familiaId, `${somarMeses(mes, -1)}-01`, mesmoDiaMesAnterior(hoje)),
    ]).then(([atual, anterior]) => ({ atual, anterior })))
    // uma carga antiga (mês, dia ou seção anteriores) que chegue depois da nova é descartada
    let ativo = true
    setDados(null)
    setErro('')
    // gera recorrentes e cobra faturas fechadas; se falhar, o painel mostra o que já está gravado, com aviso
    atualizarAutomaticos()
      .then((r) => { setCobrancaFalhou(!r.faturasOk); setRecorrentesFalhou(!r.recorrentesOk) })
      .then(() => noInicio
        ? Promise.all([
            // essenciais do Início: se falharem, a tela inteira avisa o erro
            listarContas(familiaId, hoje), proximosPlanejados(familiaId, hoje), listarLancamentos(familiaId, mes), listarCategorias(familiaId),
            opcional(vencidosPlanejados(familiaId, hoje, 5)), opcional(resumoDosCartoes(familiaId, hoje)),
            opcional(totalFaturasDoMes(familiaId, mes)),
            // O resumo do Início reutiliza as mesmas fontes financeiras já usadas em Análises.
            opcional(carregarPatrimonio(familiaId, hoje)), opcional(carregarResumoInvestimentos(familiaId, hoje)),
            opcional(resumoDoMes(familiaId, mes)), opcional(resumoDoMes(familiaId, somarMeses(mes, -1))), comparar(),
            // "posso gastar?": o mesmo saldo projetado do Calendário, até o último dia do mês
            opcional(saldosProjetados(familiaId, ate, true).then((r) => r.total)), opcional(listarOrcamentos(familiaId, mes, hoje)),
          ]).then(([c, proximos, lancs, cats, vencidos, cartoes, faturasDoMes, patrimonio, investimentos, resumo, anterior, comparacao, saldoPrevisto, orcamentos]): Dados => ({
            patrimonio, investimentos, mes: resumo, anterior, comparacao, categorias: null, dias: null, regularidade: null, anoPassado: null, projecao: null,
            contas: c.contas.filter((x) => x.ativa), proximos, vencidos, cartoes, faturasDoMes, saldoPrevisto, orcamentos,
            ultimos: lancs.filter((l) => l.status === 'paid').slice(0, 6),
            nomeCategoria: nomesCompletos(cats),
            categoriaPorId: new Map(cats.map((x) => [x.id, x])),
          }))
        : Promise.all([
            // Análises: cada consulta é opcional; um bloco que falha some, o resto segue
            opcional(carregarPatrimonio(familiaId, hoje)), opcional(carregarResumoInvestimentos(familiaId, hoje)),
            opcional(resumoDoMes(familiaId, mes)), opcional(resumoDoMes(familiaId, somarMeses(mes, -1))),
            opcional(despesasPorCategoria(familiaId, de, ate, 4)), opcional(despesasPorDia(familiaId, de, ate)),
            opcional(Promise.all([
              regularidadeRenda(familiaId, de, ate),
              regularidadeRenda(familiaId, limitesDoMes(somarMeses(mes, -11))[0], ate),
            ])),
            // mesmo recorte de dias nos dois anos: este mês até hoje × o mesmo mês até o mesmo dia do ano passado; o ano até hoje idem
            opcional(Promise.all([
              resumoDoPeriodo(familiaId, de, hoje),
              resumoDoPeriodo(familiaId, `${somarMeses(mes, -12)}-01`, mesmoDiaAnoPassado(hoje)),
              resumoDoPeriodo(familiaId, `${hoje.slice(0, 4)}-01-01`, hoje),
              resumoDoPeriodo(familiaId, `${Number(hoje.slice(0, 4)) - 1}-01-01`, mesmoDiaAnoPassado(hoje)),
            ]).then(([mesAtual, mesAnterior, anoAtual, anoAnterior]) => ({ mesAtual, mesAnterior, anoAtual, anoAnterior }))),
            opcional(projecaoDoMes(familiaId, mes, hoje)), comparar(),
          ]).then(([patrimonio, investimentos, resumo, anterior, categorias, dias, regularidade, anoPassado, projecao, comparacao]): Dados => ({
            patrimonio, investimentos, mes: resumo, anterior, comparacao, categorias, dias, regularidade, anoPassado, projecao,
            contas: [], proximos: [], vencidos: null, cartoes: null, faturasDoMes: null, saldoPrevisto: null, orcamentos: null, ultimos: [], nomeCategoria: new Map(), categoriaPorId: new Map(),
          })))
      .then((d) => { if (ativo) setDados(d) })
      .catch((err) => { if (ativo) setErro(mensagemErroBanco(err)) })
    return () => { ativo = false }
  }, [familiaId, hoje, mes, noInicio])

  if (!familiaId) return null
  if (erro) return <Aviso tipo="erro">{erro}</Aviso>
  if (!dados) return <p className="text-sm text-slate-600" role="status">Carregando…</p>

  // null = não carregou; o bloco correspondente some e o resto da tela segue
  const { patrimonio: p, mes: m, anterior: a, comparacao: cmp } = dados
  const mesAnteriorCurto = formatMonth(somarMeses(mes, -1)).split(' ')[0].slice(0, 3)
  const comparadoAteHoje = `${mesAnteriorCurto} até dia ${Number(mesmoDiaMesAnterior(hoje).slice(8))}`
  const indicadoresWidgets: Record<WidgetDashboardId, ReactNode> = {
    // o saldo das contas já está no card "Saldo hoje e previsto": aqui só Bens e Dívida, para não repetir
    patrimonio: p ? <Indicador rotulo="Patrimônio líquido" valor={p.patrimonio} icone={<Cofre />} corIcone="bg-marinho text-celeste" destaque
      detalhes={[['Bens', p.bens], ['Dívida', p.divida]]} /> : (
      <Card><CardTitle>Patrimônio líquido</CardTitle><p className="text-sm text-slate-500" role="status">Indicador indisponível agora.</p></Card>
    ),
    // a dívida já aparece no card de patrimônio: aqui só o saldo das contas
    disponivel: <CardSaldo hoje={p?.disponivel ?? null} previsto={dados.saldoPrevisto?.saldo ?? null} fimDoMes={limitesDoMes(mes)[1]} />,
    resultado: m ? <Indicador rotulo="Resultado do mês" valor={m.resultado} icone={<Balanca />} corIcone="bg-azul-claro text-azul"
      var={cmp ? variacao(cmp.atual.resultado, cmp.anterior.resultado) : null} subirEhBom comparado={comparadoAteHoje} negativoVermelho /> : (
      <Card><CardTitle>Resultado do mês</CardTitle><p className="text-sm text-slate-500" role="status">Indicador indisponível agora.</p></Card>
    ),
  }
  return (
    <>
      {noInicio
        ? <CabecalhoInicio nome={nome} receitas={m?.receitas ?? null} despesas={m?.despesas ?? null}
          aReceber={m?.receitasPrevistas ?? null} aPagar={m?.despesasPrevistas ?? null} />
        : <CabecalhoPagina titulo="Análises" descricao={`Como as finanças da família estão indo em ${primeiraMaiuscula(formatMonth(mes))}.`} />}
      {cobrancaFalhou && (
        <div className="mb-4">
          <Aviso tipo="erro">Não foi possível fechar as faturas dos cartões agora. Os valores de cartão podem estar defasados.</Aviso>
        </div>
      )}
      {recorrentesFalhou && (
        <div className="mb-4">
          <Aviso tipo="erro">Não foi possível lançar os recorrentes agora. Contas mensais e assinaturas podem estar faltando.</Aviso>
        </div>
      )}

      {noInicio && (dados.vencidos === null || dados.cartoes === null) && (
        // card que falhou não pode simplesmente sumir: sem aviso, "Vencidos" ausente parece "nada vencido"
        <div className="mb-4">
          <Aviso tipo="erro">
            Não foi possível verificar agora {dados.vencidos === null && dados.cartoes === null ? 'os vencidos e os cartões' : dados.vencidos === null ? 'os vencidos' : 'os cartões'}.
            Recarregue a página em instantes.
          </Aviso>
        </div>
      )}

      {noInicio && dados.vencidos && dados.vencidos.total > 0 && (
        <Card className="mb-4 !border !border-red-200">
          <CardTitle>Vencidos e precisam de atenção</CardTitle>
          <p className="mb-2 text-sm text-slate-600">
            {dados.vencidos.total === 1 ? '1 compromisso planejado já passou' : `${dados.vencidos.total} compromissos planejados já passaram`} da data
            sem ser marcado como pago ou recebido.
          </p>
          <ul className="divide-y divide-slate-100">
            {dados.vencidos.itens.map((x) => {
              const atraso = diasEntre(x.data, hoje)
              return (
                <li key={x.id}>
                  <Link to={x.id.startsWith('debt-') ? `/dividas?baixar=${x.id.slice(5)}` : `/lancamentos?mes=${x.data.slice(0, 7)}`} className="flex items-center gap-3 py-2 text-sm hover:bg-slate-50">
                    <IconeDaLinha tipo={x.tipo} categoriaId={x.categoriaId} porId={dados.categoriaPorId} />
                    <span className="min-w-0 flex-1">
                      {formatDate(x.data).slice(0, 5)} · {x.descricao || (x.tipo === 'income' ? 'Receita' : x.tipo === 'expense' ? 'Despesa' : 'Transferência')}
                      <span className="ml-2 text-xs text-negativo">{atraso === 1 ? 'venceu ontem' : `venceu há ${atraso} dias`}</span>
                      {x.tipo === 'transfer' && <RotaTransferencia contaId={x.contaId} destinoId={x.destinoId} contas={dados.contas} />}
                    </span>
                    <span className={`tabular-nums font-semibold ${x.tipo === 'income' ? 'text-positivo' : x.tipo === 'expense' ? 'text-negativo' : 'text-slate-600'}`}>
                      {x.tipo === 'income' ? '+' : x.tipo === 'expense' ? '−' : '⇄ '}{formatBRL(x.valor)}
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
          {dados.vencidos.total > dados.vencidos.itens.length && (
            <p className="mt-2 text-xs text-slate-500">e mais {dados.vencidos.total - dados.vencidos.itens.length} (os mais antigos aparecem primeiro).</p>
          )}
        </Card>
      )}

      {noInicio && <section aria-label="Resumo financeiro personalizável" className="mb-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-marinho">Visão geral financeira</h2>
            <p className="text-sm text-slate-600">{formatMonth(mes).replace(/^./, (c) => c.toUpperCase())} · organize os indicadores como preferir.</p>
          </div>
          <button type="button" onClick={() => setPersonalizandoWidgets((v) => !v)}
            aria-expanded={personalizandoWidgets} aria-controls="configurar-widgets-dashboard"
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-marinho hover:bg-slate-50">
            {personalizandoWidgets ? 'Concluir' : 'Personalizar painel'}
          </button>
        </div>
        {personalizandoWidgets && <div id="configurar-widgets-dashboard" className="mb-4 rounded-card border border-slate-200 bg-slate-50 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-semibold text-marinho">Seus widgets</h3>
              <p className="text-xs text-slate-600">Adicione, remova ou mude a ordem. A preferência fica salva neste aparelho, separada por usuário.</p>
            </div>
            <button type="button" onClick={restaurarWidgets} className="text-sm font-semibold text-azul hover:underline">Restaurar padrão</button>
          </div>
          <ul className="space-y-2">
            {WIDGETS_DASHBOARD.map((widget) => {
              const indice = widgetsVisiveis.indexOf(widget.id)
              const visivel = indice >= 0
              return <li key={widget.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white px-3 py-2">
                <span className="text-sm font-medium">{widget.rotulo}</span>
                <div className="flex flex-wrap items-center gap-2">
                  {visivel && <>
                    <button type="button" onClick={() => moverWidget(widget.id, -1)} disabled={indice === 0}
                      aria-label={`Mover ${widget.rotulo} para cima`} className="rounded border border-slate-200 px-2 py-1 text-sm disabled:opacity-40">↑</button>
                    <button type="button" onClick={() => moverWidget(widget.id, 1)} disabled={indice === widgetsVisiveis.length - 1}
                      aria-label={`Mover ${widget.rotulo} para baixo`} className="rounded border border-slate-200 px-2 py-1 text-sm disabled:opacity-40">↓</button>
                  </>}
                  <button type="button" onClick={() => visivel ? removerWidget(widget.id) : adicionarWidget(widget.id)}
                    className="rounded border border-slate-200 px-2 py-1 text-sm font-semibold text-azul hover:bg-azul-claro">
                    {visivel ? 'Remover' : 'Adicionar'}
                  </button>
                </div>
              </li>
            })}
          </ul>
        </div>}
        {widgetsVisiveis.length === 0 ? (
          <div className="rounded-card border border-dashed border-slate-300 p-5 text-sm text-slate-600">
            Nenhum widget selecionado. Use <strong>Personalizar painel</strong> para adicionar indicadores.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Indicadores financeiros">
            {widgetsVisiveis.map((id) => <div key={id} className="min-w-0">{indicadoresWidgets[id]}</div>)}
          </div>
        )}
        {p && <p className="mt-2 text-xs text-slate-500">
          Patrimônio = saldo das contas + crédito a receber + bens em reais − dívidas. Investimentos ficam à parte, abaixo.
        </p>}
        {dados.investimentos && <Card className="mt-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <CardTitle>Saldo de investimentos</CardTitle>
            <Link to="/investimentos" className="text-sm font-semibold text-azul hover:underline">Ver carteira</Link>
          </div>
          {dados.investimentos.length === 0 ? (
            <p className="text-sm text-slate-500">Nenhuma posição investida. Cadastre um ativo e registre uma compra para acompanhar o saldo.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-3">
              {dados.investimentos.map((x) => <div key={x.moeda}>
                <p className="text-xs text-slate-500">Saldo em {x.moeda}</p>
                <p className="text-lg font-bold tabular-nums">{formatMoeda(x.valorAtual, x.moeda)}</p>
              </div>)}
            </div>
          )}
          <p className="mt-2 text-xs text-slate-500">Moedas estrangeiras são exibidas separadamente, sem conversão cambial automática.</p>
        </Card>}
        {!m && <p className="mt-2 text-xs text-slate-500" role="status">Resumo do mês indisponível agora; os demais widgets continuam disponíveis.</p>}
      </section>}


      {noInicio && dados.cartoes && dados.cartoes.length > 0 && (
        <Card className="mb-4">
          <div className="flex items-center justify-between">
            <CardTitle>Cartões</CardTitle>
            <Link to="/cartoes" className="mb-3 text-sm font-semibold text-azul hover:underline">Ver cartões</Link>
          </div>
          {dados.faturasDoMes && dados.faturasDoMes.faturas > 0 && (
            <div className="mb-3 rounded-lg bg-fundo p-3" data-testid="faturas-do-mes">
              <p className="text-sm text-slate-500">Faturas que vencem em {formatMonth(mes).replace(/ de \d{4}$/, '')}</p>
              <p className="tabular-nums text-2xl font-bold tracking-tight">{formatBRL(dados.faturasDoMes.total)}</p>
              <p className="text-xs text-slate-500">
                {dados.faturasDoMes.faturas === 1 ? '1 fatura' : `${dados.faturasDoMes.faturas} faturas`}
                {dados.faturasDoMes.pago > 0 && <> · já pago {formatBRL(dados.faturasDoMes.pago)} · falta {formatBRL(dados.faturasDoMes.falta)}</>}
              </p>
            </div>
          )}
          <ul className="divide-y divide-slate-100">
            {dados.cartoes.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-x-3 py-2 text-sm">
                <span className="flex min-w-0 items-center gap-2 font-medium">
                  <IconeEmissor nome={c.nome} emissor={c.emissor} tamanho="pequeno" />{c.nome}<BandeiraCartao bandeira={c.bandeira} />
                </span>
                <span className="text-left sm:text-right">
                  {c.divida > 0 ? (
                    <>
                      <strong className={`tabular-nums ${c.vencida ? 'text-negativo' : ''}`}>{formatBRL(c.divida)}</strong>
                      <span className={c.vencida ? 'ml-2 text-xs font-semibold text-negativo' : 'ml-2 text-xs text-slate-500'}>
                        {c.vencimento ? (c.vencida ? `venceu em ${formatDate(c.vencimento)}` : `vence em ${formatDate(c.vencimento).slice(0, 5)}`) : 'fatura fechada a pagar'}
                      </span>
                    </>
                  ) : (
                    <span className="text-xs text-slate-500">
                      nenhuma fatura fechada a pagar{c.credito > 0 ? ` · crédito de ${formatBRL(c.credito)}` : ''}
                    </span>
                  )}
                  {c.proxima && (
                    <span className="block text-xs text-slate-500">
                      próxima fatura {formatBRL(c.proxima.total)}{c.proxima.vencimento ? ` · vence ${formatDate(c.proxima.vencimento).slice(0, 5)}` : ''}
                    </span>
                  )}
                  {c.limiteDisponivel !== null && (
                    <span className="block text-xs text-slate-500">limite disponível {formatBRL(c.limiteDisponivel)}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {noInicio && dados.orcamentos && dados.orcamentos.length > 0 && <OrcamentosDoInicio orcamentos={dados.orcamentos} />}

      {!noInicio && <>
      {(m || p) ? (
        <section aria-label="Resumo do mês" className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {m && <>
            <Indicador rotulo="Despesas do mês" valor={m.despesas} sinal="−" icone={<SetaBaixo />} corIcone="bg-red-50 text-negativo"
              var={cmp ? variacao(cmp.atual.despesas, cmp.anterior.despesas) : null} subirEhBom={false} comparado={comparadoAteHoje} />
            <Indicador rotulo="Receitas do mês" valor={m.receitas} sinal="+" icone={<SetaCima />} corIcone="bg-green-50 text-positivo"
              var={cmp ? variacao(cmp.atual.receitas, cmp.anterior.receitas) : null} subirEhBom comparado={comparadoAteHoje} />
            <Indicador rotulo="Resultado do mês" valor={m.resultado} icone={<Balanca />} corIcone="bg-azul-claro text-azul"
              var={cmp ? variacao(cmp.atual.resultado, cmp.anterior.resultado) : null} subirEhBom comparado={comparadoAteHoje} negativoVermelho />
          </>}
          {p && (
            <Indicador rotulo="Patrimônio líquido" valor={p.patrimonio} icone={<Cofre />} corIcone="bg-marinho text-celeste" destaque
              detalhes={[['Disponível', p.disponivel], ['Bens', p.bens], ['Dívida', p.divida]]} />
          )}
        </section>
      ) : null}
      {!m && <p className="mb-2 text-sm text-slate-500" role="status">Resumo do mês indisponível agora. O restante da tela continua.</p>}
      {!p && <p className="mb-2 text-sm text-slate-500" role="status">Patrimônio indisponível agora.</p>}
      {p && (
        <p className="mb-2 text-xs text-slate-500">
          Patrimônio = disponível {formatBRL(p.disponivel)} + crédito a receber {formatBRL(p.creditoAReceber)} + bens em BRL {formatBRL(p.bens)} − dívida {formatBRL(p.divida)}.
          Bens em USD/EUR ainda não entram no consolidado. Investimentos são exibidos separadamente até a integração com o caixa.
        </p>
      )}
      {p && p.compromissos > 0 && (
        <div className="mb-4 rounded-card border border-dashed border-slate-300 px-4 py-3 text-sm text-slate-600">
          Compromissos futuros (parcelas de cartão ainda não cobradas): <strong className="tabular-nums">{formatBRL(p.compromissos)}</strong>.
          Não entram no patrimônio de hoje.
        </div>
      )}
      {m && (m.receitasPrevistas > 0 || m.despesasPrevistas > 0) && (
        <p className="mb-4 text-xs text-planejado">Ainda planejado no mês: +{formatBRL(m.receitasPrevistas)} / −{formatBRL(m.despesasPrevistas)}</p>
      )}
      </>}

      {!noInicio && <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>Despesas por categoria</CardTitle>
          {dados.categorias === null || m === null ? (
            <p className="text-sm text-slate-500" role="status">Gráfico indisponível agora.</p>
          ) : dados.categorias.length === 0 ? (
            <p className="text-sm text-slate-500">Nenhuma despesa paga neste mês ainda.</p>
          ) : (
            <Rosca total={m.despesas} fatias={dados.categorias.map((c) => ({
              chave: c.categoriaId ?? 'outros', nome: c.nome, valor: c.valor, percentual: c.percentual, outros: c.categoriaId === null,
            }))} />
          )}
        </Card>

        <Card>
          <CardTitle>Despesas acumuladas no mês</CardTitle>
          {dados.dias === null
            ? <p className="text-sm text-slate-500" role="status">Gráfico indisponível agora. Os valores acima continuam corretos.</p>
            : <LinhaAcumulada pontos={dados.dias} ate={hoje} />}
          {a && m && a.despesas > 0 && (
            <p className="mt-2 rounded-lg bg-azul-claro px-3 py-2 text-sm text-marinho">
              No mês passado inteiro foram {formatBRL(a.despesas)}; neste mês, até hoje, {formatBRL(m.despesas)}.
            </p>
          )}
        </Card>

        {dados.projecao && (dados.projecao.gasto > 0 || dados.projecao.previsto > 0 || dados.projecao.projetado > 0) && (
          <Card className="lg:col-span-2">
            <CardTitle>Projeção do mês</CardTitle>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-sm text-slate-500">Até o fim de {formatMonth(mes)}, no ritmo atual, você terá gasto</p>
                <p className="tabular-nums text-2xl font-bold text-negativo">{formatBRL(dados.projecao.projetado)}</p>
              </div>
              {a && variacao(dados.projecao.projetado, a.despesas) !== null && (
                <p className="text-sm text-slate-600">
                  {(variacao(dados.projecao.projetado, a.despesas) as number) >= 0 ? '▲' : '▼'}{' '}
                  {Math.abs(variacao(dados.projecao.projetado, a.despesas) as number).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%
                  <span className="text-slate-500"> vs {mesAnteriorCurto} inteiro ({formatBRL(a.despesas)})</span>
                </p>
              )}
            </div>
            <ul className="mt-3 divide-y divide-slate-100 text-sm">
              <li className="flex justify-between py-1.5"><span className="text-slate-500">Já gasto</span><span className="tabular-nums font-semibold">{formatBRL(dados.projecao.gasto)}</span></li>
              <li className="flex justify-between py-1.5"><span className="text-slate-500">Já previsto (contas planejadas e parcelas de cartão que ainda vão fechar)</span><span className="tabular-nums font-semibold">{formatBRL(dados.projecao.previsto)}</span></li>
              <li className="flex justify-between py-1.5">
                <span className="text-slate-500">Ritmo do que é variável: {formatBRL(dados.projecao.ritmoPorDia)} por dia × {dados.projecao.diasRestantes} {dados.projecao.diasRestantes === 1 ? 'dia' : 'dias'}</span>
                <span className="tabular-nums font-semibold">{formatBRL(dados.projecao.ritmoRestante)}</span>
              </li>
            </ul>
            <p className="mt-3 text-xs text-slate-500">
              É uma estimativa. Contas recorrentes ficam fora do ritmo (já estão no "previsto").
              {' O ritmo só entra a partir do 7º dia do mês' + (dados.projecao.diasDecorridos < 7 ? ' (hoje é o dia ' + dados.projecao.diasDecorridos + ').' : '.')}
              {' O que você lança como planejado e depois paga entra no ritmo como se fosse gasto contínuo.'}
              {' '}<Link to="/orcamentos" className="font-semibold text-azul hover:underline">Ver por categoria em Orçamentos</Link>.
            </p>
          </Card>
        )}

        {dados.anoPassado && (
          <Card className="lg:col-span-2">
            <CardTitle>Comparação com o ano passado</CardTitle>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {dados.anoPassado.mesAtual && dados.anoPassado.mesAnterior && (
                <BlocoAnual titulo={`${formatMonth(mes)} até o dia ${Number(hoje.slice(8, 10))}`} rotuloAnterior={formatMonth(somarMeses(mes, -12))}
                  atual={dados.anoPassado.mesAtual} anterior={dados.anoPassado.mesAnterior} />
              )}
              {dados.anoPassado.anoAtual && dados.anoPassado.anoAnterior && (
                <BlocoAnual titulo={`Ano até hoje (${hoje.slice(0, 4)})`} rotuloAnterior={`mesmo período de ${Number(hoje.slice(0, 4)) - 1}`}
                  atual={dados.anoPassado.anoAtual} anterior={dados.anoPassado.anoAnterior} />
              )}
            </div>
            <p className="mt-3 text-xs text-slate-500">Mesmos dias nos dois anos, para a comparação ser justa. Cartão conta na data de fechamento da fatura. Só entra o que já está pago: contas ainda planejadas ou fatura que não fechou não aparecem em nenhum dos dois anos.</p>
          </Card>
        )}

        {dados.regularidade?.[0] && dados.regularidade[1] && (
          <Card className="lg:col-span-2">
            <CardTitle>Renda regular × despesas</CardTitle>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <BlocoRegularidade titulo={`Em ${formatMonth(mes)}`} r={dados.regularidade[0]} />
              <BlocoRegularidade titulo="Últimos 12 meses" r={dados.regularidade[1]} />
            </div>
            {dados.regularidade[1].eventual === 0 && dados.regularidade[1].regular > 0 && (
              <p className="mt-3 text-xs text-slate-500">
                Nenhuma receita eventual nos últimos 12 meses. Em <Link to="/categorias" className="font-semibold text-azul hover:underline">Categorias</Link> marque
                13º, férias, PLR e restituição como eventuais para separar a renda que não se repete todo mês.
              </p>
            )}
          </Card>
        )}

      </div>}
      {noInicio && <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card semPadding className="lg:col-span-2">
          <div className="flex items-center justify-between px-5 pt-5">
            <CardTitle>Últimos lançamentos</CardTitle>
            <Link to="/lancamentos" className="mb-3 text-sm font-semibold text-azul hover:underline">Ver todos</Link>
          </div>
          {dados.ultimos.length === 0 ? (
            <p className="px-5 pb-5 text-sm text-slate-500">Nenhum lançamento pago neste mês ainda.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {dados.ultimos.map((l) => (
                <li key={l.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                  <span className="w-12 shrink-0 text-xs text-slate-500">{formatDate(l.data).slice(0, 5)}</span>
                  <IconeDaLinha tipo={l.tipo} categoriaId={l.categoriaId} porId={dados.categoriaPorId} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{l.descricao || (l.tipo === 'income' ? 'Receita' : l.tipo === 'expense' ? 'Despesa' : 'Transferência')}</span>
                    {l.tipo === 'transfer' && <RotaTransferencia contaId={l.contaId} destinoId={l.destinoId} contas={dados.contas} />}
                  </span>
                  {l.categoriaId && (
                    <span className="hidden rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 sm:inline">{dados.nomeCategoria.get(l.categoriaId) ?? 'Sem categoria'}</span>
                  )}
                  <span className={`w-28 text-right tabular-nums font-semibold ${l.tipo === 'income' ? 'text-positivo' : l.tipo === 'expense' ? 'text-negativo' : 'text-slate-600'}`}>
                    {l.tipo === 'income' ? '+' : l.tipo === 'expense' ? '−' : '⇄ '}{formatBRL(l.valor)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardTitle>Próximos planejados</CardTitle>
          {dados.proximos.length === 0 ? (
            <p className="text-sm text-slate-500">Nada planejado a partir de hoje.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {dados.proximos.map((x) => (
                <li key={x.id} className="flex items-center gap-3 py-2 text-sm">
                  <IconeDaLinha tipo={x.tipo} categoriaId={x.categoriaId} porId={dados.categoriaPorId} />
                  <span className="min-w-0 flex-1">
                    {formatDate(x.data)} · {x.descricao || (x.tipo === 'income' ? 'Receita' : x.tipo === 'expense' ? 'Despesa' : 'Transferência')}
                    {x.tipo === 'transfer' && <RotaTransferencia contaId={x.contaId} destinoId={x.destinoId} contas={dados.contas} />}
                  </span>
                  <span className={`tabular-nums font-semibold ${x.tipo === 'income' ? 'text-positivo' : x.tipo === 'expense' ? 'text-negativo' : 'text-slate-600'}`}>
                    {x.tipo === 'income' ? '+' : x.tipo === 'expense' ? '−' : '⇄ '}{formatBRL(x.valor)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardTitle>Contas</CardTitle>
          {dados.contas.length === 0 ? (
            <p className="text-sm text-slate-500">Nenhuma conta ativa. <Link to="/contas" className="font-semibold text-azul hover:underline">Cadastrar conta</Link></p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {dados.contas.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between py-2 text-sm">
                  <span className="flex min-w-0 items-center gap-2"><IconeConta nome={c.nome} tipo={c.tipo} banco={c.banco} tamanho="pequeno" />{c.nome}</span>
                  <span className={`tabular-nums font-semibold ${c.saldo !== null && c.saldo < 0 ? 'text-negativo' : ''}`}>
                    {c.saldo === null ? `abre em ${formatDate(c.abertura)}` : formatBRL(c.saldo)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>}
    </>
  )
}

/** Totais e variação: valores do banco; a % é só a razão entre dois totais. Despesa menor que a do ano passado é bom. */
function BlocoAnual({ titulo, rotuloAnterior, atual, anterior }: { titulo: string; rotuloAnterior: string; atual: ResumoMes; anterior: ResumoMes }) {
  const linhas: { rotulo: string; a: Cents; b: Cents; subirEhBom: boolean }[] = [
    { rotulo: 'Despesas', a: atual.despesas, b: anterior.despesas, subirEhBom: false },
    { rotulo: 'Receitas', a: atual.receitas, b: anterior.receitas, subirEhBom: true },
    { rotulo: 'Resultado', a: atual.resultado, b: anterior.resultado, subirEhBom: true },
  ]
  return (
    <div className="rounded-lg bg-slate-50 px-4 py-3 text-sm">
      <p className="font-semibold">{primeiraMaiuscula(titulo)}</p>
      <p className="text-xs text-slate-500">comparado com {rotuloAnterior}</p>
      <ul className="mt-2 divide-y divide-slate-200">
        {linhas.map((l) => {
          const v = variacao(l.a, l.b)
          // variação que arredonda para 0,0% é "igual": sem seta nem cor
          const igual = v !== null && Math.abs(v) < 0.05
          const bom = v === null || igual ? null : (v >= 0) === l.subirEhBom
          return (
            <li key={l.rotulo} className="flex flex-wrap items-baseline justify-between gap-x-3 py-1.5">
              <span className="text-slate-500">{l.rotulo}</span>
              <span className="tabular-nums">
                <strong>{formatBRL(l.a)}</strong>
                <span className="ml-2 text-xs text-slate-500">antes {formatBRL(l.b)}</span>
                {v !== null && igual && <span className="ml-2 text-xs text-slate-500">= igual</span>}
                {v !== null && !igual && (
                  <span className={`ml-2 text-xs font-semibold ${bom ? 'text-positivo' : 'text-negativo'}`}>
                    {v >= 0 ? '▲' : '▼'} {Math.abs(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%
                  </span>
                )}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** Valores e a % de cobertura vêm do banco (income_regularity); aqui só se apresenta. */
function BlocoRegularidade({ titulo, r }: { titulo: string; r: RegularidadeRenda }) {
  return (
    <div className="rounded-lg bg-slate-50 px-4 py-3 text-sm">
      <p className="font-semibold">{primeiraMaiuscula(titulo)}</p>
      <dl className="mt-2 grid grid-cols-2 gap-y-1">
        <dt className="text-slate-500">Renda regular</dt><dd className="text-right tabular-nums font-semibold text-positivo">{formatBRL(r.regular)}</dd>
        <dt className="text-slate-500">Renda eventual</dt><dd className="text-right tabular-nums font-semibold">{formatBRL(r.eventual)}</dd>
        <dt className="text-slate-500">Despesas</dt><dd className="text-right tabular-nums font-semibold text-negativo">{formatBRL(r.despesas)}</dd>
      </dl>
      <p className="mt-2 text-marinho">
        {r.cobertura === null
          ? 'Sem despesas no período.'
          : <>A renda regular cobre <strong>{r.cobertura.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</strong> das despesas.</>}
      </p>
    </div>
  )
}

function Indicador({ rotulo, valor, sinal, icone, corIcone, var: v, subirEhBom, comparado, destaque = false, negativoVermelho = false, rodape, detalhes }: {
  rotulo: string; valor: Cents; sinal?: '+' | '−'; icone: ReactNode; corIcone: string; var?: number | null; subirEhBom?: boolean
  comparado?: string; destaque?: boolean; negativoVermelho?: boolean; rodape?: string
  /** Composição do valor, uma linha por item (valores do banco; a tela não soma). */
  detalhes?: [string, Cents][]
}) {
  const texto = sinal ? `${sinal}${formatBRL(valor)}` : formatBRL(valor)
  const bom = v === null || v === undefined ? null : (v >= 0) === Boolean(subirEhBom)
  return (
    <Card className={destaque ? '!bg-marinho text-white' : ''}>
      <span className={`mb-3 inline-flex h-10 w-10 items-center justify-center rounded-full ${corIcone}`} aria-hidden="true">{icone}</span>
      <p className={`text-sm ${destaque ? 'text-blue-100' : 'text-slate-500'}`}>{rotulo}</p>
      <p className={`whitespace-nowrap tabular-nums text-base font-bold sm:text-2xl ${destaque && valor < 0 ? 'text-red-300' : negativoVermelho && valor < 0 ? 'text-negativo' : ''}`}>{texto}</p>
      {v !== null && v !== undefined && (
        <p className={`mt-1 text-xs ${bom ? 'text-positivo' : 'text-negativo'}`}>
          {v >= 0 ? '▲' : '▼'} {Math.abs(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% <span className="text-slate-500">vs {comparado}</span>
        </p>
      )}
      {rodape && <p className={`mt-1 text-xs ${destaque ? 'text-blue-100' : 'text-slate-500'}`}>{rodape}</p>}
      {detalhes && (
        <dl className={`mt-3 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 border-t pt-3 text-sm ${destaque ? 'border-white/15 text-blue-100' : 'border-slate-100 text-slate-500'}`}>
          {detalhes.map(([r, c]) => (
            <div key={r} className="contents">
              <dt>{r}</dt>
              <dd className={`text-right tabular-nums font-semibold ${destaque ? 'text-white' : 'text-marinho'}`}>{formatBRL(c)}</dd>
            </div>
          ))}
        </dl>
      )}
    </Card>
  )
}

const Icone = ({ children }: { children: ReactNode }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
)
const SetaBaixo = () => <Icone><path d="M12 5v14M5 12l7 7 7-7" /></Icone>
const SetaCima = () => <Icone><path d="M12 19V5M5 12l7-7 7 7" /></Icone>
const Balanca = () => <Icone><path d="M12 3v18M5 7h14M7 7l-3 7a3 3 0 0 0 6 0L7 7M17 7l-3 7a3 3 0 0 0 6 0l-3-7" /></Icone>
const Cofre = () => <Icone><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M7 6V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1M15 12h2" /></Icone>

/**
 * Transferência: "De → Para" com a logo e o nome de cada banco, para dizer de onde saiu e para onde foi.
 * A conta pode não estar na lista (arquivada): mostra "outra conta" sem logo em vez de esconder a transferência.
 */
function RotaTransferencia({ contaId, destinoId, contas }: { contaId: string | null; destinoId: string | null; contas: Conta[] }) {
  const origem = contas.find((c) => c.id === contaId)
  const destino = contas.find((c) => c.id === destinoId)
  const ponta = (c: Conta | undefined) => (
    <span className="inline-flex min-w-0 items-center gap-1">
      {c && <IconeConta nome={c.nome} tipo={c.tipo} banco={c.banco} tamanho="mini" />}
      <span className="truncate">{c ? c.nome : 'outra conta'}</span>
    </span>
  )
  return (
    <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-slate-500">
      <span className="font-medium text-slate-600">De → Para</span>
      <span className="inline-flex min-w-0 items-center gap-1.5">{ponta(origem)}<span aria-hidden="true">→</span>{ponta(destino)}</span>
    </span>
  )
}

/** Ícone da linha: transferência com setas; receita/despesa com o da categoria. */
function IconeDaLinha({ tipo, categoriaId, porId }: { tipo: 'income' | 'expense' | 'transfer'; categoriaId: string | null; porId: Map<string, Categoria> }) {
  return tipo === 'transfer'
    ? <IconeCategoria fixo="transferencia" tamanho="pequeno" />
    : <IconeCategoria visual={visualPorId(categoriaId, porId, tipo)} tamanho="pequeno" />
}

/** Saldo das contas hoje e o previsto no fim do mês (planejados e faturas descontados); os dois vêm do banco. */
function CardSaldo({ hoje, previsto, fimDoMes }: { hoje: Cents | null; previsto: Cents | null; fimDoMes: string }) {
  return (
    <Card>
      <span className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-full bg-azul-claro text-azul" aria-hidden="true"><Cofre /></span>
      <dl className="grid grid-cols-2 gap-3">
        <div className="min-w-0">
          <dt className="text-sm text-slate-500">Saldo hoje</dt>
          <dd className="whitespace-nowrap tabular-nums text-base font-bold sm:text-xl">{hoje === null ? '—' : formatBRL(hoje)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-sm text-slate-500">Previsto em {formatDate(fimDoMes).slice(0, 5)}</dt>
          <dd className={`whitespace-nowrap tabular-nums text-base font-bold sm:text-xl ${previsto !== null && previsto < 0 ? 'text-negativo' : ''}`}>
            {previsto === null ? '—' : formatBRL(previsto)}
          </dd>
        </div>
      </dl>
      <p className="mt-2 text-xs text-slate-500">
        O previsto já desconta as contas planejadas e as faturas até o fim do mês. <Link to="/calendario" className="font-semibold text-azul hover:underline">Ver no calendário</Link>
      </p>
    </Card>
  )
}

/** Até 4 orçamentos, os mais perto de estourar primeiro (pela fração do limite já gasta; nenhum valor em reais é somado aqui). */
function OrcamentosDoInicio({ orcamentos }: { orcamentos: OrcamentoMes[] }) {
  const usado = (o: OrcamentoMes) => (o.limite > 0 ? o.gasto / o.limite : Infinity)
  const lista = [...orcamentos].sort((x, y) => usado(y) - usado(x)).slice(0, 4)
  return (
    <Card className="mb-4">
      <div className="flex items-center justify-between">
        <CardTitle>Orçamentos do mês</CardTitle>
        <Link to="/orcamentos" className="mb-3 inline-flex min-h-11 items-center text-sm font-semibold text-azul hover:underline">Ver todos</Link>
      </div>
      <ul className="space-y-3">
        {lista.map((o) => {
          // largura da barra: razão entre dois valores do banco (apresentação, não soma de dinheiro)
          const pct = o.limite > 0 ? Math.min(100, Math.round((o.gasto / o.limite) * 100)) : 100
          const estourou = o.gasto > o.limite
          const vaiEstourar = !estourou && o.sobra !== null && o.sobra < 0
          return (
            <li key={o.categoriaId}>
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="min-w-0 truncate font-medium">{o.nome}</span>
                <span className="tabular-nums text-slate-600">{formatBRL(o.gasto)} de {formatBRL(o.limite)}</span>
              </div>
              <div className="mt-1 h-2 rounded-full bg-slate-100" role="progressbar" aria-label={`${o.nome}: ${pct}% do orçamento`}
                aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                <div className={`h-2 rounded-full ${estourou ? 'bg-negativo' : vaiEstourar ? 'bg-amber-500' : 'bg-positivo'}`} style={{ width: `${pct}%` }} />
              </div>
              {estourou && <p className="mt-1 text-xs font-semibold text-negativo">Passou do limite</p>}
              {vaiEstourar && <p className="mt-1 text-xs text-amber-700">No ritmo atual, vai passar do limite</p>}
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

