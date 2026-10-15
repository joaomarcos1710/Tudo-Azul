import type { ReactNode } from 'react'

function Icone({ children }: { children: ReactNode }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  )
}

export const IconeVisaoGeral = () => <Icone><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></Icone>
export const IconeLancamentos = () => <Icone><path d="M7 4v16M7 4 3 8M7 4l4 4M17 20V4M17 20l-4-4M17 20l4-4" /></Icone>
export const IconeContas = () => <Icone><rect x="2.5" y="6" width="19" height="13" rx="2" /><path d="M2.5 10h19M6.5 15h3" /></Icone>
export const IconeFluxo = () => <Icone><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></Icone>
export const IconeBens = () => <Icone><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></Icone>
export const IconeInvestimentos = () => <Icone><polyline points="22 7 13.5 15.5 8.5 10.5 2 17" /><polyline points="16 7 22 7 22 13" /></Icone>
export const IconeEmprestimos = () => <Icone><rect width="20" height="14" x="2" y="5" rx="2" /><line x1="2" x2="22" y1="10" y2="10" /></Icone>
export const IconeCategorias = () => <Icone><path d="M3 12V4h8l10 10-8 8L3 12Z" /><circle cx="7.5" cy="8.5" r="1" /></Icone>
export const IconeOrcamentos = () => <Icone><circle cx="12" cy="12" r="9" /><path d="M12 3v9l6 4" /></Icone>
export const IconeMetas = () => <Icone><circle cx="12" cy="12" r="10" /><path d="m9 12 2 2 4-4" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></Icone>
export const IconeRelatorios = () => <Icone><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></Icone>
export const IconeCalendario = () => <Icone><rect width="18" height="18" x="3" y="4" rx="2" /><line x1="16" x2="16" y1="2" y2="6" /><line x1="8" x2="8" y1="2" y2="6" /><line x1="3" x2="21" y1="10" y2="10" /></Icone>
export const IconeFamilia = () => <Icone><circle cx="9" cy="8" r="3.2" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 11.5a3 3 0 1 0 0-6M18 14.2c1.7.8 3 2.6 3 5.8" /></Icone>
