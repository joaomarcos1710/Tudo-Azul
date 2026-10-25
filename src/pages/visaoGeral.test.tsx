// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { Cents } from '../lib/format'

const mock = vi.hoisted(() => ({
  carregarPatrimonio: vi.fn(),
  proximosPlanejados: vi.fn(),
  resumoDoMes: vi.fn(),
  listarContas: vi.fn(),
  despesasPorCategoria: vi.fn(),
  despesasPorDia: vi.fn(),
  regularidadeRenda: vi.fn(),
  listarLancamentos: vi.fn(),
  listarCategorias: vi.fn(),
}))
vi.mock('../lib/FamiliaContext', () => ({
  useFamilia: () => ({ familia: { id: 'h1', nome: 'Casa', papel: 'owner' }, carregando: false, erro: false, recarregar: vi.fn() }),
}))
vi.mock('../lib/painel', () => ({
  carregarPatrimonio: mock.carregarPatrimonio, proximosPlanejados: mock.proximosPlanejados,
  despesasPorCategoria: mock.despesasPorCategoria, despesasPorDia: mock.despesasPorDia,
  regularidadeRenda: mock.regularidadeRenda,
}))
vi.mock('../lib/auth', () => ({ useAuth: () => ({ sessao: { user: { user_metadata: { name: 'João Marcos' } } }, carregando: false }) }))
vi.mock('../lib/categorias', () => ({ listarCategorias: mock.listarCategorias }))
vi.mock('../lib/lancamentos', async (o) => ({ ...(await o<typeof import('../lib/lancamentos')>()), resumoDoMes: mock.resumoDoMes, listarLancamentos: mock.listarLancamentos }))
const cobrar = vi.hoisted(() => vi.fn())
const gerar = vi.hoisted(() => vi.fn())
vi.mock('../lib/cartoes', () => ({ cobrarFaturasFechadas: cobrar }))
vi.mock('../lib/recorrencias', () => ({ gerarOcorrencias: gerar }))
vi.mock('../lib/contas', async (o) => ({ ...(await o<typeof import('../lib/contas')>()), listarContas: mock.listarContas }))

import VisaoGeral from './VisaoGeral'

const c = (n: number) => n as Cents
const montar = () => render(<MemoryRouter><VisaoGeral /></MemoryRouter>)

beforeEach(() => {
  cobrar.mockResolvedValue(0)
  gerar.mockResolvedValue(0)
  mock.carregarPatrimonio.mockResolvedValue({ disponivel: c(5065105), creditoAReceber: c(24590), divida: c(4002135), patrimonio: c(1087560), compromissos: c(482000) })
  mock.resumoDoMes.mockResolvedValue({ receitas: c(1215000), despesas: c(866726), resultado: c(348274), receitasPrevistas: c(0), despesasPrevistas: c(38990) })
  mock.listarContas.mockResolvedValue({
    contas: [
      { id: 'a1', nome: 'Itaú', tipo: 'checking', saldoInicial: c(0), abertura: '2026-10-01', ativa: true, saldo: c(1282030) },
      { id: 'a2', nome: 'Antiga', tipo: 'checking', saldoInicial: c(0), abertura: '2026-10-01', ativa: false, saldo: c(0) },
    ],
    total: c(1282030),
  })
  mock.proximosPlanejados.mockResolvedValue([{ id: 't1', tipo: 'expense', descricao: 'Internet', valor: c(12000), data: '2026-10-20' }])
  mock.despesasPorCategoria.mockResolvedValue([
    { categoriaId: 'g1', nome: 'Moradia', valor: c(500000), percentual: 57.7 },
    { categoriaId: null, nome: 'Outros', valor: c(366726), percentual: 42.3 },
  ])
  mock.despesasPorDia.mockResolvedValue([
    { dia: '2026-10-01', valor: c(500000), acumulado: c(500000) },
    { dia: '2026-10-02', valor: c(366726), acumulado: c(866726) },
  ])
  mock.listarLancamentos.mockResolvedValue([
    { id: 'l1', tipo: 'expense', contaId: 'a1', destinoId: null, categoriaId: 'g1', descricao: 'Aluguel', valor: c(500000), data: '2026-10-01', status: 'paid', notas: '' },
    { id: 'l2', tipo: 'expense', contaId: 'a1', destinoId: null, categoriaId: 'g1', descricao: 'Planejado', valor: c(100), data: '2026-10-30', status: 'planned', notas: '' },
  ])
  mock.listarCategorias.mockResolvedValue([{ id: 'g1', nome: 'Moradia', tipo: 'expense', paiId: null, sistema: false, ativa: true, eventual: false }])
  // 1ª chamada = mês corrente; 2ª = últimos 12 meses (mesma ordem do Promise.all da tela)
  mock.regularidadeRenda
    .mockResolvedValueOnce({ regular: c(500000), eventual: c(200000), despesas: c(400000), cobertura: 125 })
    .mockResolvedValueOnce({ regular: c(6000000), eventual: c(1200000), despesas: c(7200000), cobertura: 83.3 })
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Visão geral', () => {
  it('saúda pelo primeiro nome e mostra o gráfico de categorias com valores e % do banco', async () => {
    montar()
    expect(await screen.findByText(/, João!/)).toBeTruthy()
    expect(screen.getAllByText('Moradia').length).toBeGreaterThan(0)
    expect(screen.getByText('57,7%')).toBeTruthy()
    expect(screen.getByText('Outros')).toBeTruthy()
    expect(screen.getByRole('img', { name: /Despesa acumulada no mês: R\$ 8\.667,26/ })).toBeTruthy()
  })
  it('últimos lançamentos: só pagos, com categoria', async () => {
    montar()
    expect(await screen.findByText('Aluguel')).toBeTruthy()
    expect(screen.queryByText('Planejado')).toBeNull()
  })
  it('compara com o mês anterior', async () => {
    mock.resumoDoMes.mockResolvedValueOnce({ receitas: c(1215000), despesas: c(866726), resultado: c(348274), receitasPrevistas: c(0), despesasPrevistas: c(0) })
      .mockResolvedValueOnce({ receitas: c(1215000), despesas: c(433363), resultado: c(781637), receitasPrevistas: c(0), despesasPrevistas: c(0) })
    montar()
    expect(await screen.findByText(/100%/)).toBeTruthy() // despesas dobraram
  })
  it('mostra a equação do patrimônio com os valores do banco', async () => {
    montar()
    // equação montada com os valores do banco: disponível + crédito a receber − dívida = patrimônio
    expect(await screen.findByText(/disponível R\$ 50\.651,05 \+ crédito a receber R\$ 245,90 − dívida R\$ 40\.021,35/)).toBeTruthy()
    expect(screen.getByText('R$ 10.875,60')).toBeTruthy()
    expect(screen.getByText(/Não inclui bens nem investimentos/)).toBeTruthy()
    expect(screen.getByText('R$ 4.820,00')).toBeTruthy() // compromissos à parte
  })
  it('resumo do mês, próximos planejados e só contas ativas', async () => {
    montar()
    expect(await screen.findByText('+R$ 12.150,00')).toBeTruthy()
    expect(screen.getByText('−R$ 8.667,26')).toBeTruthy()
    expect(screen.getByText(/Internet/)).toBeTruthy()
    expect(screen.getByText('Itaú')).toBeTruthy()
    expect(screen.queryByText('Antiga')).toBeNull()
  })
  it('sem compromissos, não mostra a faixa', async () => {
    mock.carregarPatrimonio.mockResolvedValue({ disponivel: c(0), creditoAReceber: c(0), divida: c(0), patrimonio: c(0), compromissos: c(0) })
    montar()
    await screen.findByText(/Não inclui bens/)
    expect(screen.queryByText(/Compromissos futuros/)).toBeNull()
  })

  it('se a geração dos recorrentes falhar, avisa e mantém o painel', async () => {
    gerar.mockRejectedValue(new Error('x'))
    render(<MemoryRouter><VisaoGeral /></MemoryRouter>)
    expect(await screen.findByText(/Não foi possível lançar os recorrentes/)).toBeTruthy()
    expect(screen.getByText('R$ 10.875,60')).toBeTruthy()
    expect(cobrar).toHaveBeenCalled() // uma falha não impede a outra
  })
  it('se a cobrança das faturas falhar, mostra aviso e mantém o painel', async () => {
    cobrar.mockRejectedValue(new Error('x'))
    montar()
    expect(await screen.findByText(/Não foi possível fechar as faturas dos cartões/)).toBeTruthy()
    expect(screen.getByText(/Bom dia|Boa tarde|Boa noite/)).toBeTruthy()
  })
  it('se as consultas dos gráficos falharem (banco sem a migration), o resto do painel aparece', async () => {
    mock.despesasPorCategoria.mockRejectedValue(new Error('function does not exist'))
    mock.despesasPorDia.mockRejectedValue(new Error('function does not exist'))
    montar()
    expect(await screen.findByText('R$ 10.875,60')).toBeTruthy()
    expect(screen.getAllByText(/Gráfico indisponível agora/)).toHaveLength(2)
    expect(screen.queryByText(/Não foi possível/)).toBeNull()
  })

  it('renda regular × despesas: mês e últimos 12 meses, com a cobertura vinda do banco', async () => {
    montar()
    expect(await screen.findByText('Renda regular × despesas')).toBeTruthy()
    expect(screen.getByText('Últimos 12 meses')).toBeTruthy()
    expect(screen.getByText('125%')).toBeTruthy()
    expect(screen.getByText('83,3%')).toBeTruthy()
    expect(screen.getByText('R$ 60.000,00')).toBeTruthy()
    expect(screen.queryByText(/Nenhuma receita marcada como eventual/)).toBeNull()
  })
  it('sem nenhuma receita eventual nos 12 meses, sugere marcar em Categorias', async () => {
    mock.regularidadeRenda.mockReset()
    mock.regularidadeRenda.mockResolvedValue({ regular: c(500000), eventual: c(0), despesas: c(400000), cobertura: 125 })
    montar()
    expect(await screen.findByText(/Nenhuma receita marcada como eventual/)).toBeTruthy()
  })
  it('mês sem despesas: não inventa percentual', async () => {
    mock.regularidadeRenda.mockReset()
    mock.regularidadeRenda.mockResolvedValue({ regular: c(0), eventual: c(0), despesas: c(0), cobertura: null })
    montar()
    expect((await screen.findAllByText('Sem despesas no período.')).length).toBe(2)
  })
  it('se o relatório falhar (banco sem a migration 012), o resto do painel aparece', async () => {
    mock.regularidadeRenda.mockReset()
    mock.regularidadeRenda.mockRejectedValue(new Error('function does not exist'))
    montar()
    expect(await screen.findByText('R$ 10.875,60')).toBeTruthy()
    expect(screen.queryByText('Renda regular × despesas')).toBeNull()
    expect(screen.queryByText(/Não foi possível/)).toBeNull()
  })
})
