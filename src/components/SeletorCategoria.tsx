import { useId, useState } from 'react'
import type { FormEvent } from 'react'
import { Folha } from './ui/Folha'
import { useFamilia } from '../lib/FamiliaContext'
import { criarCategoriaRapida, opcoesDeCategoria } from '../lib/categorias'
import type { Categoria, TipoCategoria } from '../lib/categorias'
import { mensagemErroBanco } from '../lib/erros'
import { IconeCategoria, visualDaCategoria } from '../lib/visualCategoria'

/**
 * Seletor de categoria (pedido do dono, 10/11/2026, como no Organizze): um botão com o ícone e o nome da escolhida abre
 * uma folha com busca, lista ou grade, a principal com as subcategorias embaixo e "Criar categoria". Substitui o
 * seletor nativo nos formulários de lançamento, compra no cartão e recorrente.
 *
 * `opcoes` é a lista já filtrada por quem usa (tipo, ativas): a mesma que o seletor nativo recebia.
 */
export function SeletorCategoria({ id, rotulo, rotuloVisivel = true, valor, aoMudar, opcoes, categorias, tipo, aoCriada, classeBotao }: {
  id?: string
  rotulo: string
  /** false quando quem usa já tem um <label htmlFor={id}> (a linha do formulário de lançamento). */
  rotuloVisivel?: boolean
  valor: string
  aoMudar: (id: string) => void
  opcoes: Categoria[]
  categorias: Categoria[]
  tipo: TipoCategoria
  /** Com ela, aparece "Criar categoria"; quem usa acrescenta a nova à sua lista. */
  aoCriada?: (c: Categoria) => void
  classeBotao?: string
}) {
  const idProprio = useId()
  const idBotao = id ?? idProprio
  const [aberta, setAberta] = useState(false)
  const porId = new Map(categorias.map((c) => [c.id, c]))
  const escolhida = valor ? porId.get(valor) : undefined

  return (
    <div className={rotuloVisivel ? 'flex flex-col gap-1' : 'min-w-0'}>
      {rotuloVisivel && <label htmlFor={idBotao} className="text-sm font-medium">{rotulo}</label>}
      <button id={idBotao} type="button" aria-haspopup="dialog" aria-expanded={aberta} data-valor={valor} onClick={() => setAberta(true)}
        className={classeBotao ?? 'flex min-h-11 items-center gap-2 rounded-lg border border-slate-500 bg-white px-3 text-left text-base'}>
        {escolhida && <IconeCategoria visual={visualDaCategoria(escolhida, porId)} tamanho="pequeno" />}
        <span className={`min-w-0 truncate ${escolhida ? '' : 'text-slate-500'}`}>{escolhida?.nome ?? 'Escolher'}</span>
      </button>
      {aberta && (
        <FolhaCategorias opcoes={opcoes} categorias={categorias} porId={porId} tipo={tipo} valor={valor} aoCriada={aoCriada}
          aoEscolher={(c) => { aoMudar(c); setAberta(false) }} aoFechar={() => setAberta(false)} />
      )}
    </div>
  )
}

function FolhaCategorias({ opcoes, categorias, porId, tipo, valor, aoEscolher, aoCriada, aoFechar }: {
  opcoes: Categoria[]; categorias: Categoria[]; porId: Map<string, Categoria>; tipo: TipoCategoria; valor: string
  aoEscolher: (id: string) => void; aoCriada?: (c: Categoria) => void; aoFechar: () => void
}) {
  const { familia } = useFamilia()
  const [busca, setBusca] = useState('')
  const [modo, setModo] = useState<'lista' | 'grade'>('lista')
  const [criando, setCriando] = useState(false)
  const [nome, setNome] = useState('')
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  const idNome = useId()

  // mesma ordem do seletor nativo: principal e, logo abaixo, as subcategorias dela
  const termo = busca.trim().toLocaleLowerCase('pt-BR')
  const itens = opcoesDeCategoria(opcoes, categorias)
    .map((o) => porId.get(o.id))
    .filter((c): c is Categoria => c !== undefined)
    .filter((c) => !termo || c.nome.toLocaleLowerCase('pt-BR').includes(termo)
      || (c.paiId !== null && (porId.get(c.paiId)?.nome ?? '').toLocaleLowerCase('pt-BR').includes(termo)))

  async function criar(e: FormEvent) {
    e.preventDefault()
    if (!nome.trim()) { setErro('Informe o nome.'); return }
    if (!familia) return
    setEnviando(true)
    setErro('')
    try {
      const nova = await criarCategoriaRapida(familia.id, nome, tipo)
      aoCriada?.(nova)
      aoEscolher(nova.id)
    } catch (err) {
      setErro(mensagemErroBanco(err))
    } finally {
      setEnviando(false)
    }
  }

  const botaoModo = (m: 'lista' | 'grade', rotulo: string, icone: string) => (
    <button type="button" aria-pressed={modo === m} aria-label={rotulo} title={rotulo} onClick={() => setModo(m)}
      className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-xl ${modo === m ? 'bg-azul-claro text-azul' : 'text-slate-400 hover:bg-slate-100'}`}>
      <span aria-hidden="true">{icone}</span>
    </button>
  )

  return (
    <Folha titulo="Selecionar uma categoria" aoFechar={aoFechar}>
      <div className="mb-3 flex items-center gap-2">
        <input type="search" aria-label="Buscar uma categoria" placeholder="Buscar uma categoria" value={busca}
          onChange={(e) => setBusca(e.target.value)} className="min-h-11 min-w-0 flex-1 rounded-lg border border-slate-300 px-3 text-base" />
        <div role="group" aria-label="Modo de exibição" className="flex">
          {botaoModo('lista', 'Lista', '☰')}
          {botaoModo('grade', 'Grade', '▦')}
        </div>
      </div>

      {aoCriada && (criando ? (
        <form onSubmit={(e) => void criar(e)} className="mb-3 flex flex-col gap-2 rounded-lg border border-slate-200 p-3">
          <label htmlFor={idNome} className="text-sm font-medium">Nome da nova categoria</label>
          <input id={idNome} value={nome} maxLength={40} onChange={(e) => setNome(e.target.value)} autoFocus
            className="min-h-11 rounded-lg border border-slate-500 px-3 text-base" />
          {erro && <p role="alert" className="text-sm text-negativo">{erro}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={enviando} className="min-h-11 rounded-lg bg-azul px-4 text-sm font-semibold text-white disabled:opacity-50">
              {enviando ? 'Criando…' : 'Criar'}
            </button>
            <button type="button" onClick={() => { setCriando(false); setErro('') }} className="min-h-11 rounded-lg px-4 text-sm font-semibold text-azul">Cancelar</button>
          </div>
        </form>
      ) : null)}

      {itens.length === 0 && <p className="py-4 text-sm text-slate-500">Nenhuma categoria com esse nome.</p>}

      {modo === 'lista' ? (
        <ul className="flex flex-col">
          {aoCriada && !criando && (
            <li>
              <button type="button" onClick={() => { setCriando(true); setNome(busca.trim()) }}
                className="flex min-h-12 w-full items-center gap-3 rounded-lg px-2 text-left text-base text-slate-600 hover:bg-slate-50">
                <span aria-hidden="true" className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-lg">+</span>
                Criar categoria
              </button>
            </li>
          )}
          {itens.map((c) => (
            <li key={c.id}>
              <button type="button" data-categoria-id={c.id} aria-pressed={c.id === valor} onClick={() => aoEscolher(c.id)}
                className={`flex min-h-12 w-full items-center gap-3 rounded-lg px-2 text-left text-base hover:bg-slate-50 ${c.paiId ? 'pl-8' : ''} ${c.id === valor ? 'bg-azul-claro' : ''}`}>
                <IconeCategoria visual={visualDaCategoria(c, porId)} tamanho={c.paiId ? 'pequeno' : 'normal'} />
                <span className={`min-w-0 truncate ${c.paiId ? '' : 'font-semibold'}`}>{c.nome}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="grid grid-cols-4 gap-x-2 gap-y-4">
          {aoCriada && !criando && (
            <li>
              <button type="button" onClick={() => { setCriando(true); setNome(busca.trim()) }}
                className="flex w-full flex-col items-center gap-1 rounded-lg p-1 text-center text-xs text-slate-600 hover:bg-slate-50">
                <span aria-hidden="true" className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-lg">+</span>
                Criar categoria
              </button>
            </li>
          )}
          {itens.map((c) => (
            <li key={c.id}>
              <button type="button" data-categoria-id={c.id} aria-pressed={c.id === valor} onClick={() => aoEscolher(c.id)}
                className={`flex w-full flex-col items-center gap-1 rounded-lg p-1 text-center text-xs hover:bg-slate-50 ${c.id === valor ? 'bg-azul-claro' : ''}`}>
                <IconeCategoria visual={visualDaCategoria(c, porId)} />
                <span className="line-clamp-2 break-words">{c.nome}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Folha>
  )
}
