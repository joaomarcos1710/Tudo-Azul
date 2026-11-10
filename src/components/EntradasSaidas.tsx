import { useEffect, useId, useMemo, useState } from 'react'
import { Aviso } from './ui/Aviso'
import { Card, CardTitle } from './ui/Card'
import { Chip, Chips, GrupoFiltro, TelaFiltros } from './ui/TelaFiltros'
import { BalancoMensal } from './graficos/BalancoMensal'
import type { MesBalanco } from './graficos/BalancoMensal'
import { COR_RECEITA, COR_SAIDA, COR_SALDO_AREA, COR_SALDO_BORDA } from './graficos/cores'
import { useFamilia } from '../lib/FamiliaContext'
import { ResultadoEmOutrasMoedas } from './ui/EmOutrasMoedas'
import { SeletorPeriodo } from './ui/SeletorPeriodo'
import { ehReais, hojeSP, listarContas } from '../lib/contas'
import type { Conta } from '../lib/contas'
import { mensagemErroBanco } from '../lib/erros'
import { listarMembros } from '../lib/familia'
import type { Membro } from '../lib/familia'
import { serieFluxo } from '../lib/fluxoCaixa'
import type { SerieFluxo } from '../lib/fluxoCaixa'
import { asCents, formatBRLSinal } from '../lib/format'
import type { Cents } from '../lib/format'
import { resumoPorMoeda } from '../lib/lancamentos'
import type { ResumoPorMoeda } from '../lib/lancamentos'
import { ajustarDivisao, divisoes, periodoDoMes, rotuloPeriodo, rotulosLinha } from '../lib/periodoRelatorio'
import type { Divisao, Periodo } from '../lib/periodoRelatorio'

interface Filtros {
  naoPagos: boolean
  /** Vazio = todas as contas. */
  contas: string[]
  membro: string
}

const FILTROS_PADRAO: Filtros = { naoPagos: false, contas: [], membro: '' }

/** O que cada linha da tabela é, para o texto das explicações. */
const TERMO: Record<Divisao, string> = { day: 'dia', week: 'semana', month: 'mês', total: 'período' }

interface Consulta {
  serie: SerieFluxo
  periodo: Periodo
  divisao: Divisao
  naoPagos: boolean
}

/**
 * Tipo de valor da tabela (#179, pedido do dono): entrada, resultado e saldo positivos em AZUL (no Organizze, verde);
 * saída e negativo em VERMELHO, com "−"; zero em cinza. A cor nunca é a única informação: o sinal e a coluna ficam.
 * Azul = `text-azul` (#2563EB, 5,2:1 no branco); vermelho = `text-negativo` (#B91C1C, 6,5:1); cinza = slate-500 (4,8:1).
 * O cinza claro do Organizze (slate-400, 2,6:1) não passa no AA para texto, por isso o slate-500.
 */
export type TipoValor = 'entrada' | 'saida' | 'saldo'

/** Texto e cor de um valor da tabela. Saída vem positiva do banco e aparece como "−R$" (só o sinal muda; nada é somado). */
export function aparenciaValor(v: Cents, tipo: TipoValor): { texto: string; cor: string } {
  if (v === 0) return { texto: formatBRLSinal(asCents(0)!), cor: 'text-slate-500' }
  if (tipo === 'saida') return { texto: formatBRLSinal(-v as Cents), cor: v > 0 ? 'text-negativo' : 'text-azul' }
  return { texto: formatBRLSinal(v), cor: v < 0 ? 'text-negativo' : 'text-azul' }
}

/**
 * Entradas x Saídas do período escolhido (#179, como no Organizze): o período é a escolha principal (setas + menu de
 * atalhos + "Escolher período") e a divisão (diário, semanal, mensal, acumulado) só fatia esse período. Regime de CAIXA:
 * a fatura do cartão sai no dia do pagamento (ou no vencimento, se a pagar). Valores, resultados, saldos e totais vêm do
 * banco numa chamada só (cash_flow_series, migration 066). O front não soma nada.
 */
export function EntradasSaidas({ periodo: periodoDaPagina, aoMudarPeriodo }: {
  /** Período controlado pela página (Relatórios: o mesmo em todas as abas); sem ele, o mês atual. */
  periodo?: Periodo
  aoMudarPeriodo?: (p: Periodo) => void
}) {
  const { familia } = useFamilia()
  const familiaId = familia?.id
  const hoje = hojeSP()
  const [periodoProprio, setPeriodoProprio] = useState<Periodo>(() => periodoDoMes(hoje.slice(0, 7)))
  const periodo = periodoDaPagina ?? periodoProprio
  // período que veio de outra aba: a divisão começa numa que vale nele
  const [divisao, setDivisao] = useState<Divisao>(() => ajustarDivisao('day', periodo))
  const [motivo, setMotivo] = useState('')
  const [filtros, setFiltros] = useState<Filtros>(FILTROS_PADRAO)
  const [folhaAberta, setFolhaAberta] = useState(false)
  const [contas, setContas] = useState<Conta[]>([])
  const [membros, setMembros] = useState<Membro[]>([])
  const [consulta, setConsulta] = useState<Consulta | null>(null)
  // contas em outras moedas (multimoeda F2): à parte, sem conversão; o relatório acima é só em reais
  const [porMoeda, setPorMoeda] = useState<ResumoPorMoeda[]>([])
  const [erro, setErro] = useState('')
  const { naoPagos, contas: contasEscolhidas, membro } = filtros
  const idDivisoes = useId()

  // contas e membros só alimentam os filtros: se falharem, o relatório segue sem eles
  useEffect(() => {
    if (!familiaId) return
    let vivo = true
    // o relatório é em reais (ignora contas em outra moeda): o filtro só oferece contas em reais
    listarContas(familiaId).then((r) => { if (vivo) setContas(r.contas.filter(ehReais)) }).catch(() => {})
    listarMembros(familiaId).then((r) => { if (vivo) setMembros(r) }).catch(() => {})
    return () => { vivo = false }
  }, [familiaId])

  useEffect(() => {
    if (!familiaId) return
    let vivo = true
    // troca de período, divisão ou filtro: some a tabela antiga (senão o título novo aparece em cima dos números antigos)
    setConsulta(null)
    setErro('')
    serieFluxo(familiaId, periodo.de, periodo.ate, divisao, { contas: contasEscolhidas, membro, incluirNaoPagos: naoPagos })
      .then((r) => { if (vivo) setConsulta({ serie: r, periodo, divisao, naoPagos }) })
      .catch((err) => { if (vivo) { setConsulta(null); setErro(mensagemErroBanco(err)) } })
    // o bloco por moeda é só do pago e sem filtros de conta e de quem lançou; se falhar, o relatório em reais segue
    setPorMoeda([])
    if (contasEscolhidas.length === 0 && !membro) {
      resumoPorMoeda(familiaId, periodo.de, periodo.ate).then((r) => { if (vivo) setPorMoeda(r) }).catch(() => {})
    }
    return () => { vivo = false }
  }, [familiaId, periodo, divisao, contasEscolhidas, membro, naoPagos])

  function mudarPeriodo(p: Periodo) {
    setPeriodoProprio(p)
    aoMudarPeriodo?.(p)
    setDivisao((d) => ajustarDivisao(d, p))
    setMotivo('')
  }

  const opcoes = divisoes(periodo)
  const nomeConta = (id: string) => contas.find((c) => c.id === id)?.nome ?? '1 conta'
  const resumoContas = contasEscolhidas.length === 0 ? 'Todas as contas'
    : contasEscolhidas.length === 1 ? nomeConta(contasEscolhidas[0]) : `${contasEscolhidas.length} contas`
  const nomeMembro = membros.find((m) => m.userId === membro)?.nome || 'Sem nome'
  const resumo = [
    opcoes.find((o) => o.chave === divisao)!.rotulo,
    naoPagos ? 'Pagos e não pagos' : 'Só pagos',
    resumoContas,
    ...(membro ? [`Lançado por ${nomeMembro}`] : []),
  ].join(' · ')

  const serie = consulta?.serie ?? null
  const comSaldo = !!serie && serie.linhas.length > 0 && serie.linhas.every((l) => l.saldo !== null)
  const divisaoMostrada = consulta?.divisao ?? divisao
  const termo = TERMO[divisaoMostrada]
  const cortaMes = divisaoMostrada === 'month' && !!consulta && !!serie
    && (serie.linhas[0]?.inicio !== consulta.periodo.de || serie.linhas[serie.linhas.length - 1]?.fim !== consulta.periodo.ate)

  const barras: MesBalanco[] = useMemo(() => (consulta?.serie.linhas ?? []).map((l) => {
    const r = rotulosLinha(l.inicio, l.fim, consulta!.divisao, consulta!.periodo)
    return { mes: l.inicio, receitas: l.entradas, despesas: l.saidas, resultado: l.resultado, rotulo: r.eixo, rotuloLongo: r.longo }
  }), [consulta])
  // a área do saldo só no fatiado (no acumulado, como no Organizze, só as duas barras)
  const saldoGrafico = comSaldo && divisaoMostrada !== 'total' ? { valores: serie!.linhas.map((l) => l.saldo as Cents), rotulo: 'Saldo' } : undefined

  return (
    <section aria-label="Entradas x Saídas" className="mb-4">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <SeletorPeriodo periodo={periodo} hoje={hoje} aoMudar={mudarPeriodo} />
        <button type="button" aria-haspopup="dialog" aria-expanded={folhaAberta} onClick={() => setFolhaAberta(true)}
          className="inline-flex min-h-11 min-w-0 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-1 text-left text-sm hover:bg-azul-claro">
          <span className="font-semibold text-azul">Filtros</span>
          <span className="min-w-0 truncate text-slate-600" data-testid="resumo-filtros">{resumo}</span>
        </button>
      </div>

      <div className="mb-3">
        <p id={idDivisoes} className="sr-only">Divisão do período</p>
        <div role="group" aria-labelledby={idDivisoes} className="flex rounded-lg bg-slate-100 p-1">
          {opcoes.map((o) => (
            <button key={o.chave} type="button" aria-pressed={divisao === o.chave} aria-disabled={o.ativa ? undefined : 'true'}
              aria-describedby={o.ativa ? undefined : `${idDivisoes}-${o.chave}`}
              onClick={() => { if (o.ativa) { setDivisao(o.chave); setMotivo('') } else setMotivo(o.motivo ?? '') }}
              className={`min-h-11 min-w-0 flex-1 rounded-md px-1 text-sm font-semibold ${divisao === o.chave ? 'bg-white text-marinho shadow-card'
                : o.ativa ? 'text-slate-600' : 'cursor-not-allowed text-slate-400 line-through decoration-slate-300'}`}>
              {o.rotulo}
              {!o.ativa && <span id={`${idDivisoes}-${o.chave}`} className="sr-only">: indisponível. {o.motivo}</span>}
            </button>
          ))}
        </div>
        {motivo && <p role="status" className="mt-1 text-xs text-slate-600">{motivo}</p>}
      </div>

      {folhaAberta && (
        <FolhaFiltros atuais={filtros} contas={contas} membros={membros}
          aoAplicar={(f) => { setFiltros(f); setFolhaAberta(false) }} aoFechar={() => setFolhaAberta(false)} />
      )}

      {contasEscolhidas.length > 0 && (
        <div className="mb-3"><Aviso tipo="info">Com conta escolhida, o cartão entra só pelos pagamentos de fatura feitos por ela (e, com os não pagos, pelas faturas a pagar com ela como conta de pagamento).</Aviso></div>
      )}
      {naoPagos && membro !== '' && (
        <div className="mb-3"><Aviso tipo="info">As faturas a pagar não têm autor e não entram quando se filtra por quem lançou.</Aviso></div>
      )}
      {erro && <div className="mb-3"><Aviso tipo="erro">{erro}</Aviso></div>}

      <Card>
        <CardTitle>Entradas x Saídas · {rotuloPeriodo(consulta?.periodo ?? periodo)}</CardTitle>
        {!serie && !erro && <p className="text-sm text-slate-600" role="status">Carregando…</p>}
        {serie && <ResultadoEmOutrasMoedas porMoeda={porMoeda} className="mb-3 rounded-lg bg-slate-50 px-3 py-2" />}
        {serie && serie.linhas.length > 0 && (
          <div data-testid="grafico-entradas-saidas">
            <BalancoMensal meses={barras} tabelaAbaixo cores={{ entradas: COR_RECEITA, saidas: COR_SAIDA }} saldo={saldoGrafico}
              termos={{ entradas: 'Entradas', saidas: 'Saídas', periodo: termo }} />
          </div>
        )}
        {serie && <ExplicacaoCartao />}
        {serie && consulta && <TabelaFluxo consulta={consulta} comSaldo={comSaldo} />}
        {serie && (
          <p className="mt-2 text-xs text-slate-500">
            Em reais; transferências entre contas não entram.
            {divisaoMostrada === 'week' ? ' Semanas de segunda a domingo; na primeira e na última, só os dias dentro do período.' : ''}
            {cortaMes ? ' No primeiro e no último mês, só os dias dentro do período.' : ''}
            {comSaldo ? ` Saldo: o das contas no fim de cada ${termo}${consulta?.naoPagos ? ', com os planejados e as faturas a pagar' : ', só com o efetuado'}.` : ''}
            {serie.linhas.length > 0 && !comSaldo ? ' O saldo aparece só com todas as contas e todas as pessoas (o banco ainda não calcula o saldo de uma escolha de contas).' : ''}
          </p>
        )}
      </Card>
    </section>
  )
}

/**
 * Regra do cartão neste relatório (decisão do dono, 05/11/2026: "Uma coisa é o fechamento, outra coisa é o vencimento.
 * Os valores a pagar dos cartões ficam no vencimento."), numa linha com (i); o texto inteiro abre embaixo.
 * Mesmo jeito da Explicacao de Lançamentos (details/summary: teclado e leitor de tela de graça).
 */
function ExplicacaoCartao() {
  return (
    <details className="mt-3 text-xs text-slate-600" data-testid="explicacao-cartao">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-slate-400 font-bold">i</span>
        <span className="min-w-0 truncate">Cartão: a fatura sai no dia do pagamento; a que falta pagar, no vencimento.</span>
        <span className="sr-only">(mostrar explicação)</span>
      </summary>
      <p className="mt-1">
        Este relatório mostra o dinheiro saindo da conta. A compra no cartão não é saída no fechamento: a fatura paga entra
        na data do pagamento; a fatura a pagar entra no vencimento (só com &quot;Pagos e não pagos&quot;), já com as assinaturas
        previstas que ainda não viraram compra (cada uma conta uma vez só); paga em parte, o que foi pago entra na data do
        pagamento e o que falta, no vencimento. Estornos e créditos já estão no valor da fatura.
        Os totais do mês, o orçamento e as despesas por categoria continuam pela data da fatura.
      </p>
    </details>
  )
}

/** Valor de uma célula: uma linha só (nowrap), algarismos alinhados, com a cor e o sinal do tipo (também na aba Contas). */
export function Valor({ v, tipo }: { v: Cents; tipo: TipoValor }) {
  const { texto, cor } = aparenciaValor(v, tipo)
  const classe = `whitespace-nowrap tabular-nums ${cor}`
  // no celular, sem o "R$" (a tabela diz "Valores em R$"): assim as 5 colunas cabem em 375px sem rolar para o lado
  return <><span className={`sm:hidden ${classe}`}>{texto.replace(/R\$\s?/, '')}</span><span className={`hidden sm:inline ${classe}`}>{texto}</span></>
}

function TabelaFluxo({ consulta, comSaldo }: { consulta: Consulta; comSaldo: boolean }) {
  const { serie, divisao, periodo } = consulta
  // px-1 e texto de 12px até o computador: as 5 colunas cabem no iPad em retrato (820px) sem rolar para o lado
  const th = 'whitespace-nowrap py-2 pl-1 text-right font-medium sm:px-1 lg:px-1.5'
  const td = 'py-2 pl-1 text-right sm:px-1 lg:px-1.5'
  const amostra = (cor: string, borda?: string) => (
    <span aria-hidden="true" className="mr-1 inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ background: cor, border: borda ? `1px solid ${borda}` : undefined }} />
  )
  // o total só faz sentido com mais de uma linha (no acumulado a linha única já é o período inteiro)
  const comTotal = serie.linhas.length > 1
  return (
    // a rolagem fica dentro da tabela: o cabeçalho e o total ficam presos enquanto as linhas rolam (31 dias);
    // para o lado só se não couber mesmo, com a coluna Período presa à esquerda.
    // w-0 min-w-full: uma tabela larga não alarga a página, só rola dentro da própria caixa
    // caixa rolável alcançável pelo teclado (axe: scrollable-region-focusable), com nome para o leitor de tela
    <div className="mt-4 max-h-[70vh] w-0 min-w-full overflow-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-azul" data-testid="caixa-tabela"
      tabIndex={0} role="region" aria-label={`Tabela de entradas e saídas por ${TERMO[divisao]}`}>
      <p className="mb-1 text-xs text-slate-500 sm:hidden">Valores em R$.</p>
      <table className="w-full text-[11px] tracking-tight sm:text-xs sm:tracking-normal lg:text-sm">
        <caption className="sr-only">Entradas, saídas e resultado de cada {TERMO[divisao]} de {rotuloPeriodo(periodo)}{comSaldo ? ', com o saldo das contas' : ''}</caption>
        <thead className="sticky top-0 z-10 bg-white">
          <tr className="border-b border-slate-200 text-slate-600">
            <th scope="col" className="sticky left-0 bg-white py-2 pr-1 text-left font-medium">Período</th>
            <th scope="col" className={th}>{amostra(COR_RECEITA)}Entradas</th>
            <th scope="col" className={th}>{amostra(COR_SAIDA)}Saídas</th>
            <th scope="col" className={th}>Resultado</th>
            {comSaldo && <th scope="col" className={th}>{amostra(COR_SALDO_AREA, COR_SALDO_BORDA)}Saldo</th>}
          </tr>
        </thead>
        <tbody>
          {serie.linhas.map((l) => {
            const r = rotulosLinha(l.inicio, l.fim, divisao, periodo)
            return (
              <tr key={l.inicio} className="border-b border-slate-100" data-testid="linha-fluxo">
                <th scope="row" className="sticky left-0 bg-white py-2 pr-1 text-left font-normal sm:whitespace-nowrap">
                  {r.curto === r.longo ? r.curto : <><span className="lg:hidden">{r.curto}</span><span className="hidden lg:inline">{r.longo}</span></>}
                </th>
                <td className={td}><Valor v={l.entradas} tipo="entrada" /></td>
                <td className={td}><Valor v={l.saidas} tipo="saida" /></td>
                <td className={td}><Valor v={l.resultado} tipo="saldo" /></td>
                {comSaldo && <td className={td}><Valor v={l.saldo as Cents} tipo="saldo" /></td>}
              </tr>
            )
          })}
        </tbody>
        {comTotal && (
          <tfoot className="sticky bottom-0 bg-slate-50">
            <tr className="border-t-2 border-slate-300 font-semibold text-marinho">
              <th scope="row" className="sticky left-0 bg-slate-50 py-2 pr-2 text-left">Total</th>
              <td className={td}><Valor v={serie.totalEntradas} tipo="entrada" /></td>
              <td className={td}><Valor v={serie.totalSaidas} tipo="saida" /></td>
              <td className={td}><Valor v={serie.totalResultado} tipo="saldo" /></td>
              {comSaldo && <td className={td} />}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}

/** Tela "Filtros" (tela cheia, como no Organizze): tudo junto, num rascunho; só vale ao tocar em Aplicar (fechar descarta). */
function FolhaFiltros({ atuais, contas, membros, aoAplicar, aoFechar }: {
  atuais: Filtros
  contas: Conta[]
  membros: Membro[]
  aoAplicar: (f: Filtros) => void
  aoFechar: () => void
}) {
  const [f, setF] = useState<Filtros>(atuais)
  const mudar = (parcial: Partial<Filtros>) => setF((atual) => ({ ...atual, ...parcial }))

  return (
    <TelaFiltros titulo="Filtros" aoFechar={aoFechar} acaoPrincipal={{ rotulo: 'Aplicar', aoAcionar: () => aoAplicar(f) }}>
      <GrupoFiltro titulo="Considerar lançamentos">
        <Chips>
          <Chip pressionado={!f.naoPagos} onClick={() => mudar({ naoPagos: false })}>Pagos</Chip>
          <Chip pressionado={f.naoPagos} onClick={() => mudar({ naoPagos: true })}>Pagos e não pagos</Chip>
        </Chips>
        <p className="mt-2 text-xs text-slate-500">Pagos e não pagos = planejados, lançamentos fixos ainda não gerados e faturas a pagar com as assinaturas previstas.</p>
      </GrupoFiltro>

      {membros.length > 1 && (
        <GrupoFiltro titulo="Lançado por">
          <Chips>
            <Chip pressionado={f.membro === ''} onClick={() => mudar({ membro: '' })}>Qualquer pessoa</Chip>
            {membros.map((m) => (
              <Chip key={m.userId} pressionado={f.membro === m.userId} onClick={() => mudar({ membro: f.membro === m.userId ? '' : m.userId })}>
                {m.nome || 'Sem nome'}
              </Chip>
            ))}
          </Chips>
        </GrupoFiltro>
      )}

      {contas.length > 0 && (
        <div className="mt-6">
          <EscolhaDeContas contas={contas} escolhidas={f.contas} aoMudar={(ids) => mudar({ contas: ids })} />
        </div>
      )}
    </TelaFiltros>
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
