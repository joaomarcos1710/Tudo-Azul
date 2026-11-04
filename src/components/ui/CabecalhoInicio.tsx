import { Link } from 'react-router-dom'
import { IconeCartoes, IconeSomar, IconeSubtrair, IconeTransferir } from '../layout/icons'
import { formatBRL } from '../../lib/format'
import type { Cents } from '../../lib/format'

/** Saudação pela hora de São Paulo. */
export function saudacao(agora = new Date()): string {
  const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hourCycle: 'h23' }).format(agora))
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'
}

/**
 * Cabeçalho do Início (inspirado no Organizze): saudação, receita e despesa do mês (do banco, period_summary) e
 * atalhos que abrem o formulário de lançamento já com o tipo escolhido (?novo= em Lançamentos).
 */
export function CabecalhoInicio({ nome, receitas, despesas, aReceber = null, aPagar = null }: {
  nome: string; receitas: Cents | null; despesas: Cents | null
  /** Ainda planejado no mês (do banco): evita o susto de "receita R$ 0,00" antes do salário cair. */
  aReceber?: Cents | null; aPagar?: Cents | null
}) {
  const atalho = 'inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-marinho shadow-sm hover:bg-slate-50'
  return (
    <header className="mb-6 flex flex-col gap-4 rounded-card bg-white p-5 shadow-card md:flex-row md:items-end md:justify-between">
      <div>
        <p className="text-sm text-slate-500">{saudacao()},</p>
        <h1 className="text-xl font-bold text-marinho">{nome ? `${nome}!` : 'bem-vindo!'}</h1>
        <div className="mt-3 flex items-start gap-6">
          <div>
            <p className="text-xs text-slate-500">Receita mensal</p>
            <p className="tabular-nums text-lg font-bold text-positivo">{receitas === null ? '—' : formatBRL(receitas)}</p>
            {aReceber !== null && aReceber > 0 && <p className="tabular-nums text-xs text-slate-500">a receber {formatBRL(aReceber)}</p>}
          </div>
          <div>
            <p className="text-xs text-slate-500">Despesa mensal</p>
            <p className="tabular-nums text-lg font-bold text-negativo">{despesas === null ? '—' : formatBRL(despesas)}</p>
            {aPagar !== null && aPagar > 0 && <p className="tabular-nums text-xs text-slate-500">a pagar {formatBRL(aPagar)}</p>}
          </div>
          <Link to="/analises" aria-label="Ver análises do mês"
            className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 text-marinho hover:bg-slate-50">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 20V10M12 20V4M18 20v-6" /></svg>
          </Link>
        </div>
      </div>
      <nav aria-label="Ações rápidas" className="flex flex-wrap gap-2">
        <Link to="/lancamentos?novo=despesa" className={atalho}><span className="text-negativo"><IconeSubtrair /></span>Despesa</Link>
        <Link to="/lancamentos?novo=receita" className={atalho}><span className="text-positivo"><IconeSomar /></span>Receita</Link>
        <Link to="/lancamentos?novo=transferencia" className={atalho}><span className="text-slate-600"><IconeTransferir /></span>Transferência</Link>
        <Link to="/lancamentos?novo=cartao" className={atalho}><span className="text-azul"><IconeCartoes /></span>Compra no cartão</Link>
      </nav>
    </header>
  )
}
