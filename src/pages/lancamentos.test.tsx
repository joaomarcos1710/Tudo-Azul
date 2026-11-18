// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
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
  faixaDePendencias: vi.fn(),
  criarLancamento: vi.fn(),
  criarRecorrencia: vi.fn(),
  criarParcelado: vi.fn(),
  editarLancamento: vi.fn(),
  editarEsteEProximos: vi.fn(),
  marcarComoPago: vi.fn(),
  moverParaLixeira: vi.fn(),
  pararDeRepetirAPartirDe: vi.fn(),
  restaurarDaLixeira: vi.fn(),
  listarContas: vi.fn(),
  listarSaldosDiarios: vi.fn(),
  listarCategorias: vi.fn(),
  listarParcelasDivida: vi.fn(),
  serieFluxo: vi.fn(),
  buscarNoPeriodo: vi.fn(),
  totaisDaBusca: vi.fn(),
}))
const automaticos = vi.hoisted(() => ({ atualizarAutomaticos: vi.fn() }))
vi.mock('../lib/automaticos', () => automaticos)
vi.mock('../lib/recorrencias', async (original) => ({
  ...(await original<typeof import('../lib/recorrencias')>()),
  criarRecorrencia: mock.criarRecorrencia,
}))
vi.mock('../lib/auth', () => ({ useAuth: () => ({ sessao: { user: { id: 'u1' } }, carregando: false }) }))
// aporte e resgate pelo "+" (pedido do dono, 10/11/2026) abrem a folha de Investimentos
const inv = vi.hoisted(() => ({ listarAtivosInvestimento: vi.fn(), registrarOperacaoPorValor: vi.fn(), registrarOperacaoInvestimento: vi.fn() }))
vi.mock('../lib/investimentos', async (original) => ({
  ...(await original<typeof import('../lib/investimentos')>()),
  listarAtivosInvestimento: inv.listarAtivosInvestimento,
  registrarOperacaoPorValor: inv.registrarOperacaoPorValor,
  registrarOperacaoInvestimento: inv.registrarOperacaoInvestimento,
}))
// Preferências da pessoa (Conta › Preferências): sem linha, o cliente é nulo, como sempre foi nesta suíte; com linha, só a leitura de
// user_preferences existe (é a única consulta direta ao banco que a tela faz).
const prefs = vi.hoisted(() => ({ linha: null as null | { ordem_lancamentos: 'asc' | 'desc'; saldo_diario: boolean } }))
vi.mock('../lib/supabase', () => ({
  get supabase() {
    return prefs.linha
      ? { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: prefs.linha, error: null }) }) }) }) }
      : null
  },
}))
const pessoasMock = vi.hoisted(() => ({ listarPessoasFamilia: vi.fn((_familia: string) => Promise.resolve([] as unknown[])) }))
vi.mock('../lib/pessoasFamilia', async (original) => ({
  ...(await original<typeof import('../lib/pessoasFamilia')>()),
  listarPessoasFamilia: pessoasMock.listarPessoasFamilia,
}))
vi.mock('../lib/FamiliaContext', () => ({
  useFamilia: () => ({ familia: { id: 'h1', nome: 'Casa', papel: 'owner' }, carregando: false, erro: false, recarregar: vi.fn() }),
}))
vi.mock('../lib/lancamentos', async (original) => ({
  ...(await original<typeof import('../lib/lancamentos')>()),
  listarLancamentosNoPeriodo: mock.listarLancamentos,
  criarParcelado: mock.criarParcelado,
  listarMovimentosDeDividaNoPeriodo: mock.listarMovimentosDeDivida,
  listarFaturasNoPeriodo: mock.listarFaturasDoMes,
  listarCreditosDeCartaoNoPeriodo: mock.listarCreditosDeCartao,
  resumoDoMes: mock.resumoDoMes,
  resumoPorMoeda: mock.resumoPorMoeda,
  faixaDePendencias: mock.faixaDePendencias,
  criarLancamento: mock.criarLancamento,
  editarLancamento: mock.editarLancamento,
  editarEsteEProximos: mock.editarEsteEProximos,
  marcarComoPago: mock.marcarComoPago,
  moverParaLixeira: mock.moverParaLixeira,
  pararDeRepetirAPartirDe: mock.pararDeRepetirAPartirDe,
  restaurarDaLixeira: mock.restaurarDaLixeira,
  buscarNoPeriodo: mock.buscarNoPeriodo,
  totaisDaBusca: mock.totaisDaBusca,
}))
vi.mock('../lib/fluxoCaixa', async (original) => ({
  ...(await original<typeof import('../lib/fluxoCaixa')>()),
  serieFluxo: mock.serieFluxo,
}))
vi.mock('../lib/contas', async (original) => ({
  ...(await original<typeof import('../lib/contas')>()),
  listarContas: mock.listarContas,
  listarSaldosDiarios: mock.listarSaldosDiarios,
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
import { limitesDoMes, somarMeses, TETO_LINHAS_LISTA } from '../lib/lancamentos'
import { hojeSP } from '../lib/contas'

/** Categoria agora é um seletor em folha (como no Organizze): abre pelo botão e toca na categoria. */
async function escolherCategoria(u: ReturnType<typeof userEvent.setup>, campo: HTMLElement, id: string) {
  await u.click(campo)
  const folhas = screen.getAllByRole('dialog', { name: 'Selecionar uma categoria' })
  const folha = folhas[folhas.length - 1]
  await u.click(folha.querySelector(`[data-categoria-id="${id}"]`) as HTMLElement)
}


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

/** Os mesmos lançamentos, com o planejado (Salário) numa data futura: planejado com data passada vira "Vencido". */
const lancsComPlanejadoFuturo = () => lancs.map((l) => (l.id === 't2' ? { ...l, data: '2099-10-05' } : l))

beforeEach(() => {
  prefs.linha = null
  window.localStorage.clear() // a conta/cartão lembrados de um teste não podem vazar para o próximo
  automaticos.atualizarAutomaticos.mockResolvedValue({ recorrentesOk: true, faturasOk: true })
  mock.listarContas.mockResolvedValue({ contas, total: c(0) })
  mock.listarSaldosDiarios.mockResolvedValue([])
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
  mock.faixaDePendencias.mockResolvedValue([])
  mock.buscarNoPeriodo.mockResolvedValue({ lancamentos: new Set(), cartao: new Set() })
  mock.totaisDaBusca.mockResolvedValue([])
  // rodapé: pagos (300,00 / 250,50 / saldo 12.000,00) e com os não pagos (8.300,00 / 1.250,50 / saldo 19.050,00), do banco
  mock.serieFluxo.mockImplementation(async (_f: string, de: string, ate: string, _d: string, filtros: { incluirNaoPagos?: boolean }) => (filtros.incluirNaoPagos
    ? { linhas: [{ inicio: de, fim: ate, entradas: c(830000), saidas: c(125050), resultado: c(704950), saldo: c(1905000) }], totalEntradas: c(830000), totalSaidas: c(125050), totalResultado: c(704950) }
    : { linhas: [{ inicio: de, fim: ate, entradas: c(30000), saidas: c(25050), resultado: c(4950), saldo: c(1200000) }], totalEntradas: c(30000), totalSaidas: c(25050), totalResultado: c(4950) }))
  for (const f of [mock.criarLancamento, mock.editarLancamento, mock.editarEsteEProximos, mock.marcarComoPago, mock.moverParaLixeira, mock.restaurarDaLixeira]) f.mockResolvedValue(undefined)
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

/** A tela de filtros (tela cheia, pedido do dono, 10/11/2026): abre pelo botão Filtrar se ainda não estiver aberta. */
async function abrirFiltros() {
  if (!screen.queryByRole('dialog', { name: 'Filtrar lançamentos' })) fireEvent.click(await screen.findByRole('button', { name: /^Filtrar/ }))
}
/** Categoria segue no seletor; tipo e conta são chips e cartões (toque liga e desliga). */
async function campoFiltro(rotulo: string): Promise<HTMLSelectElement> {
  await abrirFiltros()
  return screen.getByLabelText(rotulo) as HTMLSelectElement
}
const ROTULO_TIPO: Record<string, string> = { income: 'Receitas', expense: 'Despesas', transfer: 'Transferências' }
/** Escolhe o tipo: '' tira o que estiver ligado. */
async function escolherTipo(u: ReturnType<typeof userEvent.setup>, valor: string) {
  await abrirFiltros()
  if (valor === '') {
    const ligado = Object.values(ROTULO_TIPO).map((r) => screen.getByRole('button', { name: r })).find((b) => b.getAttribute('aria-pressed') === 'true')
    if (ligado) await u.click(ligado)
    return
  }
  const chip = screen.getByRole('button', { name: ROTULO_TIPO[valor] })
  if (chip.getAttribute('aria-pressed') !== 'true') await u.click(chip)
}
/** Toca num cartão de conta (liga; tocar de novo desliga). */
async function escolherConta(u: ReturnType<typeof userEvent.setup>, nome: string) {
  await abrirFiltros()
  await u.click(within(screen.getByRole('group', { name: 'Contas' })).getByRole('button', { name: nome }))
}

/** O "+" flutuante abre o menu; "Nova despesa" abre o painel (o formulário troca de aba depois, se o teste quiser). */
async function abrirNovo(u: ReturnType<typeof userEvent.setup>) {
  await u.click(await screen.findByRole('button', { name: 'Novo lançamento' }))
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

describe('Lançamentos obedece às preferências da pessoa (Conta › Preferências)', () => {
  const diasNaTela = () => screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent ?? '').filter((t) => /\d\d\/\d\d/.test(t))

  it('ordem Decrescente (o padrão): o dia mais novo vem primeiro', async () => {
    prefs.linha = { ordem_lancamentos: 'desc', saldo_diario: true }
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    await screen.findByText('Supermercado')
    await waitFor(() => expect(diasNaTela().map((t) => t.slice(-5))).toEqual(['15/10', '05/10']))
  })

  it('ordem Crescente: o dia mais antigo vem primeiro (falha se a preferência deixar de ser lida)', async () => {
    prefs.linha = { ordem_lancamentos: 'asc', saldo_diario: true }
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    await screen.findByText('Supermercado')
    await waitFor(() => expect(diasNaTela().map((t) => t.slice(-5))).toEqual(['05/10', '15/10']))
  })

  it('saldo diário Sim: o "Saldo final" aparece no dia que tem saldo', async () => {
    prefs.linha = { ordem_lancamentos: 'desc', saldo_diario: true }
    mock.listarSaldosDiarios.mockResolvedValue([{ data: '2026-10-15', moeda: 'BRL', saldo: c(123456) }])
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    expect(await screen.findByText(/Saldo final: R\$ 1\.234,56/)).toBeTruthy()
  })

  it('saldo diário Não: o "Saldo final" não aparece, mesmo o banco devolvendo o saldo (falha se a preferência deixar de ser lida)', async () => {
    prefs.linha = { ordem_lancamentos: 'desc', saldo_diario: false }
    mock.listarSaldosDiarios.mockResolvedValue([{ data: '2026-10-15', moeda: 'BRL', saldo: c(123456) }])
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    await screen.findByText('Supermercado')
    // o saldo do banco e a preferência chegam em momentos diferentes: espera o saldo ser pedido e deixa tudo assentar antes de afirmar
    await waitFor(() => expect(mock.listarSaldosDiarios).toHaveBeenCalled())
    await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
    expect(screen.queryByText(/Saldo final:/)).toBeNull()
  })
})

describe('Lançamentos', () => {
  it('o cabeçalho de cada dia diz o dia da semana, e "Hoje" e "Ontem" quando for o caso (handoff de Lançamentos, item b)', async () => {
    const hoje = hojeSP()
    const ontem = new Date(Date.UTC(Number(hoje.slice(0, 4)), Number(hoje.slice(5, 7)) - 1, Number(hoje.slice(8, 10))) - 86_400_000).toISOString().slice(0, 10)
    mock.listarLancamentos.mockResolvedValue([{ ...lancs[0], id: 'h1', data: hoje }, { ...lancs[0], id: 'h2', data: ontem }])
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    const dd = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`
    const semana = '(domingo|segunda|terça|quarta|quinta|sexta|sábado)'
    // o título visível e o nome da região (leitor de tela) são o mesmo texto
    expect((await screen.findByRole('heading', { level: 2, name: new RegExp(`^Hoje · ${semana}, ${dd(hoje)}$`) }))).toBeTruthy()
    expect(screen.getByRole('region', { name: new RegExp(`^Hoje · ${semana}, ${dd(hoje)}$`) })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 2, name: new RegExp(`^Ontem · ${semana}, ${dd(ontem)}`) })).toBeTruthy()
  })

  it('lista por dia com sinais do design system e totais vindos do banco', async () => {
    mock.listarLancamentos.mockResolvedValue(lancsComPlanejadoFuturo())
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    expect((await screen.findAllByText('−R$ 250,50')).length).toBe(2) // item da lista e as saídas pagas do rodapé
    expect(screen.getAllByText('+R$ 8.000,00').length).toBe(1) // só o item planejado da lista
    expect(screen.getByText('⇄ R$ 100,00')).toBeTruthy()
    expect(screen.getByText('Itaú → Nubank')).toBeTruthy()
    // handoff de Lançamentos, item a (a decisão de 03/11 de mostrar só a categoria foi revogada em 16/11): despesa e receita
    // mostram a categoria e, logo depois, a conta; a transferência continua com "origem → destino", sem conta repetida
    expect(screen.getByText('Mercado')).toBeTruthy()
    const linhaDe = (titulo: string) => screen.getByText(titulo).closest('li') as HTMLElement
    expect(linhaDe('Supermercado').querySelector('[data-conta]')!.textContent).toBe('Itaú')
    expect(linhaDe('Supermercado').querySelector('[data-metadados]')!.textContent).toMatch(/^Mercado·Itaú/)
    expect(within(linhaDe('Itaú → Nubank')).queryAllByText('Itaú')).toHaveLength(0)
    expect(linhaDe('Itaú → Nubank').querySelector('[data-conta]')).toBeNull()
    expect(screen.getByText('Planejado')).toBeTruthy()
    // #208: selo "Planejado" verde (agendado), receita azul (lucro); despesa vermelha (design "Extrato", decisão do dono 16/11/2026)
    expect(screen.getByText('Planejado').className).toContain('bg-agendado-fundo text-agendado')
    const linha = (texto: string) => screen.getByText(texto).closest('li') as HTMLElement
    expect(within(linha('Supermercado')).getByText('−R$ 250,50').className).toContain('text-prejuizo')
    expect(within(linha('Planejado')).getByText('+R$ 8.000,00').className).toContain('text-lucro')
    expect(within(linha('Itaú → Nubank')).getByText('⇄ R$ 100,00').className).toContain('text-transferencia')
    // os totais saíram do topo e moram no rodapé (entradas azul, saídas vermelho, saldo pela cor do sinal)
    const rodape = screen.getByRole('region', { name: 'Totais do mês' })
    expect(within(rodape).getByText('R$ 300,00').className).toContain('text-lucro')
    expect(within(rodape).getByText('−R$ 250,50').className).toContain('text-prejuizo')
    expect(within(rodape).getByText('R$ 12.000,00').className).toContain('text-lucro')
    expect(screen.queryByText('Despesas pagas')).toBeNull()
    expect(screen.getByRole('region', { name: /^(Hoje · |Ontem · )?[a-zçá]+, 15\/10/i })).toBeTruthy() // 15/10/2026 é quinta
  })

  it('aporte para a carteira (migration 100): nome da conta interna, selo Investimento, só um link para Investimentos e fora do lote', async () => {
    mock.listarContas.mockResolvedValue({ contas, total: c(0), internas: [{ id: 'k9', nome: 'Carteira de investimentos' }] })
    mock.listarLancamentos.mockResolvedValue([
      { id: 'ap', tipo: 'transfer', contaId: 'a1', destinoId: 'k9', categoriaId: null, descricao: 'Aporte: Tesouro', valor: c(50000), data: '2026-10-05', status: 'paid', notas: '' },
    ])
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    const linha = (await screen.findByText('Itaú → Carteira de investimentos')).closest('li') as HTMLElement
    expect(within(linha).getByText('Investimento')).toBeTruthy()
    expect(within(linha).getByRole('link', { name: 'Ver em Investimentos: Aporte: Tesouro' }).getAttribute('href')).toBe('/investimentos')
    expect(within(linha).queryByRole('button', { name: /Ações de/ })).toBeNull()
  })

  it('no computador não há o card "Saldo ao final de cada dia" (pedido do dono, 10/11/2026)', async () => {
    const original = window.matchMedia
    window.matchMedia = ((q: string) => ({ matches: true, media: q, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia
    mock.listarSaldosDiarios.mockResolvedValue([{ data: '2026-10-05', moeda: 'BRL', saldo: c(920000) }])
    try {
      render(<MemoryRouter><Lancamentos /></MemoryRouter>)
      await screen.findAllByText('−R$ 250,50')
      await waitFor(() => expect(mock.listarSaldosDiarios).toHaveBeenCalled())
      expect(screen.queryByText('Saldo ao final de cada dia')).toBeNull()
      expect(screen.queryByText('Por moeda, sem conversão')).toBeNull()
    } finally {
      window.matchMedia = original
    }
  })

  it('?tipo=receita|despesa (avisos do Início) abre já filtrado pelo tipo, no mês pedido', async () => {
    render(<MemoryRouter initialEntries={['/lancamentos?mes=2026-10&tipo=receita']}><Lancamentos /></MemoryRouter>)
    await waitFor(() => expect(mock.listarLancamentos).toHaveBeenCalledWith('h1', '2026-10-01', '2026-10-31', { tipo: 'income' }))
    await abrirFiltros()
    expect(screen.getByRole('button', { name: 'Receitas' }).getAttribute('aria-pressed')).toBe('true')
    cleanup()
    mock.listarLancamentos.mockClear()
    render(<MemoryRouter initialEntries={['/lancamentos?mes=2026-10&tipo=despesa']}><Lancamentos /></MemoryRouter>)
    await waitFor(() => expect(mock.listarLancamentos).toHaveBeenCalledWith('h1', '2026-10-01', '2026-10-31', { tipo: 'expense' }))
    cleanup()
    mock.listarLancamentos.mockClear()
    // valor desconhecido não filtra nada
    render(<MemoryRouter initialEntries={['/lancamentos?mes=2026-10&tipo=xyz']}><Lancamentos /></MemoryRouter>)
    await waitFor(() => expect(mock.listarLancamentos).toHaveBeenCalledWith('h1', '2026-10-01', '2026-10-31', {}))
  })

  it('item g: o endereço abre período e filtros (link, recarregar); mudar o filtro na tela muda o endereço', async () => {
    const u = userEvent.setup()
    let endereco = ''
    const Endereco = () => { endereco = useLocation().search; return null }
    render(<MemoryRouter initialEntries={['/lancamentos?periodo=livre&de=2026-10-05&ate=2026-11-20&conta=a1&situacao=pendente']}>
      <Lancamentos /><Endereco />
    </MemoryRouter>)
    await waitFor(() => expect(mock.listarLancamentos).toHaveBeenCalledWith('h1', '2026-10-05', '2026-11-20', { contaId: 'a1', situacao: 'planned' }))
    // tirar um filtro na tela atualiza o endereço (o período e o outro filtro ficam)
    await u.click(await screen.findByRole('button', { name: /^Filtrar/ }))
    const tela = screen.getByRole('dialog', { name: 'Filtrar lançamentos' })
    await u.click(within(tela).getByRole('button', { name: 'Pendente' }))
    await u.click(within(tela).getByRole('button', { name: 'Filtrar: ver os lançamentos' }))
    await waitFor(() => expect(new URLSearchParams(endereco).get('situacao')).toBeNull())
    const q = new URLSearchParams(endereco)
    expect([q.get('periodo'), q.get('de'), q.get('ate'), q.get('conta')]).toEqual(['livre', '2026-10-05', '2026-11-20', 'a1'])
    await waitFor(() => expect(mock.listarLancamentos).toHaveBeenLastCalledWith('h1', '2026-10-05', '2026-11-20', { contaId: 'a1' }))
    // trocar o período pela seta também vai para o endereço
    await u.click(screen.getByRole('button', { name: 'Período anterior' }))
    await waitFor(() => expect(new URLSearchParams(endereco).get('de')).not.toBe('2026-10-05'))
    expect(new URLSearchParams(endereco).get('conta')).toBe('a1')
  })

  it('item g: ?categoria= abre já filtrado pela categoria', async () => {
    render(<MemoryRouter initialEntries={['/lancamentos?mes=2026-10&tipo=despesa&categoria=g1']}><Lancamentos /></MemoryRouter>)
    await waitFor(() => expect(mock.listarLancamentos).toHaveBeenCalledWith('h1', '2026-10-01', '2026-10-31', { tipo: 'expense', categoriaId: 'g1' }))
  })

  it('rodapé como no Organizze (pedido do dono, 10/11/2026): pagos à vista; a seta abre o previsto, tudo do banco (cash_flow_series)', async () => {
    const u = userEvent.setup()
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    const rodape = await screen.findByRole('region', { name: 'Totais do mês' })
    await within(rodape).findByText('R$ 300,00')
    expect(within(rodape).getByText('entradas')).toBeTruthy()
    expect(within(rodape).getByText('saídas')).toBeTruthy()
    expect(within(rodape).getByText('saldo')).toBeTruthy()
    // o previsto (pagos e não pagos) começa fechado
    const seta = within(rodape).getByRole('button', { name: 'Mostrar o previsto' })
    expect(seta.getAttribute('aria-expanded')).toBe('false')
    expect(within(rodape).getByText('R$ 8.300,00').closest('[hidden]')).not.toBeNull()
    await u.click(seta)
    expect(within(rodape).getByText('R$ 8.300,00').closest('[hidden]')).toBeNull()
    expect(within(rodape).getByRole('button', { name: 'Esconder o previsto' }).getAttribute('aria-expanded')).toBe('true')
    expect(within(rodape).getByText('R$ 8.300,00')).toBeTruthy()
    expect(within(rodape).getByText('−R$ 1.250,50')).toBeTruthy()
    expect(within(rodape).getByText('R$ 19.050,00')).toBeTruthy()
    // cada número do previsto diz o que é (antes eram três "previsto" iguais)
    for (const rotulo of ['entradas previstas', 'saídas previstas', 'saldo previsto']) expect(within(rodape).getByText(rotulo)).toBeTruthy()
    expect(within(rodape).queryByText('previsto')).toBeNull()
    // o mês inteiro, numa linha só, com e sem os não pagos: o front não soma nada
    const [de, ate] = limitesDoMes(hojeSP().slice(0, 7))
    expect(mock.serieFluxo).toHaveBeenCalledWith('h1', de, ate, 'total', { contas: undefined, incluirNaoPagos: false })
    expect(mock.serieFluxo).toHaveBeenCalledWith('h1', de, ate, 'total', { contas: undefined, incluirNaoPagos: true })
  })

  it('rodapé: com filtro de conta, os totais seguem a conta e o saldo some; com tipo ou categoria, os números somem e fica a frase', async () => {
    const u = userEvent.setup()
    mock.serieFluxo.mockResolvedValue({ linhas: [{ inicio: '', fim: '', entradas: c(100), saidas: c(200), resultado: c(-100), saldo: null }], totalEntradas: c(100), totalSaidas: c(200), totalResultado: c(-100) })
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    await screen.findByText('Supermercado')
    await escolherConta(u, 'Itaú')
    await vi.waitFor(() => expect(mock.serieFluxo).toHaveBeenLastCalledWith('h1', expect.any(String), expect.any(String), 'total', { contas: ['a1'], incluirNaoPagos: true }))
    const rodape = screen.getByRole('region', { name: 'Totais do mês' })
    expect(within(rodape).getAllByText('—')[0].getAttribute('title')).toMatch(/sem filtro de conta/)
    expect(within(rodape).queryByText(/não o de tipo/)).toBeNull()
    expect(within(rodape).getAllByText('R$ 1,00').length).toBeGreaterThan(0)
    await escolherTipo(u, 'expense')
    // o total normal não segue o filtro de tipo: some e dá lugar ao total do filtro, que vem do banco (migration 139)
    expect(await within(rodape).findByTestId('totais-busca')).toBeTruthy()
    expect(within(rodape).queryByText('R$ 1,00')).toBeNull()
    expect(within(rodape).queryByRole('button', { name: 'Mostrar o previsto' })).toBeNull()
    expect(within(rodape).getByRole('button', { name: 'Novo lançamento' })).toBeTruthy() // o + continua
  })

  it('trocar de filtro esmaece a lista antiga e diz "Atualizando a lista…" até a nova chegar (handoff, item d)', async () => {
    const u = userEvent.setup()
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    await screen.findByText('Supermercado')
    expect(screen.queryByTestId('lista-atualizando')).toBeNull()
    let responder: (l: typeof lancs) => void = () => {}
    mock.listarLancamentos.mockImplementationOnce(() => new Promise((r) => { responder = r }))
    await escolherTipo(u, 'expense')
    // a resposta do filtro novo ainda não veio: a lista que está na tela é a antiga, e a tela diz isso
    expect(await screen.findByTestId('lista-atualizando')).toBeTruthy()
    const lista = screen.getByText('Supermercado').closest('[aria-busy]') as HTMLElement
    expect(lista.getAttribute('aria-busy')).toBe('true')
    expect(lista.className).toContain('opacity-50')
    responder(lancs.filter((l) => l.tipo === 'expense'))
    await vi.waitFor(() => expect(screen.queryByTestId('lista-atualizando')).toBeNull())
    expect((screen.getByText('Supermercado').closest('[aria-busy]') as HTMLElement).getAttribute('aria-busy')).toBe('false')
  })

  it('faixa de pendências (item c): no mês atual, vencidos e o que falta até o fim do mês, com os totais do banco', async () => {
    mock.faixaDePendencias.mockResolvedValue([
      { tipo: 'receivable', quantidade: 1, total: c(100000), primeira: '2099-12-28' },
      { tipo: 'overdue_payable', quantidade: 3, total: c(33000), primeira: '2026-09-25' },
      { tipo: 'payable', quantidade: 2, total: c(35000), primeira: '2099-12-25' },
      { tipo: 'overdue_receivable', quantidade: 1, total: c(30000), primeira: '2026-10-10' },
    ])
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    const faixa = await screen.findByRole('region', { name: 'Pendências do mês' })
    const [, fim] = limitesDoMes(hojeSP().slice(0, 7))
    expect(mock.faixaDePendencias).toHaveBeenCalledWith('h1', hojeSP(), fim)
    // ordem fixa (vencidos primeiro), cada valor do banco, sem somar pagar com receber
    const cartoes = within(faixa).getAllByRole('listitem')
    expect(cartoes.map((li) => li.getAttribute('data-pendencia'))).toEqual(['overdue_payable', 'overdue_receivable', 'payable', 'receivable'])
    expect(cartoes[0].textContent).toContain('Vencidos a pagar')
    expect(within(cartoes[0]).getByText('R$ 330,00').className).toContain('text-prejuizo')
    expect(cartoes[0].textContent).toContain('3 itens · desde 25/09')
    expect(within(cartoes[1]).getByText('R$ 300,00').className).toContain('text-atencao')
    expect(cartoes[1].textContent).toContain('1 item · desde 10/10')
    expect(cartoes[2].textContent).toContain(`A pagar até ${fim.slice(8, 10)}/${fim.slice(5, 7)}`)
    expect(within(cartoes[2]).getByText('R$ 350,00').className).toContain('text-atencao')
    expect(cartoes[3].textContent).toContain('A receber até')
    expect(within(cartoes[3]).getByText('R$ 1.000,00').className).toContain('text-agendado')
    expect(within(faixa).getByText(/Fatura entra só fechada; desconto em folha não entra/)).toBeTruthy()
    // limite conhecido (revisor-dinheiro, #409): o saldo de referência do cartão não entra, e a tela diz isso
    expect(within(faixa).getByText(/antes de cadastrar o cartão no app também não/)).toBeTruthy()
  })

  it('faixa de pendências: sem pendência não aparece; em outro mês não é pedida nem aparece', async () => {
    const u = userEvent.setup()
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    await screen.findByText('Supermercado')
    expect(mock.faixaDePendencias).toHaveBeenCalled()
    expect(screen.queryByTestId('faixa-pendencias')).toBeNull()
    mock.faixaDePendencias.mockClear()
    mock.faixaDePendencias.mockResolvedValue([{ tipo: 'payable', quantidade: 1, total: c(100), primeira: '2099-01-01' }])
    await u.click(screen.getByRole('button', { name: 'Próximo período' }))
    await vi.waitFor(() => expect(mock.listarLancamentos.mock.calls.length).toBeGreaterThan(1))
    await vi.waitFor(() => expect(screen.queryByTestId('lista-atualizando')).toBeNull())
    expect(mock.faixaDePendencias).not.toHaveBeenCalled()
    expect(screen.queryByTestId('faixa-pendencias')).toBeNull()
  })

  it('rodapé que falha não derruba a lista', async () => {
    mock.serieFluxo.mockRejectedValue(new Error('rede'))
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    expect(await screen.findByText('Supermercado')).toBeTruthy()
    expect(await screen.findByText(/Totais indisponíveis agora/)).toBeTruthy()
  })

  describe('estado vazio (handoff de Lançamentos, item d)', () => {
    const mesAtual = () => hojeSP().slice(0, 7)
    const faturaAberta = () => ({ cartaoId: 'k1', cartaoNome: 'Nubank', mes: mesAtual(), fechamento: `${mesAtual()}-20`, vencimento: `${mesAtual()}-28`,
      total: c(45678), pago: c(0), itens: 2, creditos: c(0), situacao: 'fechada', contaPagamentoId: 'a1' })
    const filtrar = async (u: ReturnType<typeof userEvent.setup>, chip: string) => {
      await u.click(screen.getByRole('button', { name: /^Filtrar/ }))
      const tela = screen.getByRole('dialog', { name: 'Filtrar lançamentos' })
      await u.click(within(tela).getByRole('button', { name: chip }))
      await u.click(within(tela).getByRole('button', { name: 'Filtrar: ver os lançamentos' }))
    }

    it('filtro que esconde tudo NÃO deixa a tela em branco: diz que nada combina com os filtros e oferece "Limpar filtros"', async () => {
      const u = userEvent.setup()
      // há uma fatura no mês, mas o filtro de situação vale só para lançamentos (a fatura some com ele) e nenhum lançamento combina
      mock.listarFaturasDoMes.mockResolvedValue([faturaAberta()])
      mock.listarLancamentos.mockImplementation(async (_f: string, _de: string, _ate: string, filtros?: { situacao?: string }) => (filtros?.situacao ? [] : lancs))
      render(<MemoryRouter><Lancamentos /></MemoryRouter>)
      await screen.findByText('Supermercado')
      await filtrar(u, 'Pendente')
      expect(await screen.findByRole('heading', { name: 'Nenhum lançamento com esses filtros' })).toBeTruthy()
      expect(screen.getByText(/Há 1 filtro ligado: Pendente\. Neste mês nada combina com ele\./)).toBeTruthy()
      expect(screen.queryByText('Nenhum lançamento neste mês')).toBeNull()
      expect(screen.queryByText('Supermercado')).toBeNull()
      // "Limpar filtros" tira todos e a lista volta
      await u.click(screen.getByRole('button', { name: 'Limpar filtros' }))
      expect(await screen.findByText('Supermercado')).toBeTruthy()
      expect(screen.queryByRole('heading', { name: 'Nenhum lançamento com esses filtros' })).toBeNull()
      expect(screen.getByRole('button', { name: 'Filtrar' })).toBeTruthy()
    })

    it('sem filtro e sem nada no mês: o texto de sempre, com "Novo lançamento"', async () => {
      mock.listarLancamentos.mockResolvedValue([])
      render(<MemoryRouter><Lancamentos /></MemoryRouter>)
      expect(await screen.findByRole('heading', { name: 'Nenhum lançamento neste mês' })).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'Limpar filtros' })).toBeNull()
    })

    it('se uma consulta falhou, quem fala é o aviso de erro: a tela não diz "nenhum lançamento"', async () => {
      mock.listarLancamentos.mockResolvedValue([])
      mock.listarFaturasDoMes.mockRejectedValue(new Error('boom'))
      render(<MemoryRouter><Lancamentos /></MemoryRouter>)
      expect(await screen.findByText(/Não foi possível carregar as faturas dos cartões agora/)).toBeTruthy()
      expect(screen.queryByRole('heading', { name: /^Nenhum lançamento/ })).toBeNull()
    })
  })

  it('filtros numa folha (pedido do dono, 10/11/2026): o botão Filtrar mostra quantos estão ligados e cada selo tira o seu', async () => {
    const u = userEvent.setup()
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    await screen.findByText('Supermercado')
    // os três seletores não ficam mais soltos na tela
    expect(screen.queryByRole('dialog', { name: 'Filtrar lançamentos' })).toBeNull()
    await u.click(screen.getByRole('button', { name: 'Filtrar' }))
    const tela = screen.getByRole('dialog', { name: 'Filtrar lançamentos' })
    await u.click(within(tela).getByRole('button', { name: 'Despesas' }))
    await u.selectOptions(within(tela).getByLabelText('Filtrar por categoria'), 'mer')
    await u.click(within(tela).getByRole('button', { name: 'Filtrar: ver os lançamentos' }))
    expect(screen.queryByRole('dialog', { name: 'Filtrar lançamentos' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Filtrar (2 ligados)' })).toBeTruthy()
    const selos = screen.getByRole('list', { name: 'Filtros ligados' })
    expect(within(selos).getAllByRole('button').map((b) => b.textContent)).toEqual(['Despesa×', 'Mercado×'])
    await u.click(within(selos).getByRole('button', { name: 'Tirar o filtro Mercado' }))
    await vi.waitFor(() => expect(mock.listarLancamentos).toHaveBeenLastCalledWith('h1', expect.any(String), expect.any(String), { tipo: 'expense', categoriaId: undefined }))
    expect(screen.getByRole('button', { name: 'Filtrar (1 ligado)' })).toBeTruthy()
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
    await escolherCategoria(u, screen.getByLabelText('Categoria'), 'mer')
    await u.click(screen.getByRole('button', { name: 'Registrar despesa' }))
    expect(mock.criarLancamento).toHaveBeenCalledWith('h1', {
      tipo: 'expense', contaId: 'a1', destinoId: null, categoriaId: 'mer', descricao: 'Feira',
      valor: 123456, data: hojeSP(), status: 'paid', notas: '', personId: null, isSharedExpense: true, // despesa nova nasce "Toda a família" (16/11/2026)
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

  it('item e: exclui sem perguntar; a barra "Desfazer" fica fixa embaixo até ser fechada e restaura', async () => {
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    const u = userEvent.setup()
    const item = (await screen.findByText('Supermercado')).closest('li')!
    await u.click(within(item).getByRole('button', { name: 'Ações de Supermercado' }))
    await u.click(within(item).getByRole('menuitem', { name: 'Excluir' }))
    expect(window.confirm).not.toHaveBeenCalled()
    expect(mock.moverParaLixeira).toHaveBeenCalledWith('t1')
    const barra = await screen.findByTestId('barra-desfazer')
    expect(barra.className.split(' ')).toEqual(expect.arrayContaining(['fixed', 'bottom-20', 'md:bottom-6']))
    expect(barra.getAttribute('role')).toBe('status')
    expect(barra.textContent).toContain('"Supermercado" foi para a lixeira.')
    for (const b of within(barra).getAllByRole('button')) expect(b.className).toContain('min-h-11')
    await u.click(within(barra).getByRole('button', { name: 'Desfazer' }))
    expect(mock.restaurarDaLixeira).toHaveBeenCalledWith('t1')
    await waitFor(() => expect(screen.queryByTestId('barra-desfazer')).toBeNull())
  })

  it('item e: duas exclusões seguidas ficam na mesma barra; Desfazer restaura as duas; fechar só esconde', async () => {
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    const u = userEvent.setup()
    const linhas = (await screen.findAllByRole('button', { name: /^Ações de / })).slice(0, 2)
    const nomes = linhas.map((b) => b.getAttribute('aria-label')!.replace('Ações de ', ''))
    for (const nome of nomes) {
      const item = screen.getByRole('button', { name: `Ações de ${nome}` }).closest('li')!
      await u.click(within(item).getByRole('button', { name: `Ações de ${nome}` }))
      await u.click(within(item).getByRole('menuitem', { name: 'Excluir' }))
    }
    expect(window.confirm).not.toHaveBeenCalled()
    expect(mock.moverParaLixeira).toHaveBeenCalledTimes(2)
    const barra = await screen.findByTestId('barra-desfazer')
    expect(barra.textContent).toContain('2 lançamentos foram para a lixeira.')
    await u.click(within(barra).getByRole('button', { name: 'Desfazer' }))
    expect(mock.restaurarDaLixeira).toHaveBeenCalledTimes(2)
    // fechar sem desfazer: a barra some e nada é restaurado
    mock.restaurarDaLixeira.mockClear()
    const item = screen.getByRole('button', { name: `Ações de ${nomes[0]}` }).closest('li')!
    await u.click(within(item).getByRole('button', { name: `Ações de ${nomes[0]}` }))
    await u.click(within(item).getByRole('menuitem', { name: 'Excluir' }))
    await u.click(within(await screen.findByTestId('barra-desfazer')).getByRole('button', { name: 'Fechar aviso de exclusão' }))
    expect(screen.queryByTestId('barra-desfazer')).toBeNull()
    expect(mock.restaurarDaLixeira).not.toHaveBeenCalled()
  })

  it('Lixeira: o ⋯ do topo leva à tela de Lixeira, mesmo num mês sem lançamentos; a barra do Desfazer também tem o link', async () => {
    mock.listarLancamentos.mockResolvedValue([])
    const u = userEvent.setup()
    let caminho = ''
    const Caminho = () => { caminho = useLocation().pathname; return null }
    render(<MemoryRouter initialEntries={['/lancamentos']}><Lancamentos /><Caminho /></MemoryRouter>)
    await u.click(await screen.findByRole('button', { name: 'Mais ações da lista' }))
    expect(screen.getByRole('menuitem', { name: 'Selecionar lançamentos' }).hasAttribute('disabled')
      || screen.getByRole('menuitem', { name: 'Selecionar lançamentos' }).getAttribute('aria-disabled') === 'true').toBe(true)
    await u.click(screen.getByRole('menuitem', { name: 'Lixeira' }))
    expect(caminho).toBe('/lancamentos/lixeira')
  })

  it('Lixeira: depois de excluir, a barra do Desfazer tem "Ver lixeira"', async () => {
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    const u = userEvent.setup()
    const item = (await screen.findByText('Supermercado')).closest('li')!
    await u.click(within(item).getByRole('button', { name: 'Ações de Supermercado' }))
    await u.click(within(item).getByRole('menuitem', { name: 'Excluir' }))
    const barra = await screen.findByTestId('barra-desfazer')
    expect(within(barra).getByRole('link', { name: 'Ver lixeira' }).getAttribute('href')).toBe('/lancamentos/lixeira')
  })

  it('regra do banco aparece em português', async () => {
    mock.criarLancamento.mockRejectedValue({ code: '23514', message: 'conta de origem desativada' })
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    const u = userEvent.setup()
    await screen.findByText('Supermercado')
    await abrirNovo(u)
    await u.type(screen.getByLabelText('Valor (R$)'), '10')
    await escolherCategoria(u, screen.getByLabelText('Categoria'), 'mer')
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
    expect(within(item).getByText('−R$ 300,00').className).toContain('text-prejuizo') // saída: vermelha como a despesa
    expect(within(item).queryByRole('button', { name: 'Excluir' })).toBeNull()
    expect(within(item).getByRole('link', { name: 'Ver em Cartões' })).toBeTruthy()
    expect(screen.getByText(/Pagamento de fatura e amortização não são despesa/)).toBeTruthy()
    // os totais continuam os do banco (cash_flow_series, no rodapé): a linha do cartão não é somada em nada
    expect(within(screen.getByRole('region', { name: 'Totais do mês' })).getByText('−R$ 250,50')).toBeTruthy()
    // tarifa já é despesa: o selo diz isso e o texto separa de pagamento de fatura
    const tarifa = screen.getByText('Tarifa de Empréstimo').closest('li') as HTMLElement
    expect(within(tarifa).getByText('Cartão/dívida · já em despesas')).toBeTruthy()
    expect(screen.getByText(/Juros e tarifa são despesa/)).toBeTruthy()
    // os filtros chegam ao lib (que decide o que mostrar); a tela não esconde nada por conta própria
    await escolherTipo(u, 'expense')
    await vi.waitFor(() => expect(mock.listarMovimentosDeDivida).toHaveBeenLastCalledWith('h1', expect.any(String), expect.any(String), { tipo: 'expense' }))
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
    await escolherCategoria(u, screen.getByLabelText('Categoria'), 'mer')
    await u.click(screen.getByRole('button', { name: 'Registrar compra' }))
    expect(mock.registrarCompra).toHaveBeenCalledWith('k1',
      expect.objectContaining({ descricao: 'Fone', total: 30000, parcelas: 3, categoriaId: 'mer' }), expect.any(String))
    expect(mock.criarLancamento).not.toHaveBeenCalled()
  })

  it('trocar entre Despesa e Cartão de crédito mantém a categoria escolhida (as duas usam categorias de despesa)', async () => {
    const u = userEvent.setup()
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    await abrirNovo(u)
    // escolhe a categoria ainda em Despesa e só depois percebe que foi no cartão
    await escolherCategoria(u, screen.getByLabelText('Categoria'), 'mer')
    await u.click(screen.getByRole('radio', { name: 'Cartão de crédito' }))
    await u.type(screen.getByLabelText('Valor (R$)'), '80,00')
    await u.type(screen.getByLabelText('Descrição'), 'Feira')
    await u.selectOptions(screen.getByLabelText('Cartão'), 'k1')
    await u.click(screen.getByRole('button', { name: 'Registrar compra' }))
    expect(mock.registrarCompra).toHaveBeenCalledWith('k1', expect.objectContaining({ descricao: 'Feira', categoriaId: 'mer' }), expect.any(String))
  })

  it('trocar de Despesa para Receita limpa a categoria (categoria de despesa não vale para receita)', async () => {
    const u = userEvent.setup()
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    await abrirNovo(u)
    await escolherCategoria(u, screen.getByLabelText('Categoria'), 'mer')
    const escolhida = screen.getByLabelText('Categoria').textContent
    await u.click(screen.getByRole('radio', { name: 'Receita' }))
    expect(screen.getByLabelText('Categoria').textContent).not.toBe(escolhida)
  })

  it('Repetir no cartão cria a assinatura (regra de recorrente de cartão) e não uma compra solta', async () => {
    const u = userEvent.setup()
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    await abrirNovo(u)
    await u.click(screen.getByRole('radio', { name: 'Cartão de crédito' }))
    await u.type(screen.getByLabelText('Valor (R$)'), '55,90')
    await u.type(screen.getByLabelText('Descrição'), 'Netflix')
    await u.selectOptions(screen.getByLabelText('Cartão'), 'k1')
    await escolherCategoria(u, screen.getByLabelText('Categoria'), 'mer')
    fireEvent.change(screen.getByLabelText('Data da compra'), { target: { value: '2026-11-20' } })
    await u.click(screen.getByRole('button', { name: /Repetir/ }))
    expect(screen.queryByLabelText('Parcelas')).toBeNull() // assinatura não tem parcelas
    expect(screen.queryByRole('radio', { name: 'Lançamento parcelado' })).toBeNull()
    await u.click(screen.getByRole('button', { name: 'Criar assinatura' }))
    await waitFor(() => expect(mock.criarRecorrencia).toHaveBeenCalled())
    expect(mock.criarRecorrencia.mock.calls[0][0]).toMatchObject({
      tipo: 'card', descricao: 'Netflix', valor: 5590, dia: 20, unidade: 'month', cada: 1, inicio: '2026-11-20', fim: null,
      cartaoId: 'k1', contaId: null, destinoId: null, categoriaId: 'mer',
    })
    expect(mock.registrarCompra).not.toHaveBeenCalled()
    expect(mock.criarLancamento).not.toHaveBeenCalled()
  })

  it('Repetir no cartão a cada 30 dias (Meli+): cria a assinatura em dias, sem dia do mês', async () => {
    const u = userEvent.setup()
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    await abrirNovo(u)
    await u.click(screen.getByRole('radio', { name: 'Cartão de crédito' }))
    await u.type(screen.getByLabelText('Valor (R$)'), '39,90')
    await u.type(screen.getByLabelText('Descrição'), 'Meli+')
    await u.selectOptions(screen.getByLabelText('Cartão'), 'k1')
    await escolherCategoria(u, screen.getByLabelText('Categoria'), 'mer')
    fireEvent.change(screen.getByLabelText('Data da compra'), { target: { value: '2026-12-17' } })
    await u.click(screen.getByRole('button', { name: /Repetir/ }))
    const repetir = screen.getByRole('combobox', { name: 'Repetir' })
    expect(within(repetir).getByRole('option', { name: 'A cada 30 dias' })).toBeTruthy()
    await u.selectOptions(repetir, 'A cada 30 dias')
    await u.click(screen.getByRole('button', { name: 'Criar assinatura' }))
    await waitFor(() => expect(mock.criarRecorrencia).toHaveBeenCalled())
    // regra em dias: a unidade é "day", a cada 30, e não tem dia do mês (o dia 17 de hoje não vira "todo dia 17")
    expect(mock.criarRecorrencia.mock.calls[0][0]).toMatchObject({
      tipo: 'card', descricao: 'Meli+', valor: 3990, dia: null, unidade: 'day', cada: 30, inicio: '2026-12-17', fim: null, cartaoId: 'k1', categoriaId: 'mer',
    })
    expect(mock.registrarCompra).not.toHaveBeenCalled()
  })

  it('Repetir no cartão: "até" antes da data é recusado, e sem Repetir a compra parcelada segue como sempre', async () => {
    const u = userEvent.setup()
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    await abrirNovo(u)
    await u.click(screen.getByRole('radio', { name: 'Cartão de crédito' }))
    await u.type(screen.getByLabelText('Valor (R$)'), '10,00')
    await u.type(screen.getByLabelText('Descrição'), 'Spotify')
    await u.selectOptions(screen.getByLabelText('Cartão'), 'k1')
    await escolherCategoria(u, screen.getByLabelText('Categoria'), 'mer')
    fireEvent.change(screen.getByLabelText('Data da compra'), { target: { value: '2026-11-20' } })
    await u.click(screen.getByRole('button', { name: /Repetir/ }))
    fireEvent.change(screen.getByLabelText('Até (opcional)'), { target: { value: '2026-10-01' } })
    await u.click(screen.getByRole('button', { name: 'Criar assinatura' }))
    expect(screen.getByText(/O "até" não pode ser antes da data/)).toBeTruthy()
    expect(mock.criarRecorrencia).not.toHaveBeenCalled()
    // desligando o Repetir, volta a compra comum
    await u.click(screen.getByRole('button', { name: /Repetir/ }))
    await u.click(screen.getByRole('button', { name: 'Registrar compra' }))
    expect(mock.registrarCompra).toHaveBeenCalledTimes(1)
    expect(mock.criarRecorrencia).not.toHaveBeenCalled()
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
      // o cabeçalho do dia traz o dia da semana (e "Hoje"/"Ontem" quando for o caso); o ano some por ser o corrente
      expect(dia.getAttribute('aria-label')).toMatch(new RegExp(`, 28/${mesAtual().slice(5, 7)}$`))
      expect(within(item).getByText('R$ 456,78').className).toContain('text-prejuizo') // o total da fatura é saída
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
      expect(within(item).getByRole('link', { name: 'Ver fatura Nubank em Cartões' }).getAttribute('href')).toBe(`/cartoes/k1/fatura/${mesAtual()}`)
      expect((await within(item).findByText('R$ 100,00')).className).toContain('text-prejuizo') // cada compra da fatura aberta
      expect(within(item).queryByRole('button', { name: 'Excluir' })).toBeNull()
      expect(within(item).queryByRole('button', { name: 'Editar' })).toBeNull()
      expect(mock.listarFaturasDoMes).toHaveBeenCalledWith('h1', ...limitesDoMes(mesAtual()), {}, hojeSP())
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
      expect(within(fone).getByText('R$ 100,00').className).toContain('text-prejuizo')
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

    it('os totais do rodapé continuam os do banco (cash_flow_series): a fatura não é somada em nada na tela', async () => {
      mock.listarFaturasDoMes.mockResolvedValue([fatura()])
      render(<MemoryRouter><Lancamentos /></MemoryRouter>)
      await screen.findByText('Fatura Nubank')
      expect(within(screen.getByRole('region', { name: 'Totais do mês' })).getByText('−R$ 250,50')).toBeTruthy()
      expect(mock.serieFluxo).toHaveBeenCalledWith('h1', ...limitesDoMes(mesAtual()), 'total', { contas: undefined, incluirNaoPagos: false })
    })

    it('com filtro de categoria, as compras daquela categoria aparecem uma a uma (sem a linha da fatura)', async () => {
      mock.listarFaturasDoMes.mockResolvedValue([fatura()])
      mock.listarItens.mockResolvedValue(comprasDaFatura)
      const u = userEvent.setup()
      render(<MemoryRouter><Lancamentos /></MemoryRouter>)
      await screen.findByText('Fatura Nubank')
      await u.selectOptions(await campoFiltro('Filtrar por categoria'), 'mer')
      const fone = (await screen.findByText('Fone')).closest('li') as HTMLElement
      expect(screen.queryByText('Fatura Nubank')).toBeNull()
      expect(screen.queryByText('Livro')).toBeNull() // outra categoria
      expect(within(fone).getByText('No cartão')).toBeTruthy()
      expect(within(fone).getByText('Mercado')).toBeTruthy()
      expect(within(fone).getByText(/fatura Nubank · compra de 02\/01\/2026 · a despesa conta em 20\/.* \(fechamento da fatura\)/)).toBeTruthy()
      expect(within(fone).getByText('R$ 100,00').className).toContain('text-prejuizo')
      expect((fone.closest('section') as HTMLElement).getAttribute('aria-label')).toMatch(/, 28\//)
      expect(mock.listarFaturasDoMes).toHaveBeenLastCalledWith('h1', ...limitesDoMes(mesAtual()), { categoriaId: 'mer' }, hojeSP())
    })

    it('se as faturas falharem, a lista de conta continua e só o bloco avisa', async () => {
      mock.listarFaturasDoMes.mockRejectedValue(new Error('falhou'))
      render(<MemoryRouter><Lancamentos /></MemoryRouter>)
      expect(await screen.findByText('Supermercado')).toBeTruthy()
      expect(screen.getByText(/Não foi possível carregar as faturas dos cartões/)).toBeTruthy()
    })

    it('parcelas de empréstimo, totais em outras moedas e cartões que falham entram num aviso (não viram "sem dados")', async () => {
      mock.listarParcelasDivida.mockRejectedValue(new Error('x'))
      mock.resumoPorMoeda.mockRejectedValue(new Error('x'))
      mock.listarCartoes.mockRejectedValue(new Error('x'))
      render(<MemoryRouter><Lancamentos /></MemoryRouter>)
      expect(await screen.findByText('Supermercado')).toBeTruthy()
      const aviso = (await screen.findByTestId('lancamentos-blocos-falharam')).textContent ?? ''
      expect(aviso).toContain('parcelas de empréstimos e financiamentos')
      expect(aviso).toContain('totais em outras moedas')
      expect(aviso).toContain('lista de cartões')
    })

    it('sem falha nenhuma, não há aviso de bloco', async () => {
      render(<MemoryRouter><Lancamentos /></MemoryRouter>)
      expect(await screen.findByText('Supermercado')).toBeTruthy()
      expect(screen.queryByTestId('lancamentos-blocos-falharam')).toBeNull()
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
      expect(mock.listarCreditosDeCartao).toHaveBeenCalledWith('h1', ...limitesDoMes(mesAtual()), { tipo: 'income' }, hojeSP())
      expect((item.closest('section') as HTMLElement).getAttribute('aria-label')).toMatch(/, 18\//)
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
      await u.selectOptions(await campoFiltro('Filtrar por categoria'), 'sal')
      const item = (await screen.findByText('IOF')).closest('li') as HTMLElement
      expect(screen.queryByText('Fatura CAIXA INFINITE')).toBeNull()
      expect(screen.getByText('Ajuste de Crédito')).toBeTruthy()
      expect(screen.queryByText('Cashback')).toBeNull() // outra categoria
      expect((item.closest('section') as HTMLElement).getAttribute('aria-label')).toMatch(/, 28\//)
      expect(within(item).getByText(/fatura CAIXA INFINITE · crédito de 03\/.* · a receita conta em 18\//)).toBeTruthy()
      // sem filtro de tipo, a lista solta de "Receita" não é pedida: não duplica
      expect(mock.listarCreditosDeCartao).not.toHaveBeenCalled()
    })

    it('os totais do rodapé não mudam: vêm do banco (cash_flow_series)', async () => {
      mock.listarFaturasDoMes.mockResolvedValue([faturaComCredito()])
      mock.listarCreditosDaFatura.mockResolvedValue(creditosDaFatura)
      render(<MemoryRouter><Lancamentos /></MemoryRouter>)
      await screen.findByText('Fatura CAIXA INFINITE')
      expect(within(screen.getByRole('region', { name: 'Totais do mês' })).getByText('R$ 300,00')).toBeTruthy()
      expect(mock.serieFluxo).toHaveBeenCalledWith('h1', ...limitesDoMes(mesAtual()), 'total', { contas: undefined, incluirNaoPagos: false })
    })
  })

  describe('layout da linha na lista (abaixo de 1024px)', () => {
    it('valor em elemento próprio, sem quebra, fora do bloco do título; ações no menu ⋯ e "Marcar pago" em 1 toque', async () => {
      mock.listarLancamentos.mockResolvedValue(lancsComPlanejadoFuturo())
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
    expect(screen.getByRole('button', { name: 'Novo lançamento' })).toBeTruthy()
  })

  it('reenvio do mesmo cartão com outro valor usa outra chave (não grava 100 quando o usuário corrigiu para 120)', async () => {
    const u = userEvent.setup()
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    await abrirNovo(u)
    await u.click(screen.getByRole('radio', { name: 'Cartão de crédito' }))
    await u.type(screen.getByLabelText('Valor (R$)'), '100,00')
    await u.type(screen.getByLabelText('Descrição'), 'Fone')
    await u.selectOptions(screen.getByLabelText('Cartão'), 'k1')
    await escolherCategoria(u, screen.getByLabelText('Categoria'), 'mer')
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
    await escolherCategoria(u, screen.getByLabelText('Categoria'), 'mer')
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
    await escolherCategoria(u, screen.getByLabelText('Categoria'), 'sal')
    await u.click(screen.getByRole('radio', { name: 'Cartão de crédito' }))
    expect(screen.getByLabelText('Categoria').getAttribute('data-valor')).toBe('')
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
    await screen.findByRole('button', { name: 'Novo lançamento' })
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

  it('a lista carrega sem esperar as rotinas automáticas; se elas gravaram algo, a lista é lida de novo', async () => {
    let terminar: (v: unknown) => void = () => {}
    automaticos.atualizarAutomaticos.mockReset()
    automaticos.atualizarAutomaticos.mockReturnValue(new Promise((r) => { terminar = r }))
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    expect(await screen.findByText('Supermercado')).toBeTruthy()
    const antes = mock.listarLancamentos.mock.calls.length
    terminar({ recorrentesOk: true, faturasOk: true, mudou: true })
    await waitFor(() => expect(mock.listarLancamentos.mock.calls.length).toBeGreaterThan(antes))
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
    await u.click(await screen.findByRole('button', { name: 'Período anterior' }))
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
      await abrirFiltros()
      // Tipo, Situação, Contas e Cartões de crédito em grupos (chips e cartões); a categoria é o seletor no fim
      const grupos = within(screen.getByRole('dialog', { name: 'Filtrar lançamentos' })).getAllByRole('group').map((g) => g.querySelector('h3')?.textContent?.replace(/ \(\d\)$/, ''))
      expect(grupos).toEqual(['Tipo', 'Situação', 'Contas', 'Cartões de crédito'])
      expect(screen.getByLabelText('Filtrar por categoria')).toBeTruthy()
    })

    it('sem tipo mostra todas as categorias; com Despesa ou Receita, só as do tipo', async () => {
      const u = userEvent.setup()
      render(<MemoryRouter><Lancamentos /></MemoryRouter>)
      await screen.findByText('Supermercado')
      await campoFiltro('Filtrar por categoria')
      expect(opcoesDe('Filtrar por categoria')).toEqual(['Todas as categorias', 'Mercado (despesa)', 'Salário (receita)'])
      await escolherTipo(u, 'expense')
      expect(opcoesDe('Filtrar por categoria')).toEqual(['Todas as categorias', 'Mercado'])
      await escolherTipo(u, 'income')
      expect(opcoesDe('Filtrar por categoria')).toEqual(['Todas as categorias', 'Salário'])
    })

    it('trocar o tipo limpa a categoria incompatível e mantém conta e categoria compatível', async () => {
      const u = userEvent.setup()
      render(<MemoryRouter><Lancamentos /></MemoryRouter>)
      await screen.findByText('Supermercado')
      await escolherConta(u, 'Nubank')
      await u.selectOptions(await campoFiltro('Filtrar por categoria'), 'mer')
      await escolherTipo(u, 'expense') // compatível: continua
      await vi.waitFor(() => expect(mock.listarLancamentos).toHaveBeenLastCalledWith('h1', expect.any(String), expect.any(String), { contaId: 'a2', categoriaId: 'mer', tipo: 'expense' }))
      await escolherTipo(u, 'income') // incompatível: sai; a conta fica
      await vi.waitFor(() => expect(mock.listarLancamentos).toHaveBeenLastCalledWith('h1', expect.any(String), expect.any(String), { contaId: 'a2', categoriaId: undefined, tipo: 'income' }))
      expect((await campoFiltro('Filtrar por categoria')).value).toBe('')
    })

    it('Transferência não tem categoria: seletor desabilitado e categoria limpa', async () => {
      const u = userEvent.setup()
      render(<MemoryRouter><Lancamentos /></MemoryRouter>)
      await screen.findByText('Supermercado')
      await u.selectOptions(await campoFiltro('Filtrar por categoria'), 'mer')
      await escolherTipo(u, 'transfer')
      const categoria = await campoFiltro('Filtrar por categoria') as HTMLSelectElement
      expect(categoria.disabled).toBe(true)
      expect(opcoesDe('Filtrar por categoria')).toEqual(['Transferência não tem categoria'])
      await vi.waitFor(() => expect(mock.listarLancamentos).toHaveBeenLastCalledWith('h1', expect.any(String), expect.any(String), { categoriaId: undefined, tipo: 'transfer' }))
      await escolherTipo(u, '') // voltar a "todos" reabilita
      expect((await campoFiltro('Filtrar por categoria')).disabled).toBe(false)
    })

    it('"Novo lançamento" não mostra os filtros enquanto o formulário está aberto, e eles voltam ao cancelar', async () => {
      const u = userEvent.setup()
      render(<MemoryRouter><Lancamentos /></MemoryRouter>)
      await screen.findByText('Supermercado')
      await abrirFiltros()
      await abrirNovo(u)
      expect(screen.queryByRole('dialog', { name: 'Filtrar lançamentos' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Receitas' })).toBeNull()
      await u.click(screen.getByRole('button', { name: 'Cancelar' }))
      await abrirFiltros()
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
    // auditoria 5h: uma linha só também a 390px (flex sem grade de 2 colunas, sem quebra; "Transf." abreviado no celular)
    expect(abas.className).toMatch(/(^| )flex( |$)/)
    expect(abas.className).not.toContain('grid-cols-2')
    for (const r of within(abas).getAllByRole('radio')) expect(r.className).toContain('whitespace-nowrap')
    const transf = within(abas).getByRole('radio', { name: 'Transferência' })
    expect(within(transf).getByText('Transf.').className).toContain('sm:hidden')
    expect(within(transf).getByText('Transferência').className).toContain('hidden sm:inline')
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
    await escolherCategoria(u, screen.getByLabelText('Categoria'), 'mer')
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
    await escolherCategoria(u, screen.getByLabelText('Categoria'), 'mer')
    const chamadasAntes = mock.listarLancamentos.mock.calls.length
    await u.click(screen.getByRole('button', { name: 'Registrar e lançar outro' }))
    expect(mock.criarLancamento).toHaveBeenCalledWith('h1', expect.objectContaining({ valor: 2500, descricao: 'Pão', contaId: 'a2' }))
    expect(await screen.findByText(/Despesa registrada\./)).toBeTruthy()
    expect(mock.listarLancamentos.mock.calls.length).toBeGreaterThan(chamadasAntes)
    expect((screen.getByLabelText('Valor (R$)') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('Descrição') as HTMLInputElement).value).toBe('')
    expect(screen.getByLabelText('Categoria').getAttribute('data-valor')).toBe('')
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
    // a folha do seletor lista na mesma ordem de antes: principal e, logo abaixo, as subcategorias dela
    await u.click(screen.getByLabelText('Categoria'))
    const folha = screen.getByRole('dialog', { name: 'Selecionar uma categoria' })
    const opcoes = Array.from(folha.querySelectorAll('[data-categoria-id]')).map((o) => o.textContent)
    expect(opcoes).toEqual(['Outras receitas', 'Rendimentos', 'Royalty', 'Reembolso'])
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
    const opcoes = within(await campoFiltro('Filtrar por categoria')).getAllByRole('option').map((o) => o.textContent)
    expect(opcoes).toEqual(['Todas as categorias', 'Outras receitas (receita)', 'Rendimentos (receita)', 'Royalty (receita)', '↳ Reembolso (receita)'])
  })
  it('parcela planejada do contrato aparece no mês, marcada como planejada, com Baixar parcela, e fora dos totais', async () => {
    mock.listarParcelasDivida.mockResolvedValue([
      { id: 's3', dividaId: 'd1', nomeDivida: 'Financiamento do imóvel', numero: 3, vencimento: '2099-10-20', valor: c(150000), formaPagamento: 'account_debit', contaPagamentoId: 'a1' },
    ])
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    const linha = (await screen.findByText(/Financiamento do imóvel · parcela 3/)).closest('li')!
    expect(within(linha).getByText('Planejado · contrato')).toBeTruthy()
    expect(within(linha).getByText(/Débito em Itaú/)).toBeTruthy()
    expect(within(linha).getByText('−R$ 1.500,00').className).toContain('text-prejuizo')
    expect(within(linha).getByRole('link', { name: 'Baixar parcela 3 de Financiamento do imóvel' }).getAttribute('href')).toBe('/dividas?baixar=s3')
    expect(screen.getAllByText('−R$ 1.500,00')).toHaveLength(1) // só na linha: os totais continuam os do banco
    const [, de, ate] = mock.listarLancamentos.mock.calls[0]
    expect(mock.listarParcelasDivida).toHaveBeenCalledWith('h1', de, ate)
  })

  it('se a agenda de parcelas falhar, o resto do extrato aparece normalmente', async () => {
    mock.listarParcelasDivida.mockRejectedValue(new Error('sem a tabela'))
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    expect((await screen.findAllByText('−R$ 250,50')).length).toBe(2)
  })

describe('painel de lançamento (como no Organizze)', () => {
  it('"+ Lançamento" abre o menu com os quatro tipos, mais aporte e resgate; a escolha abre o painel por cima, que fecha no × e no Esc', async () => {
    const u = userEvent.setup()
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    await u.click(await screen.findByRole('button', { name: 'Novo lançamento' }))
    const menu = screen.getByRole('menu', { name: 'Novo lançamento' })
    expect(within(menu).getAllByRole('menuitem').map((b) => b.textContent)).toEqual([
      'Nova despesatecla D', 'Nova receitatecla R', 'Nova transferênciatecla T', 'Compra no cartãotecla C',
      'Aporte em investimentotecla A', 'Resgate de investimentotecla G',
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

  it('o menu do "+" é navegável pelo teclado: abre no primeiro item, setas andam, Esc fecha e devolve o foco ao botão', async () => {
    const u = userEvent.setup()
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    const botao = await screen.findByRole('button', { name: 'Novo lançamento' })
    await u.click(botao)
    const itens = within(screen.getByRole('menu', { name: 'Novo lançamento' })).getAllByRole('menuitem')
    expect(document.activeElement).toBe(itens[0])
    await u.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(itens[1])
    await u.keyboard('{End}')
    expect(document.activeElement).toBe(itens[5])
    await u.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(botao)
  })

  describe('aporte e resgate de investimento pelo "+" (pedido do dono, 10/11/2026)', () => {
    const cofrinho = { id: 'k1', nome: 'Cofrinho 140% CDI', ticker: null, classe: 'fixed_income', moeda: 'BRL', ativo: true, subclasse: null,
      liquidez: 'liquid', quantidadeOperacoes: 2, quantidadeAvaliacoes: 1, quantidadeProventos: 0 }
    beforeEach(() => {
      inv.listarAtivosInvestimento.mockResolvedValue([cofrinho, { ...cofrinho, id: 'k9', nome: 'Arquivado', ativo: false }])
      inv.registrarOperacaoPorValor.mockResolvedValue(undefined)
    })

    it('"Aporte" abre a folha de operação em Compra, só pelo valor; grava pelo banco e recarrega a lista', async () => {
      const u = userEvent.setup()
      render(<MemoryRouter><Lancamentos /></MemoryRouter>)
      await u.click(await screen.findByRole('button', { name: 'Novo lançamento' }))
      await u.click(screen.getByRole('menuitem', { name: /Aporte em investimento/ }))
      const folha = await screen.findByRole('dialog', { name: 'Registrar compra ou venda' })
      expect(inv.listarAtivosInvestimento).toHaveBeenCalledWith('h1')
      expect(within(folha).getByRole('radio', { name: 'Compra' }).getAttribute('aria-checked')).toBe('true')
      // só o ativo ativo entra na lista
      expect(Array.from((within(folha).getByLabelText('Ativo') as HTMLSelectElement).options).map((o) => o.textContent)).toEqual(['Cofrinho 140% CDI · BRL'])
      const antes = mock.listarLancamentos.mock.calls.length
      await u.type(within(folha).getByLabelText('Valor do aporte (BRL)'), '500,00')
      await u.click(within(folha).getByRole('button', { name: 'Registrar compra' }))
      expect(inv.registrarOperacaoPorValor).toHaveBeenCalledWith(expect.objectContaining({ ativoId: 'k1', tipo: 'buy', valor: 50000 }))
      await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      await vi.waitFor(() => expect(mock.listarLancamentos.mock.calls.length).toBeGreaterThan(antes))
    })

    it('tecla G abre o resgate (Venda); o erro do banco aparece dentro da folha, que continua aberta', async () => {
      inv.registrarOperacaoPorValor.mockRejectedValue(new Error('resgate maior que o valor do investimento nesta data (R$ 100,01)'))
      const u = userEvent.setup()
      render(<MemoryRouter><Lancamentos /></MemoryRouter>)
      await screen.findByRole('button', { name: 'Novo lançamento' })
      await u.keyboard('g')
      const folha = await screen.findByRole('dialog', { name: 'Registrar compra ou venda' })
      expect(within(folha).getByRole('radio', { name: 'Venda' }).getAttribute('aria-checked')).toBe('true')
      await u.type(within(folha).getByLabelText('Valor do resgate (BRL)'), '200,00')
      await u.click(within(folha).getByRole('button', { name: 'Registrar venda' }))
      expect(await within(folha).findByRole('alert')).toBeTruthy()
      expect(screen.getByRole('dialog', { name: 'Registrar compra ou venda' })).toBeTruthy()
    })

    it('sem nenhum investimento cadastrado, explica e leva a Investimentos (não abre um formulário vazio)', async () => {
      inv.listarAtivosInvestimento.mockResolvedValue([])
      const u = userEvent.setup()
      render(<MemoryRouter><Lancamentos /></MemoryRouter>)
      await screen.findByRole('button', { name: 'Novo lançamento' })
      await u.keyboard('a')
      const folha = await screen.findByRole('dialog', { name: 'Aporte em investimento' })
      expect(within(folha).getByText(/ainda não tem nenhum investimento cadastrado/)).toBeTruthy()
      expect(within(folha).getByRole('link', { name: 'Ir para Investimentos' }).getAttribute('href')).toBe('/investimentos')
    })

    it('?novo=aporte abre a folha direto (atalho vindo de outra tela)', async () => {
      render(<MemoryRouter initialEntries={['/lancamentos?novo=aporte']}><Lancamentos /></MemoryRouter>)
      expect(await screen.findByRole('dialog', { name: 'Registrar compra ou venda' })).toBeTruthy()
    })
  })

  it('atalhos: T abre transferência, C abre compra no cartão; dentro de um campo a tecla não abre nada', async () => {
    const u = userEvent.setup()
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    await screen.findByRole('button', { name: 'Novo lançamento' })
    await u.keyboard('t')
    expect(within(screen.getByRole('dialog')).getByRole('radio', { name: 'Transferência' }).getAttribute('aria-checked')).toBe('true')
    await u.keyboard('{Escape}')
    await u.keyboard('c')
    expect(within(screen.getByRole('dialog')).getByRole('radio', { name: 'Cartão de crédito' }).getAttribute('aria-checked')).toBe('true')
    await u.keyboard('{Escape}')
    await u.click(await screen.findByRole('button', { name: /^Filtrar/ }))
    await u.keyboard('d')
    // só a folha de filtros continua aberta: o formulário de lançamento não abriu
    expect(screen.queryByText('Novo lançamento', { selector: 'h2' })).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Filtrar lançamentos' })).toBeTruthy()
  })

  it('Repetir → lançamento fixo: cria a regra de recorrente (mensal no dia da data) e não um lançamento solto', async () => {
    const u = userEvent.setup()
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    await abrirNovo(u)
    const painel = screen.getByRole('dialog')
    await u.type(within(painel).getByLabelText('Descrição'), 'Internet')
    await u.type(within(painel).getByLabelText('Valor (R$)'), '120,00')
    await u.click(within(painel).getByLabelText('Categoria'))
    await u.click(within(screen.getByRole('dialog', { name: 'Selecionar uma categoria' })).getByRole('button', { name: 'Mercado' }))
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
    await escolherCategoria(u, within(painel).getByLabelText('Categoria'), 'mer')
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

  afterEach(() => { pessoasMock.listarPessoasFamilia.mockImplementation(() => Promise.resolve([])) })

  it('o valor informado é o total por padrão e diz isso; a sobra é explicada', async () => {
    const u = userEvent.setup()
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    const painel = await preencher(u, '10,00')
    const parcelas = within(painel).getByRole('spinbutton', { name: 'Parcelas' })
    await u.clear(parcelas)
    await u.type(parcelas, '3')
    expect((within(painel).getByRole('radio', { name: /O total/ }) as HTMLInputElement).checked).toBe(true)
    expect(within(painel).getByText(/cada parcela recebe a divisão/)).toBeTruthy()
    expect(within(painel).getByText('Em caso de divisão não exata, a sobra é somada à primeira parcela.')).toBeTruthy()
  })

  it('"O de cada parcela": o total enviado é o valor × as parcelas, sem sobra', async () => {
    const u = userEvent.setup()
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    const painel = await preencher(u, '198,39')
    const parcelas = within(painel).getByRole('spinbutton', { name: 'Parcelas' })
    await u.clear(parcelas)
    await u.type(parcelas, '3')
    await u.click(within(painel).getByRole('radio', { name: /O de cada parcela/ }))
    const previa = within(painel).getByTestId('previa-parcelas')
    expect(previa.textContent).toMatch(/3 parcelas de R\$ 198,39, total de R\$ 595,17/)
    expect(previa.textContent).not.toMatch(/a primeira de/)
    await u.click(within(painel).getByRole('button', { name: 'Lançar parcelas' }))
    await waitFor(() => expect(mock.criarParcelado).toHaveBeenCalled())
    expect(mock.criarParcelado.mock.calls[0][0]).toMatchObject({ total: 59517, parcelas: 3 })
  })

  it('"O de cada parcela" aceita valor pequeno (a regra do centavo por parcela vale só para dividir)', async () => {
    const u = userEvent.setup()
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    const painel = await preencher(u, '0,02')
    const parcelas = within(painel).getByRole('spinbutton', { name: 'Parcelas' })
    await u.clear(parcelas)
    await u.type(parcelas, '3')
    await u.click(within(painel).getByRole('radio', { name: /O de cada parcela/ }))
    await u.click(within(painel).getByRole('button', { name: 'Lançar parcelas' }))
    await waitFor(() => expect(mock.criarParcelado).toHaveBeenCalled())
    expect(mock.criarParcelado.mock.calls[0][0]).toMatchObject({ total: 6, parcelas: 3 })
  })

  it('a despesa parcelada nasce "Toda a família", mesmo com a pessoa do usuário cadastrada; escolher outra pessoa continua valendo', async () => {
    pessoasMock.listarPessoasFamilia.mockImplementation(() => Promise.resolve([
      { id: 'p-joao', nome: 'João', ativo: true, userId: 'u1' },
    ]))
    const u = userEvent.setup()
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    const painel = await preencher(u, '10,00')
    await u.click(within(painel).getByText('Opções avançadas · Pessoa responsável'))
    const quem = await within(painel).findByLabelText('Despesa de quem?') as HTMLSelectElement
    expect(quem.value).toBe('shared')
    await u.click(within(painel).getByRole('button', { name: 'Lançar parcelas' }))
    await waitFor(() => expect(mock.criarParcelado).toHaveBeenCalled())
    expect(mock.criarParcelado.mock.calls[0][0]).toMatchObject({ personId: null, isSharedExpense: true })
  })

  it('escolher uma pessoa no parcelado continua valendo (o padrão "Toda a família" não trava a escolha)', async () => {
    pessoasMock.listarPessoasFamilia.mockImplementation(() => Promise.resolve([
      { id: 'p-joao', nome: 'João', ativo: true, userId: 'u1' },
    ]))
    const u = userEvent.setup()
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    const painel = await preencher(u, '10,00')
    await u.click(within(painel).getByText('Opções avançadas · Pessoa responsável'))
    await u.selectOptions(await within(painel).findByLabelText('Despesa de quem?'), 'p-joao')
    await u.click(within(painel).getByRole('button', { name: 'Lançar parcelas' }))
    await waitFor(() => expect(mock.criarParcelado).toHaveBeenCalled())
    expect(mock.criarParcelado.mock.calls[0][0]).toMatchObject({ personId: 'p-joao', isSharedExpense: false })
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
    await escolherCategoria(u, screen.getByLabelText('Categoria'), 'mer')
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

describe('trocar "quem da família gastou" num lançamento de conta já passado e pago', () => {
  const mercado = { id: 'p1', tipo: 'expense', contaId: 'a1', destinoId: null, categoriaId: 'mer', descricao: 'Mercado antigo', valor: c(5000), data: '2026-08-10', status: 'paid', notas: '', recorrente: false, personId: null, isSharedExpense: false }
  afterEach(() => { pessoasMock.listarPessoasFamilia.mockImplementation(() => Promise.resolve([])) })

  it('o seletor aparece ao editar e grava a pessoa escolhida, sem mexer no valor, na data nem na situação', async () => {
    pessoasMock.listarPessoasFamilia.mockImplementation(() => Promise.resolve([
      { id: 'pe1', userId: null, familiaId: 'h1', nome: 'Ana', fotoUrl: null, nascimento: null, vinculo: 'Familiar', ativo: true, criadaEm: '', atualizadaEm: '' },
    ]))
    mock.listarLancamentos.mockResolvedValue([mercado])
    const u = userEvent.setup()
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    const item = (await screen.findByText('Mercado antigo')).closest('li') as HTMLElement
    await u.click(within(item).getByRole('button', { name: 'Ações de Mercado antigo' }))
    await u.click(within(item).getByRole('menuitem', { name: 'Editar' }))
    await u.click(screen.getByText('Opções avançadas · Pessoa responsável'))
    const select = await screen.findByLabelText('Despesa de quem?') as HTMLSelectElement
    expect(select.value).toBe('unassigned')
    await waitFor(() => expect(within(select).getByRole('option', { name: 'Ana' })).toBeTruthy())
    await u.selectOptions(select, 'pe1')
    await u.click(screen.getByRole('button', { name: 'Salvar alterações' }))
    await waitFor(() => expect(mock.editarLancamento).toHaveBeenCalledWith('p1', expect.objectContaining({
      personId: 'pe1', isSharedExpense: false, valor: 5000, data: '2026-08-10', status: 'paid',
    })))
  })
})

describe('Parar de repetir a partir daqui (recorrente de conta)', () => {
  const luz = { id: 't9', recorrenciaId: 'r1', tipo: 'expense', contaId: 'a1', destinoId: null, categoriaId: 'mer', descricao: 'Luz', valor: c(10000), data: '2026-12-10', status: 'planned', notas: '', recorrente: true }
  async function abrirMenu(l: Record<string, unknown>) {
    mock.listarLancamentos.mockResolvedValue([l])
    mock.pararDeRepetirAPartirDe.mockResolvedValue(undefined)
    const u = userEvent.setup()
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    const item = (await screen.findByText(l.descricao as string)).closest('li') as HTMLElement
    await u.click(within(item).getByRole('button', { name: `Ações de ${l.descricao as string}` }))
    return { u, item }
  }

  it('a ação só existe em lançamento que vem de um recorrente', async () => {
    const { item } = await abrirMenu({ ...luz, recorrente: false, recorrenciaId: null })
    expect(within(item).queryByRole('menuitem', { name: 'Parar de repetir a partir daqui' })).toBeNull()
  })

  it('pede confirmação e então encerra a série a partir desta data; recusar a confirmação não faz nada', async () => {
    const { u, item } = await abrirMenu(luz)
    ;(window.confirm as ReturnType<typeof vi.fn>).mockReturnValueOnce(false)
    await u.click(within(item).getByRole('menuitem', { name: 'Parar de repetir a partir daqui' }))
    expect(mock.pararDeRepetirAPartirDe).not.toHaveBeenCalled()
    await u.click(within(item).getByRole('button', { name: 'Ações de Luz' }))
    await u.click(within(item).getByRole('menuitem', { name: 'Parar de repetir a partir daqui' }))
    expect(window.confirm).toHaveBeenLastCalledWith(expect.stringContaining('Parar de repetir "Luz" a partir de 10/12/2026'))
    expect(mock.pararDeRepetirAPartirDe).toHaveBeenCalledWith('r1', '2026-12-10')
  })

  it('recusa do banco aparece na tela', async () => {
    const { u, item } = await abrirMenu(luz)
    mock.pararDeRepetirAPartirDe.mockRejectedValue(Object.assign(new Error('x'), { code: '55000' }))
    await u.click(within(item).getByRole('menuitem', { name: 'Parar de repetir a partir daqui' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
  })
})

describe('editar um lançamento recorrente pergunta "Apenas este / Este e os próximos" (#194)', () => {
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

  it('mudou a conta junto com o valor: a pergunta avisa que a conta vale só para este', async () => {
    const u = await editar(luz)
    await u.selectOptions(screen.getByLabelText('Conta'), 'a2')
    await mudarValorESalvar(u)
    const dialogo = await screen.findByRole('dialog', { name: 'Lançamento recorrente' })
    expect(within(dialogo).getByText('A troca de conta vale só para este lançamento.')).toBeTruthy()
  })

  it('sem trocar a conta: a pergunta não fala de conta', async () => {
    const u = await editar(luz)
    await mudarValorESalvar(u)
    const dialogo = await screen.findByRole('dialog', { name: 'Lançamento recorrente' })
    expect(within(dialogo).queryByText('A troca de conta vale só para este lançamento.')).toBeNull()
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

describe('auditoria de design e acessibilidade (5h)', () => {
  it('painel de lançamento: o foco começa no formulário, o Tab não sai, o Esc fecha e o foco volta ao "+ Lançamento"', async () => {
    const u = userEvent.setup()
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    const novo = await screen.findByRole('button', { name: 'Novo lançamento' })
    await u.click(novo)
    await u.click(screen.getByRole('menuitem', { name: /Nova despesa/ }))
    const painel = screen.getByRole('dialog', { name: 'Novo lançamento' })
    const form = painel.querySelector('form') as HTMLFormElement
    expect(form.contains(document.activeElement)).toBe(true)
    // o Tab dá a volta dentro do painel, nos dois sentidos
    const focaveis = Array.from(painel.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'))
    focaveis[focaveis.length - 1].focus()
    await u.tab()
    expect(document.activeElement).toBe(focaveis[0])
    await u.tab({ shift: true })
    expect(document.activeElement).toBe(focaveis[focaveis.length - 1])
    await u.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Novo lançamento' }))
  })

  it('editar pelo menu ⋯: ao fechar, o foco volta para o ⋯ da linha', async () => {
    const u = userEvent.setup()
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    const menu = await screen.findByRole('button', { name: 'Ações de Supermercado' })
    await u.click(menu)
    await u.click(screen.getByRole('menuitem', { name: 'Editar' }))
    const painel = screen.getByRole('dialog', { name: 'Editar lançamento' })
    expect(painel.contains(document.activeElement)).toBe(true)
    await u.click(within(painel).getByRole('button', { name: 'Fechar' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Ações de Supermercado' }))
  })

  it('botão "+" flutuante (pedido do dono, 10/11/2026): fica preso acima do rodapé, o menu abre para cima e para a esquerda (não sai da tela) e esconde a dica de tecla em tela pequena/toque', async () => {
    const u = userEvent.setup()
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    const mais = await screen.findByRole('button', { name: 'Novo lançamento' })
    expect(within(screen.getByRole('region', { name: 'Totais do mês' })).getByRole('button', { name: 'Novo lançamento' })).toBe(mais)
    expect(mais.className).toContain('rounded-full')
    await u.click(mais)
    const menu = screen.getByRole('menu', { name: 'Novo lançamento' })
    expect(menu.className).toContain('bottom-full')
    expect(menu.className).toMatch(/(^| )right-0( |$)/)
    const dica = within(menu).getByText('tecla D')
    expect(dica.className).toMatch(/(^| )hidden( |$)/)
    expect(dica.className).toContain('sm:inline')
    expect(dica.className).toContain('[@media(pointer:coarse)]:hidden')
    // ‹ › do mês com alvo de toque de 44px
    expect(screen.getByRole('button', { name: 'Período anterior' }).className).toContain('min-w-11')
    expect(screen.getByRole('button', { name: 'Próximo período' }).className).toContain('min-w-11')
  })

  it('lista do celular: planejado com data passada é "Vencido" em vermelho (não "Planejado" verde); o futuro continua Planejado', async () => {
    const futuro = { ...lancs[1], id: 't9', descricao: 'Aluguel', data: '2099-10-05' }
    mock.listarLancamentos.mockResolvedValue([...lancs, futuro]) // t2 (Salário) é planejado de 05/10/2026: já passou
    mock.listarParcelasDivida.mockResolvedValue([
      { id: 's1', dividaId: 'd1', nomeDivida: 'Financiamento', numero: 1, vencimento: '2026-01-20', valor: c(1000), formaPagamento: 'boleto', contaPagamentoId: null },
    ])
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    const linha = (await screen.findByText('Salário', { selector: '.line-clamp-2' })).closest('li') as HTMLElement
    const selo = within(linha).getByText('Vencido')
    expect(selo.className).toContain('bg-prejuizo-fundo text-prejuizo')
    expect(within(linha).queryByText('Planejado')).toBeNull()
    const aluguel = screen.getByText('Aluguel').closest('li') as HTMLElement
    expect(within(aluguel).getByText('Planejado').className).toContain('bg-agendado-fundo text-agendado')
    const contrato = screen.getByText(/Financiamento · parcela 1/).closest('li') as HTMLElement
    expect(within(contrato).getByText('Vencido · contrato').className).toContain('text-prejuizo')
  })

  it('lista do celular: os selos não encolhem e a categoria é que corta com reticências', async () => {
    mock.listarLancamentos.mockResolvedValue(lancsComPlanejadoFuturo())
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    const linha = (await screen.findByText('Salário', { selector: '.line-clamp-2' })).closest('li') as HTMLElement
    const meta = linha.querySelector('[data-metadados]') as HTMLElement
    expect(within(meta).getByText('Planejado').className).toContain('shrink-0')
    const categoria = within(meta).getByText('Salário').closest('[data-categoria]') as HTMLElement
    expect(categoria.className).toContain('min-w-0')
    expect(categoria.className).toContain('truncate')
    expect(categoria.className).not.toContain('shrink-0')
  })

  it('celular e iPad em pé (conferência de 17/11): categoria e conta numa linha, os selos na de baixo; do lg em diante, uma linha só', async () => {
    mock.listarLancamentos.mockResolvedValue(lancsComPlanejadoFuturo())
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    const linha = (await screen.findByText('Salário', { selector: '.line-clamp-2' })).closest('li') as HTMLElement
    const meta = linha.querySelector('[data-metadados]') as HTMLElement
    expect(meta.className).toContain('flex-col')
    expect(meta.className).toContain('lg:flex-row')
    const categoria = meta.querySelector('[data-categoria]') as HTMLElement
    const conta = meta.querySelector('[data-conta]') as HTMLElement
    const selo = within(meta).getByText('Planejado')
    // categoria e conta dividem a mesma linha; o selo mora em outra (antes os três disputavam ~60 px a 390 px)
    expect(categoria.parentElement).toBe(conta.parentElement)
    expect(selo.parentElement).not.toBe(categoria.parentElement)
    // a conta guarda até metade da linha no celular (não vira "Caix…") e, do lg em diante, sem limite
    expect(conta.className).toContain('max-w-[50%]')
    expect(conta.className).toContain('lg:max-w-none')
    // a leitura continua "categoria · conta · selo"
    expect(meta.textContent).toMatch(/Salário.*·Itaú·Planejado/)
  })

  it('no celular o botão Filtrar mostra só o ícone (o ⋯ da lista saía da tela a 390 px)', async () => {
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    await screen.findByText('Supermercado')
    const filtrar = screen.getByRole('button', { name: 'Filtrar' })
    expect(within(filtrar).getByText('Filtrar').className).toContain('hidden sm:inline')
    expect(screen.getByRole('button', { name: 'Mais ações da lista' })).toBeTruthy()
  })
})

describe('Lançamentos: período livre (etapa 3 do Organizze)', () => {
  it('escolher "Esta semana" carrega só a semana (segunda a domingo) e ‹ › andam uma semana por vez', async () => {
    const { segundaDaSemana, somarDias } = await import('../lib/periodoRelatorio')
    const u = userEvent.setup()
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    await waitFor(() => expect(mock.listarLancamentos).toHaveBeenCalled())
    const hoje = hojeSP()
    const s = segundaDaSemana(hoje)
    await u.click(screen.getByRole('button', { name: /Trocar período/ }))
    await u.click(screen.getByRole('button', { name: /Esta semana/ }))
    await waitFor(() => expect(mock.listarLancamentos).toHaveBeenLastCalledWith('h1', s, somarDias(s, 6), {}))
    await u.click(screen.getByRole('button', { name: 'Período anterior' }))
    await waitFor(() => expect(mock.listarLancamentos).toHaveBeenLastCalledWith('h1', somarDias(s, -7), somarDias(s, -1), {}))
    // a lista de faturas e o rodapé seguem o mesmo intervalo, não o mês
    expect(mock.listarFaturasDoMes).toHaveBeenLastCalledWith('h1', somarDias(s, -7), somarDias(s, -1), {}, hoje)
  })

  it('o período não tem mais ‹ › de mês: o seletor é o do relatório (Período: …)', async () => {
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    await waitFor(() => expect(mock.listarLancamentos).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: 'Mês anterior' })).toBeNull()
    expect(screen.getByRole('button', { name: /Período: .*Trocar período/ })).toBeTruthy()
  })
})

describe('Lançamentos: filtros em tela cheia (situação, cartão, fixos e parcelados)', () => {
  it('Pendente e Resolvido filtram os lançamentos pelo status (o banco faz a conta)', async () => {
    const u = userEvent.setup()
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    await screen.findByText('Supermercado')
    await abrirFiltros()
    await u.click(screen.getByRole('button', { name: 'Pendente' }))
    await vi.waitFor(() => expect(mock.listarLancamentos).toHaveBeenLastCalledWith('h1', expect.any(String), expect.any(String), { situacao: 'planned' }))
    await u.click(screen.getByRole('button', { name: 'Resolvido' }))
    await vi.waitFor(() => expect(mock.listarLancamentos).toHaveBeenLastCalledWith('h1', expect.any(String), expect.any(String), { situacao: 'paid' }))
    expect(screen.getByRole('button', { name: 'Resolvido' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Pendente' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('Lançamentos fixos e parcelados viram filtros; o selo mostra e tira', async () => {
    const u = userEvent.setup()
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    await screen.findByText('Supermercado')
    await abrirFiltros()
    await u.click(screen.getByRole('button', { name: 'Lançamentos fixos' }))
    await u.click(screen.getByRole('button', { name: 'Lançamentos parcelados' }))
    await vi.waitFor(() => expect(mock.listarLancamentos).toHaveBeenLastCalledWith('h1', expect.any(String), expect.any(String), { soFixos: true, soParcelados: true }))
    await u.click(screen.getByRole('button', { name: 'Filtrar: ver os lançamentos' }))
    const selos = screen.getByRole('list', { name: 'Filtros ligados' })
    expect(within(selos).getAllByRole('button').map((b) => b.textContent)).toEqual(['Fixos×', 'Parcelados×'])
    await u.click(within(selos).getByRole('button', { name: 'Tirar o filtro Fixos' }))
    await vi.waitFor(() => expect(mock.listarLancamentos).toHaveBeenLastCalledWith('h1', expect.any(String), expect.any(String), { soParcelados: true }))
  })

  it('com um cartão escolhido, a tela mostra só as faturas dele: os lançamentos e as outras linhas somem', async () => {
    const u = userEvent.setup()
    mock.listarFaturasDoMes.mockResolvedValue([{ cartaoId: 'k1', cartaoNome: 'Nubank', mes: '2026-10', fechamento: '2026-10-17', vencimento: '2026-10-25', total: c(45000), pago: c(0), itens: 2, creditos: c(0), situacao: 'fechada', contaPagamentoId: 'a1' }])
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    await screen.findByText('Supermercado')
    await abrirFiltros()
    await u.click(within(screen.getByRole('group', { name: 'Cartões de crédito' })).getByRole('button', { name: 'Nubank' }))
    await vi.waitFor(() => expect(screen.queryByText('Supermercado')).toBeNull())
    expect(screen.getByText('Fatura Nubank')).toBeTruthy()
    expect(screen.queryByText('Luz')).toBeNull()
  })

  it('com situação, cartão, fixos ou parcelados o rodapé mostra o total do filtro (do banco) e a nota diz o que entra', async () => {
    const u = userEvent.setup()
    // sentinelas: não batem com nenhuma soma da lista (a tela não soma dinheiro)
    mock.totaisDaBusca.mockResolvedValue([{ moeda: 'BRL', quantidade: 1, entradas: c(0), saidas: c(77777) }])
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    await screen.findByText('Supermercado')
    await abrirFiltros()
    await u.click(screen.getByRole('button', { name: 'Pendente' }))
    await u.click(screen.getByRole('button', { name: 'Filtrar: ver os lançamentos' }))
    const rodape = screen.getByRole('region', { name: 'Totais do mês' })
    expect(await within(rodape).findByText('−R$ 777,77')).toBeTruthy()
    // sem texto: o banco recebe nulo e só os filtros
    await vi.waitFor(() => expect(mock.totaisDaBusca).toHaveBeenLastCalledWith('h1', expect.any(String), expect.any(String), null, { situacao: 'planned' }))
    expect(mock.buscarNoPeriodo).not.toHaveBeenCalled() // sem busca, a lista segue a consulta normal
    expect(within(rodape).queryByText('entradas previstas')).toBeNull()
    expect(screen.getByTestId('nota-filtro').textContent).toMatch(/Juros, tarifa, parcelas de empréstimo,\s+pagamento de fatura e créditos do cartão aparecem na lista, mas não entram no total/)
  })

  it('cartão + categoria: a lista mostra as compras da categoria só desse cartão (antes ficava vazia com o total embaixo)', async () => {
    const fat = (cartaoId: string) => ({ cartaoId, cartaoNome: cartaoId === 'k1' ? 'Nubank' : 'Outro', mes: '2026-10', fechamento: '2026-10-17', vencimento: '2026-10-25', total: c(45000), pago: c(0), itens: 1, creditos: c(0), situacao: 'fechada', contaPagamentoId: 'a1' })
    mock.listarFaturasDoMes.mockResolvedValue([fat('k1'), fat('k2')])
    mock.listarItens.mockImplementation(async (cartaoId: string) => [{ parcelaId: `p-${cartaoId}`, compra: 'c', parcela: 1, deParcelas: 1, descricao: cartaoId === 'k1' ? 'Mercado do Nubank' : 'Mercado do outro', dataCompra: '2026-10-02', valor: c(5000), falta: c(0), categoriaId: 'mer' }])
    mock.totaisDaBusca.mockResolvedValue([{ moeda: 'BRL', quantidade: 1, entradas: c(0), saidas: c(5000) }])
    render(<MemoryRouter initialEntries={['/?mes=2026-10&cartao=k1&categoria=mer']}><Lancamentos /></MemoryRouter>)
    expect(await screen.findByText('Mercado do Nubank')).toBeTruthy()
    expect(screen.queryByText('Mercado do outro')).toBeNull() // só as compras do cartão escolhido
    expect(screen.queryByText(/Nenhum lançamento com esses filtros/)).toBeNull()
    expect(await screen.findByTestId('totais-busca')).toBeTruthy()
  })

  it('nota do total do filtro: cartão por compra, e juros, tarifa, empréstimo, pagamento de fatura e créditos do cartão fora do total', async () => {
    render(<MemoryRouter initialEntries={['/?mes=2026-10&tipo=receita']}><Lancamentos /></MemoryRouter>)
    const nota = await screen.findByTestId('nota-filtro')
    expect(nota.textContent).toMatch(/compra por compra, no vencimento da fatura/)
    expect(nota.textContent).toMatch(/créditos do cartão aparecem na lista, mas não entram no total/)
  })

  it('faturas que falham: o total some só quando o filtro usa o cartão (situação é só de lançamento)', async () => {
    mock.listarFaturasDoMes.mockRejectedValue(new Error('timeout'))
    mock.totaisDaBusca.mockResolvedValue([{ moeda: 'BRL', quantidade: 1, entradas: c(0), saidas: c(1234) }])
    const { unmount } = render(<MemoryRouter initialEntries={['/?mes=2026-10&tipo=despesa']}><Lancamentos /></MemoryRouter>)
    expect(await screen.findByText('Total do filtro indisponível agora. A lista continua certa.')).toBeTruthy()
    unmount()
    render(<MemoryRouter initialEntries={['/?mes=2026-10&situacao=pendente']}><Lancamentos /></MemoryRouter>)
    expect(await screen.findByTestId('totais-busca')).toBeTruthy()
  })

  it('sem filtro nenhum, a lista no teto de linhas também avisa (o teto não é silencioso)', async () => {
    mock.listarLancamentos.mockResolvedValue(Array.from({ length: TETO_LINHAS_LISTA }, (_, i) => ({ ...lancs[0], id: `y${i}`, descricao: `Linha ${i}` })))
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    expect(await screen.findByText('Linha 0')).toBeTruthy()
    expect((await screen.findByTestId('busca-cortada')).textContent).toMatch(/Este período tem mais lançamentos do que a lista consegue trazer/)
    expect(mock.totaisDaBusca).not.toHaveBeenCalled() // sem filtro, o rodapé normal (do banco) segue como era
  })

  it('só conta como filtro: o rodapé normal continua (o banco já segue a conta)', async () => {
    const u = userEvent.setup()
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    await screen.findByText('Supermercado')
    await escolherConta(u, 'Itaú')
    await vi.waitFor(() => expect(mock.serieFluxo).toHaveBeenLastCalledWith('h1', expect.any(String), expect.any(String), 'total', expect.objectContaining({ contas: ['a1'] })))
    expect(mock.totaisDaBusca).not.toHaveBeenCalled()
    expect(screen.queryByTestId('nota-filtro')).toBeNull()
  })

  it('filtro com a lista no teto de linhas lidas por página (50 mil): o total some e a tela avisa (a lista está incompleta)', async () => {
    const u = userEvent.setup()
    mock.listarLancamentos.mockResolvedValue(Array.from({ length: TETO_LINHAS_LISTA }, (_, i) => ({ ...lancs[0], id: `x${i}`, descricao: `Linha ${i}` })))
    mock.totaisDaBusca.mockResolvedValue([{ moeda: 'BRL', quantidade: 1500, entradas: c(0), saidas: c(99999999) }])
    render(<MemoryRouter><Lancamentos /></MemoryRouter>)
    await screen.findByText('Linha 0')
    await abrirFiltros()
    await u.click(screen.getByRole('button', { name: 'Pendente' }))
    await u.click(screen.getByRole('button', { name: 'Filtrar: ver os lançamentos' }))
    const rodape = screen.getByRole('region', { name: 'Totais do mês' })
    expect(await within(rodape).findByText(/Sem total: a lista ficou incompleta neste período/)).toBeTruthy()
    expect(screen.getByTestId('busca-cortada').textContent).toMatch(/Este filtro tem mais lançamentos/)
    expect(within(rodape).queryByText(/999\.999,99/)).toBeNull()
  })
})


describe('Lançamentos: busca (handoff, PR 2; decisões do dono de 17/11/2026)', () => {
  const fatura = { cartaoId: 'k1', cartaoNome: 'Nubank', mes: '2026-10', fechamento: '2026-10-17', vencimento: '2026-10-25', total: c(45000), pago: c(0), itens: 2, creditos: c(0), situacao: 'fechada', contaPagamentoId: 'a1' }
  const item = (parcelaId: string, descricao: string, valor: number) => ({
    parcelaId, compra: `c-${parcelaId}`, parcela: 1, deParcelas: 1, descricao, dataCompra: '2026-10-02', valor: c(valor), falta: c(0), categoriaId: 'mer',
  })
  const caixa = () => screen.findByRole('searchbox', { name: 'Buscar na descrição ou na observação' })
  const montar = (rota = '/?mes=2026-10') => render(<MemoryRouter initialEntries={[rota]}><Lancamentos /></MemoryRouter>)

  beforeEach(() => {
    mock.listarFaturasDoMes.mockResolvedValue([fatura])
    mock.listarItens.mockResolvedValue([item('p1', 'Supermercado no cartão', 30000), item('p2', 'Padaria', 15000)])
  })

  it('depois de uma pausa na digitação o banco procura com o período e os filtros; a lista fica só com o achado e o rodapé com o total do banco', async () => {
    const u = userEvent.setup()
    mock.buscarNoPeriodo.mockResolvedValue({ lancamentos: new Set(['t1']), cartao: new Set(['p1']) })
    // sentinelas: não batem com nenhuma soma da lista (a tela não soma dinheiro)
    mock.totaisDaBusca.mockResolvedValue([
      { moeda: 'BRL', quantidade: 1, entradas: c(1234), saidas: c(99999) },
      { moeda: 'USD', quantidade: 1, entradas: c(0), saidas: c(1000) },
    ])
    montar()
    expect(await screen.findByText('Fatura Nubank')).toBeTruthy()
    await u.type(await caixa(), 'super')
    await vi.waitFor(() => expect(mock.buscarNoPeriodo).toHaveBeenCalledWith('h1', '2026-10-01', '2026-10-31', 'super', { busca: 'super' }))
    expect(mock.buscarNoPeriodo).toHaveBeenCalledTimes(1) // uma busca só, depois da pausa (não uma por letra)
    expect(mock.totaisDaBusca).toHaveBeenCalledWith('h1', '2026-10-01', '2026-10-31', 'super', { busca: 'super' })
    await vi.waitFor(() => expect(screen.queryByText('Salário')).toBeNull())
    expect(screen.getByText('Supermercado')).toBeTruthy()
    // a compra do cartão sai solta (a fatura não aparece), só a achada
    expect(screen.getByText('Supermercado no cartão')).toBeTruthy()
    expect(screen.queryByText('Padaria')).toBeNull()
    expect(screen.queryByText('Fatura Nubank')).toBeNull()
    expect(screen.getByTestId('nota-busca').textContent).toMatch(/Pagamento de fatura, parcelas de empréstimo e créditos do cartão não entram/)
    const totais = await screen.findByTestId('totais-busca')
    expect(within(totais).getByText('itens').nextSibling?.textContent).toBe('2') // todos os itens da lista (1 em reais, 1 em dólar), não só os de reais
    expect(within(totais).getByText('R$ 12,34')).toBeTruthy()
    expect(within(totais).getByText('−R$ 999,99')).toBeTruthy()
    expect(within(totais).getByTestId('totais-busca-outras-moedas').textContent).toMatch(/^Em USD, à parte dos valores acima: 1 item · saídas −US\$\s10,00$/)
  })

  it('a busca vai com os outros filtros (aqui, o tipo) e fica no endereço: abrir com ?busca= já procura e preenche a caixa', async () => {
    mock.buscarNoPeriodo.mockResolvedValue({ lancamentos: new Set(['t1']), cartao: new Set() })
    montar('/?mes=2026-10&tipo=despesa&busca=Flóra')
    expect(((await caixa()) as HTMLInputElement).value).toBe('Flóra')
    await vi.waitFor(() => expect(mock.buscarNoPeriodo).toHaveBeenCalledWith('h1', '2026-10-01', '2026-10-31', 'Flóra', { busca: 'Flóra', tipo: 'expense' }))
  })

  it('nada encontrado: diz o texto e oferece apagar a busca, que traz a lista de volta sem procurar de novo', async () => {
    const u = userEvent.setup()
    montar('/?mes=2026-10&busca=xyz')
    expect(await screen.findByText('Nada encontrado para "xyz"')).toBeTruthy()
    expect(screen.queryByText(/Nenhum lançamento neste mês/)).toBeNull()
    mock.buscarNoPeriodo.mockClear()
    await u.click(screen.getByRole('button', { name: 'Apagar a busca' }))
    expect(await screen.findByText('Supermercado')).toBeTruthy()
    expect(screen.getByText('Fatura Nubank')).toBeTruthy()
    expect(mock.buscarNoPeriodo).not.toHaveBeenCalled()
    expect(((await caixa()) as HTMLInputElement).value).toBe('')
  })

  it('banco ainda sem a migration 138: avisa que a busca não está disponível (não finge "nada encontrado")', async () => {
    mock.buscarNoPeriodo.mockResolvedValue(null)
    mock.totaisDaBusca.mockResolvedValue(null)
    montar('/?mes=2026-10&busca=super')
    expect(await screen.findByText('A busca ainda não está disponível. Apague o texto para ver a lista.')).toBeTruthy()
    expect(screen.queryByText(/Nada encontrado/)).toBeNull()
    expect(screen.queryByText('Supermercado')).toBeNull()
    expect(screen.queryByTestId('totais-busca')).toBeNull()
  })

  it('total da busca que falha não derruba a lista: o rodapé avisa', async () => {
    mock.buscarNoPeriodo.mockResolvedValue({ lancamentos: new Set(['t1']), cartao: new Set() })
    mock.totaisDaBusca.mockRejectedValue(new Error('rede'))
    montar('/?mes=2026-10&busca=super')
    expect(await screen.findByText('Supermercado')).toBeTruthy()
    expect(await screen.findByText('Total da busca indisponível agora. A lista continua certa.')).toBeTruthy()
  })

  it('lista cortada pelo servidor (menos itens na tela do que no total do banco): os valores somem e a tela avisa (revisor-dinheiro, #418)', async () => {
    mock.buscarNoPeriodo.mockResolvedValue({ lancamentos: new Set(['t1']), cartao: new Set() })
    // o banco achou 5 itens, mas a lista do período só trouxe 1 deles (corte de 1000 linhas em período longo)
    mock.totaisDaBusca.mockResolvedValue([{ moeda: 'BRL', quantidade: 5, entradas: c(0), saidas: c(96102) }])
    montar('/?mes=2026-10&busca=super')
    expect(await screen.findByText('Supermercado')).toBeTruthy()
    expect(await screen.findByTestId('busca-cortada')).toBeTruthy()
    const rodape = screen.getByRole('region', { name: 'Totais do mês' })
    expect(within(rodape).getByText(/Sem total: a lista ficou incompleta neste período/)).toBeTruthy()
    expect(screen.queryByTestId('totais-busca')).toBeNull()
    expect(within(rodape).queryByText(/961,02/)).toBeNull()
  })

  it('contagem da lista igual à do banco: sem aviso e com o total', async () => {
    mock.buscarNoPeriodo.mockResolvedValue({ lancamentos: new Set(['t1']), cartao: new Set() })
    mock.totaisDaBusca.mockResolvedValue([{ moeda: 'BRL', quantidade: 1, entradas: c(0), saidas: c(25050) }])
    montar('/?mes=2026-10&busca=super')
    expect(await screen.findByTestId('totais-busca')).toBeTruthy()
    expect(screen.queryByTestId('busca-cortada')).toBeNull()
  })

  it('faturas do cartão que falham: o total da busca não aparece (ele soma compras que a lista não mostra)', async () => {
    mock.listarFaturasDoMes.mockRejectedValue(new Error('timeout'))
    mock.buscarNoPeriodo.mockResolvedValue({ lancamentos: new Set(['t1']), cartao: new Set(['p1']) })
    mock.totaisDaBusca.mockResolvedValue([{ moeda: 'BRL', quantidade: 2, entradas: c(0), saidas: c(34734) }])
    montar('/?mes=2026-10&busca=flora')
    expect(await screen.findByText('Supermercado')).toBeTruthy()
    expect(await screen.findByText('Total da busca indisponível agora. A lista continua certa.')).toBeTruthy()
    expect(screen.queryByTestId('totais-busca')).toBeNull()
    expect(screen.queryByTestId('busca-cortada')).toBeNull()
  })

  it('"Limpar filtros" da folha tira os filtros e mantém o texto da busca', async () => {
    const u = userEvent.setup()
    montar('/?mes=2026-10&tipo=despesa&busca=super')
    await caixa()
    await abrirFiltros()
    await u.click(screen.getByRole('button', { name: 'Limpar filtros' }))
    await vi.waitFor(() => expect(mock.buscarNoPeriodo).toHaveBeenLastCalledWith('h1', '2026-10-01', '2026-10-31', 'super', { busca: 'super' }))
  })
})


describe('Lançamentos: observação, logo do banco e carregar sozinho (pedido do dono, 17/11/2026)', () => {
  const linha = (titulo: string) => screen.getByText(titulo).closest('li') as HTMLElement
  const montar = () => render(<MemoryRouter initialEntries={['/?mes=2026-10']}><Lancamentos /></MemoryRouter>)

  it('observação: uma linha com o ícone e o texto (espaços e quebras viram um espaço); sem observação, nada', async () => {
    mock.listarLancamentos.mockResolvedValue([
      { ...lancs[0], notas: 'cobrança em dobro\n  conferir com o banco' },
      { ...lancs[0], id: 't8', descricao: 'Padaria', notas: '' },
    ])
    montar()
    await screen.findByText('Supermercado')
    const nota = linha('Supermercado').querySelector('[data-nota]') as HTMLElement
    expect(nota.textContent).toBe('Observação: cobrança em dobro conferir com o banco')
    expect(nota.getAttribute('title')).toBe('cobrança em dobro conferir com o banco')
    expect(nota.querySelector('.truncate')).not.toBeNull() // uma linha só, cortada com reticências
    expect(linha('Padaria').querySelector('[data-nota]')).toBeNull()
  })

  it('logo no lugar do nome quando a conta é a única do banco; o nome fica para o leitor de tela e no title', async () => {
    montar()
    await screen.findByText('Supermercado')
    const conta = linha('Supermercado').querySelector('[data-conta]') as HTMLElement
    expect(conta.querySelector('[data-banco="itau"]')).not.toBeNull()
    expect(conta.querySelector('.sr-only')!.textContent).toBe('Itaú')
    expect(conta.querySelector('[title="Itaú"]')).not.toBeNull()
    expect(conta.querySelector('.truncate')).toBeNull() // sem o nome escrito
  })

  it('duas contas do mesmo banco: logo e nome (o logo sozinho não diz qual é); conta sem banco reconhecido: só o nome', async () => {
    mock.listarContas.mockResolvedValue({
      contas: [
        { ...contas[0], nome: 'Itaú corrente', banco: 'itau' },
        { ...contas[1], nome: 'Itaú poupança', banco: 'itau' },
        { id: 'a3', nome: 'Reserva da casa', tipo: 'checking', saldoInicial: c(0), abertura: '2026-10-01', ativa: true, saldo: c(0), banco: null, moeda: 'BRL' },
      ],
      total: c(0),
    })
    mock.listarLancamentos.mockResolvedValue([
      { ...lancs[0], contaId: 'a1' },
      { ...lancs[0], id: 't9', descricao: 'Farmácia', contaId: 'a2' },
      { ...lancs[0], id: 't10', descricao: 'Cinema', contaId: 'a3' },
    ])
    montar()
    await screen.findByText('Supermercado')
    const a1 = linha('Supermercado').querySelector('[data-conta]') as HTMLElement
    expect(a1.querySelector('[data-banco="itau"]')).not.toBeNull()
    expect(a1.textContent).toBe('Itaú corrente')
    expect(a1.querySelector('.sr-only')).toBeNull() // o nome já está escrito
    expect((linha('Farmácia').querySelector('[data-conta]') as HTMLElement).textContent).toBe('Itaú poupança')
    const a3 = linha('Cinema').querySelector('[data-conta]') as HTMLElement
    expect(a3.textContent).toBe('Reserva da casa')
    expect(a3.querySelector('[data-logo], [data-sigla]')).toBeNull()
  })

  describe('carregar os próximos 50 sozinho', () => {
    const muitos = Array.from({ length: 53 }, (_, i) => ({
      ...lancs[0], id: `m${i}`, descricao: `Item ${String(i).padStart(2, '0')}`, data: '2026-10-15',
    }))
    afterEach(() => { vi.unstubAllGlobals() })

    it('com IntersectionObserver: sem botão nem "Mostrando X de Y"; o fim da lista chegando à tela traz o resto', async () => {
      let aoVer: ((e: { isIntersecting: boolean }[]) => void) | null = null
      vi.stubGlobal('IntersectionObserver', class {
        constructor(cb: (e: { isIntersecting: boolean }[]) => void) { aoVer = cb }
        observe() {}
        disconnect() {}
      })
      mock.listarLancamentos.mockResolvedValue(muitos)
      montar()
      await screen.findByText('Item 00')
      expect(screen.queryByText('Item 50')).toBeNull() // só 50 no começo
      expect(screen.queryByRole('button', { name: 'Carregar mais 50' })).toBeNull()
      expect(screen.queryByText(/Mostrando 50 de/)).toBeNull()
      expect(screen.getByTestId('carrega-mais-sozinho')).toBeTruthy()
      await vi.waitFor(() => expect(aoVer).not.toBeNull())
      act(() => aoVer!([{ isIntersecting: true }]))
      expect(await screen.findByText('Item 52')).toBeTruthy()
      expect(screen.queryByTestId('carrega-mais-sozinho')).toBeNull()
    })

    it('sem IntersectionObserver, o botão continua (e o texto de quantos aparecem)', async () => {
      vi.stubGlobal('IntersectionObserver', undefined)
      mock.listarLancamentos.mockResolvedValue(muitos)
      montar()
      await screen.findByText('Item 00')
      expect(screen.getByText(/Mostrando 50 de 53/)).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: 'Carregar mais 50' }))
      expect(await screen.findByText('Item 52')).toBeTruthy()
    })
  })
})
