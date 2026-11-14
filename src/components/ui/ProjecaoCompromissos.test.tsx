// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Cents } from '../../lib/format'

const mock = vi.hoisted(() => ({ carregar: vi.fn() }))
vi.mock('../../lib/projecaoCompromissos', () => ({
  carregarProjecaoCompromissos: mock.carregar,
}))

import { ProjecaoCompromissos, grupoDoCompromisso, unirRegrasDivididas } from './ProjecaoCompromissos'
import { definirValoresOcultos, MASCARA } from '../../lib/privacidade'

const c = (n: number) => n as Cents
const linha = (overrides: Partial<{
  id: string | null
  descricao: string
  origem: string | null
  tipoOrigem: string
  mes: string
  moeda: string
  valor: Cents
  tipoLinha: 'item' | 'total'
}> = {}) => ({
  id: 'seguro-auto',
  descricao: 'Seguro auto',
  origem: 'Itaú',
  tipoOrigem: 'Conta',
  mes: '2026-11',
  moeda: 'BRL',
  valor: c(25000),
  tipoLinha: 'item' as const,
  ...overrides,
})

beforeEach(() => {
  mock.carregar.mockResolvedValue([
    linha(),
    linha({ mes: '2026-12', valor: c(25000) }),
    linha({ id: 'celular', descricao: 'Celular 8/12', origem: 'Nubank', tipoOrigem: 'Cartão', mes: '2026-11', valor: c(18990) }),
    linha({ id: null, descricao: 'Total do mês', origem: null, tipoOrigem: 'total', mes: '2026-11', valor: c(43990), tipoLinha: 'total' }),
    linha({ id: null, descricao: 'Total do mês', origem: null, tipoOrigem: 'total', mes: '2026-12', valor: c(25000), tipoLinha: 'total' }),
  ])
})

afterEach(() => {
  cleanup()
  definirValoresOcultos(false)
  vi.clearAllMocks()
})

describe('Projeção de compromissos', () => {
  it('mostra despesas, origem, meses e totais fornecidos pelo banco', async () => {
    render(<ProjecaoCompromissos familiaId="h1" hoje="2026-11-07" />)

    expect(await screen.findByText('Seguro auto')).toBeTruthy()
    expect(screen.getByText('Conta · Itaú')).toBeTruthy()
    expect(screen.getByText('Cartão · Nubank')).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Nov 26' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Abr 27' })).toBeTruthy()

    const linhaSeguro = screen.getByText('Seguro auto').closest('tr')!
    expect(within(linhaSeguro).getAllByText('R$ 250,00')).toHaveLength(2)
    expect(within(linhaSeguro).getAllByText('-')).toHaveLength(4)

    expect(screen.getByText(/Total do mês/)).toBeTruthy()
    expect(screen.getByText('R$ 439,90')).toBeTruthy()
    expect(mock.carregar).toHaveBeenCalledWith('h1', '2026-11-07', 6)
  })

  it('permite compactar para três meses sem nova consulta', async () => {
    render(<ProjecaoCompromissos familiaId="h1" hoje="2026-11-07" />)
    await screen.findByText('Seguro auto')

    fireEvent.click(screen.getByRole('button', { name: '3 meses' }))

    expect(screen.getByRole('columnheader', { name: 'Nov 26' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Jan 27' })).toBeTruthy()
    expect(screen.queryByRole('columnheader', { name: 'Fev 27' })).toBeNull()
    expect(mock.carregar).toHaveBeenCalledTimes(1)
  })


  it('oculta valores da matriz quando a preferência global está ativada', async () => {
    definirValoresOcultos(true)
    render(<ProjecaoCompromissos familiaId="h1" hoje="2026-11-07" />)

    expect(await screen.findByText('Seguro auto')).toBeTruthy()
    expect(screen.getAllByText(MASCARA).length).toBeGreaterThan(0)
    expect(screen.queryByText('R$ 250,00')).toBeNull()
    expect(screen.queryByText('R$ 439,90')).toBeNull()
  })

  it('mostra estado vazio quando não existem compromissos', async () => {
    mock.carregar.mockResolvedValueOnce([])
    render(<ProjecaoCompromissos familiaId="h1" hoje="2026-11-07" />)

    expect(await screen.findByText('Nenhum compromisso previsto nos próximos 6 meses.')).toBeTruthy()
  })

  it('informa indisponibilidade sem esconder silenciosamente a falha', async () => {
    mock.carregar.mockRejectedValueOnce(new Error('indisponível'))
    render(<ProjecaoCompromissos familiaId="h1" hoje="2026-11-07" />)

    expect(await screen.findByText('Não foi possível concluir agora. Tente de novo em instantes.')).toBeTruthy()
  })
})


describe('Matriz: blocos por tipo, regras divididas, cabeçalho fixo e mês atual', () => {
  const item = (id: string, descricao: string, mes: string, valor: number, tipoOrigem = 'Conta', origem: string | null = 'Itaú') =>
    linha({ id, descricao, mes, valor: c(valor), tipoOrigem, origem })
  const total = (mes: string, valor: number) => linha({ id: null, descricao: 'Total do mês', origem: null, tipoOrigem: 'total', mes, valor: c(valor), tipoLinha: 'total' })

  it('o id do banco decide o bloco', () => {
    expect(grupoDoCompromisso('account-recurrence:r1')).toBe('fixas')
    expect(grupoDoCompromisso('card-recurrence:r2')).toBe('assinaturas')
    expect(grupoDoCompromisso('transaction-installment:g1')).toBe('parcelamentos')
    expect(grupoDoCompromisso('card-purchase:k1:p1')).toBe('parcelamentos')
    expect(grupoDoCompromisso('debt-schedule:d1')).toBe('parcelamentos')
    expect(grupoDoCompromisso('transaction:t1')).toBe('avulsos')
    expect(grupoDoCompromisso('card-invoice-adjustment:k1:2026-11')).toBe('avulsos')
    expect(grupoDoCompromisso('algo-novo:1')).toBe('outros')
  })

  it('agrupa em blocos na ordem fixa; os avulsos começam recolhidos e abrem no clique; o bloco mostra só a contagem (nada somado)', async () => {
    mock.carregar.mockResolvedValue([
      item('transaction:t1', 'Uber', '2026-11', 4200), item('transaction:t2', 'IOF', '2026-11', 300),
      item('card-recurrence:r1', 'Netflix', '2026-11', 4490, 'Cartão', 'Nubank'),
      item('account-recurrence:r2', 'Aluguel', '2026-11', 150000),
      item('card-purchase:k1:p1', 'Geladeira', '2026-11', 28900, 'Cartão', 'Nubank'),
      total('2026-11', 187890),
    ])
    const u = userEvent.setup()
    render(<ProjecaoCompromissos familiaId="h1" hoje="2026-11-07" />)
    await screen.findByText('Aluguel')
    const ordem = ['fixas', 'assinaturas', 'parcelamentos', 'avulsos'].map((g) => screen.getByTestId(`grupo-${g}`))
    const todos = Array.from(document.querySelectorAll('[data-testid^="grupo-"]'))
    expect(todos).toEqual(ordem)
    const botaoAvulsos = within(screen.getByTestId('grupo-avulsos')).getByRole('button', { name: /Lançamentos avulsos e ajustes da fatura/ })
    expect(botaoAvulsos.getAttribute('aria-expanded')).toBe('false')
    expect(botaoAvulsos.textContent).toContain('· 2')
    expect(screen.queryByText('Uber')).toBeNull()
    await u.click(botaoAvulsos)
    expect(botaoAvulsos.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('Uber')).toBeTruthy()
    expect(screen.getByText('IOF')).toBeTruthy()
    await u.click(botaoAvulsos)
    expect(screen.queryByText('Uber')).toBeNull()
    // um bloco aberto também recolhe
    const botaoFixas = within(screen.getByTestId('grupo-fixas')).getByRole('button', { name: /Contas fixas e recorrentes/ })
    await u.click(botaoFixas)
    expect(screen.queryByText('Aluguel')).toBeNull()
    // o total do mês continua o do banco
    expect(screen.getByText('R$ 1.878,90')).toBeTruthy()
  })

  it('bloco vazio não aparece', async () => {
    mock.carregar.mockResolvedValue([item('account-recurrence:r2', 'Aluguel', '2026-11', 150000), total('2026-11', 150000)])
    render(<ProjecaoCompromissos familiaId="h1" hoje="2026-11-07" />)
    await screen.findByText('Aluguel')
    expect(screen.queryByTestId('grupo-assinaturas')).toBeNull()
    expect(screen.queryByTestId('grupo-avulsos')).toBeNull()
  })

  it('assinatura dividida em duas regras (mesmo nome, meses que não se cruzam) vira uma linha só, sem somar nada', async () => {
    mock.carregar.mockResolvedValue([
      item('card-recurrence:antiga', 'Netflix', '2026-11', 4490, 'Cartão', 'Nubank'),
      item('card-recurrence:nova', 'Netflix', '2026-12', 5590, 'Cartão', 'Nubank'),
      item('card-recurrence:nova', 'Netflix', '2027-01', 5590, 'Cartão', 'Nubank'),
      total('2026-11', 4490),
    ])
    render(<ProjecaoCompromissos familiaId="h1" hoje="2026-11-07" />)
    await screen.findByText('Netflix')
    expect(screen.getAllByText('Netflix')).toHaveLength(1)
    const tr = screen.getByText('Netflix').closest('tr')!
    expect(within(tr).getByText('R$ 44,90')).toBeTruthy()
    expect(within(tr).getAllByText('R$ 55,90')).toHaveLength(2) // dez e jan, cada um com o valor do banco
  })

  it('se as duas regras têm o mesmo mês, ficam separadas (o banco decide; a tela não soma)', () => {
    const celula = (mes: string, valor: number) => [mes, linha({ mes, valor: c(valor) })] as const
    const a = { id: 'a', idBase: 'card-recurrence:a', descricao: 'Claude', origem: 'Nubank', tipoOrigem: 'Cartão', moeda: 'BRL', valores: new Map([celula('2026-11', 100)]) }
    const b = { id: 'b', idBase: 'card-recurrence:b', descricao: 'Claude', origem: 'Nubank', tipoOrigem: 'Cartão', moeda: 'BRL', valores: new Map([celula('2026-11', 200), celula('2026-12', 200)]) }
    expect(unirRegrasDivididas([a, b])).toHaveLength(2)
  })

  it('parcelamentos e avulsos com o mesmo nome nunca se unem (só contas fixas e assinaturas)', () => {
    const m = (mes: string) => new Map([[mes, linha({ mes })] as const])
    const a = { id: 'a', idBase: 'transaction:a', descricao: 'Uber', origem: 'Itaú', tipoOrigem: 'Conta', moeda: 'BRL', valores: m('2026-11') }
    const b = { id: 'b', idBase: 'transaction:b', descricao: 'Uber', origem: 'Itaú', tipoOrigem: 'Conta', moeda: 'BRL', valores: m('2026-12') }
    expect(unirRegrasDivididas([a, b])).toHaveLength(2)
  })

  it('o cabeçalho dos meses fica fixo na rolagem e o mês atual é destacado', async () => {
    mock.carregar.mockResolvedValue([item('account-recurrence:r2', 'Aluguel', '2026-11', 150000), item('account-recurrence:r2', 'Aluguel', '2026-12', 150000), total('2026-11', 150000)])
    render(<ProjecaoCompromissos familiaId="h1" hoje="2026-11-07" />)
    await screen.findByText('Aluguel')
    const rolagem = screen.getByTestId('matriz-rolagem')
    expect(rolagem.className).toMatch(/max-h-/)
    expect(rolagem.className).toMatch(/overflow-auto/)
    const nov = screen.getByRole('columnheader', { name: 'Nov 26' })
    const dez = screen.getByRole('columnheader', { name: 'Dez 26' })
    expect(nov.className).toMatch(/sticky/)
    expect(dez.className).toMatch(/sticky/)
    expect(nov.getAttribute('aria-current')).toBe('date')
    expect(dez.getAttribute('aria-current')).toBeNull()
    expect(nov.className).toContain('bg-azul-claro')
    expect(dez.className).not.toContain('bg-azul-claro')
  })

  it('celular: a lista não tem rolagem própria (não corta linha no meio) e os meses ficam em 3 colunas; no computador a rolagem tem altura máxima e o total do mês fica fixo no pé', async () => {
    mock.carregar.mockResolvedValue([item('account-recurrence:r2', 'Aluguel', '2026-11', 150000), item('account-recurrence:r2', 'Aluguel', '2026-12', 150000), total('2026-11', 150000), total('2026-12', 150000)])
    render(<ProjecaoCompromissos familiaId="h1" hoje="2026-11-07" />)
    await screen.findByText('Aluguel')
    // só no md em diante a rolagem tem altura máxima (a classe sem prefixo prendia a rolagem no celular)
    const rolagem = screen.getByTestId('matriz-rolagem')
    expect(rolagem.className).toContain('md:max-h-')
    expect(rolagem.className.split(/\s+/)).not.toContain('max-h-[70vh]')
    // item: nome em cima (3 colunas) e os 6 meses em 3 colunas = 2 linhas, não 6
    const linhaItem = screen.getByRole('rowheader', { name: /Aluguel/ }).closest('tr') as HTMLElement
    expect(linhaItem.className).toContain('grid-cols-3')
    expect(screen.getByRole('rowheader', { name: /Aluguel/ }).className).toContain('col-span-3')
    // total do mês: mesma grade no celular; fixo no pé da rolagem no computador (sempre visível)
    const rotuloTotal = screen.getByRole('rowheader', { name: /Total do mês/ })
    const linhaTotal = rotuloTotal.closest('tr') as HTMLElement
    expect(linhaTotal.className).toContain('grid-cols-3')
    expect(rotuloTotal.className).toContain('md:sticky')
    expect(rotuloTotal.className).toContain('md:bottom-0')
    for (const celula of within(linhaTotal).getAllByRole('cell')) expect(celula.className).toContain('md:sticky')
  })

  it('o título do bloco não quebra a contagem sozinha: rótulo e "· n" ficam juntos no mesmo texto', async () => {
    mock.carregar.mockResolvedValue([item('transaction:t1', 'Uber', '2026-11', 3000), total('2026-11', 3000)])
    render(<ProjecaoCompromissos familiaId="h1" hoje="2026-11-07" />)
    const botao = await screen.findByRole('button', { name: /Lançamentos avulsos/ })
    const contagem = within(botao).getByText('· 1')
    expect(contagem.className).toContain('whitespace-nowrap')
    expect(contagem.parentElement?.className).toContain('min-w-0')
  })
})
