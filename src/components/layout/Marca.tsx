import { MARCA } from '../../lib/cores'

/** Logo do Tudo Azul: o "T" com o losango celeste (mesmo desenho de public/favicon.svg). */
export function Simbolo({ tamanho = 32, contorno = false }: { tamanho?: number; contorno?: boolean }) {
  return (
    <svg width={tamanho} height={tamanho} viewBox="0 0 100 100" aria-hidden="true" className="shrink-0">
      {/* sobre fundo marinho, o contorno mantém a forma do ícone visível */}
      <rect width="100" height="100" rx="22" fill={MARCA.marinho} stroke={contorno ? 'rgba(255,255,255,0.22)' : 'none'} strokeWidth="3" />
      <path d="M29 32h43v10H56v28H46V42H29z" fill="#FFFFFF" />
      <path d="M68 44l10 10-10 10-10-10z" fill={MARCA.celeste} />
    </svg>
  )
}

/** Símbolo + nome em minúsculas, como na identidade visual. */
export function Marca({ tamanho = 32, claro = false }: { tamanho?: number; claro?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <Simbolo tamanho={tamanho} contorno={claro} />
      <span className={`text-xl font-bold tracking-tight ${claro ? 'text-white' : 'text-marinho'}`}>tudo azul</span>
    </span>
  )
}
