import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { LinhaAcumulada } from '../components/graficos/LinhaAcumulada'
import { Rosca } from '../components/graficos/Rosca'
import { Aviso } from '../components/ui/Aviso'
import { Card, CardTitle } from '../components/ui/Card'
import { useAuth } from '../lib/auth'
import { useFamilia } from '../lib/FamiliaContext'
import { atualizarAutomaticos } from '../lib/automaticos'
import { listarCategorias } from '../lib/categorias'
import { hojeSP, listarContas } from '../lib/contas'
import type { Conta } from '../lib/contas'
import { mensagemErroBanco } from '../lib/erros'
import { currentMonth, formatBRL, formatDate, formatMonth } from '../lib/format'
import type { Cents } from '../lib/format'
import { limitesDoMes, listarLancamentos, mesmoDiaAnoPassado, resumoDoMes, resumoDoPeriodo, somarMeses } from '../lib/lancamentos'
import type { Lancamento, ResumoMes } from '../lib/lancamentos'
import { carregarPatrimonio, despesasPorCategoria, despesasPorDia, proximosPlanejados, projecaoDoMes, regularidadeRenda } from '../lib/painel'
import type { DespesaCategoria, DespesaDia, Patrimonio, ProjecaoMes, ProximoPlanejado, RegularidadeRenda } from '../lib/painel'

interface Dados {
  patrimonio: Patrimonio
  mes: ResumoMes
  anterior: ResumoMes
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
  ultimos: Lancamento[]
  nomeCategoria: Map<string, string>
}

/** Quatro totais vindos do banco (period_summary): período de agora e o mesmo período um ano antes. */
interface ComparacaoAnual {
  mesAtual: ResumoMes
  mesAnterior: ResumoMes
  anoAtual: ResumoMes
  anoAnterior: ResumoMes
}

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
export default function VisaoGeral() {
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
    // gera recorrentes e cobra faturas fechadas; se falhar, o painel mostra o que já está gravado, com aviso
    atualizarAutomaticos()
      .then((r) => { setCobrancaFalhou(!r.faturasOk); setRecorrentesFalhou(!r.recorrentesOk) })
      .then(() => Promise.all([
        carregarPatrimonio(familiaId, hoje), resumoDoMes(familiaId, mes), resumoDoMes(familiaId, somarMeses(mes, -1)),
        listarContas(familiaId, hoje), proximosPlanejados(familiaId, hoje),
        despesasPorCategoria(familiaId, de, ate, 4).catch(() => null), despesasPorDia(familiaId, de, ate).catch(() => null),
        listarLancamentos(familiaId, mes), listarCategorias(familiaId),
        Promise.all([
          regularidadeRenda(familiaId, de, ate),
          regularidadeRenda(familiaId, limitesDoMes(somarMeses(mes, -11))[0], ate),
        ]).catch(() => null),
        // mesmo recorte de dias nos dois anos: este mês até hoje × o mesmo mês até o mesmo dia do ano passado; o ano até hoje idem
        Promise.all([
          resumoDoPeriodo(familiaId, de, hoje),
          resumoDoPeriodo(familiaId, `${somarMeses(mes, -12)}-01`, mesmoDiaAnoPassado(hoje)),
          resumoDoPeriodo(familiaId, `${hoje.slice(0, 4)}-01-01`, hoje),
          resumoDoPeriodo(familiaId, `${Number(hoje.slice(0, 4)) - 1}-01-01`, mesmoDiaAnoPassado(hoje)),
        ]).then(([mesAtual, mesAnterior, anoAtual, anoAnterior]) => ({ mesAtual, mesAnterior, anoAtual, anoAnterior })).catch(() => null),
        projecaoDoMes(familiaId, mes, hoje).catch(() => null),
      ]))
      .then(([patrimonio, resumo, anterior, c, proximos, categorias, dias, lancs, cats, regularidade, anoPassado, projecao]) => setDados({
        patrimonio, mes: resumo, anterior, contas: c.contas.filter((x) => x.ativa), proximos, categorias, dias, regularidade, anoPassado, projecao,
        ultimos: lancs.filter((l) => l.status === 'paid').slice(0, 6),
        nomeCategoria: new Map(cats.map((x) => [x.id, x.nome])),
      }))
      .catch((err) => setErro(mensagemErroBanco(err)))
  }, [familiaId, hoje, mes])

  if (!familiaId) return null
  if (erro) return <Aviso tipo="erro">{erro}</Aviso>
  if (!dados) return <p className="text-sm text-slate-600" role="status">Carregando…</p>

  const { patrimonio: p, mes: m, anterior: a } = dados
  const mesAnteriorCurto = formatMonth(somarMeses(mes, -1)).split(' ')[0].slice(0, 3)
  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">{saudacao()}{nome ? `, ${nome}` : ''}!</h1>
        <p className="text-sm text-slate-600">Veja como estão as finanças da família em {formatMonth(mes).replace(/^./, (c) => c.toUpperCase())}.</p>
      </div>
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

      <section aria-label="Resumo do mês" className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Indicador rotulo="Despesas do mês" valor={m.despesas} sinal="−" icone={<SetaBaixo />} corIcone="bg-red-50 text-negativo"
          var={variacao(m.despesas, a.despesas)} subirEhBom={false} comparado={mesAnteriorCurto} />
        <Indicador rotulo="Receitas do mês" valor={m.receitas} sinal="+" icone={<SetaCima />} corIcone="bg-green-50 text-positivo"
          var={variacao(m.receitas, a.receitas)} subirEhBom comparado={mesAnteriorCurto} />
        <Indicador rotulo="Resultado do mês" valor={m.resultado} icone={<Balanca />} corIcone="bg-azul-claro text-azul"
          var={variacao(m.resultado, a.resultado)} subirEhBom comparado={mesAnteriorCurto} negativoVermelho />
        <Indicador rotulo="Patrimônio líquido" valor={p.patrimonio} icone={<Cofre />} corIcone="bg-marinho text-celeste" destaque
          rodape={`Disponível ${formatBRL(p.disponivel)} · dívida ${formatBRL(p.divida)}`} />
      </section>
      <p className="mb-2 text-xs text-slate-500">
        Patrimônio = disponível {formatBRL(p.disponivel)} + crédito a receber {formatBRL(p.creditoAReceber)} − dívida {formatBRL(p.divida)}.
        Contas e dívidas. Não inclui bens nem investimentos.
      </p>
      {p.compromissos > 0 && (
        <div className="mb-4 rounded-card border border-dashed border-slate-300 px-4 py-3 text-sm text-slate-600">
          Compromissos futuros (parcelas de cartão ainda não cobradas): <strong className="tabular-nums">{formatBRL(p.compromissos)}</strong>.
          Não entram no patrimônio de hoje.
        </div>
      )}
      {(m.receitasPrevistas > 0 || m.despesasPrevistas > 0) && (
        <p className="mb-4 text-xs text-planejado">Ainda planejado no mês: +{formatBRL(m.receitasPrevistas)} / −{formatBRL(m.despesasPrevistas)}</p>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>Despesas por categoria</CardTitle>
          {dados.categorias === null ? (
            <p className="text-sm text-slate-500" role="status">Gráfico indisponível agora. Os valores acima continuam corretos.</p>
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
          {a.despesas > 0 && (
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
              {variacao(dados.projecao.projetado, a.despesas) !== null && (
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
            <div className="grid gap-4 sm:grid-cols-2">
              <BlocoAnual titulo={`${formatMonth(mes)} até o dia ${Number(hoje.slice(8, 10))}`} rotuloAnterior={formatMonth(somarMeses(mes, -12))}
                atual={dados.anoPassado.mesAtual} anterior={dados.anoPassado.mesAnterior} />
              <BlocoAnual titulo={`Ano até hoje (${hoje.slice(0, 4)})`} rotuloAnterior={`mesmo período de ${Number(hoje.slice(0, 4)) - 1}`}
                atual={dados.anoPassado.anoAtual} anterior={dados.anoPassado.anoAnterior} />
            </div>
            <p className="mt-3 text-xs text-slate-500">Mesmos dias nos dois anos, para a comparação ser justa. Cartão conta na data de fechamento da fatura. Só entra o que já está pago: contas ainda planejadas ou fatura que não fechou não aparecem em nenhum dos dois anos.</p>
          </Card>
        )}

        {dados.regularidade && (
          <Card className="lg:col-span-2">
            <CardTitle>Renda regular × despesas</CardTitle>
            <div className="grid gap-4 sm:grid-cols-2">
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

        <Card className="lg:col-span-2 p-0">
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
                <li key={x.id} className="flex items-center justify-between py-2 text-sm">
                  <span>{formatDate(x.data)} · {x.descricao || (x.tipo === 'income' ? 'Receita' : x.tipo === 'expense' ? 'Despesa' : 'Transferência')}</span>
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
                <li key={c.id} className="flex items-center justify-between py-2 text-sm">
                  <span>{c.nome}</span>
                  <span className={`tabular-nums font-semibold ${c.saldo !== null && c.saldo < 0 ? 'text-negativo' : ''}`}>
                    {c.saldo === null ? `abre em ${formatDate(c.abertura)}` : formatBRL(c.saldo)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
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
      <p className="font-semibold capitalize">{titulo}</p>
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
      <p className="font-semibold capitalize">{titulo}</p>
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
