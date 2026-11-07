// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { Cents } from '../lib/format'

const mock = vi.hoisted(() => ({
  listarLancamentos: vi.fn(),
  listarMovimentosDeDivida: vi.fn(),
  listarFaturasDoMes: vi.fn(),
  listarCreditosDeCartao: vi.fn(),
  listarComprasDaFatura: vi.fn(),
  listarCreditosDaFaturaDoMes: vi.fn(),
  listarCartoes: vi.fn(),
  resumoDoMes: vi.fn(),
  resumoPorMoeda: vi.fn(),
  moverParaLixeira: vi.fn(),
  listarContas: vi.fn(),
  listarCategorias: vi.fn(),
  listarParcelasDivida: vi.fn(),
  mudarCategoriaEmLote: vi.fn(),
  marcarPagoEmLote: vi.fn(),
  voltarPlanejadoEmLote: vi.fn(),
  moverParaLixeiraEmLote: vi.fn(),
  restaurarDaLixeiraEmLote: vi.fn(),
}))
vi.mock('../lib/automaticos', () => ({ atualizarAutomaticos: vi.fn().mockResolvedValue({ recorrentesOk: true, faturasOk: true }) }))
vi.mock('../lib/FamiliaContext', () => ({
  useFamilia: () => ({ familia: { id: 'h1', nome: 'Casa', papel: 'owner' }, carregando: false, erro: false, recarregar: vi.fn() }),
}))
vi.mock('../lib/lancamentos', async (original) => ({
  ...(await original<typeof import('../lib/lancamentos')>()),
  listarLancamentos: mock.listarLancamentos,
  listarMovimentosDeDivida: mock.listarMovimentosDeDivida,
  listarFaturasDoMes: mock.listarFaturasDoMes,
  listarCreditosDeCartao: mock.listarCreditosDeCartao,
  listarComprasDaFatura: mock.listarComprasDaFatura,
  listarCreditosDaFaturaDoMes: mock.listarCreditosDaFaturaDoMes,
  resumoDoMes: mock.resumoDoMes,
  resumoPorMoeda: mock.resumoPorMoeda,
  moverParaLixeira: mock.moverParaLixeira,
  mudarCategoriaEmLote: mock.mudarCategoriaEmLote,
  marcarPagoEmLote: mock.marcarPagoEmLote,
  voltarPlanejadoEmLote: mock.voltarPlanejadoEmLote,
  moverParaLixeiraEmLote: mock.moverParaLixeiraEmLote,
  restaurarDaLixeiraEmLote: mock.restaurarDaLixeiraEmLote,
}))
vi.mock('../lib/contas', async (original) => ({
  ...(await original<typeof import('../lib/contas')>()),
  listarContas: mock.listarContas,
  hojeSP: () => '2026-10-20',
}))
vi.mock('../lib/cartoes', async (original) => ({
  ...(await original<typeof import('../lib/cartoes')>()),
  listarCartoes: mock.listarCartoes,
}))
vi.mock('../lib/dividas', async (original) => ({
  ...(await original<typeof import('../lib/dividas')>()),
  listarParcelasDivida: mock.listarParcelasDivida,
}))
vi.mock('../lib/categorias', async (original) => ({
  ...(await original<typeof import('../lib/categorias')>()),
  listarCategorias: mock.listarCategorias,
}))

import Lancamentos from './Lancamentos'

const c = (n: number) => n as Cents
const contas = [
  { id: 'a1', nome: 'Itaú', tipo: 'checking', saldoInicial: c(0), abertura: '2026-10-01', ativa: true, saldo: c(0) },
  { id: 'a2', nome: 'Nubank', tipo: 'checking', saldoInicial: c(0), abertura: '2026-10-01', ativa: true, saldo: c(0) },
]
const categorias = [
  { id: 'mer', nome: 'Mercado', tipo: 'expense', paiId: null, sistema: false, ativa: true },
  { id: 'casa', nome: 'Casa', tipo: 'expense', paiId: null, sistema: false, ativa: true },
  { id: 'sal', nome: 'Salário', tipo: 'income', paiId: null, sistema: false, ativa: true },
]
// hoje (mock) = 20/10/2026
const lancs = [
  { id: 't1', tipo: 'expense', contaId: 'a1', destinoId: null, categoriaId: 'mer', descricao: 'Supermercado', valor: c(25050), data: '2026-10-15', status: 'paid', notas: '' },
  { id: 't4', tipo: 'expense', contaId: 'a1', destinoId: null, categoriaId: 'casa', descricao: 'Luz', valor: c(14320), data: '2026-10-10', status: 'planned', notas: '' },
  { id: 't5', tipo: 'expense', contaId: 'a2', destinoId: null, categoriaId: 'mer', descricao: 'Feira', valor: c(3000), data: '2026-10-25', status: 'planned', notas: '' },
  { id: 't2', tipo: 'income', contaId: 'a1', destinoId: null, categoriaId: 'sal', descricao: 'Salário', valor: c(800000), data: '2026-10-05', status: 'planned', notas: '' },
  { id: 't3', tipo: 'transfer', contaId: 'a1', destinoId: 'a2', categoriaId: null, descricao: '', valor: c(10000), data: '2026-10-05', status: 'paid', notas: '' },
]
const fatura = {
  cartaoId: 'k1', cartaoNome: 'Nubank', mes: '2026-10', fechamento: '2026-10-17', vencimento: '2026-10-25', total: c(45000), pago: c(0),
  itens: 2, creditos: c(0), situacao: 'fechada', contaPagamentoId: 'a1',
}

/** Simula a largura da tela: matchMedia('(min-width: 1024px)') responde `grande`. */
function tela(grande: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true, writable: true,
    value: (q: string) => ({ matches: grande && q.includes('1024'), media: q, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  })
}

beforeEach(() => {
  tela(true)
  mock.listarContas.mockResolvedValue({ contas, total: c(0) })
  mock.listarCategorias.mockResolvedValue(categorias)
  mock.listarLancamentos.mockResolvedValue(lancs)
  mock.listarMovimentosDeDivida.mockResolvedValue([])
  mock.listarParcelasDivida.mockResolvedValue([])
  mock.listarFaturasDoMes.mockResolvedValue([fatura])
  mock.listarComprasDaFatura.mockResolvedValue([
    { id: 'p1', cartaoId: 'k1', cartaoNome: 'Nubank', vencimento: '2026-10-25', fechamento: '2026-10-17', descricao: 'Fone', dataCompra: '2026-10-02', parcela: 1, deParcelas: 1, valor: c(45000), categoriaId: 'mer' },
  ])
  mock.listarCreditosDeCartao.mockResolvedValue([])
  mock.listarCreditosDaFaturaDoMes.mockResolvedValue([])
  mock.listarCartoes.mockResolvedValue([])
  mock.resumoDoMes.mockResolvedValue({ receitas: c(0), despesas: c(25050), resultado: c(-25050), receitasPrevistas: c(800000), despesasPrevistas: c(0) })
  mock.resumoPorMoeda.mockResolvedValue([])
  mock.moverParaLixeira.mockResolvedValue(undefined)
  mock.mudarCategoriaEmLote.mockResolvedValue(2)
  mock.marcarPagoEmLote.mockResolvedValue(2)
  mock.voltarPlanejadoEmLote.mockResolvedValue(2)
  mock.moverParaLixeiraEmLote.mockResolvedValue(2)
  mock.restaurarDaLixeiraEmLote.mockResolvedValue(2)
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  Reflect.deleteProperty(window, 'matchMedia')
})

function abrir() {
  render(<MemoryRouter><Lancamentos /></MemoryRouter>)
  return screen.findByRole('table')
}
/** Descrições na ordem em que as linhas aparecem (sem o cabeçalho). */
function ordemDasLinhas(tabela: HTMLElement) {
  return within(tabela).getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[3].textContent ?? '')
}
const caixa = (nome: string) => screen.getByRole('checkbox', { name: `Selecionar ${nome}` }) as HTMLInputElement

describe('Lançamentos no computador: tabela', () => {
  it('desktop mostra a tabela semântica com as colunas pedidas; celular mantém a lista', async () => {
    const tabela = await abrir()
    const cabecalhos = within(tabela).getAllByRole('columnheader').map((h) => h.textContent?.replace(/[↕↑↓]/g, '').trim())
    expect(cabecalhos).toEqual([expect.any(String), 'Situação', 'Data', 'Descrição', 'Categoria', 'Conta', 'Valor', 'Ações'])
    for (const h of within(tabela).getAllByRole('columnheader')) expect(h.getAttribute('scope')).toBe('col')
    // valor com sinal e cor (não só cor); situação com texto acessível
    const linhaLuz = screen.getByText('Luz').closest('tr') as HTMLElement
    expect(within(linhaLuz).getByText('−R$ 143,20').className).toContain('text-neutro')
    expect(within(linhaLuz).getByText('Vencido')).toBeTruthy() // planejado com data antes de hoje
    expect(within(screen.getByText('Feira').closest('tr') as HTMLElement).getByText('Planejado')).toBeTruthy()
    expect(within(screen.getByText('Supermercado').closest('tr') as HTMLElement).getByText('Pago')).toBeTruthy()
    // #183: o ícone da situação leva a cor da regra (planejado verde, pago azul, vencido vermelho) e o nome em texto
    const icone = (descricao: string) => within(screen.getByText(descricao).closest('tr') as HTMLElement).getByTitle(/^(Planejado|Pago|Vencido)$/)
    expect(icone('Feira').className).toContain('bg-agendado-fundo text-agendado')
    expect(icone('Supermercado').className).toContain('bg-lucro-fundo text-lucro')
    expect(icone('Luz').className).toContain('bg-prejuizo-fundo text-prejuizo')
    const linhaSalario = within(tabela).getAllByText('Salário').map((e) => e.closest('tr') as HTMLElement)[0]
    expect(within(linhaSalario).getByText('+R$ 8.000,00').className).toContain('text-lucro')
    expect(screen.getByText('Itaú → Nubank')).toBeTruthy()
    // a fatura é linha especial: sem caixa de seleção, expansível
    const linhaFatura = screen.getByText('Fatura Nubank').closest('tr') as HTMLElement
    expect(within(linhaFatura).queryByRole('checkbox')).toBeNull()
    // auditoria 5h: as ações da fatura ficam no menu ⋯ (dois botões soltos faziam a tabela rolar de lado a 1280px)
    expect(within(linhaFatura).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Ações da fatura Nubank'])
    expect(within(linhaFatura).queryByRole('link')).toBeNull()
    const uf = userEvent.setup()
    await uf.click(within(linhaFatura).getByRole('button', { name: 'Ações da fatura Nubank' }))
    expect(within(linhaFatura).getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Ver compras', 'Ver em Cartões'])
    await uf.click(within(linhaFatura).getByRole('menuitem', { name: 'Ver compras' }))
    expect(await screen.findByRole('list', { name: 'Compras da fatura Nubank' })).toBeTruthy()
    // sem lista por dia no desktop
    expect(screen.queryByRole('region', { name: '15/10/2026' })).toBeNull()

    cleanup()
    tela(false)
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    expect(await screen.findByRole('region', { name: '15/10/2026' })).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.queryByRole('checkbox', { name: /Selecionar/ })).toBeNull()
  })

  it('ordena por data e por valor só na tela (aria-sort), sem chamar o banco de novo', async () => {
    const u = userEvent.setup()
    const tabela = await abrir()
    const chamadas = mock.listarLancamentos.mock.calls.length
    const thData = within(tabela).getByRole('columnheader', { name: /Data/ })
    const thValor = within(tabela).getByRole('columnheader', { name: /Valor/ })
    expect(thData.getAttribute('aria-sort')).toBe('descending')
    expect(ordemDasLinhas(tabela)[0]).toMatch(/Feira|Fatura/) // dia 25 primeiro
    await u.click(within(thData).getByRole('button'))
    expect(thData.getAttribute('aria-sort')).toBe('ascending')
    expect(ordemDasLinhas(tabela)[0]).toBe('Salário') // dia 05 primeiro (ordem estável no mesmo dia)
    await u.click(within(thValor).getByRole('button'))
    expect(thValor.getAttribute('aria-sort')).toBe('descending')
    expect(thData.getAttribute('aria-sort')).toBe('none')
    expect(ordemDasLinhas(tabela)[0]).toBe('Salário') // maior entrada primeiro
    await u.click(within(thValor).getByRole('button'))
    expect(ordemDasLinhas(tabela)[0]).toMatch(/^Fatura Nubank/) // maior saída primeiro (−450,00)
    expect(mock.listarLancamentos.mock.calls.length).toBe(chamadas)
  })

  it('seleciona por caixa, por espaço na linha, por intervalo (Shift) e todos; Esc limpa', async () => {
    const u = userEvent.setup()
    await abrir()
    await u.click(caixa('Luz'))
    expect(screen.getByRole('region', { name: 'Ações em lote' }).textContent).toContain('1 selecionado')
    // espaço na linha focada
    const linhaFeira = screen.getByText('Feira').closest('tr') as HTMLElement
    linhaFeira.focus()
    fireEvent.keyDown(linhaFeira, { key: ' ' })
    expect(caixa('Feira').checked).toBe(true)
    expect(screen.getByText('2 selecionados')).toBeTruthy()
    // Esc limpa
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('region', { name: 'Ações em lote' })).toBeNull()
    // Shift+clique: da Feira (25/10) ao Salário (05/10), na ordem da tela
    await u.click(caixa('Feira'))
    await u.keyboard('{Shift>}')
    await u.click(caixa('Salário'))
    await u.keyboard('{/Shift}')
    for (const n of ['Feira', 'Supermercado', 'Luz', 'Salário']) expect(caixa(n).checked).toBe(true)
    expect(caixa('Transferência').checked).toBe(false)
    // todos do mês/filtro (só lançamentos: a fatura não entra)
    const todos = screen.getByRole('checkbox', { name: 'Selecionar todos os lançamentos do mês e filtro' }) as HTMLInputElement
    expect(todos.indeterminate).toBe(true)
    await u.click(todos)
    expect(screen.getByText('5 selecionados')).toBeTruthy()
    await u.click(todos)
    expect(screen.queryByRole('region', { name: 'Ações em lote' })).toBeNull()
  })

  it('mudar categoria: confirma com a quantidade (sem total), uma chamada só, e Desfazer volta cada uma à categoria anterior', async () => {
    const u = userEvent.setup()
    await abrir()
    await u.click(caixa('Luz'))
    await u.click(caixa('Feira'))
    await u.click(caixa('Supermercado'))
    await u.click(screen.getByRole('button', { name: 'Mudar categoria' }))
    expect(screen.getByRole('heading', { name: 'Mudar a categoria de 3 lançamentos' })).toBeTruthy()
    // a confirmação não soma dinheiro: nenhum valor em reais no painel
    const painel = screen.getByRole('group', { name: 'Mudar a categoria de 3 lançamentos' })
    expect(painel.textContent).not.toMatch(/R\$/)
    // só categorias de despesa
    const select = within(painel).getByLabelText('Nova categoria (despesa)') as HTMLSelectElement
    expect([...select.options].map((o) => o.textContent)).toEqual(['Escolha…', 'Casa', 'Mercado'])
    await u.selectOptions(select, 'casa')
    await u.click(within(painel).getByRole('button', { name: 'Confirmar' }))
    await waitFor(() => expect(mock.mudarCategoriaEmLote).toHaveBeenCalledTimes(1))
    expect(mock.mudarCategoriaEmLote).toHaveBeenCalledWith(['t5', 't1', 't4'], 'casa')
    expect(await screen.findByText('2 lançamentos alterados.')).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Ações em lote' })).toBeNull()
    await u.click(screen.getByRole('button', { name: 'Desfazer' }))
    // Luz já era Casa: não volta; Feira e Supermercado voltam para Mercado numa chamada (um grupo por categoria antiga)
    await waitFor(() => expect(mock.mudarCategoriaEmLote).toHaveBeenCalledTimes(2))
    expect(mock.mudarCategoriaEmLote).toHaveBeenLastCalledWith(['t5', 't1'], 'mer')
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Desfazer' })).toBeNull())
  })

  it('mudar categoria fica desligado com transferência ou com receita e despesa juntas', async () => {
    const u = userEvent.setup()
    await abrir()
    await u.click(caixa('Luz'))
    await u.click(caixa('Transferência'))
    expect((screen.getByRole('button', { name: 'Mudar categoria' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/Transferência não tem categoria/)).toBeTruthy()
    await u.click(caixa('Transferência'))
    await u.click(caixa('Salário'))
    expect((screen.getByRole('button', { name: 'Mudar categoria' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/Receita e despesa têm categorias diferentes/)).toBeTruthy()
  })

  it('marcar como pago: só os planejados, na data escolhida; Desfazer volta cada um à data que tinha', async () => {
    const u = userEvent.setup()
    await abrir()
    await u.click(caixa('Luz'))
    await u.click(caixa('Feira'))
    await u.click(caixa('Supermercado')) // já pago: não vai
    await u.click(screen.getByRole('button', { name: 'Marcar como pago' }))
    expect(screen.getByRole('heading', { name: 'Marcar 2 lançamentos como pagos' })).toBeTruthy()
    expect(screen.getByText(/1 lançamento da seleção já está pago/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Data do pagamento'), { target: { value: '2026-10-18' } })
    await u.click(screen.getByRole('button', { name: 'Confirmar' }))
    await waitFor(() => expect(mock.marcarPagoEmLote).toHaveBeenCalledWith(['t5', 't4'], '2026-10-18'))
    await u.click(await screen.findByRole('button', { name: 'Desfazer' }))
    await waitFor(() => expect(mock.voltarPlanejadoEmLote).toHaveBeenCalledWith(['t5', 't4'], ['2026-10-25', '2026-10-10']))
  })

  it('excluir em lote: lixeira numa chamada; Desfazer restaura os mesmos', async () => {
    const u = userEvent.setup()
    await abrir()
    await u.click(caixa('Luz'))
    await u.click(caixa('Transferência'))
    await u.click(within(screen.getByRole('region', { name: 'Ações em lote' })).getByRole('button', { name: 'Excluir' }))
    expect(screen.getByRole('heading', { name: 'Enviar 2 lançamentos para a lixeira' })).toBeTruthy()
    await u.click(screen.getByRole('button', { name: 'Enviar para a lixeira' }))
    await waitFor(() => expect(mock.moverParaLixeiraEmLote).toHaveBeenCalledWith(['t4', 't3']))
    expect(await screen.findByText('2 lançamentos na lixeira.')).toBeTruthy()
    await u.click(screen.getByRole('button', { name: 'Desfazer' }))
    await waitFor(() => expect(mock.restaurarDaLixeiraEmLote).toHaveBeenCalledWith(['t4', 't3']))
  })

  it('erro do banco aparece na confirmação e a seleção continua', async () => {
    mock.moverParaLixeiraEmLote.mockRejectedValue({ code: '55000', message: 'a conta já foi conciliada até 2026-10-12 : lançamento pago nesse período não pode ser criado, alterado nem excluído' })
    const u = userEvent.setup()
    await abrir()
    await u.click(caixa('Luz'))
    await u.click(caixa('Supermercado'))
    await u.click(within(screen.getByRole('region', { name: 'Ações em lote' })).getByRole('button', { name: 'Excluir' }))
    await u.click(screen.getByRole('button', { name: 'Enviar para a lixeira' }))
    expect((await screen.findByRole('alert')).textContent).toContain('conciliada até 12/10/2026')
    expect(caixa('Luz').checked).toBe(true)
    expect(caixa('Supermercado').checked).toBe(true)
    expect(screen.getByText('2 selecionados')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Desfazer' })).toBeNull()
  })

  it('a seleção começa vazia ao trocar de mês', async () => {
    const u = userEvent.setup()
    await abrir()
    await u.click(caixa('Luz'))
    expect(screen.getByText('1 selecionado')).toBeTruthy()
    await u.click(screen.getByRole('button', { name: 'Próximo mês' }))
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Ações em lote' })).toBeNull())
  })

  it('o menu ⋯ da linha mantém Editar, Marcar pago e Excluir de um só', async () => {
    const u = userEvent.setup()
    await abrir()
    await u.click(screen.getByRole('button', { name: 'Ações de Luz' }))
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Marcar pago', 'Editar', 'Excluir'])
    await u.click(screen.getByRole('menuitem', { name: 'Marcar pago' }))
    // abre por cima da tela (diálogo), não no topo da página fora da vista de quem rolou a tabela
    expect(screen.getByRole('dialog', { name: /Marcar como pago · Luz/ })).toBeTruthy()
  })

  it('coluna Categoria mostra só a folha; o caminho inteiro fica no title e no leitor de tela', async () => {
    mock.listarCategorias.mockResolvedValue([...categorias, { id: 'cond', nome: 'Condomínio', tipo: 'expense', paiId: 'casa', sistema: false, ativa: true }])
    mock.listarLancamentos.mockResolvedValue([
      { id: 't9', tipo: 'expense', contaId: 'a1', destinoId: null, categoriaId: 'cond', descricao: 'Taxa do prédio', valor: c(6000), data: '2026-10-12', status: 'planned', notas: '' },
    ])
    await abrir()
    const linha = screen.getByText('Taxa do prédio').closest('tr') as HTMLElement
    const celula = within(linha).getAllByRole('cell')[4]
    const folha = within(celula).getByText('Condomínio')
    expect(folha.getAttribute('aria-hidden')).toBe('true')
    expect(folha.parentElement!.getAttribute('title')).toBe('Casa › Condomínio')
    expect(within(celula).getByText('Casa › Condomínio').className).toContain('sr-only')
  })

  it('fatura com créditos: ao abrir, "Créditos e reembolsos" (+, azul) dentro dela; o total é o do banco', async () => {
    mock.listarFaturasDoMes.mockResolvedValue([{ ...fatura, total: c(44000), creditos: c(1000), situacao: 'aberta' }])
    mock.listarCreditosDaFaturaDoMes.mockResolvedValue([
      { id: 'k1', data: '2026-10-17', dataCredito: '2026-10-03', descricao: 'Estorno de IOF', cartaoNome: 'Nubank', categoriaId: 'sal', valor: c(1000), planejado: false, vencimento: '2026-10-25' },
    ])
    const u = userEvent.setup()
    await abrir()
    const linhaFatura = screen.getByText('Fatura Nubank').closest('tr') as HTMLElement
    expect(within(linhaFatura).getByText('R$ 440,00')).toBeTruthy()
    expect(within(linhaFatura).getByText('fecha 17/10')).toBeTruthy()
    expect(screen.queryByText('Estorno de IOF')).toBeNull()
    await u.click(within(linhaFatura).getByRole('button', { name: 'Ações da fatura Nubank' }))
    await u.click(within(linhaFatura).getByRole('menuitem', { name: 'Ver compras' }))
    const lista = await screen.findByRole('list', { name: 'Créditos e reembolsos da fatura Nubank' })
    expect(within(lista).getByText('+R$ 10,00').className).toContain('text-lucro')
  })
})
