import { useSearchParams } from 'react-router-dom'
import { CabecalhoPagina } from '../components/ui/CabecalhoPagina'
import { ProjecaoCompromissos } from '../components/ui/ProjecaoCompromissos'
import { ParcelasAtivas } from '../components/recorrentes/ParcelasAtivas'
import { useFamilia } from '../lib/FamiliaContext'
import { hojeSP } from '../lib/contas'

/**
 * Compromissos (pedido do dono, 17/11/2026: a projeção de compromissos e as parcelas estavam em Recorrentes, mas não são só o que
 * se repete: têm parcelamentos, financiamentos e lançamentos avulsos). Duas abas, que só carregam quando abrem:
 *   * Projeção: a matriz dos compromissos de despesa dos próximos 3 ou 6 meses (dashboard_commitment_matrix, somada no banco);
 *   * Parcelas: os parcelamentos ativos, com o cronograma e quando acabam.
 * A aba vai na URL (`?aba=parcelas`); sem ela, abre em Projeção. A tela não soma dinheiro: só organiza o que o banco manda.
 */
type Aba = 'projecao' | 'parcelas'
const ABAS: [Aba, string][] = [['projecao', 'Projeção'], ['parcelas', 'Parcelas']]

export default function Compromissos() {
  const { familia } = useFamilia()
  const familiaId = familia?.id
  const [params, setParams] = useSearchParams()
  const aba: Aba = params.get('aba') === 'parcelas' ? 'parcelas' : 'projecao'
  const mudar = (nova: Aba) => setParams(nova === 'projecao' ? {} : { aba: nova }, { replace: true })

  return (
    <>
      <CabecalhoPagina titulo="Compromissos"
        descricao="O que já está comprometido nos próximos meses: contas fixas, assinaturas, parcelas e financiamentos. Só para consulta." />
      <div role="tablist" aria-label="Seções de Compromissos" className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200"
        onKeyDown={(e) => {
          // setas movem entre as abas (padrão de abas): a aba nova recebe o foco e abre
          if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
          const i = ABAS.findIndex(([chave]) => chave === aba)
          const nova = ABAS[(i + (e.key === 'ArrowRight' ? 1 : ABAS.length - 1)) % ABAS.length][0]
          mudar(nova)
          document.getElementById(`aba-${nova}`)?.focus()
        }}>
        {ABAS.map(([chave, rotulo]) => (
          <button key={chave} id={`aba-${chave}`} type="button" role="tab" aria-selected={aba === chave} aria-controls={`painel-${chave}`}
            tabIndex={aba === chave ? 0 : -1} onClick={() => mudar(chave)}
            className={`min-h-11 shrink-0 whitespace-nowrap border-b-2 px-4 text-sm font-semibold transition-colors ${aba === chave
              ? 'border-azul text-azul' : 'border-transparent text-slate-600 hover:text-marinho'}`}>
            {rotulo}
          </button>
        ))}
      </div>
      {familiaId && aba === 'projecao' && (
        <div role="tabpanel" id="painel-projecao" aria-labelledby="aba-projecao">
          <ProjecaoCompromissos familiaId={familiaId} hoje={hojeSP()} />
        </div>
      )}
      {familiaId && aba === 'parcelas' && (
        <div role="tabpanel" id="painel-parcelas" aria-labelledby="aba-parcelas">
          <ParcelasAtivas familiaId={familiaId} />
        </div>
      )}
    </>
  )
}
