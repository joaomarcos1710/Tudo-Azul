import { useEffect, useId, useState } from 'react'
import { Aviso } from './ui/Aviso'
import { Card, CardTitle } from './ui/Card'
import { SeletorPeriodo } from './ui/SeletorPeriodo'
import { Valor } from './EntradasSaidas'
import { useFamilia } from '../lib/FamiliaContext'
import { ehReais, hojeSP, listarContas } from '../lib/contas'
import { mensagemErroBanco } from '../lib/erros'
import { relatorioContas } from '../lib/fluxoCaixa'
import type { LinhaConta, RelatorioContas as Relatorio } from '../lib/fluxoCaixa'
import { formatBRLSinal } from '../lib/format'
import type { Cents } from '../lib/format'
import { rotuloPeriodo } from '../lib/periodoRelatorio'
import type { Periodo } from '../lib/periodoRelatorio'

interface Consulta {
  rel: Relatorio
  periodo: Periodo
  naoPagos: boolean
}

/** "1 conta em outra moeda fica fora" / "2 contas em outra moeda ficam fora" (como em Recorrentes). */
export function avisoOutraMoeda(n: number): string {
  return n === 1 ? '1 conta em outra moeda fica fora (o relatório é em reais, sem conversão).'
    : `${n} contas em outra moeda ficam fora (o relatório é em reais, sem conversão).`
}

/**
 * Relatório › Contas (#182, como no Organizze): uma linha por conta ativa em reais, com o saldo no início, as entradas,
 * as saídas e o saldo no fim do período, e o total. Regime de caixa, como o extrato da conta: o cartão sai no dia do
 * pagamento da fatura (com "Todos", a que falta pagar sai no vencimento, com as assinaturas previstas); transferência
 * entre contas é entrada numa e saída na outra, e fica fora do total. Tudo vem do banco numa chamada
 * (account_flow_report, migration 067); o front não soma.
 */
export function RelatorioContas({ periodo, aoMudarPeriodo }: { periodo: Periodo; aoMudarPeriodo: (p: Periodo) => void }) {
  const { familia } = useFamilia()
  const familiaId = familia?.id
  const hoje = hojeSP()
  const [naoPagos, setNaoPagos] = useState(false)
  const [consulta, setConsulta] = useState<Consulta | null>(null)
  const [erro, setErro] = useState('')
  // só para o aviso: quantas contas ativas em outra moeda ficam fora (contar contas não é somar dinheiro)
  const [foraDoReal, setForaDoReal] = useState(0)
  const idLanc = useId()

  useEffect(() => {
    if (!familiaId) return
    let vivo = true
    listarContas(familiaId).then((r) => { if (vivo) setForaDoReal(r.contas.filter((c) => c.ativa && !ehReais(c)).length) }).catch(() => {})
    return () => { vivo = false }
  }, [familiaId])

  useEffect(() => {
    if (!familiaId) return
    let vivo = true
    setConsulta(null)
    setErro('')
    relatorioContas(familiaId, periodo.de, periodo.ate, naoPagos)
      .then((r) => { if (vivo) setConsulta({ rel: r, periodo, naoPagos }) })
      .catch((err) => { if (vivo) setErro(mensagemErroBanco(err)) })
    return () => { vivo = false }
  }, [familiaId, periodo, naoPagos])

  const pilula = (ativo: boolean) => `min-h-11 flex-1 whitespace-nowrap rounded-md px-3 text-sm font-semibold ${ativo ? 'bg-white text-marinho shadow-card' : 'text-slate-600'}`
  const rel = consulta?.rel ?? null

  return (
    <section aria-label="Contas" className="mb-4">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <SeletorPeriodo periodo={periodo} hoje={hoje} aoMudar={aoMudarPeriodo} />
        <div>
          <p id={idLanc} className="sr-only">Considerar lançamentos</p>
          <div role="group" aria-labelledby={idLanc} className="flex rounded-lg bg-slate-100 p-1">
            <button type="button" aria-pressed={!naoPagos} onClick={() => setNaoPagos(false)} className={pilula(!naoPagos)}>Só pagos</button>
            <button type="button" aria-pressed={naoPagos} onClick={() => setNaoPagos(true)} className={pilula(naoPagos)}>Todos</button>
          </div>
        </div>
      </div>

      {foraDoReal > 0 && <div className="mb-3"><Aviso tipo="info">{avisoOutraMoeda(foraDoReal)}</Aviso></div>}
      {erro && <div className="mb-3"><Aviso tipo="erro">{erro}</Aviso></div>}

      <Card>
        <CardTitle>Contas · {rotuloPeriodo(consulta?.periodo ?? periodo)}</CardTitle>
        {!rel && !erro && <p className="text-sm text-slate-600" role="status">Carregando…</p>}
        {rel && rel.linhas.length === 0 && (
          <p className="text-sm text-slate-600">Nenhuma conta ativa em reais aberta até o fim deste período.</p>
        )}
        {rel && rel.linhas.length > 0 && consulta && <TabelaContas consulta={consulta} />}
        {rel && rel.linhas.length > 0 && (
          <div className="mt-2 flex flex-col gap-1 text-xs text-slate-500" data-testid="notas-contas">
            <p>
              Em reais, como o extrato de cada conta. Cartão: a fatura sai no dia do pagamento
              {consulta?.naoPagos ? '; a que falta pagar, no vencimento, com as assinaturas previstas. Com os planejados e os lançamentos fixos previstos.' : ' (só o efetuado).'}
            </p>
            <p>
              Transferência entre contas é entrada numa e saída na outra. No total ela fica fora, porque o dinheiro só mudou de
              conta: as transferências somam <span className="tabular-nums">{formatBRLSinal(rel.totalTransferencias)}</span> no total da família.
            </p>
          </div>
        )}
      </Card>
    </section>
  )
}

/** "Transferências: +R$ 200,00 · −R$ 50,00" embaixo do nome (só o que houver). */
function Transferencias({ l }: { l: LinhaConta }) {
  const partes = [
    ...(l.transferenciasEntrada !== 0 ? [`+${formatBRLSinal(l.transferenciasEntrada)}`] : []),
    ...(l.transferenciasSaida !== 0 ? [formatBRLSinal(-l.transferenciasSaida as Cents)] : []),
  ]
  if (partes.length === 0) return null
  // no celular "Transf.", para a coluna da conta não empurrar a tabela para o lado
  return (
    <span className="block text-[10px] font-normal text-slate-500 sm:text-xs">
      <abbr title="Transferências" className="no-underline sm:hidden">Transf.</abbr><span className="hidden sm:inline">Transferências</span>: {partes.join(' · ')}
    </span>
  )
}

function TabelaContas({ consulta }: { consulta: Consulta }) {
  const { rel, periodo } = consulta
  // no celular os títulos podem quebrar em duas linhas: assim as 5 colunas cabem em 375px sem rolar para o lado
  const th = 'py-2 pl-0.5 text-right align-bottom font-medium sm:whitespace-nowrap sm:px-1 lg:px-1.5'
  const td = 'py-2 pl-0.5 text-right align-top sm:px-1 lg:px-1.5'
  return (
    // w-0 min-w-full: uma tabela larga não alarga a página, só rola dentro da própria caixa
    <div className="mt-4 w-0 min-w-full overflow-x-auto" data-testid="caixa-tabela-contas">
      <p className="mb-1 text-xs text-slate-500 sm:hidden">Valores em R$.</p>
      <table className="w-full text-[11px] tracking-tight sm:text-xs sm:tracking-normal lg:text-sm">
        <caption className="sr-only">Saldo no início, entradas, saídas e saldo no fim de cada conta em {rotuloPeriodo(periodo)}</caption>
        <thead>
          <tr className="border-b border-slate-200 text-slate-600">
            <th scope="col" className="py-2 pr-1 text-left align-bottom font-medium">Conta</th>
            <th scope="col" className={th}>Saldo inicial</th>
            <th scope="col" className={th}>Entradas</th>
            <th scope="col" className={th}>Saídas</th>
            <th scope="col" className={th}>Saldo final</th>
          </tr>
        </thead>
        <tbody>
          {rel.linhas.map((l) => (
            <tr key={l.contaId} className="border-b border-slate-100" data-testid="linha-conta">
              <th scope="row" className="py-2 pr-1 text-left align-top font-normal">
                <span className="break-words">{l.nome}</span>
                <Transferencias l={l} />
              </th>
              <td className={td}><Valor v={l.saldoInicial} tipo="saldo" /></td>
              <td className={td}><Valor v={l.entradas} tipo="entrada" /></td>
              <td className={td}><Valor v={l.saidas} tipo="saida" /></td>
              <td className={td}><Valor v={l.saldoFinal} tipo="saldo" /></td>
            </tr>
          ))}
        </tbody>
        <tfoot className="bg-slate-50">
          <tr className="border-t-2 border-slate-300 font-semibold text-marinho" data-testid="total-contas">
            <th scope="row" className="py-2 pr-1 text-left">
              Total
              <span className="block text-[10px] font-normal text-slate-500 sm:text-xs">sem as transferências</span>
            </th>
            <td className={td}><Valor v={rel.totalInicial} tipo="saldo" /></td>
            <td className={td}><Valor v={rel.totalEntradas} tipo="entrada" /></td>
            <td className={td}><Valor v={rel.totalSaidas} tipo="saida" /></td>
            <td className={td}><Valor v={rel.totalFinal} tipo="saldo" /></td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
