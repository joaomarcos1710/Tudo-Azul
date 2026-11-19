import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
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
 * No computador (largura de lg, 1024 px, com mouse) a lista abre embaixo do próprio campo, sem pop-up por cima do formulário (pedido do dono,
 * 18/11/2026: "abre um pop-up, não seria melhor usar igual o Mobills?"); no celular e no iPad (toque, em pé ou deitado) continua a folha.
 *
 * `opcoes` é a lista já filtrada por quem usa (tipo, ativas): a mesma que o seletor nativo recebia.
 */
// Só mouse e largura de computador: o iPad (toque), mesmo deitado e com 1180 px, usa a folha. Na lista fixa embaixo do campo o toque no
// campo não abria nada no iPad (dono, 19/11/2026, vídeo): o foco na busca faz o iOS rolar a tela ou mudar o tamanho, e a lista fecha sozinha
// nesses dois eventos. A folha não depende disso e é a que já funciona no iPhone.
const CONSULTA_COMPUTADOR = '(min-width: 1024px) and (hover: hover) and (pointer: fine)'
/** Sem matchMedia (testes em jsdom, navegador muito antigo) vale o celular: a folha, que sempre existiu. */
function useEhComputador(): boolean {
  return useSyncExternalStore(
    (avisar) => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
      const m = window.matchMedia(CONSULTA_COMPUTADOR)
      m.addEventListener('change', avisar)
      return () => m.removeEventListener('change', avisar)
    },
    () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(CONSULTA_COMPUTADOR).matches,
    () => false,
  )
}
/** Altura máxima da lista aberta junto do campo (20rem). */
const ALTURA_LISTA_PX = 320
const FOLGA_PX = 8
/** Abre para baixo (o natural, como no Mobills) sempre que couber pelo menos isto; só abaixo disso, e com mais espaço em cima, sobe. */
const ESPACO_PARA_BAIXO_PX = 220
/** Onde a lista fica, em coordenadas da TELA (position: fixed): o formulário em volta rola e cortaria uma lista presa dentro dele. */
type PosicaoLista = { esquerda: number; largura: number; paraCima: boolean; topo: number; baixo: number; alturaMax: number }
function posicaoDaLista(campo: DOMRect): PosicaoLista {
  const abaixo = window.innerHeight - campo.bottom - FOLGA_PX
  const acima = campo.top - FOLGA_PX
  const paraCima = abaixo < ESPACO_PARA_BAIXO_PX && acima > abaixo
  return {
    esquerda: campo.left, largura: campo.width, paraCima,
    topo: campo.bottom + 4, baixo: window.innerHeight - campo.top + 4,
    alturaMax: Math.max(120, Math.min(ALTURA_LISTA_PX, paraCima ? acima : abaixo)),
  }
}

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
  const [posicao, setPosicao] = useState<PosicaoLista | null>(null)
  const computador = useEhComputador()
  const raiz = useRef<HTMLDivElement>(null)
  const botao = useRef<HTMLButtonElement>(null)
  const lista = useRef<HTMLDivElement>(null)
  const porId = new Map(categorias.map((c) => [c.id, c]))
  const escolhida = valor ? porId.get(valor) : undefined

  function abrir() {
    if (computador && botao.current) setPosicao(posicaoDaLista(botao.current.getBoundingClientRect()))
    setAberta(true)
  }
  function fechar(devolverFoco: boolean) {
    setAberta(false)
    if (devolverFoco) botao.current?.focus()
  }
  // lista junto do campo: clicar fora fecha (a folha já faz isso sozinha). A lista fica fixa na tela, então rolar o formulário
  // ou mudar o tamanho da janela a deixaria longe do campo: fecha também (rolar dentro da própria lista não fecha).
  useEffect(() => {
    if (!aberta || !computador) return
    const fora = (e: MouseEvent) => { if (raiz.current && !raiz.current.contains(e.target as Node)) setAberta(false) }
    const rolou = (e: Event) => { if (!(e.target instanceof Node && lista.current?.contains(e.target))) setAberta(false) }
    const mudou = () => setAberta(false)
    document.addEventListener('mousedown', fora)
    window.addEventListener('scroll', rolou, true)
    window.addEventListener('resize', mudou)
    return () => {
      document.removeEventListener('mousedown', fora)
      window.removeEventListener('scroll', rolou, true)
      window.removeEventListener('resize', mudou)
    }
  }, [aberta, computador])
  // Esc fecha só a lista, não o formulário que está em volta (a folha do formulário também escuta o Esc)
  function teclaNaLista(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape' && aberta && computador) { e.stopPropagation(); fechar(true) }
  }

  return (
    <div ref={raiz} onKeyDown={teclaNaLista} className={`relative ${rotuloVisivel ? 'flex flex-col gap-1' : 'min-w-0'}`}>
      {rotuloVisivel && <label htmlFor={idBotao} className="text-sm font-medium">{rotulo}</label>}
      <button ref={botao} id={idBotao} type="button" aria-haspopup={computador ? 'true' : 'dialog'} aria-expanded={aberta} data-valor={valor}
        onClick={() => (aberta && computador ? fechar(false) : abrir())}
        className={classeBotao ?? 'flex min-h-11 items-center gap-2 rounded-lg border border-slate-500 bg-white px-3 text-left text-base'}>
        {escolhida && <IconeCategoria visual={visualDaCategoria(escolhida, porId)} tamanho="pequeno" />}
        {escolhida?.paiId && porId.get(escolhida.paiId)
          // "Principal › Filha": a principal encolhe primeiro, para o nome da filha (o que foi escolhido) ser o último a cortar
          ? <span className="flex min-w-0 items-baseline"><span className="min-w-0 shrink-[3] truncate text-slate-500">{porId.get(escolhida.paiId)?.nome}{' › '}</span><span className="min-w-0 truncate">{escolhida.nome}</span></span>
          : <span className={`min-w-0 truncate ${escolhida ? '' : 'text-slate-500'}`}>{escolhida?.nome ?? 'Escolher'}</span>}
      </button>
      {aberta && (computador && posicao ? (
        <div ref={lista} role="group" aria-label="Categorias" data-testid="lista-categorias" data-direcao={posicao.paraCima ? 'cima' : 'baixo'}
          style={{ position: 'fixed', left: posicao.esquerda, width: posicao.largura, maxHeight: posicao.alturaMax, ...(posicao.paraCima ? { bottom: posicao.baixo } : { top: posicao.topo }) }}
          className="z-[60] overflow-y-auto rounded-xl border border-slate-200 bg-white p-3 shadow-card">
          <PainelCategorias opcoes={opcoes} categorias={categorias} porId={porId} tipo={tipo} valor={valor} aoCriada={aoCriada} focarBusca
            aoEscolher={(c) => { aoMudar(c); fechar(true) }} />
        </div>
      ) : (
        <Folha titulo="Selecionar uma categoria" aoFechar={() => fechar(false)}>
          <PainelCategorias opcoes={opcoes} categorias={categorias} porId={porId} tipo={tipo} valor={valor} aoCriada={aoCriada}
            aoEscolher={(c) => { aoMudar(c); fechar(false) }} />
        </Folha>
      ))}
    </div>
  )
}

/** Busca, lista ou grade e "Criar categoria": o mesmo conteúdo na folha (celular) e na lista embaixo do campo (computador). */
function PainelCategorias({ opcoes, categorias, porId, tipo, valor, aoEscolher, aoCriada, focarBusca = false }: {
  opcoes: Categoria[]; categorias: Categoria[]; porId: Map<string, Categoria>; tipo: TipoCategoria; valor: string
  aoEscolher: (id: string) => void; aoCriada?: (c: Categoria) => void
  /** Lista embaixo do campo: o cursor já vai para a busca, como o Mobills (a folha leva o foco para o primeiro controle sozinha). */
  focarBusca?: boolean
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

  // a busca pode devolver só a filha ("feira"): sem a principal na lista, ela perde o contexto e ganha "em Principal"
  const idsNaLista = new Set(itens.map((c) => c.id))
  const semPrincipalNaLista = (c: Categoria) => c.paiId !== null && !idsNaLista.has(c.paiId)

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
    <>
      <div className="mb-3 flex items-center gap-2">
        <input type="search" aria-label="Buscar uma categoria" placeholder="Buscar uma categoria" value={busca} autoFocus={focarBusca}
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
                <span className="flex min-w-0 flex-col">
                  <span className={`truncate ${c.paiId ? '' : 'font-semibold'}`}>{c.nome}</span>
                  {/* na busca a principal pode não estar na lista: sem ela a filha perde o contexto */}
                  {semPrincipalNaLista(c) && <span className="truncate text-xs text-slate-500">em {porId.get(c.paiId ?? '')?.nome}</span>}
                </span>
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
            // a principal vira um cabeçalho de linha inteira (continua tocável); as filhas ficam embaixo, menores
            <li key={c.id} className={c.paiId ? '' : 'col-span-4'}>
              {c.paiId ? (
                <button type="button" data-categoria-id={c.id} aria-pressed={c.id === valor} onClick={() => aoEscolher(c.id)}
                  className={`flex w-full flex-col items-center gap-1 rounded-lg p-1 text-center text-xs hover:bg-slate-50 ${c.id === valor ? 'bg-azul-claro' : ''}`}>
                  <IconeCategoria visual={visualDaCategoria(c, porId)} tamanho="pequeno" />
                  <span className="line-clamp-2 break-words">{c.nome}</span>
                  {semPrincipalNaLista(c) && <span className="line-clamp-1 break-words text-[11px] text-slate-500">em {porId.get(c.paiId ?? '')?.nome}</span>}
                </button>
              ) : (
                <button type="button" data-categoria-id={c.id} aria-pressed={c.id === valor} onClick={() => aoEscolher(c.id)}
                  className={`flex min-h-11 w-full items-center gap-2 rounded-lg border-b border-slate-200 px-1 text-left text-sm font-semibold hover:bg-slate-50 ${c.id === valor ? 'bg-azul-claro' : ''}`}>
                  <IconeCategoria visual={visualDaCategoria(c, porId)} tamanho="pequeno" />
                  <span className="min-w-0 truncate">{c.nome}</span>
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
