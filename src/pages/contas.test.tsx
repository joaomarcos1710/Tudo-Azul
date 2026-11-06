// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { Cents } from '../lib/format'

const mock = vi.hoisted(() => ({
  listarContas: vi.fn(),
  criarConta: vi.fn(),
  editarConta: vi.fn(),
  definirAtiva: vi.fn(),
  excluirConta: vi.fn(),
}))
vi.mock('../lib/FamiliaContext', () => ({
  useFamilia: () => ({ familia: { id: 'h1', nome: 'Casa', papel: 'owner' }, carregando: false, erro: false, recarregar: vi.fn() }),
}))
// etiquetas (072) têm o próprio teste (contasEtiquetas.test.tsx); aqui o banco ainda não as tem
vi.mock('../lib/etiquetas', async (original) => ({
  ...(await original<typeof import('../lib/etiquetas')>()),
  listarEtiquetas: () => Promise.resolve({ disponivel: false, etiquetas: [], porConta: new Map() }),
}))
vi.mock('../lib/contas', async (original) => ({
  ...(await original<typeof import('../lib/contas')>()),
  listarContas: mock.listarContas,
  criarConta: mock.criarConta,
  editarConta: mock.editarConta,
  definirAtiva: mock.definirAtiva,
  excluirConta: mock.excluirConta,
}))

import Contas from './Contas'
import { hojeSP } from '../lib/contas'

const c = (n: number) => n as Cents
const corrente = { id: 'a1', nome: 'Itaú', tipo: 'checking' as const, banco: null, saldoInicial: c(100000), abertura: '2026-12-01', ativa: true, saldo: c(125050) }

beforeEach(() => {
  mock.listarContas.mockResolvedValue({ contas: [], total: c(0) })
  mock.criarConta.mockResolvedValue(undefined)
  mock.editarConta.mockResolvedValue(undefined)
  mock.definirAtiva.mockResolvedValue(undefined)
  mock.excluirConta.mockResolvedValue(undefined)
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('hojeSP', () => {
  it('usa o dia de São Paulo, não o UTC', () => {
    expect(hojeSP(new Date('2026-12-01T02:30:00Z'))).toBe('2026-11-30')
  })
})

describe('Contas', () => {
  it('sem contas, convida a cadastrar a primeira', async () => {
    render(<MemoryRouter><Contas /></MemoryRouter>)
    expect(await screen.findByText('Nenhuma conta ainda')).toBeTruthy()
  })

  it('mostra saldo e total que vêm do banco, formatados a partir de centavos', async () => {
    mock.listarContas.mockResolvedValue({
      contas: [corrente, { ...corrente, id: 'a2', nome: 'Carteira', tipo: 'cash', ativa: false, saldo: c(-5000) }],
      total: c(120050),
    })
    render(<MemoryRouter><Contas /></MemoryRouter>)
    expect(await screen.findByText('R$ 1.200,50')).toBeTruthy() // total do banco, não somado na tela
    expect(screen.getByText('R$ 1.250,50')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Arquivadas (1)' }))
    expect(screen.getByText('-R$ 50,00')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Arquivadas' })).toBeTruthy()
    expect(screen.getByText('Carteira').closest('li')).not.toBeNull()
  })

  it('não oferece conferência com o extrato (removida da experiência em 04/11/2026)', async () => {
    mock.listarContas.mockResolvedValue({ contas: [corrente], total: c(125050) })
    render(<MemoryRouter><Contas /></MemoryRouter>)
    expect(await screen.findByText('Itaú')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Conferir' })).toBeNull()
    expect(screen.queryByText(/confer[eê]ncia|extrato/i)).toBeNull()
  })

  it('conta que abre no futuro mostra a data em vez de saldo', async () => {
    mock.listarContas.mockResolvedValue({ contas: [{ ...corrente, saldo: null }], total: c(0) })
    render(<MemoryRouter><Contas /></MemoryRouter>)
    expect(await screen.findByText('abre em 01/12/2026')).toBeTruthy()
  })

  it('cadastra conta com saldo inicial em centavos (aceita negativo)', async () => {
    render(<MemoryRouter><Contas /></MemoryRouter>)
    const u = userEvent.setup()
    await u.click(await screen.findByRole('button', { name: 'Cadastrar a primeira conta' }))
    await u.type(screen.getByLabelText('Nome'), 'Nubank')
    await u.selectOptions(screen.getByLabelText('Tipo'), 'savings')
    const saldo = screen.getByLabelText('Saldo inicial (R$)')
    await u.clear(saldo)
    await u.type(saldo, '-1.250,50')
    await u.click(screen.getByRole('button', { name: 'Cadastrar conta' }))
    expect(mock.criarConta).toHaveBeenCalledWith('h1', { nome: 'Nubank', tipo: 'savings', saldoInicial: -125050, abertura: hojeSP() })
    expect(mock.listarContas).toHaveBeenCalledTimes(2)
  })

  it('grava o banco escolhido (a conta pode ter qualquer nome)', async () => {
    render(<MemoryRouter><Contas /></MemoryRouter>)
    const u = userEvent.setup()
    await u.click(await screen.findByRole('button', { name: 'Cadastrar a primeira conta' }))
    await u.type(screen.getByLabelText('Nome'), 'Poupança da família')
    await u.selectOptions(screen.getByLabelText('Banco'), 'Caixa Econômica Federal')
    await u.click(screen.getByRole('button', { name: 'Cadastrar conta' }))
    expect(mock.criarConta).toHaveBeenCalledWith('h1', expect.objectContaining({ nome: 'Poupança da família', banco: 'caixa' }))
  })

  it('dinheiro não tem banco: o seletor trava e nada é enviado', async () => {
    render(<MemoryRouter><Contas /></MemoryRouter>)
    const u = userEvent.setup()
    await u.click(await screen.findByRole('button', { name: 'Cadastrar a primeira conta' }))
    await u.type(screen.getByLabelText('Nome'), 'Carteira')
    await u.selectOptions(screen.getByLabelText('Banco'), 'Nubank')
    await u.selectOptions(screen.getByLabelText('Tipo'), 'cash')
    expect((screen.getByLabelText('Banco') as HTMLSelectElement).disabled).toBe(true)
    await u.click(screen.getByRole('button', { name: 'Cadastrar conta' }))
    expect(mock.criarConta).toHaveBeenCalledWith('h1', expect.objectContaining({ tipo: 'cash' }))
    expect(mock.criarConta.mock.calls[0][1]).not.toHaveProperty('banco')
  })

  it('editar uma conta que tinha banco e escolher "Automático" apaga o banco; sem banco antes e depois, nem toca na coluna', async () => {
    mock.listarContas.mockResolvedValue({ contas: [{ ...corrente, banco: 'itau' }], total: c(125050) })
    const u = userEvent.setup()
    render(<MemoryRouter><Contas /></MemoryRouter>)
    await u.click(await screen.findByRole('button', { name: 'Editar' }))
    await u.selectOptions(screen.getByLabelText('Banco'), 'Automático (pelo nome da conta)')
    await u.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(mock.editarConta).toHaveBeenCalledWith('a1', expect.objectContaining({ banco: null }))
    cleanup()
    mock.editarConta.mockClear()
    mock.listarContas.mockResolvedValue({ contas: [corrente], total: c(125050) })
    render(<MemoryRouter><Contas /></MemoryRouter>)
    await u.click(await screen.findByRole('button', { name: 'Editar' }))
    await u.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(mock.editarConta.mock.calls[0][1]).not.toHaveProperty('banco')
  })

  it('o selo segue o banco escolhido, não o nome da conta', async () => {
    mock.listarContas.mockResolvedValue({
      contas: [
        { ...corrente, id: 'a1', nome: 'Corrente', banco: 'nubank' },
        { ...corrente, id: 'a2', nome: 'Conta Caixa antiga', banco: 'itau' },
        { ...corrente, id: 'a3', nome: 'Conta Bradesco', banco: null },
        { ...corrente, id: 'a4', nome: 'Reserva', banco: null },
      ],
      total: c(0),
    })
    const { container } = render(<MemoryRouter><Contas /></MemoryRouter>)
    await screen.findByText('Corrente')
    const banco = (nome: string) => (screen.getByText(nome).closest('li')!.querySelector('[data-banco]') as HTMLElement).dataset.banco
    expect(banco('Corrente')).toBe('nubank')
    expect(banco('Conta Caixa antiga')).toBe('itau')
    expect(banco('Conta Bradesco')).toBe('bradesco')
    expect(banco('Reserva')).toBe('')
    expect(container.querySelectorAll('[data-banco]').length).toBe(4)
  })

  it('não envia valor inválido', async () => {
    render(<MemoryRouter><Contas /></MemoryRouter>)
    const u = userEvent.setup()
    await u.click(await screen.findByRole('button', { name: 'Cadastrar a primeira conta' }))
    await u.type(screen.getByLabelText('Nome'), 'Nubank')
    const saldo = screen.getByLabelText('Saldo inicial (R$)')
    await u.clear(saldo)
    await u.type(saldo, '1.2.3')
    await u.click(screen.getByRole('button', { name: 'Cadastrar conta' }))
    expect(screen.getByText(/Valor inválido/)).toBeTruthy()
    expect(mock.criarConta).not.toHaveBeenCalled()
  })

  it('editar preenche os dados atuais e salva', async () => {
    mock.listarContas.mockResolvedValue({ contas: [corrente], total: c(125050) })
    render(<MemoryRouter><Contas /></MemoryRouter>)
    const u = userEvent.setup()
    await u.click(await screen.findByRole('button', { name: 'Editar' }))
    expect((screen.getByLabelText('Saldo inicial (R$)') as HTMLInputElement).value).toBe('1.000,00')
    await u.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(mock.editarConta).toHaveBeenCalledWith('a1', { nome: 'Itaú', tipo: 'checking', saldoInicial: 100000, abertura: '2026-12-01' })
  })

  it('arquivar com planejado em aberto mostra a regra do banco', async () => {
    mock.listarContas.mockResolvedValue({ contas: [corrente], total: c(125050) })
    mock.definirAtiva.mockRejectedValue({ code: '23514', message: 'conta com lançamento planejado em aberto não pode ser desativada' })
    render(<MemoryRouter><Contas /></MemoryRouter>)
    const item = (await screen.findByText('Itaú')).closest('li')!
    await userEvent.setup().click(within(item).getByRole('button', { name: 'Arquivar' }))
    expect(mock.definirAtiva).toHaveBeenCalledWith('a1', false)
    expect((await screen.findByRole('alert')).textContent).toBe('Conta com lançamento planejado em aberto não pode ser desativada.')
  })

  it('arquivadas ficam escondidas por padrão; o botão "Arquivadas (N)" mostra e esconde', async () => {
    mock.listarContas.mockResolvedValue({ contas: [corrente, { ...corrente, id: 'a2', nome: 'Antiga', ativa: false }], total: c(0) })
    render(<MemoryRouter><Contas /></MemoryRouter>)
    const botao = await screen.findByRole('button', { name: 'Arquivadas (1)' })
    expect(screen.queryByText('Antiga')).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Arquivadas' })).toBeNull()
    expect(screen.queryByText(/Não aparecem nas escolhas de lançamento/)).toBeNull()
    expect(botao.getAttribute('aria-expanded')).toBe('false')
    expect(botao.getAttribute('aria-controls')).toBe('secao-contas-arquivadas')
    await userEvent.click(botao)
    expect(botao.getAttribute('aria-expanded')).toBe('true')
    expect(document.getElementById('secao-contas-arquivadas')!.textContent).toMatch(/Antiga/)
    expect(screen.getByText(/Não aparecem nas escolhas de lançamento/)).toBeTruthy()
    await userEvent.click(botao)
    expect(screen.queryByText('Antiga')).toBeNull()
  })

  it('sem conta arquivada, o botão de arquivadas não aparece', async () => {
    mock.listarContas.mockResolvedValue({ contas: [corrente], total: c(125050) })
    render(<MemoryRouter><Contas /></MemoryRouter>)
    await screen.findByText('Itaú')
    expect(screen.queryByRole('button', { name: /Arquivadas/ })).toBeNull()
  })

  it('conta arquivada fica na seção Arquivadas e reativa', async () => {
    mock.listarContas.mockResolvedValue({ contas: [corrente, { ...corrente, id: 'a2', nome: 'Antiga', ativa: false }], total: c(0) })
    render(<MemoryRouter><Contas /></MemoryRouter>)
    await userEvent.click(await screen.findByRole('button', { name: 'Arquivadas (1)' }))
    const secao = (await screen.findByRole('heading', { name: 'Arquivadas' })).closest('section')!
    expect(within(secao).getByText('Antiga')).toBeTruthy()
    expect(within(secao).queryByText('Itaú')).toBeNull()
    await userEvent.setup().click(within(secao).getByRole('button', { name: 'Reativar' }))
    expect(mock.definirAtiva).toHaveBeenCalledWith('a2', true)
  })

  it('excluir conta pede confirmação e só então chama o banco', async () => {
    mock.listarContas.mockResolvedValue({ contas: [corrente], total: c(0) })
    render(<MemoryRouter><Contas /></MemoryRouter>)
    const u = userEvent.setup()
    await u.click(within((await screen.findByText('Itaú')).closest('li')!).getByRole('button', { name: 'Excluir' }))
    expect(mock.excluirConta).not.toHaveBeenCalled()
    await u.click(within(screen.getByRole('group', { name: 'Excluir conta' })).getByRole('button', { name: 'Excluir conta' }))
    expect(mock.excluirConta).toHaveBeenCalledWith('a1')
  })

  it('excluir conta com histórico mostra a regra do banco', async () => {
    mock.listarContas.mockResolvedValue({ contas: [corrente], total: c(0) })
    mock.excluirConta.mockRejectedValue({ code: '23503', message: 'tem histórico: só é possível arquivar' })
    render(<MemoryRouter><Contas /></MemoryRouter>)
    const u = userEvent.setup()
    await u.click(within((await screen.findByText('Itaú')).closest('li')!).getByRole('button', { name: 'Excluir' }))
    await u.click(within(screen.getByRole('group', { name: 'Excluir conta' })).getByRole('button', { name: 'Excluir conta' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Tem histórico: só é possível arquivar.')
  })

  it('nome repetido vira mensagem clara', async () => {
    mock.criarConta.mockRejectedValue({ code: '23505', message: 'duplicate key value violates unique constraint "accounts_name_uq"' })
    render(<MemoryRouter><Contas /></MemoryRouter>)
    const u = userEvent.setup()
    await u.click(await screen.findByRole('button', { name: 'Cadastrar a primeira conta' }))
    await u.type(screen.getByLabelText('Nome'), 'Itaú')
    await u.click(screen.getByRole('button', { name: 'Cadastrar conta' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Já existe um registro com esse nome.')
  })
  it('agrupa as contas ativas pelos 7 tipos (onde o dinheiro está), com o subtotal que vem do banco', async () => {
    mock.listarContas.mockResolvedValue({
      contas: [
        { ...corrente, id: 'a7', nome: 'Carteira de bolso', tipo: 'cash', saldo: c(2500) },
        { ...corrente, id: 'a6', nome: 'Moedas digitais', tipo: 'crypto', saldo: c(4000) },
        { ...corrente, id: 'a5', nome: 'Ações de teste', tipo: 'variable_income', saldo: c(70000) },
        { ...corrente, id: 'a4', nome: 'Tesouro de teste', tipo: 'fixed_income', saldo: c(227788) },
        { ...corrente, id: 'a3', nome: 'Saldo parado', tipo: 'brokerage', saldo: c(5000) },
        { ...corrente, id: 'a2', nome: 'Reserva de teste', tipo: 'savings', saldo: c(30000) },
        corrente,
      ],
      total: c(489338),
      porTipo: [
        { tipo: 'checking', total: c(125050), totalAtivas: c(125050) },
        { tipo: 'savings', total: c(30000), totalAtivas: c(30000) },
        // subtotal do banco diferente da soma da tela: prova que a tela não soma
        { tipo: 'brokerage', total: c(999999), totalAtivas: c(999999) },
        { tipo: 'fixed_income', total: c(227788), totalAtivas: c(227788) },
      ],
    })
    render(<MemoryRouter><Contas /></MemoryRouter>)
    const titulos = (await screen.findAllByRole('heading', { level: 2 })).map((h) => h.textContent)
    expect(titulos.slice(0, 7)).toEqual(['Contas correntes', 'Poupança / reserva', 'Corretora (saldo a aplicar)', 'Renda fixa',
      'Renda variável', 'Cripto', 'Dinheiro (carteira)'])
    expect(titulos).not.toContain('Investimentos')
    const corretora = screen.getByRole('heading', { name: 'Corretora (saldo a aplicar)' }).closest('section')!
    expect(within(corretora).getByText('Saldo parado')).toBeTruthy()
    expect(within(corretora).getByText('R$ 9.999,99')).toBeTruthy()
    expect(within(corretora).queryByText('Itaú')).toBeNull()
    expect(within(corretora).getByText(/^Corretora \(saldo a aplicar\) · desde/)).toBeTruthy()
    // sem subtotal do banco, o grupo não mostra soma feita na tela
    const cripto = screen.getByRole('heading', { name: 'Cripto' }).closest('section')!
    expect(within(cripto).queryByText('R$ 40,00', { selector: 'h2 + span' })).toBeNull()
  })

  it('conta com tipo antigo (front antes da migration 070) não some: vai para "Tipo a revisar" com o rótulo antigo', async () => {
    mock.listarContas.mockResolvedValue({
      contas: [corrente, { ...corrente, id: 'a9', nome: 'Aplicação antiga', tipo: 'investment' as unknown as 'checking', saldo: c(1000) }],
      total: c(126050),
    })
    render(<MemoryRouter><Contas /></MemoryRouter>)
    const grupo = (await screen.findByRole('heading', { name: 'Tipo a revisar' })).closest('section')!
    expect(within(grupo).getByText('Aplicação antiga')).toBeTruthy()
    expect(within(grupo).getByText(/^Investimento \(tipo antigo\) · desde/)).toBeTruthy()
    // editar não troca o tipo sem a pessoa escolher
    await userEvent.click(within(grupo).getByRole('button', { name: 'Editar' }))
    expect((screen.getByLabelText('Tipo') as HTMLSelectElement).value).toBe('investment')
    expect(screen.getByText('Tipo antigo: escolha onde o dinheiro está.')).toBeTruthy()
  })

  it('o cadastro oferece os 7 tipos agrupados (dia a dia, reserva, investimentos)', async () => {
    render(<MemoryRouter><Contas /></MemoryRouter>)
    await userEvent.click(await screen.findByRole('button', { name: 'Cadastrar a primeira conta' }))
    const tipo = screen.getByLabelText('Tipo') as HTMLSelectElement
    const grupos = Array.from(tipo.querySelectorAll('optgroup')).map((g) => [g.label, Array.from(g.querySelectorAll('option')).map((o) => o.textContent)])
    expect(grupos).toEqual([
      ['Dia a dia', ['Conta corrente', 'Dinheiro (carteira)']],
      ['Reserva', ['Poupança / reserva']],
      ['Investimentos', ['Corretora (saldo a aplicar)', 'Renda fixa', 'Renda variável', 'Cripto']],
    ])
    expect(Array.from(tipo.options).map((o) => o.value).sort()).toEqual(
      ['brokerage', 'cash', 'checking', 'crypto', 'fixed_income', 'savings', 'variable_income'])
    expect(screen.queryByRole('option', { name: 'Investimento' })).toBeNull()
    expect(screen.queryByRole('option', { name: 'Outra' })).toBeNull()
  })

  it('corretora (saldo a aplicar) explica que o dinheiro parado não rende e grava brokerage', async () => {
    render(<MemoryRouter><Contas /></MemoryRouter>)
    const u = userEvent.setup()
    await u.click(await screen.findByRole('button', { name: 'Cadastrar a primeira conta' }))
    await u.type(screen.getByLabelText('Nome'), 'Corretora de teste')
    await u.selectOptions(screen.getByLabelText('Tipo'), 'brokerage')
    expect(screen.getByLabelText('Tipo').getAttribute('aria-describedby')).toBe('tipo-conta-ajuda')
    expect(document.getElementById('tipo-conta-ajuda')!.textContent).toMatch(/parado na corretora.*não rende/)
    expect((screen.getByLabelText('Banco') as HTMLSelectElement).disabled).toBe(false)
    await u.click(screen.getByRole('button', { name: 'Cadastrar conta' }))
    expect(mock.criarConta).toHaveBeenCalledWith('h1', expect.objectContaining({ nome: 'Corretora de teste', tipo: 'brokerage' }))
  })
})

describe('Contas em outras moedas (multimoeda F1, migration 055)', () => {
  const dolar = { ...corrente, id: 'u1', nome: 'Conta em dólar', moeda: 'USD', saldoInicial: c(25050), saldo: c(25050) }

  it('cadastra conta em dólar: a moeda vai junto e o rótulo do saldo inicial muda', async () => {
    render(<MemoryRouter><Contas /></MemoryRouter>)
    const u = userEvent.setup()
    await u.click(await screen.findByRole('button', { name: 'Cadastrar a primeira conta' }))
    expect((screen.getByLabelText('Moeda') as HTMLSelectElement).value).toBe('BRL')
    await u.type(screen.getByLabelText('Nome'), 'Conta em dólar')
    await u.selectOptions(screen.getByLabelText('Moeda'), 'USD')
    const saldo = screen.getByLabelText('Saldo inicial (US$)')
    await u.clear(saldo)
    await u.type(saldo, '250,50')
    await u.click(screen.getByRole('button', { name: 'Cadastrar conta' }))
    expect(mock.criarConta).toHaveBeenCalledWith('h1', expect.objectContaining({ nome: 'Conta em dólar', saldoInicial: 25050, moeda: 'USD' }))
  })

  it('na edição a moeda fica travada e não é enviada', async () => {
    mock.listarContas.mockResolvedValue({ contas: [dolar], total: c(0), porMoeda: [{ moeda: 'USD', total: c(25050), totalAtivas: c(25050) }] })
    render(<MemoryRouter><Contas /></MemoryRouter>)
    const u = userEvent.setup()
    await u.click(await screen.findByRole('button', { name: 'Editar' }))
    const moeda = screen.getByLabelText('Moeda') as HTMLSelectElement
    expect(moeda.value).toBe('USD')
    expect(moeda.disabled).toBe(true)
    expect(screen.getByText('A moeda não muda depois de criada.')).toBeTruthy()
    await u.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(mock.editarConta.mock.calls[0][1]).not.toHaveProperty('moeda')
  })

  it('saldo na moeda da conta, com selo, num grupo à parte; o total em reais não soma o dólar', async () => {
    mock.listarContas.mockResolvedValue({
      contas: [corrente, dolar], total: c(125050),
      porTipo: [{ tipo: 'checking', total: c(125050), totalAtivas: c(125050) }],
      porMoeda: [{ moeda: 'BRL', total: c(125050), totalAtivas: c(125050) }, { moeda: 'USD', total: c(25050), totalAtivas: c(25050) }],
    })
    render(<MemoryRouter><Contas /></MemoryRouter>)
    const outras = (await screen.findByRole('heading', { name: 'Contas em outras moedas' })).closest('section') as HTMLElement
    expect(within(outras).getByText('Conta em dólar')).toBeTruthy()
    expect(within(outras).getByText('USD')).toBeTruthy() // selo
    expect(within(outras).getAllByText(/US\$\s*250,50/).length).toBeGreaterThan(0)
    const correntes = screen.getByRole('heading', { name: 'Contas correntes' }).closest('section') as HTMLElement
    expect(within(correntes).queryByText('Conta em dólar')).toBeNull()
    expect(screen.getByText('Saldo total em reais hoje')).toBeTruthy()
    const bloco = screen.getByRole('group', { name: 'Em outras moedas' })
    expect(bloco.textContent).toMatch(/US\$\s*250,50/)
    expect(bloco.textContent).not.toMatch(/R\$\s*1\.250,50/)
  })

  it('só com contas em reais, não mostra "Em outras moedas"', async () => {
    mock.listarContas.mockResolvedValue({ contas: [corrente], total: c(125050), porMoeda: [{ moeda: 'BRL', total: c(125050), totalAtivas: c(125050) }] })
    render(<MemoryRouter><Contas /></MemoryRouter>)
    expect(await screen.findByText('Saldo total hoje')).toBeTruthy()
    expect(screen.queryByRole('group', { name: 'Em outras moedas' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Contas em outras moedas' })).toBeNull()
  })
})
