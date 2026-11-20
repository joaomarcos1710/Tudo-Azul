import { useId } from 'react'
import type { ChangeEvent, InputHTMLAttributes } from 'react'
import { mascararValor } from '../../lib/format'

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  rotulo: string
  erro?: string
  /**
   * Campo de dinheiro com os centavos entrando da direita (`mascararValor`): só se digitam os números, no teclado numérico
   * (que no iPad não tem vírgula nem ponto). Quem usa continua lendo `e.target.value` e passando para `parseBRL`.
   */
  valorEmReais?: boolean
}

/** Campo com rótulo associado, mensagem de erro anunciada por leitores de tela. */
export function Field({ rotulo, erro, valorEmReais = false, className = '', onChange, inputMode, ...rest }: Props) {
  const id = useId()
  const erroId = `${id}-erro`
  function aoMudar(e: ChangeEvent<HTMLInputElement>) {
    // o texto formatado entra no próprio evento: quem escuta lê `e.target.value` já com a máscara
    if (valorEmReais) e.target.value = mascararValor(e.target.value)
    onChange?.(e)
  }
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">{rotulo}</label>
      <input
        {...rest}
        id={id}
        inputMode={valorEmReais ? 'numeric' : inputMode}
        onChange={aoMudar}
        aria-invalid={erro ? true : undefined}
        aria-describedby={erro ? erroId : undefined}
        className={`min-h-11 rounded-lg border bg-white px-3 text-base ${erro ? 'border-negativo' : 'border-slate-500'} ${className}`}
      />
      {erro && <p id={erroId} role="alert" className="text-sm text-negativo">{erro}</p>}
    </div>
  )
}
