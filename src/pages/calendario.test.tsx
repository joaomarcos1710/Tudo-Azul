// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { Cents } from '../lib/format'

const mock = vi.hoisted(() => ({
  listarLancamentos: vi.fn(),
  listarMovimentosDeDivida: vi.fn(),
  resumoDoMes: vi.fn(),
  resumoPorMoeda: vi.fn(),
  listarContas: vi.fn(),
  listarCategorias: vi.fn(),
  atualizarAutomaticos: vi.fn(),
  saldosProjetados: vi.fn(),
  faturasQueVencem: vi.fn(),
  listarParcelasDivida: vi.fn(),
  totaisDoDia: vi.fn(),
}))
vi.mock('../lib/FamiliaContext', () => ({
  useFamilia: () => ({ familia: { id: 'h1', nome: 'Casa', papel: 'owner' }, carregando: false, erro: false, recarregar: vi.fn() }),
}))
vi.mock('../lib/saldoProjetado', () => ({ saldosProjetados: mock.saldosProjetados, faturasQueVencem: mock.faturasQueVencem, totaisDoDia: mock.totaisDoDia }))
vi.mock('../lib/dividas', async (o) => ({ ...(await o<typeof import('../lib/dividas')>()), listarParcelasDivida: mock.listarParcelasDivida }))
vi.mock('../lib/automaticos', () => ({ atualizarAutomaticos: mock.atualizarAutomaticos }))
vi.mock('../lib/categorias', async (o) => ({ ...(await o<typeof import('../lib/categorias')>()), listarCategorias: mock.listarCategorias }))
vi.mock('../lib/contas', async (o) => ({ ...(await o<typeof import('../lib/contas')>()), listarContas: mock.listarContas }))
vi.mock('../lib/lancamentos', async (o) => ({
  ...(await o<typeof import('../lib/lancamentos')>()),
  listarLancamentos: mock.listarLancamentos, listarMovimentosDeDivida: mock.listarMovimentosDeDivida, resumoDoMes: mock.resumoDoMes,
  resumoPorMoeda: mock.resumoPorMoeda,
}))

import Calendario from './Calendario'
import { definirValoresOcultos } from '../lib/privacidade'

const c = (n: number) => n as Cents
const listaDoDia = () => screen.getByRole('list', { name: 'O que entra e sai no dia' })
const montar = (url = '/calendario') => render(<MemoryRouter initialEntries={[url]}><Calendario /></MemoryRouter>)
const lanc = (id: string, data: string, tipo: 'income' | 'expense' | 'transfer', valor: number, status: 'paid' | 'planned', descricao: string) => ({
  id, tipo, contaId: 'a1', destinoId: tipo === 'transfer' ? 'a2' : null, categoriaId: tipo === 'transfer' ? null : 'g1',
  descricao, valor: c(valor), data, status, notas: '', recorrenciaId: null,
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-16T15:00:00Z')) // 12h de 16/10/2026 em São Paulo
  mock.atualizarAutomaticos.mockResolvedValue({ recorrentesOk: true, faturasOk: true })
  mock.faturasQueVencem.mockResolvedValue([])
  mock.listarParcelasDivida.mockResolvedValue([])
  // totais de cada dia como o banco devolveria para os lançamentos abaixo (a tela não soma: só mostra)
  mock.totaisDoDia.mockResolvedValue([
    { data: '2026-10-05', moeda: 'BRL', entradas: c(800000), saidas: c(18740), faturasEParcelas: c(0) },
    { data: '2026-10-10', moeda: 'BRL', entradas: c(0), saidas: c(133334), faturasEParcelas: c(133334) },
    { data: '2026-10-25', moeda: 'BRL', entradas: c(0), saidas: c(12000), faturasEParcelas: c(0) },
  ])
  mock.saldosProjetados.mockResolvedValue({
    contas: [
      { id: 'a1', nome: 'Itaú', ativa: true, efetuado: c(100000), planejado: c(-5000), faturas: c(20000), saldo: c(75000) },
      { id: 'a2', nome: 'Poupança', ativa: true, efetuado: c(50000), planejado: c(0), faturas: c(0), saldo: c(50000) },
    ],
    total: { efetuado: c(150000), planejado: c(-5000), faturas: c(30000), faturasSemConta: c(10000), saldo: c(115000) },
  })
  mock.listarLancamentos.mockResolvedValue([
    lanc('l1', '2026-10-05', 'income', 800000, 'paid', 'Salário'),
    lanc('l2', '2026-10-05', 'expense', 18740, 'paid', 'Conta de luz'),
    lanc('l3', '2026-10-25', 'expense', 12000, 'planned', 'Internet'),
    lanc('l4', '2026-10-12', 'transfer', 50000, 'paid', 'Guardar'),
  ])
  mock.listarMovimentosDeDivida.mockResolvedValue([
    { id: 'e1', data: '2026-10-10', contaId: 'a1', descricao: 'Pagamento de Nubank', valor: c(-133334), jaEmDespesas: false, parcela: true },
  ])
  mock.listarContas.mockResolvedValue({
    contas: [
      { id: 'a1', nome: 'Itaú', tipo: 'checking', saldoInicial: c(0), abertura: '2026-01-01', ativa: true, saldo: c(0) },
      { id: 'a2', nome: 'Poupança', tipo: 'savings', saldoInicial: c(0), abertura: '2026-01-01', ativa: true, saldo: c(0) },
    ],
    total: c(0),
  })
  mock.listarCategorias.mockResolvedValue([{ id: 'g1', nome: 'Moradia', tipo: 'expense', paiId: null, sistema: false, ativa: true, eventual: false }])
  mock.resumoDoMes.mockResolvedValue({ receitas: c(800000), despesas: c(18740), resultado: c(781260), receitasPrevistas: c(0), despesasPrevistas: c(12000) })
  mock.resumoPorMoeda.mockResolvedValue([])
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe('Calendário', () => {
  it('consulta de apoio que falha NÃO vira calendário sem faturas, parcelas ou totais: aparece o aviso dizendo o que faltou', async () => {
    mock.faturasQueVencem.mockRejectedValue(new Error('falhou'))
    mock.resumoDoMes.mockRejectedValue(new Error('falhou'))
    montar()
    const aviso = await screen.findByTestId('calendario-blocos-falharam')
    expect(aviso.textContent).toContain('faturas')
    expect(aviso.textContent).toContain('totais do mês')
    expect(aviso.textContent).not.toContain('parcelas de dívida')
    expect(screen.queryByLabelText('Totais do mês')).toBeNull()
  })

  it('tudo carregado: nenhum aviso de bloco que falhou', async () => {
    montar()
    await screen.findByText('Outubro de 2026')
    expect(screen.queryByTestId('calendario-blocos-falharam')).toBeNull()
  })

  it('abre no mês de hoje, com os 31 dias de outubro, hoje marcado e selecionado', async () => {
    montar()
    expect(await screen.findByRole('heading', { name: 'Outubro de 2026' })).toBeTruthy()
    const grade = screen.getByRole('group', { name: 'Dias de Outubro de 2026' })
    expect(within(grade).getAllByRole('button')).toHaveLength(31)
    const hoje = within(grade).getByRole('button', { name: /^16 de outubro de 2026, hoje: nada$/ })
    expect(hoje.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('16/10/2026 · hoje')).toBeTruthy()
    expect(screen.getByText('Nada neste dia.')).toBeTruthy()
    expect(mock.listarLancamentos).toHaveBeenCalledWith('h1', '2026-10')
  })

  it('cada dia diz quantos lançamentos e quantos planejados tem', async () => {
    montar()
    await screen.findByRole('heading', { name: 'Outubro de 2026' })
    expect(screen.getByRole('button', { name: '5 de outubro de 2026: 2 lançamentos' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '25 de outubro de 2026: 1 lançamento, 1 planejado' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '10 de outubro de 2026: 1 lançamento' })).toBeTruthy() // pagamento da fatura
    expect(screen.getByRole('button', { name: '1 de outubro de 2026: nada' })).toBeTruthy()
  })

  it('ao tocar no dia, mostra cada lançamento com o seu valor e se está pago ou planejado', async () => {
    const u = userEvent.setup()
    montar()
    await u.click(await screen.findByRole('button', { name: '5 de outubro de 2026: 2 lançamentos' }))
    expect(screen.getByText('05/10/2026')).toBeTruthy()
    const lista = listaDoDia()
    expect(within(lista).getAllByRole('listitem')).toHaveLength(2)
    expect(within(lista).getByText('Salário')).toBeTruthy()
    expect(within(lista).getByText('+R$ 8.000,00')).toBeTruthy()
    expect(within(lista).getByText('Conta de luz')).toBeTruthy()
    expect(within(lista).getByText('−R$ 187,40')).toBeTruthy()
    expect(within(lista).getAllByText('Moradia · Itaú')).toHaveLength(2)
    // #183: entrada azul, saída vermelha e "Pago" azul ("está tudo certo")
    expect(within(lista).getByText('+R$ 8.000,00').className).toContain('text-lucro')
    expect(within(lista).getByText('−R$ 187,40').className).toContain('text-prejuizo')
    for (const pago of within(lista).getAllByText('Pago')) expect(pago.className).toContain('text-lucro')
    await u.click(screen.getByRole('button', { name: '25 de outubro de 2026: 1 lançamento, 1 planejado' }))
    const lista25 = listaDoDia()
    expect(within(lista25).getByText('Internet')).toBeTruthy()
    expect(within(lista25).getByText('Planejado')).toBeTruthy()
    expect(within(lista25).queryByText('Pago')).toBeNull()
    // #183: "Planejado" verde (agendado)
    expect(within(lista25).getByText('Planejado').className).toContain('text-agendado')
  })

  it('#183: legenda e marcas do dia na regra de cores: Entrou azul, Saiu vermelho, Planejado verde (com o texto dizendo que ainda não aconteceu)', async () => {
    montar()
    const dia5 = await screen.findByRole('button', { name: '5 de outubro de 2026: 2 lançamentos' })
    const marca = (rotulo: string) => (screen.getByText(rotulo, { exact: false }).closest('span') as HTMLElement).querySelector('span') as HTMLElement
    expect(marca('Entrou').className).toContain('bg-lucro-marca')
    expect(marca('Saiu').className).toContain('bg-prejuizo-marca')
    expect(marca('Planejado (ainda não aconteceu)').className).toContain('bg-agendado-marca')
    expect(dia5.querySelector('.bg-lucro-marca')).not.toBeNull()
    expect(dia5.querySelector('.bg-prejuizo-marca')).not.toBeNull()
    const dia25 = screen.getByRole('button', { name: '25 de outubro de 2026: 1 lançamento, 1 planejado' })
    expect(dia25.querySelector('.bg-agendado-marca')).not.toBeNull()
    // nenhuma marca usa mais o verde para "entrou"
    expect(document.querySelector('.bg-positivo, .bg-planejado')).toBeNull()
  })

  it('auditoria 5h: planejado com data passada é Vencido (traço e texto em vermelho de prejuízo), não o verde de planejado', async () => {
    mock.listarLancamentos.mockResolvedValue([
      lanc('l9', '2026-10-08', 'expense', 9000, 'planned', 'Academia'), // hoje é 16/10: já passou
      lanc('l3', '2026-10-25', 'expense', 12000, 'planned', 'Internet'),
    ])
    const u = userEvent.setup()
    montar()
    const dia8 = await screen.findByRole('button', { name: '8 de outubro de 2026: 1 lançamento, 1 vencido' })
    expect(dia8.querySelector('[data-traco="vencido"]')!.className).toContain('border-prejuizo-marca')
    expect(dia8.querySelector('.bg-agendado-marca')).toBeNull()
    expect(screen.getByRole('button', { name: '25 de outubro de 2026: 1 lançamento, 1 planejado' }).querySelector('[data-traco="vencido"]')).toBeNull()
    expect(screen.getByText('Vencido (planejado que passou da data)')).toBeTruthy()
    await u.click(dia8)
    const lista = listaDoDia()
    expect(within(lista).getByText('Vencido').className).toContain('text-prejuizo')
    expect(within(lista).queryByText('Planejado')).toBeNull()
  })

  it('auditoria 5h: os botões de saldo e o "Ver em Lançamentos" têm alvo de toque de 44px (min-h-11)', async () => {
    montar()
    expect((await screen.findByRole('button', { name: 'Só efetuados' })).className).toContain('min-h-11')
    expect(screen.getByRole('button', { name: 'Efetuados + planejados' }).className).toContain('min-h-11')
    expect(screen.getByRole('link', { name: 'Ver em Lançamentos' }).className).toContain('min-h-11')
  })

  it('pagamento de fatura aparece como saída da conta no dia; transferência aparece sem sinal de receita ou despesa', async () => {
    const u = userEvent.setup()
    montar()
    await u.click(await screen.findByRole('button', { name: '10 de outubro de 2026: 1 lançamento' }))
    expect(within(listaDoDia()).getByText('Pagamento de Nubank')).toBeTruthy()
    expect(within(listaDoDia()).getByText('−R$ 1.333,34')).toBeTruthy()
    await u.click(screen.getByRole('button', { name: '12 de outubro de 2026: 1 lançamento' }))
    expect(screen.getByText('Itaú → Poupança')).toBeTruthy()
    expect(screen.getByText('⇄ R$ 500,00')).toBeTruthy()
  })

  it('os totais do mês vêm do banco; a tela não soma nada por dia', async () => {
    const u = userEvent.setup()
    montar()
    const totais = await screen.findByRole('region', { name: 'Totais do mês' })
    expect(within(totais).getByText('+R$ 8.000,00')).toBeTruthy()
    expect(within(totais).getByText('−R$ 187,40')).toBeTruthy()
    expect(within(totais).getByText('R$ 7.812,60')).toBeTruthy()
    expect(mock.resumoDoMes).toHaveBeenCalledWith('h1', '2026-10')
    await u.click(screen.getByRole('button', { name: '5 de outubro de 2026: 2 lançamentos' }))
    // no dia 5 entram R$ 8.000,00 e saem R$ 187,40: nenhum "saldo do dia" é calculado na tela
    expect(screen.queryByText(/saldo do dia/i)).toBeNull()
    expect(screen.queryByText('R$ 7.812,60', { selector: 'li *' })).toBeNull()
  })

  it('navega entre os meses e limpa o dia escolhido fora do mês de hoje', async () => {
    const u = userEvent.setup()
    montar()
    await screen.findByRole('heading', { name: 'Outubro de 2026' })
    await u.click(screen.getByRole('button', { name: 'Próximo mês' }))
    expect(await screen.findByRole('heading', { name: 'Novembro de 2026' })).toBeTruthy()
    expect(mock.listarLancamentos).toHaveBeenLastCalledWith('h1', '2026-11')
    expect(await screen.findByText('Toque num dia para ver o que entra e sai.')).toBeTruthy()
    await u.click(screen.getByRole('button', { name: 'Mês anterior' }))
    await u.click(screen.getByRole('button', { name: 'Mês anterior' }))
    expect(await screen.findByRole('heading', { name: 'Setembro de 2026' })).toBeTruthy()
    expect(within(screen.getByRole('group', { name: 'Dias de Setembro de 2026' })).getAllByRole('button')).toHaveLength(30)
  })

  it('abre o mês pedido na URL (?mes=) e ignora valor inválido', async () => {
    montar('/calendario?mes=2028-02')
    expect(await screen.findByRole('heading', { name: 'Fevereiro de 2028' })).toBeTruthy()
    expect(within(screen.getByRole('group', { name: 'Dias de Fevereiro de 2028' })).getAllByRole('button')).toHaveLength(29) // bissexto
    cleanup()
    montar('/calendario?mes=2026-13')
    expect(await screen.findByRole('heading', { name: 'Outubro de 2026' })).toBeTruthy()
  })

  it('a semana começa na segunda: 01/10/2026 é quinta e ocupa a 4ª coluna', async () => {
    montar()
    const grade = await screen.findByRole('group', { name: 'Dias de Outubro de 2026' })
    // 7 cabeçalhos + 3 espaços vazios antes do dia 1
    const filhos = Array.from(grade.children)
    expect(filhos.slice(7, 10).every((f) => f.getAttribute('aria-hidden') === 'true' && f.textContent === '')).toBe(true)
    expect(filhos[10].getAttribute('aria-label')).toMatch(/^1 de outubro de 2026/)
  })

  it('erro do banco aparece na tela; falha só nas rotinas automáticas mostra aviso e segue', async () => {
    mock.listarLancamentos.mockRejectedValueOnce(Object.assign(new Error('x'), { code: '42501' }))
    montar()
    expect(await screen.findByText('Você não tem permissão para esta ação.')).toBeTruthy()
    cleanup()
    mock.atualizarAutomaticos.mockResolvedValueOnce({ recorrentesOk: false, faturasOk: true })
    montar()
    expect(await screen.findByText(/Não foi possível atualizar faturas e recorrentes agora/)).toBeTruthy()
    expect(await screen.findByRole('button', { name: '5 de outubro de 2026: 2 lançamentos' })).toBeTruthy()
  })

  it('o mês carrega sem esperar as tarefas automáticas, e trocar de mês não as repete', async () => {
    const u = userEvent.setup()
    let terminar: (v: unknown) => void = () => {}
    mock.atualizarAutomaticos.mockReset()
    mock.atualizarAutomaticos.mockReturnValue(new Promise((r) => { terminar = r }))
    montar()
    // as automáticas ainda não terminaram e o mês já está na tela
    expect(await screen.findByRole('button', { name: '5 de outubro de 2026: 2 lançamentos' })).toBeTruthy()
    await u.click(screen.getByRole('button', { name: 'Próximo mês' }))
    await screen.findByRole('heading', { name: 'Novembro de 2026' })
    expect(mock.atualizarAutomaticos).toHaveBeenCalledTimes(1)
    // se as automáticas gravaram algo, o mês recarrega
    const antes = mock.listarLancamentos.mock.calls.length
    terminar({ recorrentesOk: true, faturasOk: true, mudou: true })
    await vi.waitFor(() => expect(mock.listarLancamentos.mock.calls.length).toBe(antes + 1))
  })

  it('resposta atrasada do mês anterior não sobrescreve o mês novo', async () => {
    const u = userEvent.setup()
    let liberar: (v: unknown) => void = () => {}
    mock.listarLancamentos
      .mockImplementationOnce(() => new Promise((r) => { liberar = r }))
      .mockResolvedValueOnce([lanc('n1', '2026-11-03', 'expense', 1000, 'paid', 'Padaria')])
    montar()
    await screen.findByRole('heading', { name: 'Outubro de 2026' })
    await u.click(screen.getByRole('button', { name: 'Próximo mês' }))
    expect(await screen.findByRole('button', { name: '3 de novembro de 2026: 1 lançamento' })).toBeTruthy()
    liberar([lanc('l9', '2026-10-05', 'income', 1, 'paid', 'Velho')])
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.getByRole('button', { name: '3 de novembro de 2026: 1 lançamento' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /de outubro de 2026/ })).toBeNull()
  })
})

describe('Calendário: faturas e saldo projetado', () => {
  it('a fatura aparece no dia do vencimento como planejada, com a conta que paga', async () => {
    mock.faturasQueVencem.mockResolvedValue([
      { cartaoId: 'k1', cartao: 'Cartão Caixa', vencimento: '2026-10-28', total: c(43897), pago: c(0), falta: c(43897), contaPagamentoId: 'a1' },
    ])
    montar()
    const grade = await screen.findByRole('group', { name: 'Dias de Outubro de 2026' })
    await userEvent.setup().click(within(grade).getByRole('button', { name: /^28 de outubro de 2026/ }))
    const item = screen.getByText('Fatura Cartão Caixa').closest('li')!
    expect(item.textContent).toContain('paga com Itaú')
    expect(item.textContent).toContain('R$ 438,97')
    expect(item.textContent).toContain('Planejado')
    expect(mock.faturasQueVencem).toHaveBeenCalledWith('h1', '2026-10-01', '2026-10-31')
  })

  it('fatura sem conta de pagamento avisa; fatura já quitada não aparece de novo', async () => {
    mock.faturasQueVencem.mockResolvedValue([
      { cartaoId: 'k1', cartao: 'Cartão Caixa', vencimento: '2026-10-28', total: c(1000), pago: c(0), falta: c(1000), contaPagamentoId: null },
      { cartaoId: 'k2', cartao: 'Inter', vencimento: '2026-10-28', total: c(5000), pago: c(5000), falta: c(0), contaPagamentoId: 'a1' },
    ])
    montar()
    const grade = await screen.findByRole('group', { name: 'Dias de Outubro de 2026' })
    await userEvent.setup().click(within(grade).getByRole('button', { name: /^28 de outubro de 2026/ }))
    expect(screen.getByText('Fatura Cartão Caixa').closest('li')!.textContent).toContain('conta de pagamento não escolhida')
    expect(screen.queryByText('Fatura Inter')).toBeNull()
  })

  it('saldo numa linha só (total do banco), com a escolha entre só efetuados e efetuados + planejados', async () => {
    montar()
    const total = await screen.findByTestId('saldo-total')
    expect(total.textContent).toBe('R$ 1.150,00')
    expect(total.closest('p')!.textContent).toBe('Saldo previsto hoje: R$ 1.150,00')
    expect(screen.getByTestId('saldo-sem-conta').textContent).toContain('R$ 100,00 em faturas e parcelas sem conta')
    // migration 069: o previsto é o mesmo dos Relatórios, e a tela diz o que ele inclui
    expect(screen.getByTestId('saldo-o-que-inclui').textContent).toBe('Com os planejados, os lançamentos fixos ainda não gerados e as faturas com as assinaturas previstas, como nos Relatórios.')
    expect(mock.saldosProjetados).toHaveBeenCalledWith('h1', '2026-10-16', true)
    const u = userEvent.setup()
    await u.click(screen.getByRole('button', { name: 'Só efetuados' }))
    expect(mock.saldosProjetados).toHaveBeenLastCalledWith('h1', '2026-10-16', false)
    expect((await screen.findByTestId('saldo-total')).closest('p')!.textContent).toBe('Saldo hoje (só efetuados): R$ 1.150,00')
    expect(screen.queryByTestId('saldo-sem-conta')).toBeNull()
    expect(screen.queryByTestId('saldo-o-que-inclui')).toBeNull()
  })

  it('pedido do dono (05/11/2026): sem lista de saldo por conta nem detalhamento; o saldo por conta fica no Início', async () => {
    montar()
    const card = (await screen.findByTestId('saldo-total')).closest('[aria-label="Saldo na data escolhida"]') as HTMLElement
    expect(card).toBeTruthy()
    // as contas Itaú e Poupança vêm do banco em saldosProjetados, mas não são listadas aqui
    expect(within(card).queryByText('Itaú')).toBeNull()
    expect(within(card).queryByText('Poupança')).toBeNull()
    expect(within(card).queryByRole('list')).toBeNull()
    expect(card.textContent).not.toMatch(/Efetuado R\$|planejado [+−]/)
    expect(screen.queryByTestId('saldo-detalhe')).toBeNull()
  })

  it('sem fatura ou parcela sem conta, a linha de aviso não aparece', async () => {
    mock.saldosProjetados.mockResolvedValue({
      contas: [],
      total: { efetuado: c(0), planejado: c(0), faturas: c(0), faturasSemConta: c(0), saldo: c(-2500) },
    })
    montar()
    expect((await screen.findByTestId('saldo-total')).textContent).toBe('-R$ 25,00')
    expect(screen.queryByTestId('saldo-sem-conta')).toBeNull()
  })

  it('multimoeda F2: lançamento em conta USD aparece na moeda dela, o dia avisa e o resultado em dólar fica à parte', async () => {
    mock.listarContas.mockResolvedValue({
      contas: [
        { id: 'a1', nome: 'Itaú', tipo: 'checking', saldoInicial: c(0), abertura: '2026-01-01', ativa: true, saldo: c(0), moeda: 'BRL' },
        { id: 'u1', nome: 'Conta em dólar', tipo: 'checking', saldoInicial: c(0), abertura: '2026-01-01', ativa: true, saldo: c(0), moeda: 'USD' },
      ],
      total: c(0),
    })
    mock.listarLancamentos.mockResolvedValue([
      lanc('l2', '2026-10-16', 'expense', 18740, 'paid', 'Conta de luz'),
      { ...lanc('l9', '2026-10-16', 'expense', 4025, 'paid', 'Café em NY'), contaId: 'u1' },
    ])
    mock.resumoPorMoeda.mockResolvedValue([{ moeda: 'USD', receitas: c(0), despesas: c(4025), resultado: c(-4025) }])
    montar()
    const cafe = (await screen.findByText('Café em NY')).closest('li') as HTMLElement
    expect(cafe.textContent).toMatch(/−US\$\s*40,25/)
    expect(cafe.textContent).not.toMatch(/R\$/)
    const luz = screen.getByText('Conta de luz').closest('li') as HTMLElement
    expect(luz.textContent).toMatch(/−R\$\s*187,40/)
    expect(screen.getByTestId('dia-outras-moedas').textContent).toMatch(/USD.*não entram nos totais em reais/)
    // totais do mês continuam os do banco em reais; o dólar vem à parte, de period_summary_by_currency
    const totais = screen.getByRole('region', { name: 'Totais do mês' })
    expect(within(totais).getByText('−R$ 187,40')).toBeTruthy()
    const bloco = screen.getByRole('group', { name: 'Em outras moedas' })
    expect(bloco.textContent).toMatch(/US\$\s*40,25/)
    expect(mock.resumoPorMoeda).toHaveBeenCalledWith('h1', '2026-10-01', '2026-10-31')
  })

  it('multimoeda F2: sem movimento em outra moeda, nem o aviso do dia nem o bloco aparecem', async () => {
    montar()
    await screen.findByRole('region', { name: 'Totais do mês' })
    expect(screen.queryByTestId('dia-outras-moedas')).toBeNull()
    expect(screen.queryByRole('group', { name: 'Em outras moedas' })).toBeNull()
  })

  it('em outro mês o saldo vai até o fim dele', async () => {
    montar()
    await screen.findByTestId('saldo-total')
    await userEvent.setup().click(screen.getByRole('button', { name: 'Próximo mês' }))
    expect(await screen.findByRole('heading', { name: 'Novembro de 2026' })).toBeTruthy()
    expect(mock.saldosProjetados).toHaveBeenLastCalledWith('h1', '2026-11-30', true)
    expect((await screen.findByTestId('saldo-total')).closest('p')!.textContent).toMatch(/^Saldo previsto em 30\/11: /)
  })

  it('sem as funções do banco (migration 025 ainda não aplicada) o calendário segue sem o saldo e sem as faturas', async () => {
    mock.saldosProjetados.mockRejectedValue({ code: '42883', message: 'function does not exist' })
    mock.faturasQueVencem.mockRejectedValue({ code: '42883', message: 'function does not exist' })
    montar()
    expect(await screen.findByRole('heading', { name: 'Outubro de 2026' })).toBeTruthy()
    expect(await screen.findByText('Receitas pagas')).toBeTruthy()
    expect(screen.queryByTestId('saldo-total')).toBeNull()
  })
})

describe('Calendário financeiro: valores no dia, filtros, resumo do dia e Hoje', () => {
  afterEach(() => definirValoresOcultos(false))

  it('os valores dentro do dia vêm do banco (calendar_day_totals), não da soma da lista', async () => {
    // o banco diz 9.999,00 de entrada no dia 5; a lista tem 8.000,00: a grade mostra o do banco (a tela não soma)
    mock.totaisDoDia.mockResolvedValue([{ data: '2026-10-05', moeda: 'BRL', entradas: c(999900), saidas: c(18740), faturasEParcelas: c(0) }])
    montar()
    const dia5 = await screen.findByRole('button', { name: '5 de outubro de 2026: 2 lançamentos' })
    const valores = await within(dia5).findByText('+9.999,00')
    expect(valores.closest('[data-valores-do-dia]')).not.toBeNull()
    expect(within(dia5).getByText('−187,40')).toBeTruthy()
    expect(within(dia5).queryByText('+8.000,00')).toBeNull()
    expect(mock.totaisDoDia).toHaveBeenCalledWith('h1', '2026-10-01', '2026-10-31')
    // valores só onde a célula comporta (celular deitado e computador ≥ 1280 px); no celular em pé e no iPad (menu lateral
    // aperta a grade) ficam os tracinhos de entrada e saída
    const classes = valores.closest('[data-valores-do-dia]')!.className.split(' ')
    expect(classes).toEqual(expect.arrayContaining(['hidden', 'sm:flex', 'md:hidden', 'xl:flex']))
    expect(dia5.querySelector('.bg-lucro-marca')!.className.split(' ')).toEqual(expect.arrayContaining(['sm:hidden', 'md:block', 'xl:hidden']))
  })

  it('dia só com outra moeda: sem valor em reais na grade, os tracinhos continuam também no computador', async () => {
    mock.totaisDoDia.mockResolvedValue([{ data: '2026-10-05', moeda: 'USD', entradas: c(0), saidas: c(5000), faturasEParcelas: c(0) }])
    montar()
    const dia5 = await screen.findByRole('button', { name: '5 de outubro de 2026: 2 lançamentos' })
    await screen.findByRole('region', { name: 'Totais do mês' })
    expect(dia5.querySelector('[data-valores-do-dia]')).toBeNull()
    expect(dia5.querySelector('.bg-lucro-marca')!.className).not.toContain('sm:hidden')
  })

  it('com "ocultar valores" ligado a grade não mostra números (só os tracinhos) e o resumo do dia fica mascarado', async () => {
    definirValoresOcultos(true)
    const u = userEvent.setup()
    montar()
    const dia5 = await screen.findByRole('button', { name: '5 de outubro de 2026: 2 lançamentos' })
    await u.click(dia5)
    const resumo = await screen.findByRole('region', { name: 'Resumo do dia' })
    expect(dia5.querySelector('[data-valores-do-dia]')).toBeNull()
    expect(dia5.querySelector('.bg-lucro-marca')).not.toBeNull()
    expect(within(resumo).getAllByText(/R\$ ••••/)).toHaveLength(2)
    expect(document.body.textContent).not.toContain('8.000,00')
  })

  it('se os totais de cada dia falham: aviso dizendo o que faltou, a grade fica com os tracinhos e sem resumo do dia', async () => {
    mock.totaisDoDia.mockRejectedValue(new Error('rede'))
    montar()
    expect((await screen.findByTestId('calendario-blocos-falharam')).textContent).toContain('totais de cada dia')
    const dia5 = screen.getByRole('button', { name: '5 de outubro de 2026: 2 lançamentos' })
    expect(dia5.querySelector('[data-valores-do-dia]')).toBeNull()
    expect(dia5.querySelector('.bg-lucro-marca')).not.toBeNull()
    expect(screen.queryByRole('region', { name: 'Resumo do dia' })).toBeNull()
  })

  it('resumo do dia: entradas e saídas em reais, do banco', async () => {
    const u = userEvent.setup()
    montar()
    await u.click(await screen.findByRole('button', { name: '5 de outubro de 2026: 2 lançamentos' }))
    const resumo = screen.getByRole('region', { name: 'Resumo do dia' })
    expect(within(resumo).getByText('+R$ 8.000,00')).toBeTruthy()
    expect(within(resumo).getByText('−R$ 187,40')).toBeTruthy()
    expect(screen.getByTestId('dia-contagem').textContent).toBe('2 itens')
  })

  it('filtros: Entradas, Saídas e Faturas e Parcelas filtram a grade, a lista e o resumo do dia; transferência só em Todos', async () => {
    const u = userEvent.setup()
    montar()
    const grupo = await screen.findByRole('group', { name: 'Mostrar no calendário' })
    expect(within(grupo).getByRole('button', { name: 'Todos' }).getAttribute('aria-pressed')).toBe('true')
    for (const b of within(grupo).getAllByRole('button')) expect(b.className).toContain('min-h-11')

    await u.click(within(grupo).getByRole('button', { name: 'Entradas' }))
    expect(within(grupo).getByRole('button', { name: 'Entradas' }).getAttribute('aria-pressed')).toBe('true')
    const dia5 = screen.getByRole('button', { name: '5 de outubro de 2026: 1 lançamento' })
    expect(within(dia5).getByText('+8.000,00')).toBeTruthy()
    expect(within(dia5).queryByText('−187,40')).toBeNull()
    expect(screen.getByRole('button', { name: '10 de outubro de 2026: nada' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '12 de outubro de 2026: nada' })).toBeTruthy() // transferência
    await u.click(dia5)
    expect(within(listaDoDia()).getByText('Salário')).toBeTruthy()
    expect(within(listaDoDia()).queryByText('Conta de luz')).toBeNull()

    await u.click(within(grupo).getByRole('button', { name: 'Saídas' }))
    expect(within(screen.getByRole('button', { name: '5 de outubro de 2026: 1 lançamento' })).getByText('−187,40')).toBeTruthy()
    expect(within(listaDoDia()).getByText('Conta de luz')).toBeTruthy()

    await u.click(within(grupo).getByRole('button', { name: 'Faturas e Parcelas' }))
    expect(screen.getByRole('button', { name: '5 de outubro de 2026: nada' })).toBeTruthy()
    expect(screen.getByText('Nada deste tipo neste dia.')).toBeTruthy()
    const dia10 = screen.getByRole('button', { name: '10 de outubro de 2026: 1 lançamento' })
    expect(within(dia10).getByText('−1.333,34')).toBeTruthy()
    await u.click(dia10)
    expect(within(listaDoDia()).getByText('Pagamento de Nubank')).toBeTruthy()
    const resumo = screen.getByRole('region', { name: 'Resumo do dia' })
    expect(within(resumo).getByText('Faturas e parcelas')).toBeTruthy()
    expect(within(resumo).getByText('−R$ 1.333,34')).toBeTruthy()
    expect(screen.getByTestId('dia-contagem').textContent).toBe('1 item · Faturas e Parcelas')
  })

  it('fatura que vence e parcela de dívida entram em Faturas e Parcelas; despesa comum planejada não', async () => {
    mock.faturasQueVencem.mockResolvedValue([
      { cartaoId: 'k1', cartao: 'Nubank', vencimento: '2026-10-20', total: c(50000), pago: c(0), falta: c(50000), contaPagamentoId: 'a1' },
    ])
    mock.listarParcelasDivida.mockResolvedValue([
      { id: 'p1', dividaId: 'd1', nomeDivida: 'Financiamento', numero: 3, vencimento: '2026-10-22', valor: c(70000), formaPagamento: 'boleto', contaPagamentoId: null },
    ])
    const u = userEvent.setup()
    montar()
    await u.click(within(await screen.findByRole('group', { name: 'Mostrar no calendário' })).getByRole('button', { name: 'Faturas e Parcelas' }))
    expect(screen.getByRole('button', { name: '20 de outubro de 2026: 1 lançamento, 1 planejado' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '22 de outubro de 2026: 1 lançamento, 1 planejado' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '25 de outubro de 2026: nada' })).toBeTruthy() // Internet, despesa comum
  })

  it('botão Hoje: volta ao mês de hoje e escolhe o dia; desligado quando já está nele', async () => {
    const u = userEvent.setup()
    montar()
    const hojeBtn = await screen.findByRole('button', { name: 'Hoje' })
    expect((hojeBtn as HTMLButtonElement).disabled).toBe(true)
    expect(hojeBtn.className).toContain('min-h-11')
    await u.click(screen.getByRole('button', { name: 'Próximo mês' }))
    await screen.findByRole('heading', { name: 'Novembro de 2026' })
    expect((screen.getByRole('button', { name: 'Hoje' }) as HTMLButtonElement).disabled).toBe(false)
    await u.click(screen.getByRole('button', { name: 'Hoje' }))
    await screen.findByRole('heading', { name: 'Outubro de 2026' })
    expect(screen.getByRole('button', { name: /^16 de outubro de 2026, hoje/ }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('16/10/2026 · hoje')).toBeTruthy()
  })

  it('no computador (≥ 1280 px), a grade e o detalhamento do dia ficam lado a lado (8 + 4 colunas)', async () => {
    montar()
    const grade = await screen.findByRole('group', { name: 'Dias de Outubro de 2026' })
    const cardGrade = grade.closest('.xl\\:col-span-8')
    expect(cardGrade).not.toBeNull()
    expect(cardGrade!.parentElement!.className).toContain('xl:grid-cols-12')
    expect(screen.getByText('16/10/2026 · hoje').closest('.xl\\:col-span-4')).not.toBeNull()
  })
})

