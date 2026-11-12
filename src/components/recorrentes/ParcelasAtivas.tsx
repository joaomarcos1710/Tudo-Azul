import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card } from '../ui/Card'
import { Aviso } from '../ui/Aviso'
import { SELO } from '../../lib/cores'
import { formatDate, formatMoeda } from '../../lib/format'
import { registrarFalhaConsulta } from '../../lib/consultaOpcional'
import { listarParcelasAtivas } from '../../lib/parcelasAtivas'
import type { ParcelamentoAtivo, ParcelasAtivas as Dados, SituacaoMes } from '../../lib/parcelasAtivas'
import { rotaCartao } from '../../lib/cartoes'
import { useValoresOcultos } from '../../lib/privacidade'

/** Os dois caminhos que já existem para criar um parcelamento (nenhum fluxo novo): compra no cartão e despesa parcelada. */
const NOVO_NO_CARTAO = '/lancamentos?novo=cartao'
const NOVO_EM_CONTA = '/lancamentos?novo=despesa'

const SITUACAO_MES: Record<SituacaoMes, { texto: string; estilo: string }> = {
  paid: { texto: 'Parcela deste mês paga', estilo: SELO.pago },
  pending: { texto: 'Pendente de pagamento', estilo: SELO.atencao },
  none: { texto: 'Nenhuma parcela neste mês', estilo: SELO.neutro },
}

const ROTULO_ORIGEM = { card: 'Cartão de crédito', account: 'Parcelamento em conta' } as const

const linkPrimario = 'inline-flex min-h-11 items-center justify-center rounded-lg bg-azul px-4 text-sm font-semibold text-white transition-colors hover:bg-blue-700'
const linkSecundario = 'inline-flex min-h-11 items-center text-sm font-semibold text-azul hover:underline'

function CartaoParcelamento({ p }: { p: ParcelamentoAtivo }) {
  const situacao = SITUACAO_MES[p.situacaoMes]
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
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${situacao.estilo}`}>{situacao.texto}</span>
        {p.emAtraso > 0 && (
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${SELO.vencido}`}>
            {p.emAtraso === 1 ? '1 parcela em atraso' : `${p.emAtraso} parcelas em atraso`}
          </span>
        )}
        {p.proximoVencimento && <span className="text-xs text-slate-500">Próximo vencimento {formatDate(p.proximoVencimento)}</span>}
      </div>
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
    return () => { ativo = false }
  }, [familiaId])

  const lista = dados?.parcelamentos ?? []
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
            <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {lista.map((p) => <CartaoParcelamento key={p.chave} p={p} />)}
            </ul>
          </>
        )}
      </section>
    </Card>
  )
}
