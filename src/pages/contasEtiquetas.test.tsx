// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { Cents } from '../lib/format'

// etiquetas livres nas contas (migration 072): selos, filtro, marcar no formulário, criar na hora, renomear e apagar
const mock = vi.hoisted(() => ({
  listarContas: vi.fn(),
  criarConta: vi.fn(),
  editarConta: vi.fn(),
  listarEtiquetas: vi.fn(),
  criarEtiqueta: vi.fn(),
  renomearEtiqueta: vi.fn(),
  apagarEtiqueta: vi.fn(),
  definirEtiquetasDaConta: vi.fn(),
}))
vi.mock('../lib/FamiliaContext', () => ({
  useFamilia: () => ({ familia: { id: 'h1', nome: 'Casa', papel: 'owner' }, carregando: false, erro: false, recarregar: vi.fn() }),
}))
vi.mock('../lib/contas', async (original) => ({
  ...(await original<typeof import('../lib/contas')>()),
  listarContas: mock.listarContas,
  criarConta: mock.criarConta,
  editarConta: mock.editarConta,
}))
vi.mock('../lib/etiquetas', async (original) => ({
  ...(await original<typeof import('../lib/etiquetas')>()),
  listarEtiquetas: mock.listarEtiquetas,
  criarEtiqueta: mock.criarEtiqueta,
  renomearEtiqueta: mock.renomearEtiqueta,
  apagarEtiqueta: mock.apagarEtiqueta,
  definirEtiquetasDaConta: mock.definirEtiquetasDaConta,
}))

import Contas from './Contas'

const c = (n: number) => n as Cents
const conta = { tipo: 'checking' as const, banco: null, saldoInicial: c(0), abertura: '2026-11-01', ativa: true, moeda: 'BRL' }
const contas = [
  { ...conta, id: 'a1', nome: 'Itaú', saldo: c(100000) },
  { ...conta, id: 'a2', nome: 'Reserva Nubank', tipo: 'savings' as const, saldo: c(50000) },
  { ...conta, id: 'a3', nome: 'Conta PJ', saldo: c(20000) },
]
const etiquetas = [{ id: 't1', nome: 'Conjunta' }, { id: 't2', nome: 'Reserva de emergência' }]

beforeEach(() => {
  mock.listarContas.mockResolvedValue({
    contas, total: c(170000),
    porTipo: [{ tipo: 'checking', total: c(120000), totalAtivas: c(120000) }, { tipo: 'savings', total: c(50000), totalAtivas: c(50000) }],
  })
  mock.listarEtiquetas.mockResolvedValue({ disponivel: true, etiquetas, porConta: new Map([['a1', ['t1']], ['a2', ['t1', 't2']]]) })
  mock.criarConta.mockResolvedValue('a9')
  mock.editarConta.mockResolvedValue(undefined)
  mock.criarEtiqueta.mockResolvedValue({ id: 't3', nome: 'Viagem 2027' })
  mock.renomearEtiqueta.mockResolvedValue(undefined)
  mock.apagarEtiqueta.mockResolvedValue(undefined)
  mock.definirEtiquetasDaConta.mockResolvedValue(undefined)
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const item = async (nome: string) => (await screen.findByText(nome)).closest('li')!

describe('Contas: etiquetas', () => {
  it('mostra as etiquetas de cada conta como selos ao lado do tipo', async () => {
    render(<MemoryRouter><Contas /></MemoryRouter>)
    const reserva = await item('Reserva Nubank')
    expect(within(within(reserva).getByRole('list', { name: 'Etiquetas' })).getAllByRole('listitem').map((l) => l.textContent))
      .toEqual(['Conjunta', 'Reserva de emergência'])
    expect(within(await item('Conta PJ')).queryByRole('list', { name: 'Etiquetas' })).toBeNull()
  })

  it('filtra a lista por etiqueta e esconde os subtotais do banco (a tela não soma)', async () => {
    render(<MemoryRouter><Contas /></MemoryRouter>)
    await screen.findByText('Conta PJ')
    expect(screen.getByText('R$ 1.200,00')).toBeTruthy() // subtotal das correntes, do banco
    await userEvent.selectOptions(screen.getByLabelText('Filtrar por etiqueta'), 'Reserva de emergência')
    expect(screen.queryByText('Itaú')).toBeNull()
    expect(screen.queryByText('Conta PJ')).toBeNull()
    expect(screen.getByText('Reserva Nubank')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toMatch(/Mostrando 1 conta com a etiqueta "Reserva de emergência"/)
    expect(screen.queryByText('R$ 1.200,00')).toBeNull()
    expect(screen.getByText('R$ 1.700,00')).toBeTruthy() // o total da família continua
    await userEvent.selectOptions(screen.getByLabelText('Filtrar por etiqueta'), 'Todas as contas')
    expect(screen.getByText('Conta PJ')).toBeTruthy()
  })

  it('editar: marca e desmarca etiquetas e grava o conjunto novo', async () => {
    const u = userEvent.setup()
    render(<MemoryRouter><Contas /></MemoryRouter>)
    await u.click(within(await item('Itaú')).getByRole('button', { name: 'Editar' }))
    const grupo = screen.getByRole('group', { name: 'Etiquetas (opcional)' })
    expect((within(grupo).getByLabelText('Conjunta') as HTMLInputElement).checked).toBe(true)
    await u.click(within(grupo).getByLabelText('Conjunta'))
    await u.click(within(grupo).getByLabelText('Reserva de emergência'))
    await u.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(mock.editarConta).toHaveBeenCalled()
    expect(mock.definirEtiquetasDaConta).toHaveBeenCalledWith('a1', ['t2'])
  })

  it('editar sem mexer nas etiquetas não grava etiqueta', async () => {
    const u = userEvent.setup()
    render(<MemoryRouter><Contas /></MemoryRouter>)
    await u.click(within(await item('Reserva Nubank')).getByRole('button', { name: 'Editar' }))
    await u.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(mock.editarConta).toHaveBeenCalled()
    expect(mock.definirEtiquetasDaConta).not.toHaveBeenCalled()
  })

  it('nova conta: cria uma etiqueta na hora (Enter não envia a conta), marca e grava na conta criada', async () => {
    const u = userEvent.setup()
    render(<MemoryRouter><Contas /></MemoryRouter>)
    await u.click(await screen.findByRole('button', { name: 'Nova conta' }))
    await u.type(screen.getByLabelText('Nome'), 'Conta viagem')
    await u.type(screen.getByLabelText('Criar etiqueta nova'), 'Viagem 2027{Enter}')
    expect(mock.criarConta).not.toHaveBeenCalled()
    expect(mock.criarEtiqueta).toHaveBeenCalledWith('h1', 'Viagem 2027')
    expect((await screen.findByLabelText('Viagem 2027') as HTMLInputElement).checked).toBe(true)
    await u.click(screen.getByRole('button', { name: 'Cadastrar conta' }))
    expect(mock.definirEtiquetasDaConta).toHaveBeenCalledWith('a9', ['t3'])
  })

  it('não cria etiqueta repetida (sem olhar maiúscula) nem chama o banco', async () => {
    const u = userEvent.setup()
    render(<MemoryRouter><Contas /></MemoryRouter>)
    await u.click(await screen.findByRole('button', { name: 'Nova conta' }))
    await u.type(screen.getByLabelText('Criar etiqueta nova'), 'CONJUNTA')
    await u.click(screen.getByRole('button', { name: 'Criar e marcar' }))
    expect(screen.getByRole('alert').textContent).toBe('Já existe a etiqueta "Conjunta".')
    expect(mock.criarEtiqueta).not.toHaveBeenCalled()
  })

  it('conta salva mas etiquetas recusadas: fecha o formulário e avisa', async () => {
    mock.definirEtiquetasDaConta.mockRejectedValue({ code: '23514', message: 'limite de 10 etiquetas por conta' })
    const u = userEvent.setup()
    render(<MemoryRouter><Contas /></MemoryRouter>)
    await u.click(within(await item('Conta PJ')).getByRole('button', { name: 'Editar' }))
    await u.click(within(screen.getByRole('group', { name: 'Etiquetas (opcional)' })).getByLabelText('Conjunta'))
    await u.click(screen.getByRole('button', { name: 'Salvar' }))
    expect((await screen.findByRole('alert')).textContent).toBe('A conta foi salva, mas as etiquetas não: Limite de 10 etiquetas por conta.')
    expect(screen.queryByRole('button', { name: 'Salvar' })).toBeNull()
  })

  it('renomear e apagar (com confirmação que explica que só tira das contas)', async () => {
    const u = userEvent.setup()
    render(<MemoryRouter><Contas /></MemoryRouter>)
    await u.click(await screen.findByText('Etiquetas (2)'))
    expect(screen.getByText(/em 2 contas/)).toBeTruthy()
    await u.click(screen.getByRole('button', { name: 'Renomear Conjunta' }))
    const campo = screen.getByLabelText('Novo nome para Conjunta')
    await u.clear(campo)
    await u.type(campo, 'Conta conjunta')
    await u.click(screen.getByRole('button', { name: 'Salvar nome' }))
    expect(mock.renomearEtiqueta).toHaveBeenCalledWith('t1', 'Conta conjunta')

    await u.click(screen.getByRole('button', { name: 'Apagar Reserva de emergência' }))
    const conf = screen.getByRole('group', { name: 'Apagar a etiqueta Reserva de emergência' })
    expect(conf.textContent).toMatch(/em 1 conta e só sai delas: as contas, os saldos e os lançamentos não mudam/)
    expect(mock.apagarEtiqueta).not.toHaveBeenCalled()
    await u.click(within(conf).getByRole('button', { name: 'Apagar etiqueta' }))
    expect(mock.apagarEtiqueta).toHaveBeenCalledWith('t2')
    expect(mock.listarEtiquetas).toHaveBeenCalledTimes(3) // carga inicial + depois de renomear + depois de apagar
  })

  it('o filtro por etiqueta também vale para as arquivadas abertas', async () => {
    mock.listarContas.mockResolvedValue({
      contas: [...contas, { ...conta, id: 'a4', nome: 'Antiga conjunta', ativa: false, saldo: c(0) }, { ...conta, id: 'a5', nome: 'Antiga solta', ativa: false, saldo: c(0) }],
      total: c(170000),
    })
    mock.listarEtiquetas.mockResolvedValue({ disponivel: true, etiquetas, porConta: new Map([['a1', ['t1']], ['a4', ['t1']]]) })
    const u = userEvent.setup()
    render(<MemoryRouter><Contas /></MemoryRouter>)
    await u.click(await screen.findByRole('button', { name: 'Arquivadas (2)' }))
    expect(screen.getByText('Antiga solta')).toBeTruthy()
    await u.selectOptions(screen.getByLabelText('Filtrar por etiqueta'), 'Conjunta')
    expect(screen.getByText('Antiga conjunta')).toBeTruthy()
    expect(screen.queryByText('Antiga solta')).toBeNull()
    await u.selectOptions(screen.getByLabelText('Filtrar por etiqueta'), 'Reserva de emergência')
    // nenhuma arquivada com a etiqueta: o botão some
    expect(screen.queryByRole('button', { name: /arquivadas/i })).toBeNull()
  })

  it('banco sem a migration 072: nada de etiqueta na tela', async () => {
    mock.listarEtiquetas.mockResolvedValue({ disponivel: false, etiquetas: [], porConta: new Map() })
    const u = userEvent.setup()
    render(<MemoryRouter><Contas /></MemoryRouter>)
    await screen.findByText('Itaú')
    expect(screen.queryByLabelText('Filtrar por etiqueta')).toBeNull()
    expect(screen.queryByText(/Etiquetas \(/)).toBeNull()
    await u.click(screen.getByRole('button', { name: 'Nova conta' }))
    expect(screen.queryByRole('group', { name: 'Etiquetas (opcional)' })).toBeNull()
  })

  it('falha ao ler as etiquetas não esconde as contas', async () => {
    mock.listarEtiquetas.mockRejectedValue({ code: '500', message: 'x' })
    render(<MemoryRouter><Contas /></MemoryRouter>)
    expect(await screen.findByText('Itaú')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toMatch(/^As etiquetas não carregaram/)
  })
})
