import { useState } from 'react'
import { useFinanceStore, CartaoCredito } from '../../lib/store'
import { formatBRL } from '../../lib/format'
import { Button } from '../ui/Button'
import { X, CreditCard, CheckCircle } from 'lucide-react'

interface Props {
  aberto: boolean
  aoFechar: () => void
  cartao: CartaoCredito | null
  mesAtual: string
}

export function ModalPagarFatura({ aberto, aoFechar, cartao, mesAtual }: Props) {
  const { contas, calcularFaturaCartao, pagarFatura } = useFinanceStore()

  const valorFatura = cartao ? calcularFaturaCartao(cartao.id, mesAtual) : 0
  const [contaId, setContaId] = useState(cartao?.contaPadraoDebitoId || contas[0]?.id || '')
  const [valorStr, setValorStr] = useState(valorFatura > 0 ? valorFatura.toFixed(2).replace('.', ',') : '')
  const [data, setData] = useState(new Date().toISOString().slice(0, 10))
  const [sucesso, setSucesso] = useState(false)

  if (!aberto || !cartao) return null

  const handlePagar = (e: React.FormEvent) => {
    e.preventDefault()
    const valorLimpo = valorStr.replace(/\./g, '').replace(',', '.')
    const valorNum = parseFloat(valorLimpo)
    if (isNaN(valorNum) || valorNum <= 0) return

    pagarFatura(cartao.id, contaId, valorNum, data)
    setSucesso(true)
    setTimeout(() => {
      setSucesso(false)
      aoFechar()
    }, 1200)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 bg-slate-50">
          <div className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-azul" />
            <h2 className="text-base font-bold text-marinho">Pagar Fatura do Cartão</h2>
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
            <h3 className="text-lg font-bold text-slate-900">Fatura Paga com Sucesso!</h3>
            <p className="text-sm text-slate-500">
              O débito foi lançado na sua conta e o limite do cartão restaurado.
            </p>
          </div>
        ) : (
          <form onSubmit={handlePagar} className="p-6 space-y-4">
            <div className="p-4 rounded-xl bg-slate-100 border border-slate-200 flex justify-between items-center">
              <div>
                <p className="text-xs text-slate-500 font-medium">Cartão de Crédito</p>
                <p className="text-base font-bold text-marinho">{cartao.nome}</p>
                <p className="text-xs text-slate-500">Vencimento: dia {cartao.diaVencimento}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-slate-500 font-medium">Fatura Atual</p>
                <p className="text-lg font-bold text-rose-600">{formatBRL(valorFatura)}</p>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
                Conta para Débito do Pagamento
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

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
                  Valor a Pagar (R$)
                </label>
                <input
                  type="text"
                  required
                  value={valorStr}
                  onChange={e => setValorStr(e.target.value)}
                  className="w-full h-11 px-3 text-sm font-semibold rounded-lg border border-slate-300 text-right"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
                  Data do Pagamento
                </label>
                <input
                  type="date"
                  value={data}
                  onChange={e => setData(e.target.value)}
                  className="w-full h-11 px-3 text-sm rounded-lg border border-slate-300"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
              <Button variante="secundario" onClick={aoFechar} type="button">
                Cancelar
              </Button>
              <Button variante="primario" type="submit">
                Confirmar Pagamento
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
