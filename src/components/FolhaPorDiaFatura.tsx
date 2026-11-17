import { useEffect, useState } from 'react'
import { Aviso } from './ui/Aviso'
import { Folha } from './ui/Folha'
import { BarrasDiarias } from './graficos/BarrasDiarias'
import { gastoPorDiaDaFatura, ritmoDaFatura } from '../lib/cartoes'
import type { DiaDaFatura, RitmoDaFatura } from '../lib/cartoes'
import { mensagemErroBanco } from '../lib/erros'
import { formatBRL, formatDate, formatMonth, primeiraMaiuscula } from '../lib/format'

/**
 * Folha "Por dia" da fatura do cartão (pedido do dono, 17/11/2026): o ritmo (gasto do ciclo até hoje, média por dia, projeção
 * do fechamento e a fatura anterior no mesmo ponto do ciclo) e as barras do gasto de cada dia. Tudo do banco (migration 137:
 * card_invoice_pace e card_invoice_daily); o front só mostra. Leitura isolada: se falhar, só a folha avisa.
 */
export function FolhaPorDiaFatura({ cartaoId, mes, hoje, aoFechar }: {
  cartaoId: string
  /** AAAA-MM da fatura. */
  mes: string
  hoje: string
  aoFechar: () => void
}) {
  const [dias, setDias] = useState<DiaDaFatura[] | null>(null)
  const [ritmo, setRitmo] = useState<RitmoDaFatura | null>(null)
  const [erro, setErro] = useState('')
  useEffect(() => {
    let vivo = true
    setDias(null)
    setErro('')
    Promise.all([gastoPorDiaDaFatura(cartaoId, mes), ritmoDaFatura(cartaoId, mes, hoje)])
      .then(([d, r]) => { if (vivo) { setDias(d); setRitmo(r) } })
      .catch((err) => { if (vivo) setErro(mensagemErroBanco(err)) })
    return () => { vivo = false }
  }, [cartaoId, mes, hoje])

  const aberto = ritmo !== null && ritmo.passados > 0 && ritmo.passados < ritmo.dias
  const ddmm = (iso: string) => formatDate(iso).slice(0, 5)

  return (
    <Folha titulo="Gasto por dia" aoFechar={aoFechar}>
      <div data-testid="folha-por-dia-fatura">
        {erro && <Aviso tipo="erro">Não foi possível carregar o gasto por dia desta fatura. {erro} A fatura continua correta.</Aviso>}
        {!erro && dias === null && <p className="text-sm text-slate-600" role="status">Carregando…</p>}
        {!erro && dias !== null && dias.length === 0 && (
          <p className="text-sm text-slate-600" role="status">Ainda não há gasto por dia para esta fatura.</p>
        )}
        {!erro && dias !== null && dias.length > 0 && (
          <>
            <p className="mb-3 text-xs text-slate-500">
              {primeiraMaiuscula(formatMonth(mes))} · compras de {ddmm(dias[0].dia)} a {ddmm(dias[dias.length - 1].dia)} (o ciclo da fatura),
              no dia da compra. Parcelas de compras de antes do ciclo aparecem à parte; créditos avulsos e assinaturas ainda não
              lançadas não entram.
            </p>
            {ritmo && (
              <dl className="mb-4 grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg bg-fundo p-3 text-sm" aria-label="Ritmo da fatura" data-testid="ritmo-fatura">
                <div>
                  <dt className="text-xs text-slate-500">{aberto ? `Gasto até hoje (${ritmo.passados} de ${ritmo.dias} dias)` : 'Gasto no ciclo'}</dt>
                  <dd className="whitespace-nowrap text-base font-semibold tabular-nums text-marinho">{formatBRL(ritmo.gasto)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Média por dia</dt>
                  <dd className="whitespace-nowrap text-base font-semibold tabular-nums text-marinho">{ritmo.mediaPorDia === null ? '—' : formatBRL(ritmo.mediaPorDia)}</dd>
                </div>
                {aberto && ritmo.projecao !== null && (
                  <div className="col-span-2">
                    <dt className="text-xs text-slate-500">No ritmo atual, a fatura fecha em</dt>
                    <dd className="whitespace-nowrap text-lg font-bold tabular-nums text-atencao" data-testid="projecao-fatura">≈ {formatBRL(ritmo.projecao)}</dd>
                  </div>
                )}
                {ritmo.faturaAnterior && ritmo.anteriorNoMesmoPonto !== null && (
                  <div className="col-span-2">
                    <dt className="text-xs text-slate-500">Fatura de {formatMonth(ritmo.faturaAnterior)} no mesmo ponto do ciclo</dt>
                    <dd className="whitespace-nowrap font-semibold tabular-nums text-slate-700">{formatBRL(ritmo.anteriorNoMesmoPonto)}</dd>
                  </div>
                )}
                {ritmo.jaVinha > 0 && (
                  <div className="col-span-2">
                    <dt className="text-xs text-slate-500">Já vinha (parcelas de compras de antes do ciclo)</dt>
                    <dd className="whitespace-nowrap font-semibold tabular-nums text-slate-700">{formatBRL(ritmo.jaVinha)}</dd>
                  </div>
                )}
              </dl>
            )}
            <BarrasDiarias titulo={`Gasto por dia na fatura de ${formatMonth(mes)}`} dias={dias.map((d) => ({ dia: d.dia, valor: d.valor }))} hoje={hoje} />
          </>
        )}
      </div>
    </Folha>
  )
}
