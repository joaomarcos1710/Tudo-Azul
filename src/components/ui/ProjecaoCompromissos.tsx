import { useEffect, useMemo, useState } from 'react'
import { Card, CardTitle } from './Card'
import { carregarProjecaoCompromissos } from '../../lib/projecaoCompromissos'
import type { LinhaProjecaoCompromisso } from '../../lib/projecaoCompromissos'
import { formatMoeda } from '../../lib/format'
import { mensagemErroBanco } from '../../lib/erros'
import { registrarFalhaConsulta } from '../../lib/consultaOpcional'
import { MASCARA, useValoresOcultos } from '../../lib/privacidade'

type Periodo = 3 | 6

interface Props {
  familiaId: string
  hoje: string
}

interface LinhaAgrupada {
  id: string
  /** O id que o banco manda ("account-recurrence:…", "card-purchase:…"): diz de que tipo de compromisso é a linha. */
  idBase: string
  descricao: string
  origem: string | null
  tipoOrigem: string
  moeda: string
  valores: Map<string, LinhaProjecaoCompromisso>
}

/** Os blocos da matriz, em ordem. O tipo vem do prefixo do id que o banco manda; a tela só organiza, não decide valor nenhum. */
export type ChaveGrupo = 'fixas' | 'assinaturas' | 'parcelamentos' | 'avulsos' | 'outros'
export const GRUPOS: { chave: ChaveGrupo; rotulo: string; recolhidoNoInicio: boolean }[] = [
  { chave: 'fixas', rotulo: 'Contas fixas e recorrentes', recolhidoNoInicio: false },
  { chave: 'assinaturas', rotulo: 'Assinaturas no cartão', recolhidoNoInicio: false },
  { chave: 'parcelamentos', rotulo: 'Parcelamentos e financiamentos', recolhidoNoInicio: false },
  { chave: 'avulsos', rotulo: 'Lançamentos avulsos e ajustes da fatura', recolhidoNoInicio: true },
  { chave: 'outros', rotulo: 'Outros', recolhidoNoInicio: false },
]
export function grupoDoCompromisso(idBase: string): ChaveGrupo {
  if (idBase.startsWith('account-recurrence:')) return 'fixas'
  if (idBase.startsWith('card-recurrence:')) return 'assinaturas'
  if (idBase.startsWith('transaction-installment:') || idBase.startsWith('card-purchase:') || idBase.startsWith('debt-schedule:')) return 'parcelamentos'
  if (idBase.startsWith('transaction:') || idBase.startsWith('card-invoice-adjustment:')) return 'avulsos'
  return 'outros'
}

/**
 * Uma assinatura ou conta fixa que foi "dividida" (mudar o dia daqui pra frente cria uma regra nova com o mesmo nome) aparece
 * como duas linhas com o mesmo nome e meses diferentes. Junta numa só quando os meses não se sobrepõem (as células só mudam de
 * linha; nenhum valor é somado). Se dois meses coincidirem, mantém separadas: quem decide qual vale é o banco.
 */
export function unirRegrasDivididas(itens: LinhaAgrupada[]): LinhaAgrupada[] {
  const resultado: LinhaAgrupada[] = []
  const porNome = new Map<string, LinhaAgrupada>()
  for (const item of itens) {
    const grupo = grupoDoCompromisso(item.idBase)
    if (grupo !== 'fixas' && grupo !== 'assinaturas') { resultado.push(item); continue }
    const chave = `${grupo}|${item.descricao.trim().toLocaleLowerCase('pt-BR')}|${item.origem ?? ''}|${item.moeda}`
    const existente = porNome.get(chave)
    if (existente && [...item.valores.keys()].every((mes) => !existente.valores.has(mes))) {
      for (const [mes, valor] of item.valores) existente.valores.set(mes, valor)
      continue
    }
    if (!existente) porNome.set(chave, item)
    resultado.push(item)
  }
  return resultado
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
  const valoresOcultos = useValoresOcultos()
  // blocos recolhidos (os avulsos começam fechados: são dezenas de linhas sem futuro)
  const [recolhidos, setRecolhidos] = useState<Set<ChaveGrupo>>(() => new Set(GRUPOS.filter((g) => g.recolhidoNoInicio).map((g) => g.chave)))
  const alternar = (chave: ChaveGrupo) => setRecolhidos((atual) => { const novo = new Set(atual); if (novo.has(chave)) novo.delete(chave); else novo.add(chave); return novo })
  const mesAtual = hoje.slice(0, 7)

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
          idBase: id,
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

    const ordenados = [...itens.values()].sort((a, b) =>
      a.moeda.localeCompare(b.moeda) || a.descricao.localeCompare(b.descricao, 'pt-BR'))
    const unidos = unirRegrasDivididas(ordenados)
    return {
      itens: unidos,
      grupos: GRUPOS
        .map((g) => ({ ...g, itens: unidos.filter((i) => grupoDoCompromisso(i.idBase) === g.chave) }))
        .filter((g) => g.itens.length > 0),
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
        <div className="-mx-5 max-h-[70vh] overflow-auto px-5" data-testid="matriz-rolagem">
          <table className="block w-full border-collapse text-sm md:table md:min-w-[660px]">
            <thead className="sr-only md:not-sr-only md:table-header-group">
              <tr className="border-b border-slate-100 text-xs text-slate-500">
                <th scope="col" className="sticky top-0 z-10 w-[34%] min-w-56 bg-white py-2 pr-4 text-left font-medium">Despesa / contrato</th>
                {meses.map((mes) => (
                  <th key={mes} scope="col" aria-current={mes === mesAtual ? 'date' : undefined}
                    className={`sticky top-0 z-10 min-w-24 px-2 py-2 text-right font-medium ${mes === mesAtual ? 'bg-azul-claro text-azul' : 'bg-white'}`}>
                    {rotuloMes(mes)}
                  </th>
                ))}
              </tr>
            </thead>
            {matriz.grupos.map((g) => {
              const recolhido = recolhidos.has(g.chave)
              return (
                <tbody key={g.chave} data-testid={`grupo-${g.chave}`} className="block divide-y divide-slate-100 md:table-row-group">
                  <tr className="block bg-slate-50 md:table-row">
                    <th scope="colgroup" colSpan={meses.length + 1} className="block px-0 py-0 text-left md:table-cell">
                      <button type="button" aria-expanded={!recolhido} onClick={() => alternar(g.chave)}
                        className="flex min-h-11 w-full items-center gap-2 px-1 text-left text-sm font-semibold text-marinho hover:bg-slate-100">
                        <span aria-hidden="true" className="w-4 text-slate-500">{recolhido ? '▸' : '▾'}</span>
                        {g.rotulo} <span className="font-normal text-slate-500">· {g.itens.length}</span>
                      </button>
                    </th>
                  </tr>
                  {!recolhido && g.itens.map((item) => (
                    <tr key={item.id} className="block py-3 transition-colors hover:bg-slate-50 md:table-row md:py-0">
                      <th scope="row" className="block pb-1 pr-0 text-left font-medium text-slate-800 md:table-cell md:py-3 md:pb-0 md:pr-4">
                        <span className="block truncate">{item.descricao}</span>
                        <span className="mt-0.5 block truncate text-xs font-normal text-slate-500">
                          {item.tipoOrigem}{item.origem ? ` · ${item.origem}` : ''}
                        </span>
                      </th>
                      {meses.map((mes) => {
                        const valor = item.valores.get(mes)
                        return (
                          <td key={mes} data-label={rotuloMes(mes)} className={`flex items-baseline justify-between gap-3 py-0.5 text-right tabular-nums before:text-xs before:font-normal before:text-slate-500 before:content-[attr(data-label)] md:table-cell md:px-2 md:py-3 md:before:content-none ${mes === mesAtual ? 'md:bg-azul-claro/40' : ''}`}>
                            {valor ? (valoresOcultos ? MASCARA : formatMoeda(valor.valor, item.moeda)) : <span className="text-slate-300">-</span>}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              )
            })}
            <tfoot className="block border-t-2 border-slate-200 md:table-footer-group">
              {matriz.totais.map(([moeda, porMes]) => (
                <tr key={moeda} className="block bg-slate-50/70 py-2 font-semibold md:table-row md:py-0">
                  <th scope="row" className="block pr-0 pb-1 text-left text-slate-700 md:table-cell md:py-3 md:pb-0 md:pr-4">
                    Total do mês <span className="ml-1 text-xs font-normal text-slate-500">({moeda})</span>
                  </th>
                  {meses.map((mes) => {
                    const total = porMes.get(mes)
                    return (
                      <td key={mes} data-label={rotuloMes(mes)} className="flex items-baseline justify-between gap-3 py-0.5 text-right tabular-nums text-prejuizo before:text-xs before:font-normal before:text-slate-500 before:content-[attr(data-label)] md:table-cell md:px-2 md:py-3 md:before:content-none">
                        {valoresOcultos ? MASCARA : formatMoeda(total?.valor ?? (0 as LinhaProjecaoCompromisso['valor']), moeda)}
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
