import type { ReactNode } from 'react'

type Tipo = 'info' | 'erro' | 'sucesso'
const estilos: Record<Tipo, string> = {
  info: 'bg-azul-claro text-marinho',
  erro: 'bg-negativo-fundo text-negativo',
  // sucesso = "está tudo certo": azul (#184); verde no app é só agendado
  sucesso: 'bg-lucro-fundo text-lucro',
}

/** Mensagem de estado (erro/sucesso/info). Erros usam role="alert". */
export function Aviso({ tipo = 'info', children }: { tipo?: Tipo; children: ReactNode }) {
  return (
    <div role={tipo === 'erro' ? 'alert' : 'status'} className={`rounded-lg px-4 py-3 text-sm ${estilos[tipo]}`}>
      {children}
    </div>
  )
}
