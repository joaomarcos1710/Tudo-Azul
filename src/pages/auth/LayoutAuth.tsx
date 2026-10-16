import type { ReactNode } from 'react'
import { Card } from '../../components/ui/Card'

/** Moldura das telas de acesso: fundo marinho, marca e um cartão central. */
export function LayoutAuth({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-marinho px-4 py-10">
      <p className="mb-6 text-2xl font-bold tracking-tight text-white">Tudo Azul</p>
      <Card className="w-full max-w-sm">
        <h1 className="mb-5 text-xl font-bold">{titulo}</h1>
        {children}
      </Card>
    </div>
  )
}
