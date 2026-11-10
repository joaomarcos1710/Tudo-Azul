import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Aviso } from '../components/ui/Aviso'
import { Button } from '../components/ui/Button'
import { Field } from '../components/ui/Field'
import { Folha } from '../components/ui/Folha'
import { Selecao } from '../components/ui/Selecao'
import { opcoesDeCategoria } from '../lib/categorias'
import type { Categoria } from '../lib/categorias'
import { mensagemErroBanco } from '../lib/erros'
import {
  LIMITE_LOTE, marcarPagoEmLote, moverParaLixeiraEmLote, mudarCategoriaEmLote, restaurarDaLixeiraEmLote, voltarPlanejadoEmLote,
} from '../lib/lancamentos'
import type { Lancamento } from '../lib/lancamentos'

type AcaoLote = 'categoria' | 'pago' | 'lixeira'

const quantos = (n: number) => (n === 1 ? '1 lançamento' : `${n} lançamentos`)
const alterados = (n: number) => (n === 1 ? '1 lançamento alterado' : `${n} lançamentos alterados`)

export interface SelecaoLote {
  /** Modo de seleção ligado (pelo ⋯ do topo): as linhas de lançamento ganham a caixa de marcar. */
  ligada: boolean
  ligar: () => void
  marcado: (id: string) => boolean
  /** `intervalo` = Shift: marca (ou desmarca) da última caixa tocada até esta, na ordem da tela. */
  alternar: (id: string, intervalo: boolean) => void
  /** Barra de ações (vai no topo fixo) e a confirmação (Folha); null com o modo desligado. */
  barra: ReactNode
  /** A confirmação da ação (Folha): fora do topo fixo. */
  confirmacao: ReactNode
  /** "N alterados · Desfazer": fica uns segundos depois da ação, com o modo já desligado. */
  desfazer: ReactNode
}

/**
 * Seleção de vários lançamentos na lista por dia (pedido do dono, 10/11/2026, como no Organizze) com ações em lote: mudar
 * categoria, marcar como pago, lixeira. Cada ação é UMA chamada ao banco, tudo ou nada; a confirmação mostra só a
 * quantidade (o front não soma dinheiro). Depois, "Desfazer" por alguns segundos. Fatura, compra de cartão, dívida e
 * contrato não são `transactions`: não entram na seleção.
 */
export function useSelecaoLote({ lancamentos, hoje, categorias, chave, aoAlterar }: {
  /** Os lançamentos da tela, na ordem em que aparecem. */
  lancamentos: Lancamento[]
  hoje: string
  categorias: Categoria[]
  /** Muda com o mês e os filtros: a seleção é "do mês/filtro" e começa vazia em outro. */
  chave: string
  /** Recarrega a lista e os totais (vêm do banco). */
  aoAlterar: () => Promise<void>
}): SelecaoLote {
  const [ligada, setLigada] = useState(false)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const ancora = useRef<string | null>(null)
  const [acao, setAcao] = useState<AcaoLote | null>(null)
  const [categoriaNova, setCategoriaNova] = useState('')
  const [dataPago, setDataPago] = useState(hoje)
  const [enviando, setEnviando] = useState(false)
  const [erroLote, setErroLote] = useState('')
  const [feito, setFeito] = useState<{ texto: string; executar: () => Promise<void> } | null>(null)
  const [desfazendo, setDesfazendo] = useState(false)
  const [erroDesfazer, setErroDesfazer] = useState('')

  function limpar() { setSel(new Set()); setAcao(null); setErroLote(''); ancora.current = null }
  function desligar() { limpar(); setLigada(false) }

  // outro mês ou outro filtro: começa sem seleção (o modo continua ligado)
  useEffect(() => { limpar() }, [chave])

  // o aviso de desfazer some sozinho (não enquanto desfaz)
  useEffect(() => {
    if (!feito || desfazendo) return
    const t = window.setTimeout(() => { setFeito(null); setErroDesfazer('') }, 10_000)
    return () => window.clearTimeout(t)
  }, [feito, desfazendo])

  // Esc: primeiro limpa a seleção; sem nada marcado, sai do modo
  useEffect(() => {
    if (!ligada) return
    function tecla(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      // Esc de um menu aberto ou de uma folha por cima é deles
      if (document.activeElement?.closest('[role="menu"]') || document.querySelector('[role="dialog"]')) return
      if (sel.size > 0) limpar(); else desligar()
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [ligada, sel])

  // seleção válida = só o que ainda está na lista (depois de recarregar, o que sumiu sai da seleção)
  const escolhidos = lancamentos.filter((l) => sel.has(l.id))
  const n = escolhidos.length
  const todos = lancamentos.length > 0 && n === lancamentos.length
  const tipos = new Set(escolhidos.map((l) => l.tipo))
  const tipoUnico = tipos.size === 1 ? [...tipos][0] : null
  const podeCategoria = tipoUnico === 'income' || tipoUnico === 'expense'
  const motivoSemCategoria = tipos.has('transfer') ? 'Transferência não tem categoria: tire as transferências da seleção.'
    : tipos.size > 1 ? 'Receita e despesa têm categorias diferentes: selecione só um dos tipos.' : ''
  const planejados = escolhidos.filter((l) => l.status === 'planned')
  const acimaDoLimite = n > LIMITE_LOTE

  function alternar(id: string, intervalo: boolean) {
    // lida agora: o atualizador do setSel roda depois, quando a âncora já é o id novo
    const de = ancora.current
    setSel((atual) => {
      const novo = new Set(atual)
      const marcar = !atual.has(id)
      if (intervalo && de && de !== id) {
        const ids = lancamentos.map((l) => l.id)
        const [a, b] = [ids.indexOf(de), ids.indexOf(id)].sort((x, y) => x - y)
        if (a >= 0) {
          for (const x of ids.slice(a, b + 1)) { if (marcar) novo.add(x); else novo.delete(x) }
          return novo
        }
      }
      if (marcar) novo.add(id); else novo.delete(id)
      return novo
    })
    ancora.current = id
  }

  function abrir(a: AcaoLote) {
    setErroLote('')
    setAcao(a)
    if (a === 'categoria') setCategoriaNova('')
    if (a === 'pago') setDataPago(hoje)
  }

  async function confirmar() {
    if (acao === 'categoria' && !categoriaNova) { setErroLote('Escolha a nova categoria.'); return }
    if (acao === 'pago' && !dataPago) { setErroLote('Informe a data do pagamento.'); return }
    setEnviando(true)
    setErroLote('')
    try {
      let novo: { texto: string; executar: () => Promise<void> }
      if (acao === 'categoria') {
        // guarda as categorias de antes para o desfazer (uma chamada por categoria antiga)
        const antes = new Map<string, string[]>()
        for (const l of escolhidos) {
          if (!l.categoriaId || l.categoriaId === categoriaNova) continue
          antes.set(l.categoriaId, [...(antes.get(l.categoriaId) ?? []), l.id])
        }
        const qtd = await mudarCategoriaEmLote(escolhidos.map((l) => l.id), categoriaNova)
        // atalho: o desfazer de categoria é uma chamada por categoria antiga (não é uma operação só); se uma falhar,
        // as anteriores já voltaram e o aviso mostra o erro (pode tentar de novo). Melhorar com uma função de pares no banco.
        novo = { texto: alterados(qtd), executar: async () => { for (const [cat, ids] of antes) await mudarCategoriaEmLote(ids, cat) } }
      } else if (acao === 'pago') {
        const ids = planejados.map((l) => l.id)
        const datas = planejados.map((l) => l.data)
        const qtd = await marcarPagoEmLote(ids, dataPago)
        novo = { texto: alterados(qtd), executar: async () => { await voltarPlanejadoEmLote(ids, datas) } }
      } else {
        const ids = escolhidos.map((l) => l.id)
        const qtd = await moverParaLixeiraEmLote(ids)
        novo = { texto: `${quantos(qtd)} na lixeira`, executar: async () => { await restaurarDaLixeiraEmLote(ids) } }
      }
      desligar()
      setErroDesfazer('')
      setFeito(novo)
      await aoAlterar()
    } catch (err) {
      // a seleção fica: a pessoa corrige (ou tira o item recusado) e tenta de novo
      setErroLote(mensagemErroBanco(err))
    } finally {
      setEnviando(false)
    }
  }

  async function executarDesfazer() {
    if (!feito) return
    setDesfazendo(true)
    setErroDesfazer('')
    try {
      await feito.executar()
      setFeito(null)
      await aoAlterar()
    } catch (err) {
      setErroDesfazer(mensagemErroBanco(err))
    } finally {
      setDesfazendo(false)
    }
  }

  const categoriasDoTipo = categorias.filter((c) => c.tipo === tipoUnico && c.ativa)
  const tituloConfirmar = acao === 'categoria' ? `Mudar a categoria de ${quantos(n)}`
    : acao === 'pago' ? `Marcar ${quantos(planejados.length)} como ${planejados.length === 1 ? 'pago' : 'pagos'}`
    : `Enviar ${quantos(n)} para a lixeira`

  const barra = !ligada ? null : (
    <section aria-label="Ações em lote" className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-azul/30 bg-white px-3 py-2">
      <label className="inline-flex min-h-11 items-center gap-2 pr-1">
        <input type="checkbox" className="h-5 w-5 accent-azul" aria-label="Selecionar todos os lançamentos carregados"
          checked={todos} disabled={lancamentos.length === 0}
          ref={(el) => { if (el) el.indeterminate = n > 0 && !todos }}
          onChange={() => { setSel(todos ? new Set() : new Set(lancamentos.map((l) => l.id))); ancora.current = null }} />
        <span className="font-semibold text-marinho" aria-live="polite">
          {n === 0 ? 'Marque os lançamentos' : n === 1 ? '1 selecionado' : `${n} selecionados`}
        </span>
      </label>
      <Button variante="secundario" compacto onClick={() => abrir('categoria')} disabled={!podeCategoria || enviando || acimaDoLimite}
        title={motivoSemCategoria || undefined}>Mudar categoria</Button>
      <Button variante="secundario" compacto onClick={() => abrir('pago')} disabled={planejados.length === 0 || enviando || acimaDoLimite}
        title={n > 0 && planejados.length === 0 ? 'Nenhum planejado na seleção.' : undefined}>Marcar como pago</Button>
      <Button variante="discreto" compacto onClick={() => abrir('lixeira')} disabled={n === 0 || enviando || acimaDoLimite}>Excluir</Button>
      <Button variante="fantasma" compacto className="ml-auto" onClick={desligar}>Concluir seleção</Button>
      {!podeCategoria && motivoSemCategoria && <p className="w-full text-xs text-slate-500">{motivoSemCategoria}</p>}
      {acimaDoLimite && <p className="w-full text-xs text-negativo">No máximo {LIMITE_LOTE} lançamentos por vez.</p>}
    </section>
  )

  // fora da barra: o topo fixo usa backdrop-blur, que prenderia a Folha (position: fixed) dentro dele
  const confirmacao = !ligada || acao === null || n === 0 ? null : (
    <Folha titulo={tituloConfirmar} aoFechar={() => { if (!enviando) { setAcao(null); setErroLote('') } }}
      rodape={<>
        <Button variante="secundario" onClick={() => { setAcao(null); setErroLote('') }} disabled={enviando}>Cancelar</Button>
        <Button variante={acao === 'lixeira' ? 'perigo' : 'primario'} onClick={confirmar} carregando={enviando}>
          {acao === 'lixeira' ? 'Enviar para a lixeira' : 'Confirmar'}
        </Button>
      </>}>
      <div className="flex flex-col gap-3">
        {acao === 'categoria' && (
          <Selecao rotulo={`Nova categoria (${tipoUnico === 'income' ? 'receita' : 'despesa'})`} valor={categoriaNova} aoMudar={setCategoriaNova}
            opcoes={opcoesDeCategoria(categoriasDoTipo, categorias).map((o) => [o.id, o.rotulo])} todos="Escolha…" />
        )}
        {acao === 'pago' && (
          <>
            <p className="text-sm text-slate-600">
              {planejados.length < n ? `${quantos(n - planejados.length)} da seleção já ${n - planejados.length === 1 ? 'está pago' : 'estão pagos'} e não muda. ` : ''}
              O valor de cada um continua o planejado; se algum saiu diferente, use "Marcar pago" naquele lançamento.
            </p>
            <Field rotulo="Data do pagamento" type="date" value={dataPago} onChange={(e) => setDataPago(e.target.value)} />
          </>
        )}
        {acao === 'lixeira' && <p className="text-sm text-slate-600">Eles vão para a lixeira e podem ser restaurados (há "Desfazer" logo depois).</p>}
        <p className="text-sm text-slate-600">É uma operação só: ou todos mudam, ou nenhum.</p>
        {erroLote && <Aviso tipo="erro">{erroLote}</Aviso>}
      </div>
    </Folha>
  )

  const desfazer = !feito ? null : (
    <div className="mb-4 flex flex-wrap items-center gap-3" role="status" aria-live="polite">
      <span className="rounded-lg bg-azul-claro px-4 py-3 text-sm text-marinho">{feito.texto}.</span>
      <Button variante="fantasma" onClick={executarDesfazer} carregando={desfazendo}>Desfazer</Button>
      {erroDesfazer && <Aviso tipo="erro">Não foi possível desfazer: {erroDesfazer}</Aviso>}
    </div>
  )

  return { ligada, ligar: () => setLigada(true), marcado: (id) => sel.has(id), alternar, barra, confirmacao, desfazer }
}
