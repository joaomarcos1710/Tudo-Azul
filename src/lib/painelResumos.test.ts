import { beforeEach, describe, expect, it, vi } from 'vitest'

// banco de mentira: tabelas devolvem o que foi programado; guarda os filtros que a leitura aplicou
const fake = vi.hoisted(() => {
  const e = {
    tabelas: {} as Record<string, { data: unknown[] | ((eq: Record<string, unknown>) => unknown[]); count?: number; error?: unknown }>,
    rpc: {} as Record<string, { data: unknown; error: unknown } | ((args: unknown) => { data: unknown; error: unknown })>,
    filtros: [] as { tabela: string; op: string; args: unknown[] }[],
  }
  function from(tabela: string) {
    const b: Record<string, unknown> = {}
    const eq: Record<string, unknown> = {}
    for (const op of ['select', 'eq', 'is', 'lt', 'in', 'order', 'limit']) {
      b[op] = (...args: unknown[]) => { e.filtros.push({ tabela, op, args }); if (op === 'eq') eq[args[0] as string] = args[1]; return b }
    }
    b.then = (ok: (r: unknown) => unknown) => {
      const t = e.tabelas[tabela] ?? { data: [] }
      return Promise.resolve(ok({ data: typeof t.data === 'function' ? t.data(eq) : t.data, count: t.count, error: t.error ?? null }))
    }
    return b
  }
  return { e, supabase: { from, rpc: (nome: string, args?: unknown) => { const r = e.rpc[nome]; return Promise.resolve(typeof r === 'function' ? r(args) : r ?? { data: [], error: null }) } } }
})
vi.mock('./supabase', () => ({ supabase: fake.supabase }))

import { resumoDosCartoes } from './cartoes'
import { evolucaoPatrimonio, vencidosPlanejados } from './painel'

beforeEach(() => {
  fake.e.tabelas = {}
  fake.e.rpc = {}
  fake.e.filtros = []
})

describe('vencidosPlanejados', () => {
  it('pede só planejado, fora da lixeira, antes de hoje, do mais antigo para o mais novo, e devolve o total', async () => {
    fake.e.tabelas.transactions = {
      data: [{ id: 't1', type: 'expense', description: 'Luz', amount: '180.00', date: '2026-10-01', category_id: 'cat-luz', account_id: 'a1', destination_account_id: null }],
      count: 4,
    }
    const r = await vencidosPlanejados('h1', '2026-10-25', 1)
    expect(r.total).toBe(4)
    expect(r.itens).toEqual([{ id: 't1', tipo: 'expense', descricao: 'Luz', valor: 18000, data: '2026-10-01', categoriaId: 'cat-luz', contaId: 'a1', destinoId: null }])
    const f = fake.e.filtros.filter((x) => x.tabela === 'transactions')
    expect(f).toContainEqual({ tabela: 'transactions', op: 'eq', args: ['status', 'planned'] })
    expect(f).toContainEqual({ tabela: 'transactions', op: 'is', args: ['deleted_at', null] })
    expect(f).toContainEqual({ tabela: 'transactions', op: 'lt', args: ['date', '2026-10-25'] })
    expect(f).toContainEqual({ tabela: 'transactions', op: 'order', args: ['date'] })
    expect(f).toContainEqual({ tabela: 'transactions', op: 'limit', args: [1] })
  })

  it('transferência vem com a conta de origem e a de destino (para o De → Para do Início)', async () => {
    fake.e.tabelas.transactions = {
      data: [{ id: 't2', type: 'transfer', description: 'Reserva', amount: '300.00', date: '2026-10-02', category_id: null, account_id: 'a1', destination_account_id: 'a3' }],
    }
    const r = await vencidosPlanejados('h1', '2026-10-25')
    expect(r.itens[0]).toMatchObject({ tipo: 'transfer', contaId: 'a1', destinoId: 'a3', categoriaId: null })
  })

  it('sem contagem do banco, o total é o que veio', async () => {
    fake.e.tabelas.transactions = { data: [{ id: 't1', type: 'income', description: '', amount: '10.00', date: '2026-10-01' }] }
    expect((await vencidosPlanejados('h1', '2026-10-25')).total).toBe(1)
  })

  it('erro do banco sobe', async () => {
    fake.e.tabelas.transactions = { data: [], error: { message: 'rede' } }
    await expect(vencidosPlanejados('h1', '2026-10-25')).rejects.toMatchObject({ message: 'rede' })
  })

  it('parcela de dívida ativa que passou da data sem baixa também é vencido, misturada por data e somada ao total', async () => {
    fake.e.tabelas.transactions = {
      data: [{ id: 't1', type: 'expense', description: 'Luz', amount: '180.00', date: '2026-10-10', category_id: null, account_id: 'a1', destination_account_id: null }],
      count: 1,
    }
    fake.e.tabelas.debts = { data: [{ id: 'd1', name: 'Imóvel', payment_method: 'account_debit', payment_account_id: 'a1' }] }
    fake.e.tabelas.debt_payment_schedule = { data: [{ id: 'p1', debt_id: 'd1', installment_number: 7, due_date: '2026-10-05', amount: '2500.00' }], count: 2 }
    const r = await vencidosPlanejados('h1', '2026-10-25')
    expect(r.total).toBe(3)
    expect(r.itens.map((x) => x.id)).toEqual(['debt-p1', 't1'])
    expect(r.itens[0]).toMatchObject({ tipo: 'expense', descricao: 'Parcela 7 · Imóvel', valor: 250000, contaId: 'a1' })
    const f = fake.e.filtros
    expect(f).toContainEqual({ tabela: 'debts', op: 'eq', args: ['active', true] })
    expect(f).toContainEqual({ tabela: 'debt_payment_schedule', op: 'eq', args: ['status', 'planned'] })
    expect(f).toContainEqual({ tabela: 'debt_payment_schedule', op: 'lt', args: ['due_date', '2026-10-25'] })
    expect(f).toContainEqual({ tabela: 'debt_payment_schedule', op: 'in', args: ['debt_id', ['d1']] })
  })

  it('sem dívida ativa, nem consulta a agenda; banco sem a agenda segue só com os lançamentos', async () => {
    expect((await vencidosPlanejados('h1', '2026-10-25')).total).toBe(0)
    expect(fake.e.filtros.some((x) => x.tabela === 'debt_payment_schedule')).toBe(false)
    fake.e.tabelas.debts = { data: [{ id: 'd1', name: 'Imóvel', payment_method: 'boleto', payment_account_id: null }] }
    fake.e.tabelas.debt_payment_schedule = { data: [], error: { code: 'PGRST205', message: 'sem tabela' } }
    expect((await vencidosPlanejados('h1', '2026-10-25')).total).toBe(0)
  })
})

describe('resumoDosCartoes', () => {
  const cartao = (id: string, nome: string, ativo = true) => ({ id, name: nome, closing_day: 17, due_day: 25, active: ativo })

  it('fatura fechada mais antiga a pagar define o vencimento; vencida é a que já passou; cartão sem dívida não consulta faturas', async () => {
    fake.e.tabelas.debts = { data: [cartao('k1', 'Nubank'), cartao('k2', 'Inter'), cartao('k3', 'Antigo', false)] }
    fake.e.rpc.debt_balances = { data: [
      { debt_id: 'k1', debt: '1333.34', credit_receivable: '0', planned_remaining: '0' },
      { debt_id: 'k2', debt: '0', credit_receivable: '0', planned_remaining: '0' },
    ], error: null }
    fake.e.rpc.card_limits = { data: [{ debt_id: 'k1', credit_limit: '5800.00', committed: '530.00', available: '5270.00' }], error: null }
    fake.e.rpc.card_months = { data: [
      { label: '2026-09', closing_date: '2026-09-17', due_date: '2026-09-25', charged: '500.00', to_charge: '0', total: '500.00', paid: '500.00', items: 1, invoice_id: 'i1' },
      { label: '2026-10', closing_date: '2026-10-17', due_date: '2026-10-25', charged: '1333.34', to_charge: '0', total: '1333.34', paid: '0', items: 3, invoice_id: 'i2' },
    ], error: null }
    const r = await resumoDosCartoes('h1', '2026-10-24')
    expect(r.map((c) => c.nome)).toEqual(['Nubank', 'Inter']) // o inativo some
    expect(r[0]).toMatchObject({ id: 'k1', divida: 133334, vencimento: '2026-10-25', vencida: false, limiteDisponivel: 527000 })
    expect(r[1]).toMatchObject({ divida: 0, vencimento: null, vencida: false, limiteDisponivel: null })
    // depois do vencimento, a mesma fatura passa a vencida
    const depois = await resumoDosCartoes('h1', '2026-10-26')
    expect(depois[0]).toMatchObject({ vencimento: '2026-10-25', vencida: true })
  })

  it('falha ao ler as faturas de um cartão não derruba os outros: ele aparece com a dívida e sem data', async () => {
    fake.e.tabelas.debts = { data: [cartao('k1', 'Nubank'), cartao('k2', 'Inter')] }
    fake.e.rpc.debt_balances = { data: [
      { debt_id: 'k1', debt: '100.00', credit_receivable: '0', planned_remaining: '0' },
      { debt_id: 'k2', debt: '200.00', credit_receivable: '0', planned_remaining: '0' },
    ], error: null }
    fake.e.rpc.card_months = (args) => (args as { p_debt: string }).p_debt === 'k1'
      ? { data: null, error: { message: 'timeout' } }
      : { data: [{ label: '2026-10', closing_date: '2026-10-17', due_date: '2026-10-25', charged: '200.00', total: '200.00', paid: '0', items: 1, invoice_id: 'i2' }], error: null }
    const r = await resumoDosCartoes('h1', '2026-10-24')
    expect(r.map((c) => [c.nome, c.divida, c.vencimento])).toEqual([['Nubank', 10000, null], ['Inter', 20000, '2026-10-25']])
  })

  it('pagamento parcial continua fatura fechada: o vencimento aparece', async () => {
    fake.e.tabelas.debts = { data: [cartao('k1', 'Nubank')] }
    fake.e.rpc.debt_balances = { data: [{ debt_id: 'k1', debt: '50.00', credit_receivable: '0', planned_remaining: '0' }], error: null }
    fake.e.rpc.card_months = { data: [{ label: '2026-10', closing_date: '2026-10-17', due_date: '2026-10-25', charged: '150.00', total: '150.00', paid: '100.00', items: 2, invoice_id: 'i1' }], error: null }
    const r = await resumoDosCartoes('h1', '2026-10-24')
    expect(r[0]).toMatchObject({ divida: 5000, vencimento: '2026-10-25' })
  })

  it('cartão inativo que ainda deve aparece; inativo sem dívida some; crédito no cartão é devolvido', async () => {
    fake.e.tabelas.debts = { data: [cartao('k1', 'Velho com dívida', false), cartao('k2', 'Velho quitado', false), cartao('k3', 'Com crédito')] }
    fake.e.rpc.debt_balances = { data: [
      { debt_id: 'k1', debt: '80.00', credit_receivable: '0', planned_remaining: '0' },
      { debt_id: 'k2', debt: '0', credit_receivable: '0', planned_remaining: '0' },
      { debt_id: 'k3', debt: '0', credit_receivable: '100.00', planned_remaining: '0' },
    ], error: null }
    const r = await resumoDosCartoes('h1', '2026-10-24')
    expect(r.map((c) => c.nome)).toEqual(['Velho com dívida', 'Com crédito'])
    expect(r[1].credito).toBe(10000)
  })
})

describe('evolucaoPatrimonio', () => {
  it('um ponto por mês no último dia (mês atual: hoje), do mais antigo ao atual, com os valores do banco', async () => {
    const datas: string[] = []
    fake.e.rpc.net_worth_with_assets = (args) => {
      const d = (args as { p_as_of: string }).p_as_of
      datas.push(d)
      return { data: [{ available: d === '2026-02-28' ? '-10.50' : '100.00', debt: 0, credit_receivable: 0, net_worth: '1000.25', family_assets_brl: 0, planned_commitments: 0 }], error: null }
    }
    const r = await evolucaoPatrimonio('h1', '2026-03-04', 3)
    expect(r.map((p) => [p.mes, p.data])).toEqual([['2026-01', '2026-01-31'], ['2026-02', '2026-02-28'], ['2026-03', '2026-03-04']])
    expect(datas.sort()).toEqual(['2026-01-31', '2026-02-28', '2026-03-04'])
    expect(r[1]).toMatchObject({ disponivel: -1050, patrimonio: 100025 })
  })

  it('virada de ano: dezembro do ano anterior entra certo', async () => {
    fake.e.rpc.net_worth_with_assets = { data: [{ available: 0, debt: 0, credit_receivable: 0, net_worth: 0, family_assets_brl: 0, planned_commitments: 0 }], error: null }
    const r = await evolucaoPatrimonio('h1', '2027-01-15', 2)
    expect(r.map((p) => p.data)).toEqual(['2026-12-31', '2027-01-15'])
  })

  it('um mês que falha derruba a série (sem buraco falso no gráfico)', async () => {
    fake.e.rpc.net_worth_with_assets = (args) => ((args as { p_as_of: string }).p_as_of === '2026-02-28'
      ? { data: null, error: { message: 'rede' } }
      : { data: [{ available: 0, debt: 0, credit_receivable: 0, net_worth: 0, family_assets_brl: 0, planned_commitments: 0 }], error: null })
    await expect(evolucaoPatrimonio('h1', '2026-03-04', 3)).rejects.toMatchObject({ message: 'rede' })
  })
})

