import { useEffect, useId, useState } from 'react'
import { SELO, corDoValor } from '../../lib/cores'
import { formatBRL, formatMonth, primeiraMaiuscula } from '../../lib/format'
import type { Cents } from '../../lib/format'
import type { Faixa, Indicadores } from '../../lib/indicadores'

/**
 * Faixa de indicadores do topo do Início (#188): quanto tenho, quanto entra e sai, quanto devo e se estou avançando.
 * Todo número vem do banco (home_indicators, migration 071), inclusive as razões e as faixas de cor; aqui só se
 * formata. A cor nunca é a única pista: cada indicador tem um rótulo curto e um (i) com a conta em uma linha.
 * 2 colunas no celular, 4 no iPad (duas linhas) e 7 numa linha no computador.
 */

type Tom = 'lucro' | 'atencao' | 'prejuizo' | 'neutro'

const TEXTO: Record<Tom, string> = { lucro: 'text-lucro', atencao: 'text-atencao', prejuizo: 'text-prejuizo', neutro: 'text-neutro' }
const SELO_TOM: Record<Tom, string> = { lucro: SELO.pago, atencao: SELO.atencao, prejuizo: SELO.vencido, neutro: SELO.neutro }

const tomDoValor = (v: Cents): Tom => ({ 'text-lucro': 'lucro', 'text-prejuizo': 'prejuizo', 'text-neutro': 'neutro' } as const)[corDoValor(v)]
const tomDaFaixa = (f: Faixa | null): Tom => (f === 'saudavel' ? 'lucro' : f === 'atencao' ? 'atencao' : f === 'critico' ? 'prejuizo' : 'neutro')
const rotuloDoSinal = (v: Cents) => (v > 0 ? 'Positivo' : v < 0 ? 'Negativo' : 'Zerado')

/** Uma casa decimal, com o menos tipográfico (U+2212), como os valores em reais. */
const umaCasa = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).replace('-', '−')

/** 33.3 -> "33,3%"; null -> "—" (sem base para a conta). */
export function formatPct(v: number | null): string {
  return v === null ? '—' : `${umaCasa(v)}%`
}

/** 6 -> "6,0 meses"; 1 -> "1,0 mês"; null -> "—". */
export function formatMeses(v: number | null): string {
  if (v === null) return '—'
  return `${umaCasa(v)} ${v === 1 ? 'mês' : 'meses'}`
}

interface Item {
  id: string
  rotulo: string
  /** De quando é o número: "Até hoje" (mês corrente) ou o nome do último mês fechado ("Outubro"). */
  periodo?: string
  valor: string
  tom: Tom
  /** Rótulo curto ao lado da cor ("Saudável", "Atenção", "Alto"…). */
  selo: string
  /** A conta em uma linha, com os números do banco. */
  explicacao: string
}

/** "2026-10-01" -> "Outubro" */
export function nomeDoMes(data: string): string {
  return primeiraMaiuscula(formatMonth(data.slice(0, 7)).split(' ')[0])
}

export function itensDaFaixa(d: Indicadores): Item[] {
  const fechado = nomeDoMes(d.inicioMesFechado)
  const fx = (f: Faixa | null, saudavel: string, atencao: string, critico: string) =>
    f === 'saudavel' ? saudavel : f === 'atencao' ? atencao : f === 'critico' ? critico : 'Sem dado'
  return [
    {
      id: 'disponivel', rotulo: 'Disponível', valor: formatBRL(d.disponivel), tom: tomDoValor(d.disponivel), selo: rotuloDoSinal(d.disponivel),
      explicacao: `Contas ativas em reais ${formatBRL(d.contasAtivas)} − faturas de cartão fechadas a pagar ${formatBRL(d.faturasFechadas)}. A fatura aberta só entra quando fechar.`,
    },
    {
      id: 'patrimonio', rotulo: 'Patrimônio total', valor: formatBRL(d.patrimonio), tom: tomDoValor(d.patrimonio), selo: rotuloDoSinal(d.patrimonio),
      explicacao: `Contas ${formatBRL(d.contasTodas)}${d.creditoAReceber > 0 ? ` + crédito no cartão ${formatBRL(d.creditoAReceber)}` : ''} + bens ${formatBRL(d.bens)} + investimentos ${formatBRL(d.investimentos)} − dívidas ${formatBRL(d.dividas)}. Previdência e FGTS ainda não entram.`,
    },
    {
      id: 'resultado', rotulo: 'Resultado do mês', periodo: 'Até hoje', valor: formatBRL(d.resultado), tom: tomDoValor(d.resultado), selo: rotuloDoSinal(d.resultado),
      explicacao: `Receitas ${formatBRL(d.receitas)} − despesas ${formatBRL(d.despesas)} pagas neste mês até hoje, em reais; o cartão conta na data da fatura.`,
    },
    {
      id: 'poupanca', rotulo: 'Taxa de poupança', periodo: fechado, valor: formatPct(d.taxaPoupanca), tom: tomDaFaixa(d.faixaPoupanca),
      selo: d.taxaPoupanca === null ? 'Sem receita' : fx(d.faixaPoupanca, 'Saudável', 'Atenção', 'Negativa'),
      explicacao: `${fechado}, o último mês fechado: (receitas ${formatBRL(d.receitasPoupanca)} − despesas ${formatBRL(d.despesasPoupanca)}) ÷ receitas, sem as categorias que não contam como consumo. Azul a partir de 10%, vermelho abaixo de 0%.`,
    },
    {
      id: 'reserva', rotulo: 'Cobertura da reserva', valor: formatMeses(d.coberturaReserva), tom: tomDaFaixa(d.faixaReserva),
      selo: d.coberturaReserva === null ? 'Sem despesa' : fx(d.faixaReserva, 'Saudável', 'Atenção', 'Baixa'),
      explicacao: d.mesesFechados === 0 || d.despesaTipica === null
        ? 'Saldo das contas Poupança / reserva ÷ despesa típica dos últimos 6 meses fechados; ainda não há mês fechado com conta aberta.'
        : `Poupança / reserva ${formatBRL(d.reserva)} ÷ despesa típica de ${formatBRL(d.despesaTipica)} por mês (mediana de ${d.mesesFechados} ${d.mesesFechados === 1 ? 'mês fechado' : 'meses fechados'}, sem o que não conta como consumo). Azul a partir de 6 meses; vermelho abaixo de 3.`,
    },
    {
      id: 'comprometimento', rotulo: 'Comprometimento com dívidas', periodo: fechado, valor: formatPct(d.comprometimento), tom: tomDaFaixa(d.faixaComprometimento),
      selo: d.comprometimento === null ? 'Sem renda' : fx(d.faixaComprometimento, 'Saudável', 'Atenção', 'Alto'),
      explicacao: `${fechado}: parcelas de empréstimo, financiamento e consignado ${formatBRL(d.parcelasDividas)} ÷ renda regular ${formatBRL(d.rendaRegular)} (${d.fonteRenda === 'recorrente' ? 'a esperada pelas receitas recorrentes' : 'a recebida no mês, fora as eventuais'}). Cartão fica fora. Azul até 30%, vermelho acima de 40%.`,
    },
    {
      id: 'dividas', rotulo: 'Dívidas totais', valor: formatBRL(d.dividas), tom: 'neutro', selo: d.dividas > 0 ? 'Em aberto' : 'Nenhuma',
      explicacao: `Saldo devedor de empréstimos, financiamentos e cartões (fatura fechada). Parcelas futuras do cartão (${formatBRL(d.compromissos)}) ainda não entram.`,
    },
  ]
}

function Indicador({ item }: { item: Item }) {
  const [aberto, setAberto] = useState(false)
  const id = useId()
  useEffect(() => {
    if (!aberto) return
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAberto(false) }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [aberto])
  // A fonte do valor acompanha a largura do card (unidade cqi do container), para caber numa linha nos três layouts
  // (2, 4 e 7 colunas) sem quebrar nem vazar; valor longo (milhões, com sinal) usa uma fração menor.
  const longo = item.valor.length > 13
  return (
    <li data-indicador={item.id} className="min-w-0 rounded-card bg-white p-3 shadow-card [container-type:inline-size]">
      {/* o rótulo tem a largura toda ("Comprometimento" não cabe ao lado do botão no card estreito); o (i) fica na linha do selo */}
      {/* hífen opcional (U+00AD): no card estreito do iPad "Comprometimento" quebra como "Comprometi-mento", nunca no meio sem hífen */}
      <p className="text-xs font-medium leading-tight text-slate-500">
        <span data-rotulo>{item.rotulo.replace('Comprometimento', 'Comprometi\u00ADmento')}</span>
        {item.periodo && <span data-periodo className="block font-normal">{item.periodo}</span>}
      </p>
      <p className={`mt-1 whitespace-nowrap tabular-nums font-bold ${longo ? 'text-[clamp(0.6875rem,10cqi,1rem)]' : 'text-[clamp(0.75rem,11.5cqi,1.125rem)]'} ${TEXTO[item.tom]}`}>
        {item.valor}
      </p>
      <div className="mt-1 flex items-center justify-between gap-1">
        <span data-selo className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${SELO_TOM[item.tom]}`}>{item.selo}</span>
        <button type="button" onClick={() => setAberto((v) => !v)} aria-expanded={aberto} aria-controls={id}
          aria-label={`Como é calculado: ${item.rotulo}`}
          className="-my-1 -mr-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-marinho">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" />
          </svg>
        </button>
      </div>
      <p id={id} hidden={!aberto} className="mt-2 text-xs leading-snug text-slate-600">{item.explicacao}</p>
    </li>
  )
}

export function FaixaIndicadores({ dados }: { dados: Indicadores | null }) {
  return (
    <section aria-label="Indicadores do mês" className="mb-5">
      {dados === null ? (
        <p className="rounded-card bg-white p-4 text-sm text-slate-500 shadow-card" role="status">Indicadores indisponíveis agora. O resto do Início continua.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
          {itensDaFaixa(dados).map((item) => <Indicador key={item.id} item={item} />)}
        </ul>
      )}
    </section>
  )
}
