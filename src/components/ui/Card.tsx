import type { HTMLAttributes, ReactNode } from 'react'

export function Card({ className = '', ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div {...rest} className={`rounded-card bg-white p-5 shadow-card ${className}`} />
}

export function CardTitle({ children }: { children: ReactNode }) {
  return <h2 className="mb-3 text-sm font-semibold text-slate-500">{children}</h2>
}
