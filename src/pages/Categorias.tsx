import { useCallback, useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Aviso } from '../components/ui/Aviso'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Field } from '../components/ui/Field'
import { useFamilia } from '../lib/FamiliaContext'
import { agrupar, criarCategoria, definirCategoriaAtiva, definirCategoriaEventual, editarCategoria, listarCategorias } from '../lib/categorias'
import type { Categoria, TipoCategoria } from '../lib/categorias'
import { mensagemErroBanco } from '../lib/erros'
import { CabecalhoPagina } from '../components/ui/CabecalhoPagina'
import { CORES, ICONES, IconeCategoria, sugerirVisual, visualDaCategoria } from '../lib/visualCategoria'
import type { ChaveIcone } from '../lib/visualCategoria'

const abas: { tipo: TipoCategoria; rotulo: string }[] = [
  { tipo: 'expense', rotulo: 'Despesas' },
  { tipo: 'income', rotulo: 'Receitas' },
]

export default function Categorias() {
  const { familia } = useFamilia()
  const familiaId = familia?.id
  const [tipo, setTipo] = useState<TipoCategoria>('expense')
  const [categorias, setCategorias] = useState<Categoria[] | null>(null)
  const [erro, setErro] = useState('')
  // null = fechado; 'nova' = criando; Categoria = editando
  const [editando, setEditando] = useState<Categoria | 'nova' | null>(null)

  const carregar = useCallback(async () => {
    if (!familiaId) return
    try {
      setCategorias(await listarCategorias(familiaId, { comEventual: true }))
      setErro('')
    } catch (err) {
      setErro(mensagemErroBanco(err))
    }
  }, [familiaId])

  useEffect(() => { void carregar() }, [carregar])

  async function alternarAtiva(c: Categoria) {
    try {
      await definirCategoriaAtiva(c.id, !c.ativa)
      await carregar()
    } catch (err) {
      setErro(mensagemErroBanco(err))
    }
  }

  async function alternarEventual(c: Categoria) {
    try {
      await definirCategoriaEventual(c.id, !c.eventual)
      await carregar()
    } catch (err) {
      setErro(mensagemErroBanco(err))
    }
  }

  if (!familiaId) return null
  const grupos = categorias ? agrupar(categorias, tipo) : []
  const porId = new Map((categorias ?? []).map((c) => [c.id, c]))

  return (
    <>
      <CabecalhoPagina titulo="Categorias" descricao="Como as receitas e despesas da família são agrupadas nos relatórios e orçamentos."
        acoes={editando === null && <Button onClick={() => setEditando('nova')}>Nova categoria</Button>} />

      <div role="tablist" aria-label="Tipo de categoria" className="mb-4 inline-flex rounded-lg bg-slate-100 p-1">
        {abas.map((a) => (
          <button
            key={a.tipo}
            type="button"
            role="tab"
            aria-selected={tipo === a.tipo}
            onClick={() => { setTipo(a.tipo); setEditando(null) }}
            className={`min-h-11 rounded-md px-4 text-sm font-semibold ${tipo === a.tipo ? 'bg-white text-marinho shadow-card' : 'text-slate-600'}`}
          >
            {a.rotulo}
          </button>
        ))}
      </div>

      {erro && <div className="mb-4"><Aviso tipo="erro">{erro}</Aviso></div>}

      {editando !== null && categorias && (
        <FormCategoria
          categoria={editando === 'nova' ? null : editando}
          tipo={tipo}
          possiveisPais={grupos.filter((g) => !g.sistema && (editando === 'nova' || g.id !== editando.id))}
          porId={porId}
          familiaId={familiaId}
          aoSalvar={async () => { setEditando(null); await carregar() }}
          aoCancelar={() => setEditando(null)}
        />
      )}

      {tipo === 'income' && (
        <p className="mb-4 text-sm text-slate-600">
          Marque como <strong>eventual</strong> a receita que não se repete todo mês (13º, férias, PLR, restituição, FGTS).
          A Visão geral mostra se a renda <strong>regular</strong> cobre as despesas. Os totais do mês não mudam.
        </p>
      )}

      {categorias === null && !erro && <p className="text-sm text-slate-600" role="status">Carregando…</p>}

      <ul className="flex flex-col gap-3">
        {grupos.map((g) => (
          <li key={g.id}>
            <Card semPadding>
              <Linha categoria={g} porId={porId} aoEditar={() => setEditando(g)} aoAlternar={() => alternarAtiva(g)} aoEventual={() => alternarEventual(g)} herdaEventual={false} />
              {g.filhas.length > 0 && (
                <ul className="border-t border-slate-100">
                  {g.filhas.map((f) => (
                    <li key={f.id} className="pl-6">
                      <Linha categoria={f} porId={porId} aoEditar={() => setEditando(f)} aoAlternar={() => alternarAtiva(f)} aoEventual={() => alternarEventual(f)} herdaEventual={g.eventual} />
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </li>
        ))}
      </ul>
    </>
  )
}

function Linha({ categoria: c, porId, aoEditar, aoAlternar, aoEventual, herdaEventual }: {
  categoria: Categoria; porId: Map<string, Categoria>; aoEditar: () => void; aoAlternar: () => void; aoEventual: () => void; herdaEventual: boolean
}) {
  return (
    <div className={`flex flex-wrap items-center justify-between gap-2 px-5 py-3 ${c.ativa ? '' : 'opacity-70'}`}>
      <span className={`flex min-w-0 items-center gap-3 ${c.paiId ? 'text-sm' : 'font-semibold'}`}>
        <IconeCategoria visual={visualDaCategoria(c, porId)} tamanho={c.paiId ? 'pequeno' : 'normal'} />
        <span className="min-w-0">
        {c.nome}
        {!c.ativa && <span className="ml-2 rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">desativada</span>}
        {c.sistema && <span className="ml-2 rounded bg-azul-claro px-2 py-0.5 text-xs font-medium text-marinho">padrão</span>}
        {(c.eventual || herdaEventual) && <span className="ml-2 rounded bg-planejado-fundo px-2 py-0.5 text-xs font-medium text-planejado">eventual{herdaEventual && !c.eventual ? ' (da principal)' : ''}</span>}
        </span>
      </span>
      {!c.sistema && (
        <span className="flex gap-1">
          {c.tipo === 'income' && (!herdaEventual || c.eventual) && (
            <Button variante="fantasma" onClick={aoEventual}>{c.eventual ? 'Marcar como regular' : 'Marcar como eventual'}</Button>
          )}
          <Button variante="fantasma" onClick={aoEditar}>Editar</Button>
          <Button variante="fantasma" onClick={aoAlternar}>{c.ativa ? 'Desativar' : 'Reativar'}</Button>
        </span>
      )}
    </div>
  )
}

interface PropsForm {
  categoria: Categoria | null
  tipo: TipoCategoria
  possiveisPais: Categoria[]
  porId: Map<string, Categoria>
  familiaId: string
  aoSalvar: () => Promise<void>
  aoCancelar: () => void
}

function FormCategoria({ categoria, tipo, possiveisPais, porId, familiaId, aoSalvar, aoCancelar }: PropsForm) {
  const [nome, setNome] = useState(categoria?.nome ?? '')
  const [paiId, setPaiId] = useState<string>(categoria?.paiId ?? '')
  // null = automático (sugestão pelo nome, ou o da principal na subcategoria)
  const [icone, setIcone] = useState<string | null>(categoria?.icone ?? null)
  const [cor, setCor] = useState<string | null>(categoria?.cor ?? null)
  const mae = paiId ? porId.get(paiId) : undefined
  const automatico = mae ? visualDaCategoria(mae, porId) : sugerirVisual(nome, tipo)
  const previa = visualDaCategoria({ id: categoria?.id ?? '', nome, tipo, paiId: paiId || null, sistema: false, ativa: true, eventual: false, icone, cor }, porId)
  const [tentou, setTentou] = useState(false)
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function salvar(e: FormEvent) {
    e.preventDefault()
    setTentou(true)
    if (!nome.trim()) return
    setErro('')
    setEnviando(true)
    try {
      const pai = paiId || null
      if (categoria) await editarCategoria(categoria.id, { nome, paiId: pai, icone, cor })
      else await criarCategoria(familiaId, { nome, tipo, paiId: pai, icone, cor })
      await aoSalvar()
    } catch (err) {
      setErro(mensagemErroBanco(err))
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Card className="mb-6">
      <h2 className="mb-4 text-lg font-semibold">
        {categoria ? `Editar ${categoria.nome}` : `Nova categoria de ${tipo === 'expense' ? 'despesa' : 'receita'}`}
      </h2>
      <form onSubmit={salvar} className="grid gap-4 md:grid-cols-2" noValidate>
        {erro && <div className="md:col-span-2"><Aviso tipo="erro">{erro}</Aviso></div>}
        <Field rotulo="Nome" maxLength={60} value={nome} onChange={(e) => setNome(e.target.value)} erro={tentou && !nome.trim() ? 'Informe o nome.' : undefined} />
        <div className="flex flex-col gap-1">
          <label htmlFor="categoria-mae" className="text-sm font-medium">Dentro de (opcional)</label>
          <select
            id="categoria-mae"
            value={paiId}
            onChange={(e) => setPaiId(e.target.value)}
            className="min-h-11 rounded-lg border border-slate-500 bg-white px-3 text-base"
          >
            <option value="">Nenhuma (categoria principal)</option>
            {possiveisPais.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
          </select>
        </div>
        <fieldset className="md:col-span-2">
          <legend className="mb-2 flex items-center gap-2 text-sm font-medium">
            Ícone e cor <IconeCategoria visual={previa} tamanho="pequeno" />
          </legend>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Ícone">
            <BotaoEscolha ativo={icone === null} rotulo={mae ? 'Ícone igual ao da principal' : 'Ícone sugerido pelo nome'} aoEscolher={() => setIcone(null)}>
              <span className="text-xs font-semibold">Auto</span>
            </BotaoEscolha>
            {(Object.keys(ICONES) as ChaveIcone[]).map((k) => (
              <BotaoEscolha key={k} ativo={icone === k} rotulo={ICONES[k].rotulo} aoEscolher={() => setIcone(k)}>
                <IconeCategoria visual={{ icone: k, cor: cor ?? automatico.cor }} tamanho="pequeno" />
              </BotaoEscolha>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Cor">
            <BotaoEscolha ativo={cor === null} rotulo={mae ? 'Cor igual à da principal' : 'Cor sugerida pelo nome'} aoEscolher={() => setCor(null)}>
              <span className="text-xs font-semibold">Auto</span>
            </BotaoEscolha>
            {CORES.map((c) => (
              <BotaoEscolha key={c.hex} ativo={cor === c.hex} rotulo={c.rotulo} aoEscolher={() => setCor(c.hex)}>
                <span aria-hidden="true" className="h-7 w-7 rounded-full" style={{ backgroundColor: c.hex }} />
              </BotaoEscolha>
            ))}
          </div>
          <p className="mt-2 text-sm text-slate-600">
            {mae ? 'No automático, a subcategoria usa o ícone e a cor da principal.' : 'No automático, o app escolhe pelo nome. Escolha à mão se não combinar.'}
          </p>
        </fieldset>
        <p className="text-sm text-slate-600 md:col-span-2">
          Subcategorias têm um nível só. Orçamento vale para a categoria principal e soma as subcategorias dela.
        </p>
        <div className="flex gap-2 md:col-span-2">
          <Button type="submit" carregando={enviando}>{categoria ? 'Salvar' : 'Criar categoria'}</Button>
          <Button variante="secundario" onClick={aoCancelar}>Cancelar</Button>
        </div>
      </form>
    </Card>
  )
}

function BotaoEscolha({ ativo, rotulo, aoEscolher, children }: { ativo: boolean; rotulo: string; aoEscolher: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-pressed={ativo} aria-label={rotulo} title={rotulo} onClick={aoEscolher}
      className={`inline-flex h-11 min-w-11 items-center justify-center rounded-lg border-2 px-1 ${ativo ? 'border-azul bg-azul-claro' : 'border-transparent hover:bg-slate-100'}`}>
      {children}
    </button>
  )
}
