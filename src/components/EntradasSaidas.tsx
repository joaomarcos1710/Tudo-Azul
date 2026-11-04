import { useEffect, useState } from 'react'
import { Aviso } from './ui/Aviso'
import { Card, CardTitle } from './ui/Card'
import { useFamilia } from '../lib/FamiliaContext'
import { ResultadoEmOutrasMoedas } from './ui/EmOutrasMoedas'
import { ehReais, listarContas } from '../lib/contas'
import type { Conta } from '../lib/contas'
import { mensagemErroBanco } from '../lib/erros'
import { listarMembros } from '../lib/familia'
import type { Membro } from '../lib/familia'
import { fluxoDeCaixa, periodoDoFluxo } from '../lib/fluxoCaixa'
import type { FluxoCaixa, Passo } from '../lib/fluxoCaixa'
import { asCents, currentMonth, formatBRL, formatDate, formatMonth, primeiraMaiuscula } from '../lib/format'
import { resumoPorMoeda, somarMeses } from '../lib/lancamentos'
import type { ResumoPorMoeda } from '../lib/lancamentos'

const PASSOS: { chave: Passo; rotulo: string }[] = [
  { chave: 'day', rotulo: 'Diário' },
  { chave: 'week', rotulo: 'Semanal' },
  { chave: 'month', rotulo: 'Mensal' },
]

function rotuloBalde(inicio: string, passo: Passo): string {
  if (passo === 'month') return primeiraMaiuscula(formatMonth(inicio.slice(0, 7)))
  if (passo === 'week') return `Semana de ${formatDate(inicio).slice(0, 5)}`
  return formatDate(inicio).slice(0, 5)
}

/** Entradas x Saídas por dia, semana ou mês. Valores, saldos, acumulados e totais vêm do banco (cash_flow_report). */
export function EntradasSaidas() {
  const { familia } = useFamilia()
  const familiaId = familia?.id
  const [mes, setMes] = useState(() => currentMonth())
  const [passo, setPasso] = useState<Passo>('month')
  const [contasEscolhidas, setContasEscolhidas] = useState<string[]>([])
  const [membro, setMembro] = useState('')
  const [naoPagos, setNaoPagos] = useState(false)
  const [contas, setContas] = useState<Conta[]>([])
  const [membros, setMembros] = useState<Membro[]>([])
  const [fluxo, setFluxo] = useState<FluxoCaixa | null>(null)
  // contas em outras moedas (multimoeda F2): à parte, sem conversão; o relatório acima é só em reais
  const [porMoeda, setPorMoeda] = useState<ResumoPorMoeda[]>([])
  const [erro, setErro] = useState('')

  // contas e membros só alimentam os filtros: se falharem, o relatório segue sem eles
  useEffect(() => {
    if (!familiaId) return
    let vivo = true
    // o relatório é em reais (cash_flow_report ignora contas em outra moeda): o filtro só oferece contas em reais
    listarContas(familiaId).then((r) => { if (vivo) setContas(r.contas.filter(ehReais)) }).catch(() => {})
    listarMembros(familiaId).then((r) => { if (vivo) setMembros(r) }).catch(() => {})
    return () => { vivo = false }
  }, [familiaId])

  useEffect(() => {
    if (!familiaId) return
    let vivo = true
    // troca de mês, passo ou filtro: some a tabela antiga (senão o título novo aparece em cima dos números do filtro anterior)
    setFluxo(null)
    setErro('')
    const [de, ate] = periodoDoFluxo(mes, passo)
    fluxoDeCaixa(familiaId, de, ate, passo, { contas: contasEscolhidas, membro, incluirNaoPagos: naoPagos })
      .then((r) => { if (vivo) { setFluxo(r); setErro('') } })
      .catch((err) => { if (vivo) { setFluxo(null); setErro(mensagemErroBanco(err)) } })
    // o bloco por moeda é só do pago e sem filtros de conta e de quem lançou; se falhar, o relatório em reais segue
    setPorMoeda([])
    if (contasEscolhidas.length === 0 && !membro) {
      resumoPorMoeda(familiaId, de, ate).then((r) => { if (vivo) setPorMoeda(r) }).catch(() => {})
    }
    return () => { vivo = false }
  }, [familiaId, mes, passo, contasEscolhidas, membro, naoPagos])

  function alternarConta(id: string) {
    setContasEscolhidas((atual) => (atual.includes(id) ? atual.filter((x) => x !== id) : [...atual, id]))
  }

  const filtraConta = contasEscolhidas.length > 0
  const naoPagosSemAutor = naoPagos && membro !== ''

  return (
    <Card className="mb-4">
      <CardTitle>Entradas x Saídas</CardTitle>
      <p className="mb-3 text-sm text-slate-600">
        Quanto entrou e quanto saiu, em reais, com o acumulado. Transferências entre contas ficam de fora; contas em outras moedas aparecem à parte, só o que foi pago.
        {passo === 'month' ? ' No mensal, mostra os 12 meses até o mês escolhido.' : ' No diário e no semanal, mostra o mês escolhido.'}
      </p>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center gap-1">
          <button type="button" aria-label="Mês anterior" onClick={() => setMes(somarMeses(mes, -1))} className="min-h-11 min-w-11 rounded-lg border border-slate-300 bg-white">‹</button>
          <span className="min-w-36 text-center text-sm font-semibold">{primeiraMaiuscula(formatMonth(mes))}</span>
          <button type="button" aria-label="Próximo mês" onClick={() => setMes(somarMeses(mes, 1))} className="min-h-11 min-w-11 rounded-lg border border-slate-300 bg-white">›</button>
        </div>
        <div role="group" aria-label="Agrupar por" className="inline-flex rounded-lg bg-slate-100 p-1">
          {PASSOS.map((p) => (
            <button key={p.chave} type="button" aria-pressed={passo === p.chave} onClick={() => setPasso(p.chave)}
              className={`min-h-11 rounded-md px-3 text-sm font-semibold ${passo === p.chave ? 'bg-white text-marinho shadow-card' : 'text-slate-600'}`}>
              {p.rotulo}
            </button>
          ))}
        </div>
        {membros.length > 1 && (
          <label className="flex items-center gap-2 text-sm">
            Lançado por
            <select value={membro} onChange={(e) => setMembro(e.target.value)} className="min-h-11 rounded-lg border border-slate-300 bg-white px-2">
              <option value="">Todos</option>
              {membros.map((m) => <option key={m.userId} value={m.userId}>{m.nome || 'Sem nome'}</option>)}
            </select>
          </label>
        )}
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" checked={naoPagos} onChange={(e) => setNaoPagos(e.target.checked)} />
          Considerar não pagos
        </label>
      </div>

      {contas.length > 0 && (
        <fieldset className="mb-3">
          <legend className="mb-1 text-sm font-medium">Contas {filtraConta ? '' : <span className="font-normal text-slate-600">(todas)</span>}</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {contas.map((c) => (
              <label key={c.id} className="flex min-h-11 items-center gap-2 text-sm">
                <input type="checkbox" checked={contasEscolhidas.includes(c.id)} onChange={() => alternarConta(c.id)} />
                {c.nome}{c.ativa ? '' : ' (arquivada)'}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {filtraConta && (
        <div className="mb-3"><Aviso tipo="info">Com conta escolhida, ficam de fora as compras e estornos de cartão e as parcelas a vencer, porque não têm conta. Juros e tarifas entram.</Aviso></div>
      )}
      {naoPagosSemAutor && (
        <div className="mb-3"><Aviso tipo="info">As parcelas de cartão a vencer não têm autor e não entram quando se filtra por quem lançou.</Aviso></div>
      )}
      {erro && <div className="mb-3"><Aviso tipo="erro">{erro}</Aviso></div>}
      {!fluxo && !erro && <p className="text-sm text-slate-600" role="status">Carregando…</p>}

      {fluxo && <ResultadoEmOutrasMoedas porMoeda={porMoeda} className="mb-3 rounded-lg bg-slate-50 px-3 py-2" />}
      {fluxo && (
        // celular: um cartão por período, sem rolar para o lado; a partir de sm, a tabela
        <ul className="divide-y divide-slate-100 sm:hidden" aria-label="Entradas e saídas por período">
          {fluxo.linhas.map((l) => (
            <li key={l.inicio} className="py-3 text-sm">
              <p className="mb-1 font-semibold text-marinho">{rotuloBalde(l.inicio, passo)}</p>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
                <dt className="text-slate-500">Entradas</dt><dd className="text-right tabular-nums text-positivo">{formatBRL(l.entradas)}</dd>
                <dt className="text-slate-500">Saídas</dt><dd className="text-right tabular-nums text-negativo">{formatBRL(l.saidas)}</dd>
                <dt className="text-slate-500">Saldo</dt><dd className="text-right tabular-nums">{formatBRL(l.saldo)}</dd>
                <dt className="text-slate-500">Acumulado</dt><dd className="text-right tabular-nums">{formatBRL(l.acumulado)}</dd>
              </dl>
            </li>
          ))}
          <li className="py-3 text-sm font-semibold">
            <p className="mb-1">Total do período</p>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
              <dt>Entradas</dt><dd className="text-right tabular-nums text-positivo">{formatBRL(fluxo.totalEntradas)}</dd>
              <dt>Saídas</dt><dd className="text-right tabular-nums text-negativo">{formatBRL(fluxo.totalSaidas)}</dd>
              <dt>Saldo</dt><dd className="text-right tabular-nums">{formatBRL(fluxo.linhas[fluxo.linhas.length - 1]?.acumulado ?? asCents(0)!)}</dd>
            </dl>
          </li>
        </ul>
      )}
      {fluxo && (
        <div className="hidden overflow-x-auto sm:block">
          <table className="w-full text-sm">
            <caption className="sr-only">Entradas, saídas, saldo e acumulado por período</caption>
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-600">
                <th scope="col" className="py-2 pr-3 font-medium">Período</th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">Entradas</th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">Saídas</th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">Saldo</th>
                <th scope="col" className="py-2 text-right font-medium">Acumulado</th>
              </tr>
            </thead>
            <tbody>
              {fluxo.linhas.map((l) => (
                <tr key={l.inicio} className="border-b border-slate-100">
                  <th scope="row" className="py-2 pr-3 text-left font-normal">{rotuloBalde(l.inicio, passo)}</th>
                  <td className="py-2 pr-3 text-right text-positivo">{formatBRL(l.entradas)}</td>
                  <td className="py-2 pr-3 text-right text-negativo">{formatBRL(l.saidas)}</td>
                  <td className="py-2 pr-3 text-right">{formatBRL(l.saldo)}</td>
                  <td className="py-2 text-right">{formatBRL(l.acumulado)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <th scope="row" className="py-2 pr-3 text-left">Total do período</th>
                <td className="py-2 pr-3 text-right text-positivo">{formatBRL(fluxo.totalEntradas)}</td>
                <td className="py-2 pr-3 text-right text-negativo">{formatBRL(fluxo.totalSaidas)}</td>
                <td className="py-2 pr-3 text-right">{formatBRL(fluxo.linhas[fluxo.linhas.length - 1]?.acumulado ?? asCents(0)!)}</td>
                <td className="py-2" />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Card>
  )
}
