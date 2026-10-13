import type { ReactNode } from 'react'

type Tipo = 'info' | 'erro' | 'sucesso'
const estilos: Record<Tipo, string> = {
  info: 'bg-azul-claro text-marinho',
  erro: 'bg-red-50 text-negativo',
  sucesso: 'bg-green-50 text-positivo',
}

/** Mensagem de estado (erro/sucesso/info). Erros usam role="alert". */
export function Aviso({ tipo = 'info', children }: { tipo?: Tipo; children: ReactNode }) {
  return (
    <div role={tipo === 'erro' ? 'alert' : 'status'} className={`rounded-lg px-4 py-3 text-sm ${estilos[tipo]}`}>
      {children}
    </div>
  )
}
