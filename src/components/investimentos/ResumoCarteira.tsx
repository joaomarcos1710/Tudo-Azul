import type { ReactNode } from 'react'
import { Card } from '../ui/Card'
import type { Cents } from '../../lib/format'
import type { TotalInvestimento, TotalProventos } from '../../lib/investimentos'
import { comSinal, corDoResultado, sobreOAportado } from './TabelaPosicoes'

/**
 * Resumo da carteira em reais (pedido do dono, 10/11/2026, a partir de um desenho dele): Carteira (quanto vale hoje),
 * Aportado e Rendimento, lado a lado. "Aportado" é o custo do que AINDA está investido (custo médio do banco), não tudo
 * o que já saiu do bolso: depois de um resgate, a parte resgatada sai do aportado e o ganho dela sai do rendimento
 * (pôs 1.000, valia 1.100, tirou 550: aportado 500, rendimento 50). Por isso a nota e a frase embaixo dizem "do que
 * ainda está investido"; o desenho dizia "quanto saiu do bolso", que ficaria errado no primeiro resgate.
 * Ainda lado a lado: "Proventos no mês" só aparece quando há provento recebido ou
 * previsto no mês (decisão do dono: "esconde quando não há provento"). Todos os valores vêm do banco
 * (investment_totals e investment_income_totals); aqui só há o rendimento ÷ aportado, para exibir.
 * No celular cada cartão vira uma linha (rótulo à esquerda, valor à direita): quatro cartões em duas colunas cortariam
 * valores de seis dígitos.
 */
export function ResumoCarteira({ total, proventos, formatar }: {
  total: TotalInvestimento
  /** proventos do mês corrente em reais; null = sem provento no mês ou o banco ainda não respondeu */
  proventos: TotalProventos | null
  formatar: (c: Cents) => string
}) {
  const comProventos = proventos !== null && (proventos.recebido > 0 || proventos.previsto > 0)
  return (
    <>
    <ul className={`grid gap-3 sm:grid-cols-3 ${comProventos ? 'xl:grid-cols-4' : ''}`} aria-label="Resumo da carteira em reais">
      <Numero rotulo="Carteira" valor={formatar(total.valorAtual)} nota="Quanto vale hoje" />
      <Numero rotulo="Aportado" valor={formatar(total.custoTotal)} nota="Custo do que está investido" />
      <Numero rotulo="Rendimento" valor={comSinal(formatar(total.resultado), total.resultado)} cor={corDoResultado(total.resultado)}
        nota={sobreOAportado(total.resultado, total.custoTotal) ?? 'Valor de hoje menos o aportado'} />
      {comProventos && (
        <Numero rotulo="Proventos no mês" valor={formatar(proventos.recebido)}
          nota={proventos.previsto > 0 ? `Recebidos · ${formatar(proventos.previsto)} previstos` : 'Dividendos e juros recebidos'} />
      )}
    </ul>
    <p className="mt-2 text-xs text-slate-500">Aportado e rendimento são do que ainda está investido: o que já foi resgatado não entra.</p>
    </>
  )
}

function Numero({ rotulo, valor, nota, cor = 'text-marinho' }: { rotulo: string; valor: string; nota: ReactNode; cor?: string }) {
  return (
    <li>
      <Card className="flex h-full items-center justify-between gap-3 sm:block">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{rotulo}</p>
          <p className="text-xs text-slate-500 sm:hidden">{nota}</p>
        </div>
        <p className={`shrink-0 whitespace-nowrap text-xl font-bold tabular-nums sm:mt-1 sm:text-2xl ${cor}`}>{valor}</p>
        <p className="hidden text-xs text-slate-500 sm:block">{nota}</p>
      </Card>
    </li>
  )
}
