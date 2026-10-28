import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { LinhaAcumulada } from '../components/graficos/LinhaAcumulada'
import { Rosca } from '../components/graficos/Rosca'
import { IconeCartoes, IconeSomar, IconeSubtrair, IconeTransferir } from '../components/layout/icons'
import { Aviso } from '../components/ui/Aviso'
import { Card, CardTitle } from '../components/ui/Card'
import { useAuth } from '../lib/auth'
import { useFamilia } from '../lib/FamiliaContext'
import { atualizarAutomaticos } from '../lib/automaticos'
import { resumoDosCartoes } from '../lib/cartoes'
import type { ResumoCartao } from '../lib/cartoes'
import { ultimasConferencias } from '../lib/conciliacao'
import { listarCategorias } from '../lib/categorias'
import type { Categoria } from '../lib/categorias'
import { IconeCategoria, visualPorId } from '../lib/visualCategoria'
import { hojeSP, listarContas } from '../lib/contas'
import type { Conta } from '../lib/contas'
import { mensagemErroBanco } from '../lib/erros'
import { currentMonth, formatBRL, formatDate, formatMonth, primeiraMaiuscula } from '../lib/format'
import type { Cents } from '../lib/format'
import { limitesDoMes, listarLancamentos, mesmoDiaAnoPassado, resumoDoMes, resumoDoPeriodo, somarMeses } from '../lib/lancamentos'
import type { Lancamento, ResumoMes } from '../lib/lancamentos'
import { carregarPatrimonio, despesasPorCategoria, despesasPorDia, proximosPlanejados, projecaoDoMes, regularidadeRenda, vencidosPlanejados } from '../lib/painel'
import type { DespesaCategoria, DespesaDia, Patrimonio, ProjecaoMes, ProximoPlanejado, RegularidadeRenda, Vencidos } from '../lib/painel'
import { CabecalhoPagina } from '../components/ui/CabecalhoPagina'

/**
 * Cada tela carrega só o que mostra. Início: contas, lançamentos e planejados são essenciais (se falharem, a tela
 * avisa o erro); o resto é opcional. Análises: tudo é opcional — cada bloco some sozinho se a consulta dele falhar.
 * Campo da outra tela fica vazio (não é consultado).
 */
interface Dados {
  /** null = não carregou (ou não é desta tela) */
  patrimonio: Patrimonio | null
  mes: ResumoMes | null
  anterior: ResumoMes | null
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
  /** data da última conferência de cada conta (conta ausente = nunca conferida); null = não carregou */
  conferencias: Map<string, string> | null
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

// ações rápidas: painéis-botão do mesmo tamanho, com ícone; o ícone e a palavra dizem o tipo (a cor só reforça)
// celular: ícone em cima e rótulo embaixo ("Transferência" não cabe ao lado do ícone em 320px); a partir de sm, lado a lado
// 4 colunas só em xl: com o menu lateral, 4 colunas no iPad deixariam ~75px para o rótulo
const atalho = 'flex flex-col items-start gap-2 rounded-card bg-white p-3 text-sm font-semibold text-marinho shadow-card transition-colors hover:bg-azul-claro sm:min-h-14 sm:flex-row sm:items-center sm:gap-3 sm:py-0'
const atalhoIcone = 'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg'

function saudacao(agora = new Date()): string {
  const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hourCycle: 'h23' }).format(agora))
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'
}

/**
 * Variação percentual em relação ao mês anterior (apresentação: razão entre dois totais que já vêm
 * do banco; nenhum valor em reais é somado aqui). null quando não há base de comparação.
 */
function variacao(atual: Cents, anterior: Cents): number | null {
  if (anterior === 0) return null
  return ((atual - anterior) / Math.abs(anterior)) * 100
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
  const nome = ((sessao?.user?.user_metadata?.name as string | undefined) ?? '').trim().split(/\s+/)[0]

  useEffect(() => {
    if (!familiaId) return
    const [de, ate] = limitesDoMes(mes)
    const opcional = <T,>(p: Promise<T>) => p.catch(() => null)
    // gera recorrentes e cobra faturas fechadas; se falhar, o painel mostra o que já está gravado, com aviso
    atualizarAutomaticos()
      .then((r) => { setCobrancaFalhou(!r.faturasOk); setRecorrentesFalhou(!r.recorrentesOk) })
      .then(() => noInicio
        ? Promise.all([
            // essenciais do Início: se falharem, a tela inteira avisa o erro
            listarContas(familiaId, hoje), proximosPlanejados(familiaId, hoje), listarLancamentos(familiaId, mes), listarCategorias(familiaId),
            opcional(vencidosPlanejados(familiaId, hoje, 5)), opcional(resumoDosCartoes(familiaId, hoje)), opcional(ultimasConferencias(familiaId)),
          ]).then(([c, proximos, lancs, cats, vencidos, cartoes, conferencias]): Dados => ({
            patrimonio: null, mes: null, anterior: null, categorias: null, dias: null, regularidade: null, anoPassado: null, projecao: null,
            contas: c.contas.filter((x) => x.ativa), proximos, vencidos, cartoes, conferencias,
            ultimos: lancs.filter((l) => l.status === 'paid').slice(0, 6),
            nomeCategoria: new Map(cats.map((x) => [x.id, x.nome])),
            categoriaPorId: new Map(cats.map((x) => [x.id, x])),
          }))
        : Promise.all([
            // Análises: cada consulta é opcional; um bloco que falha some, o resto segue
            opcional(carregarPatrimonio(familiaId, hoje)), opcional(resumoDoMes(familiaId, mes)), opcional(resumoDoMes(familiaId, somarMeses(mes, -1))),
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
            opcional(projecaoDoMes(familiaId, mes, hoje)),
          ]).then(([patrimonio, resumo, anterior, categorias, dias, regularidade, anoPassado, projecao]): Dados => ({
            patrimonio, mes: resumo, anterior, categorias, dias, regularidade, anoPassado, projecao,
            contas: [], proximos: [], vencidos: null, cartoes: null, conferencias: null, ultimos: [], nomeCategoria: new Map(), categoriaPorId: new Map(),
          })))
      .then(setDados)
      .catch((err) => setErro(mensagemErroBanco(err)))
  }, [familiaId, hoje, mes, noInicio])

  if (!familiaId) return null
  if (erro) return <Aviso tipo="erro">{erro}</Aviso>
  if (!dados) return <p className="text-sm text-slate-600" role="status">Carregando…</p>

  // null = não carregou; o bloco correspondente some e o resto da tela segue
  const { patrimonio: p, mes: m, anterior: a } = dados
  const mesAnteriorCurto = formatMonth(somarMeses(mes, -1)).split(' ')[0].slice(0, 3)
  return (
    <>
      <CabecalhoPagina titulo={noInicio ? `${saudacao()}${nome ? `, ${nome}` : ''}!` : 'Análises'}
        descricao={noInicio ? 'O que pede atenção agora na família.' : `Como as finanças da família estão indo em ${primeiraMaiuscula(formatMonth(mes))}.`} />
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

      {noInicio && <section aria-label="Ações rápidas" className="mb-4 grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4">
        <Link to="/lancamentos?novo=despesa" className={atalho}><span className={`${atalhoIcone} bg-red-50 text-negativo`}><IconeSubtrair /></span>Despesa</Link>
        <Link to="/lancamentos?novo=receita" className={atalho}><span className={`${atalhoIcone} bg-green-50 text-positivo`}><IconeSomar /></span>Receita</Link>
        <Link to="/lancamentos?novo=transferencia" className={atalho}><span className={`${atalhoIcone} bg-azul-claro text-azul`}><IconeTransferir /></span>Transferência</Link>
        <Link to="/lancamentos?novo=cartao" className={atalho}><span className={`${atalhoIcone} bg-azul-claro text-azul`}><IconeCartoes /></span>Compra no cartão</Link>
      </section>}

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
                  <Link to={`/lancamentos?mes=${x.data.slice(0, 7)}`} className="flex items-center gap-3 py-2 text-sm hover:bg-slate-50">
                    <IconeDaLinha tipo={x.tipo} categoriaId={x.categoriaId} porId={dados.categoriaPorId} />
                    <span className="min-w-0 flex-1">
                      {formatDate(x.data).slice(0, 5)} · {x.descricao || (x.tipo === 'income' ? 'Receita' : x.tipo === 'expense' ? 'Despesa' : 'Transferência')}
                      <span className="ml-2 text-xs text-negativo">{atraso === 1 ? 'venceu ontem' : `venceu há ${atraso} dias`}</span>
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

      {noInicio && dados.cartoes && dados.cartoes.length > 0 && (
        <Card className="mb-4">
          <div className="flex items-center justify-between">
            <CardTitle>Cartões</CardTitle>
            <Link to="/cartoes" className="mb-3 text-sm font-semibold text-azul hover:underline">Ver cartões</Link>
          </div>
          <ul className="divide-y divide-slate-100">
            {dados.cartoes.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-x-3 py-2 text-sm">
                <span className="font-medium">{c.nome}</span>
                <span className="text-right">
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
                  {c.limiteDisponivel !== null && (
                    <span className="block text-xs text-slate-500">limite disponível {formatBRL(c.limiteDisponivel)}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {!noInicio && <>
      {(m || p) ? (
        <section aria-label="Resumo do mês" className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {m && <>
            <Indicador rotulo="Despesas do mês" valor={m.despesas} sinal="−" icone={<SetaBaixo />} corIcone="bg-red-50 text-negativo"
              var={a && variacao(m.despesas, a.despesas)} subirEhBom={false} comparado={mesAnteriorCurto} />
            <Indicador rotulo="Receitas do mês" valor={m.receitas} sinal="+" icone={<SetaCima />} corIcone="bg-green-50 text-positivo"
              var={a && variacao(m.receitas, a.receitas)} subirEhBom comparado={mesAnteriorCurto} />
            <Indicador rotulo="Resultado do mês" valor={m.resultado} icone={<Balanca />} corIcone="bg-azul-claro text-azul"
              var={a && variacao(m.resultado, a.resultado)} subirEhBom comparado={mesAnteriorCurto} negativoVermelho />
          </>}
          {p && (
            <Indicador rotulo="Patrimônio líquido" valor={p.patrimonio} icone={<Cofre />} corIcone="bg-marinho text-celeste" destaque
              rodape={`Disponível ${formatBRL(p.disponivel)} · dívida ${formatBRL(p.divida)}`} />
          )}
        </section>
      ) : null}
      {!m && <p className="mb-2 text-sm text-slate-500" role="status">Resumo do mês indisponível agora. O restante da tela continua.</p>}
      {!p && <p className="mb-2 text-sm text-slate-500" role="status">Patrimônio indisponível agora.</p>}
      {p && (
        <p className="mb-2 text-xs text-slate-500">
          Patrimônio = disponível {formatBRL(p.disponivel)} + crédito a receber {formatBRL(p.creditoAReceber)} − dívida {formatBRL(p.divida)}.
          Contas e dívidas. Não inclui bens nem investimentos.
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
                  <span className="min-w-0 flex-1 truncate font-medium">{l.descricao || (l.tipo === 'income' ? 'Receita' : l.tipo === 'expense' ? 'Despesa' : 'Transferência')}</span>
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
                  <span className="min-w-0 flex-1">{formatDate(x.data)} · {x.descricao || (x.tipo === 'income' ? 'Receita' : x.tipo === 'expense' ? 'Despesa' : 'Transferência')}</span>
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
                  <span>{c.nome}</span>
                  <span className={`tabular-nums font-semibold ${c.saldo !== null && c.saldo < 0 ? 'text-negativo' : ''}`}>
                    {c.saldo === null ? `abre em ${formatDate(c.abertura)}` : formatBRL(c.saldo)}
                  </span>
                  {c.saldo !== null && dados.conferencias && (
                    <ConferenciaDaConta contaId={c.id} nome={c.nome} ultima={dados.conferencias.get(c.id) ?? null} hoje={hoje} />
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>}
    </>
  )
}

/** Última conferência da conta com o extrato: nunca, ou há quantos dias (mais de 30 dias pede atenção). */
function ConferenciaDaConta({ contaId, nome, ultima, hoje }: { contaId: string; nome: string; ultima: string | null; hoje: string }) {
  const atraso = ultima === null ? null : diasEntre(ultima, hoje)
  const atencao = atraso === null || atraso > 30
  return (
    <span className="mt-0.5 flex w-full items-center justify-between text-xs">
      <span className={atencao ? 'text-planejado' : 'text-slate-500'}>
        {ultima === null ? 'Nunca conferida com o extrato' : `Conferida em ${formatDate(ultima)}${atraso !== null && atraso > 30 ? ` (há ${atraso} dias)` : ''}`}
      </span>
      <Link to={`/contas/${contaId}/conferir`} aria-label={`Conferir ${nome}`} className="font-semibold text-azul hover:underline">Conferir</Link>
    </span>
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

function Indicador({ rotulo, valor, sinal, icone, corIcone, var: v, subirEhBom, comparado, destaque = false, negativoVermelho = false, rodape }: {
  rotulo: string; valor: Cents; sinal?: '+' | '−'; icone: ReactNode; corIcone: string; var?: number | null; subirEhBom?: boolean
  comparado?: string; destaque?: boolean; negativoVermelho?: boolean; rodape?: string
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

/** Ícone da linha: transferência com setas; receita/despesa com o da categoria. */
function IconeDaLinha({ tipo, categoriaId, porId }: { tipo: 'income' | 'expense' | 'transfer'; categoriaId: string | null; porId: Map<string, Categoria> }) {
  return tipo === 'transfer'
    ? <IconeCategoria fixo="transferencia" tamanho="pequeno" />
    : <IconeCategoria visual={visualPorId(categoriaId, porId, tipo)} tamanho="pequeno" />
}
