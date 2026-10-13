import { useId } from 'react'
import type { InputHTMLAttributes } from 'react'

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  rotulo: string
  erro?: string
}

/** Campo com rótulo associado, mensagem de erro anunciada por leitores de tela. */
export function Field({ rotulo, erro, className = '', ...rest }: Props) {
  const id = useId()
  const erroId = `${id}-erro`
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">{rotulo}</label>
      <input
        {...rest}
        id={id}
        aria-invalid={erro ? true : undefined}
        aria-describedby={erro ? erroId : undefined}
        className={`min-h-11 rounded-lg border bg-white px-3 text-base ${erro ? 'border-negativo' : 'border-slate-300'} ${className}`}
      />
      {erro && <p id={erroId} role="alert" className="text-sm text-negativo">{erro}</p>}
    </div>
  )
}
