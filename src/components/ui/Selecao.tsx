import { useId } from 'react'

/** Select com rótulo associado. opcoes: [valor, texto]; todos = opção vazia no topo (ex.: "Escolha…"). */
export function Selecao({ rotulo, valor, aoMudar, opcoes, todos, desabilitado }: {
  rotulo: string; valor: string; aoMudar: (v: string) => void; opcoes: [string, string][]; todos?: string; desabilitado?: boolean
}) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">{rotulo}</label>
      <select id={id} value={valor} onChange={(e) => aoMudar(e.target.value)} disabled={desabilitado}
        className="min-h-11 rounded-lg border border-slate-500 bg-white px-3 text-base disabled:bg-slate-100 disabled:text-slate-500">
        {todos !== undefined && <option value="">{todos}</option>}
        {opcoes.map(([v, r]) => <option key={v} value={v}>{r}</option>)}
      </select>
    </div>
  )
}
