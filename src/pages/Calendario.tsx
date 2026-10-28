import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Aviso } from '../components/ui/Aviso'
import { Card, CardTitle } from '../components/ui/Card'
import { useFamilia } from '../lib/FamiliaContext'
import { atualizarAutomaticos } from '../lib/automaticos'
import { listarCategorias } from '../lib/categorias'
import { hojeSP, listarContas } from '../lib/contas'
import { mensagemErroBanco } from '../lib/erros'
import { currentMonth, formatBRL, formatDate, formatMonth, primeiraMaiuscula } from '../lib/format'
import type { Cents } from '../lib/format'
import { limitesDoMes, listarLancamentos, listarMovimentosDeDivida, resumoDoMes, somarMeses } from '../lib/lancamentos'
import type { ResumoMes } from '../lib/lancamentos'

/**
 * Calendário do mês: o que entra e sai das contas em cada dia (pago e planejado).
 * Mostra cada lançamento com o seu valor; não soma nada aqui. Os totais do mês vêm do banco (period_summary).
 * Compra no cartão não aparece no dia da compra: entra na fatura, e o pagamento da fatura aparece no dia em que sai da conta.
 */

type Sentido = 'entrada' | 'saida' | 'transferencia'

interface ItemDoDia {
  id: string
  data: string
  descricao: string
  detalhe: string
  valor: Cents
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
  const [erro, setErro] = useState('')
  const [automaticosFalharam, setAutomaticosFalharam] = useState(false)
  const pedido = useRef(0)

  useEffect(() => {
    if (!familiaId) return
    const meu = ++pedido.current
    const vivo = () => meu === pedido.current
    setItens(null)
    setResumo(null)
    setErro('')
    atualizarAutomaticos()
      .then((r) => { if (vivo()) setAutomaticosFalharam(!r.faturasOk || !r.recorrentesOk) })
      .then(() => Promise.all([
        listarLancamentos(familiaId, mes),
        listarMovimentosDeDivida(familiaId, mes),
        listarContas(familiaId, hoje).catch(() => null),
        listarCategorias(familiaId).catch(() => null),
        resumoDoMes(familiaId, mes).catch(() => null),
      ]))
      .then(([lancs, movs, contas, cats, res]) => {
        if (!vivo()) return
        const nomeConta = new Map((contas?.contas ?? []).map((c) => [c.id, c.nome]))
        const nomeCategoria = new Map((cats ?? []).map((c) => [c.id, c.nome]))
        const doMes: ItemDoDia[] = [
          ...lancs.map((l): ItemDoDia => ({
            id: `t-${l.id}`,
            data: l.data,
            descricao: l.descricao || (l.tipo === 'income' ? 'Receita' : l.tipo === 'expense' ? 'Despesa' : 'Transferência'),
            detalhe: l.tipo === 'transfer'
              ? `${nomeConta.get(l.contaId) ?? 'Conta'} → ${l.destinoId ? nomeConta.get(l.destinoId) ?? 'Conta' : 'Conta'}`
              : [l.categoriaId ? nomeCategoria.get(l.categoriaId) : null, nomeConta.get(l.contaId)].filter(Boolean).join(' · '),
            valor: l.valor,
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
            sentido: m.valor >= 0 ? 'entrada' : 'saida',
            planejado: false,
          })),
        ]
        setItens(doMes)
        setResumo(res)
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
      <div className="mb-4">
        <h1 className="text-2xl font-bold">Calendário</h1>
        <p className="text-sm text-slate-600">O que entra e sai das contas a cada dia do mês.</p>
      </div>

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
          <Card className="!p-3"><p className="text-xs text-slate-500">Receitas pagas</p><p className="tabular-nums font-semibold text-positivo">+{formatBRL(resumo.receitas)}</p></Card>
          <Card className="!p-3"><p className="text-xs text-slate-500">Despesas pagas</p><p className="tabular-nums font-semibold text-negativo">−{formatBRL(resumo.despesas)}</p></Card>
          <Card className="!p-3"><p className="text-xs text-slate-500">Resultado</p><p className={`tabular-nums font-semibold ${resumo.resultado < 0 ? 'text-negativo' : 'text-marinho'}`}>{formatBRL(resumo.resultado)}</p></Card>
        </section>
      )}

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
                      {entrada && <span className="h-1 rounded-full bg-positivo" />}
                      {saida && <span className="h-1 rounded-full bg-negativo" />}
                      {planejados > 0 && <span className="h-1 rounded-full bg-planejado" />}
                    </span>
                  </button>
                )
              })}
            </div>
            <p className="mt-2 flex flex-wrap gap-3 border-t border-slate-100 px-1 pt-2 text-[11px] text-slate-500">
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-positivo" /> Entrou</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-negativo" /> Saiu</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-planejado" /> Planejado</span>
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
                          <span className={`block tabular-nums font-semibold ${x.sentido === 'entrada' ? 'text-positivo' : x.sentido === 'saida' ? 'text-negativo' : 'text-slate-600'}`}>
                            {x.sentido === 'entrada' ? '+' : x.sentido === 'saida' ? '−' : '⇄ '}{formatBRL(x.valor)}
                          </span>
                          <span className={`text-[11px] font-medium ${x.planejado ? 'text-planejado' : 'text-pago'}`}>{x.planejado ? 'Planejado' : 'Pago'}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
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
