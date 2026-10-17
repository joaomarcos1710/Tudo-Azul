// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { Cents } from '../lib/format'

const mock = vi.hoisted(() => ({
  listarRecorrencias: vi.fn(),
  criarRecorrencia: vi.fn(),
  editarRecorrencia: vi.fn(),
  encerrarRecorrencia: vi.fn(),
  listarContas: vi.fn(),
  listarCartoes: vi.fn(),
  listarCategorias: vi.fn(),
}))
vi.mock('../lib/FamiliaContext', () => ({
  useFamilia: () => ({ familia: { id: 'h1', nome: 'Casa', papel: 'owner' }, carregando: false, erro: false, recarregar: vi.fn() }),
}))
vi.mock('../lib/recorrencias', async (o) => ({
  ...(await o<typeof import('../lib/recorrencias')>()),
  listarRecorrencias: mock.listarRecorrencias, criarRecorrencia: mock.criarRecorrencia,
  editarRecorrencia: mock.editarRecorrencia, encerrarRecorrencia: mock.encerrarRecorrencia,
}))
vi.mock('../lib/contas', async (o) => ({ ...(await o<typeof import('../lib/contas')>()), listarContas: mock.listarContas }))
vi.mock('../lib/cartoes', async (o) => ({ ...(await o<typeof import('../lib/cartoes')>()), listarCartoes: mock.listarCartoes }))
vi.mock('../lib/categorias', async (o) => ({ ...(await o<typeof import('../lib/categorias')>()), listarCategorias: mock.listarCategorias }))

import Recorrentes from './Recorrentes'

const c = (n: number) => n as Cents
const luz = {
  id: 'r1', tipo: 'expense' as const, descricao: 'Luz', valor: c(18000), dia: 10, inicio: '2026-10-01', fim: null,
  contaId: 'a1', destinoId: null, cartaoId: null, categoriaId: 'g1', ativa: true,
}
const montar = () => render(<MemoryRouter><Recorrentes /></MemoryRouter>)

beforeEach(() => {
  mock.listarRecorrencias.mockResolvedValue([])
  mock.listarContas.mockResolvedValue({
    contas: [
      { id: 'a1', nome: 'Itaú', tipo: 'checking', saldoInicial: c(0), abertura: '2026-01-01', ativa: true, saldo: c(0) },
      { id: 'a2', nome: 'Poupança', tipo: 'savings', saldoInicial: c(0), abertura: '2026-01-01', ativa: true, saldo: c(0) },
    ],
    total: c(0),
  })
  mock.listarCartoes.mockResolvedValue([
    { id: 'k1', nome: 'Nubank', fechamento: 17, vencimento: 25, ativo: true, divida: c(0), credito: c(0), compromissos: c(0) },
  ])
  mock.listarCategorias.mockResolvedValue([
    { id: 'g1', nome: 'Moradia', tipo: 'expense', paiId: null, sistema: false, ativa: true },
    { id: 'g2', nome: 'Salário', tipo: 'income', paiId: null, sistema: false, ativa: true },
  ])
  for (const f of [mock.criarRecorrencia, mock.editarRecorrencia, mock.encerrarRecorrencia]) f.mockResolvedValue(undefined)
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('Recorrentes', () => {
  it('sem regras, convida a cadastrar', async () => {
    montar()
    expect(await screen.findByText('Nenhum recorrente ainda')).toBeTruthy()
  })

  it('lista as regras ativas com dia, conta, categoria e valor', async () => {
    mock.listarRecorrencias.mockResolvedValue([luz, { ...luz, id: 'r2', descricao: 'Academia antiga', ativa: false, fim: '2026-09-30' }])
    montar()
    expect(await screen.findByText('Luz')).toBeTruthy()
    expect(screen.getByText('Todo dia 10 · Itaú · Moradia')).toBeTruthy()
    expect(screen.getByText('−R$ 180,00')).toBeTruthy()
    expect(screen.getByText('Encerrados (1)')).toBeTruthy()
  })

  it('cadastra despesa mensal em conta', async () => {
    const u = userEvent.setup()
    montar()
    await u.click(await screen.findByRole('button', { name: 'Novo recorrente' }))
    await u.type(screen.getByLabelText('Descrição'), 'Luz')
    await u.type(screen.getByLabelText('Valor estimado (R$)'), '180,00')
    await u.selectOptions(screen.getByLabelText('Todo dia'), '10')
    await u.selectOptions(screen.getByLabelText('Categoria'), 'g1')
    await u.click(screen.getByRole('button', { name: 'Cadastrar recorrente' }))
    expect(mock.criarRecorrencia).toHaveBeenCalledWith(expect.objectContaining({
      tipo: 'expense', descricao: 'Luz', valor: 18000, dia: 10, contaId: 'a1', destinoId: null, cartaoId: null, categoriaId: 'g1',
    }))
  })

  it('assinatura no cartão: pede o cartão, não a conta', async () => {
    const u = userEvent.setup()
    montar()
    await u.click(await screen.findByRole('button', { name: 'Novo recorrente' }))
    await u.selectOptions(screen.getByLabelText('Tipo'), 'card')
    expect(screen.queryByLabelText('Conta')).toBeNull()
    await u.type(screen.getByLabelText('Descrição'), 'Netflix')
    await u.type(screen.getByLabelText('Valor (R$)'), '55,90')
    await u.selectOptions(screen.getByLabelText('Todo dia'), '5')
    await u.selectOptions(screen.getByLabelText('Categoria'), 'g1')
    await u.click(screen.getByRole('button', { name: 'Cadastrar recorrente' }))
    expect(mock.criarRecorrencia).toHaveBeenCalledWith(expect.objectContaining({
      tipo: 'card', valor: 5590, dia: 5, contaId: null, cartaoId: 'k1', categoriaId: 'g1',
    }))
  })

  it('receita só oferece categorias de receita', async () => {
    const u = userEvent.setup()
    montar()
    await u.click(await screen.findByRole('button', { name: 'Novo recorrente' }))
    await u.selectOptions(screen.getByLabelText('Tipo'), 'income')
    expect(screen.queryByRole('option', { name: 'Moradia' })).toBeNull()
    expect(screen.getByRole('option', { name: 'Salário' })).toBeTruthy()
  })

  it('transferência exige destino diferente e não tem categoria', async () => {
    const u = userEvent.setup()
    montar()
    await u.click(await screen.findByRole('button', { name: 'Novo recorrente' }))
    await u.selectOptions(screen.getByLabelText('Tipo'), 'transfer')
    expect(screen.queryByLabelText('Categoria')).toBeNull()
    await u.type(screen.getByLabelText('Descrição'), 'Guardar')
    await u.type(screen.getByLabelText('Valor estimado (R$)'), '500,00')
    await u.selectOptions(screen.getByLabelText('Todo dia'), '31')
    await u.click(screen.getByRole('button', { name: 'Cadastrar recorrente' }))
    expect(screen.getByText('Escolha uma conta de destino diferente.')).toBeTruthy()
    await u.selectOptions(screen.getByLabelText('Para a conta'), 'a2')
    await u.click(screen.getByRole('button', { name: 'Cadastrar recorrente' }))
    expect(mock.criarRecorrencia).toHaveBeenCalledWith(expect.objectContaining({ tipo: 'transfer', contaId: 'a1', destinoId: 'a2', categoriaId: null }))
  })

  it('editar muda valor; encerrar pede confirmação', async () => {
    const u = userEvent.setup()
    mock.listarRecorrencias.mockResolvedValue([luz])
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    montar()
    await u.click(await screen.findByRole('button', { name: 'Editar' }))
    expect(screen.queryByLabelText('Todo dia')).toBeNull() // dia e conta não mudam na edição
    const valor = screen.getByLabelText('Valor estimado (R$)')
    await u.clear(valor)
    await u.type(valor, '200,00')
    await u.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(mock.editarRecorrencia).toHaveBeenCalledWith('r1', { descricao: 'Luz', valor: 20000, categoriaId: 'g1' })
    await u.click(await screen.findByRole('button', { name: 'Encerrar' }))
    expect(window.confirm).toHaveBeenCalled()
    expect(mock.encerrarRecorrencia).toHaveBeenCalledWith('r1')
  })
})
