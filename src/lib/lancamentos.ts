import { centsFromDb, centsToDecimal } from './format'
import type { Cents } from './format'
import { listarCreditosDaFatura, listarFaturas, listarItens, situacaoFatura } from './cartoes'
import type { Fatura } from './cartoes'
import { supabase } from './supabase'

export type TipoLancamento = 'income' | 'expense' | 'transfer'
export type StatusLancamento = 'paid' | 'planned'

export interface Lancamento {
  id: string
  tipo: TipoLancamento
  contaId: string
  /** Só em transferência. */
  destinoId: string | null
  /** Obrigatória em receita e despesa; nula em transferência (regra do banco). */
  categoriaId: string | null
  descricao: string
  valor: Cents
  /** AAAA-MM-DD */
  data: string
  status: StatusLancamento
  notas: string
  personId?: string | null
  isSharedExpense?: boolean
  recorrenciaId?: string | null
  /** Gerado por uma regra recorrente (só leitura: o vínculo é gravado pelo banco). */
  recorrente?: boolean
}

export type DadosLancamento = Omit<Lancamento, 'id' | 'recorrente' | 'recorrenciaId' | 'personId' | 'isSharedExpense'> & Partial<Pick<Lancamento, 'personId' | 'isSharedExpense'>>

/** Totais do mês calculados no banco (period_summary): a tela não soma dinheiro. */
export interface ResumoMes {
  receitas: Cents
  despesas: Cents
  resultado: Cents
  receitasPrevistas: Cents
  despesasPrevistas: Cents
}

function cliente() {
  if (!supabase) throw new Error('Supabase não configurado')
  return supabase
}

/** "2026-10" -> ["2026-10-01", "2026-10-31"] sem passar por fuso horário. */
export function limitesDoMes(mes: string): [string, string] {
  const [a, m] = mes.split('-').map(Number)
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate()
  return [`${mes}-01`, `${mes}-${String(ultimo).padStart(2, '0')}`]
}

/** "2026-10" + 1 -> "2026-11"; "2026-01" - 1 -> "2025-12". */
export function somarMeses(mes: string, n: number): string {
  const [a, m] = mes.split('-').map(Number)
  const d = new Date(Date.UTC(a, m - 1 + n, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export interface Filtros {
  contaId?: string
  categoriaId?: string
  tipo?: TipoLancamento
  /** Resolvido = paid; Pendente = planned (só lançamentos). */
  situacao?: StatusLancamento
  /** Só as faturas desse cartão (cartão não tem lançamento próprio: a compra vive na fatura). */
  cartaoId?: string
  /** Só lançamentos gerados por um recorrente (recurrence_id). */
  soFixos?: boolean
  /** Só lançamentos de uma compra parcelada (installment_group). */
  soParcelados?: boolean
}

export function listarLancamentos(familiaId: string, mes: string, f: Filtros = {}): Promise<Lancamento[]> {
  return listarLancamentosNoPeriodo(familiaId, ...limitesDoMes(mes), f)
}

/** Lançamentos com data entre `de` e `ate` (inclusive): o período livre da tela de Lançamentos (etapa 3). */
export async function listarLancamentosNoPeriodo(familiaId: string, de: string, ate: string, f: Filtros = {}): Promise<Lancamento[]> {
  const consultar = async (colunas: string[]) => {
    let consulta = cliente().from('transactions').select(colunas.join(', '))
      .eq('household_id', familiaId).is('deleted_at', null).gte('date', de).lte('date', ate)
    // conta filtra origem ou destino: a transferência aparece nas duas contas
    if (f.contaId) consulta = consulta.or(`account_id.eq.${f.contaId},destination_account_id.eq.${f.contaId}`)
    if (f.categoriaId) consulta = consulta.eq('category_id', f.categoriaId)
    if (f.tipo) consulta = consulta.eq('type', f.tipo)
    if (f.situacao) consulta = consulta.eq('status', f.situacao)
    if (f.soFixos) consulta = consulta.not('recurrence_id', 'is', null)
    if (f.soParcelados) consulta = consulta.not('installment_group', 'is', null)
    return consulta.order('date', { ascending: false }).order('created_at', { ascending: false })
  }
  type LinhaLancamentoDb = {
    id: string; type: TipoLancamento; account_id: string; destination_account_id: string | null;
    category_id: string | null; description: string; amount: number | string; date: string;
    status: StatusLancamento; notes: string | null; recurrence_id: string | null;
    person_id?: string | null; is_shared_expense?: boolean;
  }
  let data: LinhaLancamentoDb[] | null = null
  let error: { code?: string; message?: string } | null = null
  const novo = await consultar([
    'id', 'type', 'account_id', 'destination_account_id', 'category_id', 'description', 'amount', 'date',
    'status', 'notes', 'recurrence_id', 'person_id', 'is_shared_expense',
  ])
  data = novo.data as unknown as LinhaLancamentoDb[] | null
  error = novo.error
  if (error && ['42703', 'PGRST204'].includes(error.code ?? '')) {
    // Preview sem a migration ainda: mantém o extrato antigo funcional, sem classificação.
    const antigo = await consultar([
      'id', 'type', 'account_id', 'destination_account_id', 'category_id', 'description', 'amount', 'date',
      'status', 'notes', 'recurrence_id',
    ])
    data = antigo.data as unknown as LinhaLancamentoDb[] | null
    error = antigo.error
  }
  if (error) throw error
  return (data ?? []).map((t) => ({
    id: t.id,
    tipo: t.type,
    contaId: t.account_id,
    destinoId: t.destination_account_id,
    categoriaId: t.category_id,
    descricao: t.description,
    valor: centsFromDb(t.amount),
    data: t.date,
    status: t.status,
    notas: t.notes ?? '',
    personId: t.person_id ?? null,
    isSharedExpense: t.is_shared_expense ?? false,
    recorrenciaId: t.recurrence_id ?? null,
    recorrente: t.recurrence_id != null,
  }))
}

/**
 * Movimento de cartão ou dívida que mexe numa conta (pagamento de fatura, juros, tarifa, empréstimo recebido...).
 * Só leitura no extrato: o saldo da conta e os totais do mês vêm do banco.
 * Pagamento de cartão, crédito e devolução NÃO são receita nem despesa (a compra já contou no mês da fatura);
 * juros e tarifa SÃO despesa (já estão em "Despesas pagas", na categoria do evento); e, desde a migration 046,
 * o principal pago de empréstimo/financiamento também é despesa do mês, na categoria escolhida na dívida.
 */
export interface MovimentoDivida {
  id: string
  data: string
  contaId: string
  descricao: string
  /** Com sinal do ponto de vista da conta: + entra, − sai (mesma regra de account_movements). */
  valor: Cents
  /** Juros e tarifa: já contam em Despesas pagas. */
  jaEmDespesas: boolean
}

const eventosDeConta = ['payment', 'extra_principal', 'disbursement', 'refund_cash', 'interest', 'fee'] as const
const rotuloEventoConta: Record<string, string> = {
  payment: 'Pagamento de', extra_principal: 'Amortização de', disbursement: 'Crédito de',
  refund_cash: 'Devolução de', interest: 'Juros de', fee: 'Tarifa de',
}

/**
 * Movimentos de cartão/dívida do mês que mexem em conta.
 * Receita e transferência não os incluem; com filtro de despesa ou de categoria, só o que é despesa: juros, tarifa e
 * principal de empréstimo/financiamento (este na categoria da dívida); sem filtro, todos.
 */
export function listarMovimentosDeDivida(familiaId: string, mes: string, f: Filtros = {}): Promise<MovimentoDivida[]> {
  return listarMovimentosDeDividaNoPeriodo(familiaId, ...limitesDoMes(mes), f)
}

export async function listarMovimentosDeDividaNoPeriodo(familiaId: string, de: string, ate: string, f: Filtros = {}): Promise<MovimentoDivida[]> {
  if (f.tipo === 'income' || f.tipo === 'transfer') return []
  const soDespesa = Boolean(f.categoriaId) || f.tipo === 'expense'
  const tipos = soDespesa ? ['interest', 'fee', 'payment', 'extra_principal'] : [...eventosDeConta]
  const db = cliente()
  const eventos: { id: string; debt_id: string; date: string; kind: string; amount: number | string; account_id: string; category_id?: string | null }[] = []
  const pagina = 1000
  for (let inicio = 0; ; inicio += pagina) {
    let q = db.from('debt_events').select('id, debt_id, date, kind, amount, account_id, category_id')
      .eq('household_id', familiaId).is('voided_at', null).in('kind', tipos).not('account_id', 'is', null)
      .gte('date', de).lte('date', ate)
    if (f.contaId) q = q.eq('account_id', f.contaId)
    // categoria: o principal não tem categoria no evento (vem da dívida); o filtro é aplicado abaixo, já com a dívida
    // ordem total (data, criação, id): a paginação não repete nem perde linha
    const { data, error } = await q.order('date', { ascending: false }).order('created_at', { ascending: false }).order('id')
      .range(inicio, inicio + pagina - 1)
    if (error) throw error
    eventos.push(...((data ?? []) as typeof eventos))
    if (!data || data.length < pagina) break
  }
  // principal_category_id é da migration 046: sem ela no banco, segue sem a categoria do principal
  let dividas = await db.from('debts').select('id, name, kind, principal_category_id').eq('household_id', familiaId)
  if (dividas.error) dividas = await db.from('debts').select('id, name, kind').eq('household_id', familiaId) as typeof dividas
  if (dividas.error) throw dividas.error
  const porId = new Map(((dividas.data ?? []) as { id: string; name: string; kind: string; principal_category_id?: string | null }[]).map((d) => [d.id, d]))
  const ehEmprestimo = (kind?: string) => kind === 'loan' || kind === 'financing'
  const principal = (kind: string) => kind === 'payment' || kind === 'extra_principal'
  return eventos.filter((e) => {
    if (!soDespesa) return true
    const d = porId.get(e.debt_id)
    // pagamento de cartão não é despesa: com filtro de despesa/categoria, só principal de empréstimo/financiamento
    if (principal(e.kind)) return ehEmprestimo(d?.kind) && (!f.categoriaId || (d?.principal_category_id ?? null) === f.categoriaId)
    return !f.categoriaId || e.category_id === f.categoriaId
  }).map((e) => {
    const d = porId.get(e.debt_id)
    const nome = d?.name ?? 'cartão/dívida'
    const entra = e.kind === 'disbursement' || e.kind === 'refund_cash'
    const cents = centsFromDb(e.amount)
    return {
      id: e.id,
      data: e.date,
      contaId: e.account_id,
      descricao: e.kind === 'payment' && d?.kind === 'card' ? `Pagamento da fatura · ${nome}` : `${rotuloEventoConta[e.kind]} ${nome}`,
      valor: (entra ? cents : -cents) as Cents,
      jaEmDespesas: e.kind === 'interest' || e.kind === 'fee' || (principal(e.kind) && ehEmprestimo(d?.kind)),
    }
  })
}

/**
 * Fatura de cartão na lista do mês (pedido do dono, 05/11/2026, como no Organizze): UMA linha por fatura, no dia do
 * VENCIMENTO, com o total que o banco calcula (card_months, a mesma fonte da tela Cartões). As compras ficam dentro
 * ("Ver compras", card_items). Só apresentação: nos totais e relatórios a compra continua sendo despesa no mês do
 * FECHAMENTO da fatura (period_summary), então uma fatura que fecha num mês e vence no seguinte conta como despesa no
 * primeiro e aparece na lista do segundo.
 */
export interface FaturaDoMes {
  cartaoId: string
  cartaoNome: string
  /** AAAA-MM do fechamento (o "label" da fatura no banco). */
  mes: string
  fechamento: string
  vencimento: string
  /** Total da fatura calculado no banco (card_months.total); a tela não soma parcelas. */
  total: Cents
  pago: Cents
  /** Quantidade de parcelas na fatura (contagem, não dinheiro). */
  itens: number
  /** Créditos avulsos da fatura (card_months.credits, migration 052), já descontados de `total` pelo banco. */
  creditos: Cents
  situacao: SituacaoDaFatura
  contaPagamentoId: string | null
}

/**
 * Situação de um lançamento (ou de outro compromisso com data): pago; planejado com data antes de hoje (hojeSP) =
 * vencido (vermelho, prejuízo, #183); senão planejado (verde). A mesma regra na tabela do computador, na lista do
 * celular e no Calendário; o Início (vencidosPlanejados) usa o mesmo corte `data < hoje` no banco.
 */
export type SituacaoLancamento = 'pago' | 'planejado' | 'vencido'
export function situacaoDoLancamento(pago: boolean, data: string, hoje: string): SituacaoLancamento {
  return pago ? 'pago' : data < hoje ? 'vencido' : 'planejado'
}

/** A regra da tela Cartões (situacaoFatura) mais "vencida": fechada, não paga e com o vencimento antes de hoje. */
export type SituacaoDaFatura = 'aberta' | 'fechada' | 'paga' | 'vencida'

export function situacaoDaFatura(f: Fatura, hoje: string): SituacaoDaFatura {
  const s = situacaoFatura(f, hoje)
  return s === 'fechada' && f.vencimento !== null && f.vencimento < hoje ? 'vencida' : s
}

/**
 * Faturas de todos os cartões que VENCEM no mês. Receita e transferência não têm fatura. Com filtro de conta, só as dos
 * cartões cuja conta de pagamento é aquela (a mesma regra do saldo projetado e da parcela de contrato planejada); cartão
 * sem conta de pagamento não aparece. A categoria não filtra aqui: quem filtra é listarComprasDasFaturas.
 */
export function listarFaturasDoMes(familiaId: string, mes: string, f: Filtros, hoje: string): Promise<FaturaDoMes[]> {
  return listarFaturasNoPeriodo(familiaId, ...limitesDoMes(mes), f, hoje)
}

/** Faturas com vencimento entre `de` e `ate`: o mesmo critério do mês, para qualquer período. */
export async function listarFaturasNoPeriodo(familiaId: string, de: string, ate: string, f: Filtros, hoje: string): Promise<FaturaDoMes[]> {
  if (f.tipo === 'income' || f.tipo === 'transfer') return []
  const { data, error } = await cliente().from('debts').select('id, name, pay_account_id').eq('household_id', familiaId).eq('kind', 'card')
  if (error) throw error
  const cartoes = ((data ?? []) as { id: string; name: string; pay_account_id: string | null }[])
    .filter((c) => !f.contaId || c.pay_account_id === f.contaId)
  // atalho: uma chamada de card_months por cartão (todo o histórico do cartão, para filtrar o mês aqui); ok com poucos
  // cartões, melhorar com uma função do banco por família e período se a lista ficar lenta com muitos cartões ou anos.
  const porCartao = await Promise.all(cartoes.map(async (c) => (await listarFaturas(c.id))
    .filter((x): x is Fatura & { vencimento: string } => x.vencimento !== null && x.vencimento >= de && x.vencimento <= ate)
    // fatura vazia não vira linha; a que só tem crédito avulso vira (desde 05/11/2026 o crédito aparece DENTRO da fatura)
    .filter((x) => x.itens > 0 || x.total > 0 || x.creditos > 0)
    .map((x) => ({
      cartaoId: c.id, cartaoNome: c.name, mes: x.mes, fechamento: x.fechamento, vencimento: x.vencimento, total: x.total,
      pago: x.pago, itens: x.itens, creditos: x.creditos, situacao: situacaoDaFatura(x, hoje), contaPagamentoId: c.pay_account_id ?? null,
    }))))
  return porCartao.flat().sort((x, y) => (x.vencimento < y.vencimento ? -1 : x.vencimento > y.vencimento ? 1 : x.cartaoNome.localeCompare(y.cartaoNome)))
}

/** Uma compra (parcela) de uma fatura do mês, como a tela Cartões mostra (card_items). */
export interface CompraDaFatura {
  id: string
  cartaoId: string
  cartaoNome: string
  /** Vencimento da fatura em que a compra está: é o dia em que ela aparece com filtro de categoria. */
  vencimento: string
  fechamento: string
  descricao: string
  dataCompra: string | null
  parcela: number
  deParcelas: number
  /** Valor da parcela (card_items.face), o mesmo da tela Cartões. */
  valor: Cents
  categoriaId: string | null
}

export async function listarComprasDaFatura(fatura: FaturaDoMes): Promise<CompraDaFatura[]> {
  return (await listarItens(fatura.cartaoId, fatura.mes)).map((i) => ({
    id: i.parcelaId, cartaoId: fatura.cartaoId, cartaoNome: fatura.cartaoNome, vencimento: fatura.vencimento,
    fechamento: fatura.fechamento, descricao: i.descricao, dataCompra: i.dataCompra, parcela: i.parcela,
    deParcelas: i.deParcelas, valor: i.valor, categoriaId: i.categoriaId ?? null,
  }))
}

/**
 * Com filtro de categoria, agrupar não faz sentido (o total da fatura mistura categorias): as compras daquela categoria,
 * das mesmas faturas do mês, aparecem uma a uma no dia do vencimento. Assim tirar o filtro só reagrupa as mesmas linhas.
 */
export async function listarComprasDasFaturas(faturas: FaturaDoMes[], categoriaId: string): Promise<CompraDaFatura[]> {
  const todas = await Promise.all(faturas.map(listarComprasDaFatura))
  return todas.flat().filter((c) => c.categoriaId === categoriaId)
}

/**
 * Crédito avulso no cartão (migration 052: estorno de IOF, cashback, reembolso). É RECEITA e já está nos totais do mês
 * (period_summary); esta lista só mostra a linha, sem somar nada. A linha fica no dia do FECHAMENTO da fatura em que o
 * crédito entrou, que é o dia (e o mês) em que ele conta nos totais; o dia do crédito vai no subtítulo. Antes do
 * fechamento é receita planejada (decisão do dono, 04/11/2026).
 */
export interface CreditoDeCartao {
  id: string
  /** Fechamento da fatura: dia em que a receita conta. */
  data: string
  /** Dia em que o crédito aconteceu. */
  dataCredito: string
  descricao: string
  cartaoNome: string
  categoriaId: string | null
  valor: Cents
  /** A fatura ainda não fechou: receita planejada. */
  planejado: boolean
  /**
   * Vencimento da fatura, quando o crédito veio das faturas do mês (filtro de categoria): é o dia em que ele aparece
   * solto, como as compras. null quando veio de listarCreditosDeCartao (filtro Receita): aparece no fechamento.
   */
  vencimento: string | null
}

const COLUNA_INEXISTENTE = '42703'

/** Sem conta (o dinheiro não passou por conta): some com filtro de conta, de despesa ou de transferência. */
export function listarCreditosDeCartao(familiaId: string, mes: string, f: Filtros, hoje: string): Promise<CreditoDeCartao[]> {
  return listarCreditosDeCartaoNoPeriodo(familiaId, ...limitesDoMes(mes), f, hoje)
}

export async function listarCreditosDeCartaoNoPeriodo(familiaId: string, de: string, ate: string, f: Filtros, hoje: string): Promise<CreditoDeCartao[]> {
  if (f.contaId || f.tipo === 'expense' || f.tipo === 'transfer') return []
  const db = cliente()
  let q = db.from('debt_events').select('id, debt_id, date, credit_date, amount, category_id, note')
    .eq('household_id', familiaId).eq('kind', 'income_credit').is('voided_at', null).gte('date', de).lte('date', ate)
  if (f.categoriaId) q = q.eq('category_id', f.categoriaId)
  const { data, error } = await q.order('date', { ascending: false }).order('id')
  // banco ainda sem a migration 052: não há créditos avulsos
  if (error?.code === COLUNA_INEXISTENTE) return []
  if (error) throw error
  const eventos = (data ?? []) as { id: string; debt_id: string; date: string; credit_date: string | null; amount: number | string; category_id: string | null; note: string | null }[]
  if (eventos.length === 0) return []
  const dividas = await db.from('debts').select('id, name').eq('household_id', familiaId).eq('kind', 'card')
  if (dividas.error) throw dividas.error
  const nome = new Map(((dividas.data ?? []) as { id: string; name: string }[]).map((d) => [d.id, d.name]))
  return eventos.map((e) => ({
    id: e.id,
    data: e.date,
    dataCredito: e.credit_date ?? e.date,
    descricao: e.note || 'Crédito no cartão',
    cartaoNome: nome.get(e.debt_id) ?? 'cartão',
    categoriaId: e.category_id,
    valor: centsFromDb(e.amount),
    planejado: e.date > hoje,
    vencimento: null,
  }))
}

/**
 * Créditos avulsos de UMA fatura do mês (decisão do dono, 05/11/2026): ficam DENTRO da linha "Fatura <cartão>", em
 * "Ver compras", e não soltos no fechamento. Só lista: o total da fatura (card_months) já os desconta.
 */
export async function listarCreditosDaFaturaDoMes(fatura: FaturaDoMes, hoje: string): Promise<CreditoDeCartao[]> {
  if (fatura.creditos <= 0) return []
  return (await listarCreditosDaFatura(fatura.cartaoId, fatura.mes)).map((k) => ({
    id: k.id, data: k.fechamento, dataCredito: k.dataCredito, descricao: k.descricao || 'Crédito no cartão',
    cartaoNome: fatura.cartaoNome, categoriaId: k.categoriaId ?? null, valor: k.valor, planejado: k.fechamento > hoje,
    vencimento: fatura.vencimento,
  }))
}

/**
 * Com filtro de categoria (sem filtro de tipo): os créditos daquela categoria, das MESMAS faturas do mês, saem soltos no
 * dia do vencimento, como as compras (listarComprasDasFaturas). Tirar o filtro só os devolve para dentro da fatura.
 */
export async function listarCreditosDasFaturas(faturas: FaturaDoMes[], categoriaId: string, hoje: string): Promise<CreditoDeCartao[]> {
  const todos = await Promise.all(faturas.map((f) => listarCreditosDaFaturaDoMes(f, hoje)))
  return todos.flat().filter((k) => k.categoriaId === categoriaId)
}

export async function resumoDoMes(familiaId: string, mes: string): Promise<ResumoMes> {
  const [de, ate] = limitesDoMes(mes)
  return resumoDoPeriodo(familiaId, de, ate)
}

/** Mesmo dia do ano anterior; 29/02 vira 28/02. Para comparar períodos do mesmo tamanho. */
export function mesmoDiaAnoPassado(iso: string): string {
  const [a, m, d] = iso.split('-').map(Number)
  const ultimo = new Date(Date.UTC(a - 1, m, 0)).getUTCDate()
  return `${a - 1}-${String(m).padStart(2, '0')}-${String(Math.min(d, ultimo)).padStart(2, '0')}`
}

/** Mesmo dia no mês anterior; se ele não existir (31/03 → fevereiro), o último dia daquele mês. */
export function mesmoDiaMesAnterior(iso: string): string {
  const [a, m, d] = iso.split('-').map(Number)
  const ant = new Date(Date.UTC(a, m - 2, 1))
  const ultimo = new Date(Date.UTC(ant.getUTCFullYear(), ant.getUTCMonth() + 1, 0)).getUTCDate()
  return `${ant.getUTCFullYear()}-${String(ant.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(d, ultimo)).padStart(2, '0')}`
}

/** Totais de um período qualquer, calculados no banco (period_summary). */
export async function resumoDoPeriodo(familiaId: string, de: string, ate: string): Promise<ResumoMes> {
  const { data, error } = await cliente().rpc('period_summary', { p_household: familiaId, p_from: de, p_to: ate })
  if (error) throw error
  const r = ((data ?? []) as Record<string, number | string>[])[0] ?? {}
  return {
    receitas: centsFromDb(r.income_paid ?? 0),
    despesas: centsFromDb(r.expense_paid ?? 0),
    resultado: centsFromDb(r.result ?? 0),
    receitasPrevistas: centsFromDb(r.income_planned ?? 0),
    despesasPrevistas: centsFromDb(r.expense_planned ?? 0),
  }
}

/**
 * Receita, despesa e resultado PAGOS do período em cada moeda que não é BRL, sem conversão (period_summary_by_currency,
 * migration 056). O BRL é o resumoDoPeriodo; nunca somar os dois. Banco sem a migration 056: lista vazia.
 */
export interface ResumoPorMoeda { moeda: string; receitas: Cents; despesas: Cents; resultado: Cents }

const FUNCAO_INEXISTENTE = ['PGRST202', '42883']

export async function resumoPorMoeda(familiaId: string, de: string, ate: string): Promise<ResumoPorMoeda[]> {
  const { data, error } = await cliente().rpc('period_summary_by_currency', { p_household: familiaId, p_from: de, p_to: ate })
  if (error) {
    if (FUNCAO_INEXISTENTE.includes(error.code ?? '')) return []
    throw error
  }
  return ((data ?? []) as { currency_code: string; income: number | string; expense: number | string; result: number | string }[])
    .map((m) => ({ moeda: m.currency_code, receitas: centsFromDb(m.income), despesas: centsFromDb(m.expense), resultado: centsFromDb(m.result) }))
}

function linha(d: DadosLancamento) {
  const transferencia = d.tipo === 'transfer'
  return {
    type: d.tipo,
    account_id: d.contaId,
    destination_account_id: transferencia ? d.destinoId : null,
    category_id: transferencia ? null : d.categoriaId,
    description: d.descricao.trim(),
    // string decimal montada dos centavos, nunca cents / 100 (MODELO-DE-DADOS.md §5)
    amount: centsToDecimal(d.valor),
    date: d.data,
    status: d.status,
    notes: d.notas.trim() || null,
    person_id: d.tipo === 'expense' ? d.personId ?? null : null,
    is_shared_expense: d.tipo === 'expense' ? d.isSharedExpense ?? false : false,
  }
}

export async function criarLancamento(familiaId: string, d: DadosLancamento): Promise<void> {
  const { error } = await cliente().from('transactions').insert({ household_id: familiaId, ...linha(d) })
  if (error) throw error
}

export async function editarLancamento(id: string, d: DadosLancamento): Promise<void> {
  const { error } = await cliente().from('transactions').update(linha(d)).eq('id', id)
  if (error) throw error
}

/**
 * Editar um lançamento que veio de um recorrente pergunta "Este lançamento se repete em outras datas. O que deseja
 * fazer?" (pedido do dono, #194, como no Organizze) só quando muda o que a regra tem: valor, data, descrição ou
 * categoria. Situação (pago/planejado), observação e conta não perguntam (valem só para este). Trocar o tipo também não:
 * a regra não muda de tipo, então vale só para este.
 */
export function perguntaSeRepete(original: Lancamento, novo: DadosLancamento): boolean {
  if (!original.recorrente || novo.tipo !== original.tipo) return false
  return novo.valor !== original.valor || novo.data !== original.data || novo.descricao.trim() !== original.descricao.trim()
    || (novo.tipo !== 'transfer' && novo.categoriaId !== original.categoriaId)
    || (novo.tipo === 'expense' && (novo.personId ?? null) !== (original.personId ?? null))
    || (novo.tipo === 'expense' && (novo.isSharedExpense ?? false) !== (original.isSharedExpense ?? false))
}

/**
 * "Este e os próximos" (migration 074, recurrence_update_from): o banco muda esta ocorrência e a regra (valor,
 * descrição, categoria e, se a data mudou, o dia), e as próximas planejadas que ninguém corrigiu acompanham; pagas, na
 * lixeira e corrigidas à mão ficam. Situação, observação e conta (e o destino da transferência) vão na MESMA chamada e
 * valem só para este: o banco grava tudo ou nada (período conciliado, conta desativada etc. recusam sem mudar a regra).
 * Devolve quantas próximas acompanharam.
 */
export async function editarEsteEProximos(id: string, d: DadosLancamento): Promise<number> {
  const l = linha(d)
  const { data, error } = await cliente().rpc('recurrence_update_from', {
    p_transaction: id,
    p_date: l.date,
    p_description: l.description,
    p_amount: l.amount,
    p_category: l.category_id,
    p_status: l.status,
    p_notes: l.notes,
    p_account: l.account_id,
    p_destination: l.destination_account_id,
  })
  if (error) throw error
  return Number(data ?? 0)
}

/**
 * "Parar de repetir a partir daqui" (migration 031/074, recurrence_end): o recorrente deixa de existir; os planejados desta data em
 * diante (inclusive os corrigidos à mão) vão para a lixeira. O que já foi pago e os planejados de antes desta data ficam como
 * lançamentos avulsos, sem o vínculo com a regra. É o caminho de encerrar uma conta fixa depois que Recorrentes virou só consulta.
 */
export async function pararDeRepetirAPartirDe(recorrenciaId: string, data: string): Promise<void> {
  const [a, m, d] = data.split('-').map(Number)
  const vespera = new Date(Date.UTC(a, m - 1, d - 1)).toISOString().slice(0, 10)
  const { error } = await cliente().rpc('recurrence_end', { p_id: recorrenciaId, p_end: vespera })
  if (error) throw error
}

/**
 * Marca o planejado como pago com o que REALMENTE saiu ou entrou na conta. A data e o valor do planejado são só
 * estimativa (conta de luz paga dia 12 por 143,20, e não dia 10 por 150,00): sem trocar os dois, o saldo do dia
 * deixa de bater com o extrato. O banco confere período conciliado, abertura da conta e centavos.
 */
export async function marcarComoPago(id: string, real: { data: string; valor: Cents }): Promise<void> {
  const { error } = await cliente()
    .from('transactions')
    .update({ status: 'paid', date: real.data, amount: centsToDecimal(real.valor) })
    .eq('id', id)
  if (error) throw error
}

/** O cliente nunca apaga lançamento: vai para a lixeira (deleted_at) e pode ser restaurado. */
export async function moverParaLixeira(id: string): Promise<void> {
  const { error } = await cliente().from('transactions').update({ deleted_at: new Date().toISOString() }).eq('id', id)
  if (error) throw error
}

export async function restaurarDaLixeira(id: string): Promise<void> {
  const { error } = await cliente().from('transactions').update({ deleted_at: null }).eq('id', id)
  if (error) throw error
}

/**
 * Valor de cada parcela, como o banco divide (transaction_installments_create): o mesmo valor inteiro em centavos em
 * todas e a sobra somada à primeira. Só para a prévia na tela: quem grava os valores é o banco.
 */
export function valoresDasParcelas(total: Cents, parcelas: number): Cents[] {
  const base = Math.floor(total / parcelas)
  return Array.from({ length: parcelas }, (_, i) => (i === 0 ? total - base * (parcelas - 1) : base) as Cents)
}

export interface DadosParcelado {
  tipo: TipoLancamento
  descricao: string
  total: Cents
  parcelas: number
  unidade: 'month' | 'week' | 'day'
  cada: number
  primeira: string
  contaId: string
  destinoId: string | null
  categoriaId: string | null
  primeiraPaga: boolean
  personId?: string | null
  isSharedExpense?: boolean
}

/** Cria as N parcelas de uma vez no banco (todas ou nenhuma); devolve o id do grupo. */
export async function criarParcelado(d: DadosParcelado): Promise<string> {
  const args = {
    p_kind: d.tipo, p_description: d.descricao.trim(), p_total: centsToDecimal(d.total), p_count: d.parcelas,
    p_unit: d.unidade, p_every: d.cada, p_first: d.primeira, p_account: d.contaId,
    p_destination: d.tipo === 'transfer' ? d.destinoId : null, p_category: d.tipo === 'transfer' ? null : d.categoriaId,
    p_first_paid: d.primeiraPaga,
    p_person_id: d.tipo === 'expense' ? d.personId ?? null : null,
    p_is_shared_expense: d.tipo === 'expense' ? d.isSharedExpense ?? false : false,
  }
  let { data, error } = await cliente().rpc('transaction_installments_create_classified', args)
  if (error && ['PGRST202', '42883'].includes(error.code ?? '') && !args.p_person_id && !args.p_is_shared_expense) {
    const antigo = await cliente().rpc('transaction_installments_create', {
      p_kind: args.p_kind, p_description: args.p_description, p_total: args.p_total, p_count: args.p_count,
      p_unit: args.p_unit, p_every: args.p_every, p_first: args.p_first, p_account: args.p_account,
      p_destination: args.p_destination, p_category: args.p_category, p_first_paid: args.p_first_paid,
    })
    data = antigo.data
    error = antigo.error
  }
  if (error) throw error
  return data as string
}

/**
 * Edição em lote (migration 060): cada chamada é UMA operação no banco, tudo ou nada, com as mesmas guardas do UPDATE de
 * um só (período conciliado, conta desativada, moeda, categoria do tipo certo). No máximo LIMITE_LOTE ids por chamada.
 * Devolvem quantos lançamentos o banco de fato alterou.
 */
export const LIMITE_LOTE = 500

async function rpcLote(nome: string, args: Record<string, unknown>): Promise<number> {
  const { data, error } = await cliente().rpc(nome, args)
  if (error) throw error
  return Number(data ?? 0)
}

/** Só receita e despesa; transferência é recusada (não tem categoria). */
export function mudarCategoriaEmLote(ids: string[], categoriaId: string): Promise<number> {
  return rpcLote('transactions_bulk_set_category', { p_ids: ids, p_category: categoriaId })
}

/** Planejado → pago na data informada (o valor de cada um não muda). */
export function marcarPagoEmLote(ids: string[], data: string): Promise<number> {
  return rpcLote('transactions_bulk_mark_paid', { p_ids: ids, p_date: data })
}

/** "Desfazer" do pago: volta a planejado, cada um na data que tinha (datas na mesma ordem dos ids). */
export function voltarPlanejadoEmLote(ids: string[], datas: string[]): Promise<number> {
  return rpcLote('transactions_bulk_mark_planned', { p_ids: ids, p_dates: datas })
}

export function moverParaLixeiraEmLote(ids: string[]): Promise<number> {
  return rpcLote('transactions_bulk_trash', { p_ids: ids })
}

export function restaurarDaLixeiraEmLote(ids: string[]): Promise<number> {
  return rpcLote('transactions_bulk_restore', { p_ids: ids })
}
