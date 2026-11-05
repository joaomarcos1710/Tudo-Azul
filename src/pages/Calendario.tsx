import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Aviso } from '../components/ui/Aviso'
import { Card, CardTitle } from '../components/ui/Card'
import { useFamilia } from '../lib/FamiliaContext'
import { atualizarAutomaticos } from '../lib/automaticos'
import { listarCategorias, nomesCompletos } from '../lib/categorias'
import { hojeSP, listarContas } from '../lib/contas'
import { mensagemErroBanco } from '../lib/erros'
import { currentMonth, formatBRL, formatDate, formatMoeda, formatMonth, primeiraMaiuscula } from '../lib/format'
import type { Cents } from '../lib/format'
import { saldosProjetados, faturasQueVencem } from '../lib/saldoProjetado'
import type { SaldoTotal } from '../lib/saldoProjetado'
import { limitesDoMes, listarLancamentos, listarMovimentosDeDivida, resumoDoMes, resumoPorMoeda, somarMeses } from '../lib/lancamentos'
import { listarParcelasDivida } from '../lib/dividas'
import type { ResumoMes, ResumoPorMoeda } from '../lib/lancamentos'
import { ResultadoEmOutrasMoedas } from '../components/ui/EmOutrasMoedas'
import { CabecalhoPagina } from '../components/ui/CabecalhoPagina'
import { corDoValor } from '../lib/cores'

/**
 * Calendário do mês: o que entra e sai das contas em cada dia (pago e planejado).
 * Mostra cada lançamento com o seu valor, na moeda da conta; não soma nada aqui. Os totais do mês vêm do banco
 * (period_summary, só em reais) e, à parte, o resultado das contas em outras moedas (period_summary_by_currency).
 * Compra no cartão não aparece no dia da compra: entra na fatura, e o pagamento da fatura aparece no dia em que sai da conta.
 */

type Sentido = 'entrada' | 'saida' | 'transferencia'

interface ItemDoDia {
  id: string
  data: string
  descricao: string
  detalhe: string
  valor: Cents
  /** Moeda da conta do lançamento (multimoeda F2); cartão, dívida e fatura são sempre em reais. */
  moeda: string
  sentido: Sentido
  planejado: boolean
}

const DIAS_SEMANA = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']
const mesValido = (m: string | null) => (m && /^20\d\d-(0[1-9]|1[0-2])$/.test(m) ? m : null)

export default function Calendario() {
  const { familia } = useFamilia()
  const familiaId = familia?.id
  const [params, setParams] = useSearchParams()
  const hoje = hojeSP()
  const [mes, setMes] = useState(() => mesValido(params.get('mes')) ?? currentMonth())
  const [dia, setDia] = useState<string | null>(() => (hoje.startsWith(mes) ? hoje : null))
  const [itens, setItens] = useState<ItemDoDia[] | null>(null)
  const [resumo, setResumo] = useState<ResumoMes | null>(null)
  const [porMoeda, setPorMoeda] = useState<ResumoPorMoeda[]>([])
  const [erro, setErro] = useState('')
  const [automaticosFalharam, setAutomaticosFalharam] = useState(false)
  const pedido = useRef(0)

  useEffect(() => {
    if (!familiaId) return
    const meu = ++pedido.current
    const vivo = () => meu === pedido.current
    setItens(null)
    setResumo(null)
    setPorMoeda([])
    setErro('')
    atualizarAutomaticos()
      .then((r) => { if (vivo()) setAutomaticosFalharam(!r.faturasOk || !r.recorrentesOk) })
      .then(() => Promise.all([
        listarLancamentos(familiaId, mes),
        listarMovimentosDeDivida(familiaId, mes),
        listarContas(familiaId, hoje).catch(() => null),
        listarCategorias(familiaId).catch(() => null),
        resumoDoMes(familiaId, mes).catch(() => null),
        // faturas por vencimento: extra; se a consulta falhar (ex.: banco ainda sem a migration 025) o calendário segue sem elas
        faturasQueVencem(familiaId, ...limitesDoMes(mes)).catch(() => []),
        listarParcelasDivida(familiaId, ...limitesDoMes(mes)).catch(() => []),
        resumoPorMoeda(familiaId, ...limitesDoMes(mes)).catch(() => [] as ResumoPorMoeda[]),
      ]))
      .then(([lancs, movs, contas, cats, res, faturas, parcelasDivida, pm]) => {
        if (!vivo()) return
        const nomeConta = new Map((contas?.contas ?? []).map((c) => [c.id, c.nome]))
        const moedaConta = new Map((contas?.contas ?? []).map((c) => [c.id, c.moeda ?? 'BRL']))
        const nomeCategoria = nomesCompletos(cats ?? [])
        const doMes: ItemDoDia[] = [
          ...lancs.map((l): ItemDoDia => ({
            id: `t-${l.id}`,
            data: l.data,
            descricao: l.descricao || (l.tipo === 'income' ? 'Receita' : l.tipo === 'expense' ? 'Despesa' : 'Transferência'),
            detalhe: l.tipo === 'transfer'
              ? `${nomeConta.get(l.contaId) ?? 'Conta'} → ${l.destinoId ? nomeConta.get(l.destinoId) ?? 'Conta' : 'Conta'}`
              : [l.categoriaId ? nomeCategoria.get(l.categoriaId) : null, nomeConta.get(l.contaId)].filter(Boolean).join(' · '),
            valor: l.valor,
            moeda: moedaConta.get(l.contaId) ?? 'BRL',
            sentido: l.tipo === 'income' ? 'entrada' : l.tipo === 'expense' ? 'saida' : 'transferencia',
            planejado: l.status === 'planned',
          })),
          ...movs.map((m): ItemDoDia => ({
            id: `d-${m.id}`,
            data: m.data,
            descricao: m.descricao,
            detalhe: nomeConta.get(m.contaId) ?? '',
            // o banco devolve com sinal do ponto de vista da conta; aqui só o valor positivo e o sentido
            valor: Math.abs(m.valor) as Cents,
            moeda: 'BRL',
            sentido: m.valor >= 0 ? 'entrada' : 'saida',
            planejado: false,
          })),
          ...parcelasDivida.map((p): ItemDoDia => ({
            id: `dp-${p.id}`,
            data: p.vencimento,
            descricao: `Parcela ${p.numero} · ${p.nomeDivida}`,
            detalhe: p.formaPagamento === 'account_debit'
              ? `débito automático · ${nomeConta.get(p.contaPagamentoId ?? '') ?? 'conta definida'}`
              : p.formaPagamento === 'boleto' ? 'boleto'
                : p.formaPagamento === 'payroll' ? 'consignado · desconto em folha'
                  : 'pagamento manual',
            valor: p.valor,
            moeda: 'BRL',
            sentido: 'saida',
            planejado: true,
          })),
          // a fatura que vence no dia aparece como planejada, pelo que ainda falta pagar (paga por inteiro, o pagamento já aparece acima)
          ...faturas.filter((f) => f.falta > 0).map((f): ItemDoDia => ({
            id: `f-${f.cartaoId}-${f.vencimento}`,
            data: f.vencimento,
            descricao: `Fatura ${f.cartao}`,
            detalhe: f.contaPagamentoId && nomeConta.get(f.contaPagamentoId)
              ? `vence neste dia · paga com ${nomeConta.get(f.contaPagamentoId)}`
              : 'vence neste dia · conta de pagamento não escolhida',
            valor: f.falta,
            moeda: 'BRL',
            sentido: 'saida',
            planejado: true,
          })),
        ]
        setItens(doMes)
        setResumo(res)
        setPorMoeda(pm)
      })
      .catch((err) => { if (vivo()) setErro(mensagemErroBanco(err)) })
  }, [familiaId, mes, hoje])

  function irPara(novo: string) {
    setMes(novo)
    setDia(hoje.startsWith(novo) ? hoje : null)
    setParams((p) => { p.set('mes', novo); return p }, { replace: true })
  }

  if (!familiaId) return null

  const [a, m] = mes.split('-').map(Number)
  const [, fimDoMes] = limitesDoMes(mes)
  const diasNoMes = Number(fimDoMes.slice(8, 10))
  const deslocamento = (new Date(Date.UTC(a, m - 1, 1)).getUTCDay() + 6) % 7 // segunda-feira primeiro
  const porDia = new Map<string, ItemDoDia[]>()
  for (const item of itens ?? []) porDia.set(item.data, [...(porDia.get(item.data) ?? []), item])
  const doDia = dia ? porDia.get(dia) ?? [] : []
  const titulo = primeiraMaiuscula(formatMonth(mes))

  return (
    <>
      <CabecalhoPagina titulo="Calendário" descricao="O que entra e sai das contas a cada dia do mês." />

      {automaticosFalharam && (
        <div className="mb-4">
          <Aviso tipo="erro">Não foi possível atualizar faturas e recorrentes agora. Alguns planejados podem estar faltando.</Aviso>
        </div>
      )}

      <div className="mb-4 flex items-center justify-between rounded-card bg-white px-3 py-2 shadow-card">
        <button type="button" onClick={() => irPara(somarMeses(mes, -1))} aria-label="Mês anterior"
          className="min-h-11 min-w-11 rounded-lg text-xl text-marinho hover:bg-azul-claro">‹</button>
        <h2 className="text-base font-semibold" aria-live="polite">{titulo}</h2>
        <button type="button" onClick={() => irPara(somarMeses(mes, 1))} aria-label="Próximo mês"
          className="min-h-11 min-w-11 rounded-lg text-xl text-marinho hover:bg-azul-claro">›</button>
      </div>

      {erro && <div className="mb-4"><Aviso tipo="erro">{erro}</Aviso></div>}

      {resumo && (
        <section aria-label="Totais do mês" className="mb-4 grid grid-cols-3 gap-2 text-sm">
          <Card className="!p-3"><p className="text-xs text-slate-500">Receitas pagas</p><p className="tabular-nums font-semibold text-lucro">+{formatBRL(resumo.receitas)}</p></Card>
          <Card className="!p-3"><p className="text-xs text-slate-500">Despesas pagas</p><p className="tabular-nums font-semibold text-prejuizo">−{formatBRL(resumo.despesas)}</p></Card>
          <Card className="!p-3"><p className="text-xs text-slate-500">Resultado</p><p className={`tabular-nums font-semibold ${corDoValor(resumo.resultado)}`}>{formatBRL(resumo.resultado)}</p></Card>
        </section>
      )}
      {/* resultado das contas em outras moedas: à parte, sem conversão, fora dos totais em reais acima */}
      {resumo && <ResultadoEmOutrasMoedas porMoeda={porMoeda} className="mb-4 rounded-card bg-white px-3 py-2 shadow-card" />}

      <SaldoAteADataEscolhida familiaId={familiaId} ate={dia ?? fimDoMes} hoje={hoje} />

      {itens === null && !erro ? (
        <p className="text-sm text-slate-600" role="status">Carregando…</p>
      ) : itens && (
        <>
          <Card className="mb-4 !p-2 sm:!p-3">
            <div className="grid grid-cols-7 gap-1" role="group" aria-label={`Dias de ${titulo}`}>
              {DIAS_SEMANA.map((d) => <div key={d} className="py-1 text-center text-[11px] font-semibold uppercase text-slate-500" aria-hidden="true">{d}</div>)}
              {Array.from({ length: deslocamento }, (_, i) => <div key={`v${i}`} aria-hidden="true" />)}
              {Array.from({ length: diasNoMes }, (_, i) => {
                const n = i + 1
                const data = `${mes}-${String(n).padStart(2, '0')}`
                const itensDoDia = porDia.get(data) ?? []
                const entrada = itensDoDia.some((x) => !x.planejado && x.sentido === 'entrada')
                const saida = itensDoDia.some((x) => !x.planejado && x.sentido === 'saida')
                const planejados = itensDoDia.filter((x) => x.planejado).length
                const ehHoje = data === hoje
                const selecionado = data === dia
                const rotulo = `${n} de ${formatMonth(mes)}${ehHoje ? ', hoje' : ''}: ${
                  itensDoDia.length === 0 ? 'nada' : `${itensDoDia.length} ${itensDoDia.length === 1 ? 'lançamento' : 'lançamentos'}`
                }${planejados > 0 ? `, ${planejados} ${planejados === 1 ? 'planejado' : 'planejados'}` : ''}`
                return (
                  <button key={data} type="button" onClick={() => setDia(data)} aria-label={rotulo} aria-pressed={selecionado}
                    className={`flex min-h-11 flex-col items-start rounded-lg p-1 text-left sm:min-h-16 sm:p-1.5 ${
                      selecionado ? 'bg-azul-claro ring-2 ring-azul' : ehHoje ? 'ring-2 ring-azul/60' : itensDoDia.length ? 'bg-fundo hover:bg-azul-claro' : 'hover:bg-fundo'
                    }`}>
                    <span className={`text-xs tabular-nums sm:text-sm ${ehHoje ? 'font-bold text-azul' : 'text-slate-700'}`}>{n}</span>
                    <span className="mt-auto flex w-full flex-col gap-0.5" aria-hidden="true">
                      {entrada && <span className="h-1 rounded-full bg-lucro-marca" />}
                      {saida && <span className="h-1 rounded-full bg-prejuizo-marca" />}
                      {planejados > 0 && <span className="h-1 rounded-full bg-agendado-marca" />}
                    </span>
                  </button>
                )
              })}
            </div>
            <p className="mt-2 flex flex-wrap gap-3 border-t border-slate-100 px-1 pt-2 text-[11px] text-slate-500">
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-lucro-marca" /> Entrou</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-prejuizo-marca" /> Saiu</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-agendado-marca" /> Planejado (ainda não aconteceu)</span>
            </p>
          </Card>

          <Card>
            {dia === null ? (
              <p className="text-sm text-slate-500">Toque num dia para ver o que entra e sai.</p>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <CardTitle>{formatDate(dia)}{dia === hoje ? ' · hoje' : ''}</CardTitle>
                  <Link to={`/lancamentos?mes=${mes}`} className="mb-3 text-sm font-semibold text-azul hover:underline">Ver em Lançamentos</Link>
                </div>
                {doDia.length === 0 ? (
                  <p className="text-sm text-slate-500">Nada neste dia.</p>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {doDia.map((x) => (
                      <li key={x.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{x.descricao}</span>
                          {x.detalhe && <span className="block truncate text-xs text-slate-500">{x.detalhe}</span>}
                        </span>
                        <span className="shrink-0 text-right">
                          <span className={`block tabular-nums font-semibold ${x.sentido === 'entrada' ? 'text-lucro' : x.sentido === 'saida' ? 'text-prejuizo' : 'text-transferencia'}`}>
                            {x.sentido === 'entrada' ? '+' : x.sentido === 'saida' ? '−' : '⇄ '}{formatMoeda(x.valor, x.moeda)}
                          </span>
                          <span className={`text-[11px] font-medium ${x.planejado ? 'text-agendado' : 'text-lucro'}`}>{x.planejado ? 'Planejado' : 'Pago'}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {doDia.some((x) => x.moeda !== 'BRL') && (
                  <p className="mt-2 text-xs text-slate-500" data-testid="dia-outras-moedas">
                    Valores em {[...new Set(doDia.filter((x) => x.moeda !== 'BRL').map((x) => x.moeda))].join(', ')} ficam na moeda da conta, sem conversão: não entram nos totais em reais.
                  </p>
                )}
              </>
            )}
          </Card>
          <p className="mt-3 text-xs text-slate-500">
            Os totais do mês vêm do banco, como em Análises (compra no cartão conta na data de fechamento da fatura).
            No calendário, a compra no cartão não aparece no dia da compra: o pagamento da fatura aparece no dia em que sai da conta.
          </p>
        </>
      )}
    </>
  )
}

/**
 * Uma linha só: o saldo total (em reais, do banco: balance_totals_projected) no dia escolhido ou no fim do mês, só
 * efetuados ou efetuados + planejados. É a única informação daqui que não está em outra tela: o saldo por conta
 * fica em Contas e no Início (só o de hoje, decisão do dono de 05/11/2026).
 */
function SaldoAteADataEscolhida({ familiaId, ate, hoje }: { familiaId: string; ate: string; hoje: string }) {
  const [incluir, setIncluir] = useState(true)
  const [total, setTotal] = useState<SaldoTotal | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [indisponivel, setIndisponivel] = useState(false)

  useEffect(() => {
    let vivo = true
    setCarregando(true)
    setIndisponivel(false)
    saldosProjetados(familiaId, ate, incluir)
      .then((r) => { if (vivo) { setTotal(r.total); setCarregando(false) } })
      .catch(() => { if (vivo) setIndisponivel(true) })
    return () => { vivo = false }
  }, [familiaId, ate, incluir])

  if (indisponivel) return null
  const quando = ate === hoje ? 'hoje' : `em ${formatDate(ate).slice(0, 5)}`
  const rotulo = incluir ? `Saldo previsto ${quando}` : `Saldo ${quando} (só efetuados)`

  return (
    <Card className="mb-4 !py-3" aria-label="Saldo na data escolhida">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <p className="text-sm" aria-live="polite">
          <span className="text-slate-500">{rotulo}: </span>
          {carregando || !total ? (
            <span className="text-slate-500" role="status">calculando…</span>
          ) : (
            <strong className={`tabular-nums ${corDoValor(total.saldo)}`} data-testid="saldo-total">{formatBRL(total.saldo)}</strong>
          )}
        </p>
        <div className="flex gap-1" role="group" aria-label="O que entra no saldo">
          <button type="button" aria-pressed={!incluir} onClick={() => setIncluir(false)}
            className={`min-h-9 rounded-lg px-3 text-xs font-semibold ${!incluir ? 'bg-azul text-white' : 'bg-fundo text-slate-600'}`}>Só efetuados</button>
          <button type="button" aria-pressed={incluir} onClick={() => setIncluir(true)}
            className={`min-h-9 rounded-lg px-3 text-xs font-semibold ${incluir ? 'bg-azul text-white' : 'bg-fundo text-slate-600'}`}>Efetuados + planejados</button>
        </div>
      </div>
      {incluir && !carregando && total && total.faturasSemConta > 0 && (
        <p className="mt-1 text-xs text-atencao" data-testid="saldo-sem-conta">
          Inclui {formatBRL(total.faturasSemConta)} em faturas e parcelas sem conta de pagamento; escolha a conta em{' '}
          <Link to="/cartoes" className="font-semibold underline">Cartões</Link>.
        </p>
      )}
    </Card>
  )
}
