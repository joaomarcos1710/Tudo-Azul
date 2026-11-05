import { beforeEach, describe, expect, it, vi } from 'vitest'

const fake = vi.hoisted(() => {
  const estado = { rpcs: [] as { nome: string; args: Record<string, unknown> }[] }
  return {
    estado,
    supabase: { rpc: (nome: string, args: Record<string, unknown>) => { estado.rpcs.push({ nome, args }); return Promise.resolve({ data: null, error: null }) } },
  }
})
vi.mock('./supabase', () => ({ supabase: fake.supabase }))

import { estornarParcela, faturaVencida, fechamentoNoCiclo, inicioDaTroca, melhorDiaDeCompra, opcoesDeFatura, proximaFatura, registrarCompra } from './cartoes'
import type { Fatura } from './cartoes'
import type { Cents } from './format'

beforeEach(() => { fake.estado.rpcs = [] })

describe('escolher a fatura da compra (migration 051)', () => {
  it('7 opções: 3 antes, a da data e 3 depois, pelo mês do fechamento', () => {
    const o = opcoesDeFatura('2026-07-10', 18)
    expect(o.map((x) => x.deslocamento)).toEqual([-3, -2, -1, 0, 1, 2, 3])
    expect(o[3].rotulo).toBe('Julho/2026 (a da data)')
    expect(o[0].rotulo).toBe('Abril/2026 (-3)')
    expect(o[6].rotulo).toBe('Outubro/2026 (+3)')
  })

  it('no dia do fechamento ou depois, a da data é a seguinte; vira o ano', () => {
    expect(opcoesDeFatura('2026-12-18', 18)[3].rotulo).toBe('Janeiro/2027 (a da data)')
    expect(opcoesDeFatura('2026-12-17', 18)[3].rotulo).toBe('Dezembro/2026 (a da data)')
    expect(opcoesDeFatura('2027-01-05', 18)[0].rotulo).toBe('Outubro/2026 (-3)')
  })

  it('data inválida: nenhuma opção', () => {
    expect(opcoesDeFatura('', 18)).toEqual([])
  })

  it('fechamento 29–31 em mês mais curto: usa o último dia do mês, como o banco (card_day_in_month)', () => {
    // fecha 30: em fevereiro fecha 28/02; compra em 28/02 já é no dia do fechamento → março
    expect(opcoesDeFatura('2026-02-28', 30)[3].rotulo).toBe('Março/2026 (a da data)')
    expect(opcoesDeFatura('2026-02-27', 30)[3].rotulo).toBe('Fevereiro/2026 (a da data)')
    // fecha 31: abril tem 30 dias, fecha 30/04 → compra em 30/04 vai para maio
    expect(opcoesDeFatura('2026-04-30', 31)[3].rotulo).toBe('Maio/2026 (a da data)')
    // 2028 é bissexto: fevereiro fecha 29/02 → compra em 29/02 vai para março; em 28/02 fica em fevereiro
    expect(opcoesDeFatura('2028-02-29', 30)[3].rotulo).toBe('Março/2028 (a da data)')
    expect(opcoesDeFatura('2028-02-28', 30)[3].rotulo).toBe('Fevereiro/2028 (a da data)')
    // dezembro vira o ano
    expect(opcoesDeFatura('2026-12-31', 31)[3].rotulo).toBe('Janeiro/2027 (a da data)')
  })

  it('a compra vai para card_purchase_at com o deslocamento (0 quando não escolhido)', async () => {
    await registrarCompra('k1', { descricao: ' TV ', data: '2026-07-10', total: 30000 as Cents, parcelas: 3, categoriaId: 'g1' }, 'c1')
    await registrarCompra('k1', { descricao: 'TV', data: '2026-07-10', total: 100 as Cents, parcelas: 1, categoriaId: 'g1', deslocamento: -2 })
    expect(fake.estado.rpcs).toEqual([
      { nome: 'card_purchase_at', args: { p_debt: 'k1', p_date: '2026-07-10', p_total: '300.00', p_count: 3, p_category: 'g1', p_description: 'TV', p_invoice_offset: 0, p_idem: 'c1' } },
      { nome: 'card_purchase_at', args: { p_debt: 'k1', p_date: '2026-07-10', p_total: '1.00', p_count: 1, p_category: 'g1', p_description: 'TV', p_invoice_offset: -2 } },
    ])
  })
})

describe('troca dos dias do cartão (migration 061): vale a partir do ciclo seguinte ao da fatura aberta', () => {
  // fechava 5/vencia 15, trocou em 01/12/2026 para 25/5: a aberta (05/12) segue nos dias antigos; a 1ª nova fecha 25/01
  const ciclo = { fechamento: 25, vencimento: 5, cicloAnterior: { fechamento: 5, vencimento: 15, novoDesde: '2027-01' } }

  it('fechamento de cada compra com o dia que vale no mês (como private.card_cycle_first)', () => {
    expect(fechamentoNoCiclo('2026-12-01', ciclo)).toBe('2026-12-05')
    expect(fechamentoNoCiclo('2026-12-05', ciclo)).toBe('2027-01-25')
    expect(fechamentoNoCiclo('2026-12-10', ciclo)).toBe('2027-01-25')
    expect(fechamentoNoCiclo('2027-01-25', ciclo)).toBe('2027-02-25')
    expect(fechamentoNoCiclo('2026-11-05', ciclo)).toBe('2026-12-05')
    expect(fechamentoNoCiclo('', ciclo)).toBeNull()
    expect(fechamentoNoCiclo('2026-12-10', { fechamento: null, vencimento: null })).toBeNull()
  })

  it('fatura atual e o seletor de fatura usam o ciclo do mês', () => {
    expect(proximaFatura([], '2026-12-03', ciclo)).toEqual({ mes: '2026-12', vencimento: '2026-12-15', total: 0 })
    expect(proximaFatura([], '2026-12-10', ciclo)).toEqual({ mes: '2027-01', vencimento: '2027-02-05', total: 0 })
    expect(opcoesDeFatura('2026-12-10', 25, ciclo.cicloAnterior)[3].rotulo).toBe('Janeiro/2027 (a da data)')
    // sem a troca, a compra de 10/12 com dia 25 seria de dezembro
    expect(opcoesDeFatura('2026-12-10', 25)[3].rotulo).toBe('Dezembro/2026 (a da data)')
    // melhor dia de compra: na aberta (05/12) ainda é o dia 5; depois dela, o 25 do ciclo novo
    expect(melhorDiaDeCompra('2026-12-03', 25, ciclo.cicloAnterior)).toBe(5)
    expect(melhorDiaDeCompra('2026-12-10', 25, ciclo.cicloAnterior)).toBe(25)
  })

  it('aviso "vale a partir da fatura que fecha em": mês seguinte ao da aberta, só quando muda algo', () => {
    const semTroca = { fechamento: 5, vencimento: 15 }
    expect(inicioDaTroca('2026-12-01', semTroca, 25, 5)).toBe('2027-01-25')
    expect(inicioDaTroca('2026-12-05', semTroca, 25, 5)).toBe('2027-02-25')
    expect(inicioDaTroca('2026-12-01', semTroca, 5, 20)).toBe('2027-01-05')
    expect(inicioDaTroca('2026-12-01', semTroca, 5, 15)).toBeNull()
    // 31/01 com fechamento 30: a aberta fecha 28/02, então o dia 31 vale a partir de março
    expect(inicioDaTroca('2026-01-31', { fechamento: 30, vencimento: 5 }, 31, 5)).toBe('2026-03-31')
    expect(inicioDaTroca('2025-12-31', { fechamento: 30, vencimento: 5 }, 31, 5)).toBe('2026-02-28')
    // troca já marcada: os dias novos mostram a mesma data; voltar aos dias da aberta não avisa (desfaz a troca)
    expect(inicioDaTroca('2026-12-01', ciclo, 25, 5)).toBe('2027-01-25')
    expect(inicioDaTroca('2026-12-01', ciclo, 5, 15)).toBeNull()
    expect(inicioDaTroca('2026-12-01', { fechamento: null, vencimento: null }, 25, 5)).toBeNull()
  })
})

describe('estorno de parcela e fatura vencida (#166)', () => {
  it('estornarParcela chama debt_refund com o valor exato (centavos → decimal), a data e a fatura', async () => {
    await estornarParcela('p1', { data: '2026-11-05', valor: 4001 as Cents, faturaId: 'f9' })
    expect(fake.estado.rpcs).toEqual([{ nome: 'debt_refund', args: { p_installment: 'p1', p_date: '2026-11-05', p_amount: '40.01', p_invoice: 'f9' } }])
  })

  it('faturaVencida: fechada, não paga e vencimento já passado (a mesma regra do aviso do Início)', () => {
    const f = (x: Partial<Fatura>): Fatura => ({
      mes: '2026-10', fechamento: '2026-10-17', vencimento: '2026-10-25', cobrado: 100 as Cents, aCobrar: 0 as Cents, total: 100 as Cents,
      pago: 0 as Cents, itens: 1, faturaId: null, saldoAnterior: 0 as Cents, adiantamentoEntrada: 0 as Cents, adiantamentoSaida: 0 as Cents,
      creditos: 0 as Cents, ...x,
    })
    expect(faturaVencida(f({}), '2026-10-26')).toBe(true)
    expect(faturaVencida(f({}), '2026-10-25')).toBe(false) // no dia do vencimento ainda não venceu
    expect(faturaVencida(f({ pago: 100 as Cents }), '2026-11-05')).toBe(false)
    expect(faturaVencida(f({ vencimento: null }), '2026-11-05')).toBe(false)
    expect(faturaVencida(f({ fechamento: '2026-11-17', vencimento: '2026-11-25' }), '2026-11-05')).toBe(false) // aberta
  })
})
