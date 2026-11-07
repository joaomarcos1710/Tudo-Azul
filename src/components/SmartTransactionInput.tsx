import { useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { smartTransactionSchema } from '../lib/smartTransaction'
import type { SmartTransactionPrefill } from '../lib/smartTransaction'

interface Props {
  familiaId: string
  onPrefill: (dados: SmartTransactionPrefill) => void
  onFallback: () => void
}

/** Entrada em linguagem natural. A IA apenas sugere; o formulário normal continua responsável por gravar. */
export function SmartTransactionInput({ familiaId, onPrefill, onFallback }: Props) {
  const [texto, setTexto] = useState('')
  const [analisando, setAnalisando] = useState(false)

  async function analisar(evento: FormEvent) {
    evento.preventDefault()
    if (analisando || texto.trim().length < 3) return
    setAnalisando(true)
    const controller = new AbortController()
    const limite = window.setTimeout(() => controller.abort(), 10_000)
    try {
      if (!supabase) throw new Error('Supabase indisponível')
      const { data: sessao, error } = await supabase.auth.getSession()
      const token = sessao.session?.access_token
      if (error || !token) throw new Error('Sessão indisponível')

      const response = await fetch('/api/ai/parse-transaction', {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ text: texto.trim(), household_id: familiaId }),
      })
      if (!response.ok) throw new Error('Falha na análise')
      const resultado = smartTransactionSchema.safeParse(await response.json())
      if (!resultado.success) throw new Error('Resposta inválida')
      onPrefill(resultado.data)
    } catch {
      // Falha silenciosa: abre o formulário normal, sem bloquear o registo manual.
      onFallback()
    } finally {
      window.clearTimeout(limite)
      setAnalisando(false)
    }
  }

  return (
    <form onSubmit={analisar} aria-label="Lançamento inteligente" className="mb-4 rounded-xl border border-azul/20 bg-white p-3 shadow-sm sm:p-4">
      <label htmlFor="smart-transaction-text" className="mb-2 block text-sm font-semibold text-marinho">
        Lançamento inteligente
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          id="smart-transaction-text"
          type="text"
          value={texto}
          onChange={(evento) => setTexto(evento.target.value)}
          disabled={analisando}
          maxLength={500}
          placeholder="O que você gastou hoje? (ex: 50 reais de gasolina)"
          className="min-h-12 min-w-0 flex-1 rounded-lg border border-slate-300 px-4 text-base text-marinho placeholder:text-slate-400 focus:border-azul focus:outline-none focus:ring-2 focus:ring-azul/20 disabled:bg-slate-50"
        />
        <button
          type="submit"
          disabled={analisando || texto.trim().length < 3}
          className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-lg bg-azul px-5 text-sm font-semibold text-white transition-colors hover:bg-azul/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {analisando ? <><span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> A analisar...</>
            : <><span aria-hidden="true">✦</span> Preencher com IA</>}
        </button>
      </div>
      <p className="mt-2 text-xs text-slate-500" aria-live="polite">
        {analisando ? 'A analisar a frase. O lançamento só será gravado depois da sua confirmação.' : 'Revise os dados sugeridos antes de salvar.'}
      </p>
    </form>
  )
}
