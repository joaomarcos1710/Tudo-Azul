import { currentMonth } from './format'
import { erroPeriodoLivre, periodoDoMes } from './periodoRelatorio'
import type { Periodo, TipoPeriodo } from './periodoRelatorio'
import { textoDaBusca } from './lancamentos'
import type { Filtros, StatusLancamento, TipoLancamento } from './lancamentos'

/**
 * Período e filtros de Lançamentos no endereço (handoff de Lançamentos, item g): recarregar a página, voltar do
 * navegador ou mandar o link para alguém da família abre a mesma lista.
 *
 *   ?mes=AAAA-MM                                   o mês (o padrão, sem nada, é o mês atual)
 *   ?periodo=livre&de=AAAA-MM-DD&ate=AAAA-MM-DD    qualquer outro período (dia, semana, meses, ano, livre)
 *   ?conta=<id>&categoria=<id>&cartao=<id>         filtros por id
 *   ?tipo=receita|despesa|transferencia            tipo (os links do Início e de Análises já usam receita/despesa)
 *   ?situacao=pago|pendente&fixos=1&parcelados=1   o resto dos filtros
 *   ?busca=<texto>                                 busca na descrição e na observação (1 a 100 letras)
 *
 * Só datas, ids e o texto da busca; nenhum dinheiro. Valor inválido é ignorado (cai no padrão), nunca vira erro na
 * tela. `?novo=` continua sendo tratado pela tela.
 */

const TIPOS: Record<string, TipoLancamento> = { receita: 'income', despesa: 'expense', transferencia: 'transfer' }
const TIPOS_URL: Record<TipoLancamento, string> = { income: 'receita', expense: 'despesa', transfer: 'transferencia' }
const SITUACOES: Record<string, StatusLancamento> = { pago: 'paid', pendente: 'planned' }
const SITUACOES_URL: Record<StatusLancamento, string> = { paid: 'pago', planned: 'pendente' }
const TIPOS_PERIODO: TipoPeriodo[] = ['dia', 'semana', 'mes', 'ciclo', 'meses', 'ano', 'livre']
const MES = /^20\d\d-(0[1-9]|1[0-2])$/
/** Id de conta, categoria ou cartão: só o formato (o banco e a RLS decidem o resto). */
const ID = /^[0-9a-zA-Z-]{1,64}$/

const dataReal = (d: string | null): d is string =>
  d !== null && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`))
    && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d

/** Chaves que este módulo lê e escreve (as outras, como `novo`, ficam como estão). */
export const CHAVES_URL_LANCAMENTOS = ['mes', 'periodo', 'de', 'ate', 'conta', 'categoria', 'cartao', 'tipo', 'situacao', 'fixos', 'parcelados', 'busca'] as const

export function periodoDaUrl(p: URLSearchParams, mesAtual: string = currentMonth()): Periodo {
  const de = p.get('de')
  const ate = p.get('ate')
  const tipo = p.get('periodo') as TipoPeriodo | null
  if (tipo && tipo !== 'mes' && TIPOS_PERIODO.includes(tipo) && dataReal(de) && dataReal(ate) && erroPeriodoLivre(de, ate) === null) {
    return { tipo, de, ate }
  }
  const mes = p.get('mes')
  return periodoDoMes(mes && MES.test(mes) ? mes : mesAtual)
}

export function filtrosDaUrl(p: URLSearchParams): Filtros {
  const f: Filtros = {}
  const id = (chave: string) => { const v = p.get(chave); return v && ID.test(v) ? v : undefined }
  const conta = id('conta'); if (conta) f.contaId = conta
  const categoria = id('categoria'); if (categoria) f.categoriaId = categoria
  const cartao = id('cartao'); if (cartao) f.cartaoId = cartao
  const tipo = TIPOS[p.get('tipo') ?? '']; if (tipo) f.tipo = tipo
  const situacao = SITUACOES[p.get('situacao') ?? '']; if (situacao) f.situacao = situacao
  if (p.get('fixos') === '1') f.soFixos = true
  if (p.get('parcelados') === '1') f.soParcelados = true
  const busca = textoDaBusca(p.get('busca')); if (busca) f.busca = busca
  return f
}

/** Novo endereço com o período e os filtros dados; as outras chaves (ex.: `novo`) ficam como estavam. */
export function urlComListagem(atual: URLSearchParams, periodo: Periodo, filtros: Filtros): URLSearchParams {
  const n = new URLSearchParams(atual)
  for (const k of CHAVES_URL_LANCAMENTOS) n.delete(k)
  if (periodo.tipo === 'mes') n.set('mes', periodo.de.slice(0, 7))
  else { n.set('periodo', periodo.tipo); n.set('de', periodo.de); n.set('ate', periodo.ate) }
  if (filtros.contaId) n.set('conta', filtros.contaId)
  if (filtros.categoriaId) n.set('categoria', filtros.categoriaId)
  if (filtros.cartaoId) n.set('cartao', filtros.cartaoId)
  if (filtros.tipo) n.set('tipo', TIPOS_URL[filtros.tipo])
  if (filtros.situacao) n.set('situacao', SITUACOES_URL[filtros.situacao])
  if (filtros.soFixos) n.set('fixos', '1')
  if (filtros.soParcelados) n.set('parcelados', '1')
  const busca = textoDaBusca(filtros.busca); if (busca) n.set('busca', busca)
  return n
}

/** Texto só com as chaves da listagem, em ordem fixa: muda só quando o período ou um filtro muda (chave de memo). */
export function assinaturaDaListagem(p: URLSearchParams): string {
  return CHAVES_URL_LANCAMENTOS.map((k) => `${k}=${p.get(k) ?? ''}`).join('&')
}
