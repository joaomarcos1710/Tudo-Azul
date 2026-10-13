import type { ButtonHTMLAttributes } from 'react'

type Variante = 'primario' | 'secundario' | 'perigo' | 'fantasma'

const estilos: Record<Variante, string> = {
  primario: 'bg-azul text-white hover:bg-blue-700 disabled:bg-blue-300',
  secundario: 'bg-white text-marinho border border-slate-300 hover:bg-azul-claro disabled:opacity-50',
  perigo: 'bg-negativo text-white hover:bg-red-800 disabled:opacity-50',
  fantasma: 'text-azul hover:bg-azul-claro disabled:opacity-50',
}

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: Variante
  carregando?: boolean
}

export function Button({ variante = 'primario', carregando, disabled, className = '', children, ...rest }: Props) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || carregando}
      aria-busy={carregando || undefined}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed ${estilos[variante]} ${className}`}
    >
      {carregando ? 'Aguarde…' : children}
    </button>
  )
}
