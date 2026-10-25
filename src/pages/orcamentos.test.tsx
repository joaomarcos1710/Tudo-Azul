// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Cents } from '../lib/format'

const mock = vi.hoisted(() => ({
  listarOrcamentos: vi.fn(),
  definirOrcamento: vi.fn(),
  removerOrcamento: vi.fn(),
  copiarDoMesAnterior: vi.fn(),
  listarCategorias: vi.fn(),
}))
vi.mock('../lib/FamiliaContext', () => ({
  useFamilia: () => ({ familia: { id: 'h1', nome: 'Casa', papel: 'owner' }, carregando: false, erro: false, recarregar: vi.fn() }),
}))
vi.mock('../lib/orcamentos', () => ({
  listarOrcamentos: mock.listarOrcamentos, definirOrcamento: mock.definirOrcamento,
  removerOrcamento: mock.removerOrcamento, copiarDoMesAnterior: mock.copiarDoMesAnterior,
}))
vi.mock('../lib/categorias', async (o) => ({ ...(await o<typeof import('../lib/categorias')>()), listarCategorias: mock.listarCategorias }))
// data e mês fixos: o teste não depende do dia em que roda
const hojeFixo = vi.hoisted(() => ({ v: '2026-10-10' }))
vi.mock('../lib/contas', async (o) => ({ ...(await o<typeof import('../lib/contas')>()), hojeSP: () => hojeFixo.v }))
vi.mock('../lib/format', async (o) => ({ ...(await o<typeof import('../lib/format')>()), currentMonth: () => hojeFixo.v.slice(0, 7) }))

import Orcamentos from './Orcamentos'

const c = (n: number) => n as Cents
const cat = (id: string, nome: string, extra: Record<string, unknown> = {}) =>
  ({ id, nome, tipo: 'expense', paiId: null, sistema: false, ativa: true, eventual: false, ...extra })
const orc = (extra: Record<string, unknown> = {}) => ({
  categoriaId: 'mercado', nome: 'Mercado', limite: c(100000), gasto: c(30000), previsto: c(20000), ritmo: c(63000),
  projetado: c(113000), sobra: c(-13000), ...extra,
})

beforeEach(() => {
  hojeFixo.v = '2026-10-10'
  mock.listarOrcamentos.mockResolvedValue([orc()])
  mock.listarCategorias.mockResolvedValue([
    cat('mercado', 'Mercado'), cat('lazer', 'Lazer'), cat('feira', 'Feira', { paiId: 'mercado' }), cat('antiga', 'Antiga', { ativa: false }),
    cat('semcat', 'Sem categoria', { sistema: true }), cat('salario', 'Salário', { tipo: 'income' }),
  ])
  for (const f of [mock.definirOrcamento, mock.removerOrcamento]) f.mockResolvedValue(undefined)
  mock.copiarDoMesAnterior.mockResolvedValue(2)
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('Orçamentos', () => {
  it('mostra limite, gasto e a projeção do banco: vai passar do limite no ritmo atual', async () => {
    render(<Orcamentos />)
    expect(await screen.findByText('Mercado')).toBeTruthy()
    expect(screen.getByText('Limite R$ 1.000,00')).toBeTruthy()
    expect(screen.getByText('R$ 300,00')).toBeTruthy()
    expect(screen.getByText(/No ritmo atual vai passar do limite em R\$ 130,00/)).toBeTruthy()
    expect(screen.getByText(/projeção R\$ 1.130,00/)).toBeTruthy()
    expect(screen.getByText(/Gasto R\$ 300,00 \+ previsto R\$ 200,00 \+ ritmo do mês R\$ 630,00/)).toBeTruthy()
    expect(mock.listarOrcamentos).toHaveBeenCalledWith('h1', '2026-10', '2026-10-10')
  })

  it('projeção dentro do limite: mostra quanto sobra', async () => {
    mock.listarOrcamentos.mockResolvedValue([orc({ projetado: c(80000), sobra: c(20000) })])
    render(<Orcamentos />)
    expect(await screen.findByText(/No ritmo: projeção R\$ 800,00, sobram R\$ 200,00/)).toBeTruthy()
  })

  it('já estourou o limite: avisa o quanto, sem falar de projeção', async () => {
    mock.listarOrcamentos.mockResolvedValue([orc({ gasto: c(120000), projetado: c(150000), sobra: c(-50000) })])
    render(<Orcamentos />)
    expect(await screen.findByText('Já passou do limite em R$ 200,00.')).toBeTruthy()
    expect(screen.queryByText(/No ritmo/)).toBeNull()
  })

  it('mês passado: sem projeção, só o resultado', async () => {
    mock.listarOrcamentos.mockResolvedValue([orc({ gasto: c(90000), previsto: null, ritmo: null, projetado: null, sobra: null })])
    const u = userEvent.setup()
    render(<Orcamentos />)
    await screen.findByText('Mercado')
    await u.click(screen.getByRole('button', { name: 'Mês anterior' }))
    expect(await screen.findByText(/Ainda dentro do limite: sobram R\$ 100,00/)).toBeTruthy()
    expect(mock.listarOrcamentos).toHaveBeenLastCalledWith('h1', '2026-09', '2026-10-10')
  })

  it('nos primeiros dias do mês avisa que a projeção é instável', async () => {
    hojeFixo.v = '2026-10-03'
    render(<Orcamentos />)
    expect(await screen.findByText(/Projeção ainda instável: só 3 dias do mês/)).toBeTruthy()
  })

  it('sem orçamento: convida a definir ou copiar do mês anterior', async () => {
    mock.listarOrcamentos.mockResolvedValue([])
    const u = userEvent.setup()
    render(<Orcamentos />)
    expect(await screen.findByText(/Nenhum orçamento em/)).toBeTruthy()
    await u.click(screen.getByRole('button', { name: 'Copiar do mês anterior' }))
    expect(mock.copiarDoMesAnterior).toHaveBeenCalledWith('h1', '2026-10', '2026-09')
    expect(await screen.findByText(/2 limites copiados/)).toBeTruthy()
  })

  it('novo orçamento: só categorias principais de despesa, ativas e sem orçamento; grava em centavos', async () => {
    const u = userEvent.setup()
    render(<Orcamentos />)
    await u.click(await screen.findByRole('button', { name: 'Novo orçamento' }))
    const opcoes = within(screen.getByLabelText('Categoria')).getAllByRole('option').map((o) => o.textContent)
    expect(opcoes).toEqual(['Escolha…', 'Lazer']) // Mercado já tem; Feira é subcategoria; Antiga está desativada; Sem categoria é do sistema
    await u.selectOptions(screen.getByLabelText('Categoria'), 'lazer')
    await u.type(screen.getByLabelText('Limite do mês (R$)'), '1.500,00')
    await u.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(mock.definirOrcamento).toHaveBeenCalledWith('h1', 'lazer', '2026-10', 150000)
  })

  it('valor zero, inválido ou categoria não escolhida não chegam ao banco', async () => {
    const u = userEvent.setup()
    render(<Orcamentos />)
    await u.click(await screen.findByRole('button', { name: 'Novo orçamento' }))
    await u.type(screen.getByLabelText('Limite do mês (R$)'), '0')
    await u.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(await screen.findByText(/Informe um valor maior que zero/)).toBeTruthy()
    expect(screen.getByText('Escolha a categoria.')).toBeTruthy()
    expect(mock.definirOrcamento).not.toHaveBeenCalled()
  })

  it('alterar o limite grava o novo valor', async () => {
    const u = userEvent.setup()
    render(<Orcamentos />)
    await u.click(await screen.findByRole('button', { name: 'Alterar limite' }))
    const campo = screen.getByLabelText('Limite do mês (R$)') as HTMLInputElement
    expect(campo.value).toBe('1.000,00')
    await u.clear(campo)
    await u.type(campo, '1.200,00')
    await u.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(mock.definirOrcamento).toHaveBeenCalledWith('h1', 'mercado', '2026-10', 120000)
  })

  it('remover pede confirmação e só então apaga', async () => {
    const u = userEvent.setup()
    const confirma = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    render(<Orcamentos />)
    await u.click(await screen.findByRole('button', { name: 'Remover' }))
    expect(mock.removerOrcamento).not.toHaveBeenCalled()
    await u.click(screen.getByRole('button', { name: 'Remover' }))
    expect(mock.removerOrcamento).toHaveBeenCalledWith('h1', 'mercado', '2026-10')
    expect(confirma).toHaveBeenCalledTimes(2)
  })

  it('erro do banco ao salvar aparece e o formulário continua aberto', async () => {
    mock.definirOrcamento.mockRejectedValue(new Error('falhou'))
    const u = userEvent.setup()
    render(<Orcamentos />)
    await u.click(await screen.findByRole('button', { name: 'Alterar limite' }))
    await u.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByLabelText('Limite do mês (R$)')).toBeTruthy()
  })
})
