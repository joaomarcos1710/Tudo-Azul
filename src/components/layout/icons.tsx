import type { ReactNode } from 'react'

function Icone({ children, tamanho = 22 }: { children: ReactNode; tamanho?: number }) {
  return (
    <svg width={tamanho} height={tamanho} viewBox="0 0 24 24" fill="none" stroke="currentColor"
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
export const IconeExportar = () => <Icone><path d="M12 4v11M7 10l5 5 5-5M4 20h16" /></Icone>
export const IconeFamilia = () => <Icone><circle cx="9" cy="8" r="3.2" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 11.5a3 3 0 1 0 0-6M18 14.2c1.7.8 3 2.6 3 5.8" /></Icone>
export const IconeCartoes = () => <Icone><rect x="2.5" y="5" width="19" height="14" rx="2" /><path d="M2.5 9.5h19M6 15h4M14 15h4" /></Icone>
export const IconeRecorrentes = () => <Icone><path d="M17 2l4 4-4 4" /><path d="M3 11V9a3 3 0 0 1 3-3h15" /><path d="M7 22l-4-4 4-4" /><path d="M21 13v2a3 3 0 0 1-3 3H3" /></Icone>
export const IconeMais = () => <Icone><circle cx="5" cy="12" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="19" cy="12" r="1.4" /></Icone>
export const IconeOlho = () => <Icone><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></Icone>
export const IconeOlhoFechado = () => <Icone><path d="M3 3l18 18" /><path d="M10.6 6.1A9.6 9.6 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.5 6.9C3.9 8.6 2 12 2 12s3.6 7 10 7a9.7 9.7 0 0 0 4.1-.9" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></Icone>
export const IconeAnalises = () => <Icone><path d="M3 3v18h18" /><path d="M7 15l4-4 3 3 5-6" /></Icone>
export const IconeCalendario = () => <Icone><rect x="3" y="4.5" width="18" height="16.5" rx="2" /><path d="M3 9.5h18M8 2.5v4M16 2.5v4M7.5 13.5h2M11 13.5h2M14.5 13.5h2M7.5 17h2M11 17h2" /></Icone>
export const IconeSomar = () => <Icone><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></Icone>
export const IconeSubtrair = () => <Icone><circle cx="12" cy="12" r="9" /><path d="M8 12h8" /></Icone>
export const IconeTransferir = () => <Icone><path d="M4 8h14l-3.5-3.5M20 16H6l3.5 3.5" /></Icone>

export const IconeDividas = () => <Icone><path d="M4 5.5h16M4 12h16M4 18.5h10" /><circle cx="18" cy="18" r="3" /></Icone>

export const IconeInvestimentos = () => <Icone><path d="M3 19h18M5 16l4-5 3 3 6-8" /><path d="M15 6h3v3" /></Icone>

export const IconeBens = () => <Icone><path d="M3 10.5 12 3l9 7.5V21H3Z" /><path d="M9 21v-7h6v7M3 10.5h18" /></Icone>

/**
 * Cadeados da situação da fatura (#181, pedido do dono): aberto = fatura aberta; fechado = fechada; fechado com ✓ = paga;
 * fechado com ! = vencida. A forma muda em cada um (não depende só da cor); o rótulo acessível fica em quem usa.
 */
export const IconeCadeadoAberto = ({ tamanho }: { tamanho?: number }) => <Icone tamanho={tamanho}><rect x="4.5" y="11" width="15" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 7.7-1.5" /></Icone>
export const IconeCadeadoFechado = ({ tamanho }: { tamanho?: number }) => <Icone tamanho={tamanho}><rect x="4.5" y="11" width="15" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /><path d="M12 15v2" /></Icone>
export const IconeCadeadoPago = ({ tamanho }: { tamanho?: number }) => <Icone tamanho={tamanho}><rect x="4.5" y="11" width="15" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /><path d="m9 16 2 2 4-4" /></Icone>
export const IconeCadeadoVencido = ({ tamanho }: { tamanho?: number }) => <Icone tamanho={tamanho}><rect x="4.5" y="11" width="15" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /><path d="M12 13.5v3" /><path d="M12 18.6v.01" /></Icone>
