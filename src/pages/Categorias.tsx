import { useCallback, useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Aviso } from '../components/ui/Aviso'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Folha } from '../components/ui/Folha'
import { Field } from '../components/ui/Field'
import { useFamilia } from '../lib/FamiliaContext'
import { agrupar, criarCategoria, definirCategoriaAtiva, definirCategoriaEventual, definirCategoriaNaoConsumo, editarCategoria, listarCategorias } from '../lib/categorias'
import type { Categoria, TipoCategoria } from '../lib/categorias'
import { mensagemErroBanco } from '../lib/erros'
import { CabecalhoPagina } from '../components/ui/CabecalhoPagina'
import { CORES, ICONES, IconeCategoria, sugerirVisual, visualDaCategoria } from '../lib/visualCategoria'
import type { ChaveIcone } from '../lib/visualCategoria'
import { SELO } from '../lib/cores'

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
  // faixa fixa embaixo (pedido do dono, 10/11/2026: "Editar e desativar não funcionam"): no celular, o retorno no topo da
  // página ficava fora da vista e parecia que o botão não fazia nada
  const [faixa, setFaixa] = useState<{ texto: string; erro?: boolean; desfazer?: () => void } | null>(null)
  useEffect(() => {
    if (!faixa) return
    const t = window.setTimeout(() => setFaixa(null), 8000)
    return () => window.clearTimeout(t)
  }, [faixa])

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

  async function alternarAtiva(c: Categoria, comDesfazer = true) {
    try {
      await definirCategoriaAtiva(c.id, !c.ativa)
      await carregar()
      setFaixa({
        texto: `${c.nome} ${c.ativa ? 'desativada' : 'reativada'}.`,
        desfazer: comDesfazer ? () => { void alternarAtiva({ ...c, ativa: !c.ativa }, false) } : undefined,
      })
    } catch (err) {
      setErro(mensagemErroBanco(err))
      setFaixa({ texto: mensagemErroBanco(err), erro: true })
    }
  }

  async function alternarNaoConsumo(c: Categoria) {
    try {
      await definirCategoriaNaoConsumo(c.id, !c.naoConsumo)
      await carregar()
      setFaixa({ texto: c.naoConsumo ? `${c.nome} volta a contar como consumo.` : `${c.nome} não conta mais como consumo.` })
    } catch (err) {
      setErro(mensagemErroBanco(err))
      setFaixa({ texto: mensagemErroBanco(err), erro: true })
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
        <Folha titulo={editando === 'nova' ? `Nova categoria de ${tipo === 'expense' ? 'despesa' : 'receita'}` : `Editar ${editando.nome}`}
          aoFechar={() => setEditando(null)}>
        <FormCategoria
          categoria={editando === 'nova' ? null : editando}
          tipo={tipo}
          possiveisPais={grupos.filter((g) => !g.sistema && (editando === 'nova' || g.id !== editando.id))}
          porId={porId}
          familiaId={familiaId}
          aoSalvar={async () => { setEditando(null); await carregar() }}
          aoCancelar={() => setEditando(null)}
          // as ações de cada categoria moram aqui (pedido do dono, 10/11/2026: a linha fica só com ícone e nome); fecham a
          // folha e o resultado aparece na faixa embaixo
          acoes={editando === 'nova' ? undefined : {
            herdaEventual: editando.paiId ? porId.get(editando.paiId)?.eventual === true : false,
            aoEventual: () => { const c = editando; setEditando(null); void alternarEventual(c) },
            aoNaoConsumo: () => { const c = editando; setEditando(null); void alternarNaoConsumo(c) },
            aoAlternar: () => { const c = editando; setEditando(null); void alternarAtiva(c) },
          }}
        />
        </Folha>
      )}

      {faixa && (
        <div role={faixa.erro ? 'alert' : 'status'}
          className={`fixed inset-x-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 flex items-center gap-3 rounded-xl px-4 py-3 text-sm shadow-card md:bottom-6 md:left-auto md:right-6 md:w-96 ${faixa.erro ? 'bg-prejuizo-fundo text-prejuizo' : 'bg-marinho text-white'}`}>
          <span className="min-w-0 flex-1">{faixa.texto}</span>
          {faixa.desfazer && (
            <button type="button" onClick={() => { const d = faixa.desfazer; setFaixa(null); d?.() }}
              className="min-h-11 shrink-0 rounded-lg px-3 font-semibold underline">Desfazer</button>
          )}
          <button type="button" aria-label="Fechar aviso" onClick={() => setFaixa(null)}
            className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-lg">
            <span aria-hidden="true">×</span>
          </button>
        </div>
      )}

      {tipo === 'income' && (
        <p className="mb-4 text-sm text-slate-600">
          Marque como <strong>eventual</strong> a receita que não se repete todo mês (13º, férias, PLR, restituição, FGTS).
          A Visão geral mostra se a renda <strong>regular</strong> cobre as despesas. Os totais do mês não mudam.
        </p>
      )}

      {categorias && (
        <p className="mb-4 text-sm text-slate-600">
          Marque <strong>Não conta como consumo</strong> no que não é gasto nem renda do dia a dia: quitação de dívida, dinheiro de
          empréstimo recebido, repasse entre familiares. A categoria sai da taxa de poupança, da reserva e do comprometimento do
          Início; os relatórios e o orçamento não mudam. Vale <strong>só para a categoria marcada</strong>: as subcategorias
          continuam contando, a não ser que você marque cada uma.
        </p>
      )}

      {categorias === null && !erro && <p className="text-sm text-slate-600" role="status">Carregando…</p>}

      <ul className="flex flex-col gap-3">
        {grupos.map((g) => (
          <li key={g.id}>
            <Card semPadding>
              <Linha categoria={g} porId={porId} aoAbrir={() => setEditando(g)} herdaEventual={false} />
              {g.filhas.length > 0 && (
                <ul className="border-t border-slate-100">
                  {g.filhas.map((f) => (
                    <li key={f.id} className="pl-6">
                      <Linha categoria={f} porId={porId} aoAbrir={() => setEditando(f)} herdaEventual={g.eventual} />
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

/**
 * Uma categoria na lista: só ícone, nome e selos (pedido do dono, 10/11/2026, como no Organizze). Tocar abre a folha de
 * edição, onde ficam também "Não conta como consumo", "eventual" e Desativar. "Sem categoria" não abre (o banco recusa).
 */
function Linha({ categoria: c, porId, aoAbrir, herdaEventual }: {
  categoria: Categoria; porId: Map<string, Categoria>; aoAbrir: () => void; herdaEventual: boolean
}) {
  const conteudo = (
    // desativada: nome em cinza neutro e ícone sem cor, sem opacidade no texto (a opacidade derrubava o contraste dos
    // selos abaixo de 4,5:1; auditoria 5h)
    <div className="flex min-w-0 flex-1 items-center justify-between gap-2" data-ativa={c.ativa}>
      <span className={`flex min-w-0 items-center gap-3 ${c.paiId ? 'text-sm' : 'font-semibold'} ${c.ativa ? '' : 'text-neutro'}`}>
        <span className={`flex shrink-0 ${c.ativa ? '' : 'grayscale'}`}><IconeCategoria visual={visualDaCategoria(c, porId)} tamanho={c.paiId ? 'pequeno' : 'normal'} /></span>
        <span className="min-w-0">
        {c.nome}
        {!c.ativa && <span className={`ml-2 rounded px-2 py-0.5 text-xs font-medium ${SELO.neutro}`}>desativada</span>}
        {c.sistema && <span className="ml-2 rounded bg-azul-claro px-2 py-0.5 text-xs font-medium text-marinho">padrão</span>}
        {(c.eventual || herdaEventual) && <span className={`ml-2 rounded px-2 py-0.5 text-xs font-medium ${SELO.neutro}`}>eventual{herdaEventual && !c.eventual ? ' (da principal)' : ''}</span>}
        {/* só a própria marca: a subcategoria não herda a da principal (decisão do dono, 06/11/2026) */}
        {c.naoConsumo && <span className={`ml-2 rounded px-2 py-0.5 text-xs font-medium ${SELO.neutro}`}>não conta como consumo</span>}
        </span>
      </span>
      {!c.sistema && <span aria-hidden="true" className="shrink-0 text-lg text-slate-400">›</span>}
    </div>
  )
  if (c.sistema) return <div className="flex min-h-14 items-center px-5 py-3">{conteudo}</div>
  return (
    <button type="button" onClick={aoAbrir} aria-label={`Editar ${c.nome}${c.ativa ? '' : ', desativada'}`}
      className="flex min-h-14 w-full items-center px-5 py-3 text-left hover:bg-slate-50 focus:outline focus:outline-2 focus:-outline-offset-2 focus:outline-azul">
      {conteudo}
    </button>
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
  /** Só ao editar: as ações que antes eram botões na linha. */
  acoes?: { herdaEventual: boolean; aoEventual: () => void; aoNaoConsumo: () => void; aoAlternar: () => void }
}

function FormCategoria({ categoria, tipo, possiveisPais, porId, familiaId, aoSalvar, aoCancelar, acoes }: PropsForm) {
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
    <>
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
      {categoria && acoes && !categoria.sistema && (
        <section aria-label="Mais opções" className="mt-6 flex flex-col gap-3 border-t border-slate-100 pt-4">
          {categoria.tipo === 'income' && (!acoes.herdaEventual || categoria.eventual) && (
            <div>
              <Button variante="secundario" onClick={acoes.aoEventual}>{categoria.eventual ? 'Marcar como regular' : 'Marcar como eventual'}</Button>
              <p className="mt-1 text-xs text-slate-500">Eventual: receita que não se repete todo mês (13º, férias, PLR).</p>
            </div>
          )}
          <div>
            <Button variante="secundario" aria-pressed={categoria.naoConsumo === true} onClick={acoes.aoNaoConsumo}>Não conta como consumo</Button>
            <p className="mt-1 text-xs text-slate-500">
              Para quitação de dívida, empréstimo recebido ou repasse entre familiares: sai da taxa de poupança, da reserva e do
              comprometimento do Início. Relatórios e orçamento não mudam.
            </p>
          </div>
          <div>
            <Button variante={categoria.ativa ? 'perigo' : 'secundario'} onClick={acoes.aoAlternar}>{categoria.ativa ? 'Desativar' : 'Reativar'}</Button>
          </div>
        </section>
      )}
    </>
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
