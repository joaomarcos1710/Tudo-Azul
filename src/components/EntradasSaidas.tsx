import { useEffect, useId, useMemo, useState } from 'react'
import { Aviso } from './ui/Aviso'
import { Button } from './ui/Button'
import { Card, CardTitle } from './ui/Card'
import { Folha } from './ui/Folha'
import { BalancoMensal } from './graficos/BalancoMensal'
import type { MesBalanco } from './graficos/BalancoMensal'
import { LinhaMensal } from './graficos/LinhaMensal'
import { COR_DESPESA, COR_RECEITA, COR_SALDO } from './graficos/cores'
import { useFamilia } from '../lib/FamiliaContext'
import { ResultadoEmOutrasMoedas } from './ui/EmOutrasMoedas'
import { ehReais, listarContas } from '../lib/contas'
import type { Conta } from '../lib/contas'
import { mensagemErroBanco } from '../lib/erros'
import { listarMembros } from '../lib/familia'
import type { Membro } from '../lib/familia'
import { fimDoBalde, fluxoDeCaixa, periodoDoFluxo } from '../lib/fluxoCaixa'
import type { FluxoCaixa, Passo } from '../lib/fluxoCaixa'
import { asCents, currentMonth, formatBRLSinal, formatDate, formatMonth, primeiraMaiuscula } from '../lib/format'
import type { Cents } from '../lib/format'
import { resumoPorMoeda } from '../lib/lancamentos'
import type { ResumoPorMoeda } from '../lib/lancamentos'
import { saldosNasDatas } from '../lib/saldoProjetado'
import { SeletorMes } from './ui/SeletorMes'

const PASSOS: { chave: Passo; rotulo: string; periodo: string }[] = [
  { chave: 'day', rotulo: 'Diário', periodo: 'dia' },
  { chave: 'week', rotulo: 'Semanal', periodo: 'semana' },
  { chave: 'month', rotulo: 'Mensal', periodo: 'mês' },
]

/** "2025-12" → "dez/25" (celular e iPad em retrato). */
export function mesAbreviado(ym: string): string {
  return `${formatMonth(ym).slice(0, 3)}/${ym.slice(2, 4)}`
}

/** Rótulos de um período: curto (celular/iPad retrato, eixo do gráfico) e por extenso (computador, tooltip). */
function rotulos(inicio: string, passo: Passo): { curto: string; longo: string; eixo: string } {
  const diaMes = formatDate(inicio).slice(0, 5)
  if (passo === 'month') return { curto: mesAbreviado(inicio.slice(0, 7)), longo: primeiraMaiuscula(formatMonth(inicio.slice(0, 7))), eixo: mesAbreviado(inicio.slice(0, 7)) }
  if (passo === 'week') return { curto: `sem. ${diaMes}`, longo: `Semana de ${diaMes}`, eixo: diaMes }
  return { curto: diaMes, longo: diaMes, eixo: inicio.slice(8, 10) }
}

interface Filtros {
  passo: Passo
  naoPagos: boolean
  /** Vazio = todas as contas. */
  contas: string[]
  membro: string
  acumulado: boolean
}

const FILTROS_PADRAO: Filtros = { passo: 'month', naoPagos: false, contas: [], membro: '', acumulado: false }

interface Consulta {
  fluxo: FluxoCaixa
  passo: Passo
  /** Último dia de cada período, na ordem das linhas (para pedir o saldo ao banco). */
  finais: string[]
  /** O saldo só vale sem filtro de conta e de autor (balance_totals_projected não filtra). */
  comSaldo: boolean
  naoPagos: boolean
}

/** Saldo de cada período, sempre amarrado à consulta de que veio (nunca mostra o saldo de um filtro anterior). */
type EstadoSaldo = { de: Consulta | null } & ({ tipo: 'carregando' } | { tipo: 'pronto'; valores: Cents[] } | { tipo: 'erro' })

/**
 * Entradas x Saídas por dia, semana ou mês. Valores, resultados, acumulados e totais vêm do banco (cash_flow_report);
 * o saldo de cada período é o saldo das contas no último dia dele (balance_totals_projected). O front não soma nada.
 */
export function EntradasSaidas() {
  const { familia } = useFamilia()
  const familiaId = familia?.id
  const [mes, setMes] = useState(() => currentMonth())
  const [filtros, setFiltros] = useState<Filtros>(FILTROS_PADRAO)
  const [folhaAberta, setFolhaAberta] = useState(false)
  const [contas, setContas] = useState<Conta[]>([])
  const [membros, setMembros] = useState<Membro[]>([])
  const [consulta, setConsulta] = useState<Consulta | null>(null)
  const [saldo, setSaldo] = useState<EstadoSaldo>({ de: null, tipo: 'carregando' })
  // contas em outras moedas (multimoeda F2): à parte, sem conversão; o relatório acima é só em reais
  const [porMoeda, setPorMoeda] = useState<ResumoPorMoeda[]>([])
  const [erro, setErro] = useState('')
  const { passo, naoPagos, contas: contasEscolhidas, membro, acumulado } = filtros

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
    setConsulta(null)
    setErro('')
    const [de, ate] = periodoDoFluxo(mes, passo)
    const comSaldo = contasEscolhidas.length === 0 && !membro
    fluxoDeCaixa(familiaId, de, ate, passo, { contas: contasEscolhidas, membro, incluirNaoPagos: naoPagos })
      .then((r) => {
        if (!vivo) return
        setConsulta({ fluxo: r, passo, finais: r.linhas.map((l) => fimDoBalde(l.inicio, passo, ate)), comSaldo, naoPagos })
        setErro('')
      })
      .catch((err) => { if (vivo) { setConsulta(null); setErro(mensagemErroBanco(err)) } })
    // o bloco por moeda é só do pago e sem filtros de conta e de quem lançou; se falhar, o relatório em reais segue
    setPorMoeda([])
    if (comSaldo) {
      resumoPorMoeda(familiaId, de, ate).then((r) => { if (vivo) setPorMoeda(r) }).catch(() => {})
    }
    return () => { vivo = false }
  }, [familiaId, mes, passo, contasEscolhidas, membro, naoPagos])

  // saldo no fim de cada período: depois que as linhas chegam (as datas vêm delas); se falhar, a coluna some
  useEffect(() => {
    if (!familiaId || !consulta?.comSaldo || consulta.finais.length === 0) return
    let vivo = true
    saldosNasDatas(familiaId, consulta.finais, consulta.naoPagos)
      .then((valores) => { if (vivo) setSaldo({ de: consulta, tipo: 'pronto', valores }) })
      .catch(() => { if (vivo) setSaldo({ de: consulta, tipo: 'erro' }) })
    return () => { vivo = false }
  }, [familiaId, consulta])

  const nomeConta = (id: string) => contas.find((c) => c.id === id)?.nome ?? '1 conta'
  const resumoContas = contasEscolhidas.length === 0 ? 'Todas as contas'
    : contasEscolhidas.length === 1 ? nomeConta(contasEscolhidas[0]) : `${contasEscolhidas.length} contas`
  const nomeMembro = membros.find((m) => m.userId === membro)?.nome || 'Sem nome'
  const resumo = [
    PASSOS.find((p) => p.chave === passo)!.rotulo,
    naoPagos ? 'Pagos e não pagos' : 'Só pagos',
    resumoContas,
    ...(membro ? [`Lançado por ${nomeMembro}`] : []),
  ].join(' · ')

  const filtraConta = contasEscolhidas.length > 0
  const naoPagosSemAutor = naoPagos && membro !== ''
  const fluxo = consulta?.fluxo ?? null
  const passoMostrado = consulta?.passo ?? passo
  const saldoDaConsulta = saldo.de === consulta ? saldo.tipo : 'carregando'
  const mostraSaldo = !!consulta?.comSaldo && saldoDaConsulta !== 'erro'
  const valoresSaldo = saldo.de === consulta && saldo.tipo === 'pronto' && saldo.valores.length === fluxo?.linhas.length ? saldo.valores : null
  const termoPeriodo = PASSOS.find((p) => p.chave === passoMostrado)!.periodo

  const barras: MesBalanco[] = useMemo(() => (consulta?.fluxo.linhas ?? []).map((l) => {
    const r = rotulos(l.inicio, consulta!.passo)
    return { mes: l.inicio, receitas: l.entradas, despesas: l.saidas, resultado: l.saldo, rotulo: r.eixo, rotuloLongo: r.longo }
  }), [consulta])

  const titulo = passo === 'month'
    ? `12 meses até ${mesAbreviado(mes)}`
    : `${primeiraMaiuscula(formatMonth(mes))}, ${passo === 'day' ? 'dia a dia' : 'semana a semana'}`

  return (
    <section aria-label="Entradas x Saídas" className="mb-4">
      <div className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <SeletorMes mes={mes} aoMudar={setMes} />
        <button type="button" aria-haspopup="dialog" aria-expanded={folhaAberta} onClick={() => setFolhaAberta(true)}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-1 text-left text-sm hover:bg-azul-claro lg:shrink-0">
          <span className="font-semibold text-azul">Filtros</span>
          <span className="text-slate-600" data-testid="resumo-filtros">{resumo}</span>
        </button>
      </div>

      {folhaAberta && (
        <FolhaFiltros atuais={filtros} contas={contas} membros={membros}
          aoAplicar={(f) => { setFiltros(f); setFolhaAberta(false) }} aoFechar={() => setFolhaAberta(false)} />
      )}

      {filtraConta && (
        <div className="mb-3"><Aviso tipo="info">Com conta escolhida, ficam de fora as compras e estornos de cartão e as parcelas a vencer, porque não têm conta.</Aviso></div>
      )}
      {naoPagosSemAutor && (
        <div className="mb-3"><Aviso tipo="info">As parcelas de cartão a vencer não têm autor e não entram quando se filtra por quem lançou.</Aviso></div>
      )}
      {erro && <div className="mb-3"><Aviso tipo="erro">{erro}</Aviso></div>}

      <Card>
        <CardTitle>Entradas x Saídas · {titulo}</CardTitle>
        {!fluxo && !erro && <p className="text-sm text-slate-600" role="status">Carregando…</p>}
        {fluxo && <ResultadoEmOutrasMoedas porMoeda={porMoeda} className="mb-3 rounded-lg bg-slate-50 px-3 py-2" />}
        {fluxo && fluxo.linhas.length > 0 && (
          <BalancoMensal meses={barras} tabelaAbaixo termos={{ entradas: 'Entradas', saidas: 'Saídas', periodo: termoPeriodo }} />
        )}
        {fluxo && valoresSaldo && fluxo.linhas.length > 1 && (
          <div className="mt-4" data-testid="grafico-saldo">
            <h3 className="mb-1 text-xs font-semibold text-slate-500">Saldo das contas no fim de cada {termoPeriodo}</h3>
            <LinhaMensal titulo="Saldo das contas" cor={COR_SALDO} tabelaAbaixo
              pontos={fluxo.linhas.map((l, i) => {
                const r = rotulos(l.inicio, passoMostrado)
                return { mes: l.inicio, valor: valoresSaldo[i], rotulo: r.eixo, rotuloLongo: r.longo }
              })} />
          </div>
        )}
        {fluxo && (
          <TabelaFluxo fluxo={fluxo} passo={passoMostrado} acumulado={acumulado}
            saldo={mostraSaldo ? valoresSaldo ?? 'carregando' : null} />
        )}
        {fluxo && (
          <p className="mt-2 text-xs text-slate-500">
            Em reais; transferências entre contas não entram.
            {mostraSaldo ? ` Saldo: o das contas no último dia de cada ${termoPeriodo}${consulta?.naoPagos ? ', com os planejados e as faturas a pagar' : ', só com o efetuado'}.` : ''}
            {consulta && !consulta.comSaldo ? ' O saldo aparece só com todas as contas e todas as pessoas (o banco ainda não calcula o saldo de uma escolha de contas).' : ''}
            {consulta?.comSaldo && saldoDaConsulta === 'erro' ? ' O saldo não pôde ser calculado agora.' : ''}
          </p>
        )}
      </Card>
    </section>
  )
}

/** Valor de uma célula: uma linha só (nowrap), algarismos alinhados, negativo com "−" e em vermelho quando `sinal`. */
function Valor({ v, sinal = false }: { v: Cents; sinal?: boolean }) {
  return <span className={`whitespace-nowrap tabular-nums ${sinal && v < 0 ? 'text-negativo' : ''}`}>{formatBRLSinal(v)}</span>
}

function TabelaFluxo({ fluxo, passo, acumulado, saldo }: {
  fluxo: FluxoCaixa
  passo: Passo
  acumulado: boolean
  /** null = coluna escondida; 'carregando' = coluna com "…". */
  saldo: Cents[] | 'carregando' | null
}) {
  const primeiro = fluxo.linhas[0] ? rotulos(fluxo.linhas[0].inicio, passo).longo.toLowerCase() : ''
  const th = 'whitespace-nowrap px-1.5 py-2 text-right font-medium'
  const td = 'px-1.5 py-2 text-right'
  const amostra = (cor: string) => <span aria-hidden="true" className="mr-1 inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ background: cor }} />
  // resultado do período inteiro: o último acumulado do banco (soma feita lá, nunca aqui)
  const resultadoTotal = fluxo.linhas[fluxo.linhas.length - 1]?.acumulado ?? asCents(0)!
  return (
    // a rolagem fica dentro da tabela: o cabeçalho e o total ficam presos enquanto as linhas rolam (31 dias);
    // para o lado só se não couber mesmo (celular com a coluna de saldo), com a coluna Período presa à esquerda.
    // w-0 min-w-full: uma tabela larga não alarga a página, só rola dentro da própria caixa
    <div className="mt-4 max-h-[70vh] w-0 min-w-full overflow-auto">
      <table className="w-full text-xs sm:text-[13px] md:text-xs lg:text-sm">
        <caption className="sr-only">Entradas, saídas e resultado por período{saldo ? ', com o saldo das contas' : ''}{acumulado ? ' e o acumulado' : ''}</caption>
        <thead className="sticky top-0 z-10 bg-white">
          <tr className="border-b border-slate-200 text-slate-600">
            <th scope="col" className="sticky left-0 bg-white py-2 pr-2 text-left font-medium">Período</th>
            <th scope="col" className={th}>{amostra(COR_RECEITA)}Entradas</th>
            <th scope="col" className={th}>{amostra(COR_DESPESA)}Saídas</th>
            <th scope="col" className={th}>Resultado</th>
            {saldo && <th scope="col" className={th}>{amostra(COR_SALDO)}Saldo</th>}
            {acumulado && <th scope="col" className={th}>Acumulado</th>}
          </tr>
        </thead>
        <tbody>
          {fluxo.linhas.map((l, i) => {
            const r = rotulos(l.inicio, passo)
            return (
              <tr key={l.inicio} className="border-b border-slate-100">
                <th scope="row" className="sticky left-0 whitespace-nowrap bg-white py-2 pr-2 text-left font-normal">
                  <span className="lg:hidden">{r.curto}</span><span className="hidden lg:inline">{r.longo}</span>
                </th>
                <td className={td}><Valor v={l.entradas} /></td>
                <td className={td}><Valor v={l.saidas} /></td>
                <td className={td}><Valor v={l.saldo} sinal /></td>
                {saldo && <td className={td}>{saldo === 'carregando' ? <span className="text-slate-400">…</span> : <Valor v={saldo[i]} sinal />}</td>}
                {acumulado && <td className={td}><Valor v={l.acumulado} sinal /></td>}
              </tr>
            )
          })}
        </tbody>
        <tfoot className="sticky bottom-0 bg-slate-50">
          <tr className="border-t-2 border-slate-300 font-semibold text-marinho">
            <th scope="row" className="sticky left-0 bg-slate-50 py-2 pr-2 text-left">Total</th>
            <td className={td}><Valor v={fluxo.totalEntradas} /></td>
            <td className={td}><Valor v={fluxo.totalSaidas} /></td>
            <td className={td}><Valor v={resultadoTotal} sinal /></td>
            {saldo && <td className={td} />}
            {acumulado && <td className={td} />}
          </tr>
        </tfoot>
      </table>
      {acumulado && primeiro && (
        <p className="mt-1 text-xs text-slate-500">Acumulado: soma dos resultados desde {primeiro} (não é saldo de conta).</p>
      )}
    </div>
  )
}

const pilula = (ativo: boolean) => `min-h-11 flex-1 rounded-md px-3 text-sm font-semibold ${ativo ? 'bg-white text-marinho shadow-card' : 'text-slate-600'}`

/** Folha "Filtros": tudo junto, num rascunho; só vale ao tocar em Aplicar (fechar descarta). */
function FolhaFiltros({ atuais, contas, membros, aoAplicar, aoFechar }: {
  atuais: Filtros
  contas: Conta[]
  membros: Membro[]
  aoAplicar: (f: Filtros) => void
  aoFechar: () => void
}) {
  const [f, setF] = useState<Filtros>(atuais)
  const idMembro = useId()
  const mudar = (parcial: Partial<Filtros>) => setF((atual) => ({ ...atual, ...parcial }))

  return (
    <Folha titulo="Filtros" aoFechar={aoFechar}
      rodape={<>
        <Button variante="secundario" onClick={aoFechar}>Cancelar</Button>
        <Button onClick={() => aoAplicar(f)}>Aplicar</Button>
      </>}>
      <div className="flex flex-col gap-5">
        <div>
          <p className="mb-1 text-sm font-medium" id={`${idMembro}-lanc`}>Considerar lançamentos</p>
          <div role="group" aria-labelledby={`${idMembro}-lanc`} className="flex rounded-lg bg-slate-100 p-1">
            <button type="button" aria-pressed={!f.naoPagos} onClick={() => mudar({ naoPagos: false })} className={pilula(!f.naoPagos)}>Pagos</button>
            <button type="button" aria-pressed={f.naoPagos} onClick={() => mudar({ naoPagos: true })} className={pilula(f.naoPagos)}>Todos</button>
          </div>
          <p className="mt-1 text-xs text-slate-500">Todos = pagos e não pagos (planejados e parcelas de cartão a vencer).</p>
        </div>

        <div>
          <p className="mb-1 text-sm font-medium" id={`${idMembro}-per`}>Periodicidade</p>
          <div role="group" aria-labelledby={`${idMembro}-per`} className="flex rounded-lg bg-slate-100 p-1">
            {PASSOS.map((p) => (
              <button key={p.chave} type="button" aria-pressed={f.passo === p.chave} onClick={() => mudar({ passo: p.chave })} className={pilula(f.passo === p.chave)}>
                {p.rotulo}
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-slate-500">Mensal mostra 12 meses até o mês escolhido; diário e semanal, o mês escolhido.</p>
        </div>

        {membros.length > 1 && (
          <div className="flex flex-col gap-1">
            <label htmlFor={idMembro} className="text-sm font-medium">Lançado por</label>
            <select id={idMembro} value={f.membro} onChange={(e) => mudar({ membro: e.target.value })}
              className="min-h-11 rounded-lg border border-slate-500 bg-white px-3 text-base">
              <option value="">Todos</option>
              {membros.map((m) => <option key={m.userId} value={m.userId}>{m.nome || 'Sem nome'}</option>)}
            </select>
          </div>
        )}

        {contas.length > 0 && <EscolhaDeContas contas={contas} escolhidas={f.contas} aoMudar={(ids) => mudar({ contas: ids })} />}

        <label className="flex min-h-11 items-start gap-3 text-sm">
          <input type="checkbox" className="mt-1 h-4 w-4" checked={f.acumulado} onChange={(e) => mudar({ acumulado: e.target.checked })} />
          <span>Mostrar acumulado<span className="block text-xs text-slate-500">Soma dos resultados desde o primeiro período da tabela. Não é saldo.</span></span>
        </label>
      </div>
    </Folha>
  )
}

/** Contas do filtro: "Todas" por padrão, busca, e as arquivadas escondidas atrás de "Mostrar arquivadas". */
function EscolhaDeContas({ contas, escolhidas, aoMudar }: { contas: Conta[]; escolhidas: string[]; aoMudar: (ids: string[]) => void }) {
  const [busca, setBusca] = useState('')
  const [verArquivadas, setVerArquivadas] = useState(false)
  const idBusca = useId()
  const arquivadas = contas.filter((c) => !c.ativa).length
  const termo = busca.trim().toLocaleLowerCase('pt-BR')
  // arquivada escolhida continua à vista (senão o filtro ficaria invisível)
  const visiveis = contas.filter((c) => (c.ativa || verArquivadas || escolhidas.includes(c.id))
    && (!termo || c.nome.toLocaleLowerCase('pt-BR').includes(termo)))
  const alternar = (id: string) => aoMudar(escolhidas.includes(id) ? escolhidas.filter((x) => x !== id) : [...escolhidas, id])

  return (
    <fieldset>
      <legend className="mb-1 text-sm font-medium">
        Contas <span className="font-normal text-slate-500" data-testid="contagem-contas">
          · {escolhidas.length === 0 ? 'todas' : `${escolhidas.length} escolhida${escolhidas.length === 1 ? '' : 's'}`}
        </span>
      </legend>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <button type="button" aria-pressed={escolhidas.length === 0} onClick={() => aoMudar([])}
          className={`min-h-11 rounded-lg px-3 text-sm font-semibold ${escolhidas.length === 0 ? 'bg-azul text-white' : 'border border-slate-300 bg-white text-marinho'}`}>
          Todas as contas
        </button>
        {contas.length > 6 && (
          <>
            <label htmlFor={idBusca} className="sr-only">Buscar conta</label>
            <input id={idBusca} type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar conta"
              className="min-h-11 min-w-0 flex-1 rounded-lg border border-slate-500 px-3 text-base" />
          </>
        )}
      </div>
      <ul className="max-h-64 overflow-y-auto rounded-lg border border-slate-200">
        {visiveis.map((c) => (
          <li key={c.id} className="border-b border-slate-100 last:border-0">
            <label className="flex min-h-11 items-center gap-3 px-3 text-sm">
              <input type="checkbox" className="h-4 w-4" checked={escolhidas.includes(c.id)} onChange={() => alternar(c.id)} />
              <span className="min-w-0 flex-1 truncate">{c.nome}</span>
              {!c.ativa && <span className="text-xs text-slate-500">arquivada</span>}
            </label>
          </li>
        ))}
        {visiveis.length === 0 && <li className="px-3 py-3 text-sm text-slate-500">Nenhuma conta com esse nome.</li>}
      </ul>
      {arquivadas > 0 && (
        <label className="mt-2 flex min-h-11 items-center gap-3 text-sm text-slate-600">
          <input type="checkbox" className="h-4 w-4" checked={verArquivadas} onChange={(e) => setVerArquivadas(e.target.checked)} />
          Mostrar arquivadas ({arquivadas})
        </label>
      )}
    </fieldset>
  )
}
