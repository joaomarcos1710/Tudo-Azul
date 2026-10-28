import type { HTMLAttributes, ReactNode } from 'react'

/**
 * Painel branco. `semPadding` para listas que encostam na borda (cada linha traz o seu padding):
 * passar "p-0" em className não funciona, porque p-5 e p-0 ficam juntos e o p-5 vence no CSS do Tailwind.
 */
export function Card({ className = '', semPadding = false, ...rest }: HTMLAttributes<HTMLDivElement> & { semPadding?: boolean }) {
  return <div {...rest} className={`rounded-card bg-white shadow-card ${semPadding ? '' : 'p-5'} ${className}`} />
}

export function CardTitle({ children }: { children: ReactNode }) {
  return <h2 className="mb-3 text-sm font-semibold text-slate-500">{children}</h2>
}
