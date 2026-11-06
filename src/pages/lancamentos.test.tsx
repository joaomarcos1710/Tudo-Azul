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
  listarCartoes: vi.fn(),
  listarItens: vi.fn(),
  listarCreditosDaFatura: vi.fn(),
  registrarCompra: vi.fn(),
  resumoDoMes: vi.fn(),
  resumoPorMoeda: vi.fn(),
  criarLancamento: vi.fn(),
  criarRecorrencia: vi.fn(),
  criarParcelado: vi.fn(),
  editarLancamento: vi.fn(),
  editarEsteEProximos: vi.fn(),
  marcarComoPago: vi.fn(),
  moverParaLixeira: vi.fn(),
  restaurarDaLixeira: vi.fn(),
  listarContas: vi.fn(),
  listarCategorias: vi.fn(),
  listarParcelasDivida: vi.fn(),
}))
const automaticos = vi.hoisted(() => ({ atualizarAutomaticos: vi.fn() }))
vi.mock('../lib/automaticos', () => automaticos)
vi.mock('../lib/recorrencias', async (original) => ({
  ...(await original<typeof import('../lib/recorrencias')>()),
  criarRecorrencia: mock.criarRecorrencia,
}))
vi.mock('../lib/FamiliaContext', () => ({
  useFamilia: () => ({ familia: { id: 'h1', nome: 'Casa', papel: 'owner' }, carregando: false, erro: false, recarregar: vi.fn() }),
}))
vi.mock('../lib/lancamentos', async (original) => ({
  ...(await original<typeof import('../lib/lancamentos')>()),
  listarLancamentos: mock.listarLancamentos,
  criarParcelado: mock.criarParcelado,
  listarMovimentosDeDivida: mock.listarMovimentosDeDivida,
  listarFaturasDoMes: mock.listarFaturasDoMes,
  listarCreditosDeCartao: mock.listarCreditosDeCartao,
  resumoDoMes: mock.resumoDoMes,
  resumoPorMoeda: mock.resumoPorMoeda,
  criarLancamento: mock.criarLancamento,
  editarLancamento: mock.editarLancamento,
  editarEsteEProximos: mock.editarEsteEProximos,
  marcarComoPago: mock.marcarComoPago,
  moverParaLixeira: mock.moverParaLixeira,
  restaurarDaLixeira: mock.restaurarDaLixeira,
}))
vi.mock('../lib/contas', async (original) => ({
  ...(await original<typeof import('../lib/contas')>()),
  listarContas: mock.listarContas,
}))
vi.mock('../lib/cartoes', async (original) => ({
  ...(await original<typeof import('../lib/cartoes')>()),
  listarCartoes: mock.listarCartoes,
  listarItens: mock.listarItens,
  listarCreditosDaFatura: mock.listarCreditosDaFatura,
  registrarCompra: mock.registrarCompra,
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
import { limitesDoMes, somarMeses } from '../lib/lancamentos'
import { hojeSP } from '../lib/contas'

const c = (n: number) => n as Cents
const contas = [
  { id: 'a1', nome: 'Itaú', tipo: 'checking', saldoInicial: c(0), abertura: '2026-10-01', ativa: true, saldo: c(0) },
  { id: 'a2', nome: 'Nubank', tipo: 'checking', saldoInicial: c(0), abertura: '2026-10-01', ativa: true, saldo: c(0) },
]
const categorias = [
  { id: 'mer', nome: 'Mercado', tipo: 'expense', paiId: null, sistema: false, ativa: true },
  { id: 'sal', nome: 'Salário', tipo: 'income', paiId: null, sistema: false, ativa: true },
]
const lancs = [
  { id: 't1', tipo: 'expense', contaId: 'a1', destinoId: null, categoriaId: 'mer', descricao: 'Supermercado', valor: c(25050), data: '2026-10-15', status: 'paid', notas: '' },
  { id: 't2', tipo: 'income', contaId: 'a1', destinoId: null, categoriaId: 'sal', descricao: 'Salário', valor: c(800000), data: '2026-10-05', status: 'planned', notas: '' },
  { id: 't3', tipo: 'transfer', contaId: 'a1', destinoId: 'a2', categoriaId: null, descricao: '', valor: c(10000), data: '2026-10-05', status: 'paid', notas: '' },
]

beforeEach(() => {
  window.localStorage.clear() // a conta/cartão lembrados de um teste não podem vazar para o próximo
  automaticos.atualizarAutomaticos.mockResolvedValue({ recorrentesOk: true, faturasOk: true })
  mock.listarContas.mockResolvedValue({ contas, total: c(0) })
  mock.listarCategorias.mockResolvedValue(categorias)
  mock.listarLancamentos.mockResolvedValue(lancs)
  mock.listarMovimentosDeDivida.mockResolvedValue([])
  mock.listarParcelasDivida.mockResolvedValue([])
  mock.listarFaturasDoMes.mockResolvedValue([])
  mock.listarItens.mockResolvedValue([])
  mock.listarCreditosDaFatura.mockResolvedValue([])
  mock.listarCreditosDeCartao.mockResolvedValue([])
  mock.listarCartoes.mockResolvedValue([
    { id: 'k1', nome: 'Nubank', fechamento: 17, vencimento: 25, ativo: true, divida: c(0), credito: c(0), compromissos: c(0) },
  ])
  mock.registrarCompra.mockResolvedValue(undefined)
  mock.resumoDoMes.mockResolvedValue({ receitas: c(0), despesas: c(25050), resultado: c(-25050), receitasPrevistas: c(800000), despesasPrevistas: c(0) })
  mock.resumoPorMoeda.mockResolvedValue([])
  for (const f of [mock.criarLancamento, mock.editarLancamento, mock.editarEsteEProximos, mock.marcarComoPago, mock.moverParaLixeira, mock.restaurarDaLixeira]) f.mockResolvedValue(undefined)
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

/** "+ Lançamento" abre o menu; "Nova despesa" abre o painel (o formulário troca de aba depois, se o teste quiser). */
async function abrirNovo(u: ReturnType<typeof userEvent.setup>) {
  await u.click(await screen.findByRole('button', { name: '+ Lançamento' }))
  await u.click(screen.getByRole('menuitem', { name: /Nova despesa/ }))
}

describe('datas do mês', () => {
  it('limites e navegação entre meses, inclusive virada de ano e fevereiro', () => {
    expect(limitesDoMes('2026-02')).toEqual(['2026-02-01', '2026-02-28'])
    expect(limitesDoMes('2028-02')).toEqual(['2028-02-01', '2028-02-29'])
    expect(limitesDoMes('2026-12')).toEqual(['2026-12-01', '2026-12-31'])
    expect(somarMeses('2026-12', 1)).toBe('2027-01')
    expect(somarMeses('2026-01', -1)).toBe('2025-12')
  })
})

describe('Lançamentos', () => {
  it('lista por dia com sinais do design system e totais vindos do banco', async () => {
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    expect((await screen.findAllByText('−R$ 250,50')).length).toBe(2) // item da lista e card de despesas pagas
    expect(screen.getAllByText('+R$ 8.000,00').length).toBe(2) // item planejado da lista e "Planejado:" do resultado
    expect(screen.getByText('⇄ R$ 100,00')).toBeTruthy()
    expect(screen.getByText('Itaú → Nubank')).toBeTruthy()
    // a linha mostra só a categoria: sem o nome da conta/banco depois dela
    expect(screen.getByText('Mercado')).toBeTruthy()
    expect(screen.queryByText('Mercado · Itaú')).toBeNull()
    expect(screen.getByText('Planejado')).toBeTruthy()
    // #183 (regra de cores do dono): selo "Planejado" verde (agendado), receita azul (lucro), despesa vermelha (prejuízo)
    expect(screen.getByText('Planejado').className).toContain('bg-agendado-fundo text-agendado')
    const linha = (texto: string) => screen.getByText(texto).closest('li') as HTMLElement
    expect(within(linha('Supermercado')).getByText('−R$ 250,50').className).toContain('text-prejuizo')
    expect(within(linha('Planejado')).getByText('+R$ 8.000,00').className).toContain('text-lucro')
    expect(within(linha('Itaú → Nubank')).getByText('⇄ R$ 100,00').className).toContain('text-transferencia')
    // os totais: receitas pagas azul, despesas pagas vermelho, "Planejado: +… / −…" verde
    const totais = screen.getAllByText('−R$ 250,50').find((e) => e.tagName === 'P') as HTMLElement
    expect(totais.className).toContain('text-prejuizo')
    expect(screen.getByText('Planejado:').parentElement!.className).toContain('text-agendado')
    expect(screen.getByRole('region', { name: '15/10/2026' })).toBeTruthy()
  })

  it('?tipo=receita|despesa (avisos do Início) abre já filtrado pelo tipo, no mês pedido', async () => {
    render(<MemoryRouter initialEntries={['/lancamentos?mes=2026-10&tipo=receita']}><Lancamentos /></MemoryRouter>)
    await waitFor(() => expect(mock.listarLancamentos).toHaveBeenCalledWith('h1', '2026-10', { tipo: 'income' }))
    expect((screen.getByLabelText('Filtrar por tipo') as HTMLSelectElement).value).toBe('income')
    cleanup()
    mock.listarLancamentos.mockClear()
    render(<MemoryRouter initialEntries={['/lancamentos?mes=2026-10&tipo=despesa']}><Lancamentos /></MemoryRouter>)
    await waitFor(() => expect(mock.listarLancamentos).toHaveBeenCalledWith('h1', '2026-10', { tipo: 'expense' }))
    cleanup()
    mock.listarLancamentos.mockClear()
    // valor desconhecido não filtra nada
    render(<MemoryRouter initialEntries={['/lancamentos?mes=2026-10&tipo=xyz']}><Lancamentos /></MemoryRouter>)
    await waitFor(() => expect(mock.listarLancamentos).toHaveBeenCalledWith('h1', '2026-10', {}))
  })

  it('o planejado do resultado: cada valor é indivisível e a linha pode quebrar entre eles, para não cortar no celular', async () => {
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    await screen.findAllByText('+R$ 8.000,00')
    const rotulo = screen.getByText('Planejado:')
    const linha = rotulo.parentElement!
    expect(linha.className).toMatch(/flex-wrap/)
    const valores = [...linha.querySelectorAll('span.whitespace-nowrap')].map((e) => e.textContent)
    expect(valores).toHaveLength(2)
    expect(valores[0]).toBe('+R$ 8.000,00')
    expect(valores[1]).toMatch(/^−R\$ /)
  })

  it('cada linha tem o ícone da categoria (transferência: setas); o valor continua na cor de receita/despesa', async () => {
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    const linha = (texto: string) => screen.getByText(texto).closest('li')!
    await screen.findByText('Supermercado')
    expect(linha('Supermercado').querySelector('[data-icone]')!.getAttribute('data-icone')).toBe('carrinho')
    expect(linha('Itaú → Nubank').querySelector('[data-icone]')!.getAttribute('data-icone')).toBe('transferencia')
    const valor = within(linha('Supermercado')).getByText('−R$ 250,50')
    expect(valor.className).toContain('text-prejuizo')
    expect(valor.getAttribute('style')).toBeNull()
  })

  it('lança despesa em centavos, com categoria e status pago para hoje', async () => {
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    const u = userEvent.setup()
    await screen.findByText('Supermercado')
    await abrirNovo(u)
    await u.type(screen.getByLabelText('Valor (R$)'), '1.234,56')
    await u.type(screen.getByLabelText('Descrição'), 'Feira')
    await u.selectOptions(screen.getByLabelText('Categoria'), 'mer')
    await u.click(screen.getByRole('button', { name: 'Registrar despesa' }))
    expect(mock.criarLancamento).toHaveBeenCalledWith('h1', {
      tipo: 'expense', contaId: 'a1', destinoId: null, categoriaId: 'mer', descricao: 'Feira',
      valor: 123456, data: hojeSP(), status: 'paid', notas: '',
    })
  })

  it('não lança sem categoria nem valor válido', async () => {
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    const u = userEvent.setup()
    await screen.findByText('Supermercado')
    await abrirNovo(u)
    await u.type(screen.getByLabelText('Valor (R$)'), '1.2.3')
    await u.click(screen.getByRole('button', { name: 'Registrar despesa' }))
    expect(screen.getByText(/Informe um valor maior que zero/)).toBeTruthy()
    expect(screen.getByText('Escolha a categoria.')).toBeTruthy()
    expect(mock.criarLancamento).not.toHaveBeenCalled()
  })

  it('transferência exige destino diferente e não leva categoria', async () => {
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    const u = userEvent.setup()
    await screen.findByText('Supermercado')
    await abrirNovo(u)
    await u.click(screen.getByRole('radio', { name: 'Transferência' }))
    await u.type(screen.getByLabelText('Valor (R$)'), '100')
    await u.selectOptions(screen.getByLabelText('Para a conta'), 'a2')
    await u.click(screen.getByRole('button', { name: 'Registrar transferência' }))
    expect(mock.criarLancamento).toHaveBeenCalledWith('h1', expect.objectContaining({
      tipo: 'transfer', contaId: 'a1', destinoId: 'a2', categoriaId: null, valor: 10000,
    }))
  })

  it('data futura vira planejado por padrão', async () => {
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    const u = userEvent.setup()
    await screen.findByText('Supermercado')
    await abrirNovo(u)
    const data = screen.getByLabelText('Data')
    await u.clear(data)
    await u.type(data, '2099-01-10')
    expect((screen.getByRole('radio', { name: 'Planejado' }) as HTMLInputElement).checked).toBe(true)
  })

  it('avisa quando a data é anterior ao saldo inicial da conta', async () => {
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    const u = userEvent.setup()
    await screen.findByText('Supermercado')
    await abrirNovo(u)
    const data = screen.getByLabelText('Data')
    await u.clear(data)
    await u.type(data, '2026-09-20')
    expect(screen.getByText(/não altera o saldo/)).toBeTruthy()
  })

  it('marcar pago abre a confirmação com data de hoje e o valor planejado como sugestão', async () => {
    const u = userEvent.setup()
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    await screen.findByText('Supermercado')
    await u.click(screen.getByRole('button', { name: 'Marcar pago' }))
    expect(mock.marcarComoPago).not.toHaveBeenCalled() // não paga no clique: pede data e valor reais
    expect(screen.getByRole('dialog', { name: /Marcar como pago/ })).toBeTruthy() // por cima da tela, não no topo da página
    expect((screen.getByLabelText('Data do recebimento') as HTMLInputElement).value).toBe(hojeSP())
    expect((screen.getByLabelText('Valor (R$)') as HTMLInputElement).value).toBe('8.000,00')
    await u.click(screen.getByRole('button', { name: 'Confirmar pagamento' }))
    expect(mock.marcarComoPago).toHaveBeenCalledWith('t2', { data: hojeSP(), valor: 800000 })
  })

  it('marcar pago com o valor e a data que realmente saíram (conta de luz paga diferente do estimado)', async () => {
    const u = userEvent.setup()
    mock.listarLancamentos.mockResolvedValue([
      { id: 'p1', tipo: 'expense', contaId: 'a1', destinoId: null, categoriaId: 'mer', descricao: 'Conta de luz', valor: c(15000), data: '2026-10-10', status: 'planned', notas: '' },
    ])
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    await u.click(await screen.findByRole('button', { name: 'Marcar pago' }))
    expect(screen.getByText(/quando e quanto saiu/)).toBeTruthy()
    const valor = screen.getByLabelText('Valor (R$)')
    await u.clear(valor)
    await u.type(valor, '143,20')
    const data = screen.getByLabelText('Data do pagamento')
    await u.clear(data)
    await u.type(data, '2026-10-12')
    await u.click(screen.getByRole('button', { name: 'Confirmar pagamento' }))
    expect(mock.marcarComoPago).toHaveBeenCalledWith('p1', { data: '2026-10-12', valor: 14320 })
  })

  it('marcar pago: valor inválido não chama o banco; erro do banco (período conciliado) aparece e a confirmação continua aberta', async () => {
    const u = userEvent.setup()
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    await u.click(await screen.findByRole('button', { name: 'Marcar pago' }))
    const valor = screen.getByLabelText('Valor (R$)')
    await u.clear(valor)
    await u.type(valor, 'abc')
    await u.click(screen.getByRole('button', { name: 'Confirmar pagamento' }))
    expect(mock.marcarComoPago).not.toHaveBeenCalled()
    expect(await screen.findByText(/Informe um valor maior que zero/)).toBeTruthy()
    await u.clear(valor)
    await u.type(valor, '10,00')
    mock.marcarComoPago.mockRejectedValue(Object.assign(new Error('a conta já foi conciliada até 2026-10-05'), { code: '55000' }))
    await u.click(screen.getByRole('button', { name: 'Confirmar pagamento' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Confirmar pagamento' })).toBeTruthy() // continua aberta para corrigir a data
  })

  it('exclui para a lixeira com confirmação e permite desfazer', async () => {
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    const u = userEvent.setup()
    const item = (await screen.findByText('Supermercado')).closest('li')!
    await u.click(within(item).getByRole('button', { name: 'Ações de Supermercado' }))
    await u.click(within(item).getByRole('menuitem', { name: 'Excluir' }))
    expect(window.confirm).toHaveBeenCalled()
    expect(mock.moverParaLixeira).toHaveBeenCalledWith('t1')
    await u.click(await screen.findByRole('button', { name: 'Desfazer' }))
    expect(mock.restaurarDaLixeira).toHaveBeenCalledWith('t1')
  })

  it('regra do banco aparece em português', async () => {
    mock.criarLancamento.mockRejectedValue({ code: '23514', message: 'conta de origem desativada' })
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    const u = userEvent.setup()
    await screen.findByText('Supermercado')
    await abrirNovo(u)
    await u.type(screen.getByLabelText('Valor (R$)'), '10')
    await u.selectOptions(screen.getByLabelText('Categoria'), 'mer')
    await u.click(screen.getByRole('button', { name: 'Registrar despesa' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Conta de origem desativada.')
  })

  it('mostra o pagamento da fatura no extrato, só leitura, sem entrar nos totais; e os filtros chegam ao lib', async () => {
    const u = userEvent.setup()
    mock.listarMovimentosDeDivida.mockResolvedValue([
      { id: 'e1', data: `${hojeSP().slice(0, 8)}01`, contaId: 'a1', descricao: 'Pagamento da fatura · Nubank', valor: c(-30000), jaEmDespesas: false },
      { id: 'e2', data: `${hojeSP().slice(0, 8)}01`, contaId: 'a1', descricao: 'Tarifa de Empréstimo', valor: c(-5000), jaEmDespesas: true },
    ])
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    const item = (await screen.findByText('Pagamento da fatura · Nubank')).closest('li') as HTMLElement
    expect(within(item).getByText('Cartão/dívida')).toBeTruthy()
    expect(within(item).getByText('Itaú')).toBeTruthy()
    expect(within(item).getByText('−R$ 300,00')).toBeTruthy()
    expect(within(item).queryByRole('button', { name: 'Excluir' })).toBeNull()
    expect(within(item).getByRole('link', { name: 'Ver em Cartões' })).toBeTruthy()
    expect(screen.getByText(/Pagamento de fatura e amortização não são despesa/)).toBeTruthy()
    // os totais continuam os do banco (period_summary): a linha do cartão não é somada em nada
    const cardDespesas = screen.getByText('Despesas pagas').closest('div') as HTMLElement
    expect(within(cardDespesas).getByText('−R$ 250,50')).toBeTruthy()
    // tarifa já é despesa: o selo diz isso e o texto separa de pagamento de fatura
    const tarifa = screen.getByText('Tarifa de Empréstimo').closest('li') as HTMLElement
    expect(within(tarifa).getByText('Cartão/dívida · já em despesas')).toBeTruthy()
    expect(screen.getByText(/Juros e tarifa são despesa/)).toBeTruthy()
    // os filtros chegam ao lib (que decide o que mostrar); a tela não esconde nada por conta própria
    await u.selectOptions(screen.getByLabelText('Filtrar por tipo'), 'expense')
    await vi.waitFor(() => expect(mock.listarMovimentosDeDivida).toHaveBeenLastCalledWith('h1', expect.any(String), { tipo: 'expense' }))
  })

  it('lançamento no cartão: esconde conta e situação, registra a compra com parcelas e não cria lançamento de conta', async () => {
    const u = userEvent.setup()
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    await abrirNovo(u)
    await u.click(screen.getByRole('radio', { name: 'Cartão de crédito' }))
    expect(screen.queryByLabelText('Conta')).toBeNull()
    expect(screen.queryByRole('group', { name: 'Situação' })).toBeNull()
    await u.type(screen.getByLabelText('Valor (R$)'), '300,00')
    await u.type(screen.getByLabelText('Descrição'), 'Fone')
    await u.selectOptions(screen.getByLabelText('Cartão'), 'k1')
    await u.clear(screen.getByLabelText('Parcelas'))
    await u.type(screen.getByLabelText('Parcelas'), '3')
    await u.selectOptions(screen.getByLabelText('Categoria'), 'mer')
    await u.click(screen.getByRole('button', { name: 'Registrar compra' }))
    expect(mock.registrarCompra).toHaveBeenCalledWith('k1',
      expect.objectContaining({ descricao: 'Fone', total: 30000, parcelas: 3, categoriaId: 'mer' }), expect.any(String))
    expect(mock.criarLancamento).not.toHaveBeenCalled()
  })

  it('cartão: parcela fora de 1 a 72 e cartão não escolhido não chamam o banco', async () => {
    const u = userEvent.setup()
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    await abrirNovo(u)
    await u.click(screen.getByRole('radio', { name: 'Cartão de crédito' }))
    await u.type(screen.getByLabelText('Valor (R$)'), '50,00')
    await u.type(screen.getByLabelText('Descrição'), 'Pão')
    await u.clear(screen.getByLabelText('Parcelas'))
    await u.type(screen.getByLabelText('Parcelas'), '0')
    await u.click(screen.getByRole('button', { name: 'Registrar compra' }))
    expect(screen.getByText('Escolha o cartão.')).toBeTruthy()
    expect(screen.getByText('De 1 a 72 parcelas.')).toBeTruthy()
    expect(mock.registrarCompra).not.toHaveBeenCalled()
  })

  describe('fatura do cartão (pedido do dono, 05/11/2026)', () => {
    const mesAtual = () => hojeSP().slice(0, 7)
    // total do banco (card_months) de propósito DIFERENTE da soma das compras abaixo (100 + 200): a tela não soma
    const fatura = () => ({
      cartaoId: 'k1', cartaoNome: 'Nubank', mes: mesAtual(), fechamento: `${mesAtual()}-20`, vencimento: `${mesAtual()}-28`,
      total: c(45678), pago: c(0), itens: 2, creditos: c(0), situacao: 'fechada', contaPagamentoId: 'a1',
    })
    const comprasDaFatura = [
      { parcelaId: 'p1', compra: 'pl1', parcela: 2, deParcelas: 3, descricao: 'Fone', dataCompra: '2026-01-02', valor: c(10000), falta: c(0), categoriaId: 'mer' },
      { parcelaId: 'p2', compra: 'pl2', parcela: 1, deParcelas: 1, descricao: 'Livro', dataCompra: '2026-01-05', valor: c(20000), falta: c(0), categoriaId: 'outra' },
    ]

    it('as compras viram UMA linha "Fatura <cartão>" no dia do vencimento, com o total do banco e a situação', async () => {
      mock.listarFaturasDoMes.mockResolvedValue([fatura()])
      mock.listarItens.mockResolvedValue(comprasDaFatura)
      render(<MemoryRouter><Lancamentos /></MemoryRouter>)
      const item = (await screen.findByText('Fatura Nubank')).closest('li') as HTMLElement
      const dia = item.closest('section') as HTMLElement
      expect(dia.getAttribute('aria-label')).toBe(`28/${mesAtual().slice(5, 7)}/${mesAtual().slice(0, 4)}`)
      expect(within(item).getByText('R$ 456,78')).toBeTruthy()
      expect(within(item).getByText('Fechada')).toBeTruthy()
      // metadados curtos (pedido do dono): situação + a data que importa, sem o ano e sem "N compras"
      expect(within(item).getByText(`vence 28/${mesAtual().slice(5, 7)}`)).toBeTruthy()
      expect(item.textContent).not.toMatch(/\d+ compras?/)
      expect(item.textContent).not.toContain(mesAtual().slice(0, 4))
      // as compras não aparecem soltas na lista: só dentro da fatura
      expect(screen.queryByText('Fone')).toBeNull()
      expect(screen.queryByText('Livro')).toBeNull()
      // "Ver em Cartões" fica dentro da área aberta: nada de botões lado a lado espremendo o texto
      expect(within(item).queryByRole('link', { name: 'Ver fatura Nubank em Cartões' })).toBeNull()
      await userEvent.setup().click(within(item).getByRole('button', { name: /Ver compras/ }))
      expect(within(item).getByRole('link', { name: 'Ver fatura Nubank em Cartões' }).getAttribute('href')).toBe('/cartoes?cartao=k1')
      expect(within(item).queryByRole('button', { name: 'Excluir' })).toBeNull()
      expect(within(item).queryByRole('button', { name: 'Editar' })).toBeNull()
      expect(mock.listarFaturasDoMes).toHaveBeenCalledWith('h1', mesAtual(), {}, hojeSP())
    })

    it('"Ver compras" abre as compras da fatura com categoria e ícone; o total continua o do banco', async () => {
      mock.listarFaturasDoMes.mockResolvedValue([fatura()])
      mock.listarItens.mockResolvedValue(comprasDaFatura)
      const u = userEvent.setup()
      render(<MemoryRouter><Lancamentos /></MemoryRouter>)
      const item = (await screen.findByText('Fatura Nubank')).closest('li') as HTMLElement
      // a própria linha é o botão que abre (chevron ▸/▾), com aria-expanded
      const botao = within(item).getByRole('button', { name: /Ver compras/ })
      expect(botao.textContent).toContain('▸')
      expect(botao.getAttribute('aria-expanded')).toBe('false')
      await u.click(botao)
      expect(botao.getAttribute('aria-expanded')).toBe('true')
      const lista = await within(item).findByRole('list', { name: 'Compras da fatura Nubank' })
      expect(document.getElementById(botao.getAttribute('aria-controls')!)?.contains(lista)).toBe(true)
      expect(mock.listarItens).toHaveBeenCalledWith('k1', mesAtual())
      const fone = within(lista).getByText('Fone').closest('li') as HTMLElement
      expect(within(fone).getByText(/parcela 2\/3/)).toBeTruthy()
      expect(within(fone).getByText(/· compra de 02\/01\/2026/).textContent).toBe('Mercado · compra de 02/01/2026')
      expect(within(fone).getByText('R$ 100,00')).toBeTruthy()
      expect(fone.querySelector('[data-icone]')!.getAttribute('data-icone')).toBe('carrinho')
      expect(within(lista).getByText('Livro')).toBeTruthy()
      // a soma das compras seria R$ 300,00: a linha mostra o total do banco
      expect(within(item).getByText('R$ 456,78')).toBeTruthy()
      expect(within(item).queryByText('R$ 300,00')).toBeNull()
      expect(botao.textContent).toContain('▾')
      await u.click(within(item).getByRole('button', { name: /Esconder compras/ }))
      expect(within(item).queryByRole('list', { name: 'Compras da fatura Nubank' })).toBeNull()
    })

    it('situação vencida e paga aparecem no selo; o pagamento da fatura fica numa linha à parte, com outro rótulo', async () => {
      mock.listarFaturasDoMes.mockResolvedValue([{ ...fatura(), situacao: 'vencida' }, { ...fatura(), cartaoId: 'k2', cartaoNome: 'Itaú', situacao: 'paga', pago: c(45678) }])
      mock.listarMovimentosDeDivida.mockResolvedValue([
        { id: 'e1', data: `${mesAtual()}-28`, contaId: 'a1', descricao: 'Pagamento da fatura · Itaú', valor: c(-45678), jaEmDespesas: false },
      ])
      render(<MemoryRouter><Lancamentos /></MemoryRouter>)
      const nubank = (await screen.findByText('Fatura Nubank')).closest('li') as HTMLElement
      expect(within(nubank).getByText('Vencida')).toBeTruthy()
      const itau = screen.getByText('Fatura Itaú').closest('li') as HTMLElement
      expect(within(itau).getByText('Paga')).toBeTruthy()
      const pagamento = screen.getByText('Pagamento da fatura · Itaú').closest('li') as HTMLElement
      expect(pagamento).not.toBe(itau)
      expect(within(pagamento).getByText('−R$ 456,78')).toBeTruthy()
      expect(screen.getByText(/Pagamento da fatura/, { selector: 'strong' })).toBeTruthy()
    })

    it('os totais do topo continuam os do banco (period_summary): a fatura não é somada em nada', async () => {
      mock.listarFaturasDoMes.mockResolvedValue([fatura()])
      render(<MemoryRouter><Lancamentos /></MemoryRouter>)
      await screen.findByText('Fatura Nubank')
      const despesas = screen.getByText('Despesas pagas').closest('div') as HTMLElement
      expect(within(despesas).getByText('−R$ 250,50')).toBeTruthy()
      const resultado = screen.getByText('Resultado do mês').closest('div') as HTMLElement
      expect(within(resultado).getByText(/R\$\s?250,50/)).toBeTruthy()
      expect(mock.resumoDoMes).toHaveBeenCalledWith('h1', mesAtual())
    })

    it('com filtro de categoria, as compras daquela categoria aparecem uma a uma (sem a linha da fatura)', async () => {
      mock.listarFaturasDoMes.mockResolvedValue([fatura()])
      mock.listarItens.mockResolvedValue(comprasDaFatura)
      const u = userEvent.setup()
      render(<MemoryRouter><Lancamentos /></MemoryRouter>)
      await screen.findByText('Fatura Nubank')
      await u.selectOptions(screen.getByLabelText('Filtrar por categoria'), 'mer')
      const fone = (await screen.findByText('Fone')).closest('li') as HTMLElement
      expect(screen.queryByText('Fatura Nubank')).toBeNull()
      expect(screen.queryByText('Livro')).toBeNull() // outra categoria
      expect(within(fone).getByText('No cartão')).toBeTruthy()
      expect(within(fone).getByText('Mercado')).toBeTruthy()
      expect(within(fone).getByText(/fatura Nubank · compra de 02\/01\/2026 · a despesa conta em 20\/.* \(fechamento da fatura\)/)).toBeTruthy()
      expect(within(fone).getByText('R$ 100,00')).toBeTruthy()
      expect((fone.closest('section') as HTMLElement).getAttribute('aria-label')).toMatch(/^28\//)
      expect(mock.listarFaturasDoMes).toHaveBeenLastCalledWith('h1', mesAtual(), { categoriaId: 'mer' }, hojeSP())
    })

    it('se as faturas falharem, a lista de conta continua e só o bloco avisa', async () => {
      mock.listarFaturasDoMes.mockRejectedValue(new Error('falhou'))
      render(<MemoryRouter><Lancamentos /></MemoryRouter>)
      expect(await screen.findByText('Supermercado')).toBeTruthy()
      expect(screen.getByText(/Não foi possível carregar as faturas dos cartões/)).toBeTruthy()
    })

    it('se as compras da fatura falharem ao abrir, avisa dentro da fatura', async () => {
      mock.listarFaturasDoMes.mockResolvedValue([fatura()])
      mock.listarItens.mockRejectedValue(new Error('falhou'))
      const u = userEvent.setup()
      render(<MemoryRouter><Lancamentos /></MemoryRouter>)
      const item = (await screen.findByText('Fatura Nubank')).closest('li') as HTMLElement
      await u.click(within(item).getByRole('button', { name: /Ver compras/ }))
      expect((await within(item).findByRole('alert')).textContent).toMatch(/Não foi possível carregar as compras/)
    })
  })

  describe('créditos do cartão (decisão do dono, 05/11/2026)', () => {
    const mesAtual = () => hojeSP().slice(0, 7)
    // total do banco (card_months, já líquido dos créditos) DIFERENTE de compras − créditos: a tela não soma
    const faturaComCredito = () => ({
      cartaoId: 'k1', cartaoNome: 'CAIXA INFINITE', mes: mesAtual(), fechamento: `${mesAtual()}-18`, vencimento: `${mesAtual()}-28`,
      total: c(97691), pago: c(0), itens: 1, creditos: c(2315), situacao: 'aberta', contaPagamentoId: 'a1',
    })
    const creditosDaFatura = [
      { id: 'cr1', descricao: 'IOF', dataCredito: `${mesAtual()}-03`, fechamento: `${mesAtual()}-18`, valor: c(2309), categoriaId: 'sal' },
      { id: 'cr2', descricao: 'Ajuste de Crédito', dataCredito: `${mesAtual()}-04`, fechamento: `${mesAtual()}-18`, valor: c(6), categoriaId: 'sal' },
    ]
    const solto = {
      id: 'cr1', data: `${mesAtual()}-18`, dataCredito: `${mesAtual()}-03`, descricao: 'IOF', cartaoNome: 'CAIXA INFINITE', categoriaId: 'sal',
      valor: c(2309), planejado: true, vencimento: null,
    }

    it('sem filtro: os créditos ficam DENTRO da fatura, em "Créditos e reembolsos" (azul, +), e não soltos', async () => {
      mock.listarFaturasDoMes.mockResolvedValue([faturaComCredito()])
      mock.listarItens.mockResolvedValue([
        { parcelaId: 'p1', compra: 'pl1', parcela: 1, deParcelas: 1, descricao: 'Mercado do mês', dataCompra: `${mesAtual()}-02`, valor: c(100000), falta: c(0), categoriaId: 'mer' },
      ])
      mock.listarCreditosDaFatura.mockResolvedValue(creditosDaFatura)
      // mesmo que o lib devolvesse créditos soltos, sem filtro a tela nem pede (não duplica)
      mock.listarCreditosDeCartao.mockResolvedValue([solto])
      const u = userEvent.setup()
      render(<MemoryRouter><Lancamentos /></MemoryRouter>)
      const item = (await screen.findByText('Fatura CAIXA INFINITE')).closest('li') as HTMLElement
      expect(screen.queryByText('IOF')).toBeNull()
      expect(screen.queryByText('Ajuste de Crédito')).toBeNull()
      expect(mock.listarCreditosDeCartao).not.toHaveBeenCalled()
      // total do banco, já líquido; nem 1.000,00 (compras) nem 976,85 (compras − créditos somados na tela)
      expect(within(item).getByText('R$ 976,91')).toBeTruthy()
      await u.click(within(item).getByRole('button', { name: /Ver compras/ }))
      const lista = await within(item).findByRole('list', { name: 'Créditos e reembolsos da fatura CAIXA INFINITE' })
      expect(within(item).getByRole('heading', { name: 'Créditos e reembolsos' })).toBeTruthy()
      expect(mock.listarCreditosDaFatura).toHaveBeenCalledWith('k1', mesAtual())
      const iof = within(lista).getByText('IOF').closest('li') as HTMLElement
      const valor = within(iof).getByText('+R$ 23,09')
      expect(valor.className).toContain('text-lucro')
      expect(valor.className).toContain('whitespace-nowrap')
      expect(within(lista).getByText('+R$ 0,06')).toBeTruthy()
      expect(within(item).queryByText(/976,85/)).toBeNull()
    })

    it('fatura sem créditos (segundo o banco) não pede créditos ao abrir', async () => {
      mock.listarFaturasDoMes.mockResolvedValue([{ ...faturaComCredito(), creditos: c(0) }])
      const u = userEvent.setup()
      render(<MemoryRouter><Lancamentos /></MemoryRouter>)
      const item = (await screen.findByText('Fatura CAIXA INFINITE')).closest('li') as HTMLElement
      await u.click(within(item).getByRole('button', { name: /Ver compras/ }))
      await within(item).findByText('Nenhuma compra nesta fatura.')
      expect(mock.listarCreditosDaFatura).not.toHaveBeenCalled()
      expect(within(item).queryByText('Créditos e reembolsos')).toBeNull()
    })

    it('filtro tipo Receita: o crédito aparece solto no dia do fechamento (a fatura não aparece em Receita)', async () => {
      mock.listarFaturasDoMes.mockResolvedValue([]) // o lib não devolve fatura com filtro de receita
      mock.listarCreditosDeCartao.mockResolvedValue([solto])
      render(<MemoryRouter initialEntries={[`/lancamentos?mes=${mesAtual()}&tipo=receita`]}><Lancamentos /></MemoryRouter>)
      const item = (await screen.findByText('IOF')).closest('li') as HTMLElement
      expect(mock.listarCreditosDeCartao).toHaveBeenCalledWith('h1', mesAtual(), { tipo: 'income' }, hojeSP())
      expect((item.closest('section') as HTMLElement).getAttribute('aria-label')).toMatch(/^18\//)
      expect(within(item).getByText('Crédito no cartão')).toBeTruthy()
      expect(within(item).getByText('Planejado')).toBeTruthy()
      expect(within(item).getByText(/CAIXA INFINITE · crédito de 03\/.* · a receita conta em 18\//)).toBeTruthy()
      expect(within(item).getByText(/^\+R\$\s?23,09$/).className).toContain('text-lucro')
      expect(within(item).queryByRole('button', { name: /Ações de/ })).toBeNull() // só leitura
      expect(screen.queryByText('Fatura CAIXA INFINITE')).toBeNull()
    })

    it('filtro de categoria de receita: os créditos daquela categoria saem soltos no vencimento, como as compras', async () => {
      mock.listarFaturasDoMes.mockResolvedValue([faturaComCredito()])
      mock.listarCreditosDaFatura.mockResolvedValue([...creditosDaFatura, { ...creditosDaFatura[1], id: 'cr3', descricao: 'Cashback', categoriaId: 'outra' }])
      const u = userEvent.setup()
      render(<MemoryRouter><Lancamentos /></MemoryRouter>)
      await screen.findByText('Fatura CAIXA INFINITE')
      await u.selectOptions(screen.getByLabelText('Filtrar por categoria'), 'sal')
      const item = (await screen.findByText('IOF')).closest('li') as HTMLElement
      expect(screen.queryByText('Fatura CAIXA INFINITE')).toBeNull()
      expect(screen.getByText('Ajuste de Crédito')).toBeTruthy()
      expect(screen.queryByText('Cashback')).toBeNull() // outra categoria
      expect((item.closest('section') as HTMLElement).getAttribute('aria-label')).toMatch(/^28\//)
      expect(within(item).getByText(/fatura CAIXA INFINITE · crédito de 03\/.* · a receita conta em 18\//)).toBeTruthy()
      // sem filtro de tipo, a lista solta de "Receita" não é pedida: não duplica
      expect(mock.listarCreditosDeCartao).not.toHaveBeenCalled()
    })

    it('os totais do topo não mudam: vêm do banco (period_summary)', async () => {
      mock.listarFaturasDoMes.mockResolvedValue([faturaComCredito()])
      mock.listarCreditosDaFatura.mockResolvedValue(creditosDaFatura)
      render(<MemoryRouter><Lancamentos /></MemoryRouter>)
      await screen.findByText('Fatura CAIXA INFINITE')
      const receitas = screen.getByText('Receitas pagas').closest('div') as HTMLElement
      expect(within(receitas).getByText('+R$ 0,00')).toBeTruthy()
      expect(mock.resumoDoMes).toHaveBeenCalledWith('h1', mesAtual())
    })
  })

  describe('layout da linha na lista (abaixo de 1024px)', () => {
    it('valor em elemento próprio, sem quebra, fora do bloco do título; ações no menu ⋯ e "Marcar pago" em 1 toque', async () => {
      const u = userEvent.setup()
      render(<MemoryRouter><Lancamentos /></MemoryRouter>)
      const titulo = await screen.findByText('Salário', { selector: '.line-clamp-2' })
      const item = titulo.closest('li') as HTMLElement
      const valor = within(item).getByText('+R$ 8.000,00')
      expect(valor.className).toMatch(/whitespace-nowrap/)
      expect(valor.className).toMatch(/tabular-nums/)
      // o valor não está dentro do bloco do título/metadados (coluna própria da grade)
      expect(titulo.parentElement!.contains(valor)).toBe(false)
      expect(item.className).toContain('grid-cols-[auto_minmax(0,1fr)_auto]')
      // etiqueta e categoria na MESMA linha de metadados
      const meta = item.querySelector('[data-metadados]') as HTMLElement
      expect(meta.className).toMatch(/whitespace-nowrap/)
      expect(within(meta).getByText('Planejado')).toBeTruthy()
      expect(within(meta).getByText('Salário')).toBeTruthy()
      // sem os três botões lado a lado: Editar/Excluir só no menu ⋯
      expect(within(item).queryByRole('button', { name: 'Editar' })).toBeNull()
      expect(within(item).queryByRole('button', { name: 'Excluir' })).toBeNull()
      expect(within(item).getByRole('button', { name: 'Marcar pago' }).textContent).toBe('✓')
      await u.click(within(item).getByRole('button', { name: 'Ações de Salário' }))
      expect(within(item).getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Marcar pago', 'Editar', 'Excluir'])
      // pago não oferece "Marcar pago"
      const pago = screen.getByText('Supermercado').closest('li') as HTMLElement
      expect(within(pago).queryByRole('button', { name: 'Marcar pago' })).toBeNull()
    })

    it('a explicação das faturas é uma linha curta com (i); o texto completo abre ao tocar', async () => {
      const mes = hojeSP().slice(0, 7)
      mock.listarFaturasDoMes.mockResolvedValue([{
        cartaoId: 'k1', cartaoNome: 'Nubank', mes, fechamento: `${mes}-20`, vencimento: `${mes}-28`, total: c(100), pago: c(0), itens: 1,
        creditos: c(0), situacao: 'aberta', contaPagamentoId: 'a1',
      }])
      const u = userEvent.setup()
      render(<MemoryRouter><Lancamentos /></MemoryRouter>)
      const resumo = await screen.findByText('Fatura no vencimento, com compras e créditos dentro.')
      const detalhes = resumo.closest('details') as HTMLDetailsElement
      expect(detalhes.open).toBe(false)
      await u.click(resumo)
      expect(detalhes.open).toBe(true)
      expect(within(detalhes).getByText(/Pagamento da fatura/, { selector: 'strong' })).toBeTruthy()
    })
  })

  it('se os créditos do cartão falharem, a lista continua', async () => {
    mock.listarCreditosDeCartao.mockRejectedValue(new Error('falhou'))
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    expect(await screen.findByText('Supermercado')).toBeTruthy()
  })

  it('se os cartões falharem, contas e lançamentos continuam na tela', async () => {
    mock.listarCartoes.mockRejectedValue(new Error('falhou'))
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    expect(await screen.findByText('Supermercado')).toBeTruthy()
    expect(screen.getByRole('button', { name: '+ Lançamento' })).toBeTruthy()
  })

  it('reenvio do mesmo cartão com outro valor usa outra chave (não grava 100 quando o usuário corrigiu para 120)', async () => {
    const u = userEvent.setup()
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    await abrirNovo(u)
    await u.click(screen.getByRole('radio', { name: 'Cartão de crédito' }))
    await u.type(screen.getByLabelText('Valor (R$)'), '100,00')
    await u.type(screen.getByLabelText('Descrição'), 'Fone')
    await u.selectOptions(screen.getByLabelText('Cartão'), 'k1')
    await u.selectOptions(screen.getByLabelText('Categoria'), 'mer')
    mock.registrarCompra.mockRejectedValueOnce(new Error('failed to fetch'))
    await u.click(screen.getByRole('button', { name: 'Registrar compra' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    const valor = screen.getByLabelText('Valor (R$)')
    await u.clear(valor)
    await u.type(valor, '120,00')
    await u.click(screen.getByRole('button', { name: 'Registrar compra' }))
    const [, , chave1] = mock.registrarCompra.mock.calls[0]
    const [, dados2, chave2] = mock.registrarCompra.mock.calls[1]
    expect(dados2.total).toBe(12000)
    expect(chave2).not.toBe(chave1)
  })

  it('reenvio com o mesmo conteúdo usa a mesma chave (não duplica a compra)', async () => {
    const u = userEvent.setup()
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    await abrirNovo(u)
    await u.click(screen.getByRole('radio', { name: 'Cartão de crédito' }))
    await u.type(screen.getByLabelText('Valor (R$)'), '100,00')
    await u.type(screen.getByLabelText('Descrição'), 'Fone')
    await u.selectOptions(screen.getByLabelText('Cartão'), 'k1')
    await u.selectOptions(screen.getByLabelText('Categoria'), 'mer')
    mock.registrarCompra.mockRejectedValueOnce(new Error('failed to fetch'))
    await u.click(screen.getByRole('button', { name: 'Registrar compra' }))
    await screen.findByRole('alert')
    await u.click(screen.getByRole('button', { name: 'Registrar compra' }))
    expect(mock.registrarCompra.mock.calls[0][2]).toBe(mock.registrarCompra.mock.calls[1][2])
  })

  it('trocar para cartão limpa a categoria de receita (não manda categoria de outro tipo)', async () => {
    const u = userEvent.setup()
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    await abrirNovo(u)
    await u.click(screen.getByRole('radio', { name: 'Receita' }))
    await u.selectOptions(screen.getByLabelText('Categoria'), 'sal')
    await u.click(screen.getByRole('radio', { name: 'Cartão de crédito' }))
    expect((screen.getByLabelText('Categoria') as HTMLSelectElement).value).toBe('')
  })

  it('atalho do painel ?novo=receita abre o formulário já como receita; ?novo=cartao já como compra no cartão', async () => {
    const { unmount } = render(<MemoryRouter initialEntries={['/lancamentos?novo=receita']}><Lancamentos /></MemoryRouter>)
    expect(await screen.findByText('Novo lançamento', { selector: 'h2' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'Receita' }).getAttribute('aria-checked')).toBe('true')
    unmount()
    render(<MemoryRouter initialEntries={['/lancamentos?novo=cartao']}><Lancamentos /></MemoryRouter>)
    expect(await screen.findByText('Novo lançamento', { selector: 'h2' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'Cartão de crédito' }).getAttribute('aria-checked')).toBe('true')
  })

  it('?mes=AAAA-MM abre aquele mês; valor inválido volta para o mês atual', async () => {
    const { unmount } = render(<MemoryRouter initialEntries={['/lancamentos?mes=2026-03']}><Lancamentos /></MemoryRouter>)
    await screen.findByText(/março de 2026/i)
    unmount()
    render(<MemoryRouter initialEntries={['/lancamentos?mes=2026-13']}><Lancamentos /></MemoryRouter>)
    await screen.findByRole('button', { name: '+ Lançamento' })
    expect(screen.queryByText(/2026-13/)).toBeNull()
  })

  it('se as rotinas automáticas falharem (faturas ou recorrentes), a lista avisa que pode faltar coisa', async () => {
    automaticos.atualizarAutomaticos.mockResolvedValue({ recorrentesOk: true, faturasOk: false })
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    expect(await screen.findByText(/Não foi possível fechar as faturas dos cartões agora/)).toBeTruthy()
    expect(await screen.findByText('Supermercado')).toBeTruthy()
    cleanup()
    automaticos.atualizarAutomaticos.mockResolvedValue({ recorrentesOk: false, faturasOk: true })
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    expect(await screen.findByText(/Não foi possível lançar os recorrentes agora/)).toBeTruthy()
  })

  it('trocar de mês rápido: a lista do mês antigo, se chegar depois, não sobrescreve a do mês da tela', async () => {
    let soltar: (v: unknown) => void = () => {}
    const lenta = new Promise((r) => { soltar = r })
    const outroMes = [{ ...lancs[0], id: 'novo', descricao: 'Do mês certo', data: '2026-09-10' }]
    mock.listarLancamentos.mockReset()
    mock.listarLancamentos
      .mockReturnValueOnce(lenta) // carga inicial (mês atual): resolve por último
      .mockResolvedValueOnce(outroMes) // mês anterior: resolve primeiro
    const u = userEvent.setup()
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    await u.click(await screen.findByRole('button', { name: 'Mês anterior' }))
    expect(await screen.findByText('Do mês certo')).toBeTruthy()
    soltar(lancs)
    await new Promise((r) => setTimeout(r, 30))
    expect(screen.queryByText('Supermercado')).toBeNull()
    expect(screen.getByText('Do mês certo')).toBeTruthy()
  })

  describe('filtros da lista', () => {
    const opcoesDe = (rotulo: string) => Array.from((screen.getByLabelText(rotulo) as HTMLSelectElement).options).map((o) => o.textContent)

    it('tipo vem antes da categoria', async () => {
      render(<MemoryRouter><Lancamentos /></MemoryRouter>)
      await screen.findByText('Supermercado')
      const ordem = screen.getAllByLabelText(/^Filtrar por/).map((e) => e.previousElementSibling?.textContent)
      expect(ordem).toEqual(['Filtrar por conta', 'Filtrar por tipo', 'Filtrar por categoria'])
    })

    it('sem tipo mostra todas as categorias; com Despesa ou Receita, só as do tipo', async () => {
      const u = userEvent.setup()
      render(<MemoryRouter><Lancamentos /></MemoryRouter>)
      await screen.findByText('Supermercado')
      expect(opcoesDe('Filtrar por categoria')).toEqual(['Todas as categorias', 'Mercado (despesa)', 'Salário (receita)'])
      await u.selectOptions(screen.getByLabelText('Filtrar por tipo'), 'expense')
      expect(opcoesDe('Filtrar por categoria')).toEqual(['Todas as categorias', 'Mercado'])
      await u.selectOptions(screen.getByLabelText('Filtrar por tipo'), 'income')
      expect(opcoesDe('Filtrar por categoria')).toEqual(['Todas as categorias', 'Salário'])
    })

    it('trocar o tipo limpa a categoria incompatível e mantém conta e categoria compatível', async () => {
      const u = userEvent.setup()
      render(<MemoryRouter><Lancamentos /></MemoryRouter>)
      await screen.findByText('Supermercado')
      await u.selectOptions(screen.getByLabelText('Filtrar por conta'), 'a2')
      await u.selectOptions(screen.getByLabelText('Filtrar por categoria'), 'mer')
      await u.selectOptions(screen.getByLabelText('Filtrar por tipo'), 'expense') // compatível: continua
      await vi.waitFor(() => expect(mock.listarLancamentos).toHaveBeenLastCalledWith('h1', expect.any(String), { contaId: 'a2', categoriaId: 'mer', tipo: 'expense' }))
      await u.selectOptions(screen.getByLabelText('Filtrar por tipo'), 'income') // incompatível: sai; a conta fica
      await vi.waitFor(() => expect(mock.listarLancamentos).toHaveBeenLastCalledWith('h1', expect.any(String), { contaId: 'a2', categoriaId: undefined, tipo: 'income' }))
      expect((screen.getByLabelText('Filtrar por categoria') as HTMLSelectElement).value).toBe('')
    })

    it('Transferência não tem categoria: seletor desabilitado e categoria limpa', async () => {
      const u = userEvent.setup()
      render(<MemoryRouter><Lancamentos /></MemoryRouter>)
      await screen.findByText('Supermercado')
      await u.selectOptions(screen.getByLabelText('Filtrar por categoria'), 'mer')
      await u.selectOptions(screen.getByLabelText('Filtrar por tipo'), 'transfer')
      const categoria = screen.getByLabelText('Filtrar por categoria') as HTMLSelectElement
      expect(categoria.disabled).toBe(true)
      expect(opcoesDe('Filtrar por categoria')).toEqual(['Transferência não tem categoria'])
      await vi.waitFor(() => expect(mock.listarLancamentos).toHaveBeenLastCalledWith('h1', expect.any(String), { categoriaId: undefined, tipo: 'transfer' }))
      await u.selectOptions(screen.getByLabelText('Filtrar por tipo'), '') // voltar a "todos" reabilita
      expect((screen.getByLabelText('Filtrar por categoria') as HTMLSelectElement).disabled).toBe(false)
    })

    it('"Novo lançamento" não mostra os filtros enquanto o formulário está aberto, e eles voltam ao cancelar', async () => {
      const u = userEvent.setup()
      render(<MemoryRouter><Lancamentos /></MemoryRouter>)
      await screen.findByText('Supermercado')
      expect(screen.getByLabelText('Filtrar por tipo')).toBeTruthy()
      await abrirNovo(u)
      expect(screen.queryByLabelText('Filtrar por conta')).toBeNull()
      expect(screen.queryByLabelText('Filtrar por tipo')).toBeNull()
      expect(screen.queryByLabelText('Filtrar por categoria')).toBeNull()
      await u.click(screen.getByRole('button', { name: 'Cancelar' }))
      expect(screen.getByLabelText('Filtrar por tipo')).toBeTruthy()
    })
  })
})

describe('Formulário de lançamento (novo visual)', () => {
  const abrir = async () => {
    const u = userEvent.setup()
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    await screen.findByText('Supermercado')
    await abrirNovo(u)
    return u
  }

  it('uma linha de abas (Despesa, Receita, Transferência, Cartão) e o botão diz a ação', async () => {
    const u = await abrir()
    const abas = screen.getByRole('radiogroup', { name: 'Tipo do lançamento' })
    expect(within(abas).getAllByRole('radio').map((r) => r.getAttribute('aria-label')))
      .toEqual(['Despesa', 'Receita', 'Transferência', 'Cartão de crédito'])
    expect(screen.getByRole('button', { name: 'Registrar despesa' })).toBeTruthy()
    await u.click(within(abas).getByRole('radio', { name: 'Receita' }))
    expect(screen.getByRole('button', { name: 'Registrar receita' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'Recebido' })).toBeTruthy() // em receita, "Pago" vira "Recebido"
    await u.click(within(abas).getByRole('radio', { name: 'Cartão de crédito' }))
    expect(screen.getByRole('button', { name: 'Registrar compra' })).toBeTruthy()
  })

  it('editar não oferece a aba Cartão e o botão é "Salvar alterações"', async () => {
    const u = userEvent.setup()
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    const item = (await screen.findByText('Supermercado')).closest('li') as HTMLElement
    await u.click(within(item).getByRole('button', { name: 'Ações de Supermercado' }))
    await u.click(within(item).getByRole('menuitem', { name: 'Editar' }))
    const abas = screen.getByRole('radiogroup', { name: 'Tipo do lançamento' })
    expect(within(abas).getAllByRole('radio')).toHaveLength(3)
    expect(screen.getByRole('button', { name: 'Salvar alterações' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Registrar e lançar outro' })).toBeNull()
  })

  it('conta principal: o lançamento novo abre na última conta usada; conta que não existe mais cai na primeira', async () => {
    let u = await abrir()
    expect((screen.getByLabelText('Conta') as HTMLSelectElement).value).toBe('a1')
    await u.selectOptions(screen.getByLabelText('Conta'), 'a2')
    await u.type(screen.getByLabelText('Valor (R$)'), '10')
    await u.selectOptions(screen.getByLabelText('Categoria'), 'mer')
    await u.click(screen.getByRole('button', { name: 'Registrar despesa' }))
    expect(mock.criarLancamento).toHaveBeenCalledWith('h1', expect.objectContaining({ contaId: 'a2' }))
    cleanup()
    u = await abrir()
    expect((screen.getByLabelText('Conta') as HTMLSelectElement).value).toBe('a2')
    cleanup()
    window.localStorage.setItem('tudoazul:ultima-conta:h1', 'conta-apagada')
    u = await abrir()
    expect((screen.getByLabelText('Conta') as HTMLSelectElement).value).toBe('a1')
  })

  it('"Registrar e lançar outro": grava, avisa, recarrega a lista e deixa o formulário aberto e limpo, na mesma conta', async () => {
    const u = await abrir()
    await u.selectOptions(screen.getByLabelText('Conta'), 'a2')
    await u.type(screen.getByLabelText('Valor (R$)'), '25,00')
    await u.type(screen.getByLabelText('Descrição'), 'Pão')
    await u.selectOptions(screen.getByLabelText('Categoria'), 'mer')
    const chamadasAntes = mock.listarLancamentos.mock.calls.length
    await u.click(screen.getByRole('button', { name: 'Registrar e lançar outro' }))
    expect(mock.criarLancamento).toHaveBeenCalledWith('h1', expect.objectContaining({ valor: 2500, descricao: 'Pão', contaId: 'a2' }))
    expect(await screen.findByText(/Despesa registrada\./)).toBeTruthy()
    expect(mock.listarLancamentos.mock.calls.length).toBeGreaterThan(chamadasAntes)
    expect((screen.getByLabelText('Valor (R$)') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('Descrição') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('Categoria') as HTMLSelectElement).value).toBe('')
    expect((screen.getByLabelText('Conta') as HTMLSelectElement).value).toBe('a2')
    expect(screen.getByRole('button', { name: 'Registrar despesa' })).toBeTruthy() // continua aberto
  })
})

describe('Subcategoria na ordem e no nome', () => {
  const cats = [
    { id: 'out', nome: 'Outras receitas', tipo: 'income', paiId: null, sistema: false, ativa: true },
    { id: 'ren', nome: 'Rendimentos', tipo: 'income', paiId: null, sistema: false, ativa: true },
    { id: 'roy', nome: 'Royalty', tipo: 'income', paiId: null, sistema: false, ativa: true },
    { id: 'reem', nome: 'Reembolso', tipo: 'income', paiId: 'roy', sistema: false, ativa: true },
  ]

  it('no formulário, a subcategoria vem logo abaixo da principal (e não entre "Outras receitas" e "Rendimentos")', async () => {
    mock.listarCategorias.mockResolvedValue(cats)
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    const u = userEvent.setup()
    await screen.findByText('Supermercado')
    await abrirNovo(u)
    await u.click(within(screen.getByRole('radiogroup', { name: 'Tipo do lançamento' })).getByRole('radio', { name: 'Receita' }))
    const opcoes = within(screen.getByLabelText('Categoria')).getAllByRole('option').map((o) => o.textContent)
    expect(opcoes).toEqual(['Escolher', 'Outras receitas', 'Rendimentos', 'Royalty', '↳ Reembolso'])
  })

  it('na lista, a subcategoria mostra só a folha; o caminho "Principal › Sub" fica no title e no texto do leitor de tela', async () => {
    mock.listarCategorias.mockResolvedValue(cats)
    mock.listarLancamentos.mockResolvedValue([
      { id: 'r1', tipo: 'income', contaId: 'a1', destinoId: null, categoriaId: 'reem', descricao: 'Devolução', valor: c(16800), data: '2026-10-05', status: 'paid', notas: '' },
    ])
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    const folha = await screen.findByText('Reembolso')
    expect(folha.getAttribute('aria-hidden')).toBe('true')
    const nome = folha.parentElement as HTMLElement
    expect(nome.getAttribute('title')).toBe('Royalty › Reembolso')
    expect(within(nome).getByText('Royalty › Reembolso').className).toContain('sr-only')
    // texto visível (sem o sr-only) é só a folha
    const visivel = [...nome.childNodes].filter((n) => !(n as HTMLElement).classList?.contains('sr-only')).map((n) => n.textContent).join('')
    expect(visivel).toBe('Reembolso')
  })

  it('no filtro por categoria, a subcategoria também fica sob a principal', async () => {
    mock.listarCategorias.mockResolvedValue(cats)
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    await screen.findByText('Supermercado')
    const opcoes = within(screen.getByLabelText('Filtrar por categoria')).getAllByRole('option').map((o) => o.textContent)
    expect(opcoes).toEqual(['Todas as categorias', 'Outras receitas (receita)', 'Rendimentos (receita)', 'Royalty (receita)', '↳ Reembolso (receita)'])
  })
  it('parcela planejada do contrato aparece no mês, marcada como planejada, com Baixar parcela, e fora dos totais', async () => {
    mock.listarParcelasDivida.mockResolvedValue([
      { id: 's3', dividaId: 'd1', nomeDivida: 'Financiamento do imóvel', numero: 3, vencimento: '2026-10-20', valor: c(150000), formaPagamento: 'account_debit', contaPagamentoId: 'a1' },
    ])
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    const linha = (await screen.findByText(/Financiamento do imóvel · parcela 3/)).closest('li')!
    expect(within(linha).getByText('Planejado · contrato')).toBeTruthy()
    expect(within(linha).getByText(/Débito em Itaú/)).toBeTruthy()
    expect(within(linha).getByText('−R$ 1.500,00')).toBeTruthy()
    expect(within(linha).getByRole('link', { name: 'Baixar parcela 3 de Financiamento do imóvel' }).getAttribute('href')).toBe('/dividas?baixar=s3')
    expect(screen.getAllByText('−R$ 1.500,00')).toHaveLength(1) // só na linha: os totais continuam os do banco
    const [de, ate] = limitesDoMes(mock.listarLancamentos.mock.calls[0][1])
    expect(mock.listarParcelasDivida).toHaveBeenCalledWith('h1', de, ate)
  })

  it('se a agenda de parcelas falhar, o resto do extrato aparece normalmente', async () => {
    mock.listarParcelasDivida.mockRejectedValue(new Error('sem a tabela'))
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    expect((await screen.findAllByText('−R$ 250,50')).length).toBe(2)
  })

describe('painel de lançamento (como no Organizze)', () => {
  it('"+ Lançamento" abre o menu com os quatro tipos; a escolha abre o painel por cima, que fecha no × e no Esc', async () => {
    const u = userEvent.setup()
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    await u.click(await screen.findByRole('button', { name: '+ Lançamento' }))
    const menu = screen.getByRole('menu', { name: 'Novo lançamento' })
    expect(within(menu).getAllByRole('menuitem').map((b) => b.textContent)).toEqual([
      'Nova despesatecla D', 'Nova receitatecla R', 'Nova transferênciatecla T', 'Compra no cartãotecla C',
    ])
    await u.click(within(menu).getByRole('menuitem', { name: /Nova receita/ }))
    const painel = screen.getByRole('dialog', { name: 'Novo lançamento' })
    expect(painel.getAttribute('aria-modal')).toBe('true')
    expect(within(painel).getByRole('radio', { name: 'Receita' }).getAttribute('aria-checked')).toBe('true')
    await u.click(within(painel).getByRole('button', { name: 'Fechar' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    await abrirNovo(u)
    await u.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('atalhos: T abre transferência, C abre compra no cartão; dentro de um campo a tecla não abre nada', async () => {
    const u = userEvent.setup()
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    await screen.findByRole('button', { name: '+ Lançamento' })
    await u.keyboard('t')
    expect(within(screen.getByRole('dialog')).getByRole('radio', { name: 'Transferência' }).getAttribute('aria-checked')).toBe('true')
    await u.keyboard('{Escape}')
    await u.keyboard('c')
    expect(within(screen.getByRole('dialog')).getByRole('radio', { name: 'Cartão de crédito' }).getAttribute('aria-checked')).toBe('true')
    await u.keyboard('{Escape}')
    await u.click(screen.getByRole('combobox', { name: 'Filtrar por conta' }))
    await u.keyboard('d')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('Repetir → lançamento fixo: cria a regra de recorrente (mensal no dia da data) e não um lançamento solto', async () => {
    const u = userEvent.setup()
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    await abrirNovo(u)
    const painel = screen.getByRole('dialog')
    await u.type(within(painel).getByLabelText('Descrição'), 'Internet')
    await u.type(within(painel).getByLabelText('Valor (R$)'), '120,00')
    await u.selectOptions(within(painel).getByLabelText('Categoria'), within(painel).getAllByRole('option').find((o) => o.textContent === 'Mercado')?.getAttribute('value') ?? '')
    fireEvent.change(within(painel).getByLabelText('Data'), { target: { value: '2026-11-10' } })
    await u.click(within(painel).getByRole('button', { name: /Repetir/ }))
    await u.selectOptions(within(painel).getByRole('combobox', { name: 'Repetir' }), 'trimestral')
    expect(within(painel).queryByRole('radio', { name: 'Pago' })).toBeNull() // ocorrências entram planejadas
    await u.click(within(painel).getByRole('button', { name: 'Criar lançamento fixo' }))
    await waitFor(() => expect(mock.criarRecorrencia).toHaveBeenCalled())
    expect(mock.criarRecorrencia.mock.calls[0][0]).toMatchObject({
      tipo: 'expense', descricao: 'Internet', valor: 12000, dia: 10, unidade: 'month', cada: 3, inicio: '2026-11-10', fim: null, destinoId: null, cartaoId: null,
    })
    expect(mock.criarLancamento).not.toHaveBeenCalled()
  })

  it('lançamento fixo exige nome e "até" depois da data', async () => {
    const u = userEvent.setup()
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    await abrirNovo(u)
    const painel = screen.getByRole('dialog')
    await u.type(within(painel).getByLabelText('Valor (R$)'), '50,00')
    fireEvent.change(within(painel).getByLabelText('Data'), { target: { value: '2026-11-10' } })
    await u.click(within(painel).getByRole('button', { name: /Repetir/ }))
    fireEvent.change(within(painel).getByLabelText('Até (opcional)'), { target: { value: '2026-10-01' } })
    await u.click(within(painel).getByRole('button', { name: 'Criar lançamento fixo' }))
    expect(within(painel).getByText(/Dê um nome ao lançamento fixo/)).toBeTruthy()
    await u.type(within(painel).getByLabelText('Descrição'), 'Academia')
    await u.click(within(painel).getByRole('button', { name: 'Criar lançamento fixo' }))
    expect(within(painel).getByText(/O "até" não pode ser antes da data/)).toBeTruthy()
    expect(mock.criarRecorrencia).not.toHaveBeenCalled()
  })
})


describe('lançamento parcelado fora do cartão', () => {
  async function preencher(u: ReturnType<typeof userEvent.setup>, valor: string) {
    await abrirNovo(u)
    const painel = screen.getByRole('dialog')
    await u.type(within(painel).getByLabelText('Descrição'), 'Sofá')
    await u.type(within(painel).getByLabelText('Valor (R$)'), valor)
    await u.selectOptions(within(painel).getByLabelText('Categoria'), 'mer')
    fireEvent.change(within(painel).getByLabelText('Data'), { target: { value: '2026-01-31' } })
    await u.click(within(painel).getByRole('button', { name: /Repetir/ }))
    await u.click(within(painel).getByRole('radio', { name: 'Lançamento parcelado' }))
    return painel
  }

  it('prévia com a sobra na primeira; envia ao banco o total, as parcelas e o período, sem criar lançamento solto', async () => {
    const u = userEvent.setup()
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    const painel = await preencher(u, '10,00')
    const parcelas = within(painel).getByRole('spinbutton', { name: 'Parcelas' })
    await u.clear(parcelas)
    await u.type(parcelas, '3')
    expect(within(painel).getByRole('combobox', { name: 'Período de lançamento' }).querySelectorAll('option').length).toBe(8)
    expect(within(painel).getByTestId('previa-parcelas').textContent).toMatch(/3 parcelas de R\$ 3,33 \(a primeira de R\$ 3,34/)
    await u.selectOptions(within(painel).getByRole('combobox', { name: 'Período de lançamento' }), 'dias')
    await u.click(within(painel).getByRole('button', { name: 'Lançar parcelas' }))
    await waitFor(() => expect(mock.criarParcelado).toHaveBeenCalled())
    expect(mock.criarParcelado.mock.calls[0][0]).toMatchObject({
      tipo: 'expense', descricao: 'Sofá', total: 1000, parcelas: 3, unidade: 'day', cada: 1, primeira: '2026-01-31',
      contaId: 'a1', destinoId: null, categoriaId: 'mer', primeiraPaga: true,
    })
    expect(mock.criarLancamento).not.toHaveBeenCalled()
    expect(mock.criarRecorrencia).not.toHaveBeenCalled()
  })

  it('valida 2 a 360 parcelas e valor que caiba', async () => {
    const u = userEvent.setup()
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    const painel = await preencher(u, '0,02')
    const parcelas = within(painel).getByRole('spinbutton', { name: 'Parcelas' })
    await u.clear(parcelas)
    await u.type(parcelas, '1')
    await u.click(within(painel).getByRole('button', { name: 'Lançar parcelas' }))
    expect(within(painel).getByText('De 2 a 360 parcelas.')).toBeTruthy()
    await u.clear(parcelas)
    await u.type(parcelas, '3')
    await u.click(within(painel).getByRole('button', { name: 'Lançar parcelas' }))
    expect(within(painel).getByText('Valor pequeno demais para tantas parcelas.')).toBeTruthy()
    expect(mock.criarParcelado).not.toHaveBeenCalled()
  })

  it('lançamento fixo agora tem "Diária"', async () => {
    const u = userEvent.setup()
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    await abrirNovo(u)
    const painel = screen.getByRole('dialog')
    await u.click(within(painel).getByRole('button', { name: /Repetir/ }))
    expect(within(within(painel).getByRole('combobox', { name: 'Repetir' })).getByRole('option', { name: 'Diária' })).toBeTruthy()
  })
})

})

describe('multimoeda F2 (migration 056)', () => {
  const dolar = { id: 'a3', nome: 'Conta em dólar', tipo: 'checking', saldoInicial: c(0), abertura: '2026-10-01', ativa: true, saldo: c(0), moeda: 'USD' }
  const dolar2 = { ...dolar, id: 'a4', nome: 'Reserva em dólar' }
  const euro = { ...dolar, id: 'a5', nome: 'Conta em euro', moeda: 'EUR' }
  /** "US$ 40,25" com o espaço do Intl (NBSP ou espaço comum, conforme o ambiente). */
  const usd = (texto: string) => new RegExp(`^${texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(' ', '[\\s\\u00a0]')}$`)

  it('conta em dólar aparece como conta do lançamento, o valor mostra US$ e grava na conta escolhida', async () => {
    mock.listarContas.mockResolvedValue({ contas: [...contas, dolar], total: c(0) })
    const u = userEvent.setup()
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    await abrirNovo(u)
    const opcoes = Array.from((screen.getByLabelText('Conta') as HTMLSelectElement).options).map((o) => o.textContent)
    expect(opcoes).toEqual(['Itaú', 'Nubank', 'Conta em dólar'])
    await u.selectOptions(screen.getByLabelText('Conta'), 'a3')
    await u.type(screen.getByLabelText('Valor (US$)'), '40,25')
    await u.type(screen.getByLabelText('Descrição'), 'Café')
    await u.selectOptions(screen.getByLabelText('Categoria'), 'mer')
    await u.click(screen.getByRole('button', { name: 'Registrar despesa' }))
    expect(mock.criarLancamento).toHaveBeenCalledWith('h1', expect.objectContaining({ tipo: 'expense', contaId: 'a3', valor: 4025 }))
  })

  it('transferência: o destino só oferece contas da moeda da origem; trocar a origem limpa o destino de outra moeda', async () => {
    mock.listarContas.mockResolvedValue({ contas: [...contas, dolar, dolar2, euro], total: c(0) })
    const u = userEvent.setup()
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    await abrirNovo(u)
    await u.click(screen.getByRole('radio', { name: 'Transferência' }))
    const destinos = () => Array.from((screen.getByLabelText('Para a conta') as HTMLSelectElement).options).map((o) => o.textContent)
    expect(destinos()).toEqual(['Escolher', 'Nubank'])
    await u.selectOptions(screen.getByLabelText('Da conta'), 'a3')
    expect(destinos()).toEqual(['Escolher', 'Reserva em dólar'])
    await u.selectOptions(screen.getByLabelText('Para a conta'), 'a4')
    await u.selectOptions(screen.getByLabelText('Da conta'), 'a1')
    expect((screen.getByLabelText('Para a conta') as HTMLSelectElement).value).toBe('')
    await u.selectOptions(screen.getByLabelText('Da conta'), 'a3')
    await u.selectOptions(screen.getByLabelText('Para a conta'), 'a4')
    await u.type(screen.getByLabelText('Valor (US$)'), '50')
    await u.click(screen.getByRole('button', { name: 'Registrar transferência' }))
    expect(mock.criarLancamento).toHaveBeenCalledWith('h1', expect.objectContaining({ tipo: 'transfer', contaId: 'a3', destinoId: 'a4', valor: 5000 }))
  })

  it('a lista mostra o valor na moeda da conta e o bloco "Em outras moedas" vem do banco, fora dos totais em reais', async () => {
    mock.listarContas.mockResolvedValue({ contas: [...contas, dolar], total: c(0) })
    mock.listarLancamentos.mockResolvedValue([
      ...lancs,
      { id: 't9', tipo: 'expense', contaId: 'a3', destinoId: null, categoriaId: 'mer', descricao: 'Café em NY', valor: c(4025), data: '2026-10-16', status: 'paid', notas: '' },
    ])
    mock.resumoPorMoeda.mockResolvedValue([{ moeda: 'USD', receitas: c(100000), despesas: c(4025), resultado: c(95975) }])
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    const linha = (await screen.findByText('Café em NY')).closest('li') as HTMLElement
    expect(within(linha).getByText(usd('−US$ 40,25'))).toBeTruthy()
    // o total em reais continua o do banco (period_summary), sem o dólar
    expect(screen.getAllByText('−R$ 250,50').length).toBe(2)
    const bloco = screen.getByRole('group', { name: 'Em outras moedas' })
    expect(within(bloco).getByText(usd('+US$ 1.000,00'))).toBeTruthy()
    expect(within(bloco).getByText(usd('−US$ 40,25'))).toBeTruthy()
    expect(within(bloco).getByText(usd('= US$ 959,75'))).toBeTruthy()
    expect(mock.resumoPorMoeda).toHaveBeenCalledWith('h1', expect.any(String), expect.any(String))
  })

  it('sem movimento em outra moeda, o bloco não aparece', async () => {
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    await screen.findByText('Supermercado')
    expect(screen.queryByRole('group', { name: 'Em outras moedas' })).toBeNull()
  })
})

describe('editar um lançamento recorrente pergunta "Apenas este / Este e os próximos" (#193)', () => {
  const luz = { id: 'r1', tipo: 'expense', contaId: 'a1', destinoId: null, categoriaId: 'mer', descricao: 'Luz', valor: c(10000), data: '2026-10-10', status: 'planned', notas: '', recorrente: true }

  async function editar(l: Record<string, unknown>) {
    mock.listarLancamentos.mockResolvedValue([l])
    const u = userEvent.setup()
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    const item = (await screen.findByText(l.descricao as string)).closest('li') as HTMLElement
    await u.click(within(item).getByRole('button', { name: `Ações de ${l.descricao as string}` }))
    await u.click(within(item).getByRole('menuitem', { name: 'Editar' }))
    return u
  }
  async function mudarValorESalvar(u: ReturnType<typeof userEvent.setup>) {
    await u.clear(screen.getByLabelText('Valor (R$)'))
    await u.type(screen.getByLabelText('Valor (R$)'), '120,00')
    await u.click(screen.getByRole('button', { name: 'Salvar alterações' }))
  }

  it('mudou o valor: pergunta antes de gravar, com o foco no botão principal e nada gravado ainda', async () => {
    const u = await editar(luz)
    await mudarValorESalvar(u)
    const dialogo = await screen.findByRole('dialog', { name: 'Lançamento recorrente' })
    expect(within(dialogo).getByText('Este lançamento se repete em outras datas. O que deseja fazer?')).toBeTruthy()
    expect(within(dialogo).getAllByRole('button').map((b) => b.textContent))
      .toEqual(['×', 'Atualizar apenas este', 'Este e os próximos', 'Cancelar'])
    expect(document.activeElement).toBe(within(dialogo).getByRole('button', { name: 'Atualizar apenas este' }))
    expect(mock.editarLancamento).not.toHaveBeenCalled()
    expect(mock.editarEsteEProximos).not.toHaveBeenCalled()
  })

  it('"Atualizar apenas este" grava só o lançamento (o caminho de sempre)', async () => {
    const u = await editar(luz)
    await mudarValorESalvar(u)
    await u.click(await screen.findByRole('button', { name: 'Atualizar apenas este' }))
    await waitFor(() => expect(mock.editarLancamento).toHaveBeenCalledWith('r1', expect.objectContaining({ valor: 12000, data: '2026-10-10' })))
    expect(mock.editarEsteEProximos).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Salvar alterações' })).toBeNull())
  })

  it('"Este e os próximos" chama o banco para a regra (e não o UPDATE solto)', async () => {
    const u = await editar(luz)
    fireEvent.change(screen.getByLabelText('Data'), { target: { value: '2026-10-15' } })
    await mudarValorESalvar(u)
    await u.click(await screen.findByRole('button', { name: 'Este e os próximos' }))
    await waitFor(() => expect(mock.editarEsteEProximos).toHaveBeenCalledWith('r1', expect.objectContaining({ valor: 12000, data: '2026-10-15', categoriaId: 'mer' })))
    expect(mock.editarLancamento).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Salvar alterações' })).toBeNull())
  })

  it('Cancelar e Esc não gravam nada e voltam ao formulário com o que foi digitado', async () => {
    const u = await editar(luz)
    await mudarValorESalvar(u)
    await u.click(within(await screen.findByRole('dialog', { name: 'Lançamento recorrente' })).getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByRole('dialog', { name: 'Lançamento recorrente' })).toBeNull()
    expect((screen.getByLabelText('Valor (R$)') as HTMLInputElement).value).toBe('120,00')
    await u.click(screen.getByRole('button', { name: 'Salvar alterações' }))
    await screen.findByRole('dialog', { name: 'Lançamento recorrente' })
    await u.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Lançamento recorrente' })).toBeNull()
    // o Esc fecha só a pergunta: o formulário continua aberto
    expect(screen.getByRole('button', { name: 'Salvar alterações' })).toBeTruthy()
    expect(mock.editarLancamento).not.toHaveBeenCalled()
    expect(mock.editarEsteEProximos).not.toHaveBeenCalled()
  })

  it('só a situação ou a observação mudou: não pergunta', async () => {
    const u = await editar(luz)
    await u.click(screen.getByRole('radio', { name: 'Pago' }))
    await u.click(screen.getByRole('button', { name: 'Salvar alterações' }))
    await waitFor(() => expect(mock.editarLancamento).toHaveBeenCalledWith('r1', expect.objectContaining({ status: 'paid', valor: 10000 })))
    expect(screen.queryByRole('dialog', { name: 'Lançamento recorrente' })).toBeNull()
    expect(mock.editarEsteEProximos).not.toHaveBeenCalled()
  })

  it('lançamento que não é de recorrente: não pergunta', async () => {
    const u = await editar({ ...luz, id: 's1', descricao: 'Avulso', recorrente: false })
    await mudarValorESalvar(u)
    await waitFor(() => expect(mock.editarLancamento).toHaveBeenCalledWith('s1', expect.objectContaining({ valor: 12000 })))
    expect(screen.queryByRole('dialog', { name: 'Lançamento recorrente' })).toBeNull()
  })

  it('erro do banco em "Este e os próximos" aparece no formulário, que continua aberto', async () => {
    mock.editarEsteEProximos.mockRejectedValue({ code: '22023', message: 'a nova data precisa ficar depois da ocorrência anterior deste recorrente' })
    const u = await editar(luz)
    await mudarValorESalvar(u)
    await u.click(await screen.findByRole('button', { name: 'Este e os próximos' }))
    expect(await screen.findByText(/nova data precisa ficar depois da ocorrência anterior/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Salvar alterações' })).toBeTruthy()
  })
})
