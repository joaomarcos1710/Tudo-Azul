import { asCents, centsFromDb, centsToDecimal } from './format'
import type { Cents } from './format'
import { supabase } from './supabase'

export type TipoDivida = 'loan' | 'financing'
export type EstrategiaQuitacao = 'snowball' | 'avalanche'
export type FormaPagamentoDivida = 'account_debit' | 'boleto' | 'payroll' | 'manual'

export interface DadosContratoDivida {
  credor: string
  numeroContrato: string
  parcelasOriginais: number
  parcelasRestantes: number
  valorParcela: Cents
  diaPagamento: number
  formaPagamento: FormaPagamentoDivida
  contaPagamentoId: string | null
  primeiraDataVencimento: string
}

export interface ParcelaDivida {
  id: string
  dividaId: string
  nomeDivida: string
  numero: number
  vencimento: string
  valor: Cents
  formaPagamento: FormaPagamentoDivida
  contaPagamentoId: string | null
}

export interface Divida {
  id: string
  nome: string
  tipo: TipoDivida
  saldo: Cents
  compromissos: Cents
  ativa: boolean
  taxaMensalBps: number
  pagamentoMinimo: Cents
  credor: string | null
  numeroContrato: string | null
  parcelasOriginais: number | null
  parcelasRestantes: number | null
  valorParcela: Cents | null
  diaPagamento: number | null
  formaPagamento: FormaPagamentoDivida | null
  contaPagamentoId: string | null
  primeiraDataVencimento: string | null
}

export interface DadosDivida {
  nome: string
  tipo: TipoDivida
  dataReferencia: string
  saldoReferencia: Cents
}

export interface ResultadoQuitacao {
  estrategia: EstrategiaQuitacao
  meses: number
  quitado: boolean
  jurosTotais: Cents | null
  totalPago: Cents | null
  saldoRestante: Cents | null
  prioridadeInicial: string[]
  ordemQuitacao: string[]
  erro: string | null
}

function cliente() {
  if (!supabase) throw new Error('Supabase não configurado')
  return supabase
}

/** Dívidas e financiamentos usam o motor debts/debt_events já existente. Cartões continuam na tela Cartões. */
export async function listarDividas(familiaId: string, dataRef: string): Promise<Divida[]> {
  const db = cliente()
  const [cadastros, saldos] = await Promise.all([
    db.from('debts')
      .select('id, name, kind, active, monthly_rate_bps, minimum_payment, creditor, contract_number, original_installments, remaining_installments, installment_amount, payment_day, payment_method, payment_account_id, first_due_date')
      .eq('household_id', familiaId)
      .eq('active', true)
      .in('kind', ['loan', 'financing'])
      .order('name'),
    db.rpc('debt_balances', { p_household: familiaId, p_as_of: dataRef }),
  ])
  if (cadastros.error) throw cadastros.error
  if (saldos.error) throw saldos.error
  const porId = new Map(((saldos.data ?? []) as Record<string, unknown>[]).map((r) => [r.debt_id as string, r]))
  return ((cadastros.data ?? []) as Record<string, unknown>[])
    .flatMap((d) => {
      const s = porId.get(d.id as string)
      if (!s) return []
      return [{
        id: d.id as string,
        nome: d.name as string,
        tipo: d.kind as TipoDivida,
        saldo: centsFromDb((s.debt ?? 0) as string | number),
        compromissos: centsFromDb((s.planned_remaining ?? 0) as string | number),
        ativa: d.active as boolean,
        taxaMensalBps: Number(d.monthly_rate_bps ?? 0),
        pagamentoMinimo: centsFromDb((d.minimum_payment ?? 0) as string | number),
        credor: (d.creditor as string | null) ?? null,
        numeroContrato: (d.contract_number as string | null) ?? null,
        parcelasOriginais: d.original_installments == null ? null : Number(d.original_installments),
        parcelasRestantes: d.remaining_installments == null ? null : Number(d.remaining_installments),
        valorParcela: d.installment_amount == null ? null : centsFromDb(d.installment_amount as string | number),
        diaPagamento: d.payment_day == null ? null : Number(d.payment_day),
        formaPagamento: (d.payment_method as FormaPagamentoDivida | null) ?? null,
        contaPagamentoId: (d.payment_account_id as string | null) ?? null,
        primeiraDataVencimento: (d.first_due_date as string | null) ?? null,
      }]
    })
}

export async function criarDivida(d: DadosDivida): Promise<string> {
  const { data, error } = await cliente().rpc('create_debt', {
    p_name: d.nome.trim(),
    p_kind: d.tipo,
    p_reference_date: d.dataReferencia,
    p_reference_balance: centsToDecimal(d.saldoReferencia),
  })
  if (error) throw error
  return data as string
}

export async function definirTermosDivida(id: string, taxaMensalBps: number, pagamentoMinimo: Cents): Promise<void> {
  const { error } = await cliente().rpc('debt_set_terms', {
    p_debt: id,
    p_monthly_rate_bps: taxaMensalBps,
    p_minimum_payment: centsToDecimal(pagamentoMinimo),
  })
  if (error) throw error
}


export async function definirContratoDivida(id: string, d: DadosContratoDivida): Promise<void> {
  const { error } = await cliente().rpc('debt_contract_set', {
    p_debt: id,
    p_creditor: d.credor.trim() || null,
    p_contract_number: d.numeroContrato.trim() || null,
    p_original_installments: d.parcelasOriginais,
    p_remaining_installments: d.parcelasRestantes,
    p_installment_amount: centsToDecimal(d.valorParcela),
    p_payment_day: d.diaPagamento,
    p_payment_method: d.formaPagamento,
    p_payment_account: d.contaPagamentoId,
    p_first_due_date: d.primeiraDataVencimento,
  })
  if (error) throw error
}

export async function listarParcelasDivida(
  familiaId: string, de: string, ate: string, somentePlanejadas = true,
): Promise<ParcelaDivida[]> {
  const db = cliente()
  let consulta = db.from('debt_payment_schedule')
    .select('id, debt_id, installment_number, due_date, amount, status')
    .eq('household_id', familiaId)
    .gte('due_date', de).lte('due_date', ate)
    .order('due_date').order('installment_number')
  if (somentePlanejadas) consulta = consulta.eq('status', 'planned')
  const { data, error } = await consulta
  if (error) throw error
  const linhas = (data ?? []) as Record<string, unknown>[]
  if (linhas.length === 0) return []
  const ids = [...new Set(linhas.map((r) => r.debt_id as string))]
  const { data: dividas, error: erroDividas } = await db.from('debts')
    .select('id, name, payment_method, payment_account_id')
    .eq('household_id', familiaId).in('id', ids)
  if (erroDividas) throw erroDividas
  const porId = new Map((dividas ?? []).map((d) => [d.id, d]))
  return linhas.flatMap((r) => {
    const d = porId.get(r.debt_id as string)
    if (!d || !d.payment_method) return []
    return [{
      id: r.id as string,
      dividaId: r.debt_id as string,
      nomeDivida: d.name as string,
      numero: Number(r.installment_number),
      vencimento: r.due_date as string,
      valor: centsFromDb(r.amount as string | number),
      formaPagamento: d.payment_method as FormaPagamentoDivida,
      contaPagamentoId: (d.payment_account_id as string | null) ?? null,
    }]
  })
}

export async function registrarPagamentoParcela(d: {
  parcelaId: string
  data: string
  contaId: string | null
  principal: Cents
  juros: Cents
  tarifa: Cents
  categoriaId: string | null
  extra: boolean
}): Promise<void> {
  const { error } = await cliente().rpc('debt_schedule_record_payment', {
    p_schedule_id: d.parcelaId,
    p_date: d.data,
    p_account: d.contaId,
    p_principal: centsToDecimal(d.principal),
    p_interest: centsToDecimal(d.juros),
    p_fee: centsToDecimal(d.tarifa),
    p_category: d.categoriaId,
    p_extra: d.extra,
  })
  if (error) throw error
}

export async function registrarPagamentoDivida(d: {
  dividaId: string
  data: string
  contaId: string
  principal: Cents
  juros: Cents
  tarifa: Cents
  categoriaId: string | null
  extra: boolean
}): Promise<void> {
  const { error } = await cliente().rpc('debt_record_payment', {
    p_debt: d.dividaId,
    p_date: d.data,
    p_account: d.contaId,
    p_principal: centsToDecimal(d.principal),
    p_interest: centsToDecimal(d.juros),
    p_fee: centsToDecimal(d.tarifa),
    p_category: d.categoriaId,
    p_extra: d.extra,
  })
  if (error) throw error
}

function centavosSeguros(valor: bigint): Cents | null {
  if (valor < 0n || valor > BigInt(Number.MAX_SAFE_INTEGER)) return null
  return asCents(Number(valor))
}

/**
 * Simula quitação sem gravar eventos. Mínimos incluem juros; o orçamento restante
 * é amortização extra. Juros mensais são arredondados em centavos inteiros.
 */
export function simularQuitacao(
  dividas: Pick<Divida, 'id' | 'nome' | 'saldo' | 'taxaMensalBps' | 'pagamentoMinimo'>[],
  orcamentoMensal: Cents,
  estrategia: EstrategiaQuitacao,
): ResultadoQuitacao {
  const trabalho = dividas.filter((d) => d.saldo > 0).map((d) => ({
    id: d.id, nome: d.nome, saldo: BigInt(d.saldo), taxa: BigInt(d.taxaMensalBps),
    minimo: BigInt(d.pagamentoMinimo),
  }))
  const ordenar = () => [...trabalho].sort((a, b) => {
    if (estrategia === 'snowball') {
      return a.saldo === b.saldo ? a.nome.localeCompare(b.nome, 'pt-BR') : a.saldo < b.saldo ? -1 : 1
    }
    return a.taxa === b.taxa
      ? (a.saldo === b.saldo ? a.nome.localeCompare(b.nome, 'pt-BR') : a.saldo < b.saldo ? -1 : 1)
      : a.taxa > b.taxa ? -1 : 1
  })
  const prioridadeInicial = ordenar().map((d) => d.nome)
  const vazio: ResultadoQuitacao = {
    estrategia, meses: 0, quitado: true, jurosTotais: asCents(0)!, totalPago: asCents(0)!,
    saldoRestante: asCents(0)!, prioridadeInicial, ordemQuitacao: [], erro: null,
  }
  if (trabalho.length === 0) return vazio
  if (orcamentoMensal <= 0) return { ...vazio, quitado: false, saldoRestante: centavosSeguros(trabalho.reduce((s, d) => s + d.saldo, 0n)), erro: 'Informe um orçamento mensal maior que zero.' }

  const orcamento = BigInt(orcamentoMensal)
  const minimoInicial = trabalho.reduce((s, d) => s + (d.minimo < d.saldo ? d.minimo : d.saldo), 0n)
  if (minimoInicial > orcamento) {
    return { ...vazio, quitado: false, saldoRestante: centavosSeguros(trabalho.reduce((s, d) => s + d.saldo, 0n)),
      jurosTotais: null, totalPago: null, erro: 'O orçamento mensal é menor que a soma dos pagamentos mínimos.' }
  }

  let jurosTotais = 0n
  let totalPago = 0n
  const ordemQuitacao: string[] = []
  let meses = 0
  while (trabalho.some((d) => d.saldo > 0n) && meses < 600) {
    meses += 1
    let minimosDoMes = 0n
    for (const d of trabalho) {
      if (d.saldo <= 0n) continue
      const juros = (d.saldo * d.taxa + 5000n) / 10000n
      d.saldo += juros
      jurosTotais += juros
      const minimo = d.minimo < d.saldo ? d.minimo : d.saldo
      d.saldo -= minimo
      minimosDoMes += minimo
      totalPago += minimo
      if (d.saldo === 0n && !ordemQuitacao.includes(d.nome)) ordemQuitacao.push(d.nome)
    }
    if (minimosDoMes > orcamento) {
      return { estrategia, meses, quitado: false, jurosTotais: centavosSeguros(jurosTotais),
        totalPago: centavosSeguros(totalPago), saldoRestante: centavosSeguros(trabalho.reduce((s, d) => s + d.saldo, 0n)),
        prioridadeInicial, ordemQuitacao, erro: 'Os juros fizeram os mínimos ultrapassarem o orçamento mensal.' }
    }
    let extra = orcamento - minimosDoMes
    for (const d of ordenar()) {
      if (extra <= 0n) break
      const pagamento = d.saldo < extra ? d.saldo : extra
      d.saldo -= pagamento
      extra -= pagamento
      totalPago += pagamento
      if (d.saldo === 0n && !ordemQuitacao.includes(d.nome)) ordemQuitacao.push(d.nome)
    }
    if (minimosDoMes === 0n && extra === orcamento && orcamento === 0n) break
  }

  const saldo = trabalho.reduce((s, d) => s + d.saldo, 0n)
  const jurosCents = centavosSeguros(jurosTotais)
  const pagoCents = centavosSeguros(totalPago)
  const saldoCents = centavosSeguros(saldo)
  if (jurosCents === null || pagoCents === null || saldoCents === null) {
    return { estrategia, meses, quitado: false, jurosTotais: null, totalPago: null, saldoRestante: null,
      prioridadeInicial, ordemQuitacao, erro: 'Os valores ultrapassam o limite seguro da simulação.' }
  }
  return { estrategia, meses, quitado: saldo === 0n, jurosTotais: jurosCents, totalPago: pagoCents,
    saldoRestante: saldoCents, prioridadeInicial, ordemQuitacao,
    erro: saldo === 0n ? null : 'A simulação não quitou todas as dívidas em 600 meses. Revise taxa e orçamento.' }
}
