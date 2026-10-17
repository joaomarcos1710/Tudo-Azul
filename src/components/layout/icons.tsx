import type { ReactNode } from 'react'

function Icone({ children }: { children: ReactNode }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  )
}

export const IconeVisaoGeral = () => <Icone><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></Icone>
export const IconeLancamentos = () => <Icone><path d="M7 4v16M7 4 3 8M7 4l4 4M17 20V4M17 20l-4-4M17 20l4-4" /></Icone>
export const IconeContas = () => <Icone><rect x="2.5" y="6" width="19" height="13" rx="2" /><path d="M2.5 10h19M6.5 15h3" /></Icone>
export const IconeCategorias = () => <Icone><path d="M3 12V4h8l10 10-8 8L3 12Z" /><circle cx="7.5" cy="8.5" r="1" /></Icone>
export const IconeOrcamentos = () => <Icone><circle cx="12" cy="12" r="9" /><path d="M12 3v9l6 4" /></Icone>
export const IconeRelatorios = () => <Icone><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></Icone>
export const IconeFamilia = () => <Icone><circle cx="9" cy="8" r="3.2" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 11.5a3 3 0 1 0 0-6M18 14.2c1.7.8 3 2.6 3 5.8" /></Icone>
export const IconeCartoes = () => <Icone><rect x="2.5" y="5" width="19" height="14" rx="2" /><path d="M2.5 9.5h19M6 15h4M14 15h4" /></Icone>
