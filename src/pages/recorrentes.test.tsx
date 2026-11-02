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
  excluirRecorrencia: vi.fn(),
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
  editarRecorrencia: mock.editarRecorrencia, excluirRecorrencia: mock.excluirRecorrencia,
}))
vi.mock('../lib/contas', async (o) => ({ ...(await o<typeof import('../lib/contas')>()), listarContas: mock.listarContas }))
vi.mock('../lib/cartoes', async (o) => ({ ...(await o<typeof import('../lib/cartoes')>()), listarCartoes: mock.listarCartoes }))
vi.mock('../lib/categorias', async (o) => ({ ...(await o<typeof import('../lib/categorias')>()), listarCategorias: mock.listarCategorias }))

import Recorrentes from './Recorrentes'

const c = (n: number) => n as Cents
const luz = {
  id: 'r1', tipo: 'expense' as const, descricao: 'Luz', valor: c(18000), dia: 10 as number | null, unidade: 'month' as const, cada: 1,
  inicio: '2026-10-01', fim: null as string | null,
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
  for (const f of [mock.criarRecorrencia, mock.editarRecorrencia]) f.mockResolvedValue(undefined)
  mock.excluirRecorrencia.mockResolvedValue(0)
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
  })

  it('cadastra despesa mensal em conta', async () => {
    const u = userEvent.setup()
    montar()
    await u.click(await screen.findByRole('button', { name: 'Novo recorrente' }))
    await u.type(screen.getByLabelText('Descrição'), 'Luz')
    await u.type(screen.getByLabelText('Valor estimado (R$)'), '180,00')
    await u.selectOptions(screen.getByLabelText('Dia do mês'), '10')
    await u.selectOptions(screen.getByLabelText('Categoria'), 'g1')
    await u.click(screen.getByRole('button', { name: 'Cadastrar recorrente' }))
    expect(mock.criarRecorrencia).toHaveBeenCalledWith(expect.objectContaining({
      tipo: 'expense', descricao: 'Luz', valor: 18000, dia: 10, contaId: 'a1', destinoId: null, cartaoId: null, categoriaId: 'g1',
      unidade: 'month', cada: 1, fim: null,
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
    await u.selectOptions(screen.getByLabelText('Dia do mês'), '5')
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
    await u.selectOptions(screen.getByLabelText('Dia do mês'), '31')
    await u.click(screen.getByRole('button', { name: 'Cadastrar recorrente' }))
    expect(screen.getByText('Escolha uma conta de destino diferente.')).toBeTruthy()
    await u.selectOptions(screen.getByLabelText('Para a conta'), 'a2')
    await u.click(screen.getByRole('button', { name: 'Cadastrar recorrente' }))
    expect(mock.criarRecorrencia).toHaveBeenCalledWith(expect.objectContaining({ tipo: 'transfer', contaId: 'a1', destinoId: 'a2', categoriaId: null }))
  })

  it('editar muda valor', async () => {
    const u = userEvent.setup()
    mock.listarRecorrencias.mockResolvedValue([luz])
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    montar()
    await u.click(await screen.findByRole('button', { name: 'Editar' }))
    expect(screen.queryByLabelText('Dia do mês')).toBeNull() // dia e conta não mudam na edição
    // avisa o alcance de cada campo e que a correção feita à mão em um mês não é desfeita pelo reajuste
    expect(screen.getByText(/Valor e descrição valem para os planejados ainda não pagos de hoje em diante\. A categoria vale para todos os meses, inclusive os já pagos e os passados\. Em qualquer caso, o que você corrigiu à mão em um mês fica como está\./)).toBeTruthy()
    // frequência não muda na edição: diz como mudar
    expect(screen.queryByLabelText('Frequência')).toBeNull()
    expect(screen.getByText(/Todo dia 10\. .*Para mudar a frequência ou o dia, exclua este recorrente e cadastre outro\./)).toBeTruthy()
    const valor = screen.getByLabelText('Valor estimado (R$)')
    await u.clear(valor)
    await u.type(valor, '200,00')
    await u.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(mock.editarRecorrencia).toHaveBeenCalledWith('r1', { descricao: 'Luz', valor: 20000, categoriaId: 'g1' })
  })

  it('excluir pede confirmação e só então exclui; recusar a confirmação não faz nada', async () => {
    const u = userEvent.setup()
    mock.listarRecorrencias.mockResolvedValue([luz])
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValue(false)
    montar()
    await u.click(await screen.findByRole('button', { name: 'Excluir' }))
    expect(confirmar).toHaveBeenCalledWith(expect.stringContaining('Excluir "Luz"?'))
    expect(mock.excluirRecorrencia).not.toHaveBeenCalled()
    confirmar.mockReturnValue(true)
    await u.click(screen.getByRole('button', { name: 'Excluir' }))
    expect(mock.excluirRecorrencia).toHaveBeenCalledWith('r1')
    expect(mock.listarRecorrencias).toHaveBeenCalledTimes(2) // recarrega a lista
  })

  it('não existe mais "Encerrar": o fim de um recorrente é excluí-lo', async () => {
    mock.listarRecorrencias.mockResolvedValue([luz])
    montar()
    await screen.findByText('Luz')
    expect(screen.queryByRole('button', { name: 'Encerrar' })).toBeNull()
  })

  it('não exibe regras inativas/encerradas como arquivo', async () => {
    mock.listarRecorrencias.mockResolvedValue([{ ...luz, id: 'r2', descricao: 'Academia antiga', ativa: false, fim: '2026-09-30' }])
    montar()
    expect(await screen.findByText('Nenhum recorrente ainda')).toBeTruthy()
    expect(screen.queryByText('Academia antiga')).toBeNull()
    expect(screen.queryByText(/Encerrados/)).toBeNull()
  })

  it('erro ao excluir aparece na tela e a lista não some', async () => {
    const u = userEvent.setup()
    mock.listarRecorrencias.mockResolvedValue([luz])
    mock.excluirRecorrencia.mockRejectedValue({ code: '42501', message: 'registro não encontrado' })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    montar()
    await u.click(await screen.findByRole('button', { name: 'Excluir' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByText('Luz')).toBeTruthy()
  })

  it('lista mostra a frequência, a próxima data e a data final', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-28T15:00:00Z'))
    mock.listarRecorrencias.mockResolvedValue([
      { ...luz, id: 'r3', descricao: 'PLR', tipo: 'income' as const, categoriaId: 'g2', dia: 20, cada: 12, inicio: '2027-02-01' },
      { ...luz, id: 'r4', descricao: 'Diarista', unidade: 'week' as const, cada: 2, dia: null, inicio: '2026-10-23', fim: '2027-06-30' },
    ])
    montar()
    expect(await screen.findByText('PLR')).toBeTruthy()
    expect(screen.getByText('Anual · 20 de fevereiro · Itaú · Salário')).toBeTruthy()
    expect(screen.getByText(/próxima 20\/02\/2027/)).toBeTruthy()
    expect(screen.getByText('Quinzenal · sexta · Itaú · Moradia')).toBeTruthy()
    expect(screen.getByText(/próxima 06\/11\/2026 · até 30\/06\/2027/)).toBeTruthy()
    vi.useRealTimers()
  })

  it('cadastra quinzenal: sem dia do mês, primeira data, data final e prévia das próximas', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-28T15:00:00Z'))
    const u = userEvent.setup()
    montar()
    await u.click(await screen.findByRole('button', { name: 'Novo recorrente' }))
    await u.selectOptions(screen.getByLabelText('Tipo'), 'income')
    await u.type(screen.getByLabelText('Descrição'), 'Freela')
    await u.type(screen.getByLabelText('Valor estimado (R$)'), '700,00')
    await u.selectOptions(screen.getByLabelText('Frequência'), 'quinzenal')
    expect(screen.queryByLabelText('Dia do mês')).toBeNull()
    const primeira = screen.getByLabelText('Primeira vez em')
    await u.clear(primeira)
    await u.type(primeira, '2026-10-30')
    await u.type(screen.getByLabelText('Até (opcional)'), '2027-03-31')
    expect(screen.getByText(/Repete toda sexta, a cada 14 dias\./)).toBeTruthy()
    expect(screen.getByText('30/10/2026 · 13/11/2026 · 27/11/2026')).toBeTruthy()
    await u.selectOptions(screen.getByLabelText('Categoria'), 'g2')
    await u.click(screen.getByRole('button', { name: 'Cadastrar recorrente' }))
    expect(mock.criarRecorrencia).toHaveBeenCalledWith(expect.objectContaining({
      tipo: 'income', unidade: 'week', cada: 2, dia: null, inicio: '2026-10-30', fim: '2027-03-31',
    }))
    vi.useRealTimers()
  })

  it('anual (PLR): dia do mês e mês do início; prévia mostra os anos seguintes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-28T15:00:00Z'))
    const u = userEvent.setup()
    montar()
    await u.click(await screen.findByRole('button', { name: 'Novo recorrente' }))
    await u.selectOptions(screen.getByLabelText('Tipo'), 'income')
    await u.type(screen.getByLabelText('Descrição'), 'PLR')
    await u.type(screen.getByLabelText('Valor estimado (R$)'), '9.000,00')
    await u.selectOptions(screen.getByLabelText('Frequência'), 'anual')
    await u.selectOptions(screen.getByLabelText('Dia do mês'), '20')
    const inicio = screen.getByLabelText('A partir de')
    await u.clear(inicio)
    await u.type(inicio, '2027-02-01')
    expect(screen.getByText('20/02/2027 · 20/02/2028 · 20/02/2029')).toBeTruthy()
    await u.selectOptions(screen.getByLabelText('Categoria'), 'g2')
    await u.click(screen.getByRole('button', { name: 'Cadastrar recorrente' }))
    expect(mock.criarRecorrencia).toHaveBeenCalledWith(expect.objectContaining({ unidade: 'month', cada: 12, dia: 20, inicio: '2027-02-01', fim: null }))
    vi.useRealTimers()
  })

  it('personalizada valida o limite (1–4 semanas) e avisa que datas antes de hoje não entram', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-28T15:00:00Z'))
    const u = userEvent.setup()
    montar()
    await u.click(await screen.findByRole('button', { name: 'Novo recorrente' }))
    await u.type(screen.getByLabelText('Descrição'), 'Faxina')
    await u.type(screen.getByLabelText('Valor estimado (R$)'), '200,00')
    await u.selectOptions(screen.getByLabelText('Frequência'), 'personalizada')
    await u.selectOptions(screen.getByLabelText('Unidade'), 'week')
    const cada = screen.getByLabelText('A cada')
    await u.clear(cada)
    await u.type(cada, '5')
    const primeira = screen.getByLabelText('Primeira vez em')
    await u.clear(primeira)
    await u.type(primeira, '2026-09-01')
    expect(screen.getByText(/Datas antes de hoje não são criadas\./)).toBeTruthy()
    await u.selectOptions(screen.getByLabelText('Categoria'), 'g1')
    await u.click(screen.getByRole('button', { name: 'Cadastrar recorrente' }))
    expect(screen.getByText('Use de 1 a 4 semanas.')).toBeTruthy()
    expect(mock.criarRecorrencia).not.toHaveBeenCalled()
    await u.clear(cada)
    await u.type(cada, '3')
    await u.click(screen.getByRole('button', { name: 'Cadastrar recorrente' }))
    expect(mock.criarRecorrencia).toHaveBeenCalledWith(expect.objectContaining({ unidade: 'week', cada: 3, dia: null }))
    vi.useRealTimers()
  })

  it('data final antes do início é recusada', async () => {
    const u = userEvent.setup()
    montar()
    await u.click(await screen.findByRole('button', { name: 'Novo recorrente' }))
    await u.type(screen.getByLabelText('Descrição'), 'Luz')
    await u.type(screen.getByLabelText('Valor estimado (R$)'), '180,00')
    await u.selectOptions(screen.getByLabelText('Dia do mês'), '10')
    const inicio = screen.getByLabelText('A partir de')
    await u.clear(inicio)
    await u.type(inicio, '2027-01-01')
    await u.type(screen.getByLabelText('Até (opcional)'), '2026-12-01')
    await u.selectOptions(screen.getByLabelText('Categoria'), 'g1')
    await u.click(screen.getByRole('button', { name: 'Cadastrar recorrente' }))
    expect(screen.getByText('A data final não pode ser antes do início.')).toBeTruthy()
    expect(mock.criarRecorrencia).not.toHaveBeenCalled()
  })
})
