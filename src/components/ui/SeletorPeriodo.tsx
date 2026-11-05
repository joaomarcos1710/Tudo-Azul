import { useId, useState } from 'react'
import { Button } from './Button'
import { Folha } from './Folha'
import { ATALHOS, erroPeriodoLivre, moverPeriodo, rotuloPeriodo } from '../../lib/periodoRelatorio'
import type { Periodo } from '../../lib/periodoRelatorio'

/**
 * Seletor de período do relatório (#179, como no Organizze): "‹ Novembro de 2026 ›" ou "‹ 2026 ›". As setas andam um
 * período do mesmo tamanho; tocar no nome abre o menu (Hoje, Esta semana, Este mês, Últimos 3/6/12 meses, Este ano,
 * Escolher período). Não reaproveita o ui/SeletorMes porque ele só sabe de mês (e mostra os meses vizinhos).
 */
export function SeletorPeriodo({ periodo, hoje, aoMudar }: { periodo: Periodo; hoje: string; aoMudar: (p: Periodo) => void }) {
  const [menu, setMenu] = useState(false)
  const rotulo = rotuloPeriodo(periodo)
  const seta = 'min-h-11 min-w-11 shrink-0 rounded-lg text-lg text-azul hover:bg-azul-claro'
  return (
    <div className="flex items-center justify-between gap-1 sm:justify-start" role="group" aria-label="Período do relatório">
      <button type="button" aria-label="Período anterior" onClick={() => aoMudar(moverPeriodo(periodo, -1))} className={seta}>‹</button>
      <button type="button" aria-haspopup="dialog" aria-expanded={menu} onClick={() => setMenu(true)}
        aria-label={`Período: ${rotulo}. Trocar período`}
        className="min-h-11 min-w-0 whitespace-nowrap rounded-lg bg-azul-claro px-3 text-sm font-semibold text-marinho hover:ring-1 hover:ring-azul">
        <span aria-live="polite">{rotulo}</span> <span aria-hidden="true" className="text-azul">▾</span>
      </button>
      <button type="button" aria-label="Próximo período" onClick={() => aoMudar(moverPeriodo(periodo, 1))} className={seta}>›</button>
      {menu && <MenuPeriodo periodo={periodo} hoje={hoje} aoFechar={() => setMenu(false)} aoEscolher={(p) => { aoMudar(p); setMenu(false) }} />}
    </div>
  )
}

function MenuPeriodo({ periodo, hoje, aoEscolher, aoFechar }: {
  periodo: Periodo; hoje: string; aoEscolher: (p: Periodo) => void; aoFechar: () => void
}) {
  const [livre, setLivre] = useState(periodo.tipo === 'livre')
  const [de, setDe] = useState(periodo.de)
  const [ate, setAte] = useState(periodo.ate)
  const [erro, setErro] = useState('')
  const id = useId()
  const igual = (p: Periodo) => p.de === periodo.de && p.ate === periodo.ate && p.tipo === periodo.tipo

  function aplicarLivre() {
    const e = erroPeriodoLivre(de, ate)
    if (e) { setErro(e); return }
    aoEscolher({ tipo: 'livre', de, ate })
  }

  return (
    <Folha titulo="Período" aoFechar={aoFechar}>
      <ul className="flex flex-col gap-1">
        {ATALHOS.map((a) => {
          const p = a.criar(hoje)
          return (
            <li key={a.chave}>
              <button type="button" onClick={() => aoEscolher(p)} aria-current={igual(p) ? 'true' : undefined}
                className={`flex min-h-11 w-full items-center justify-between rounded-lg px-3 text-left text-sm ${igual(p) ? 'bg-azul-claro font-semibold text-marinho' : 'hover:bg-slate-50'}`}>
                <span>{a.rotulo}</span>
                <span className="text-xs text-slate-600">{rotuloPeriodo(p)}</span>
              </button>
            </li>
          )
        })}
        <li>
          <button type="button" aria-expanded={livre} aria-controls={`${id}-livre`} onClick={() => setLivre(!livre)}
            className={`flex min-h-11 w-full items-center rounded-lg px-3 text-left text-sm ${periodo.tipo === 'livre' ? 'bg-azul-claro font-semibold text-marinho' : 'hover:bg-slate-50'}`}>
            Escolher período
          </button>
        </li>
      </ul>
      {livre && (
        <div id={`${id}-livre`} className="mt-3 rounded-lg border border-slate-200 p-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm"><span className="font-medium">Data inicial</span>
              <input type="date" value={de} max={ate || undefined} onChange={(e) => { setDe(e.target.value); setErro('') }}
                className="min-h-11 min-w-0 rounded-lg border border-slate-500 px-3" />
            </label>
            <label className="flex flex-col gap-1 text-sm"><span className="font-medium">Data final</span>
              <input type="date" value={ate} min={de || undefined} onChange={(e) => { setAte(e.target.value); setErro('') }}
                className="min-h-11 min-w-0 rounded-lg border border-slate-500 px-3" />
            </label>
          </div>
          {erro && <p role="alert" className="mt-2 text-sm text-negativo">{erro}</p>}
          <div className="mt-3 flex justify-end"><Button onClick={aplicarLivre}>Aplicar período</Button></div>
        </div>
      )}
    </Folha>
  )
}
