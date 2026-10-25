import { centsFromDb, centsToDecimal } from './format'
import type { Cents } from './format'
import { hojeSP } from './contas'
import { supabase } from './supabase'

/**
 * Cartão de crédito (migrations 002, 004 e 005). Toda regra de dinheiro fica no banco:
 * em que fatura cai cada parcela, quando vira despesa, totais da fatura e o que falta cobrar.
 */
export interface Cartao {
  id: string
  nome: string
  /** null em cartão criado antes do ciclo existir: compras ficam bloqueadas até definir. */
  fechamento: number | null
  vencimento: number | null
  ativo: boolean
  /** Fatura cobrada e ainda não paga (dívida do cartão hoje). */
  divida: Cents
  /** Crédito a receber (estorno maior que a dívida). */
  credito: Cents
  /** Parcelas futuras ainda não cobradas. */
  compromissos: Cents
}

export interface Fatura {
  /** AAAA-MM do fechamento. */
  mes: string
  fechamento: string
  vencimento: string | null
  cobrado: Cents
  aCobrar: Cents
  total: Cents
  pago: Cents
  itens: number
  faturaId: string | null
  /** O que ficou sem pagar das faturas anteriores ("saldo anterior"). */
  saldoAnterior: Cents
  /** Adiantamento disponível ao chegar nesta fatura e o que sobra depois dela. */
  adiantamentoEntrada: Cents
  adiantamentoSaida: Cents
}

export interface ItemFatura {
  parcelaId: string
  compra: string
  parcela: number
  deParcelas: number
  descricao: string
  dataCompra: string | null
  valor: Cents
  /** Quanto da parcela ainda não foi cobrado (0 = já está na fatura fechada). */
  falta: Cents
  categoriaId: string
}

/** Uma linha da prévia de exclusão: o que será desfeito (cobrança, pagamento devolvido, cancelamento). */
export interface ItemPrevia {
  tipo: 'charge' | 'credit' | 'payment' | 'extra_principal' | 'cancel' | string
  data: string
  valor: Cents
  contaId: string | null
  fatura: string | null
}

export interface DadosCompra {
  descricao: string
  data: string
  total: Cents
  parcelas: number
  categoriaId: string
}

function cliente() {
  if (!supabase) throw new Error('Supabase não configurado')
  return supabase
}

/** Ontem em São Paulo: a "data de referência" do cartão, para aceitar compras a partir de hoje. */
export function ontemSP(agora: Date = new Date()): string {
  const [a, m, d] = hojeSP(agora).split('-').map(Number)
  return new Date(Date.UTC(a, m - 1, d - 1)).toISOString().slice(0, 10)
}

export async function listarCartoes(familiaId: string, dataRef: string = hojeSP()): Promise<Cartao[]> {
  const db = cliente()
  const [cartoes, saldos] = await Promise.all([
    db.from('debts').select('id, name, closing_day, due_day, active').eq('household_id', familiaId).eq('kind', 'card').order('name'),
    db.rpc('debt_balances', { p_household: familiaId, p_as_of: dataRef }),
  ])
  for (const r of [cartoes, saldos]) if (r.error) throw r.error
  const porId = new Map(
    ((saldos.data ?? []) as { debt_id: string; debt: number | string; credit_receivable: number | string; planned_remaining: number | string }[])
      .map((s) => [s.debt_id, s]),
  )
  return (cartoes.data ?? []).map((c) => {
    const s = porId.get(c.id)
    return {
      id: c.id,
      nome: c.name,
      fechamento: c.closing_day,
      vencimento: c.due_day,
      ativo: c.active,
      divida: centsFromDb(s?.debt ?? 0),
      credito: centsFromDb(s?.credit_receivable ?? 0),
      compromissos: centsFromDb(s?.planned_remaining ?? 0),
    }
  })
}

/**
 * Cria o cartão já com o ciclo. saldoAtual = faturas fechadas e ainda não pagas hoje;
 * compras da fatura aberta entram depois, como compras (assim cada uma cai no mês certo).
 */
export async function criarCartao(d: { nome: string; fechamento: number; vencimento: number; saldoAtual: Cents }): Promise<string> {
  const db = cliente()
  const { data: id, error } = await db.rpc('create_debt', {
    p_name: d.nome.trim(), p_kind: 'card', p_reference_date: ontemSP(), p_reference_balance: centsToDecimal(d.saldoAtual),
  })
  if (error) throw error
  await definirCiclo(id as string, d.fechamento, d.vencimento)
  return id as string
}

export async function definirCiclo(cartaoId: string, fechamento: number, vencimento: number): Promise<void> {
  const { error } = await cliente().rpc('set_card_cycle', { p_debt: cartaoId, p_closing_day: fechamento, p_due_day: vencimento })
  if (error) throw error
}

/** Chave de repetição: o mesmo envio (clique duplo, rede ruim) nunca grava duas vezes. */
export function novaChave(): string {
  return crypto.randomUUID()
}

export async function registrarCompra(cartaoId: string, d: DadosCompra, chave?: string): Promise<void> {
  const { error } = await cliente().rpc('card_purchase', {
    p_debt: cartaoId, p_date: d.data, p_total: centsToDecimal(d.total), p_count: d.parcelas,
    p_category: d.categoriaId, p_description: d.descricao.trim(), ...(chave ? { p_idem: chave } : {}),
  })
  if (error) throw error
}

/** Cobra as parcelas cujo fechamento já chegou (idempotente). Chamado ao abrir o app e a tela. */
export async function cobrarFaturasFechadas(): Promise<number> {
  const { data, error } = await cliente().rpc('card_bill_due', {})
  if (error) throw error
  return (data as number) ?? 0
}

export async function listarFaturas(cartaoId: string): Promise<Fatura[]> {
  const { data, error } = await cliente().rpc('card_months', { p_debt: cartaoId })
  if (error) throw error
  return ((data ?? []) as Record<string, string | number | null>[]).map((f) => ({
    mes: f.label as string,
    fechamento: f.closing_date as string,
    vencimento: (f.due_date as string | null) ?? null,
    cobrado: centsFromDb(f.charged ?? 0),
    aCobrar: centsFromDb(f.pending ?? 0),
    total: centsFromDb(f.total ?? 0),
    pago: centsFromDb(f.paid ?? 0),
    itens: Number(f.items ?? 0),
    faturaId: (f.invoice_id as string | null) ?? null,
    saldoAnterior: centsFromDb(f.previous_open ?? 0),
    adiantamentoEntrada: centsFromDb(f.advance_in ?? 0),
    adiantamentoSaida: centsFromDb(f.advance_out ?? 0),
  }))
}

export async function listarItens(cartaoId: string, mes: string): Promise<ItemFatura[]> {
  const { data, error } = await cliente().rpc('card_items', { p_debt: cartaoId, p_label: mes })
  if (error) throw error
  return ((data ?? []) as Record<string, string | number | null>[]).map((i) => ({
    parcelaId: i.installment_id as string,
    compra: i.plan as string,
    parcela: Number(i.seq),
    deParcelas: Number(i.plan_count),
    descricao: (i.description as string | null) ?? 'Compra',
    dataCompra: (i.purchase_date as string | null) ?? null,
    valor: centsFromDb(i.face ?? 0),
    falta: centsFromDb(i.remaining ?? 0),
    categoriaId: i.category_id as string,
  }))
}

/** Pagamento da fatura a partir de uma conta: reduz a dívida, não é despesa. */
export async function pagarFatura(
  cartaoId: string, d: { contaId: string; data: string; valor: Cents; faturaId: string | null }, chave?: string,
): Promise<void> {
  const { error } = await cliente().rpc('debt_pay', {
    p_debt: cartaoId, p_date: d.data, p_account: d.contaId, p_amount: centsToDecimal(d.valor), p_invoice: d.faturaId,
    ...(chave ? { p_idem: chave } : {}),
  })
  if (error) throw error
}

/** Reabre a fatura: desfaz os pagamentos ligados a ela e o dinheiro volta para a conta. Devolve quantos desfez. */
export async function reabrirFatura(cartaoId: string, mes: string, motivo = 'fatura reaberta'): Promise<number> {
  const { data, error } = await cliente().rpc('card_invoice_reopen', { p_debt: cartaoId, p_label: mes, p_reason: motivo })
  if (error) throw error
  return (data as number) ?? 0
}

/** Tudo o que a exclusão da compra inteira vai desfazer (nada é gravado). */
export async function previaExclusao(cartaoId: string, compra: string): Promise<ItemPrevia[]> {
  const { data, error } = await cliente().rpc('card_purchase_delete_preview', { p_debt: cartaoId, p_plan: compra })
  if (error) throw error
  return ((data ?? []) as Record<string, string | number | null>[]).map((r) => ({
    tipo: r.item as string,
    data: r.event_date as string,
    valor: centsFromDb(r.amount ?? 0),
    contaId: (r.account_id as string | null) ?? null,
    fatura: (r.invoice_label as string | null) ?? null,
  }))
}

/** Exclui a compra inteira (todas as parcelas). Pagamentos das faturas envolvidas são desfeitos. */
export async function excluirCompra(cartaoId: string, compra: string, motivo = 'compra excluída'): Promise<void> {
  const { error } = await cliente().rpc('card_purchase_delete', { p_debt: cartaoId, p_plan: compra, p_reason: motivo })
  if (error) throw error
}

/** Corrige o valor de UMA parcela (o banco ajusta a fatura; fatura paga precisa ser reaberta antes). */
export async function editarParcela(parcelaId: string, valor: Cents, motivo?: string): Promise<void> {
  const { error } = await cliente().rpc('card_installment_edit', {
    p_installment: parcelaId, p_face: centsToDecimal(valor), ...(motivo ? { p_reason: motivo } : {}),
  })
  if (error) throw error
}

/** Situação da fatura para a tela (comparações de valores já calculados no banco). */
export function situacaoFatura(f: Fatura, hoje: string): 'aberta' | 'fechada' | 'paga' {
  if (f.fechamento > hoje) return 'aberta'
  return f.cobrado <= 0 || f.pago >= f.cobrado ? 'paga' : 'fechada'
}

/** Pagamentos e devoluções que mexem no saldo do cartão (os que podem ser anulados pela tela). */
export interface MovimentoCartao {
  id: string
  data: string
  tipo: 'pagamento' | 'amortizacao' | 'devolucao'
  valor: Cents
  /** Pagamento ligado a uma fatura (vira "fatura paga" nela). */
  ligadoAFatura: boolean
}

export async function listarMovimentosDoCartao(cartaoId: string): Promise<MovimentoCartao[]> {
  const { data, error } = await cliente()
    .from('debt_events')
    .select('id, date, kind, amount, invoice_id, created_at')
    .eq('debt_id', cartaoId)
    .is('voided_at', null)
    .in('kind', ['payment', 'extra_principal', 'refund_cash'])
    .order('date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(30)
  if (error) throw error
  const tipos: Record<string, MovimentoCartao['tipo']> = { payment: 'pagamento', extra_principal: 'amortizacao', refund_cash: 'devolucao' }
  return (data ?? []).map((e) => ({
    id: e.id,
    data: e.date,
    tipo: tipos[e.kind],
    valor: centsFromDb(e.amount),
    ligadoAFatura: e.invoice_id != null,
  }))
}

/** Anula um pagamento ou devolução (correção). O banco recalcula dívida e crédito e registra o motivo. */
export async function anularMovimentoCartao(eventoId: string, motivo: string): Promise<void> {
  const { error } = await cliente().rpc('debt_void', { p_event: eventoId, p_reason: motivo })
  if (error) throw error
}
