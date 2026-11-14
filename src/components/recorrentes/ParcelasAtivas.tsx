import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card } from '../ui/Card'
import { Aviso } from '../ui/Aviso'
import { SELO } from '../../lib/cores'
import { formatDate, formatMoeda } from '../../lib/format'
import { registrarFalhaConsulta } from '../../lib/consultaOpcional'
import { listarCronogramaParcelas, listarParcelasAtivas, listarParcelasQueAcabam } from '../../lib/parcelasAtivas'
import type { EstadoParcela, ParcelaDoCronograma, ParcelamentoAtivo, ParcelasAtivas as Dados, ParcelasQueAcabam, SituacaoMes } from '../../lib/parcelasAtivas'
import { rotaCartao, rotaFatura } from '../../lib/cartoes'
import { useValoresOcultos } from '../../lib/privacidade'

/** Os dois caminhos que já existem para criar um parcelamento (nenhum fluxo novo): compra no cartão e despesa parcelada. */
const NOVO_NO_CARTAO = '/lancamentos?novo=cartao'
const NOVO_EM_CONTA = '/lancamentos?novo=despesa'

/**
 * Selo da parcela que vence neste mês: "paga" ou "pendente de pagamento" (o banco decide: month_status). Sem parcela neste mês
 * ('none') não há selo: o próximo vencimento já está logo abaixo. A pedido do dono (14/11/2026) o "pendente" voltou, agora
 * com o link para o pagamento. Exceções com selo próprio: "Última parcela" e as parcelas em atraso.
 */
const SITUACAO_MES: Partial<Record<SituacaoMes, { texto: string; estilo: string }>> = {
  paid: { texto: 'Parcela deste mês paga', estilo: SELO.pago },
  pending: { texto: 'Pendente de pagamento', estilo: SELO.atencao },
}

/**
 * Onde ver o pagamento original. Carnê (parcelamento em conta): Lançamentos no mês do vencimento (a parcela é um lançamento da conta).
 * Cartão: a tela do cartão, onde estão as faturas. atalho: não levamos direto à fatura da parcela porque o mês da fatura
 * (fechamento) não vem na lista do banco e o app não calcula fatura; melhorar quando a função de planos devolver o mês da fatura.
 */
function destinoPagamento(p: ParcelamentoAtivo): { to: string; texto: string } | null {
  if (p.origem === 'card') return p.origemId ? { to: rotaCartao(p.origemId), texto: 'Ver fatura no cartão' } : null
  const mes = p.proximoVencimento?.slice(0, 7)
  return mes ? { to: `/lancamentos?mes=${mes}`, texto: 'Ver lançamento' } : null
}

type Ordem = 'vencimento' | 'quitar' | 'parcela' | 'saldo'
const ORDENS: [Ordem, string][] = [
  ['vencimento', 'Próximo vencimento'], ['quitar', 'Mais perto de quitar'], ['parcela', 'Maior parcela'], ['saldo', 'Maior saldo restante'],
]
/** Só ordena (a ordem de chegada do banco é a de "Próximo vencimento"). Moedas diferentes não se comparam: ficam em blocos. */
function ordenar(lista: ParcelamentoAtivo[], ordem: Ordem): ParcelamentoAtivo[] {
  if (ordem === 'vencimento') return lista
  const restantes = (p: ParcelamentoAtivo) => p.totalParcelas - p.parcelaAtual
  const chave = (a: ParcelamentoAtivo, b: ParcelamentoAtivo) =>
    ordem === 'quitar' ? restantes(a) - restantes(b)
      : ordem === 'parcela' ? b.valorParcela - a.valorParcela
        : b.saldoRestante - a.saldoRestante
  return [...lista].sort((a, b) => a.moeda.localeCompare(b.moeda) || chave(a, b))
}

const DIAS_AVISO = 60

/** "Bagaggio, Pacco e Airbnb" / "Bagaggio, Pacco, Airbnb e mais 2": no máximo três nomes. */
function nomes(planos: { descricao: string }[]): string {
  const n = planos.map((p) => p.descricao)
  if (n.length <= 3) return n.length > 1 ? `${n.slice(0, -1).join(', ')} e ${n[n.length - 1]}` : n[0] ?? ''
  return `${n.slice(0, 3).join(', ')} e mais ${n.length - 3}`
}

const ROTULO_ORIGEM = { card: 'Cartão de crédito', account: 'Parcelamento em conta' } as const

const linkPrimario = 'inline-flex min-h-11 items-center justify-center rounded-lg bg-azul px-4 text-sm font-semibold text-white transition-colors hover:bg-blue-700'
const linkSecundario = 'inline-flex min-h-11 items-center text-sm font-semibold text-azul hover:underline'

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
/** "2026-11-15" -> "nov/2026" (texto puro, sem fuso). */
function mesAno(data: string | null): string {
  if (!data) return 'sem data'
  return `${MESES[Number(data.slice(5, 7)) - 1] ?? '?'}/${data.slice(0, 4)}`
}
const ESTADO_PARCELA: Record<EstadoParcela, { texto: string; ponto: string; selo: string }> = {
  paid: { texto: 'Paga', ponto: 'bg-lucro-marca', selo: SELO.pago },
  overdue: { texto: 'Em atraso', ponto: 'bg-prejuizo', selo: SELO.vencido },
  open: { texto: 'A vencer', ponto: 'bg-slate-300', selo: SELO.neutro },
}

/** Para onde a parcela leva: cartão abre a fatura dela (rótulo do banco); carnê abre Lançamentos no mês da data. */
function destinoParcela(p: ParcelamentoAtivo, parcela: ParcelaDoCronograma): string | null {
  if (p.origem === 'card') {
    if (!p.origemId) return null
    return parcela.faturaRotulo ? rotaFatura(p.origemId, parcela.faturaRotulo) : rotaCartao(p.origemId)
  }
  return parcela.vencimento ? `/lancamentos?mes=${parcela.vencimento.slice(0, 7)}` : null
}

/**
 * Linha do tempo do parcelamento: uma faixa de pontos (um por parcela: verde paga, vermelho em atraso, cinza a vencer; o mês
 * atual ganha anel) e, ao abrir, uma linha por parcela com o mês, o valor e a situação, cada uma levando ao pagamento
 * original (fatura do cartão ou Lançamentos do mês). Estado e valores vêm do banco (installment_plan_schedule).
 */
function LinhaDoTempo({ p, parcelas }: { p: ParcelamentoAtivo; parcelas: ParcelaDoCronograma[] }) {
  return (
    <details className="group rounded-lg bg-slate-50" data-testid="linha-do-tempo">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-sm font-semibold text-azul">
        <span>Parcela a parcela</span>
        <span className="flex flex-wrap items-center justify-end gap-1" aria-hidden="true">
          {parcelas.map((x) => (
            <span key={x.numero} title={`${x.numero}/${p.totalParcelas} · ${mesAno(x.vencimento)} · ${ESTADO_PARCELA[x.estado].texto}`}
              className={`h-2.5 w-2.5 rounded-full ${ESTADO_PARCELA[x.estado].ponto} ${x.noMes ? 'ring-2 ring-azul ring-offset-1' : ''}`} />
          ))}
        </span>
      </summary>
      <ol className="divide-y divide-slate-200 border-t border-slate-200 text-sm">
        {parcelas.map((x) => {
          const estado = ESTADO_PARCELA[x.estado]
          const to = destinoParcela(p, x)
          const conteudo = (
            <>
              <span className="w-12 shrink-0 tabular-nums text-slate-500">{x.numero}/{p.totalParcelas}</span>
              <span className="min-w-0 flex-1 text-slate-700">{mesAno(x.vencimento)}{x.noMes ? <span className="ml-1 text-xs font-semibold text-azul">neste mês</span> : null}</span>
              <span className="whitespace-nowrap font-semibold tabular-nums text-prejuizo">−{formatMoeda(x.valor, p.moeda)}</span>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${estado.selo}`}>{estado.texto}</span>
            </>
          )
          return (
            <li key={x.numero}>
              {to
                ? <Link to={to} className="flex min-h-11 items-center gap-2 px-3 py-2 hover:bg-white"
                    aria-label={`Parcela ${x.numero} de ${p.totalParcelas}, ${mesAno(x.vencimento)}, ${estado.texto}. Ver pagamento`}>{conteudo}</Link>
                : <div className="flex min-h-11 items-center gap-2 px-3 py-2">{conteudo}</div>}
            </li>
          )
        })}
      </ol>
    </details>
  )
}

function CartaoParcelamento({ p, parcelas }: { p: ParcelamentoAtivo; parcelas?: ParcelaDoCronograma[] }) {
  const situacao = SITUACAO_MES[p.situacaoMes]
  const ultima = p.parcelaAtual === p.totalParcelas
  const destino = destinoPagamento(p)
  return (
    <li className="flex min-w-0 flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4" data-testid="parcelamento">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="break-words font-semibold text-slate-800">{p.descricao}</h3>
          <p className="text-xs text-slate-500">
            {ROTULO_ORIGEM[p.origem]}
            {p.origemNome ? <> · {p.origem === 'card' && p.origemId
              ? <Link to={rotaCartao(p.origemId)} className="font-medium text-azul hover:underline">{p.origemNome}</Link>
              : p.origemNome}</> : null}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="whitespace-nowrap font-semibold tabular-nums text-prejuizo">−{formatMoeda(p.valorParcela, p.moeda)}</p>
          <p className="text-xs text-slate-500">por parcela</p>
        </div>
      </div>

      <div>
        <div className="flex items-baseline justify-between gap-2 text-sm">
          <span className="font-medium text-slate-700">Parcela {p.parcelaAtual} de {p.totalParcelas}</span>
          <span className="tabular-nums text-slate-600">{p.percentualPago}% pago</span>
        </div>
        <div className="mt-1 h-2 rounded-full bg-slate-100" role="progressbar" aria-label={`${p.descricao}: ${p.percentualPago}% pago`}
          aria-valuenow={p.percentualPago} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-2 rounded-full bg-lucro-marca" style={{ width: `${p.percentualPago}%` }} />
        </div>
      </div>

      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="text-slate-600">Saldo restante</span>
        <span className="whitespace-nowrap font-semibold tabular-nums text-prejuizo">−{formatMoeda(p.saldoRestante, p.moeda)}</span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {situacao && <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${situacao.estilo}`}>{situacao.texto}</span>}
        {ultima && <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${SELO.planejado}`}>Última parcela</span>}
        {p.emAtraso > 0 && (
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${SELO.vencido}`}>
            {p.emAtraso === 1 ? '1 parcela em atraso' : `${p.emAtraso} parcelas em atraso`}
          </span>
        )}
        {p.proximoVencimento && <span className="text-xs text-slate-500">Próximo vencimento {formatDate(p.proximoVencimento)}</span>}
        {destino && <Link to={destino.to} className="text-xs font-semibold text-azul hover:underline">{destino.texto}</Link>}
      </div>
      {parcelas && parcelas.length > 0 && <LinhaDoTempo p={p} parcelas={parcelas} />}
    </li>
  )
}

/**
 * "Parcelas ativas" (Recorrentes): cada parcelamento em andamento, no cartão ou em conta, com a parcela atual, o progresso,
 * o saldo restante e a situação da parcela do mês. Os números e os totais vêm do banco (active_installment_plans); a
 * tela só mostra. Se a leitura falhar, só este bloco avisa e o resto da tela segue.
 */
export function ParcelasAtivas({ familiaId }: { familiaId: string }) {
  const [dados, setDados] = useState<Dados | null>(null)
  const [erro, setErro] = useState(false)
  const [ordem, setOrdem] = useState<Ordem>('vencimento')
  // aviso "terminam em breve": opcional (função da migration 118); se falhar, a lista segue sem ele
  const [acabam, setAcabam] = useState<ParcelasQueAcabam | null>(null)
  // linha do tempo parcela a parcela: opcional (função da migration 119); se falhar, os cards seguem sem ela
  const [cronograma, setCronograma] = useState<Map<string, ParcelaDoCronograma[]> | null>(null)
  useValoresOcultos() // re-renderiza ao ocultar/mostrar valores (formatMoeda já devolve a máscara)

  useEffect(() => {
    let ativo = true
    setErro(false)
    listarParcelasAtivas(familiaId)
      .then((d) => { if (ativo) setDados(d) })
      .catch((falha: unknown) => {
        void registrarFalhaConsulta('active_installment_plans', falha)
        if (ativo) { setDados(null); setErro(true) }
      })
    listarParcelasQueAcabam(familiaId, DIAS_AVISO)
      .then((a) => { if (ativo) setAcabam(a) })
      .catch(() => { if (ativo) setAcabam(null) })
    listarCronogramaParcelas(familiaId)
      .then((c) => { if (ativo) setCronograma(c) })
      .catch(() => { if (ativo) setCronograma(null) })
    return () => { ativo = false }
  }, [familiaId])

  const lista = useMemo(() => ordenar(dados?.parcelamentos ?? [], ordem), [dados, ordem])
  return (
    <Card className="mt-4">
      <section aria-labelledby="parcelas-ativas">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="parcelas-ativas" className="text-sm font-semibold text-slate-500">Parcelas ativas</h2>
            <p className="text-xs text-slate-500">Compras parceladas no cartão e despesas parceladas em conta que ainda têm parcela a pagar.</p>
          </div>
          <div className="flex flex-wrap items-center gap-x-4">
            <Link to={NOVO_NO_CARTAO} className={linkPrimario}>+ Novo parcelamento</Link>
            <Link to={NOVO_EM_CONTA} className={linkSecundario}
              title="Em Nova despesa, ative Repetir e escolha Lançamento parcelado">Parcelar uma despesa em conta</Link>
          </div>
        </div>

        {erro ? (
          <Aviso>Não foi possível carregar as parcelas ativas agora. O resto da tela continua normal; tente de novo em instantes.</Aviso>
        ) : dados === null ? (
          <p className="py-4 text-sm text-slate-500" role="status">Carregando as parcelas ativas…</p>
        ) : lista.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-600">
            Nenhum parcelamento em andamento. Compras parceladas no cartão e despesas parceladas em conta aparecem aqui enquanto tiverem parcela a pagar.
          </p>
        ) : (
          <>
            {acabam && acabam.totais.map((t) => {
              const doGrupo = acabam.planos.filter((p) => p.moeda === t.moeda)
              return (
                <p key={t.moeda} data-testid={`acabam-${t.moeda}`} className="mb-3 rounded-lg bg-agendado-fundo px-4 py-3 text-sm text-agendado">
                  <strong>{t.qtde === 1 ? '1 parcelamento termina' : `${t.qtde} parcelamentos terminam`}</strong> nos próximos {DIAS_AVISO} dias
                  {acabam.totais.length > 1 ? ` (${t.moeda})` : ''}: {nomes(doGrupo)}.{' '}
                  Libera{t.qtde === 1 ? '' : 'm'} <strong className="tabular-nums">{formatMoeda(t.liberado, t.moeda)}</strong> por mês no orçamento.
                </p>
              )
            })}
            <dl className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2" aria-label="Totais dos parcelamentos">
              {dados.totais.map((t) => (
                <div key={t.moeda} className="rounded-lg bg-slate-50 px-4 py-3" data-testid={`total-parcelas-${t.moeda}`}>
                  <dt className="text-xs text-slate-500">
                    Saldo restante · {t.qtde === 1 ? '1 parcelamento' : `${t.qtde} parcelamentos`}{dados.totais.length > 1 ? ` (${t.moeda})` : ''}
                  </dt>
                  <dd className="whitespace-nowrap text-lg font-bold tabular-nums text-prejuizo">−{formatMoeda(t.saldoRestante, t.moeda)}</dd>
                  <dt className="mt-1 text-xs text-slate-500">Nas faturas futuras (ainda não fecharam)</dt>
                  <dd className="whitespace-nowrap text-sm font-semibold tabular-nums text-prejuizo">−{formatMoeda(t.futuro, t.moeda)}</dd>
                </div>
              ))}
            </dl>
            <div className="mb-3 flex items-center gap-2 text-sm">
              <label htmlFor="ordem-parcelas" className="font-medium text-slate-600">Ordenar por</label>
              <select id="ordem-parcelas" value={ordem} onChange={(e) => setOrdem(e.target.value as Ordem)}
                className="min-h-11 rounded-lg border border-slate-300 bg-white px-3">
                {ORDENS.map(([v, r]) => <option key={v} value={v}>{r}</option>)}
              </select>
            </div>
            <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {lista.map((p) => <CartaoParcelamento key={p.chave} p={p} parcelas={cronograma?.get(p.chave)} />)}
            </ul>
          </>
        )}
      </section>
    </Card>
  )
}
