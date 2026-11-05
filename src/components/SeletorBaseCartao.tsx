import { BASES_GASTOS_CARTAO } from '../lib/baseGastosCartao'
import type { BaseGastosCartao } from '../lib/baseGastosCartao'

/**
 * "Gastos de cartão com base na: Data da fatura · Data da compra · Data da parcela" (como no Organizze).
 * Grupo de rádios (setas do teclado trocam a opção), com a explicação da base escolhida e o aviso de que totais e
 * orçamento continuam pela fatura.
 */
export function SeletorBaseCartao({ valor, onChange }: { valor: BaseGastosCartao; onChange: (b: BaseGastosCartao) => void }) {
  const escolhida = BASES_GASTOS_CARTAO.find((b) => b.chave === valor) ?? BASES_GASTOS_CARTAO[0]
  return (
    <fieldset className="mb-3" aria-describedby="base-cartao-explicacao">
      <legend className="mb-1 text-sm font-medium">Gastos de cartão com base na:</legend>
      <div className="flex flex-wrap gap-2">
        {BASES_GASTOS_CARTAO.map((b) => (
          <label key={b.chave} className="relative">
            <input type="radio" name="base-gastos-cartao" value={b.chave} checked={valor === b.chave}
              onChange={() => onChange(b.chave)} className="peer sr-only" />
            <span className={`inline-flex min-h-11 cursor-pointer items-center rounded-full border px-4 text-sm font-semibold peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-azul ${
              valor === b.chave ? 'border-azul bg-azul-claro text-marinho' : 'border-slate-300 text-slate-600'}`}>
              {b.rotulo}
            </span>
          </label>
        ))}
      </div>
      <p id="base-cartao-explicacao" className="mt-2 text-xs text-slate-600">
        {escolhida.explicacao} Totais do mês e orçamento seguem a data da fatura.
      </p>
    </fieldset>
  )
}
