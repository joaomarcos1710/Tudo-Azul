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
import { limitesDoMes, listarLancamentos, resumoDoMes, somarMeses } from '../lib/lancamentos'
import type { Lancamento, ResumoMes } from '../lib/lancamentos'
import { carregarPatrimonio, despesasPorCategoria, despesasPorDia, proximosPlanejados } from '../lib/painel'
import type { DespesaCategoria, DespesaDia, Patrimonio, ProximoPlanejado } from '../lib/painel'

interface Dados {
  patrimonio: Patrimonio
  mes: ResumoMes
  anterior: ResumoMes
  contas: Conta[]
  proximos: ProximoPlanejado[]
  categorias: DespesaCategoria[]
  dias: DespesaDia[]
  ultimos: Lancamento[]
  nomeCategoria: Map<string, string>
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
        despesasPorCategoria(familiaId, de, ate, 4), despesasPorDia(familiaId, de, ate),
        listarLancamentos(familiaId, mes), listarCategorias(familiaId),
      ]))
      .then(([patrimonio, resumo, anterior, c, proximos, categorias, dias, lancs, cats]) => setDados({
        patrimonio, mes: resumo, anterior, contas: c.contas.filter((x) => x.ativa), proximos, categorias, dias,
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
          {dados.categorias.length === 0 ? (
            <p className="text-sm text-slate-500">Nenhuma despesa paga neste mês ainda.</p>
          ) : (
            <Rosca total={m.despesas} fatias={dados.categorias.map((c) => ({
              chave: c.categoriaId ?? 'outros', nome: c.nome, valor: c.valor, percentual: c.percentual, outros: c.categoriaId === null,
            }))} />
          )}
        </Card>

        <Card>
          <CardTitle>Despesas acumuladas no mês</CardTitle>
          <LinhaAcumulada pontos={dados.dias} ate={hoje} />
          {a.despesas > 0 && (
            <p className="mt-2 rounded-lg bg-azul-claro px-3 py-2 text-sm text-marinho">
              No mês passado inteiro foram {formatBRL(a.despesas)}; neste mês, até hoje, {formatBRL(m.despesas)}.
            </p>
          )}
        </Card>

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
