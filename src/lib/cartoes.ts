import { centsFromDb, centsToDecimal } from './format'
import type { Cents } from './format'
import { COLUNA_INEXISTENTE, hojeSP } from './contas'
import { supabase } from './supabase'

/**
 * Cartão de crédito (migrations 002, 004 e 005). Toda regra de dinheiro fica no banco:
 * em que fatura cai cada parcela, quando vira despesa, totais da fatura e o que falta cobrar.
 */
export interface Cartao {
  id: string
  nome: string
  /** Chave do banco emissor (debts.issuer) e da bandeira (debts.brand); null = não escolhidos. */
  emissor: string | null
  bandeira: string | null
  /** Conta que paga a fatura (debts.pay_account_id, migration 024); null = não escolhida. Sugestão no pagamento e base do saldo projetado. */
  contaPagamentoId: string | null
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
  /** Limite informado pelo dono (migration 011); null = não informado. Só acompanhamento, nada é bloqueado. */
  limite: Cents | null
  /** Dívida + parcelas futuras − crédito, calculado no banco (card_limits). null sem limite. */
  limiteComprometido: Cents | null
  /** Limite − comprometido; negativo = passou do limite. null sem limite. */
  limiteDisponivel: Cents | null
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
  /** Créditos avulsos (receita) que abatem esta fatura (migration 052); já descontados de `cobrado` e de `total`. */
  creditos: Cents
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

/** Crédito avulso na fatura (estorno de IOF, cashback, reembolso): conta como RECEITA no mês do fechamento (migration 052). */
export interface CreditoFatura {
  id: string
  descricao: string
  /** Quando o crédito aconteceu (informado pela pessoa). */
  dataCredito: string
  /** Fechamento da fatura em que entrou (é o mês da receita). */
  fechamento: string
  valor: Cents
  categoriaId: string
}

export interface DadosCredito {
  descricao: string
  data: string
  valor: Cents
  /** Categoria de RECEITA. */
  categoriaId: string
  /** Fechamento (AAAA-MM-DD) de uma fatura posterior; null/ausente = a fatura aberta na data do crédito (o banco calcula). */
  fechamento?: string | null
}

export interface DadosCompra {
  descricao: string
  data: string
  total: Cents
  parcelas: number
  categoriaId: string
  /** Em qual fatura lançar: 0 = a que a data dá; -3 a +3 = tantas faturas antes ou depois (migration 051). */
  deslocamento?: number
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

interface LinhaCartao { id: string; name: string; closing_day: number | null; due_day: number | null; active: boolean; issuer?: string | null; brand?: string | null; pay_account_id?: string | null }

export async function listarCartoes(familiaId: string, dataRef: string = hojeSP()): Promise<Cartao[]> {
  const db = cliente()
  const lerCartoes = async (): Promise<{ data: LinhaCartao[]; error: { code?: string } | null }> => {
    // colunas novas ainda inexistentes (banco sem a migration 024, depois sem a 017): segue sem elas em vez de quebrar a tela
    for (const colunas of ['id, name, closing_day, due_day, active, issuer, brand, pay_account_id', 'id, name, closing_day, due_day, active, issuer, brand']) {
      const r = await db.from('debts').select(colunas).eq('household_id', familiaId).eq('kind', 'card').order('name')
      if (r.error?.code !== COLUNA_INEXISTENTE) return { data: (r.data ?? []) as unknown as LinhaCartao[], error: r.error }
    }
    const sem = await db.from('debts').select('id, name, closing_day, due_day, active').eq('household_id', familiaId).eq('kind', 'card').order('name')
    return { data: (sem.data ?? []) as unknown as LinhaCartao[], error: sem.error }
  }
  const [cartoes, saldos, limites] = await Promise.all([
    lerCartoes(),
    db.rpc('debt_balances', { p_household: familiaId, p_as_of: dataRef }),
    // o limite é um extra: se a consulta falhar (ex.: banco ainda sem a migration 011), a tela segue sem ele
    db.rpc('card_limits', { p_household: familiaId, p_as_of: dataRef }),
  ])
  for (const r of [cartoes, saldos]) if (r.error) throw r.error
  const limitePorId = new Map(
    (limites.error ? [] : ((limites.data ?? []) as { debt_id: string; credit_limit: number | string; committed: number | string; available: number | string }[]))
      .map((l) => [l.debt_id, l]),
  )
  const porId = new Map(
    ((saldos.data ?? []) as { debt_id: string; debt: number | string; credit_receivable: number | string; planned_remaining: number | string }[])
      .map((s) => [s.debt_id, s]),
  )
  return cartoes.data.map((c) => {
    const s = porId.get(c.id)
    const l = limitePorId.get(c.id)
    return {
      id: c.id,
      nome: c.name,
      emissor: c.issuer ?? null,
      bandeira: c.brand ?? null,
      contaPagamentoId: c.pay_account_id ?? null,
      fechamento: c.closing_day,
      vencimento: c.due_day,
      ativo: c.active,
      divida: centsFromDb(s?.debt ?? 0),
      credito: centsFromDb(s?.credit_receivable ?? 0),
      compromissos: centsFromDb(s?.planned_remaining ?? 0),
      limite: l ? centsFromDb(l.credit_limit) : null,
      limiteComprometido: l ? centsFromDb(l.committed) : null,
      limiteDisponivel: l ? centsFromDb(l.available) : null,
    }
  })
}

/**
 * Cria o cartão já com o ciclo. saldoAtual = faturas fechadas e ainda não pagas hoje;
 * compras da fatura aberta entram depois, como compras (assim cada uma cai no mês certo).
 */
export async function criarCartao(d: { nome: string; fechamento: number; vencimento: number; saldoAtual: Cents; emissor?: string | null; bandeira?: string | null; contaPagamentoId?: string | null }): Promise<string> {
  const { data: id, error } = await cliente().rpc('create_card', {
    p_name: d.nome.trim(),
    p_reference_date: ontemSP(),
    p_reference_balance: centsToDecimal(d.saldoAtual),
    p_closing_day: d.fechamento,
    p_due_day: d.vencimento,
    p_issuer: d.emissor ?? null,
    p_brand: d.bandeira ?? null,
    p_pay_account: d.contaPagamentoId ?? null,
  })
  if (error) throw error
  return id as string
}

export async function definirCiclo(cartaoId: string, fechamento: number, vencimento: number): Promise<void> {
  const { error } = await cliente().rpc('set_card_cycle', { p_debt: cartaoId, p_closing_day: fechamento, p_due_day: vencimento })
  if (error) throw error
}

/** Grava o banco emissor e a bandeira do cartão (null apaga). O banco recusa chave inválida ou bandeira desconhecida. */
export async function definirIdentidade(cartaoId: string, emissor: string | null, bandeira: string | null): Promise<void> {
  const { error } = await cliente().rpc('set_card_identity', { p_debt: cartaoId, p_issuer: emissor, p_brand: bandeira })
  if (error) throw error
}

/** Escolhe a conta que paga a fatura do cartão (null apaga). O banco recusa conta arquivada ou de outra família. */
export async function definirContaPagamento(cartaoId: string, contaId: string | null): Promise<void> {
  const { error } = await cliente().rpc('set_card_pay_account', { p_debt: cartaoId, p_account: contaId })
  if (error) throw error
}

/** Define ou muda o limite do cartão; null apaga. O banco recusa valor zero, negativo ou com mais de 2 casas. */
export async function definirLimite(cartaoId: string, limite: Cents | null): Promise<void> {
  const { error } = await cliente().rpc('set_card_limit', { p_debt: cartaoId, p_limit: limite === null ? null : centsToDecimal(limite) })
  if (error) throw error
}

/** Corrige o nome do cartão. Nome repetido na família: o banco recusa (23505). Não mexe em dívida, parcelas nem histórico. */
export async function renomearCartao(cartaoId: string, nome: string): Promise<void> {
  const { error } = await cliente().rpc('debt_rename', { p_id: cartaoId, p_name: nome })
  if (error) throw error
}

/** Arquiva o cartão: some das escolhas, o histórico fica. O banco recusa com saldo, parcelas a vencer ou recorrente ativo. */
export async function arquivarCartao(cartaoId: string): Promise<void> {
  const { error } = await cliente().rpc('debt_archive', { p_id: cartaoId })
  if (error) throw error
}

export async function reativarCartao(cartaoId: string): Promise<void> {
  const { error } = await cliente().rpc('debt_unarchive', { p_id: cartaoId })
  if (error) throw error
}

/** Exclui de vez o cartão que nunca teve movimento. Com qualquer histórico o banco recusa (23503): só arquivar. */
export async function excluirCartao(cartaoId: string): Promise<void> {
  const { error } = await cliente().rpc('debt_delete', { p_id: cartaoId })
  if (error) throw error
}

/** Chave de repetição: o mesmo envio (clique duplo, rede ruim) nunca grava duas vezes. */
export function novaChave(): string {
  return crypto.randomUUID()
}

export async function registrarCompra(cartaoId: string, d: DadosCompra, chave?: string): Promise<void> {
  const { error } = await cliente().rpc('card_purchase_at', {
    p_debt: cartaoId, p_date: d.data, p_total: centsToDecimal(d.total), p_count: d.parcelas,
    p_category: d.categoriaId, p_description: d.descricao.trim(), p_invoice_offset: d.deslocamento ?? 0,
    ...(chave ? { p_idem: chave } : {}),
  })
  if (error) throw error
}

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']

/** As 7 faturas possíveis para uma compra (3 antes, a da data, 3 depois), pelo mês do fechamento.
 *  Mesma regra do banco (private.card_first_closing): antes do dia do fechamento, a fatura do mês; no dia ou
 *  depois, a seguinte. É só o rótulo do seletor; quem calcula a fatura de verdade é o banco. */
export function opcoesDeFatura(data: string, fechamento: number): { deslocamento: number; rotulo: string }[] {
  const [a, m, d] = data.split('-').map(Number)
  if (!a || !m || !d) return []
  const base = a * 12 + (m - 1) + (d < fechamento ? 0 : 1)
  return [-3, -2, -1, 0, 1, 2, 3].map((k) => {
    const x = base + k
    const rotulo = `${MESES[x % 12]}/${Math.floor(x / 12)}`
    return { deslocamento: k, rotulo: k === 0 ? `${rotulo} (a da data)` : `${rotulo} (${k > 0 ? '+' : ''}${k})` }
  })
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
    // banco ainda sem a migration 052: a coluna não vem e a fatura segue sem créditos
    creditos: centsFromDb(f.credits ?? 0),
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

/**
 * Lança um crédito no cartão que NÃO é estorno de compra (estorno de IOF, cashback, reembolso da empresa ou do plano).
 * Decisão do dono (04/11/2026): conta como RECEITA, na categoria de receita escolhida, no mês do fechamento da fatura em
 * que entra; abate o valor a pagar dessa fatura. Fatura, mês e validações ficam no banco (card_credit_income).
 */
export async function lancarCreditoNoCartao(cartaoId: string, d: DadosCredito, chave?: string): Promise<string> {
  const { data, error } = await cliente().rpc('card_credit_income', {
    p_debt: cartaoId, p_date: d.data, p_amount: centsToDecimal(d.valor), p_category: d.categoriaId,
    p_description: d.descricao.trim(), p_closing: d.fechamento ?? null, ...(chave ? { p_idem: chave } : {}),
  })
  if (error) throw error
  return data as string
}

/** Último dia do mês AAAA-MM. */
function fimDoMes(mes: string): string {
  const [a, m] = mes.split('-').map(Number)
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10)
}

/** Créditos avulsos da fatura do mês `mes` (AAAA-MM do fechamento), não anulados. Só lista: o total vem de card_months. */
export async function listarCreditosDaFatura(cartaoId: string, mes: string): Promise<CreditoFatura[]> {
  const { data, error } = await cliente()
    .from('debt_events')
    .select('id, date, credit_date, amount, category_id, note')
    .eq('debt_id', cartaoId)
    .eq('kind', 'income_credit')
    .is('voided_at', null)
    .gte('date', `${mes}-01`)
    .lte('date', fimDoMes(mes))
    .order('credit_date', { ascending: false })
  // banco ainda sem a migration 052 (coluna credit_date inexistente): não há créditos para mostrar
  if (error?.code === COLUNA_INEXISTENTE) return []
  if (error) throw error
  return ((data ?? []) as { id: string; date: string; credit_date: string; amount: number | string; category_id: string; note: string | null }[])
    .map((e) => ({
      id: e.id, descricao: e.note ?? 'Crédito', dataCredito: e.credit_date, fechamento: e.date,
      valor: centsFromDb(e.amount), categoriaId: e.category_id,
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

/** A fatura que vem aí: ainda não fechou, então não é "a pagar", mas já tem valor (compras e parcelas que caem nela). */
export interface ProximaFatura {
  mes: string
  vencimento: string | null
  total: Cents
}

/** A fatura aberta que fecha primeiro. O valor é o `total` que o banco já calculou (card_months); aqui só se escolhe a linha. */
export function proximaFatura(faturas: Fatura[], hoje: string): ProximaFatura | null {
  const abertas = faturas.filter((f) => situacaoFatura(f, hoje) === 'aberta').sort((x, y) => (x.fechamento < y.fechamento ? -1 : 1))
  const f = abertas[0]
  return f ? { mes: f.mes, vencimento: f.vencimento, total: f.total } : null
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

/**
 * Linha do painel: o que pagar em cada cartão e quando. Valores e datas vêm do banco (debt_balances, card_months, card_limits).
 * Limitação conhecida: a dívida inclui o "saldo de referência" informado ao criar o cartão (fatura anterior ao app), que não
 * tem fatura própria; nesse caso o vencimento mostrado é o da fatura fechada mais antiga que existe, ou nenhum.
 */
/** Faturas de todos os cartões que vencem em um mês (migration 023). A soma vem do banco; a tela não soma. */
export interface TotalFaturasMes {
  faturas: number
  total: Cents
  pago: Cents
  falta: Cents
}

/** `mes` = AAAA-MM. Null enquanto o banco não tem a função (migration 023 ainda não aplicada). */
export async function totalFaturasDoMes(familiaId: string, mes: string): Promise<TotalFaturasMes | null> {
  const { data, error } = await cliente().rpc('card_invoices_month', { p_household: familiaId, p_month: `${mes}-01` })
  if (error) throw error
  const r = ((data ?? []) as Record<string, string | number>[])[0]
  if (!r) return null
  return {
    faturas: Number(r.invoices), total: centsFromDb(r.total as string | number), pago: centsFromDb(r.paid as string | number),
    falta: centsFromDb(r.remaining as string | number),
  }
}

export interface ResumoCartao {
  id: string
  nome: string
  emissor: string | null
  bandeira: string | null
  /** Faturas já fechadas e ainda não pagas. */
  divida: Cents
  /** Vencimento da fatura fechada mais antiga ainda não paga; null sem fatura a pagar. */
  vencimento: string | null
  vencida: boolean
  limiteDisponivel: Cents | null
  /** Crédito no cartão (pagamento adiantado ou estorno maior que a dívida). */
  credito: Cents
  /** A fatura aberta que fecha primeiro (a "próxima"); null sem fatura aberta ou se não carregou. */
  proxima: ProximaFatura | null
}

export async function resumoDosCartoes(familiaId: string, hoje: string = hojeSP()): Promise<ResumoCartao[]> {
  // cartão inativo que ainda deve continua aparecendo: a dívida dele entra no patrimônio
  const cartoes = (await listarCartoes(familiaId, hoje)).filter((c) => c.ativo || c.divida > 0)
  return Promise.all(cartoes.map(async (c) => {
    let vencimento: string | null = null
    let proxima: ProximaFatura | null = null
    // falha ao ler as faturas de UM cartão não derruba o bloco: ele aparece com a dívida e sem data
    if (c.ativo || c.divida > 0) {
      try {
        const faturas = await listarFaturas(c.id)
        if (c.divida > 0) vencimento = faturas.find((f) => situacaoFatura(f, hoje) === 'fechada')?.vencimento ?? null
        proxima = proximaFatura(faturas, hoje)
      } catch {
        vencimento = null
        proxima = null
      }
    }
    return {
      id: c.id, nome: c.nome, emissor: c.emissor, bandeira: c.bandeira, divida: c.divida, vencimento,
      vencida: vencimento !== null && vencimento < hoje, limiteDisponivel: c.limiteDisponivel, credito: c.credito, proxima,
    }
  }))
}
