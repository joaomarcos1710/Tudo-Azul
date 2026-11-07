import { useEffect, useMemo, useState } from 'react'
import { Card, CardTitle } from './Card'
import { carregarProjecaoCompromissos } from '../../lib/projecaoCompromissos'
import type { LinhaProjecaoCompromisso } from '../../lib/projecaoCompromissos'
import { formatMoeda } from '../../lib/format'
import { mensagemErroBanco } from '../../lib/erros'
import { registrarFalhaConsulta } from '../../lib/consultaOpcional'

type Periodo = 3 | 6

interface Props {
  familiaId: string
  hoje: string
}

interface LinhaAgrupada {
  id: string
  descricao: string
  origem: string | null
  tipoOrigem: string
  moeda: string
  valores: Map<string, LinhaProjecaoCompromisso>
}

function proximosMeses(hoje: string, quantidade: Periodo): string[] {
  const [ano, mes] = hoje.slice(0, 7).split('-').map(Number)
  return Array.from({ length: quantidade }, (_, i) => {
    const data = new Date(Date.UTC(ano, mes - 1 + i, 1))
    return `${data.getUTCFullYear()}-${String(data.getUTCMonth() + 1).padStart(2, '0')}`
  })
}

function rotuloMes(mes: string): string {
  const [ano, numero] = mes.split('-').map(Number)
  const nome = new Date(Date.UTC(ano, numero - 1, 1))
    .toLocaleDateString('pt-BR', { month: 'short', timeZone: 'UTC' })
    .replace('.', '')
  return `${nome.charAt(0).toLocaleUpperCase('pt-BR')}${nome.slice(1)} ${String(ano).slice(-2)}`
}

/** Widget do Início. Todas as somas e os totais mensais vêm da RPC; o componente só organiza as células. */
export function ProjecaoCompromissos({ familiaId, hoje }: Props) {
  const [periodo, setPeriodo] = useState<Periodo>(6)
  const [linhas, setLinhas] = useState<LinhaProjecaoCompromisso[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState(false)

  useEffect(() => {
    let ativo = true
    setCarregando(true)
    setErro(false)
    carregarProjecaoCompromissos(familiaId, hoje, 6)
      .then((resultado) => {
        if (ativo) setLinhas(resultado)
      })
      .catch((falha: unknown) => {
        void registrarFalhaConsulta('dashboard_commitment_matrix', falha)
        if (ativo) setErro(true)
      })
      .finally(() => {
        if (ativo) setCarregando(false)
      })
    return () => { ativo = false }
  }, [familiaId, hoje])

  const meses = useMemo(() => proximosMeses(hoje, periodo), [hoje, periodo])
  const matriz = useMemo(() => {
    const itens = new Map<string, LinhaAgrupada>()
    const totais = new Map<string, Map<string, LinhaProjecaoCompromisso>>()

    for (const linha of linhas) {
      if (!meses.includes(linha.mes)) continue
      if (linha.tipoLinha === 'total') {
        let porMes = totais.get(linha.moeda)
        if (!porMes) {
          porMes = new Map()
          totais.set(linha.moeda, porMes)
        }
        porMes.set(linha.mes, linha)
        continue
      }

      const id = linha.id ?? `${linha.descricao}:${linha.moeda}`
      const chave = `${id}:${linha.moeda}`
      let item = itens.get(chave)
      if (!item) {
        item = {
          id: chave,
          descricao: linha.descricao,
          origem: linha.origem,
          tipoOrigem: linha.tipoOrigem,
          moeda: linha.moeda,
          valores: new Map(),
        }
        itens.set(chave, item)
      }
      item.valores.set(linha.mes, linha)
    }

    return {
      itens: [...itens.values()].sort((a, b) =>
        a.moeda.localeCompare(b.moeda) || a.descricao.localeCompare(b.descricao, 'pt-BR')),
      totais: [...totais.entries()].sort(([a], [b]) => a.localeCompare(b)),
    }
  }, [linhas, meses])

  return (
    <Card className="mt-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle>Projeção de compromissos</CardTitle>
          <p className="-mt-1 mb-3 text-xs text-slate-500">
            Despesas fixas e parcelas já assumidas, organizadas pelo mês de vencimento.
          </p>
        </div>
        <div className="flex shrink-0 rounded-lg bg-slate-100 p-1" aria-label="Período da projeção">
          {([3, 6] as const).map((opcao) => (
            <button
              key={opcao}
              type="button"
              aria-pressed={periodo === opcao}
              onClick={() => setPeriodo(opcao)}
              className={`min-h-8 rounded-md px-3 text-xs font-semibold transition-colors ${
                periodo === opcao ? 'bg-white text-marinho shadow-sm' : 'text-slate-500 hover:text-marinho'
              }`}
            >
              {opcao} meses
            </button>
          ))}
        </div>
      </div>

      {carregando ? (
        <p className="py-5 text-sm text-slate-500" role="status">Carregando os compromissos futuros…</p>
      ) : erro ? (
        <p className="py-4 text-sm text-slate-600" role="status">
          {mensagemErroBanco({ code: 'UNKNOWN' })}
        </p>
      ) : matriz.itens.length === 0 ? (
        <p className="py-4 text-sm text-slate-500">Nenhum compromisso previsto nos próximos {periodo} meses.</p>
      ) : (
        <div className="-mx-5 overflow-x-auto px-5">
          <table className="w-full min-w-[660px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-xs text-slate-500">
                <th scope="col" className="w-[34%] min-w-56 py-2 pr-4 text-left font-medium">Despesa / contrato</th>
                {meses.map((mes) => (
                  <th key={mes} scope="col" className="min-w-24 px-2 py-2 text-right font-medium">{rotuloMes(mes)}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {matriz.itens.map((item) => (
                <tr key={item.id} className="transition-colors hover:bg-slate-50">
                  <th scope="row" className="py-3 pr-4 text-left font-medium text-slate-800">
                    <span className="block truncate">{item.descricao}</span>
                    <span className="mt-0.5 block truncate text-xs font-normal text-slate-500">
                      {item.tipoOrigem}{item.origem ? ` · ${item.origem}` : ''}
                    </span>
                  </th>
                  {meses.map((mes) => {
                    const valor = item.valores.get(mes)
                    return (
                      <td key={mes} className="px-2 py-3 text-right tabular-nums">
                        {valor ? formatMoeda(valor.valor, item.moeda) : <span className="text-slate-300">-</span>}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-slate-200">
              {matriz.totais.map(([moeda, porMes]) => (
                <tr key={moeda} className="bg-slate-50/70 font-semibold">
                  <th scope="row" className="py-3 pr-4 text-left text-slate-700">
                    Total do mês <span className="ml-1 text-xs font-normal text-slate-500">({moeda})</span>
                  </th>
                  {meses.map((mes) => {
                    const total = porMes.get(mes)
                    return (
                      <td key={mes} className="px-2 py-3 text-right tabular-nums text-prejuizo">
                        {formatMoeda(total?.valor ?? (0 as LinhaProjecaoCompromisso['valor']), moeda)}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tfoot>
          </table>
        </div>
      )}
      <p className="mt-3 text-xs text-slate-500">
        Os totais são separados por moeda. Parcelas de cartão consideram o saldo ainda em aberto da fatura; consignados não reduzem o caixa projetado.
      </p>
    </Card>
  )
}
