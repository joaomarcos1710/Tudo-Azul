import type { ReactNode } from 'react'
import { Aviso } from '../../components/ui/Aviso'
import { Card } from '../../components/ui/Card'
import { supabaseConfigurado } from '../../lib/supabase'
import { Marca } from '../../components/layout/Marca'
import { Versao } from '../../components/layout/Versao'
import { Autoria } from '../../components/layout/Autoria'

/** Moldura das telas de acesso: fundo marinho, marca e um cartão central. */
export function LayoutAuth({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-marinho px-4 py-10 pt-[max(2.5rem,env(safe-area-inset-top))]">
      <div className="mb-6 flex flex-col items-center gap-2">
        <Marca tamanho={44} claro />
        <p className="text-sm text-blue-100">Sua vida financeira em equilíbrio.</p>
      </div>
      <Card className="w-full max-w-sm">
        <h1 className="mb-5 text-xl font-bold">{titulo}</h1>
        {/* Sem as variáveis do Supabase os botões não teriam efeito: explica em vez de travar calado. */}
        {!supabaseConfigurado && (
          <div className="mb-4">
            <Aviso tipo="erro">
              Este ambiente ainda não está ligado ao banco de dados, então entrar e criar conta não funcionam aqui.
              Falta configurar <code>VITE_SUPABASE_URL</code> e <code>VITE_SUPABASE_PUBLISHABLE_KEY</code>.
            </Aviso>
          </div>
        )}
        {children}
      </Card>
      <Autoria className="mt-6 text-center text-slate-400" />
      <Versao className="mt-1 text-center text-slate-400" />
    </div>
  )
}
