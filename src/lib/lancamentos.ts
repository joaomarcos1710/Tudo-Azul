import { centsFromDb, centsToDecimal } from './format'
import type { Cents } from './format'
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
  /** Gerado por uma regra recorrente (só leitura: o vínculo é gravado pelo banco). */
  recorrente?: boolean
}

export type DadosLancamento = Omit<Lancamento, 'id' | 'recorrente'>

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
}

export async function listarLancamentos(familiaId: string, mes: string, f: Filtros = {}): Promise<Lancamento[]> {
  const [de, ate] = limitesDoMes(mes)
  let consulta = cliente()
    .from('transactions')
    .select('id, type, account_id, destination_account_id, category_id, description, amount, date, status, notes, recurrence_id')
    .eq('household_id', familiaId)
    .is('deleted_at', null)
    .gte('date', de)
    .lte('date', ate)
  // conta filtra origem ou destino: a transferência aparece nas duas contas
  if (f.contaId) consulta = consulta.or(`account_id.eq.${f.contaId},destination_account_id.eq.${f.contaId}`)
  if (f.categoriaId) consulta = consulta.eq('category_id', f.categoriaId)
  if (f.tipo) consulta = consulta.eq('type', f.tipo)
  const { data, error } = await consulta.order('date', { ascending: false }).order('created_at', { ascending: false })
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
    recorrente: t.recurrence_id != null,
  }))
}

/**
 * Movimento de cartão ou dívida que mexe numa conta (pagamento de fatura, juros, tarifa, empréstimo recebido...).
 * Só leitura no extrato: o saldo da conta e os totais do mês vêm do banco.
 * Pagamento, amortização, crédito e devolução NÃO são receita nem despesa (a compra já contou no mês da fatura);
 * juros e tarifa SÃO despesa (já estão em "Despesas pagas", na categoria do evento).
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
 * Receita e transferência não os incluem; com filtro de despesa ou de categoria, só juros e tarifa (que são despesa
 * e têm categoria); sem filtro, todos.
 */
export async function listarMovimentosDeDivida(familiaId: string, mes: string, f: Filtros = {}): Promise<MovimentoDivida[]> {
  if (f.tipo === 'income' || f.tipo === 'transfer') return []
  const [de, ate] = limitesDoMes(mes)
  const soDespesa = Boolean(f.categoriaId) || f.tipo === 'expense'
  const tipos = soDespesa ? ['interest', 'fee'] : [...eventosDeConta]
  const db = cliente()
  const eventos: { id: string; debt_id: string; date: string; kind: string; amount: number | string; account_id: string }[] = []
  const pagina = 1000
  for (let inicio = 0; ; inicio += pagina) {
    let q = db.from('debt_events').select('id, debt_id, date, kind, amount, account_id')
      .eq('household_id', familiaId).is('voided_at', null).in('kind', tipos).not('account_id', 'is', null)
      .gte('date', de).lte('date', ate)
    if (f.contaId) q = q.eq('account_id', f.contaId)
    if (f.categoriaId) q = q.eq('category_id', f.categoriaId)
    // ordem total (data, criação, id): a paginação não repete nem perde linha
    const { data, error } = await q.order('date', { ascending: false }).order('created_at', { ascending: false }).order('id')
      .range(inicio, inicio + pagina - 1)
    if (error) throw error
    eventos.push(...((data ?? []) as typeof eventos))
    if (!data || data.length < pagina) break
  }
  const dividas = await db.from('debts').select('id, name, kind').eq('household_id', familiaId)
  if (dividas.error) throw dividas.error
  const porId = new Map((dividas.data ?? []).map((d) => [d.id, d]))
  return eventos.map((e) => {
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
      jaEmDespesas: e.kind === 'interest' || e.kind === 'fee',
    }
  })
}

/**
 * Uma parcela de compra no cartão, mostrada no dia da compra. Só leitura: a despesa entra no mês em que a fatura
 * fecha (cobrança da parcela), e o total do mês vem do banco (period_summary). Compra cancelada não aparece.
 */
export interface ParcelaDeCartao {
  id: string
  data: string
  descricao: string
  cartaoNome: string
  /** Dia do fechamento da fatura do cartão, para explicar quando a despesa conta. Nulo se o cartão não tem ciclo. */
  fechamento: number | null
  parcela: number
  deParcelas: number
  valor: Cents
}

export async function listarComprasDeCartao(familiaId: string, mes: string): Promise<ParcelaDeCartao[]> {
  const [de, ate] = limitesDoMes(mes)
  const db = cliente()
  const parcelas: { id: string; debt_id: string; plan: string; seq: number; description: string | null; purchase_date: string; face: number | string }[] = []
  const pagina = 1000
  for (let inicio = 0; ; inicio += pagina) {
    const { data, error } = await db.from('debt_installments')
      .select('id, debt_id, plan, seq, description, purchase_date, face')
      .eq('household_id', familiaId).gte('purchase_date', de).lte('purchase_date', ate)
      .order('purchase_date', { ascending: false }).order('id')
      .range(inicio, inicio + pagina - 1)
    if (error) throw error
    parcelas.push(...((data ?? []) as typeof parcelas))
    if (!data || data.length < pagina) break
  }
  if (parcelas.length === 0) return []

  // total de parcelas de cada compra (contagem, não dinheiro): o plano inteiro, mesmo as canceladas
  const totalPorPlano = new Map<string, number>()
  for (const p of parcelas) totalPorPlano.set(`${p.debt_id}|${p.plan}`, (totalPorPlano.get(`${p.debt_id}|${p.plan}`) ?? 0) + 1)

  // parcelas com cancelamento (compra excluída) saem da lista
  const ids = parcelas.map((p) => p.id)
  const canceladas = new Set<string>()
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await db.from('debt_events').select('installment_id')
      .eq('household_id', familiaId).eq('kind', 'cancel').is('voided_at', null).in('installment_id', ids.slice(i, i + 200))
    if (error) throw error
    for (const e of data ?? []) if (e.installment_id) canceladas.add(e.installment_id as string)
  }

  const dividas = await db.from('debts').select('id, name, closing_day').eq('household_id', familiaId).eq('kind', 'card')
  if (dividas.error) throw dividas.error
  const cartao = new Map((dividas.data ?? []).map((d) => [d.id, d]))

  return parcelas.filter((p) => !canceladas.has(p.id) && cartao.has(p.debt_id)).map((p) => {
    const c = cartao.get(p.debt_id)!
    return {
      id: p.id,
      data: p.purchase_date,
      descricao: p.description || 'Compra no cartão',
      cartaoNome: c.name,
      fechamento: c.closing_day ?? null,
      parcela: p.seq,
      deParcelas: totalPorPlano.get(`${p.debt_id}|${p.plan}`) ?? 1,
      valor: centsFromDb(p.face),
    }
  })
}

export async function resumoDoMes(familiaId: string, mes: string): Promise<ResumoMes> {
  const [de, ate] = limitesDoMes(mes)
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
