import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Aviso } from '../components/ui/Aviso'
import { Card } from '../components/ui/Card'
import { useFamilia } from '../lib/FamiliaContext'
import { atualizarAutomaticos } from '../lib/automaticos'
import { listarCategorias, nomesCompletos } from '../lib/categorias'
import { hojeSP, listarContas } from '../lib/contas'
import { mensagemErroBanco } from '../lib/erros'
import { currentMonth, formatBRL, formatBRLCampo, formatDate, formatMoeda, formatMonth, primeiraMaiuscula } from '../lib/format'
import type { Cents } from '../lib/format'
import { saldosProjetados, faturasQueVencem, totaisDoDia } from '../lib/saldoProjetado'
import type { SaldoTotal, TotalDoDia } from '../lib/saldoProjetado'
import { useValoresOcultos } from '../lib/privacidade'
import { limitesDoMes, listarLancamentos, listarMovimentosDeDivida, resumoDoMes, resumoPorMoeda, situacaoDoLancamento, somarMeses } from '../lib/lancamentos'
import { listarParcelasDivida } from '../lib/dividas'
import type { ResumoMes, ResumoPorMoeda } from '../lib/lancamentos'
import { ResultadoEmOutrasMoedas } from '../components/ui/EmOutrasMoedas'
import { CabecalhoPagina } from '../components/ui/CabecalhoPagina'
import { corDoValor } from '../lib/cores'

/**
 * Calendário do mês: o que entra e sai das contas em cada dia (pago e planejado).
 * Mostra cada lançamento com o seu valor, na moeda da conta; não soma nada aqui. Os totais do mês vêm do banco
 * (period_summary, só em reais) e, à parte, o resultado das contas em outras moedas (period_summary_by_currency).
 * Os totais de cada dia (dentro da grade e no resumo do dia) também vêm do banco: calendar_day_totals (migration 130),
 * que soma os mesmos blocos desta lista. Na grade só aparecem os de reais; outras moedas ficam na lista do dia.
 * Compra no cartão não aparece no dia da compra: entra na fatura, e o pagamento da fatura aparece no dia em que sai da conta.
 */

// 'folha': parcela de consignado, descontada no salário (que entra líquido): aparece, mas não sai da conta nem entra nos totais
type Sentido = 'entrada' | 'saida' | 'transferencia' | 'folha'

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
  /** Fatura de cartão ou parcela de dívida: o filtro "Faturas e Parcelas" (mesma regra do banco, `bills`). */
  faturaOuParcela: boolean
}

type Filtro = 'todos' | 'entradas' | 'saidas' | 'faturas'
const FILTROS: { id: Filtro; rotulo: string }[] = [
  { id: 'todos', rotulo: 'Todos' }, { id: 'entradas', rotulo: 'Entradas' }, { id: 'saidas', rotulo: 'Saídas' },
  { id: 'faturas', rotulo: 'Faturas e Parcelas' },
]
// Onde a célula comporta o valor (≥ 68 px por dia): celular deitado (640–767 px, sem o menu lateral) e computador a partir de
// 1280 px. Entre 768 e 1279 px o menu lateral de 256 px aperta a grade (célula de ~44 px no iPad em pé) e o valor saía cortado
// ("+14.…"): ali ficam os tracinhos. Conferido em prévia com o menu aberto em 390, 768, 820, 1280 e 1440 px (16/11/2026).
const TRACO_COM_VALOR = 'sm:hidden md:block xl:hidden'
const passaNoFiltro = (x: ItemDoDia, f: Filtro) =>
  f === 'todos' || (f === 'entradas' && x.sentido === 'entrada') || (f === 'saidas' && x.sentido === 'saida') || (f === 'faturas' && x.faturaOuParcela)

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
  // totais de cada dia, do banco; null = não carregou (a grade fica só com os tracinhos, como antes)
  const [totais, setTotais] = useState<TotalDoDia[] | null>(null)
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const ocultos = useValoresOcultos()
  const [erro, setErro] = useState('')
  const [automaticosFalharam, setAutomaticosFalharam] = useState(false)
  // consultas de apoio que falharam: sem isto o calendário parecia completo (sem faturas, parcelas ou totais) e não estava
  const [blocosFalharam, setBlocosFalharam] = useState<string[]>([])
  const [recarga, setRecarga] = useState(0)
  const pedido = useRef(0)
  const mesCarregado = useRef('')

  useEffect(() => {
    if (!familiaId) return
    const meu = ++pedido.current
    const vivo = () => meu === pedido.current
    // recarga (as tarefas automáticas gravaram algo) refaz a leitura sem apagar o mês da tela; trocar de mês apaga
    const chaveMes = `${familiaId}|${mes}`
    if (mesCarregado.current !== chaveMes) {
      mesCarregado.current = chaveMes
      setItens(null)
      setResumo(null)
      setPorMoeda([])
      setTotais(null)
    }
    setBlocosFalharam([])
    setErro('')
    const falhas = new Set<string>()
    const falhou = <T,>(bloco: string, vazio: T) => (): T => { falhas.add(bloco); return vazio }
    Promise.all([
        listarLancamentos(familiaId, mes),
        listarMovimentosDeDivida(familiaId, mes),
        listarContas(familiaId, hoje).catch(falhou('nomes das contas', null)),
        listarCategorias(familiaId).catch(falhou('nomes das categorias', null)),
        resumoDoMes(familiaId, mes).catch(falhou('totais do mês', null)),
        // faturas por vencimento e parcelas: se a consulta falhar o calendário segue sem elas, mas AVISA (blocosFalharam)
        faturasQueVencem(familiaId, ...limitesDoMes(mes)).catch(falhou('faturas', [])),
        listarParcelasDivida(familiaId, ...limitesDoMes(mes)).catch(falhou('parcelas de dívida', [])),
        resumoPorMoeda(familiaId, ...limitesDoMes(mes)).catch(falhou('resumo em outras moedas', [] as ResumoPorMoeda[])),
        totaisDoDia(familiaId, ...limitesDoMes(mes)).catch(falhou('totais de cada dia', null)),
      ])
      .then(([lancs, movs, contas, cats, res, faturas, parcelasDivida, pm, tdd]) => {
        if (!vivo()) return
        setBlocosFalharam([...falhas])
        // a conta interna da carteira (aporte e resgate) também tem nome nas transferências
        const nomeConta = new Map([...(contas?.contas ?? []), ...(contas?.internas ?? [])].map((c) => [c.id, c.nome]))
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
            faturaOuParcela: false,
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
            faturaOuParcela: m.parcela,
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
            // consignado: o salário já entra líquido, então a parcela não sai da conta (mesma regra do banco, migration 131)
            sentido: p.formaPagamento === 'payroll' ? 'folha' : 'saida',
            planejado: true,
            faturaOuParcela: true,
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
            faturaOuParcela: true,
          })),
        ]
        setItens(doMes)
        setResumo(res)
        setPorMoeda(pm)
        setTotais(tdd)
      })
      .catch((err) => { if (vivo()) setErro(mensagemErroBanco(err)) })
  }, [familiaId, mes, hoje, recarga])

  // Tarefas automáticas (recorrentes, faturas): uma vez por abertura, ao mesmo tempo que o mês carrega, e não a cada troca de
  // mês (não dependem do mês). Se gravaram algo, o mês atual recarrega.
  useEffect(() => {
    if (!familiaId) return
    let ativo = true
    atualizarAutomaticos().then((r) => {
      if (!ativo) return
      setAutomaticosFalharam(!r.faturasOk || !r.recorrentesOk)
      if (r.mudou) setRecarga((n) => n + 1)
    })
    return () => { ativo = false }
  }, [familiaId, hoje])

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
  for (const item of itens ?? []) if (passaNoFiltro(item, filtro)) porDia.set(item.data, [...(porDia.get(item.data) ?? []), item])
  const doDia = dia ? porDia.get(dia) ?? [] : []
  const titulo = primeiraMaiuscula(formatMonth(mes))
  // só reais na grade e no resumo do dia; outras moedas ficam na lista, na moeda da conta (sem conversão)
  const totalBRL = new Map((totais ?? []).filter((t) => t.moeda === 'BRL').map((t) => [t.data, t]))
  // valores dentro do dia: com os totais do banco carregados e "ocultar valores" desligado; senão, só os tracinhos
  const mostrarValores = totais !== null && !ocultos
  const valoresDoDia = (t: TotalDoDia | undefined): { entra: Cents; sai: Cents } => {
    const zero = 0 as Cents
    if (!t) return { entra: zero, sai: zero }
    if (filtro === 'entradas') return { entra: t.entradas, sai: zero }
    if (filtro === 'saidas') return { entra: zero, sai: t.saidas }
    if (filtro === 'faturas') return { entra: zero, sai: t.faturasEParcelas }
    return { entra: t.entradas, sai: t.saidas }
  }
  const resumoDoDia = dia ? valoresDoDia(totalBRL.get(dia)) : null

  return (
    <>
      <CabecalhoPagina titulo="Calendário" descricao="O que entra e sai das contas a cada dia do mês." />

      {blocosFalharam.length > 0 && (
        <div className="mb-4" data-testid="calendario-blocos-falharam">
          <Aviso tipo="erro">Não foi possível carregar: {blocosFalharam.join(', ')}. O calendário pode estar incompleto; troque de mês e volte para tentar de novo.</Aviso>
        </div>
      )}

      {automaticosFalharam && (
        <div className="mb-4">
          <Aviso tipo="erro">Não foi possível atualizar faturas e recorrentes agora. Alguns planejados podem estar faltando.</Aviso>
        </div>
      )}

      <div className="mb-4 flex items-center justify-between rounded-card bg-white px-3 py-2 shadow-card">
        <button type="button" onClick={() => irPara(somarMeses(mes, -1))} aria-label="Mês anterior"
          className="min-h-11 min-w-11 rounded-lg text-xl text-marinho hover:bg-azul-claro">‹</button>
        <h2 className="text-base font-semibold" aria-live="polite">{titulo}</h2>
        <span className="flex items-center gap-1">
          <button type="button" onClick={() => { irPara(hoje.slice(0, 7)); setDia(hoje) }}
            disabled={mes === hoje.slice(0, 7) && dia === hoje}
            className="min-h-11 rounded-lg px-3 text-sm font-semibold text-azul hover:bg-azul-claro disabled:text-slate-400 disabled:hover:bg-transparent">Hoje</button>
          <button type="button" onClick={() => irPara(somarMeses(mes, 1))} aria-label="Próximo mês"
            className="min-h-11 min-w-11 rounded-lg text-xl text-marinho hover:bg-azul-claro">›</button>
        </span>
      </div>

      {erro && <div className="mb-4"><Aviso tipo="erro">{erro}</Aviso></div>}

      {resumo && (
        // no celular, uma linha por total (rótulo à esquerda, valor à direita): em três colunas de ~110 px o valor quebrava em
        // duas linhas ("+R$" / "15.145,50"); a partir de sm, as três colunas de sempre
        <section aria-label="Totais do mês" className="mb-4 grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
          <Card className="flex items-baseline justify-between gap-3 !p-3 sm:block"><p className="text-xs text-slate-500">Receitas pagas</p><p className="whitespace-nowrap tabular-nums font-semibold text-lucro">+{formatBRL(resumo.receitas)}</p></Card>
          <Card className="flex items-baseline justify-between gap-3 !p-3 sm:block"><p className="text-xs text-slate-500">Despesas pagas</p><p className="whitespace-nowrap tabular-nums font-semibold text-prejuizo">−{formatBRL(resumo.despesas)}</p></Card>
          <Card className="flex items-baseline justify-between gap-3 !p-3 sm:block"><p className="text-xs text-slate-500">Resultado</p><p className={`whitespace-nowrap tabular-nums font-semibold ${corDoValor(resumo.resultado)}`}>{formatBRL(resumo.resultado)}</p></Card>
        </section>
      )}
      {/* resultado das contas em outras moedas: à parte, sem conversão, fora dos totais em reais acima */}
      {resumo && <ResultadoEmOutrasMoedas porMoeda={porMoeda} className="mb-4 rounded-card bg-white px-3 py-2 shadow-card" />}

      <SaldoAteADataEscolhida familiaId={familiaId} ate={dia ?? fimDoMes} hoje={hoje} />

      {itens === null && !erro ? (
        <p className="text-sm text-slate-600" role="status">Carregando…</p>
      ) : itens && (
        <>
          <div className="xl:grid xl:grid-cols-12 xl:items-start xl:gap-6">
          <Card className="mb-4 !p-2 sm:!p-3 xl:col-span-8 xl:mb-0">
            <div className="mb-2 flex flex-wrap gap-1" role="group" aria-label="Mostrar no calendário">
              {FILTROS.map((f) => (
                <button key={f.id} type="button" aria-pressed={filtro === f.id} onClick={() => setFiltro(f.id)}
                  className={`min-h-11 rounded-lg px-3 text-xs font-semibold ${filtro === f.id ? 'bg-azul text-white' : 'bg-fundo text-slate-600 hover:bg-azul-claro'}`}>
                  {f.rotulo}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1" role="group" aria-label={`Dias de ${titulo}`}>
              {DIAS_SEMANA.map((d) => <div key={d} className="py-1 text-center text-[11px] font-semibold uppercase text-slate-500" aria-hidden="true">{d}</div>)}
              {Array.from({ length: deslocamento }, (_, i) => <div key={`v${i}`} aria-hidden="true" />)}
              {Array.from({ length: diasNoMes }, (_, i) => {
                const n = i + 1
                const data = `${mes}-${String(n).padStart(2, '0')}`
                const itensDoDia = porDia.get(data) ?? []
                const entrada = itensDoDia.some((x) => !x.planejado && x.sentido === 'entrada')
                const saida = itensDoDia.some((x) => !x.planejado && x.sentido === 'saida')
                // planejado com a data já passada é vencido (vermelho, prejuízo, #183), como em Lançamentos e no Início
                const vencidos = itensDoDia.filter((x) => x.planejado && situacaoDoLancamento(false, x.data, hoje) === 'vencido').length
                const planejados = itensDoDia.filter((x) => x.planejado).length - vencidos
                const ehHoje = data === hoje
                const selecionado = data === dia
                // valores em reais do banco; o dia que só tem outra moeda continua com os tracinhos também no computador
                const { entra, sai } = valoresDoDia(totalBRL.get(data))
                const temValor = mostrarValores && (entra !== 0 || sai !== 0)
                const rotulo = `${n} de ${formatMonth(mes)}${ehHoje ? ', hoje' : ''}: ${
                  itensDoDia.length === 0 ? 'nada' : `${itensDoDia.length} ${itensDoDia.length === 1 ? 'lançamento' : 'lançamentos'}`
                }${planejados > 0 ? `, ${planejados} ${planejados === 1 ? 'planejado' : 'planejados'}` : ''}${
                  vencidos > 0 ? `, ${vencidos} ${vencidos === 1 ? 'vencido' : 'vencidos'}` : ''}`
                return (
                  <button key={data} type="button" onClick={() => setDia(data)} aria-label={rotulo} aria-pressed={selecionado}
                    className={`flex min-h-11 min-w-0 flex-col items-start rounded-lg p-1 text-left sm:min-h-20 sm:p-1.5 ${
                      selecionado ? 'bg-azul-claro ring-2 ring-azul' : ehHoje ? 'ring-2 ring-azul/60' : itensDoDia.length ? 'bg-fundo hover:bg-azul-claro' : 'hover:bg-fundo'
                    }`}>
                    <span className={`text-xs tabular-nums sm:text-sm ${ehHoje ? 'font-bold text-azul' : 'text-slate-700'}`}>{n}</span>
                    {temValor && (
                      <span className="mt-auto hidden w-full flex-col items-end gap-0.5 sm:flex md:hidden xl:flex" aria-hidden="true" data-valores-do-dia>
                        {entra !== 0 && <span className="max-w-full truncate rounded bg-lucro-fundo px-1 text-[10px] font-semibold tabular-nums text-lucro">+{formatBRLCampo(entra)}</span>}
                        {sai !== 0 && <span className="max-w-full truncate rounded bg-prejuizo-fundo px-1 text-[10px] font-semibold tabular-nums text-prejuizo">−{formatBRLCampo(sai)}</span>}
                      </span>
                    )}
                    <span className={`flex w-full flex-col gap-0.5 ${temValor ? 'mt-auto sm:mt-0.5 md:mt-auto xl:mt-0.5' : 'mt-auto'}`} aria-hidden="true">
                      {entrada && <span className={`h-1 rounded-full bg-lucro-marca ${temValor ? TRACO_COM_VALOR : ''}`} />}
                      {saida && <span className={`h-1 rounded-full bg-prejuizo-marca ${temValor ? TRACO_COM_VALOR : ''}`} />}
                      {planejados > 0 && <span className="h-1 rounded-full bg-agendado-marca" />}
                      {vencidos > 0 && <span data-traco="vencido" className="h-1 rounded-full border border-prejuizo-marca bg-prejuizo-fundo" />}
                    </span>
                  </button>
                )
              })}
            </div>
            <p className="mt-2 flex flex-wrap gap-3 border-t border-slate-100 px-1 pt-2 text-[11px] text-slate-500">
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-lucro-marca" /> Entrou</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-prejuizo-marca" /> Saiu</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-agendado-marca" /> Planejado (ainda não aconteceu)</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full border border-prejuizo-marca bg-prejuizo-fundo" /> Vencido (planejado que passou da data)</span>
            </p>
          </Card>

          <Card className="xl:sticky xl:top-4 xl:col-span-4">
            {dia === null ? (
              <p className="text-sm text-slate-500">Toque num dia para ver o que entra e sai.</p>
            ) : (
              <>
                <div className="flex items-center justify-between gap-2">
                  <div className="mb-3 min-w-0">
                    <h2 className="text-sm font-semibold text-slate-500">{formatDate(dia)}{dia === hoje ? ' · hoje' : ''}</h2>
                    <p className="text-xs text-slate-500" data-testid="dia-contagem">
                      {doDia.length === 0 ? 'nada' : `${doDia.length} ${doDia.length === 1 ? 'item' : 'itens'}`}
                      {filtro !== 'todos' ? ` · ${FILTROS.find((f) => f.id === filtro)?.rotulo}` : ''}
                    </p>
                  </div>
                  <Link to={`/lancamentos?mes=${mes}`} className="mb-3 inline-flex min-h-11 shrink-0 items-center rounded-lg px-2 text-sm font-semibold text-azul hover:bg-azul-claro hover:underline">Ver em Lançamentos</Link>
                </div>
                {totais !== null && resumoDoDia && (
                  <section aria-label="Resumo do dia" className="mb-3 grid grid-cols-2 gap-2 rounded-lg bg-fundo p-2 text-sm">
                    <div><p className="text-[11px] uppercase text-slate-500">Entradas</p>
                      <p className="tabular-nums font-semibold text-lucro">+{formatBRL(resumoDoDia.entra)}</p></div>
                    <div><p className="text-[11px] uppercase text-slate-500">{filtro === 'faturas' ? 'Faturas e parcelas' : 'Saídas'}</p>
                      <p className="tabular-nums font-semibold text-prejuizo">−{formatBRL(resumoDoDia.sai)}</p></div>
                  </section>
                )}
                {doDia.length === 0 ? (
                  <p className="text-sm text-slate-500">{filtro === 'todos' ? 'Nada neste dia.' : 'Nada deste tipo neste dia.'}</p>
                ) : (
                  <ul className="divide-y divide-slate-100" aria-label="O que entra e sai no dia">
                    {doDia.map((x) => (
                      <li key={x.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{x.descricao}</span>
                          {x.detalhe && <span className="block truncate text-xs text-slate-500">{x.detalhe}</span>}
                        </span>
                        <span className="shrink-0 text-right">
                          <span className={`block tabular-nums font-semibold ${x.sentido === 'entrada' ? 'text-lucro' : x.sentido === 'saida' ? 'text-prejuizo' : x.sentido === 'folha' ? 'text-slate-500' : 'text-transferencia'}`}>
                            {x.sentido === 'entrada' ? '+' : x.sentido === 'saida' ? '−' : x.sentido === 'folha' ? '' : '⇄ '}{formatMoeda(x.valor, x.moeda)}
                          </span>
                          {(() => {
                            const s = situacaoDoLancamento(!x.planejado, x.data, hoje)
                            return <span className={`text-[11px] font-medium ${s === 'vencido' ? 'text-prejuizo' : s === 'planejado' ? 'text-agendado' : 'text-lucro'}`}>
                              {s === 'vencido' ? 'Vencido' : s === 'planejado' ? 'Planejado' : 'Pago'}
                            </span>
                          })()}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {doDia.some((x) => x.sentido === 'folha') && (
                  <p className="mt-2 text-xs text-slate-500" data-testid="dia-consignado">
                    Consignado é descontado no salário, que já entra líquido: não sai da conta e não entra nas saídas do dia.
                  </p>
                )}
                {doDia.some((x) => x.moeda !== 'BRL') && (
                  <p className="mt-2 text-xs text-slate-500" data-testid="dia-outras-moedas">
                    Valores em {[...new Set(doDia.filter((x) => x.moeda !== 'BRL').map((x) => x.moeda))].join(', ')} ficam na moeda da conta, sem conversão: não entram nos totais em reais.
                  </p>
                )}
              </>
            )}
          </Card>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Os totais do mês e os de cada dia vêm do banco (os do mês como em Análises: compra no cartão conta na data de fechamento da fatura).
            No calendário, a compra no cartão não aparece no dia da compra: o pagamento da fatura aparece no dia em que sai da conta.
          </p>
        </>
      )}
    </>
  )
}

/**
 * Uma linha só: o saldo total (em reais, do banco: balance_totals_projected) no dia escolhido ou no fim do mês, só
 * efetuados ou efetuados + planejados (desde a migration 069, com as assinaturas e os lançamentos fixos previstos, os
 * mesmos números de Relatórios › Entradas x Saídas). É a única informação daqui que não está em outra tela: o saldo por conta
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
            className={`min-h-11 rounded-lg px-3 text-xs font-semibold ${!incluir ? 'bg-azul text-white' : 'bg-fundo text-slate-600'}`}>Só efetuados</button>
          <button type="button" aria-pressed={incluir} onClick={() => setIncluir(true)}
            className={`min-h-11 rounded-lg px-3 text-xs font-semibold ${incluir ? 'bg-azul text-white' : 'bg-fundo text-slate-600'}`}>Efetuados + planejados</button>
        </div>
      </div>
      {incluir && !carregando && total && (
        <p className="mt-1 text-xs text-slate-500" data-testid="saldo-o-que-inclui">
          Com os planejados, os lançamentos fixos ainda não gerados e as faturas com as assinaturas previstas, como nos Relatórios.
        </p>
      )}
      {incluir && !carregando && total && total.faturasSemConta > 0 && (
        <p className="mt-1 text-xs text-atencao" data-testid="saldo-sem-conta">
          Inclui {formatBRL(total.faturasSemConta)} em faturas e parcelas sem conta de pagamento; escolha a conta em{' '}
          <Link to="/cartoes" className="font-semibold underline">Cartões</Link>.
        </p>
      )}
    </Card>
  )
}
