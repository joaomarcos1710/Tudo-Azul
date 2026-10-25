// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { Cents } from '../lib/format'

const mock = vi.hoisted(() => ({
  listarLancamentos: vi.fn(),
  listarMovimentosDeDivida: vi.fn(),
  listarComprasDeCartao: vi.fn(),
  listarCartoes: vi.fn(),
  registrarCompra: vi.fn(),
  resumoDoMes: vi.fn(),
  criarLancamento: vi.fn(),
  editarLancamento: vi.fn(),
  marcarComoPago: vi.fn(),
  moverParaLixeira: vi.fn(),
  restaurarDaLixeira: vi.fn(),
  listarContas: vi.fn(),
  listarCategorias: vi.fn(),
}))
vi.mock('../lib/automaticos', () => ({ atualizarAutomaticos: () => Promise.resolve() }))
vi.mock('../lib/FamiliaContext', () => ({
  useFamilia: () => ({ familia: { id: 'h1', nome: 'Casa', papel: 'owner' }, carregando: false, erro: false, recarregar: vi.fn() }),
}))
vi.mock('../lib/lancamentos', async (original) => ({
  ...(await original<typeof import('../lib/lancamentos')>()),
  listarLancamentos: mock.listarLancamentos,
  listarMovimentosDeDivida: mock.listarMovimentosDeDivida,
  listarComprasDeCartao: mock.listarComprasDeCartao,
  resumoDoMes: mock.resumoDoMes,
  criarLancamento: mock.criarLancamento,
  editarLancamento: mock.editarLancamento,
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
  registrarCompra: mock.registrarCompra,
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
  mock.listarContas.mockResolvedValue({ contas, total: c(0) })
  mock.listarCategorias.mockResolvedValue(categorias)
  mock.listarLancamentos.mockResolvedValue(lancs)
  mock.listarMovimentosDeDivida.mockResolvedValue([])
  mock.listarComprasDeCartao.mockResolvedValue({ parcelas: [], semData: 0 })
  mock.listarCartoes.mockResolvedValue([
    { id: 'k1', nome: 'Nubank', fechamento: 17, vencimento: 25, ativo: true, divida: c(0), credito: c(0), compromissos: c(0) },
  ])
  mock.registrarCompra.mockResolvedValue(undefined)
  mock.resumoDoMes.mockResolvedValue({ receitas: c(0), despesas: c(25050), resultado: c(-25050), receitasPrevistas: c(800000), despesasPrevistas: c(0) })
  for (const f of [mock.criarLancamento, mock.editarLancamento, mock.marcarComoPago, mock.moverParaLixeira, mock.restaurarDaLixeira]) f.mockResolvedValue(undefined)
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

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
    expect(screen.getByText('+R$ 8.000,00')).toBeTruthy()
    expect(screen.getByText('⇄ R$ 100,00')).toBeTruthy()
    expect(screen.getByText('Itaú → Nubank')).toBeTruthy()
    expect(screen.getByText('Mercado · Itaú')).toBeTruthy()
    expect(screen.getByText('Planejado')).toBeTruthy()
    expect(screen.getByRole('region', { name: '15/10/2026' })).toBeTruthy()
  })

  it('lança despesa em centavos, com categoria e status pago para hoje', async () => {
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    const u = userEvent.setup()
    await screen.findByText('Supermercado')
    await u.click(screen.getAllByRole('button', { name: 'Novo lançamento' })[0])
    await u.type(screen.getByLabelText('Valor (R$)'), '1.234,56')
    await u.type(screen.getByLabelText('Descrição'), 'Feira')
    await u.selectOptions(screen.getByLabelText('Categoria'), 'mer')
    await u.click(screen.getByRole('button', { name: 'Lançar' }))
    expect(mock.criarLancamento).toHaveBeenCalledWith('h1', {
      tipo: 'expense', contaId: 'a1', destinoId: null, categoriaId: 'mer', descricao: 'Feira',
      valor: 123456, data: hojeSP(), status: 'paid', notas: '',
    })
  })

  it('não lança sem categoria nem valor válido', async () => {
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    const u = userEvent.setup()
    await screen.findByText('Supermercado')
    await u.click(screen.getAllByRole('button', { name: 'Novo lançamento' })[0])
    await u.type(screen.getByLabelText('Valor (R$)'), '1.2.3')
    await u.click(screen.getByRole('button', { name: 'Lançar' }))
    expect(screen.getByText(/Informe um valor maior que zero/)).toBeTruthy()
    expect(screen.getByText('Escolha a categoria.')).toBeTruthy()
    expect(mock.criarLancamento).not.toHaveBeenCalled()
  })

  it('transferência exige destino diferente e não leva categoria', async () => {
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    const u = userEvent.setup()
    await screen.findByText('Supermercado')
    await u.click(screen.getAllByRole('button', { name: 'Novo lançamento' })[0])
    await u.click(screen.getByRole('radio', { name: 'Transferência' }))
    await u.type(screen.getByLabelText('Valor (R$)'), '100')
    await u.selectOptions(screen.getByLabelText('Para a conta'), 'a2')
    await u.click(screen.getByRole('button', { name: 'Lançar' }))
    expect(mock.criarLancamento).toHaveBeenCalledWith('h1', expect.objectContaining({
      tipo: 'transfer', contaId: 'a1', destinoId: 'a2', categoriaId: null, valor: 10000,
    }))
  })

  it('data futura vira planejado por padrão', async () => {
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    const u = userEvent.setup()
    await screen.findByText('Supermercado')
    await u.click(screen.getAllByRole('button', { name: 'Novo lançamento' })[0])
    const data = screen.getByLabelText('Data')
    await u.clear(data)
    await u.type(data, '2099-01-10')
    expect((screen.getByRole('radio', { name: 'Planejado' }) as HTMLInputElement).checked).toBe(true)
  })

  it('avisa quando a data é anterior ao saldo inicial da conta', async () => {
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    const u = userEvent.setup()
    await screen.findByText('Supermercado')
    await u.click(screen.getAllByRole('button', { name: 'Novo lançamento' })[0])
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
    await u.click(within(item).getByRole('button', { name: 'Excluir' }))
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
    await u.click(screen.getAllByRole('button', { name: 'Novo lançamento' })[0])
    await u.type(screen.getByLabelText('Valor (R$)'), '10')
    await u.selectOptions(screen.getByLabelText('Categoria'), 'mer')
    await u.click(screen.getByRole('button', { name: 'Lançar' }))
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
    await u.click(await screen.findByRole('button', { name: 'Novo lançamento' }))
    await u.click(screen.getByRole('radio', { name: 'Cartão de crédito' }))
    expect(screen.queryByLabelText('Conta')).toBeNull()
    expect(screen.queryByRole('group', { name: 'Situação' })).toBeNull()
    await u.type(screen.getByLabelText('Valor (R$)'), '300,00')
    await u.type(screen.getByLabelText('Descrição'), 'Fone')
    await u.selectOptions(screen.getByLabelText('Cartão'), 'k1')
    await u.clear(screen.getByLabelText('Parcelas'))
    await u.type(screen.getByLabelText('Parcelas'), '3')
    await u.selectOptions(screen.getByLabelText('Categoria'), 'mer')
    await u.click(screen.getByRole('button', { name: 'Lançar' }))
    expect(mock.registrarCompra).toHaveBeenCalledWith('k1',
      expect.objectContaining({ descricao: 'Fone', total: 30000, parcelas: 3, categoriaId: 'mer' }), expect.any(String))
    expect(mock.criarLancamento).not.toHaveBeenCalled()
  })

  it('cartão: parcela fora de 1 a 72 e cartão não escolhido não chamam o banco', async () => {
    const u = userEvent.setup()
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    await u.click(await screen.findByRole('button', { name: 'Novo lançamento' }))
    await u.click(screen.getByRole('radio', { name: 'Cartão de crédito' }))
    await u.type(screen.getByLabelText('Valor (R$)'), '50,00')
    await u.type(screen.getByLabelText('Descrição'), 'Pão')
    await u.clear(screen.getByLabelText('Parcelas'))
    await u.type(screen.getByLabelText('Parcelas'), '0')
    await u.click(screen.getByRole('button', { name: 'Lançar' }))
    expect(screen.getByText('Escolha o cartão.')).toBeTruthy()
    expect(screen.getByText('De 1 a 72 parcelas.')).toBeTruthy()
    expect(mock.registrarCompra).not.toHaveBeenCalled()
  })

  it('compra no cartão aparece na lista do mês com o cartão, sem editar nem excluir aqui', async () => {
    mock.listarComprasDeCartao.mockResolvedValue({ semData: 0, parcelas: [
      { id: 'p2', data: `${hojeSP().slice(0, 8)}02`, compra: '2026-01-02', descricao: 'Fone', cartaoNome: 'Nubank', fechamento: 17, parcela: 2, deParcelas: 3, valor: c(10000) },
    ] })
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    const item = (await screen.findByText('Fone')).closest('li') as HTMLElement
    expect(within(item).getByText('No cartão')).toBeTruthy()
    expect(within(item).getByText(/parcela 2\/3/)).toBeTruthy()
    expect(within(item).getByText(/Nubank · compra de 02\/01\/2026 · a despesa conta quando a fatura fechar \(dia 17\)/)).toBeTruthy()
    expect(within(item).getByText('R$ 100,00')).toBeTruthy()
    expect(within(item).queryByRole('button', { name: 'Excluir' })).toBeNull()
    expect(within(item).queryByRole('button', { name: 'Editar' })).toBeNull()
  })

  it('se as compras no cartão falharem, a lista de conta continua e só o bloco avisa', async () => {
    mock.listarComprasDeCartao.mockRejectedValue(new Error('falhou'))
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    expect(await screen.findByText('Supermercado')).toBeTruthy()
    expect(screen.getByText(/Não foi possível carregar as compras no cartão/)).toBeTruthy()
  })

  it('se os cartões falharem, contas e lançamentos continuam na tela', async () => {
    mock.listarCartoes.mockRejectedValue(new Error('falhou'))
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    expect(await screen.findByText('Supermercado')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Novo lançamento' })).toBeTruthy()
  })

  it('avisa quando há parcelas antigas sem data de compra', async () => {
    mock.listarComprasDeCartao.mockResolvedValue({ parcelas: [], semData: 2 })
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    expect(await screen.findByText(/2 parcelas de cartão sem data de compra não aparecem aqui/)).toBeTruthy()
  })

  it('reenvio do mesmo cartão com outro valor usa outra chave (não grava 100 quando o usuário corrigiu para 120)', async () => {
    const u = userEvent.setup()
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    await u.click(await screen.findByRole('button', { name: 'Novo lançamento' }))
    await u.click(screen.getByRole('radio', { name: 'Cartão de crédito' }))
    await u.type(screen.getByLabelText('Valor (R$)'), '100,00')
    await u.type(screen.getByLabelText('Descrição'), 'Fone')
    await u.selectOptions(screen.getByLabelText('Cartão'), 'k1')
    await u.selectOptions(screen.getByLabelText('Categoria'), 'mer')
    mock.registrarCompra.mockRejectedValueOnce(new Error('failed to fetch'))
    await u.click(screen.getByRole('button', { name: 'Lançar' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    const valor = screen.getByLabelText('Valor (R$)')
    await u.clear(valor)
    await u.type(valor, '120,00')
    await u.click(screen.getByRole('button', { name: 'Lançar' }))
    const [, , chave1] = mock.registrarCompra.mock.calls[0]
    const [, dados2, chave2] = mock.registrarCompra.mock.calls[1]
    expect(dados2.total).toBe(12000)
    expect(chave2).not.toBe(chave1)
  })

  it('reenvio com o mesmo conteúdo usa a mesma chave (não duplica a compra)', async () => {
    const u = userEvent.setup()
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    await u.click(await screen.findByRole('button', { name: 'Novo lançamento' }))
    await u.click(screen.getByRole('radio', { name: 'Cartão de crédito' }))
    await u.type(screen.getByLabelText('Valor (R$)'), '100,00')
    await u.type(screen.getByLabelText('Descrição'), 'Fone')
    await u.selectOptions(screen.getByLabelText('Cartão'), 'k1')
    await u.selectOptions(screen.getByLabelText('Categoria'), 'mer')
    mock.registrarCompra.mockRejectedValueOnce(new Error('failed to fetch'))
    await u.click(screen.getByRole('button', { name: 'Lançar' }))
    await screen.findByRole('alert')
    await u.click(screen.getByRole('button', { name: 'Lançar' }))
    expect(mock.registrarCompra.mock.calls[0][2]).toBe(mock.registrarCompra.mock.calls[1][2])
  })

  it('trocar para cartão limpa a categoria de receita (não manda categoria de outro tipo)', async () => {
    const u = userEvent.setup()
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    await u.click(await screen.findByRole('button', { name: 'Novo lançamento' }))
    await u.click(screen.getByRole('radio', { name: 'Receita' }))
    await u.selectOptions(screen.getByLabelText('Categoria'), 'sal')
    await u.click(screen.getByRole('radio', { name: 'Cartão de crédito' }))
    expect((screen.getByLabelText('Categoria') as HTMLSelectElement).value).toBe('')
  })
})
