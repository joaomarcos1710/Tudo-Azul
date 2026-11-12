import { useId, useState } from 'react'

/**
 * Nota do topo de Investimentos (etapa 1 do redesenho, pedido do dono de 12/11/2026): antes era um aviso azul de
 * largura toda e três linhas de texto; agora é uma linha, e o detalhe abre por um botão (aria-expanded). Texto só de
 * explicação: nenhuma regra nem número mudou.
 */
export function NotaCarteira() {
  const [aberta, setAberta] = useState(false)
  const id = useId()
  return (
    <div className="rounded-lg bg-azul-claro px-4 text-sm text-marinho">
      <div className="flex items-center justify-between gap-3">
        <p className="py-2">Cada moeda é contada à parte, sem conversão entre elas.</p>
        <button type="button" aria-expanded={aberta} aria-controls={id} onClick={() => setAberta((v) => !v)}
          className="min-h-11 shrink-0 rounded-lg px-2 font-semibold text-azul hover:underline">
          {aberta ? 'Mostrar menos' : 'Como funciona'}
        </button>
      </div>
      {aberta && (
        <p id={id} className="pb-3">
          Compras, vendas e avaliações em BRL, USD ou EUR, separadas por moeda e sem conversão. Ao escolher a conta numa compra ou venda em reais, o dinheiro sai ou volta como transferência para a carteira, sem virar despesa nem receita. O valor de mercado vem das avaliações; nos ativos que acompanham a bolsa, vem da cotação diária da B3.
        </p>
      )}
    </div>
  )
}
