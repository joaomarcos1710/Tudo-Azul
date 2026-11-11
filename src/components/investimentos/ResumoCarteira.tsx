import type { ReactNode } from 'react'
import { Card } from '../ui/Card'
import type { Cents } from '../../lib/format'
import type { Aportes, TotalInvestimento, TotalProventos } from '../../lib/investimentos'
import { comSinal, corDoResultado, sobreOAportado } from './TabelaPosicoes'

/**
 * Resumo da carteira em reais (pedido do dono, 10/11/2026, a partir de um desenho dele): Carteira (quanto vale hoje),
 * Aportado e Rendimento, lado a lado; "Proventos no mês" só aparece quando há provento recebido ou previsto no mês
 * (decisão do dono: "esconde quando não há provento"). Todos os valores vêm do banco; aqui só há o rendimento ÷
 * aportado, para exibir. No celular cada cartão vira uma linha: quatro cartões em duas colunas cortariam valores de
 * seis dígitos.
 *
 * Dois jeitos de contar, conforme o banco:
 *  - com `aportes` (migration 107, o que o dono pediu): Aportado = o que ele pôs menos o que tirou, e Rendimento = tudo o
 *    que rendeu, contando o ganho que já saiu nos resgates. Carteira = Aportado + Rendimento, no centavo. Sem resgate
 *    nenhum, "Aportado" é exatamente "quanto saiu do bolso"; com resgate, a nota mostra quanto pôs e quanto tirou, e o
 *    percentual some (rendimento ÷ aportado líquido deixa de querer dizer alguma coisa);
 *  - sem `aportes` (banco ainda sem a 107): Aportado = custo do que AINDA está investido e Rendimento só dessa parte
 *    (pôs 1.000, valia 1.100, tirou 550: aportado 500, rendimento 50), com a frase embaixo dizendo isso.
 */
export function ResumoCarteira({ total, aportes, proventos, formatar }: {
  total: TotalInvestimento
  /** aportes e resgates da moeda (migration 107); null = banco sem a função: vale o custo do que está investido */
  aportes: Aportes | null
  /** proventos do mês corrente em reais; null = sem provento no mês ou o banco ainda não respondeu */
  proventos: TotalProventos | null
  formatar: (c: Cents) => string
}) {
  const comProventos = proventos !== null && (proventos.recebido > 0 || proventos.previsto > 0)
  const aportado = aportes ? aportes.liquido : total.custoTotal
  const rendimento = aportes ? aportes.ganho : total.resultado
  const comResgate = aportes !== null && aportes.resgatado > 0
  const notaAportado = !aportes ? 'Custo do que está investido'
    : comResgate ? `Pôs ${formatar(aportes.aportado)} · tirou ${formatar(aportes.resgatado)}` : 'Quanto saiu do bolso'
  const notaRendimento = comResgate ? 'Contando o que já foi resgatado' : sobreOAportado(rendimento, aportado) ?? 'Valor de hoje menos o aportado'
  return (
    <>
    <ul className={`grid gap-3 sm:grid-cols-3 ${comProventos ? 'xl:grid-cols-4' : ''}`} aria-label="Resumo da carteira em reais">
      <Numero rotulo="Carteira" valor={formatar(aportes ? aportes.valorAtual : total.valorAtual)} nota="Quanto vale hoje" />
      <Numero rotulo="Aportado" valor={formatar(aportado)} nota={notaAportado} />
      <Numero rotulo="Rendimento" valor={comSinal(formatar(rendimento), rendimento)} cor={corDoResultado(rendimento)} nota={notaRendimento} />
      {comProventos && (
        <Numero rotulo="Proventos no mês" valor={formatar(proventos.recebido)}
          nota={proventos.previsto > 0 ? `Recebidos · ${formatar(proventos.previsto)} previstos` : 'Dividendos e juros recebidos'} />
      )}
    </ul>
    {!aportes && <p className="mt-2 text-xs text-slate-500">Aportado e rendimento são do que ainda está investido: o que já foi resgatado não entra.</p>}
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
