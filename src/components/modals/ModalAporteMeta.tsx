import { useState } from 'react'
import { useFinanceStore, MetaSonho } from '../../lib/store'
import { formatBRL } from '../../lib/format'
import { Button } from '../ui/Button'
import { X, Sparkles, CheckCircle } from 'lucide-react'

interface Props {
  aberto: boolean
  aoFechar: () => void
  meta: MetaSonho | null
}

export function ModalAporteMeta({ aberto, aoFechar, meta }: Props) {
  const { contas, aportarMeta } = useFinanceStore()
  const [contaId, setContaId] = useState(contas[0]?.id || '')
  const [valorStr, setValorStr] = useState('')
  const [nota, setNota] = useState('')
  const [sucesso, setSucesso] = useState(false)

  if (!aberto || !meta) return null

  const handleAportar = (e: React.FormEvent) => {
    e.preventDefault()
    const valorLimpo = valorStr.replace(/\./g, '').replace(',', '.')
    const valorNum = parseFloat(valorLimpo)
    if (isNaN(valorNum) || valorNum <= 0) return

    aportarMeta(meta.id, valorNum, contaId || undefined, nota || undefined)
    setSucesso(true)
    setTimeout(() => {
      setSucesso(false)
      aoFechar()
    }, 1200)
  }

  const restante = Math.max(0, meta.valorAlvo - meta.valorAtual)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 bg-slate-50">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-amber-500" />
            <h2 className="text-base font-bold text-marinho">Guardar Dinheiro no Sonho</h2>
          </div>
          <button
            type="button"
            onClick={aoFechar}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200 transition"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {sucesso ? (
          <div className="p-8 text-center space-y-3">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
              <CheckCircle className="h-8 w-8" />
            </div>
            <h3 className="text-lg font-bold text-slate-900">Aporte Realizado!</h3>
            <p className="text-sm text-slate-500">
              Você está cada vez mais perto de realizar o seu sonho!
            </p>
          </div>
        ) : (
          <form onSubmit={handleAportar} className="p-6 space-y-4">
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
              <p className="text-xs text-slate-500 font-medium">Objetivo / Sonho</p>
              <p className="text-base font-bold text-marinho">{meta.titulo}</p>
              <div className="mt-2 flex justify-between text-xs text-slate-600">
                <span>Acumulado: {formatBRL(meta.valorAtual)}</span>
                <span className="font-semibold text-azul">Falta: {formatBRL(restante)}</span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
                De qual conta sairá o dinheiro?
              </label>
              <select
                value={contaId}
                onChange={e => setContaId(e.target.value)}
                className="w-full h-11 px-3 text-sm rounded-lg border border-slate-300 bg-white"
              >
                {contas.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.nome} ({c.instituicao})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
                Valor do Aporte (R$)
              </label>
              <input
                type="text"
                required
                placeholder="Ex: 500,00"
                value={valorStr}
                onChange={e => setValorStr(e.target.value)}
                className="w-full h-11 px-3 text-sm font-semibold rounded-lg border border-slate-300 text-right"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
                Nota / Comentário (opcional)
              </label>
              <input
                type="text"
                placeholder="Ex: Economia do mês, 13º salário, etc."
                value={nota}
                onChange={e => setNota(e.target.value)}
                className="w-full h-11 px-3 text-sm rounded-lg border border-slate-300"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
              <Button variante="secundario" onClick={aoFechar} type="button">
                Cancelar
              </Button>
              <Button variante="primario" type="submit">
                Confirmar Aporte
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
