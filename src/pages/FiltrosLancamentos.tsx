import { Selecao } from '../components/ui/Selecao'
import { CartaoFiltro, CartoesFiltro, Chip, Chips, GrupoFiltro, TelaFiltros } from '../components/ui/TelaFiltros'
import { opcoesDeCategoria } from '../lib/categorias'
import type { Categoria } from '../lib/categorias'
import type { Cartao } from '../lib/cartoes'
import type { Conta } from '../lib/contas'
import type { Filtros, TipoLancamento } from '../lib/lancamentos'

/**
 * Tela de filtros dos lançamentos (pedido do dono, 10/11/2026, como no Organizze). Cada toque vale na hora; "Filtrar" só
 * fecha a tela. A casca e os chips são compartilhados (components/ui/TelaFiltros).
 */
export function FiltrosLancamentos({ filtros, aoMudar, contas, cartoes, categorias, aoFechar }: {
  filtros: Filtros
  aoMudar: (f: Filtros) => void
  contas: Conta[]
  cartoes: Cartao[]
  categorias: Categoria[]
  aoFechar: () => void
}) {
  const categoriasDoFiltro = filtros.tipo === 'transfer' ? [] : categorias.filter((c) => !filtros.tipo || c.tipo === filtros.tipo)

  // mesmo clique liga e desliga; mudar o tipo tira a categoria que não combina com ele
  function tipo(t: TipoLancamento) {
    const novo = filtros.tipo === t ? undefined : t
    const categoria = categorias.find((c) => c.id === filtros.categoriaId)
    const incompativel = novo === 'transfer' || (novo !== undefined && categoria !== undefined && categoria.tipo !== novo)
    aoMudar({ ...filtros, tipo: novo, categoriaId: incompativel ? undefined : filtros.categoriaId })
  }

  const ligados = [filtros.tipo, filtros.soFixos, filtros.soParcelados].filter(Boolean).length

  return (
    <TelaFiltros titulo="Filtrar lançamentos" aoFechar={aoFechar}
      acaoPrincipal={{ rotulo: 'Filtrar', nomeAcessivel: 'Filtrar: ver os lançamentos', aoAcionar: aoFechar }}
      rodape={<button type="button" onClick={() => aoMudar({})} disabled={!Object.values(filtros).some((v) => v !== undefined)}
        className="min-h-11 text-sm font-semibold text-azul hover:underline disabled:text-slate-400 disabled:no-underline">
        Limpar filtros
      </button>}>
      <GrupoFiltro titulo={`Tipo${ligados ? ` (${ligados})` : ''}`}>
        <Chips>
          <Chip pressionado={filtros.tipo === 'income'} onClick={() => tipo('income')}>Receitas</Chip>
          <Chip pressionado={filtros.tipo === 'expense'} onClick={() => tipo('expense')}>Despesas</Chip>
          <Chip pressionado={filtros.tipo === 'transfer'} onClick={() => tipo('transfer')}>Transferências</Chip>
          <Chip pressionado={filtros.soFixos === true} onClick={() => aoMudar({ ...filtros, soFixos: filtros.soFixos ? undefined : true })}>
            Lançamentos fixos
          </Chip>
          <Chip pressionado={filtros.soParcelados === true} onClick={() => aoMudar({ ...filtros, soParcelados: filtros.soParcelados ? undefined : true })}>
            Lançamentos parcelados
          </Chip>
        </Chips>
      </GrupoFiltro>

      <GrupoFiltro titulo="Situação">
        <Chips>
          <Chip pressionado={filtros.situacao === 'paid'} onClick={() => aoMudar({ ...filtros, situacao: filtros.situacao === 'paid' ? undefined : 'paid' })}>
            Resolvido
          </Chip>
          <Chip pressionado={filtros.situacao === 'planned'} onClick={() => aoMudar({ ...filtros, situacao: filtros.situacao === 'planned' ? undefined : 'planned' })}>
            Pendente
          </Chip>
        </Chips>
      </GrupoFiltro>

      <GrupoFiltro titulo="Contas">
        <CartoesFiltro>
          {contas.map((c) => (
            <CartaoFiltro key={c.id} pressionado={filtros.contaId === c.id} nome={c.nome}
              onClick={() => aoMudar({ ...filtros, contaId: filtros.contaId === c.id ? undefined : c.id })} />
          ))}
        </CartoesFiltro>
      </GrupoFiltro>

      <GrupoFiltro titulo="Cartões de crédito">
        <CartoesFiltro>
          {cartoes.map((c) => (
            <CartaoFiltro key={c.id} pressionado={filtros.cartaoId === c.id} nome={c.nome}
              onClick={() => aoMudar({ ...filtros, cartaoId: filtros.cartaoId === c.id ? undefined : c.id })} />
          ))}
        </CartoesFiltro>
      </GrupoFiltro>

      <div className="mt-6">
        <Selecao rotulo="Filtrar por categoria" valor={filtros.categoriaId ?? ''}
          aoMudar={(v) => aoMudar({ ...filtros, categoriaId: v || undefined })}
          opcoes={opcoesDeCategoria(categoriasDoFiltro, categorias).map((o) => [o.id, filtros.tipo ? o.rotulo : `${o.rotulo} (${categorias.find((c) => c.id === o.id)?.tipo === 'income' ? 'receita' : 'despesa'})`])}
          todos={filtros.tipo === 'transfer' ? 'Transferência não tem categoria' : 'Todas as categorias'}
          desabilitado={filtros.tipo === 'transfer'} />
      </div>
    </TelaFiltros>
  )
}
