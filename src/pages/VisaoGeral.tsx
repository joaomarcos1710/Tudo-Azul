import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { LinhaAcumulada } from '../components/graficos/LinhaAcumulada'
import { BarrasCategorias } from '../components/graficos/BarrasCategorias'
import { BalancoMensal } from '../components/graficos/BalancoMensal'
import type { MesBalanco } from '../components/graficos/BalancoMensal'
import { Aviso } from '../components/ui/Aviso'
import { Card, CardTitle } from '../components/ui/Card'
import { BandeiraCartao, IconeConta, IconeEmissor } from '../components/ui/IconeConta'
import { useAuth } from '../lib/auth'
import { useFamilia } from '../lib/FamiliaContext'
import { atualizarAutomaticos } from '../lib/automaticos'
import { resumoDosCartoes, totalFaturasDoMes } from '../lib/cartoes'
import { FaturasDoMes } from '../components/ui/FaturasDoMes'
import type { ResumoCartao, TotalFaturasMes } from '../lib/cartoes'
import { listarCategorias, nomesCompletos } from '../lib/categorias'
import type { Categoria } from '../lib/categorias'
import { IconeCategoria, visualPorId } from '../lib/visualCategoria'
import { hojeSP, listarContas, outrasMoedas, totaisPorMoeda } from '../lib/contas'
import type { Conta, TotalPorMoeda } from '../lib/contas'
import { mensagemErroBanco } from '../lib/erros'
import { currentMonth, formatBRL, formatMoeda, formatDate, formatMonth, primeiraMaiuscula } from '../lib/format'
import type { Cents } from '../lib/format'
import { limitesDoMes, listarLancamentos, mesmoDiaAnoPassado, mesmoDiaMesAnterior, resumoDoMes, resumoDoPeriodo, resumoPorMoeda, somarMeses } from '../lib/lancamentos'
import type { Lancamento, ResumoMes, ResumoPorMoeda } from '../lib/lancamentos'
import { carregarPatrimonio, carregarResumoInvestimentos, evolucaoPatrimonio, despesasPorCategoria, despesasPorDia, proximosPlanejados, projecaoDoMes, regularidadeRenda, vencidosPlanejados } from '../lib/painel'
import type { DespesaCategoria, DespesaDia, Patrimonio, PontoPatrimonio, ProjecaoMes, ProximoPlanejado, RegularidadeRenda, ResumoInvestimento, Vencidos } from '../lib/painel'
import { CabecalhoPagina } from '../components/ui/CabecalhoPagina'
import { SeletorBaseCartao } from '../components/SeletorBaseCartao'
import { guardarBaseGastosCartao, lerBaseGastosCartao } from '../lib/baseGastosCartao'
import type { BaseGastosCartao } from '../lib/baseGastosCartao'
import { CabecalhoInicio } from '../components/ui/CabecalhoInicio'
import { AvisosInicio } from '../components/ui/AvisosInicio'
import { avisosDoInicio } from '../lib/avisosInicio'
import type { AvisoInicio } from '../lib/avisosInicio'
import { EmOutrasMoedas, ResultadoEmOutrasMoedas } from '../components/ui/EmOutrasMoedas'
import { LinhaMensal } from '../components/graficos/LinhaMensal'
import { saldosProjetados } from '../lib/saldoProjetado'
import { fluxoDeCaixa } from '../lib/fluxoCaixa'
import type { SaldoTotal } from '../lib/saldoProjetado'
import { listarOrcamentos } from '../lib/orcamentos'
import type { OrcamentoMes } from '../lib/orcamentos'
import { corDoTipo, corDoValor } from '../lib/cores'
import { carregarIndicadores } from '../lib/indicadores'
import type { Indicadores } from '../lib/indicadores'
import { FaixaIndicadores } from '../components/ui/FaixaIndicadores'

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
  /** Todas as contas, inclusive arquivadas: só para dar nome às pontas de uma transferência antiga. */
  todasContas: Conta[]
  /** Soma do saldo das contas EM REAIS, do banco (balance_totals); null fora do Início. */
  saldoGeral: Cents | null
  /** Saldo das contas por moeda, sem conversão (balance_totals_by_currency); vazio = só reais ou não carregou. */
  porMoeda: TotalPorMoeda[]
  /** Receitas e despesas pagas do mês em outras moedas, sem conversão (period_summary_by_currency); vazio = só reais ou não carregou. */
  mesPorMoeda: ResumoPorMoeda[]
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
  /** Início: saldo previsto no fim do mês de cada conta, na moeda dela (account_balances_projected); null = não carregou. */
  /** Análises: receitas, despesas e resultado pagos dos últimos 6 meses, em reais (cash_flow_report por mês); null = não carregou. */
  balanco: MesBalanco[] | null
  /** Análises: patrimônio e saldo no fim de cada um dos últimos 12 meses (do banco); null = não carregou. */
  evolucao: PontoPatrimonio[] | null
  /** Orçamentos do mês (do banco); null = não carregou. */
  orcamentos: OrcamentoMes[] | null
  /** Avisos do topo do Início (home_alerts, do banco); null = não carregou (a faixa some, o resto segue). */
  avisos: AvisoInicio[] | null
  /** Início: os 7 indicadores do topo (home_indicators, migration 071); null = não carregou ou é Análises. */
  indicadores: Indicadores | null
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

/** Painel: todo valor em reais vem calculado do banco (net_worth, period_summary, expenses_by_category, daily_expenses, cash_flow_report, account_balances_projected). */
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
  // Análises: base dos gastos de cartão SÓ no gráfico por categoria (migration 062); guardada neste aparelho.
  // Trocar a base recarrega só o gráfico; a ref deixa a carga da tela usar a base atual sem depender dela.
  const [baseCartao, setBaseCartao] = useState<BaseGastosCartao>(lerBaseGastosCartao)
  const baseCartaoRef = useRef(baseCartao)
  const trocaBaseRef = useRef(0)
  const [categoriasCarregando, setCategoriasCarregando] = useState(false)
  const hoje = hojeSP()
  const mes = currentMonth()
  // até dois nomes ("João Marcos"), como no cabeçalho do Organizze
  const nome = ((sessao?.user?.user_metadata?.name as string | undefined) ?? '').trim().split(/\s+/).slice(0, 2).join(' ')

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
            // a faixa de indicadores do topo (#187): os 7 números numa chamada só, calculados no banco
            opcional(carregarIndicadores(familiaId, hoje)),
            // receita e despesa do mês, com o que ainda vai entrar e sair: só no cabeçalho
            opcional(resumoDoMes(familiaId, mes)),
            // "posso gastar?": o mesmo saldo projetado do Calendário, até o último dia do mês
            opcional(saldosProjetados(familiaId, ate, true)), opcional(listarOrcamentos(familiaId, mes, hoje)),
            opcional(resumoPorMoeda(familiaId, de, ate)), opcional(avisosDoInicio(familiaId, hoje)),
          ]).then(([c, proximos, lancs, cats, vencidos, cartoes, faturasDoMes, indicadores, resumo, projetado, orcamentos, mesPorMoeda, avisos]): Dados => ({
            patrimonio: null, investimentos: null, mes: resumo, anterior: null, comparacao: null, indicadores,
            categorias: null, dias: null, regularidade: null, anoPassado: null, projecao: null,
            contas: c.contas.filter((x) => x.ativa), todasContas: c.contas, saldoGeral: c.total, porMoeda: c.porMoeda ?? [], mesPorMoeda: mesPorMoeda ?? [], proximos, vencidos, cartoes, faturasDoMes,
            saldoPrevisto: projetado?.total ?? null, balanco: null,
            orcamentos, avisos, evolucao: null,
            ultimos: lancs.filter((l) => l.status === 'paid').slice(0, 6),
            nomeCategoria: nomesCompletos(cats),
            categoriaPorId: new Map(cats.map((x) => [x.id, x])),
          }))
        : Promise.all([
            // Análises: cada consulta é opcional; um bloco que falha some, o resto segue
            opcional(carregarPatrimonio(familiaId, hoje)), opcional(carregarResumoInvestimentos(familiaId, hoje)),
            opcional(resumoDoMes(familiaId, mes)), opcional(resumoDoMes(familiaId, somarMeses(mes, -1))),
            // as 6 maiores categorias + "Outros" (somado no banco)
            opcional(despesasPorCategoria(familiaId, de, ate, 6, baseCartaoRef.current)), opcional(despesasPorDia(familiaId, de, ate)),
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
            opcional(projecaoDoMes(familiaId, mes, hoje)), comparar(), opcional(evolucaoPatrimonio(familiaId, hoje)),
            opcional(totaisPorMoeda(familiaId, hoje)), opcional(resumoPorMoeda(familiaId, de, ate)),
            // balanço dos últimos 6 meses: um balde por mês, com o resultado do mês já calculado no banco
            opcional(fluxoDeCaixa(familiaId, limitesDoMes(somarMeses(mes, -5))[0], ate, 'month').then((f): MesBalanco[] => f.linhas.map((l) => ({
              mes: l.inicio.slice(0, 7), receitas: l.entradas, despesas: l.saidas, resultado: l.saldo,
            })))),
          ]).then(([patrimonio, investimentos, resumo, anterior, categorias, dias, regularidade, anoPassado, projecao, comparacao, evolucao, porMoeda, mesPorMoeda, balanco]): Dados => ({
            patrimonio, investimentos, mes: resumo, anterior, comparacao, categorias, dias, regularidade, anoPassado, projecao,
            contas: [], todasContas: [], saldoGeral: null, porMoeda: porMoeda ?? [], mesPorMoeda: mesPorMoeda ?? [], proximos: [], vencidos: null, cartoes: null, faturasDoMes: null, saldoPrevisto: null, balanco, orcamentos: null, avisos: null, indicadores: null, evolucao, ultimos: [], nomeCategoria: new Map(), categoriaPorId: new Map(),
          })))
      .then((d) => { if (ativo) setDados(d) })
      .catch((err) => { if (ativo) setErro(mensagemErroBanco(err)) })
    return () => { ativo = false }
  }, [familiaId, hoje, mes, noInicio])

  function trocarBaseCartao(base: BaseGastosCartao) {
    if (!familiaId || base === baseCartao) return
    setBaseCartao(base)
    baseCartaoRef.current = base
    guardarBaseGastosCartao(base)
    // troca rápida: só a resposta da última escolha vale
    const vez = ++trocaBaseRef.current
    const [de, ate] = limitesDoMes(mes)
    setCategoriasCarregando(true)
    despesasPorCategoria(familiaId, de, ate, 6, base).catch(() => null).then((categorias) => {
      if (trocaBaseRef.current !== vez) return
      setCategoriasCarregando(false)
      setDados((d) => (d ? { ...d, categorias } : d))
    })
  }

  if (!familiaId) return null
  if (erro) return <Aviso tipo="erro">{erro}</Aviso>
  if (!dados) return <p className="text-sm text-slate-600" role="status">Carregando…</p>

  // null = não carregou; o bloco correspondente some e o resto da tela segue
  const { patrimonio: p, mes: m, anterior: a, comparacao: cmp } = dados
  // valor de um lançamento na moeda da conta dele (multimoeda F2); parcela de dívida e sem conta = reais
  const moedaDe = (contaId: string | null) => dados.todasContas.find((c) => c.id === contaId)?.moeda ?? 'BRL'
  // "Minhas contas" do Início: só as ativas com saldo de hoje OU previsto no fim do mês (os dois do banco) diferente de
  // zero; a lista completa fica na aba Contas. Conta que ainda não abriu (saldo null) continua aparecendo, com a data de abertura.
  const contasComSaldo = dados.contas.filter((c) => c.saldo !== 0)
  const mesAnteriorCurto = formatMonth(somarMeses(mes, -1)).split(' ')[0].slice(0, 3)
  const comparadoAteHoje = `${mesAnteriorCurto} até dia ${Number(mesmoDiaMesAnterior(hoje).slice(8))}`
  return (
    <>
      {/* avisos do topo (a receber, a pagar, fatura e vencidos): só aparecem quando há algo a dizer */}
      {noInicio && dados.avisos && <AvisosInicio avisos={dados.avisos} hoje={hoje} />}
      {noInicio
        ? <CabecalhoInicio nome={nome} receitas={m?.receitas ?? null} despesas={m?.despesas ?? null}
          aReceber={m?.receitasPrevistas ?? null} aPagar={m?.despesasPrevistas ?? null} />
        : <CabecalhoPagina titulo="Análises" descricao={`Como as finanças da família estão indo em ${primeiraMaiuscula(formatMonth(mes))}.`} />}
      {/* #187: os 7 indicadores logo abaixo do cabeçalho; substituem os widgets personalizáveis, o card de investimentos e a nota do patrimônio */}
      {noInicio && <FaixaIndicadores dados={dados.indicadores} />}
      {/* receitas e despesas do mês em outras moedas: à parte, nunca somadas aos totais em reais acima */}
      <ResultadoEmOutrasMoedas porMoeda={dados.mesPorMoeda} className="mb-4 rounded-xl border border-slate-200 bg-white px-4 py-3" />
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
        <Card id="vencidos" className="mb-4 scroll-mt-4 !border !border-prejuizo-borda">
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
                      <span className="ml-2 text-xs text-prejuizo">{atraso === 1 ? 'venceu ontem' : `venceu há ${atraso} dias`}</span>
                      {x.tipo === 'transfer' && <RotaTransferencia contaId={x.contaId} destinoId={x.destinoId} contas={dados.todasContas} />}
                    </span>
                    <span className={`tabular-nums font-semibold ${corDoTipo(x.tipo)}`}>
                      {x.tipo === 'income' ? '+' : x.tipo === 'expense' ? '−' : '⇄ '}{formatMoeda(x.valor, moedaDe(x.contaId))}
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

      {noInicio && dados.cartoes && dados.cartoes.length > 0 && (
        <Card className="mb-4">
          <div className="flex items-center justify-between">
            <CardTitle>Cartões</CardTitle>
            <Link to="/cartoes" className="mb-3 text-sm font-semibold text-azul hover:underline">Ver cartões</Link>
          </div>
          <FaturasDoMes mes={mes} dados={dados.faturasDoMes} className="mb-3" />
          <ul className="space-y-3">
            {dados.cartoes.map((c) => (
              <li key={c.id} className="rounded-lg border border-slate-100 p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2 font-medium">
                    <IconeEmissor nome={c.nome} emissor={c.emissor} tamanho="pequeno" />{c.nome}<BandeiraCartao bandeira={c.bandeira} />
                  </span>
                  <Link to="/cartoes" className="inline-flex min-h-11 items-center text-xs font-semibold text-azul hover:underline">Ver fatura</Link>
                </div>
                {/* como no Organizze: limite disponível ao lado da fatura atual (aberta) */}
                <dl className="mt-1 grid grid-cols-2 gap-3 rounded-lg bg-fundo p-2">
                  <div className="min-w-0">
                    <dt className="text-xs text-slate-500">Limite disponível</dt>
                    <dd className="tabular-nums font-semibold">{c.limiteDisponivel === null ? '—' : formatBRL(c.limiteDisponivel)}</dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-xs text-slate-500">Fatura atual{c.proxima?.vencimento ? ` · vence ${formatDate(c.proxima.vencimento).slice(0, 5)}` : ''}</dt>
                    <dd className="tabular-nums font-semibold">{c.proxima ? formatBRL(c.proxima.total) : '—'}</dd>
                  </div>
                </dl>
                {c.divida > 0 && (
                  <p className={`mt-2 text-xs ${c.vencida ? 'font-semibold text-prejuizo' : 'text-atencao'}`}>
                    Fatura fechada a pagar <strong className="tabular-nums">{formatBRL(c.divida)}</strong>
                    {c.vencimento && (c.vencida ? ` · venceu em ${formatDate(c.vencimento)}` : ` · vence em ${formatDate(c.vencimento).slice(0, 5)}`)}
                  </p>
                )}
                {c.divida === 0 && c.credito > 0 && <p className="mt-2 text-xs text-slate-500">Crédito no cartão de {formatBRL(c.credito)}</p>}
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
            <Indicador rotulo="Despesas do mês" valor={m.despesas} sinal="−" icone={<SetaBaixo />} corIcone="bg-prejuizo-fundo text-prejuizo"
              var={cmp ? variacao(cmp.atual.despesas, cmp.anterior.despesas) : null} subirEhBom={false} comparado={comparadoAteHoje} />
            <Indicador rotulo="Receitas do mês" valor={m.receitas} sinal="+" icone={<SetaCima />} corIcone="bg-lucro-fundo text-lucro"
              var={cmp ? variacao(cmp.atual.receitas, cmp.anterior.receitas) : null} subirEhBom comparado={comparadoAteHoje} />
            <Indicador rotulo="Resultado do mês" valor={m.resultado} icone={<Balanca />} corIcone="bg-azul-claro text-azul"
              var={cmp ? variacao(cmp.atual.resultado, cmp.anterior.resultado) : null} subirEhBom comparado={comparadoAteHoje} corPeloSinal />
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
          Bens em USD/EUR e contas em outras moedas ainda não entram no consolidado. Investimentos são exibidos separadamente até a integração com o caixa.
        </p>
      )}
      {p && <EmOutrasMoedas porMoeda={dados.porMoeda} className="mb-4" />}
      {p && p.compromissos > 0 && (
        <div className="mb-4 rounded-card border border-dashed border-slate-300 px-4 py-3 text-sm text-slate-600">
          Compromissos futuros (parcelas de cartão ainda não cobradas): <strong className="tabular-nums">{formatBRL(p.compromissos)}</strong>.
          Não entram no patrimônio de hoje.
        </div>
      )}
      {m && (m.receitasPrevistas > 0 || m.despesasPrevistas > 0) && (
        <p className="mb-4 text-xs text-agendado">Ainda planejado no mês: +{formatBRL(m.receitasPrevistas)} / −{formatBRL(m.despesasPrevistas)}</p>
      )}
      </>}

      {!noInicio && dados.evolucao && dados.evolucao.length > 1 && (
        // dois gráficos, um por medida: patrimônio (centenas de mil) e saldo (milhares) num eixo só achatariam o saldo
        <section aria-label="Evolução nos últimos 12 meses" className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardTitle>Patrimônio líquido mês a mês</CardTitle>
            <LinhaMensal titulo="Patrimônio líquido" pontos={dados.evolucao.map((x) => ({ mes: x.mes, valor: x.patrimonio }))} />
          </Card>
          <Card>
            <CardTitle>Saldo das contas mês a mês</CardTitle>
            <LinhaMensal titulo="Saldo das contas" pontos={dados.evolucao.map((x) => ({ mes: x.mes, valor: x.disponivel }))} />
          </Card>
          <p className="text-xs text-slate-500 lg:col-span-2">Cada ponto é o valor no último dia do mês (no mês atual, hoje), com saldo, dívidas e bens como estavam naquela data.</p>
        </section>
      )}

      {!noInicio && <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>Despesas por categoria</CardTitle>
          <SeletorBaseCartao valor={baseCartao} onChange={trocarBaseCartao} />
          {categoriasCarregando ? (
            <p className="text-sm text-slate-500" role="status">Carregando…</p>
          ) : dados.categorias === null ? (
            <p className="text-sm text-slate-500" role="status">Gráfico indisponível agora.</p>
          ) : dados.categorias.length === 0 ? (
            <p className="text-sm text-slate-500">Nenhuma despesa paga neste mês ainda.</p>
          ) : (
            <>
              <p className="mb-2 text-xs text-slate-500">{primeiraMaiuscula(formatMonth(mes))} · {baseCartao === 'invoice' ? 'só o que já foi pago, em reais' : 'em reais, com as compras no cartão pela base escolhida'}. Toque numa categoria para ver as despesas do mês.</p>
              <BarrasCategorias barras={dados.categorias} mes={mes} />
            </>
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

        <Card className="lg:col-span-2">
          <CardTitle>Balanço dos últimos 6 meses</CardTitle>
          {dados.balanco === null ? (
            <p className="text-sm text-slate-500" role="status">Gráfico indisponível agora.</p>
          ) : (
            <>
              <BalancoMensal meses={dados.balanco} />
              <p className="mt-2 text-xs text-slate-500">
                Só o que já foi pago, em reais (o mês atual vai até hoje). Cartão conta no fechamento da fatura.
                {outrasMoedas(dados.porMoeda).length > 0 && ' Contas em outras moedas ficam fora deste gráfico.'}
              </p>
            </>
          )}
        </Card>

        {dados.projecao && (dados.projecao.gasto > 0 || dados.projecao.previsto > 0 || dados.projecao.projetado > 0) && (
          <Card className="lg:col-span-2">
            <CardTitle>Projeção do mês</CardTitle>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-sm text-slate-500">Até o fim de {formatMonth(mes)}, no ritmo atual, você terá gasto</p>
                <p className="tabular-nums text-2xl font-bold text-prejuizo">{formatBRL(dados.projecao.projetado)}</p>
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
                    {l.tipo === 'transfer' && <RotaTransferencia contaId={l.contaId} destinoId={l.destinoId} contas={dados.todasContas} />}
                  </span>
                  {l.categoriaId && (
                    <span className="hidden rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 sm:inline">{dados.nomeCategoria.get(l.categoriaId) ?? 'Sem categoria'}</span>
                  )}
                  <span className={`w-28 text-right tabular-nums font-semibold ${corDoTipo(l.tipo)}`}>
                    {l.tipo === 'income' ? '+' : l.tipo === 'expense' ? '−' : '⇄ '}{formatMoeda(l.valor, moedaDe(l.contaId))}
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
                    {x.tipo === 'transfer' && <RotaTransferencia contaId={x.contaId} destinoId={x.destinoId} contas={dados.todasContas} />}
                  </span>
                  <span className={`tabular-nums font-semibold ${corDoTipo(x.tipo)}`}>
                    {x.tipo === 'income' ? '+' : x.tipo === 'expense' ? '−' : '⇄ '}{formatMoeda(x.valor, moedaDe(x.contaId))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <div className="flex items-start justify-between gap-3">
            <CardTitle>Minhas contas</CardTitle>
            {dados.saldoGeral !== null && dados.contas.length > 0 && (
              <p className="text-right"><span className="block text-xs text-slate-500">{outrasMoedas(dados.porMoeda).length > 0 ? 'Saldo geral em reais' : 'Saldo geral'}</span>
                <span className={`tabular-nums font-bold ${corDoValor(dados.saldoGeral)}`}>{formatBRL(dados.saldoGeral)}</span></p>
            )}
          </div>
          {dados.contas.length === 0 ? (
            <p className="text-sm text-slate-500">Nenhuma conta ativa. <Link to="/contas" className="font-semibold text-azul hover:underline">Cadastrar conta</Link></p>
          ) : contasComSaldo.length === 0 ? (
            <p className="text-sm text-slate-500">Todas as contas estão zeradas.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {contasComSaldo.map((c) => (
                // só o saldo de hoje, numa linha (pedido do dono, 05/11/2026: "Hoje · Fim do mês" por conta ficava poluído);
                // o previsto do mês continua no total ("posso gastar?") e no Calendário
                <li key={c.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="flex min-w-0 items-center gap-2"><IconeConta nome={c.nome} tipo={c.tipo} banco={c.banco} tamanho="pequeno" />
                    <span className="truncate">{c.nome}</span></span>
                  {c.saldo === null ? (
                    <span className="shrink-0 tabular-nums font-semibold">abre em {formatDate(c.abertura)}</span>
                  ) : (
                    <span data-testid="saldos-da-conta" className={`shrink-0 whitespace-nowrap tabular-nums font-semibold ${corDoValor(c.saldo)}`}>
                      {formatMoeda(c.saldo, c.moeda ?? 'BRL')}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {/* #187: o previsto do fim do mês ("posso gastar?") saiu do card "Saldo hoje e previsto" e ficou aqui, uma linha */}
          {dados.saldoPrevisto && dados.contas.length > 0 && (
            <p className="mt-2 flex flex-wrap items-baseline justify-between gap-x-3 border-t border-slate-100 pt-2 text-sm">
              <span className="text-slate-500">Previsto em {formatDate(limitesDoMes(mes)[1]).slice(0, 5)}
                <span className="block text-xs">com planejados, fixos e faturas até o fim do mês</span></span>
              <span className={`ml-auto whitespace-nowrap tabular-nums font-semibold ${corDoValor(dados.saldoPrevisto.saldo)}`}>{formatBRL(dados.saldoPrevisto.saldo)}</span>
            </p>
          )}
          <EmOutrasMoedas porMoeda={dados.porMoeda} className="mt-2 border-t border-slate-100 pt-2" />
          {dados.contas.length > 0 && (
            <div className="flex flex-wrap gap-x-4">
              <Link to="/contas" className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-azul hover:underline">Ver todas as contas</Link>
              <Link to="/calendario" className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-azul hover:underline">Ver no calendário</Link>
            </div>
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
                  <span className={`ml-2 text-xs font-semibold ${bom ? 'text-lucro' : 'text-prejuizo'}`}>
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
        <dt className="text-slate-500">Renda regular</dt><dd className="text-right tabular-nums font-semibold text-lucro">{formatBRL(r.regular)}</dd>
        <dt className="text-slate-500">Renda eventual</dt><dd className="text-right tabular-nums font-semibold">{formatBRL(r.eventual)}</dd>
        <dt className="text-slate-500">Despesas</dt><dd className="text-right tabular-nums font-semibold text-prejuizo">{formatBRL(r.despesas)}</dd>
      </dl>
      <p className="mt-2 text-marinho">
        {r.cobertura === null
          ? 'Sem despesas no período.'
          : <>A renda regular cobre <strong>{r.cobertura.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</strong> das despesas.</>}
      </p>
    </div>
  )
}

function Indicador({ rotulo, valor, sinal, icone, corIcone, var: v, subirEhBom, comparado, destaque = false, corPeloSinal = false, rodape, detalhes }: {
  rotulo: string; valor: Cents; sinal?: '+' | '−'; icone: ReactNode; corIcone: string; var?: number | null; subirEhBom?: boolean
  comparado?: string; destaque?: boolean; corPeloSinal?: boolean; rodape?: string
  /** Composição do valor, uma linha por item (valores do banco; a tela não soma). */
  detalhes?: [string, Cents][]
}) {
  const texto = sinal ? `${sinal}${formatBRL(valor)}` : formatBRL(valor)
  const bom = v === null || v === undefined ? null : (v >= 0) === Boolean(subirEhBom)
  return (
    <Card className={destaque ? '!bg-marinho text-white' : ''}>
      <span className={`mb-3 inline-flex h-10 w-10 items-center justify-center rounded-full ${corIcone}`} aria-hidden="true">{icone}</span>
      <p className={`text-sm ${destaque ? 'text-blue-100' : 'text-slate-500'}`}>{rotulo}</p>
      <p className={`whitespace-nowrap tabular-nums text-base font-bold sm:text-2xl ${destaque && valor < 0 ? 'text-prejuizo-sobre-escuro' : corPeloSinal ? corDoValor(valor) : ''}`}>{texto}</p>
      {v !== null && v !== undefined && (
        <p className={`mt-1 text-xs ${bom ? 'text-lucro' : 'text-prejuizo'}`}>
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
 * Transferência: "De <conta> → Para <conta>" com a logo e o nome de cada banco, para dizer de onde saiu e para onde foi.
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
      {/* "De Mercado Pago → Para Caixa": cada palavra junto da sua conta (pedido do dono) */}
      <span className="font-medium text-slate-600">De</span>{ponta(origem)}
      <span aria-hidden="true">→</span>
      <span className="font-medium text-slate-600">Para</span>{ponta(destino)}
    </span>
  )
}

/** Ícone da linha: transferência com setas; receita/despesa com o da categoria. */
function IconeDaLinha({ tipo, categoriaId, porId }: { tipo: 'income' | 'expense' | 'transfer'; categoriaId: string | null; porId: Map<string, Categoria> }) {
  return tipo === 'transfer'
    ? <IconeCategoria fixo="transferencia" tamanho="pequeno" />
    : <IconeCategoria visual={visualPorId(categoriaId, porId, tipo)} tamanho="pequeno" />
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
                <div className={`h-2 rounded-full ${estourou ? 'bg-prejuizo-marca' : vaiEstourar ? 'bg-atencao-marca' : 'bg-lucro-marca'}`} style={{ width: `${pct}%` }} />
              </div>
              {estourou && <p className="mt-1 text-xs font-semibold text-prejuizo">Passou do limite</p>}
              {vaiEstourar && <p className="mt-1 text-xs text-atencao">Atenção: no ritmo atual, vai passar do limite</p>}
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

