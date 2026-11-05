import { formatMonth, primeiraMaiuscula } from '../../lib/format'
import { somarMeses } from '../../lib/lancamentos'

/**
 * Carrossel de mês: "‹ Set · [Outubro de 2026] · Nov ›"; o anterior e o seguinte também são clicáveis (#171, Relatórios).
 * Usado também no resumo de Cartões (#175). `rotulo` = nome do grupo para leitor de tela.
 */
export function SeletorMes({ mes, aoMudar, rotulo = 'Mês do relatório', className = 'lg:justify-start' }: {
  mes: string; aoMudar: (m: string) => void; rotulo?: string; className?: string
}) {
  const anterior = somarMeses(mes, -1), seguinte = somarMeses(mes, 1)
  const lado = 'min-h-11 rounded-lg px-2 text-sm text-slate-600 hover:bg-azul-claro'
  const seta = 'min-h-11 min-w-11 rounded-lg text-lg text-azul hover:bg-azul-claro'
  return (
    <div className={`flex items-center justify-between gap-1 ${className}`} role="group" aria-label={rotulo}>
      <button type="button" aria-label="Mês anterior" onClick={() => aoMudar(anterior)} className={seta}>‹</button>
      <button type="button" aria-label={`Ir para ${formatMonth(anterior)}`} onClick={() => aoMudar(anterior)} className={lado}>
        {primeiraMaiuscula(formatMonth(anterior).slice(0, 3))}
      </button>
      <span className="whitespace-nowrap rounded-lg bg-azul-claro px-3 py-2 text-sm font-semibold text-marinho" aria-live="polite">
        {primeiraMaiuscula(formatMonth(mes))}
      </span>
      <button type="button" aria-label={`Ir para ${formatMonth(seguinte)}`} onClick={() => aoMudar(seguinte)} className={lado}>
        {primeiraMaiuscula(formatMonth(seguinte).slice(0, 3))}
      </button>
      <button type="button" aria-label="Próximo mês" onClick={() => aoMudar(seguinte)} className={seta}>›</button>
    </div>
  )
}
