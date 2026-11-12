import { useEffect, useState } from 'react'
import { Aviso } from './ui/Aviso'
import { Folha } from './ui/Folha'
import { RoscaCategorias } from './graficos/RoscaCategorias'
import type { BarraCategoria } from './graficos/BarrasCategorias'
import { listarCategoriasDaFatura } from '../lib/cartoes'
import type { CategoriaDaFatura } from '../lib/cartoes'
import type { Categoria } from '../lib/categorias'
import { mensagemErroBanco } from '../lib/erros'
import { formatBRL, formatMonth, primeiraMaiuscula } from '../lib/format'
import { IconeCategoria, visualPorId } from '../lib/visualCategoria'

/**
 * Folha "Categorias" da fatura do cartão: as despesas da fatura por categoria (rosca + lista + tabela). Tudo vem pronto do
 * banco (card_invoice_categories): o front só desenha, não soma. A leitura é isolada: se falhar, só a folha avisa e a
 * fatura continua funcionando. Os valores seguem a regra de "ocultar valores" (formatBRL).
 */
export function FolhaCategoriasFatura({ cartaoId, mes, categorias, aoFechar }: {
  cartaoId: string
  /** AAAA-MM da fatura. */
  mes: string
  categorias: Categoria[]
  aoFechar: () => void
}) {
  const [linhas, setLinhas] = useState<CategoriaDaFatura[] | null>(null)
  const [erro, setErro] = useState('')
  useEffect(() => {
    let vivo = true
    setLinhas(null)
    setErro('')
    listarCategoriasDaFatura(cartaoId, mes)
      .then((l) => { if (vivo) setLinhas(l) })
      .catch((err) => { if (vivo) setErro(mensagemErroBanco(err)) })
    return () => { vivo = false }
  }, [cartaoId, mes])

  const porId = new Map(categorias.map((c) => [c.id, c]))
  const fatias: BarraCategoria[] = (linhas ?? []).map((l) => ({ categoriaId: l.categoriaId, nome: l.nome, valor: l.valor, percentual: l.percentual }))
  const titulo = `Despesas por categoria na fatura de ${formatMonth(mes)}`

  return (
    <Folha titulo="Categorias da fatura" aoFechar={aoFechar}>
      <div data-testid="folha-categorias-fatura">
        {erro && <Aviso tipo="erro">Não foi possível carregar as categorias desta fatura. {erro} A fatura continua correta.</Aviso>}
        {!erro && linhas === null && <p className="text-sm text-slate-600" role="status">Carregando categorias…</p>}
        {!erro && linhas !== null && linhas.length === 0 && (
          <p className="text-sm text-slate-600" role="status">Esta fatura não tem compras com categoria. Estornos e reembolsos avulsos não entram aqui.</p>
        )}
        {!erro && linhas !== null && linhas.length > 0 && (
          <>
            <p className="mb-3 text-xs text-slate-500">
              {primeiraMaiuscula(formatMonth(mes))} · compras da fatura, líquidas de estornos. Não inclui créditos avulsos (contam como receita)
              nem assinaturas ainda não lançadas.
            </p>
            <RoscaCategorias fatias={fatias} mes={mes} destino={null} titulo={titulo}
              icone={(f) => <IconeCategoria visual={visualPorId(f.categoriaId, porId, 'expense')} tamanho="pequeno" />} />
            {/* o total é o do banco (soma das categorias), igual em todas as linhas: nada é somado aqui */}
            <p className="mt-3 flex items-baseline justify-between gap-3 border-t border-slate-100 pt-3 text-sm font-semibold text-slate-600">
              <span>Total das categorias</span>
              <span data-testid="total-categorias-fatura" className="whitespace-nowrap tabular-nums text-marinho">{formatBRL(linhas[0].total)}</span>
            </p>
          </>
        )}
      </div>
    </Folha>
  )
}
