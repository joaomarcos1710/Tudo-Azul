import type { ButtonHTMLAttributes } from 'react'

type Variante = 'primario' | 'secundario' | 'perigo' | 'fantasma' | 'discreto' | 'pilula'

const estilos: Record<Variante, string> = {
  primario: 'bg-azul text-white hover:bg-blue-700 disabled:opacity-60',
  secundario: 'bg-white text-marinho border border-slate-300 hover:bg-azul-claro disabled:opacity-50',
  perigo: 'bg-negativo text-white hover:bg-negativo-escuro disabled:opacity-50',
  fantasma: 'text-azul hover:bg-azul-claro disabled:opacity-50',
  // ação destrutiva repetida em lista (Excluir): cinza em repouso, vermelha só no hover/foco
  discreto: 'text-slate-600 hover:bg-negativo-fundo hover:text-negativo focus-visible:text-negativo disabled:opacity-50',
  // ação curta e repetida em cada cartão (Ver fatura, Pagar fatura; #181): pílula azul-clara com texto azul da marca
  pilula: 'shrink-0 whitespace-nowrap rounded-full bg-azul-claro text-azul hover:bg-blue-100 disabled:opacity-50',
}

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: Variante
  carregando?: boolean
  /** Padding lateral menor (px-3), para fileiras de ações em lista no celular. Não use className com px-*: o px-4 venceria. */
  compacto?: boolean
}

export function Button({ variante = 'primario', carregando, compacto = false, disabled, className = '', children, ...rest }: Props) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || carregando}
      aria-busy={carregando || undefined}
      className={`inline-flex min-h-11 items-center justify-center gap-2 ${variante === 'pilula' ? '' : 'rounded-lg'} ${compacto ? 'px-3' : 'px-4'} text-sm font-semibold transition-colors disabled:cursor-not-allowed ${estilos[variante]} ${className}`}
    >
      {carregando ? 'Aguarde…' : children}
    </button>
  )
}
