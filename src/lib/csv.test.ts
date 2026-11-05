import { beforeEach, describe, expect, it, vi } from 'vitest'
import { efeitoNaDivida, exportacaoCompleta, gerarCsv, lancamentosParaExportar } from './csv'
import type { LinhaExportada } from './csv'
import type { Cents } from './format'

const l = (extra: Partial<LinhaExportada>): LinhaExportada => ({
  data: '2026-10-15', tipo: 'expense', descricao: 'Mercado', categoria: 'Mercado', conta: 'Itaú', contaDestino: '',
  valor: 125050 as Cents, moeda: 'BRL', situacao: 'paid', notas: '', ...extra,
})

describe('gerarCsv', () => {
  it('formato brasileiro: BOM, ";", data DD/MM/AAAA, decimal com vírgula, despesa negativa', () => {
    const csv = gerarCsv([l({}), l({ tipo: 'income', descricao: 'Salário', valor: 800000 as Cents, situacao: 'planned' })])
    const linhas = csv.split('\r\n')
    expect(csv.startsWith('﻿')).toBe(true)
    expect(linhas[0]).toBe('﻿Data;Tipo;Descrição;Categoria;Conta;Conta destino;Valor;Moeda;Situação;Observações')
    expect(linhas[1]).toBe('15/10/2026;Despesa;Mercado;Mercado;Itaú;;-1250,50;BRL;Pago;')
    expect(linhas[2]).toBe('15/10/2026;Receita;Salário;Mercado;Itaú;;8000,00;BRL;Planejado;')
  })
  it('transferência leva as duas contas e valor positivo', () => {
    const csv = gerarCsv([l({ tipo: 'transfer', categoria: '', contaDestino: 'Nubank', valor: 5 as Cents })])
    expect(csv.split('\r\n')[1]).toBe('15/10/2026;Transferência;Mercado;;Itaú;Nubank;0,05;BRL;Pago;')
  })
  it('multimoeda F2: a coluna Moeda leva a moeda da conta (o valor fica nela, sem conversão)', () => {
    const csv = gerarCsv([l({ conta: 'Conta em dólar', valor: 4025 as Cents, moeda: 'USD' })])
    expect(csv.split('\r\n')[1]).toBe('15/10/2026;Despesa;Mercado;Mercado;Conta em dólar;;-40,25;USD;Pago;')
  })
  it('protege ";", aspas, quebras de linha e fórmulas', () => {
    const csv = gerarCsv([l({ descricao: 'Pão; leite "integral"', notas: 'linha 1\nlinha 2', categoria: '=SOMA(A1)' })])
    expect(csv).toContain('"Pão; leite ""integral"""')
    expect(csv).toContain('"linha 1\nlinha 2"')
    expect(csv).toContain(";'=SOMA(A1);")
  })
})

// ---- exportação completa: Supabase falso, com as respostas que o banco daria ----
const fake = vi.hoisted(() => {
  const tabelas: Record<string, Record<string, unknown>[]> = {}
  const rpcs: Record<string, (args: Record<string, unknown>) => Record<string, unknown>[]> = {}
  const chamadas: { alvo: string; ordens: string[]; faixas: [number, number][] }[] = []
  function consulta(alvo: string, dados: () => Record<string, unknown>[]) {
    const reg = { alvo, ordens: [] as string[], faixas: [] as [number, number][] }
    chamadas.push(reg)
    let faixa: [number, number] | null = null
    const b = {
      select: () => b, eq: () => b, is: () => b, gte: () => b, lte: () => b,
      order: (c: string) => { reg.ordens.push(c); return b },
      range: (de: number, ate: number) => { faixa = [de, ate]; reg.faixas.push(faixa); return b },
      then: (ok: (r: { data: unknown; error: null }) => unknown) => {
        const todos = dados()
        return Promise.resolve(ok({ data: faixa ? todos.slice(faixa[0], faixa[1] + 1) : todos, error: null }))
      },
    }
    return b
  }
  const supabase = {
    from: (t: string) => consulta(t, () => tabelas[t] ?? []),
    rpc: (n: string, args: Record<string, unknown>) => consulta(n, () => rpcs[n](args)),
  }
  return { tabelas, rpcs, chamadas, supabase }
})
vi.mock('./supabase', () => ({ supabase: fake.supabase }))

const ARQ = (arqs: { nome: string; conteudo: string }[], parte: string) => {
  const a = arqs.find((x) => x.nome.includes(parte))
  if (!a) throw new Error(parte)
  return a.conteudo.split('\r\n').filter(Boolean)
}

beforeEach(() => {
    fake.chamadas.length = 0
    Object.assign(fake.tabelas, {
      accounts: [{ id: 'a1', name: 'Itaú', type: 'checking', initial_balance: '1000.00', opening_date: '2026-10-01', active: true }],
      categories: [{ id: 'c1', name: 'Eletrônicos' }, { id: 'c2', name: 'Mercado' }],
      debts: [{ id: 'd1', name: 'Nubank', kind: 'card', reference_date: '2026-09-30', reference_balance: '0', active: true }],
      transactions: [{ id: 't1', type: 'expense', account_id: 'a1', destination_account_id: null, category_id: 'c2', description: 'Mercado',
        amount: '250.40', date: '2026-10-05', status: 'paid', notes: null }],
      debt_installments: [
        { id: 'i1', debt_id: 'd1', plan: 'p1', seq: 1, description: 'Fone', purchase_date: '2026-10-02', due_date: '2026-10-17', face: '150.00', category_id: 'c1' },
        { id: 'i2', debt_id: 'd1', plan: 'p1', seq: 2, description: 'Fone', purchase_date: '2026-10-02', due_date: '2026-11-17', face: '150.00', category_id: 'c1' },
      ],
      debt_events: [
        { id: 'e1', debt_id: 'd1', date: '2026-10-17', kind: 'charge', amount: '150.00', account_id: null, installment_id: 'i1', category_id: null, note: null },
        { id: 'e2', debt_id: 'd1', date: '2026-10-25', kind: 'payment', amount: '150.00', account_id: 'a1', installment_id: null, invoice_id: 'f1', category_id: null, note: null },
        { id: 'e3', debt_id: 'd1', date: '2026-11-02', kind: 'interest', amount: '9.90', account_id: 'a1', installment_id: null, category_id: 'c2', note: 'mora' },
      ],
      debt_invoices: [{ id: 'f1', label: '2026-10' }],
      investment_assets: [], investment_operations: [], investment_valuations: [], investment_distributions: [],
      family_assets: [], family_asset_valuations: [],
    })
    Object.assign(fake.rpcs, {
      account_balances: () => [{ account_id: 'a1', balance: '599.60' }],
      debt_balances: () => [{ debt_id: 'd1', balance: '0.00', debt: '0.00', credit_receivable: '0.00', planned_remaining: '150.00' }],
      account_movements: () => [
        { source: 'opening', id: 'a1', date: '2026-10-01', description: 'Saldo inicial', amount: '1000.00', reconciled: false },
        { source: 'transaction', id: 't1', date: '2026-10-05', description: 'Mercado', amount: '-250.40', reconciled: true },
        { source: 'debt', id: 'e2', date: '2026-10-25', description: 'Pagamento de Nubank', amount: '-150.00', reconciled: false },
      ],
    })
})

describe('exportacaoCompleta', () => {
  it('gera os 8 arquivos com saldos e dívidas vindos do banco, sem somar no front', async () => {
    const arqs = await exportacaoCompleta('h1', '2026-10-31')
    expect(arqs.map((a) => a.nome)).toEqual([
      'tudo-azul-2026-10-31-1-lancamentos.csv', 'tudo-azul-2026-10-31-2-movimentos-por-conta.csv', 'tudo-azul-2026-10-31-3-cadastros.csv',
      'tudo-azul-2026-10-31-4-parcelas-cartao.csv', 'tudo-azul-2026-10-31-5-eventos-cartao-e-dividas.csv', 'tudo-azul-2026-10-31-6-agenda-parcelas-dividas.csv',
      'tudo-azul-2026-10-31-7-investimentos.csv', 'tudo-azul-2026-10-31-8-bens.csv',
    ])
    // sem investimentos nem bens: os arquivos saem só com o cabeçalho
    expect(ARQ(arqs, 'investimentos')).toHaveLength(1)
    expect(ARQ(arqs, '8-bens')).toHaveLength(1)
    expect(ARQ(arqs, 'movimentos').slice(1)).toEqual([
      'Itaú;01/10/2026;Saldo inicial;Saldo inicial;1000,00;BRL',
      'Itaú;05/10/2026;Lançamento;Mercado;-250,40;BRL',
      'Itaú;25/10/2026;Cartão/dívida;Pagamento de Nubank;-150,00;BRL',
    ])
    // a conferência saiu do app (04/11/2026): o arquivo não tem mais a coluna "Conferido", mesmo com reconciled=true no banco
    expect(ARQ(arqs, 'movimentos')[0]).toBe('\uFEFFConta;Data;Origem;Descrição;Valor;Moeda')
    expect(ARQ(arqs, 'cadastros')).toEqual([
      '\uFEFFCadastro;Nome;Tipo;Data inicial;Valor inicial;Moeda;Ativo;Saldo em 31/10/2026;Parcelas futuras',
      'Conta;Itaú;Conta corrente;01/10/2026;1000,00;BRL;Sim;599,60;',
      'Cartão;Nubank;;30/09/2026;0,00;BRL;Sim;0,00;150,00',
    ])
    expect(ARQ(arqs, 'parcelas').slice(1)).toEqual([
      'Nubank;Fone;1/2;02/10/2026;17/10/2026;Eletrônicos;150,00;Cobrada',
      'Nubank;Fone;2/2;02/10/2026;17/11/2026;Eletrônicos;150,00;A cobrar',
    ])
    expect(ARQ(arqs, 'eventos').slice(1)).toEqual([
      'Nubank;17/10/2026;Cobrança de parcela;150,00;150,00;Sim;;;Fone 1/2;;;',
      'Nubank;25/10/2026;Pagamento;150,00;-150,00;Sim;Itaú;2026-10;;;;',
      'Nubank;02/11/2026;Juros;9,90;0,00;Não;Itaú;;;;Mercado;mora',
    ])
    expect(ARQ(arqs, 'agenda')).toEqual([
      '\uFEFFDívida;Credor;Contrato;Parcela;Vencimento;Valor;Situação;Data do pagamento;Forma de pagamento;Conta de pagamento;Operação',
    ])
    // compra no cartão não vira lançamento de conta; lançamentos continua só com transactions
    expect(ARQ(arqs, 'lancamentos').slice(1)).toEqual(['05/10/2026;Despesa;Mercado;Mercado;Itaú;;-250,40;BRL;Pago;'])
  })

  it('pagina as leituras longas com ordem total (não perde nem repete linhas além de 1.000)', async () => {
    fake.rpcs.account_movements = () => Array.from({ length: 1001 }, (_, i) => (
      { source: 'transaction', id: `t${i}`, date: '2026-10-05', description: 'X', amount: '-1.00', reconciled: false }))
    const arqs = await exportacaoCompleta('h1', '2026-10-31')
    expect(arqs[1].linhas).toBe(1001)
    const mov = fake.chamadas.filter((c) => c.alvo === 'account_movements')
    expect(mov.flatMap((c) => c.faixas)).toEqual([[0, 999], [1000, 1999]])
    expect(mov[0].ordens).toEqual(['date', 'source', 'id'])
    expect(fake.chamadas.find((c) => c.alvo === 'debt_events')?.ordens).toEqual(['date', 'id'])
  })
})

describe('exportacaoCompleta: investimentos e bens (arquivos 7 e 8)', () => {
  it('ativo com operações (inclusive anulada), avaliação e provento; bem com avaliações; valores do banco, sem conta no front', async () => {
    Object.assign(fake.tabelas, {
      investment_assets: [
        { id: 'ia1', name: 'FII Teste', ticker: 'TSTE11', asset_class: 'reit', subclass: 'Tijolo', currency_code: 'BRL', active: true },
        { id: 'ia2', name: 'ETF Global', ticker: null, asset_class: 'etf', subclass: null, currency_code: 'USD', active: false },
      ],
      investment_operations: [
        { id: 'o1', asset_id: 'ia1', operation_date: '2026-10-02', kind: 'buy', quantity: '10.5', unit_price: '100.1234567891', fees: '1.90', notes: 'compra', voided_at: null, void_reason: null },
        { id: 'o2', asset_id: 'ia1', operation_date: '2026-10-20', kind: 'sell', quantity: '4', unit_price: '110', fees: '0', notes: null, voided_at: '2026-10-21T10:00:00Z', void_reason: 'lançada em dobro' },
      ],
      investment_valuations: [{ id: 'v1', asset_id: 'ia1', valuation_date: '2026-10-10', unit_price: '105.5', source: 'Extrato' }],
      investment_distributions: [
        { id: 'p1', asset_id: 'ia1', kind: 'dividend', transaction: { date: '2026-10-15', amount: '12.34', status: 'paid', deleted_at: null, account_id: 'a1' } },
        { id: 'p2', asset_id: 'ia1', kind: 'jcp', transaction: { date: '2026-10-25', amount: 5, status: 'paid', deleted_at: '2026-10-26T10:00:00Z', account_id: 'a1' } },
      ],
      family_assets: [
        { id: 'b1', name: 'Casa de praia', asset_type: 'real_estate', description: 'Litoral', currency_code: 'BRL', ownership_label: 'Casal', household_share: '50.0000', acquired_on: '2020-01-10', status: 'active', ended_on: null },
      ],
      family_asset_valuations: [
        { id: 'fv1', asset_id: 'b1', valuation_date: '2020-01-10', total_value: '200000.00', source: 'Escritura', notes: null },
        { id: 'fv2', asset_id: 'b1', valuation_date: '2026-10-01', total_value: 210000.5, source: 'Corretor', notes: 'estimativa' },
      ],
    })
    const arqs = await exportacaoCompleta('h1', '2026-10-31')
    expect(ARQ(arqs, 'investimentos')).toEqual([
      '\uFEFFRegistro;Ativo;Ticker;Classe;Subclasse;Moeda;Data;Tipo;Quantidade;Preço unitário;Taxas;Valor do provento;Conta;Situação;Observação',
      'Ativo;FII Teste;TSTE11;FIIs / REITs;Tijolo;BRL;;;;;;;;Ativo;',
      'Operação;FII Teste;TSTE11;FIIs / REITs;Tijolo;BRL;02/10/2026;Compra;10,5;100,1234567891;1,90;;;Válida;compra',
      'Avaliação;FII Teste;TSTE11;FIIs / REITs;Tijolo;BRL;10/10/2026;Avaliação;;105,5;;;;;Extrato',
      'Provento;FII Teste;TSTE11;FIIs / REITs;Tijolo;BRL;15/10/2026;Dividendos;;;;12,34;Itaú;Pago;',
      'Operação;FII Teste;TSTE11;FIIs / REITs;Tijolo;BRL;20/10/2026;Venda;4;110;0,00;;;Anulada;Anulada: lançada em dobro',
      'Provento;FII Teste;TSTE11;FIIs / REITs;Tijolo;BRL;25/10/2026;JCP;;;;5,00;Itaú;Na lixeira;',
      'Ativo;ETF Global;;ETFs;;USD;;;;;;;;Arquivado;',
    ])
    expect(arqs.find((a) => a.nome.includes('investimentos'))?.linhas).toBe(7)
    expect(ARQ(arqs, '8-bens')).toEqual([
      '\uFEFFRegistro;Bem;Tipo;Moeda;Titularidade;Participação da família (%);Aquisição;Encerramento;Data da avaliação;Valor total;Fonte;Situação;Observação',
      'Bem;Casa de praia;Imóvel;BRL;Casal;50,0000;10/01/2020;;;;;Ativo;Litoral',
      'Avaliação;Casa de praia;;BRL;;;;;10/01/2020;200000,00;Escritura;;',
      'Avaliação;Casa de praia;;BRL;;;;;01/10/2026;210000,50;Corretor;;estimativa',
    ])
    // as leituras têm ordem total (paginação segura)
    expect(fake.chamadas.find((c) => c.alvo === 'investment_operations')?.ordens).toEqual(['operation_date', 'id'])
    expect(fake.chamadas.find((c) => c.alvo === 'family_asset_valuations')?.ordens).toEqual(['valuation_date', 'id'])
  })
})

describe('efeitoNaDivida', () => {
  it('segue a regra de public.debt_balances para todos os tipos de evento do banco', () => {
    // migration 003: disbursement/charge/refund_cash somam; payment/extra_principal/credit subtraem; o resto não mexe
    expect(efeitoNaDivida).toEqual({
      disbursement: 1, charge: 1, refund_cash: 1, payment: -1, extra_principal: -1, credit: -1, payroll_payment: -1, income_credit: -1, interest: 0, fee: 0, cancel: 0,
    })
  })
})

describe('exportacaoCompleta, casos de borda', () => {
  it('parcela com cancelamento e conta sem saldo calculado: rótulo e célula vazia, sem 0,00 inventado', async () => {
    fake.tabelas.debt_events = [
      { id: 'e9', debt_id: 'd1', date: '2026-10-10', kind: 'cancel', amount: '150.00', account_id: null, installment_id: 'i2', category_id: null, note: null },
    ]
    fake.rpcs.account_balances = () => []
    fake.rpcs.debt_balances = () => []
    const arqs = await exportacaoCompleta('h1', '2026-10-31')
    expect(ARQ(arqs, 'parcelas')[2]).toBe('Nubank;Fone;2/2;02/10/2026;17/11/2026;Eletrônicos;150,00;Com cancelamento (ver eventos)')
    expect(ARQ(arqs, 'cadastros').slice(1)).toEqual([
      'Conta;Itaú;Conta corrente;01/10/2026;1000,00;BRL;Sim;;',
      'Cartão;Nubank;;30/09/2026;0,00;BRL;Sim;;',
    ])
  })

  it('conta em outra moeda (migration 055): cadastro e movimentos dizem a moeda; o valor fica como o banco mandou, sem converter', async () => {
    fake.tabelas.accounts = [{ id: 'a1', name: 'Conta em dólar', type: 'checking', initial_balance: '250.50', opening_date: '2026-10-01', active: true, currency_code: 'USD' }]
    fake.rpcs.account_balances = () => [{ account_id: 'a1', balance: '250.50', currency_code: 'USD' }]
    fake.rpcs.account_movements = () => [
      { source: 'opening', id: 'a1', date: '2026-10-01', description: 'Saldo inicial', amount: '250.50', reconciled: false },
    ]
    const arqs = await exportacaoCompleta('h1', '2026-10-31')
    expect(ARQ(arqs, 'cadastros')[1]).toBe('Conta;Conta em dólar;Conta corrente;01/10/2026;250,50;USD;Sim;250,50;')
    expect(ARQ(arqs, 'movimentos').slice(1)).toEqual(['Conta em dólar;01/10/2026;Saldo inicial;Saldo inicial;250,50;USD'])
  })
})

describe('lancamentosParaExportar: parcelas de dívida (migration 046)', () => {
  beforeEach(() => { for (const k of Object.keys(fake.tabelas)) delete fake.tabelas[k] })

  it('inclui principal, juros e parcela planejada de empréstimo/financiamento; deixa de fora cartão, anulada e consignado', async () => {
    fake.tabelas.accounts = [{ id: 'a1', name: 'Itaú' }]
    fake.tabelas.categories = [{ id: 'fin', name: 'Financiamento' }, { id: 'jur', name: 'Impostos e taxas' }, { id: 'mer', name: 'Mercado' }]
    fake.tabelas.transactions = [
      { id: 't1', type: 'expense', account_id: 'a1', destination_account_id: null, category_id: 'mer', description: 'Mercado', amount: 100, date: '2026-10-03', status: 'paid', notes: null },
    ]
    fake.tabelas.debts = [
      { id: 'd1', name: 'Imóvel', kind: 'financing', principal_category_id: 'fin', payment_method: 'boleto', payment_account_id: 'a1', active: true },
      { id: 'd2', name: 'Nubank', kind: 'card', principal_category_id: null, payment_method: null, payment_account_id: null, active: true },
      { id: 'd3', name: 'Consignado', kind: 'loan', principal_category_id: null, payment_method: 'payroll', payment_account_id: null, active: true },
    ]
    fake.tabelas.debt_events = [
      { id: 'e1', debt_id: 'd1', date: '2026-10-05', kind: 'payment', amount: 800, account_id: 'a1', category_id: null, voided_at: null },
      { id: 'e2', debt_id: 'd1', date: '2026-10-05', kind: 'interest', amount: 200, account_id: 'a1', category_id: 'jur', voided_at: null },
      { id: 'e3', debt_id: 'd2', date: '2026-10-06', kind: 'payment', amount: 300, account_id: 'a1', category_id: null, voided_at: null },
      { id: 'e4', debt_id: 'd1', date: '2026-10-07', kind: 'payment', amount: 999, account_id: 'a1', category_id: null, voided_at: '2026-10-08T10:00:00Z' },
      { id: 'e5', debt_id: 'd3', date: '2026-10-08', kind: 'payroll_payment', amount: 500, account_id: null, category_id: null, voided_at: null },
    ]
    fake.tabelas.debt_payment_schedule = [
      { id: 's2', debt_id: 'd1', installment_number: 2, due_date: '2026-11-05', amount: 1000, status: 'planned' },
      { id: 's9', debt_id: 'd3', installment_number: 2, due_date: '2026-11-05', amount: 500, status: 'planned' },
    ]
    const linhas = await lancamentosParaExportar('h1')
    expect(linhas.map((x) => [x.data, x.descricao, x.categoria, x.conta, x.valor, x.situacao])).toEqual([
      ['2026-10-03', 'Mercado', 'Mercado', 'Itaú', 10000, 'paid'],
      ['2026-10-05', 'Parcela de Imóvel (principal)', 'Financiamento', 'Itaú', 80000, 'paid'],
      ['2026-10-05', 'Parcela de Imóvel (juros)', 'Impostos e taxas', 'Itaú', 20000, 'paid'],
      ['2026-11-05', 'Parcela 2 de Imóvel', 'Financiamento', 'Itaú', 100000, 'planned'],
    ])
    expect(gerarCsv(linhas).split('\r\n')[2]).toBe('05/10/2026;Despesa;Parcela de Imóvel (principal);Financiamento;Itaú;;-800,00;BRL;Pago;Parcela de dívida')
  })

  it('multimoeda F2: lançamento em conta USD sai com a moeda da conta; conta sem moeda gravada, BRL', async () => {
    fake.tabelas.accounts = [{ id: 'a1', name: 'Itaú' }, { id: 'u1', name: 'Conta em dólar', currency_code: 'USD' }]
    fake.tabelas.categories = [{ id: 'mer', name: 'Mercado' }]
    fake.tabelas.transactions = [
      { id: 't1', type: 'expense', account_id: 'u1', destination_account_id: null, category_id: 'mer', description: 'Café', amount: 40.25, date: '2026-10-03', status: 'paid', notes: null },
      { id: 't2', type: 'expense', account_id: 'a1', destination_account_id: null, category_id: 'mer', description: 'Pão', amount: 10, date: '2026-10-04', status: 'paid', notes: null },
    ]
    fake.tabelas.debts = []
    fake.tabelas.debt_events = []
    fake.tabelas.debt_payment_schedule = []
    const linhas = await lancamentosParaExportar('h1')
    expect(linhas.map((x) => [x.descricao, x.moeda])).toEqual([['Café', 'USD'], ['Pão', 'BRL']])
    expect(gerarCsv(linhas).split('\r\n')[1]).toBe('03/10/2026;Despesa;Café;Mercado;Conta em dólar;;-40,25;USD;Pago;')
  })

  it('sem categoria escolhida na dívida, o principal sai como "Sem categoria"', async () => {
    fake.tabelas.accounts = [{ id: 'a1', name: 'Itaú' }]
    fake.tabelas.categories = []
    fake.tabelas.transactions = []
    fake.tabelas.debts = [{ id: 'd1', name: 'Carro', kind: 'loan', principal_category_id: null, payment_method: 'boleto', payment_account_id: null, active: true }]
    fake.tabelas.debt_events = [{ id: 'e1', debt_id: 'd1', date: '2026-10-05', kind: 'payment', amount: 500, account_id: 'a1', category_id: null, voided_at: null }]
    fake.tabelas.debt_payment_schedule = []
    expect((await lancamentosParaExportar('h1'))[0].categoria).toBe('Sem categoria')
  })
})
