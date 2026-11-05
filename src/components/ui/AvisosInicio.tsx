import { useState } from 'react'
import type { ReactNode, UIEvent } from 'react'
import { Link } from 'react-router-dom'
import { IconeCalendario, IconeCartoes, IconeSomar, IconeSubtrair } from '../layout/icons'
import { textoDoAviso } from '../../lib/avisosInicio'
import type { AvisoInicio, TipoAviso } from '../../lib/avisosInicio'

const VISUAL: Record<TipoAviso, { icone: ReactNode; cor: string }> = {
  // #183: vencido = prejuízo (vermelho); atrasado a receber, fatura e conta a pagar perto = atenção; a receber = agendado
  overdue_payable: { icone: <IconeCalendario />, cor: 'bg-prejuizo-fundo text-prejuizo' },
  overdue_receivable: { icone: <IconeCalendario />, cor: 'bg-atencao-fundo text-atencao' },
  invoice: { icone: <IconeCartoes />, cor: 'bg-atencao-fundo text-atencao' },
  payable: { icone: <IconeSubtrair />, cor: 'bg-atencao-fundo text-atencao' },
  receivable: { icone: <IconeSomar />, cor: 'bg-agendado-fundo text-agendado' },
}

/**
 * Faixa de avisos do topo do Início (como os cartões de aviso do Organizze). Só aparece com algo a dizer.
 * Contagens, totais e datas vêm do banco (public.home_alerts); aqui só se escreve o texto.
 * No celular: rolagem horizontal com "snap" e pontinhos da posição; do md em diante, cartões lado a lado.
 */
export function AvisosInicio({ avisos, hoje }: { avisos: AvisoInicio[]; hoje: string }) {
  const [atual, setAtual] = useState(0)
  if (avisos.length === 0) return null

  function rolou(e: UIEvent<HTMLUListElement>) {
    const el = e.currentTarget
    const largura = el.firstElementChild instanceof HTMLElement ? el.firstElementChild.offsetWidth : 0
    if (largura > 0) setAtual(Math.min(avisos.length - 1, Math.max(0, Math.round(el.scrollLeft / largura))))
  }

  return (
    <section aria-label="Avisos" className="mb-4">
      <ul onScroll={rolou} data-testid="avisos-inicio"
        className="-mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-1 md:mx-0 md:grid md:grid-cols-2 md:overflow-visible md:px-0 lg:grid-cols-3">
        {avisos.map((a) => {
          const t = textoDoAviso(a, hoje)
          const v = VISUAL[a.tipo]
          const conteudo = <>
            <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${v.cor}`} aria-hidden="true">{v.icone}</span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-marinho">{t.titulo}</span>
              <span className="block text-sm text-slate-600">{t.texto}</span>
            </span>
            <svg className="shrink-0 text-slate-400" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
              strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
          </>
          const classe = 'flex h-full min-h-11 items-center gap-3 rounded-card bg-white p-4 shadow-card hover:bg-slate-50'
          const rotulo = `${t.titulo}: ${t.texto}`
          return (
            <li key={`${a.tipo}-${a.cartaoId ?? ''}`} className="w-[85%] shrink-0 snap-start md:w-auto">
              {t.destino.startsWith('#')
                ? <a href={t.destino} aria-label={rotulo} className={classe}>{conteudo}</a>
                : <Link to={t.destino} aria-label={rotulo} className={classe}>{conteudo}</Link>}
            </li>
          )
        })}
      </ul>
      {avisos.length > 1 && (
        // pontinhos só indicam a posição (cada cartão já é alcançável pelo teclado e pelo leitor de tela)
        <div className="mt-2 flex justify-center gap-1.5 md:hidden" aria-hidden="true" data-testid="avisos-pontinhos">
          {avisos.map((a, i) => (
            <span key={`${a.tipo}-${a.cartaoId ?? ''}`} data-ativo={i === atual}
              className={`h-1.5 rounded-full transition-all ${i === atual ? 'w-4 bg-azul' : 'w-1.5 bg-slate-300'}`} />
          ))}
        </div>
      )}
    </section>
  )
}
