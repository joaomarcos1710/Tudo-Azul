import { useEffect, useState } from 'react'
import { Aviso } from './ui/Aviso'
import { Card } from './ui/Card'
import { SeletorPeriodo } from './ui/SeletorPeriodo'
import { useFamilia } from '../lib/FamiliaContext'
import { hojeSP } from '../lib/contas'
import { mensagemErroBanco } from '../lib/erros'
import { formatBRL } from '../lib/format'
import { listarGastosPorPessoa } from '../lib/pessoasFamilia'
import type { GastoPessoa } from '../lib/pessoasFamilia'
import type { Periodo } from '../lib/periodoRelatorio'

export function RelatorioPessoas({ periodo, aoMudarPeriodo }: {
  periodo: Periodo
  aoMudarPeriodo: (periodo: Periodo) => void
}) {
  const { familia } = useFamilia()
  const familiaId = familia?.id
  const [gastos, setGastos] = useState<GastoPessoa[] | null>(null)
  const [erro, setErro] = useState('')

  useEffect(() => {
    if (!familiaId) return
    let vivo = true
    setGastos(null)
    setErro('')
    listarGastosPorPessoa(familiaId, periodo.de, periodo.ate)
      .then((resultado) => { if (vivo) setGastos(resultado) })
      .catch((err) => { if (vivo) { setGastos(null); setErro(mensagemErroBanco(err)) } })
    return () => { vivo = false }
  }, [familiaId, periodo.de, periodo.ate])

  const hoje = hojeSP()
  const maior = Math.max(0, ...(gastos ?? []).map((g) => g.totalSpent))
  return (
    <section aria-label="Gastos por pessoa" className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <SeletorPeriodo periodo={periodo} hoje={hoje} aoMudar={aoMudarPeriodo} />
      </div>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {gastos === null && !erro && <p role="status" className="text-sm text-slate-600">Carregando gastos por pessoa…</p>}
      {gastos !== null && (
        <Card>
          <h2 className="text-base font-semibold text-marinho">Gastos por pessoa</h2>
          <p className="mb-4 text-sm text-slate-500">Despesas à vista pela data do lançamento e compras no cartão pela fatura. O pagamento da fatura não é contado novamente.</p>
          {gastos.length === 0 ? (
            <p className="py-5 text-center text-sm text-slate-500">Nenhuma despesa encontrada neste período.</p>
          ) : (
            <ul className="space-y-4">
              {gastos.map((g) => {
                const nome = g.isSharedExpense ? 'Toda a família'
                  : g.personId ? g.personName ?? 'Pessoa cadastrada'
                  : 'Não classificada'
                const largura = maior > 0 ? Math.max(2, Math.round(Math.max(0, g.totalSpent) / maior * 100)) : 0
                return (
                  <li key={g.isSharedExpense ? 'shared' : g.personId ?? 'unassigned'} data-testid="gasto-por-pessoa">
                    <div className="mb-1 flex items-baseline justify-between gap-3">
                      <span className="truncate text-sm font-medium text-marinho">{nome}</span>
                      <span className="shrink-0 text-sm font-semibold tabular-nums text-marinho">{formatBRL(g.totalSpent)}</span>
                    </div>
                    <div className="h-2.5 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`${nome}: ${formatBRL(g.totalSpent)}`}>
                      <div className={`h-full rounded-full ${g.isSharedExpense ? 'bg-sky-400' : 'bg-azul'}`}
                        style={{ width: `${largura}%` }} />
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>
      )}
    </section>
  )
}
