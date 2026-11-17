import { formatBRL, formatDate } from '../lib/format'
import type { Pendencia, TipoPendencia } from '../lib/lancamentos'

/**
 * Faixa de pendências no topo de Lançamentos (handoff "Extrato e Gastos", item c; decisões do dono de 17/11/2026).
 * Só no mês atual (quem decide é a tela) e só com o que há: sem pendência, a faixa não aparece. Os totais vêm do banco
 * (`pending_strip`, migration 134); aqui só se mostra. Vencidos a pagar e a receber ficam separados: somar o que sai com
 * o que entra não diz nada. Cores da regra #183, as mesmas dos avisos do Início: vencido a pagar vermelho; a pagar e
 * recebimento atrasado em âmbar (atenção); a receber verde (agendado), sempre com a palavra ao lado.
 */
const ORDEM: TipoPendencia[] = ['overdue_payable', 'overdue_receivable', 'payable', 'receivable']

const COR: Record<TipoPendencia, string> = {
  overdue_payable: 'text-prejuizo',
  overdue_receivable: 'text-atencao',
  payable: 'text-atencao',
  receivable: 'text-agendado',
}

const ddmm = (iso: string) => formatDate(iso).slice(0, 5)

function rotulo(tipo: TipoPendencia, ate: string): string {
  switch (tipo) {
    case 'overdue_payable': return 'Vencidos a pagar'
    case 'overdue_receivable': return 'Vencidos a receber'
    case 'payable': return `A pagar até ${ddmm(ate)}`
    case 'receivable': return `A receber até ${ddmm(ate)}`
  }
}

function detalhe(p: Pendencia): string {
  const itens = `${p.quantidade} ${p.quantidade === 1 ? 'item' : 'itens'}`
  return p.tipo.startsWith('overdue_') ? `${itens} · desde ${ddmm(p.primeira)}` : `${itens} · próximo ${ddmm(p.primeira)}`
}

export function FaixaPendencias({ pendencias, ate }: { pendencias: Pendencia[]; ate: string }) {
  const lista = ORDEM.flatMap((t) => pendencias.filter((p) => p.tipo === t))
  if (lista.length === 0) return null
  return (
    <section aria-label="Pendências do mês" data-testid="faixa-pendencias" className="mb-4">
      <ul className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {lista.map((p) => (
          <li key={p.tipo} data-pendencia={p.tipo} className="min-w-0 rounded-lg bg-white px-3 py-2 shadow-card ring-1 ring-slate-100">
            <p className="truncate text-xs text-slate-600">{rotulo(p.tipo, ate)}</p>
            <p className={`whitespace-nowrap text-base font-semibold tabular-nums ${COR[p.tipo]}`}>{formatBRL(p.total)}</p>
            <p className="truncate text-xs text-slate-500">{detalhe(p)}</p>
          </li>
        ))}
      </ul>
      <p className="mt-1 text-xs text-slate-500">
        De todas as contas em reais, sem os filtros da lista. Fatura entra só fechada; desconto em folha não entra; a
        fatura que já existia antes de cadastrar o cartão no app também não.
      </p>
    </section>
  )
}
