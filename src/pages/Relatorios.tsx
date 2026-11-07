import { useId, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { EntradasSaidas } from '../components/EntradasSaidas'
import { RelatorioContas } from '../components/RelatorioContas'
import { RelatorioPessoas } from '../components/RelatorioPessoas'
import { CabecalhoPagina } from '../components/ui/CabecalhoPagina'
import { hojeSP } from '../lib/contas'
import { periodoDoMes } from '../lib/periodoRelatorio'
import type { Periodo } from '../lib/periodoRelatorio'

type Aba = 'entradas-saidas' | 'contas' | 'pessoas'
const ABAS: { chave: Aba; rotulo: string }[] = [
  { chave: 'entradas-saidas', rotulo: 'Entradas x Saídas' },
  { chave: 'contas', rotulo: 'Contas' },
  { chave: 'pessoas', rotulo: 'Gastos por pessoa' },
]

/**
 * Relatórios (como no Organizze, Relatório › ...): abas no topo e UM período para todas (trocar de aba mantém o
 * período escolhido). Só a aba aberta fica montada e consulta o banco. A exportação foi para Conta › Exportar dados.
 */
export default function Relatorios() {
  const [periodo, setPeriodo] = useState<Periodo>(() => periodoDoMes(hojeSP().slice(0, 7)))
  const [aba, setAba] = useState<Aba>('entradas-saidas')
  const id = useId()
  const lista = useRef<HTMLDivElement>(null)
  const idAba = (a: Aba) => `${id}-aba-${a}`
  const idPainel = `${id}-painel`

  /** Setas, Home e End andam entre as abas (padrão tablist com ativação automática). */
  function teclaNaAba(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    const n = ABAS.length
    const destino = e.key === 'ArrowRight' ? (i + 1) % n
      : e.key === 'ArrowLeft' ? (i - 1 + n) % n
      : e.key === 'Home' ? 0
      : e.key === 'End' ? n - 1 : null
    if (destino === null) return
    e.preventDefault()
    setAba(ABAS[destino].chave)
    lista.current?.querySelectorAll<HTMLElement>('[role="tab"]')[destino]?.focus()
  }

  return (
    <>
      <CabecalhoPagina titulo="Relatórios" descricao="Quanto entrou e saiu em cada período, e em cada conta." />
      <div ref={lista} role="tablist" aria-label="Relatórios" className="mb-4 flex rounded-lg bg-slate-100 p-1 sm:inline-flex">
        {ABAS.map((a, i) => {
          const ativa = aba === a.chave
          return (
            <button key={a.chave} id={idAba(a.chave)} type="button" role="tab" aria-selected={ativa}
              aria-controls={ativa ? idPainel : undefined} tabIndex={ativa ? 0 : -1}
              onClick={() => setAba(a.chave)} onKeyDown={(e) => teclaNaAba(e, i)}
              className={`min-h-11 flex-1 whitespace-nowrap rounded-md px-4 text-sm font-semibold ${ativa ? 'bg-white text-marinho shadow-card' : 'text-slate-600'}`}>
              {a.rotulo}
            </button>
          )
        })}
      </div>
      <div role="tabpanel" id={idPainel} aria-labelledby={idAba(aba)}>
        {aba === 'entradas-saidas'
          ? <EntradasSaidas periodo={periodo} aoMudarPeriodo={setPeriodo} />
          : aba === 'contas'
            ? <RelatorioContas periodo={periodo} aoMudarPeriodo={setPeriodo} />
            : <RelatorioPessoas periodo={periodo} aoMudarPeriodo={setPeriodo} />}
      </div>
    </>
  )
}
