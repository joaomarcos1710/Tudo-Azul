import { useId, useRef } from 'react'
import type { ReactNode } from 'react'
import { Selecao } from '../components/ui/Selecao'
import { useFocoPreso } from '../components/ui/useFocoPreso'
import { opcoesDeCategoria } from '../lib/categorias'
import type { Categoria } from '../lib/categorias'
import type { Cartao } from '../lib/cartoes'
import type { Conta } from '../lib/contas'
import type { Filtros, TipoLancamento } from '../lib/lancamentos'

/**
 * Tela de filtros dos lançamentos, em tela cheia (pedido do dono, 10/11/2026, como no Organizze): X e "Filtrar" no topo,
 * Tipo e Situação em chips, Contas e Cartões de crédito em cartões, Categoria no seletor. Cada toque vale na hora;
 * "Filtrar" só fecha a tela. Esc e o X também fecham; o Tab não sai dela.
 */
export function FiltrosLancamentos({ filtros, aoMudar, contas, cartoes, categorias, aoFechar }: {
  filtros: Filtros
  aoMudar: (f: Filtros) => void
  contas: Conta[]
  cartoes: Cartao[]
  categorias: Categoria[]
  aoFechar: () => void
}) {
  const painel = useRef<HTMLDivElement>(null)
  const corpo = useRef<HTMLDivElement>(null)
  const idTitulo = useId()
  // o primeiro chip (não o X): quem abriu os filtros quer mexer neles
  const prenderTab = useFocoPreso(painel, aoFechar, () => corpo.current?.querySelector<HTMLElement>('button'))

  const categoriasDoFiltro = filtros.tipo === 'transfer' ? [] : categorias.filter((c) => !filtros.tipo || c.tipo === filtros.tipo)

  // mesmo clique liga e desliga; mudar o tipo tira a categoria que não combina com ele
  function tipo(t: TipoLancamento) {
    const novo = filtros.tipo === t ? undefined : t
    const categoria = categorias.find((c) => c.id === filtros.categoriaId)
    const incompativel = novo === 'transfer' || (novo !== undefined && categoria !== undefined && categoria.tipo !== novo)
    aoMudar({ ...filtros, tipo: novo, categoriaId: incompativel ? undefined : filtros.categoriaId })
  }

  return (
    <div ref={painel} role="dialog" aria-modal="true" aria-labelledby={idTitulo} onKeyDown={prenderTab}
      className="fixed inset-0 z-50 flex flex-col bg-white">
      <div className="flex items-center justify-between px-4 py-3">
        <button type="button" aria-label="Fechar filtros" onClick={aoFechar}
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-2xl text-marinho hover:bg-azul-claro">
          <span aria-hidden="true">×</span>
        </button>
        <h2 id={idTitulo} className="sr-only">Filtrar lançamentos</h2>
        <button type="button" onClick={aoFechar} aria-label="Filtrar: ver os lançamentos"
          className="min-h-11 rounded-lg bg-azul-claro px-5 text-base font-semibold text-azul hover:ring-1 hover:ring-azul">
          Filtrar
        </button>
      </div>

      <div ref={corpo} className="flex-1 overflow-y-auto px-4 pb-8">
        <Grupo titulo={`Tipo${filtros.tipo || filtros.soFixos || filtros.soParcelados ? ` (${[filtros.tipo, filtros.soFixos, filtros.soParcelados].filter(Boolean).length})` : ''}`}>
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
        </Grupo>

        <Grupo titulo="Situação">
          <Chips>
            <Chip pressionado={filtros.situacao === 'paid'} onClick={() => aoMudar({ ...filtros, situacao: filtros.situacao === 'paid' ? undefined : 'paid' })}>
              Resolvido
            </Chip>
            <Chip pressionado={filtros.situacao === 'planned'} onClick={() => aoMudar({ ...filtros, situacao: filtros.situacao === 'planned' ? undefined : 'planned' })}>
              Pendente
            </Chip>
          </Chips>
        </Grupo>

        <Grupo titulo="Contas">
          <Cartoes>
            {contas.map((c) => (
              <CartaoFiltro key={c.id} pressionado={filtros.contaId === c.id} nome={c.nome}
                onClick={() => aoMudar({ ...filtros, contaId: filtros.contaId === c.id ? undefined : c.id })} />
            ))}
          </Cartoes>
        </Grupo>

        <Grupo titulo="Cartões de crédito">
          <Cartoes>
            {cartoes.map((c) => (
              <CartaoFiltro key={c.id} pressionado={filtros.cartaoId === c.id} nome={c.nome}
                onClick={() => aoMudar({ ...filtros, cartaoId: filtros.cartaoId === c.id ? undefined : c.id })} />
            ))}
          </Cartoes>
        </Grupo>

        <div className="mt-6">
          <Selecao rotulo="Filtrar por categoria" valor={filtros.categoriaId ?? ''}
            aoMudar={(v) => aoMudar({ ...filtros, categoriaId: v || undefined })}
            opcoes={opcoesDeCategoria(categoriasDoFiltro, categorias).map((o) => [o.id, filtros.tipo ? o.rotulo : `${o.rotulo} (${categorias.find((c) => c.id === o.id)?.tipo === 'income' ? 'receita' : 'despesa'})`])}
            todos={filtros.tipo === 'transfer' ? 'Transferência não tem categoria' : 'Todas as categorias'}
            desabilitado={filtros.tipo === 'transfer'} />
        </div>

        <button type="button" onClick={() => aoMudar({})} disabled={!Object.values(filtros).some((v) => v !== undefined)}
          className="mt-6 min-h-11 text-sm font-semibold text-azul hover:underline disabled:text-slate-400 disabled:no-underline">
          Limpar filtros
        </button>
      </div>
    </div>
  )
}

function Grupo({ titulo, children }: { titulo: string; children: ReactNode }) {
  const id = useId()
  return (
    <section role="group" aria-labelledby={id} className="mt-6">
      <h3 id={id} className="mb-3 text-base font-semibold text-marinho">{titulo}</h3>
      {children}
    </section>
  )
}

function Chips({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-2">{children}</div>
}

function Chip({ pressionado, onClick, children }: { pressionado: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-pressed={pressionado} onClick={onClick}
      className={`min-h-11 rounded-full border px-4 text-sm font-semibold transition-colors ${pressionado
        ? 'border-azul bg-azul text-white'
        : 'border-slate-300 bg-white text-marinho hover:border-azul'}`}>
      {children}
    </button>
  )
}

function Cartoes({ children }: { children: ReactNode }) {
  return <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1">{children}</div>
}

function CartaoFiltro({ pressionado, nome, onClick }: { pressionado: boolean; nome: string; onClick: () => void }) {
  return (
    <button type="button" aria-pressed={pressionado} onClick={onClick}
      className={`flex min-h-14 min-w-44 shrink-0 snap-start items-center rounded-xl border px-4 text-left text-base font-semibold text-marinho transition-colors ${pressionado
        ? 'border-azul bg-azul-claro ring-2 ring-azul'
        : 'border-slate-200 bg-white hover:border-azul'}`}>
      {nome}
    </button>
  )
}
