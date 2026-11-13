// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mock = vi.hoisted(() => ({
  listarAtivosInvestimento: vi.fn(),
  listarHistoricoInvestimentos: vi.fn(),
  listarHistoricoAportes: vi.fn(),
  listarCarteiraInvestimentos: vi.fn(),
  listarAlocacaoInvestimentos: vi.fn(),
  criarAtivoInvestimento: vi.fn(),
  definirSubclasseAtivo: vi.fn(),
  definirLiquidezAtivo: vi.fn(),
  registrarOperacaoInvestimento: vi.fn(),
  registrarOperacaoPorValor: vi.fn(),
  registrarAvaliacaoInvestimento: vi.fn(),
  registrarAvaliacaoTotal: vi.fn(),
  listarLiquidezInvestimentos: vi.fn(),
  listarProventosPorAtivo: vi.fn(),
  listarInstituicoesInvestimentos: vi.fn(),
  listarAportesInvestimentos: vi.fn(),
  converterParaReais: vi.fn(),
  listarTotalProventos: vi.fn(),
  definirInstituicaoAtivo: vi.fn(),
  definirCotacaoBolsaAtivo: vi.fn(),
  registrarProventoInvestimento: vi.fn(),
  registrarProventosPrevistos: vi.fn(),
  listarContas: vi.fn(),
  editarAtivoInvestimento: vi.fn(),
  arquivarAtivoInvestimento: vi.fn(),
  reativarAtivoInvestimento: vi.fn(),
  excluirAtivoInvestimento: vi.fn(),
  excluirAtivoComHistorico: vi.fn(),
  listarExtratoAtivo: vi.fn(),
  anularOperacaoInvestimento: vi.fn(),
}))
vi.mock('../lib/FamiliaContext', () => ({
  useFamilia: () => ({ familia: { id: 'h1', nome: 'Casa', papel: 'owner' }, carregando: false, erro: false, recarregar: vi.fn() }),
}))
vi.mock('../lib/investimentos', async (o) => ({
  ...(await o<typeof import('../lib/investimentos')>()),
  listarAtivosInvestimento: mock.listarAtivosInvestimento,
  listarHistoricoInvestimentos: mock.listarHistoricoInvestimentos,
  listarHistoricoAportes: mock.listarHistoricoAportes,
  listarCarteiraInvestimentos: mock.listarCarteiraInvestimentos,
  listarAlocacaoInvestimentos: mock.listarAlocacaoInvestimentos,
  criarAtivoInvestimento: mock.criarAtivoInvestimento,
  definirSubclasseAtivo: mock.definirSubclasseAtivo,
  definirLiquidezAtivo: mock.definirLiquidezAtivo,
  registrarOperacaoInvestimento: mock.registrarOperacaoInvestimento,
  registrarOperacaoPorValor: mock.registrarOperacaoPorValor,
  registrarAvaliacaoInvestimento: mock.registrarAvaliacaoInvestimento,
  registrarAvaliacaoTotal: mock.registrarAvaliacaoTotal,
  listarLiquidezInvestimentos: mock.listarLiquidezInvestimentos,
  listarProventosPorAtivo: mock.listarProventosPorAtivo,
  listarInstituicoesInvestimentos: mock.listarInstituicoesInvestimentos,
  listarAportesInvestimentos: mock.listarAportesInvestimentos,
  listarTotalProventos: mock.listarTotalProventos,
  definirInstituicaoAtivo: mock.definirInstituicaoAtivo,
  definirCotacaoBolsaAtivo: mock.definirCotacaoBolsaAtivo,
  registrarProventoInvestimento: mock.registrarProventoInvestimento,
  registrarProventosPrevistos: mock.registrarProventosPrevistos,
  editarAtivoInvestimento: mock.editarAtivoInvestimento,
  arquivarAtivoInvestimento: mock.arquivarAtivoInvestimento,
  reativarAtivoInvestimento: mock.reativarAtivoInvestimento,
  excluirAtivoInvestimento: mock.excluirAtivoInvestimento,
  excluirAtivoComHistorico: mock.excluirAtivoComHistorico,
  listarExtratoAtivo: mock.listarExtratoAtivo,
  anularOperacaoInvestimento: mock.anularOperacaoInvestimento,
}))
vi.mock('../lib/cambio', async (o) => ({ ...(await o<typeof import('../lib/cambio')>()), converterParaReais: mock.converterParaReais }))
vi.mock('../lib/contas', async (o) => ({ ...(await o<typeof import('../lib/contas')>()), listarContas: mock.listarContas }))

import Investimentos from './Investimentos'
import type { Cents } from '../lib/format'
import { definirValoresOcultos } from '../lib/privacidade'
import { sobreOAportado } from '../components/investimentos/TabelaPosicoes'

const c = (n: number) => n as Cents
const ativo = (id: string, nome: string, classe: string, extra: Record<string, unknown> = {}) =>
  ({ id, nome, ticker: null, classe, moeda: 'BRL', ativo: true, subclasse: null, liquidez: 'liquid', instituicao: null, cotacaoBolsa: false,
    // contadores de histórico (#125): 0 = nunca teve movimento, então pode ser excluído
    quantidadeOperacoes: 0, quantidadeAvaliacoes: 0, quantidadeProventos: 0, ...extra })
const posicao = (assetId: string, nome: string, classe: string, valor: number) => ({
  assetId, nome, ticker: null, classe, moeda: 'BRL', quantidade: '1', custoMedio: '1', custoTotal: c(valor), precoAtual: '1',
  valorAtual: c(valor), resultado: c(0), dataAvaliacao: null, fonteAvaliacao: null,
})

const linhaExtrato = (extra: Record<string, unknown>) => ({
  id: 'x', tipo: 'buy', data: '2026-10-01', quantidade: '10', precoUnitario: '10', taxa: c(100), valor: c(10100),
  tipoProvento: null, statusProvento: null, fonte: null, observacao: null, anulada: false, motivoAnulacao: null, saldoQuantidade: '10', ...extra,
})
const extratoBase = () => [
  linhaExtrato({ id: 'o1' }),
  linhaExtrato({ id: 'o2', data: '2026-10-05', quantidade: '100', precoUnitario: '20', taxa: c(0), valor: c(200000), anulada: true, motivoAnulacao: 'digitei errado', saldoQuantidade: null }),
  linhaExtrato({ id: 'o3', tipo: 'sell', data: '2026-10-10', quantidade: '4', precoUnitario: '15', taxa: c(0), valor: c(6000), saldoQuantidade: '6' }),
  linhaExtrato({ id: 'd1', tipo: 'distribution', data: '2026-10-12', quantidade: null, precoUnitario: null, taxa: null, valor: c(350), tipoProvento: 'dividend', statusProvento: 'paid', saldoQuantidade: null }),
]

/** Série mensal de exemplo, do mês de `de` ao de `ate` (1º dia de cada mês), numa moeda só. */
function serieHistorico(de: string, ate: string) {
  const meses: string[] = []
  let [a, m] = [Number(de.slice(0, 4)), Number(de.slice(5, 7))]
  const [fa, fm] = [Number(ate.slice(0, 4)), Number(ate.slice(5, 7))]
  while (a < fa || (a === fa && m <= fm)) {
    meses.push(`${a}-${String(m).padStart(2, '0')}-01`)
    if (++m > 12) { m = 1; a++ }
  }
  return meses.map((mes, i) => ({ mes, moeda: 'BRL' as const, valorAtual: c(100000 + i * 1000), custoTotal: c(90000 + i * 500) }))
}

beforeEach(() => {
  mock.listarHistoricoInvestimentos.mockImplementation(async (_f: string, de: string, ate: string) => serieHistorico(de, ate))
  // padrão: banco sem a migration 114 (o aportado do gráfico cai para o custo); o bloco "aporte líquido" liga a função
  mock.listarHistoricoAportes.mockRejectedValue(new Error('PGRST202'))
  mock.listarAtivosInvestimento.mockResolvedValue([
    ativo('a1', 'Tesouro Selic', 'fixed_income', { subclasse: 'Tesouro Direto' }),
    ativo('a2', 'Ação Y', 'equity', { subclasse: 'Ações' }),
    ativo('a3', 'Fundo W', 'fund'),
  ])
  mock.listarCarteiraInvestimentos.mockResolvedValue({
    posicoes: [posicao('a1', 'Tesouro Selic', 'fixed_income', 60000), posicao('a2', 'Ação Y', 'equity', 10000), posicao('a3', 'Fundo W', 'fund', 5000)],
    totais: [{ moeda: 'BRL', custoTotal: c(75000), valorAtual: c(75000), resultado: c(0) }],
  })
  mock.listarAlocacaoInvestimentos.mockResolvedValue([
    { moeda: 'BRL', nivel: 'macro', macro: 'fixed_income', subclasse: null, valor: c(60000), percentual: 80 },
    { moeda: 'BRL', nivel: 'macro', macro: 'other', subclasse: null, valor: c(5000), percentual: 6.7 },
    { moeda: 'BRL', nivel: 'macro', macro: 'variable', subclasse: null, valor: c(10000), percentual: 13.3 },
    { moeda: 'BRL', nivel: 'subclass', macro: 'fixed_income', subclasse: 'Tesouro Direto', valor: c(60000), percentual: 80 },
    { moeda: 'BRL', nivel: 'subclass', macro: 'other', subclasse: null, valor: c(5000), percentual: 6.7 },
    { moeda: 'BRL', nivel: 'subclass', macro: 'variable', subclasse: 'Ações', valor: c(10000), percentual: 13.3 },
  ])
  mock.listarProventosPorAtivo.mockResolvedValue([])
  mock.registrarProventoInvestimento.mockResolvedValue(undefined)
  mock.registrarProventosPrevistos.mockResolvedValue(12)
  mock.listarContas.mockResolvedValue({ contas: [{ id: 'c1', nome: 'Corretora', ativa: true }, { id: 'c2', nome: 'Antiga', ativa: false }], total: c(0) })
  for (const f of [mock.editarAtivoInvestimento, mock.arquivarAtivoInvestimento, mock.reativarAtivoInvestimento, mock.excluirAtivoInvestimento]) f.mockResolvedValue(undefined)
  mock.criarAtivoInvestimento.mockResolvedValue('novo-id')
  mock.definirSubclasseAtivo.mockResolvedValue(undefined)
  mock.definirLiquidezAtivo.mockResolvedValue(undefined)
  mock.registrarOperacaoInvestimento.mockResolvedValue(undefined)
  for (const f of [mock.registrarOperacaoPorValor, mock.registrarAvaliacaoInvestimento, mock.registrarAvaliacaoTotal]) f.mockResolvedValue(undefined)
  mock.listarLiquidezInvestimentos.mockResolvedValue([])
  mock.listarInstituicoesInvestimentos.mockResolvedValue([])
  // padrão dos testes: banco sem a migration 107 (cartões e tabela no custo do que está investido);
  // o bloco "aportes e resgates" liga a função
  mock.listarAportesInvestimentos.mockRejectedValue(new Error('PGRST202'))
  mock.converterParaReais.mockResolvedValue([])
  mock.listarTotalProventos.mockResolvedValue([])
  mock.definirInstituicaoAtivo.mockResolvedValue(undefined)
  mock.definirCotacaoBolsaAtivo.mockResolvedValue(undefined)
  mock.anularOperacaoInvestimento.mockResolvedValue(undefined)
  mock.listarExtratoAtivo.mockResolvedValue(extratoBase())
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('Investimentos × macroclasse e subclasse', () => {
  it('Composição da carteira, aba Classe: um quadro por macroclasse e a barra por subclasse, com valores e % do banco, e "Sem subclasse"', async () => {
    render(<Investimentos />)
    const secao = (await screen.findByRole('heading', { name: 'Composição da carteira' })).closest('section') as HTMLElement
    expect(within(secao).getByRole('tab', { name: 'Classe' }).getAttribute('aria-selected')).toBe('true')
    expect(within(secao).getAllByRole('img')[0].querySelectorAll('[data-fatia]')).toHaveLength(3)
    expect(within(secao).getByText('Renda fixa')).toBeTruthy()
    expect(within(secao).getByText('Renda variável')).toBeTruthy()
    expect(within(secao).getByText('Fundos e outros')).toBeTruthy()
    expect(secao.textContent).toMatch(/600,0080%/)
    expect(secao.textContent).toMatch(/50,00 · 6,7%/)
    expect(within(secao).getByText('Tesouro Direto')).toBeTruthy()
    expect(within(secao).getByText('Sem subclasse')).toBeTruthy()
    // a largura de cada trecho é o % do banco (nada somado aqui), com um mínimo para o trecho pequeno não sumir
    const trechos = [...within(secao).getAllByRole('img')[0].querySelectorAll<HTMLElement>('[data-fatia]')]
    // ordem e cor fixas por macroclasse (Renda fixa, Renda variável, Fundos e outros), mesmo com o banco em outra ordem
    expect(trechos.map((t) => t.style.width)).toEqual(['80%', '13.3%', '6.7%'])
    expect(new Set(trechos.map((t) => t.style.background)).size).toBe(3)
    expect(trechos.every((t) => t.style.minWidth === '6px')).toBe(true)
    expect(within(secao).getAllByRole('img')[0].getAttribute('aria-label')).toMatch(/Tesouro Direto \(Renda fixa\) 80%/)
  })

  describe('botões de cada ativo na tabela (pedido do dono, 10/11/2026, a partir de um desenho)', () => {
    const seletorAtivo = (folha: HTMLElement) => (within(folha).getByLabelText('Ativo') as HTMLSelectElement).value

    it('Aporte e Resgate abrem a folha de compra e venda já no ativo e na aba certa', async () => {
      const u = userEvent.setup()
      render(<Investimentos />)
      await u.click(await screen.findByRole('button', { name: 'Aporte em Ação Y' }))
      let folha = screen.getByRole('dialog', { name: 'Registrar compra ou venda' })
      expect(seletorAtivo(folha)).toBe('a2')
      expect(within(folha).getByRole('radio', { name: 'Compra' }).getAttribute('aria-checked')).toBe('true')
      await u.click(within(folha).getByRole('button', { name: 'Cancelar' }))

      await u.click(screen.getByRole('button', { name: 'Resgate de Fundo W' }))
      folha = screen.getByRole('dialog', { name: 'Registrar compra ou venda' })
      expect(seletorAtivo(folha)).toBe('a3')
      expect(within(folha).getByRole('radio', { name: 'Venda' }).getAttribute('aria-checked')).toBe('true')
      await u.click(within(folha).getByRole('button', { name: 'Cancelar' }))

      // depois de fechar, o botão do topo abre como antes (sem ativo escolhido: o primeiro da lista)
      await u.click(screen.getByRole('button', { name: 'Investir' }))
      expect(seletorAtivo(screen.getByRole('dialog', { name: 'Registrar compra ou venda' }))).toBe('a1')
    })

    it('Atualizar valor abre a avaliação já no ativo', async () => {
      const u = userEvent.setup()
      render(<Investimentos />)
      await u.click(await screen.findByRole('button', { name: 'Atualizar o valor de Fundo W' }))
      expect(seletorAtivo(screen.getByRole('dialog', { name: 'Registrar avaliação' }))).toBe('a3')
    })

    it('+ Provento só em ação, FII, ETF e fundo (renda fixa e previdência não pagam), e abre já no ativo', async () => {
      const u = userEvent.setup()
      render(<Investimentos />)
      await u.click(await screen.findByRole('button', { name: 'Provento de Ação Y' }))
      expect(screen.getByRole('button', { name: 'Provento de Fundo W' })).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'Provento de Tesouro Selic' })).toBeNull()
      expect((screen.getByLabelText('Ativo') as HTMLSelectElement).value).toBe('a2')
    })

    it('todo ativo da tabela tem Aporte, Resgate e Atualizar valor', async () => {
      render(<Investimentos />)
      await screen.findByRole('button', { name: 'Aporte em Tesouro Selic' })
      for (const nome of ['Tesouro Selic', 'Ação Y', 'Fundo W']) {
        expect(screen.getByRole('button', { name: `Aporte em ${nome}` })).toBeTruthy()
        expect(screen.getByRole('button', { name: `Resgate de ${nome}` })).toBeTruthy()
        expect(screen.getByRole('button', { name: `Atualizar o valor de ${nome}` })).toBeTruthy()
      }
    })
  })

  it('filtra as posições por macroclasse e por subclasse', async () => {
    const u = userEvent.setup()
    render(<Investimentos />)
    await screen.findByText('Composição da carteira')
    const posicoes = () => (screen.getByRole('heading', { name: 'Posições' }).closest('section') as HTMLElement)
    // cada investimento é uma linha da tabela, com o nome no cabeçalho da linha
    const linhas = () => within(posicoes()).queryAllByRole('rowheader').filter((th) => th.textContent !== 'Total' && !th.textContent?.startsWith('Total'))
    expect(linhas()).toHaveLength(3)
    expect(within(posicoes()).getByRole('rowheader', { name: /^Total/ })).toBeTruthy()

    // filtros em chips na própria tela (pedido do dono, 10/11/2026); cada toque vale na hora, com o número de posições
    const classes = screen.getByRole('group', { name: 'Filtrar posições por classe' })
    expect(within(classes).getAllByRole('button').map((b) => b.textContent)).toEqual(['Todos (3)', 'Renda fixa (1)', 'Renda variável (1)', 'Fundos e outros (1)'])
    expect(screen.queryByRole('button', { name: 'Filtrar' })).toBeNull()
    await u.click(within(classes).getByRole('button', { name: 'Renda variável (1)' }))
    expect(linhas()).toHaveLength(1)
    expect(within(posicoes()).getByText(/Ação Y/)).toBeTruthy()
    // com filtro a linha Total some: o total do banco é da carteira inteira, não das linhas à vista
    expect(within(posicoes()).queryByRole('rowheader', { name: /^Total/ })).toBeNull()

    await u.click(within(classes).getByRole('button', { name: 'Renda variável (1)' })) // tocar de novo desliga
    expect(linhas()).toHaveLength(3)
    const subclasses = screen.getByRole('group', { name: 'Filtrar posições por subclasse' })
    expect(within(subclasses).getAllByRole('button').map((b) => b.textContent)).toEqual(['Ações', 'Tesouro Direto'])
    await u.click(within(subclasses).getByRole('button', { name: 'Tesouro Direto' }))
    expect(within(posicoes()).getByText(/Tesouro Selic/)).toBeTruthy()
    expect(within(posicoes()).queryByText(/Ação Y/)).toBeNull()
    expect(within(classes).getByRole('button', { name: 'Todos (3)' }).getAttribute('aria-pressed')).toBe('false')

    // trocar de classe limpa a subclasse (senão "variável + Tesouro Direto" daria uma lista vazia sem explicação)
    await u.click(within(classes).getByRole('button', { name: 'Renda variável (1)' }))
    expect(within(posicoes()).getByText(/Ação Y/)).toBeTruthy()
    expect(screen.queryByRole('group', { name: 'Filtrar posições por subclasse' })).toBeNull() // só uma subclasse na classe: nada a escolher
    await u.click(within(classes).getByRole('button', { name: 'Todos (3)' }))
    expect(linhas()).toHaveLength(3)
  })

  it('cadastrar ativo com subclasse: cria e depois grava a subclasse', async () => {
    const u = userEvent.setup()
    render(<Investimentos />)
    await u.click(await screen.findByRole('button', { name: 'Novo ativo' }))
    await u.type(screen.getByLabelText('Nome do ativo'), 'CDB Banco X')
    await u.selectOptions(screen.getByLabelText('Categoria'), 'bancario')
    expect((screen.getByLabelText('Subclasse (opcional)') as HTMLInputElement).value).toBe('CDB') // a categoria sugere; o campo segue editável
    await u.click(screen.getByRole('button', { name: 'Salvar ativo' }))
    expect(mock.criarAtivoInvestimento).toHaveBeenCalledWith(expect.objectContaining({ familiaId: 'h1', nome: 'CDB Banco X', classe: 'fixed_income' }))
    expect(mock.criarAtivoInvestimento.mock.calls[0][0]).not.toHaveProperty('subclasse')
    expect(mock.definirSubclasseAtivo).toHaveBeenCalledWith('novo-id', 'CDB')
  })

  describe('liquidez (opção C, 10/11/2026)', () => {
    it('cadastrar previdência como restrito: cria o ativo e depois marca a liquidez; líquido não faz a segunda chamada', async () => {
      const u = userEvent.setup()
      render(<Investimentos />)
      await u.click(await screen.findByRole('button', { name: 'Novo ativo' }))
      await u.type(screen.getByLabelText('Nome do ativo'), 'Previdência')
      await u.selectOptions(screen.getByLabelText('Categoria'), 'personalizado')
      await u.click(screen.getByRole('radio', { name: 'Restrito' }))
      await u.click(screen.getByRole('button', { name: 'Salvar ativo' }))
      expect(mock.criarAtivoInvestimento.mock.calls[0][0]).not.toHaveProperty('liquidez')
      expect(mock.definirLiquidezAtivo).toHaveBeenCalledWith('novo-id', 'restricted')

      mock.definirLiquidezAtivo.mockClear()
      await u.click(await screen.findByRole('button', { name: 'Novo ativo' }))
      await u.type(screen.getByLabelText('Nome do ativo'), 'CDB')
      await u.selectOptions(screen.getByLabelText('Categoria'), 'bancario')
      await u.click(screen.getByRole('button', { name: 'Salvar ativo' }))
      await waitFor(() => expect(mock.criarAtivoInvestimento).toHaveBeenCalledTimes(2))
      expect(mock.definirLiquidezAtivo).not.toHaveBeenCalled()
    })

    it('Composição da carteira, aba Liquidez: Líquido e Restrito com os valores do banco; aba Ativos: lista do maior para o menor', async () => {
      mock.listarLiquidezInvestimentos.mockResolvedValue([
        { moeda: 'BRL', liquidez: 'liquid', valor: c(15000) },
        { moeda: 'BRL', liquidez: 'restricted', valor: c(60000) },
        { moeda: 'USD', liquidez: 'liquid', valor: c(999) },
      ])
      const u = userEvent.setup()
      render(<Investimentos />)
      const secao = (await screen.findByRole('heading', { name: 'Composição da carteira' })).closest('section') as HTMLElement
      await u.click(within(secao).getByRole('tab', { name: 'Liquidez' }))
      const linhas = within(secao).getByRole('list', { name: 'Lista da carteira por liquidez' })
      expect(within(linhas).getAllByRole('listitem').map((li) => li.textContent?.replace(/\s/g, ' '))).toEqual([
        'LíquidoR$ 150,0020%', 'Restrito (previdência, FGTS)R$ 600,0080%',
      ])
      await u.click(within(secao).getByRole('tab', { name: 'Ativos' }))
      const ativos = within(secao).getByRole('list', { name: 'Lista da carteira por ativos' })
      expect(within(ativos).getAllByRole('listitem').map((li) => li.textContent?.split('R$')[0])).toEqual(['Tesouro Selic', 'Ação Y', 'Fundo W'])
    })

    it('banco sem a migration da liquidez: a tela segue, a aba Liquidez fica vazia', async () => {
      mock.listarLiquidezInvestimentos.mockRejectedValue(new Error('PGRST202'))
      const u = userEvent.setup()
      render(<Investimentos />)
      await screen.findByRole('list', { name: 'Resumo da carteira em reais' })
      await u.click(screen.getByRole('tab', { name: 'Liquidez' }))
      expect(screen.getByText('Nada para mostrar ainda.')).toBeTruthy()
    })

    it('ativo restrito diz "restrito" e o botão troca a liquidez', async () => {
      mock.listarAtivosInvestimento.mockResolvedValue([ativo('p1', 'Previdência', 'other', { liquidez: 'restricted' })])
      const u = userEvent.setup()
      render(<Investimentos />)
      await u.click(await screen.findByRole('button', { name: 'Marcar Previdência como líquido' }))
      expect(mock.definirLiquidezAtivo).toHaveBeenCalledWith('p1', 'liquid')
      expect(screen.getByText(/· restrito$/)).toBeTruthy()
    })
  })

  it('sem subclasse (categoria que não sugere, ou campo apagado), não chama a RPC de subclasse', async () => {
    const u = userEvent.setup()
    render(<Investimentos />)
    await u.click(await screen.findByRole('button', { name: 'Novo ativo' }))
    await u.type(screen.getByLabelText('Nome do ativo'), 'Algo')
    await u.selectOptions(screen.getByLabelText('Categoria'), 'tesouro')
    await u.clear(screen.getByLabelText('Subclasse (opcional)'))
    await u.click(screen.getByRole('button', { name: 'Salvar ativo' }))
    expect(mock.criarAtivoInvestimento).toHaveBeenCalled()
    expect(mock.definirSubclasseAtivo).not.toHaveBeenCalled()
  })

  it('se a subclasse falhar depois do ativo criado, avisa que o ativo existe', async () => {
    const u = userEvent.setup()
    mock.definirSubclasseAtivo.mockRejectedValue(new Error('subclasse inválida'))
    render(<Investimentos />)
    await u.click(await screen.findByRole('button', { name: 'Novo ativo' }))
    await u.type(screen.getByLabelText('Nome do ativo'), 'CDB Banco X')
    await u.selectOptions(screen.getByLabelText('Categoria'), 'bancario')
    await u.click(screen.getByRole('button', { name: 'Salvar ativo' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/Ativo cadastrado, mas a subclasse não foi salva/)
  })

  it('editar a subclasse de um ativo existente; vazio limpa', async () => {
    const u = userEvent.setup()
    render(<Investimentos />)
    await u.click(await screen.findByRole('button', { name: 'Subclasse de Fundo W' }))
    const campo = screen.getByLabelText('Subclasse de Fundo W (vazio limpa)')
    await u.type(campo, 'Multimercado')
    await u.click(screen.getByRole('button', { name: 'Salvar subclasse' }))
    expect(mock.definirSubclasseAtivo).toHaveBeenCalledWith('a3', 'Multimercado')

    await u.click(await screen.findByRole('button', { name: 'Subclasse de Tesouro Selic' }))
    await u.clear(screen.getByLabelText('Subclasse de Tesouro Selic (vazio limpa)'))
    await u.click(screen.getByRole('button', { name: 'Salvar subclasse' }))
    expect(mock.definirSubclasseAtivo).toHaveBeenLastCalledWith('a1', '')
  })

  it('banco sem a migration 034: a carteira aparece normalmente, só sem a seção de alocação', async () => {
    mock.listarAlocacaoInvestimentos.mockRejectedValue(new Error('function public.investment_allocation does not exist'))
    render(<Investimentos />)
    expect(await screen.findByText('Resumo da carteira')).toBeTruthy()
    expect(screen.getAllByText(/Tesouro Selic/).length).toBeGreaterThan(0)
    expect(screen.queryByText('Alocação da carteira')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  describe('proventos', () => {
    it('mostra os proventos por ativo com os valores do banco, e o planejado à parte', async () => {
      mock.listarProventosPorAtivo.mockResolvedValue([
        { assetId: 'a2', nome: 'Ação Y', moeda: 'BRL', recebido: c(8500), previsto: c(0), ultimoRecebimento: '2026-10-20' },
        { assetId: 'a1', nome: 'FII Z', moeda: 'BRL', recebido: c(12050), previsto: c(3000), ultimoRecebimento: null },
      ])
      render(<Investimentos />)
      const secao = (await screen.findByRole('heading', { name: 'Proventos recebidos' })).closest('section') as HTMLElement
      expect(secao.textContent).toMatch(/85,00/)
      expect(secao.textContent).toMatch(/120,50/)
      expect(secao.textContent).toMatch(/Planejado: R\$\s*30,00/)
      expect(secao.textContent).toMatch(/Nada planejado/)
    })

    it('registrar provento: manda o valor líquido em centavos, a conta e a situação escolhidas', async () => {
      const u = userEvent.setup()
      render(<Investimentos />)
      await u.click(await screen.findByRole('button', { name: 'Registrar provento' }))
      await u.selectOptions(screen.getByLabelText('Ativo'), 'a2')
      await u.selectOptions(screen.getByLabelText('Tipo'), 'jcp')
      await u.type(screen.getByLabelText('Valor líquido recebido (R$)'), '120,50')
      await u.click(screen.getAllByRole('button', { name: 'Registrar provento' })[1])
      expect(mock.registrarProventoInvestimento).toHaveBeenCalledWith(expect.objectContaining({
        ativoId: 'a2', tipo: 'jcp', valor: 12050, contaId: 'c1', status: 'paid',
      }))
    })

    it('Repetir só existe no provento planejado; "Já recebido" não oferece', async () => {
      const u = userEvent.setup()
      render(<Investimentos />)
      await u.click(await screen.findByRole('button', { name: 'Registrar provento' }))
      expect(screen.queryByLabelText('Repetir')).toBeNull()
      await u.click(screen.getByRole('radio', { name: 'Planejado' }))
      expect(screen.getByLabelText('Repetir')).toBeTruthy()
      expect(screen.queryByLabelText('Até (opcional)')).toBeNull() // só aparece com uma repetição escolhida
      await u.click(screen.getByRole('radio', { name: 'Já recebido' }))
      expect(screen.queryByLabelText('Repetir')).toBeNull()
    })

    it('Planejado + Repetir "Todo mês": cria a previsão (série) e não um provento solto; avisa que é previsão', async () => {
      const u = userEvent.setup()
      render(<Investimentos />)
      await u.click(await screen.findByRole('button', { name: 'Registrar provento' }))
      await u.selectOptions(screen.getByLabelText('Ativo'), 'a2')
      await u.type(screen.getByLabelText('Valor líquido recebido (R$)'), '85,50')
      await u.click(screen.getByRole('radio', { name: 'Planejado' }))
      await u.selectOptions(screen.getByLabelText('Repetir'), '1')
      expect(screen.getByTestId('aviso-previsao').textContent).toMatch(/previsão/)
      expect(screen.getByTestId('aviso-previsao').textContent).toMatch(/Nada vira pago sozinho/)
      await u.click(screen.getAllByRole('button', { name: 'Registrar provento' })[1])
      expect(mock.registrarProventosPrevistos).toHaveBeenCalledWith(expect.objectContaining({
        ativoId: 'a2', valor: 8550, contaId: 'c1', cadaMeses: 1, ate: null,
      }))
      expect(mock.registrarProventoInvestimento).not.toHaveBeenCalled()
    })

    it('Repetir com "até" antes da primeira data é recusado na tela; sem Repetir o provento planejado segue solto', async () => {
      const u = userEvent.setup()
      render(<Investimentos />)
      await u.click(await screen.findByRole('button', { name: 'Registrar provento' }))
      await u.type(screen.getByLabelText('Valor líquido recebido (R$)'), '10,00')
      await u.click(screen.getByRole('radio', { name: 'Planejado' }))
      await u.selectOptions(screen.getByLabelText('Repetir'), '3')
      fireEvent.change(screen.getByLabelText('Até (opcional)'), { target: { value: '2000-01-01' } })
      await u.click(screen.getAllByRole('button', { name: 'Registrar provento' })[1])
      expect(screen.getByText('A data final não pode ser antes da primeira.')).toBeTruthy()
      expect(mock.registrarProventosPrevistos).not.toHaveBeenCalled()
      await u.selectOptions(screen.getByLabelText('Repetir'), '')
      await u.click(screen.getAllByRole('button', { name: 'Registrar provento' })[1])
      expect(mock.registrarProventoInvestimento).toHaveBeenCalledWith(expect.objectContaining({ status: 'planned' }))
      expect(mock.registrarProventosPrevistos).not.toHaveBeenCalled()
    })

    it('só oferece contas ativas em reais (multimoeda F1) e só ativos em reais', async () => {
      mock.listarContas.mockResolvedValue({ contas: [
        { id: 'c1', nome: 'Corretora', ativa: true }, { id: 'c2', nome: 'Antiga', ativa: false },
        { id: 'c3', nome: 'Conta em dólar', ativa: true, moeda: 'USD' },
      ], total: c(0) })
      mock.listarAtivosInvestimento.mockResolvedValue([
        ativo('a1', 'Tesouro Selic', 'fixed_income'), ativo('a9', 'ETF Global', 'etf', { moeda: 'USD' }),
      ])
      const u = userEvent.setup()
      render(<Investimentos />)
      await u.click(await screen.findByRole('button', { name: 'Registrar provento' }))
      const ativosOpcoes = within(screen.getByLabelText('Ativo')).getAllByRole('option').map((o) => o.textContent)
      expect(ativosOpcoes).toEqual(['Tesouro Selic'])
      const contasOpcoes = within(screen.getByLabelText('Conta que recebe')).getAllByRole('option').map((o) => o.textContent)
      expect(contasOpcoes).toEqual(['Corretora'])
    })

    it('sem ativo em reais, o botão fica desabilitado', async () => {
      mock.listarAtivosInvestimento.mockResolvedValue([ativo('a9', 'ETF Global', 'etf', { moeda: 'USD' })])
      render(<Investimentos />)
      const botao = await screen.findByRole('button', { name: 'Registrar provento' })
      expect((botao as HTMLButtonElement).disabled).toBe(true)
    })

    it('valor vazio ou pago com data futura não chama o banco', async () => {
      const u = userEvent.setup()
      render(<Investimentos />)
      await u.click(await screen.findByRole('button', { name: 'Registrar provento' }))
      await u.click(screen.getAllByRole('button', { name: 'Registrar provento' })[1])
      expect(screen.getByText(/Confira ativo, conta, data e o valor líquido/)).toBeTruthy()
      await u.type(screen.getByLabelText('Valor líquido recebido (R$)'), '10')
      await u.clear(screen.getByLabelText('Data'))
      await u.type(screen.getByLabelText('Data'), '2099-01-01')
      await u.click(screen.getAllByRole('button', { name: 'Registrar provento' })[1])
      expect(screen.getByText(/não pode ter data futura/)).toBeTruthy()
      expect(mock.registrarProventoInvestimento).not.toHaveBeenCalled()
    })

    it('banco sem a migration 035: a carteira aparece normalmente, só sem a seção de proventos', async () => {
      mock.listarProventosPorAtivo.mockRejectedValue(new Error('function public.investment_income_by_asset does not exist'))
      render(<Investimentos />)
      expect(await screen.findByText('Resumo da carteira')).toBeTruthy()
      expect(screen.queryByText('Proventos recebidos')).toBeNull()
      expect(screen.queryByRole('alert')).toBeNull()
    })

    it('erro do banco ao registrar (ex.: conta conciliada) aparece e a tela segue', async () => {
      mock.registrarProventoInvestimento.mockRejectedValue(new Error('a conta já foi conciliada'))
      const u = userEvent.setup()
      render(<Investimentos />)
      await u.click(await screen.findByRole('button', { name: 'Registrar provento' }))
      await u.type(screen.getByLabelText('Valor líquido recebido (R$)'), '10')
      await u.click(screen.getAllByRole('button', { name: 'Registrar provento' })[1])
      expect(await screen.findByRole('alert')).toBeTruthy()
    })
  })

  describe('resumo em cartões e tabela de posições (pedido do dono, 10/11/2026)', () => {
    const resumo = async () => await screen.findByRole('list', { name: 'Resumo da carteira em reais' })
    const cartao = (lista: HTMLElement, rotulo: string) => within(lista).getByText(rotulo).closest('li') as HTMLElement

    it('cartões Carteira, Aportado e Rendimento com os números do banco; sem provento no mês, o cartão de proventos não aparece', async () => {
      mock.listarCarteiraInvestimentos.mockResolvedValue({
        posicoes: [posicao('a1', 'Tesouro Selic', 'fixed_income', 60000)],
        totais: [{ moeda: 'BRL', custoTotal: c(100000), valorAtual: c(107300), resultado: c(7300) }],
      })
      // o banco devolve a moeda com zero quando só há provento anulado ou de outro status: continua escondido
      mock.listarTotalProventos.mockResolvedValue([{ moeda: 'BRL', recebido: c(0), previsto: c(0) }])
      render(<Investimentos />)
      const lista = await resumo()
      expect(within(lista).getAllByRole('listitem')).toHaveLength(3)
      expect(cartao(lista, 'Valor atual da carteira').textContent).toMatch(/R\$\s1\.073,00/)
      expect(cartao(lista, 'Aportado').textContent).toMatch(/R\$\s1\.000,00/)
      // "aportado" é o custo do que ainda está investido (depois de um resgate não é "quanto saiu do bolso")
      expect(cartao(lista, 'Aportado').textContent).toMatch(/Custo do que está investido/)
      expect(screen.queryByText(/saiu do bolso/)).toBeNull()
      expect(screen.getByText('Aportado e rendimento são do que ainda está investido: o que já foi resgatado não entra.')).toBeTruthy()
      expect(cartao(lista, 'Rendimento').textContent).toMatch(/\+R\$\s73,00/)
      expect(cartao(lista, 'Rendimento').textContent).toMatch(/\+7,3% sobre o aportado/)
      expect(within(lista).queryByText('Proventos no mês')).toBeNull()
      // o card da carteira não usa a palavra "Patrimônio": ela é do Patrimônio total (decisão de 10/11/2026)
      expect(screen.queryByText(/^Patrimônio em /)).toBeNull()
    })

    it('com provento no mês: o cartão aparece com o total do banco e o previsto ao lado', async () => {
      mock.listarTotalProventos.mockResolvedValue([{ moeda: 'BRL', recebido: c(1284), previsto: c(500) }, { moeda: 'USD', recebido: c(99999), previsto: c(0) }])
      render(<Investimentos />)
      const lista = await resumo()
      expect(within(lista).getAllByRole('listitem')).toHaveLength(4)
      expect(cartao(lista, 'Proventos no mês').textContent).toMatch(/R\$\s12,84/)
      expect(cartao(lista, 'Proventos no mês').textContent).toMatch(/R\$\s5,00 previstos/)
      // pede o mês corrente, do primeiro ao último dia
      const [, de, ate] = mock.listarTotalProventos.mock.calls[0] as [string, string, string]
      expect(de).toMatch(/^\d{4}-\d{2}-01$/)
      expect(ate.slice(0, 7)).toBe(de.slice(0, 7))
    })

    it('banco sem a migration 106 (total de proventos e instituições falham): a tela segue, sem o cartão e sem a aba Instituição', async () => {
      mock.listarTotalProventos.mockRejectedValue(new Error('PGRST202'))
      mock.listarInstituicoesInvestimentos.mockRejectedValue(new Error('PGRST202'))
      render(<Investimentos />)
      const lista = await resumo()
      expect(within(lista).getAllByRole('listitem')).toHaveLength(3)
      expect(screen.queryByRole('tab', { name: 'Instituição' })).toBeNull()
      expect(screen.queryByRole('alert')).toBeNull()
    })

    it('tabela: aportado, valor atual e rendimento por investimento, com classe · subclasse · instituição embaixo do nome; Total vem do banco', async () => {
      mock.listarAtivosInvestimento.mockResolvedValue([
        ativo('a1', 'Cofrinho 140% CDI', 'fixed_income', { subclasse: 'Cofrinho', instituicao: 'Banco Teste' }),
        ativo('a2', 'Ação Y', 'equity', { ticker: 'ACAO3' }),
      ])
      mock.listarCarteiraInvestimentos.mockResolvedValue({
        posicoes: [
          { ...posicao('a1', 'Cofrinho 140% CDI', 'fixed_income', 103661), quantidade: '1.002538105337', custoTotal: c(100000), resultado: c(3661), dataAvaliacao: '2026-11-10', fonteAvaliacao: 'manual' },
          { ...posicao('a2', 'Ação Y', 'equity', 9000), ticker: 'ACAO3', quantidade: '20', precoAtual: '4.5', custoTotal: c(10000), resultado: c(-1000) },
        ],
        // de propósito diferente da soma das linhas: o Total é o do banco, o front não soma
        totais: [{ moeda: 'BRL', custoTotal: c(110001), valorAtual: c(112662), resultado: c(2661) }],
      })
      // só o mês corrente traz provento por ativo; a seção de 12 meses fica vazia
      mock.listarProventosPorAtivo.mockImplementation(async (_f: string, de: string, ate: string) => de.slice(0, 7) === ate.slice(0, 7)
        ? [{ assetId: 'a2', nome: 'Ação Y', moeda: 'BRL', recebido: c(1284), previsto: c(0), ultimoRecebimento: null },
           { assetId: 'a1', nome: 'Cofrinho 140% CDI', moeda: 'BRL', recebido: c(0), previsto: c(700), ultimoRecebimento: null }]
        : [])
      render(<Investimentos />)
      const tabela = await screen.findByRole('table', { name: /Posições em BRL/ })
      expect(within(tabela).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Investimento', 'Aportado', 'Valor atual e rendimento', 'Rendimento'])

      const cofrinho = within(tabela).getByRole('rowheader', { name: /Cofrinho 140% CDI/ })
      expect(cofrinho.textContent).toMatch(/Renda fixa · Cofrinho · Banco Teste/)
      expect(cofrinho.textContent).toMatch(/Valor de 10\/11\/2026 · manual/)
      // ativo sem cota: nada de unidades nem preço (migration 104)
      expect(cofrinho.textContent).not.toMatch(/ un |preço|1,0025/)
      const linhaCofrinho = cofrinho.closest('tr') as HTMLElement
      const celulas = within(linhaCofrinho).getAllByRole('cell')
      expect(celulas[0].textContent).toMatch(/^R\$\s1\.000,00$/)
      expect(celulas[1].textContent).toMatch(/^R\$\s1\.036,61/)
      expect(celulas[2].textContent).toMatch(/\+R\$\s36,61\+3,7% sobre o aportado$/) // sem provento recebido: a linha de proventos não aparece
      expect(linhaCofrinho.textContent).not.toMatch(/proventos/)

      const acao = within(tabela).getByRole('rowheader', { name: /Ação Y · ACAO3/ })
      expect(acao.textContent).toMatch(/20 un · preço/)
      expect(acao.textContent).toMatch(/Sem avaliação: vale o aportado/) // modo custo: o texto de produção não muda
      const celulasAcao = within(acao.closest('tr') as HTMLElement).getAllByRole('cell')
      expect(celulasAcao[2].textContent).toMatch(/-R\$\s10,00-10,0% sobre o aportadoproventos R\$\s12,84 no mês$/)
      expect(celulasAcao[2].querySelector('p')?.className).toMatch(/text-prejuizo/)

      const total = within(tabela).getByRole('rowheader', { name: /^Total/ }).closest('tr') as HTMLElement
      const celulasTotal = within(total).getAllByRole('cell')
      expect(celulasTotal[0].textContent).toMatch(/^R\$\s1\.100,01$/)
      expect(celulasTotal[1].textContent).toMatch(/^R\$\s1\.126,62/)
      expect(celulasTotal[2].textContent).toMatch(/^\+R\$\s26,61$/)
    })

    it('com "ocultar valores": nem o sinal nem o percentual de rendimento aparecem', async () => {
      definirValoresOcultos(true)
      try {
        mock.listarCarteiraInvestimentos.mockResolvedValue({
          posicoes: [{ ...posicao('a1', 'Tesouro Selic', 'fixed_income', 107300), custoTotal: c(100000), resultado: c(7300) }],
          totais: [{ moeda: 'BRL', custoTotal: c(100000), valorAtual: c(107300), resultado: c(7300) }],
        })
        render(<Investimentos />)
        const lista = await resumo()
        expect(lista.textContent).not.toMatch(/\d|\+/)
        const tabela = await screen.findByRole('table', { name: /Posições em BRL/ })
        // "+ Aporte" e "+ Provento" são botões; o que não pode aparecer é sinal ou número de rendimento
        expect(tabela.textContent).not.toMatch(/sobre o aportado|\+R\$|\+•|73|7,3/)
        // a cor também não entrega se foi ganho ou perda
        expect(lista.innerHTML + tabela.innerHTML).not.toMatch(/text-lucro|text-prejuizo/)
      } finally { definirValoresOcultos(false) }
    })

    describe('aportes e resgates (migration 107, pedido do dono: "quanto saiu do bolso" e "quanto rendeu")', () => {
      const ap = (aportado: number, resgatado: number, valorAtual: number, moeda = 'BRL') => ({
        moeda, aportado: c(aportado), resgatado: c(resgatado), liquido: c(aportado - resgatado), valorAtual: c(valorAtual), ganho: c(valorAtual - (aportado - resgatado)),
      })
      // o caso que a revisão de dinheiro achou: pôs 1.000, passou a valer 1.100, tirou 550.
      // O custo do banco (investment_totals) diz 500 e 50; o dono quer ver 450 e 100.
      const cofrinhoComResgate = () => {
        mock.listarAtivosInvestimento.mockResolvedValue([ativo('a1', 'Cofrinho 140% CDI', 'fixed_income'), ativo('a2', 'Ação Y', 'equity', { ticker: 'ACAO3' })])
        mock.listarCarteiraInvestimentos.mockResolvedValue({
          posicoes: [
            { ...posicao('a1', 'Cofrinho 140% CDI', 'fixed_income', 55000), custoTotal: c(50000), resultado: c(5000) },
            { ...posicao('a2', 'Ação Y', 'equity', 23000), ticker: 'ACAO3', quantidade: '20', custoTotal: c(20000), resultado: c(3000) },
          ],
          totais: [{ moeda: 'BRL', custoTotal: c(70000), valorAtual: c(78000), resultado: c(8000) }],
        })
        mock.listarAportesInvestimentos.mockResolvedValue({
          porAtivo: new Map([['a1', ap(100000, 55000, 55000)], ['a2', ap(20000, 0, 23000)]]),
          totais: [ap(120000, 55000, 78000)],
        })
      }

      it('cartões: Aportado é o que pôs menos o que tirou, Rendimento conta o que já resgatou, e Carteira = Aportado + Rendimento', async () => {
        cofrinhoComResgate()
        render(<Investimentos />)
        const lista = await resumo()
        await waitFor(() => expect(cartao(lista, 'Aportado').textContent).toMatch(/R\$\s650,00/)) // 1.200 − 550, não o custo de 700
        expect(cartao(lista, 'Aportado').textContent).toMatch(/Pôs R\$\s1\.200,00 · tirou R\$\s550,00/)
        expect(cartao(lista, 'Valor atual da carteira').textContent).toMatch(/R\$\s780,00/)
        expect(cartao(lista, 'Rendimento').textContent).toMatch(/\+R\$\s130,00/) // 780 − 650, não os 80 do custo
        expect(cartao(lista, 'Rendimento').textContent).toMatch(/Contando o que já foi resgatado/)
        // com resgate o percentual some: rendimento ÷ aportado líquido não quer dizer nada
        expect(cartao(lista, 'Rendimento').textContent).not.toMatch(/%/)
        expect(screen.queryByText(/são do que ainda está investido/)).toBeNull()
      })

      it('tabela: cada linha e o Total usam os aportes; "Pôs · tirou" só onde houve resgate; percentual só onde não houve', async () => {
        cofrinhoComResgate()
        render(<Investimentos />)
        const tabela = await screen.findByRole('table', { name: /Posições em BRL/ })
        const cofrinho = within(tabela).getByRole('rowheader', { name: /Cofrinho 140% CDI/ })
        await waitFor(() => expect(cofrinho.textContent).toMatch(/Pôs R\$\s1\.000,00 · tirou R\$\s550,00/))
        const celulas = within(cofrinho.closest('tr') as HTMLElement).getAllByRole('cell')
        expect(celulas[0].textContent).toMatch(/^R\$\s450,00$/)
        expect(celulas[1].textContent).toMatch(/^R\$\s550,00/)
        expect(celulas[2].textContent).toMatch(/^\+R\$\s100,00$/)

        const acao = within(tabela).getByRole('rowheader', { name: /Ação Y/ })
        expect(acao.textContent).not.toMatch(/tirou/)
        const celulasAcao = within(acao.closest('tr') as HTMLElement).getAllByRole('cell')
        expect(celulasAcao[0].textContent).toMatch(/^R\$\s200,00$/)
        expect(celulasAcao[2].textContent).toMatch(/^\+R\$\s30,00\+15,0% sobre o aportado$/)

        const total = within(within(tabela).getByRole('rowheader', { name: /^Total/ }).closest('tr') as HTMLElement).getAllByRole('cell')
        expect(total.map((td) => td.textContent?.replace(/\s/g, ' '))).toEqual(['R$ 650,00', expect.stringMatching(/^R\$ 780,00/), '+R$ 130,00'])
        expect(screen.getByText('Quanto você pôs (menos o que tirou), quanto vale hoje e tudo o que rendeu.')).toBeTruthy()
      })

      it('sem resgate nenhum: "Aportado" é exatamente quanto saiu do bolso, com o percentual', async () => {
        // o valor de cada moeda tem de ser o mesmo da carteira (750,00 no beforeEach): só o aportado muda
        mock.listarAportesInvestimentos.mockResolvedValue({ porAtivo: new Map([['a1', ap(60000, 0, 60000)], ['a2', ap(10000, 0, 10000)], ['a3', ap(2000, 0, 5000)]]), totais: [ap(72000, 0, 75000)] })
        render(<Investimentos />)
        const lista = await resumo()
        // "Quanto você pôs", não "quanto saiu do bolso": compra sem conta e conta movida para a carteira também contam
        await waitFor(() => expect(cartao(lista, 'Aportado').textContent).toMatch(/Quanto você pôs/))
        expect(screen.queryByText(/saiu do bolso/)).toBeNull()
        expect(cartao(lista, 'Aportado').textContent).toMatch(/R\$\s720,00/)
        expect(cartao(lista, 'Rendimento').textContent).toMatch(/\+R\$\s30,00\+4,2% sobre o aportado/)
      })

      it('resgatou mais do que pôs: aportado negativo aparece como é, com o "pôs · tirou" explicando', async () => {
        mock.listarAportesInvestimentos.mockResolvedValue({ porAtivo: new Map([['a1', ap(100000, 200000, 60000)], ['a2', ap(10000, 0, 10000)], ['a3', ap(5000, 0, 5000)]]), totais: [ap(115000, 200000, 75000)] })
        render(<Investimentos />)
        const lista = await resumo()
        await waitFor(() => expect(cartao(lista, 'Aportado').textContent).toMatch(/-R\$\s850,00/))
        expect(cartao(lista, 'Aportado').textContent).toMatch(/Pôs R\$\s1\.150,00 · tirou R\$\s2\.000,00/)
        expect(cartao(lista, 'Rendimento').textContent).toMatch(/\+R\$\s1\.600,00/)
      })

      // a tela inteira (cartões, frase e tabela) no custo: nunca cartão num critério e tabela no outro
      const tudoNoCusto = async () => {
        const lista = await resumo()
        const tabela = await screen.findByRole('table', { name: /Posições em BRL/ })
        await waitFor(() => expect(mock.listarAportesInvestimentos).toHaveBeenCalled())
        expect(cartao(lista, 'Aportado').textContent).toMatch(/R\$\s750,00Custo do que está investido|Custo do que está investido.*R\$\s750,00/)
        expect(screen.getByText('Aportado e rendimento são do que ainda está investido: o que já foi resgatado não entra.')).toBeTruthy()
        expect(screen.getByText('Do que está investido hoje: quanto custou, quanto vale e o rendimento.')).toBeTruthy()
        expect(screen.queryByText(/Quanto você pôs/)).toBeNull()
        expect(tabela.textContent).not.toMatch(/9\.999,00|tirou/)
        const total = within(within(tabela).getByRole('rowheader', { name: /^Total/ }).closest('tr') as HTMLElement).getAllByRole('cell')
        expect(total[0].textContent).toMatch(/^R\$\s750,00$/) // investment_totals
      }

      it('se faltar o aporte de uma posição, a tela inteira fica no custo (cartões, frase e tabela; nunca metade de cada jeito)', async () => {
        mock.listarAportesInvestimentos.mockResolvedValue({ porAtivo: new Map([['a1', ap(999900, 0, 60000)]]), totais: [ap(999900, 0, 75000)] })
        render(<Investimentos />)
        await tudoNoCusto()
      })

      it('se o valor da moeda nos aportes não for o da carteira (alguém lançou algo entre as duas leituras), a tela inteira fica no custo', async () => {
        mock.listarAportesInvestimentos.mockResolvedValue({
          porAtivo: new Map([['a1', ap(60000, 0, 60000)], ['a2', ap(10000, 0, 10000)], ['a3', ap(5000, 0, 5000)]]),
          totais: [ap(75000, 0, 75100)],
        })
        render(<Investimentos />)
        await tudoNoCusto()
      })

      it('com filtro, a linha do ativo continua no mesmo critério de sem filtro, e o Total some', async () => {
        cofrinhoComResgate()
        const u = userEvent.setup()
        render(<Investimentos />)
        const linhaAcao = () => within(screen.getByRole('table', { name: /Posições em BRL/ })).getByRole('rowheader', { name: /Ação Y/ }).closest('tr') as HTMLElement
        await screen.findByText('Quanto você pôs (menos o que tirou), quanto vale hoje e tudo o que rendeu.')
        const antes = within(linhaAcao()).getAllByRole('cell').map((td) => td.textContent)
        await u.click(within(screen.getByRole('group', { name: 'Filtrar posições por classe' })).getByRole('button', { name: /^Renda variável/ }))
        expect(within(linhaAcao()).getAllByRole('cell').map((td) => td.textContent)).toEqual(antes)
        expect(within(linhaAcao()).getAllByRole('cell')[0].textContent).toMatch(/^R\$\s200,00$/)
        expect(within(screen.getByRole('table', { name: /Posições em BRL/ })).queryByRole('rowheader', { name: /^Total/ })).toBeNull()
      })

      describe('cartão de outra moeda (há um ativo em euro em produção)', () => {
        const comDolar = () => {
          mock.listarAtivosInvestimento.mockResolvedValue([ativo('a1', 'Tesouro Selic', 'fixed_income'), ativo('u1', 'REIT de teste', 'reit', { moeda: 'USD' })])
          mock.listarCarteiraInvestimentos.mockResolvedValue({
            posicoes: [posicao('a1', 'Tesouro Selic', 'fixed_income', 60000), { ...posicao('u1', 'REIT de teste', 'reit', 300), moeda: 'USD', custoTotal: c(250), resultado: c(50) }],
            totais: [{ moeda: 'BRL', custoTotal: c(60000), valorAtual: c(60000), resultado: c(0) }, { moeda: 'USD', custoTotal: c(250), valorAtual: c(300), resultado: c(50) }],
          })
        }
        const cartaoUsd = async () => (await screen.findByText('Valor de mercado em USD')).closest('div') as HTMLElement

        it('"≈ R$" pela PTAX (migration 108): o valor de mercado do dólar em reais, convertido pelo banco, com cotação e data', async () => {
          comDolar()
          mock.converterParaReais.mockResolvedValue([{ moeda: 'USD', valor: c(300), reais: c(1643), taxa: '5.47720', dataTaxa: '2026-11-10' }])
          render(<Investimentos />)
          const c1 = await cartaoUsd()
          await waitFor(() => expect(c1.textContent).toMatch(/≈ R\$\s16,43/))
          expect(c1.textContent).toMatch(/PTAX de 10\/11\/2026: US\$ 1 = R\$ 5,4772/)
          expect(mock.converterParaReais).toHaveBeenCalledWith([{ moeda: 'USD', valor: 300 }], expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/))
          // o total em reais (cartões de cima) não soma o dólar convertido
          expect((await resumo()).textContent).not.toMatch(/16,43/)
        })

        it('com "ocultar valores": o valor convertido sai mascarado', async () => {
          comDolar()
          mock.converterParaReais.mockResolvedValue([{ moeda: 'USD', valor: c(300), reais: c(1643), taxa: '5.47720', dataTaxa: '2026-11-10' }])
          definirValoresOcultos(true)
          try {
            render(<Investimentos />)
            const c1 = await cartaoUsd()
            await waitFor(() => expect(c1.textContent).toMatch(/≈/))
            expect(c1.textContent).not.toMatch(/16,43/)
          } finally { definirValoresOcultos(false) }
        })

        it('conversão de outro valor (leitura velha) ou sem cotação: nenhum "≈"', async () => {
          comDolar()
          mock.converterParaReais.mockResolvedValue([{ moeda: 'USD', valor: c(999), reais: c(5000), taxa: '5.0', dataTaxa: '2026-11-10' }])
          render(<Investimentos />)
          const c1 = await cartaoUsd()
          await waitFor(() => expect(mock.converterParaReais).toHaveBeenCalled())
          expect(c1.textContent).not.toMatch(/≈/)
        })

        it('sem a migration 107: custo do que está investido, com o aviso', async () => {
          comDolar()
          render(<Investimentos />)
          const c1 = await cartaoUsd()
          await waitFor(() => expect(mock.listarAportesInvestimentos).toHaveBeenCalled())
          expect(c1.textContent).toMatch(/AportadoUS\$\s2,50/)
          expect(c1.textContent).toMatch(/RendimentoUS\$\s0,50/)
          expect(c1.textContent).toMatch(/Do que ainda está investido: o que já foi resgatado não entra\./)
        })

        it('com a 107 e resgate: aportado líquido, rendimento total e "Pôs · tirou"', async () => {
          comDolar()
          mock.listarAportesInvestimentos.mockResolvedValue({
            porAtivo: new Map([['a1', ap(60000, 0, 60000)], ['u1', ap(500, 800, 300, 'USD')]]),
            totais: [ap(60000, 0, 60000), ap(500, 800, 300, 'USD')],
          })
          render(<Investimentos />)
          const c1 = await cartaoUsd()
          await waitFor(() => expect(c1.textContent).toMatch(/Pôs US\$\s5,00 · tirou US\$\s8,00/))
          expect(c1.textContent).toMatch(/Aportado-US\$\s3,00/)
          expect(c1.textContent).toMatch(/RendimentoUS\$\s6,00/)
          expect(c1.textContent).not.toMatch(/ainda está investido/)
        })
      })

      it('pede os aportes na data de hoje, uma vez por carga', async () => {
        render(<Investimentos />)
        await resumo()
        await waitFor(() => expect(mock.listarAportesInvestimentos).toHaveBeenCalledTimes(1))
        expect(mock.listarAportesInvestimentos).toHaveBeenCalledWith('h1', expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/))
      })
    })

    it('Composição da carteira, aba Instituição: valores somados no banco, "Sem instituição" para o que não tem', async () => {
      mock.listarInstituicoesInvestimentos.mockResolvedValue([
        { moeda: 'BRL', instituicao: 'Corretora Teste', valor: c(60000) },
        { moeda: 'BRL', instituicao: null, valor: c(15000) },
        { moeda: 'USD', instituicao: 'Fora', valor: c(999) },
      ])
      const u = userEvent.setup()
      render(<Investimentos />)
      const secao = (await screen.findByRole('heading', { name: 'Composição da carteira' })).closest('section') as HTMLElement
      await u.click(await within(secao).findByRole('tab', { name: 'Instituição' }))
      const linhas = within(secao).getByRole('list', { name: 'Lista da carteira por instituição' })
      expect(within(linhas).getAllByRole('listitem').map((li) => li.textContent?.replace(/\s/g, ' '))).toEqual([
        'Corretora TesteR$ 600,0080%', 'Sem instituiçãoR$ 150,0020%',
      ])
    })

    it('novo ativo com instituição: cria e depois grava a instituição; sem instituição, não chama', async () => {
      const u = userEvent.setup()
      render(<Investimentos />)
      await u.click(await screen.findByRole('button', { name: 'Novo ativo' }))
      await u.type(screen.getByLabelText('Nome do ativo'), 'CDB Banco X')
      await u.selectOptions(screen.getByLabelText('Categoria'), 'bancario')
      await u.type(screen.getByLabelText('Instituição (opcional)'), '  Banco X ')
      await u.click(screen.getByRole('button', { name: 'Salvar ativo' }))
      await waitFor(() => expect(mock.definirInstituicaoAtivo).toHaveBeenCalledWith('novo-id', '  Banco X '))

      await u.click(await screen.findByRole('button', { name: 'Novo ativo' }))
      await u.type(screen.getByLabelText('Nome do ativo'), 'Outro')
      await u.selectOptions(screen.getByLabelText('Categoria'), 'fundo')
      await u.click(screen.getByRole('button', { name: 'Salvar ativo' }))
      await waitFor(() => expect(mock.criarAtivoInvestimento).toHaveBeenCalledTimes(2))
      expect(mock.definirInstituicaoAtivo).toHaveBeenCalledTimes(1)
    })

    it('"% sobre o aportado": arredonda antes de pôr o sinal e não divide por zero', () => {
      expect(sobreOAportado(c(7300), c(100000))).toBe('+7,3% sobre o aportado')
      expect(sobreOAportado(c(-1000), c(10000))).toBe('-10,0% sobre o aportado')
      expect(sobreOAportado(c(4), c(10000))).toBe('0,0% sobre o aportado')
      expect(sobreOAportado(c(-4), c(10000))).toBe('0,0% sobre o aportado')
      expect(sobreOAportado(c(100), c(0))).toBeNull()
    })

    it('banco sem a migration 106: o campo Instituição não aparece no cadastro nem na edição, e o resto salva normalmente', async () => {
      mock.listarInstituicoesInvestimentos.mockRejectedValue(new Error('PGRST202'))
      const u = userEvent.setup()
      render(<Investimentos />)
      await u.click(await screen.findByRole('button', { name: 'Novo ativo' }))
      expect(screen.getByLabelText('Subclasse (opcional)')).toBeTruthy()
      expect(screen.queryByLabelText('Instituição (opcional)')).toBeNull()
      await u.click(screen.getByRole('button', { name: 'Cancelar' }))
      await u.click(await screen.findByRole('button', { name: 'Editar Tesouro Selic' }))
      expect(screen.queryByLabelText('Instituição (opcional; vazio limpa)')).toBeNull()
      await u.click(screen.getByRole('button', { name: 'Salvar' }))
      await waitFor(() => expect(mock.editarAtivoInvestimento).toHaveBeenCalledTimes(1))
      expect(mock.definirInstituicaoAtivo).not.toHaveBeenCalled()
      expect(screen.queryByRole('alert')).toBeNull()
    })

    it('novo ativo: se subclasse e instituição falharem depois do ativo criado, os dois avisos aparecem', async () => {
      mock.definirSubclasseAtivo.mockRejectedValue(new Error('subclasse inválida'))
      mock.definirInstituicaoAtivo.mockRejectedValue(new Error('instituição inválida (até 40 caracteres)'))
      const u = userEvent.setup()
      render(<Investimentos />)
      await u.click(await screen.findByRole('button', { name: 'Novo ativo' }))
      await u.type(screen.getByLabelText('Nome do ativo'), 'CDB Banco X')
      await u.selectOptions(screen.getByLabelText('Categoria'), 'bancario')
      await u.type(screen.getByLabelText('Instituição (opcional)'), 'Banco X')
      await u.click(screen.getByRole('button', { name: 'Salvar ativo' }))
      const aviso = (await screen.findByRole('alert')).textContent
      expect(aviso).toMatch(/Ativo cadastrado, mas a subclasse não foi salva/)
      expect(aviso).toMatch(/Ativo cadastrado, mas a instituição não foi salva/)
      expect(screen.queryByRole('dialog', { name: 'Novo ativo' })).toBeNull()
    })

    it('editar ativo: se a instituição falhar, o resto já foi gravado; o formulário fecha, a lista recarrega e o aviso diz o que faltou', async () => {
      mock.definirInstituicaoAtivo.mockRejectedValue(new Error('instituição inválida (até 40 caracteres)'))
      const u = userEvent.setup()
      render(<Investimentos />)
      await u.click(await screen.findByRole('button', { name: 'Editar Tesouro Selic' }))
      const cargas = mock.listarAtivosInvestimento.mock.calls.length
      await u.type(screen.getByLabelText('Instituição (opcional; vazio limpa)'), 'Corretora Teste')
      await u.click(screen.getByRole('button', { name: 'Salvar' }))
      expect((await screen.findByRole('alert')).textContent).toMatch(/Ativo atualizado, mas a instituição não foi salva/)
      expect(mock.editarAtivoInvestimento).toHaveBeenCalledTimes(1)
      expect(screen.queryByLabelText('Instituição (opcional; vazio limpa)')).toBeNull() // fechou
      expect(mock.listarAtivosInvestimento.mock.calls.length).toBeGreaterThan(cargas) // recarregou
    })

    it('editar ativo: a instituição só vai para o banco quando mudou; vazio limpa', async () => {
      mock.listarAtivosInvestimento.mockResolvedValue([ativo('a1', 'Tesouro Selic', 'fixed_income', { instituicao: 'Corretora Teste' })])
      const u = userEvent.setup()
      render(<Investimentos />)
      await u.click(await screen.findByRole('button', { name: 'Editar Tesouro Selic' }))
      const campo = screen.getByLabelText('Instituição (opcional; vazio limpa)') as HTMLInputElement
      expect(campo.value).toBe('Corretora Teste')
      await u.click(screen.getByRole('button', { name: 'Salvar' }))
      await waitFor(() => expect(mock.editarAtivoInvestimento).toHaveBeenCalledTimes(1))
      expect(mock.editarAtivoInvestimento).toHaveBeenCalledWith({ ativoId: 'a1', nome: 'Tesouro Selic', ticker: '', classe: 'fixed_income' })
      expect(mock.definirInstituicaoAtivo).not.toHaveBeenCalled()

      await u.click(await screen.findByRole('button', { name: 'Editar Tesouro Selic' }))
      await u.clear(screen.getByLabelText('Instituição (opcional; vazio limpa)'))
      await u.click(screen.getByRole('button', { name: 'Salvar' }))
      await waitFor(() => expect(mock.definirInstituicaoAtivo).toHaveBeenCalledWith('a1', ''))
    })
  })

  describe('gerir ativos cadastrados', () => {
    // a1 tem posição; a4 foi zerado (comprou e vendeu: tem operações); a5 está arquivado; a6 nunca foi usado
    const comZerado = () => mock.listarAtivosInvestimento.mockResolvedValue([
      ativo('a1', 'Tesouro Selic', 'fixed_income', { quantidadeOperacoes: 3 }),
      ativo('a4', 'Ação zerada', 'equity', { quantidadeOperacoes: 2 }),
      ativo('a5', 'Fundo antigo', 'fund', { ativo: false, quantidadeOperacoes: 1 }),
      ativo('a6', 'Nunca usado', 'other'),
    ])
    const linhaDe = async (nome: string) => (await screen.findByText(new RegExp(`^${nome}`), { selector: 'p.font-medium' })).closest('li') as HTMLElement

    it('mostra a situação: posição aberta, sem posição (zerado) e arquivado', async () => {
      comZerado()
      render(<Investimentos />)
      expect(within(await linhaDe('Tesouro Selic')).getByText('Posição aberta')).toBeTruthy()
      expect(within(await linhaDe('Ação zerada')).getByText('Sem posição')).toBeTruthy()
      expect(within(await linhaDe('Fundo antigo')).getByText('Arquivado')).toBeTruthy()
    })

    it('arquivar só sem posição aberta; reativar só no arquivado; excluir só sem histórico (senão "Histórico protegido")', async () => {
      comZerado()
      render(<Investimentos />)
      const aberto = await linhaDe('Tesouro Selic')
      expect(within(aberto).queryByRole('button', { name: 'Arquivar Tesouro Selic' })).toBeNull()
      expect(within(aberto).queryByRole('button', { name: 'Excluir Tesouro Selic' })).toBeNull()
      expect(within(aberto).getByText('Histórico protegido')).toBeTruthy()
      // zerado: tem histórico, então arquiva mas NÃO exclui
      const zerado = await linhaDe('Ação zerada')
      expect(within(zerado).getByRole('button', { name: 'Arquivar Ação zerada' })).toBeTruthy()
      expect(within(zerado).queryByRole('button', { name: 'Excluir Ação zerada' })).toBeNull()
      expect(within(zerado).getByText('Histórico protegido')).toBeTruthy()
      // nunca usado: pode arquivar e pode excluir
      const virgem = await linhaDe('Nunca usado')
      expect(within(virgem).getByRole('button', { name: 'Arquivar Nunca usado' })).toBeTruthy()
      expect(within(virgem).getByRole('button', { name: 'Excluir Nunca usado' })).toBeTruthy()
      // arquivado: reativa, não arquiva
      const arquivado = await linhaDe('Fundo antigo')
      expect(within(arquivado).getByRole('button', { name: 'Reativar Fundo antigo' })).toBeTruthy()
      expect(within(arquivado).queryByRole('button', { name: 'Arquivar Fundo antigo' })).toBeNull()
    })

    it('arquivar e reativar chamam o banco e recarregam', async () => {
      comZerado()
      const u = userEvent.setup()
      render(<Investimentos />)
      const antes = mock.listarAtivosInvestimento.mock.calls.length
      await u.click(within(await linhaDe('Ação zerada')).getByRole('button', { name: 'Arquivar Ação zerada' }))
      expect(mock.arquivarAtivoInvestimento).toHaveBeenCalledWith('a4')
      await u.click(within(await linhaDe('Fundo antigo')).getByRole('button', { name: 'Reativar Fundo antigo' }))
      expect(mock.reativarAtivoInvestimento).toHaveBeenCalledWith('a5')
      expect(mock.listarAtivosInvestimento.mock.calls.length).toBeGreaterThan(antes)
    })

    it('excluir pede confirmação; recusar não chama o banco', async () => {
      comZerado()
      const u = userEvent.setup()
      const confirmar = vi.spyOn(window, 'confirm').mockReturnValue(false)
      render(<Investimentos />)
      await u.click(within(await linhaDe('Nunca usado')).getByRole('button', { name: 'Excluir Nunca usado' }))
      expect(confirmar).toHaveBeenCalled()
      expect(mock.excluirAtivoInvestimento).not.toHaveBeenCalled()
      confirmar.mockReturnValue(true)
      await u.click(within(await linhaDe('Nunca usado')).getByRole('button', { name: 'Excluir Nunca usado' }))
      expect(mock.excluirAtivoInvestimento).toHaveBeenCalledWith('a6')
      confirmar.mockRestore()
    })

    it('ativo com histórico: pede o nome; cancelar não exclui nada', async () => {
      comZerado()
      mock.excluirAtivoInvestimento.mockRejectedValue(Object.assign(new Error('Este ativo possui operações, avaliações ou proventos. O histórico financeiro não pode ser excluído.'), { code: '55000' }))
      const u = userEvent.setup()
      vi.spyOn(window, 'confirm').mockReturnValue(true)
      const prompt = vi.spyOn(window, 'prompt').mockReturnValue(null)
      render(<Investimentos />)
      await u.click(within(await linhaDe('Nunca usado')).getByRole('button', { name: 'Excluir Nunca usado' }))
      await waitFor(() => expect(prompt).toHaveBeenCalled())
      expect(mock.excluirAtivoComHistorico).not.toHaveBeenCalled()
      expect(screen.queryByRole('alert')).toBeNull()
    })

    it('ativo com histórico: com o nome digitado, exclui junto com o histórico', async () => {
      comZerado()
      mock.excluirAtivoInvestimento.mockRejectedValue(Object.assign(new Error('trava'), { code: '55000' }))
      mock.excluirAtivoComHistorico.mockResolvedValue({ operacoes: 1, avaliacoes: 0, proventos: 0 })
      const u = userEvent.setup()
      vi.spyOn(window, 'confirm').mockReturnValue(true)
      vi.spyOn(window, 'prompt').mockReturnValue('Nunca usado')
      render(<Investimentos />)
      await u.click(within(await linhaDe('Nunca usado')).getByRole('button', { name: 'Excluir Nunca usado' }))
      await waitFor(() => expect(mock.excluirAtivoComHistorico).toHaveBeenCalledWith(expect.any(String), 'Nunca usado'))
    })

    it('outro erro do banco aparece na tela', async () => {
      comZerado()
      mock.excluirAtivoInvestimento.mockRejectedValue(Object.assign(new Error('ativo não encontrado'), { code: '42501' }))
      const u = userEvent.setup()
      vi.spyOn(window, 'confirm').mockReturnValue(true)
      render(<Investimentos />)
      await u.click(within(await linhaDe('Nunca usado')).getByRole('button', { name: 'Excluir Nunca usado' }))
      expect(await screen.findByRole('alert')).toBeTruthy()
      expect(mock.excluirAtivoComHistorico).not.toHaveBeenCalled()
    })

    it('editar: corrige nome, código e classe; a moeda aparece mas não muda', async () => {
      comZerado()
      mock.listarAtivosInvestimento.mockResolvedValue([ativo('a4', 'Acao zerda', 'equity', { ticker: 'ZER3' })])
      const u = userEvent.setup()
      render(<Investimentos />)
      await u.click(await screen.findByRole('button', { name: 'Editar Acao zerda' }))
      expect(screen.getByText(/Moeda:/).textContent).toMatch(/BRL/)
      const nome = screen.getByLabelText('Nome do ativo')
      await u.clear(nome)
      await u.type(nome, 'Ação zerada')
      await u.selectOptions(screen.getByLabelText('Classe'), 'etf')
      await u.click(screen.getByRole('button', { name: 'Salvar' }))
      expect(mock.editarAtivoInvestimento).toHaveBeenCalledWith({ ativoId: 'a4', nome: 'Ação zerada', ticker: 'ZER3', classe: 'etf' })
    })

    it('editar: nome vazio não chama o banco', async () => {
      comZerado()
      const u = userEvent.setup()
      render(<Investimentos />)
      await u.click(await screen.findByRole('button', { name: 'Editar Ação zerada' }))
      await u.clear(screen.getByLabelText('Nome do ativo'))
      await u.click(screen.getByRole('button', { name: 'Salvar' }))
      expect(screen.getByText('Informe o nome do ativo.')).toBeTruthy()
      expect(mock.editarAtivoInvestimento).not.toHaveBeenCalled()
    })

    it('editar abre o formulário dentro do próprio ativo (não lá em cima da página)', async () => {
      comZerado()
      const u = userEvent.setup()
      render(<Investimentos />)
      await u.click(within(await linhaDe('Ação zerada')).getByRole('button', { name: 'Editar Ação zerada' }))
      expect(within(await linhaDe('Ação zerada')).getByLabelText('Nome do ativo')).toBeTruthy()
    })

    it('trocar o ativo em edição mostra os dados do novo ativo (nunca grava o nome de outro)', async () => {
      comZerado()
      const u = userEvent.setup()
      render(<Investimentos />)
      await u.click(within(await linhaDe('Ação zerada')).getByRole('button', { name: 'Editar Ação zerada' }))
      await u.click(within(await linhaDe('Nunca usado')).getByRole('button', { name: 'Editar Nunca usado' }))
      expect((screen.getByLabelText('Nome do ativo') as HTMLInputElement).value).toBe('Nunca usado')
      await u.click(screen.getByRole('button', { name: 'Salvar' }))
      expect(mock.editarAtivoInvestimento).toHaveBeenCalledWith({ ativoId: 'a6', nome: 'Nunca usado', ticker: '', classe: 'other' })
    })

    it('erro do banco ao salvar a edição aparece dentro do formulário e o formulário continua aberto', async () => {
      comZerado()
      mock.editarAtivoInvestimento.mockRejectedValue(Object.assign(new Error('duplicate key'), { code: '23505' }))
      const u = userEvent.setup()
      render(<Investimentos />)
      await u.click(within(await linhaDe('Ação zerada')).getByRole('button', { name: 'Editar Ação zerada' }))
      await u.click(screen.getByRole('button', { name: 'Salvar' }))
      expect(within(await linhaDe('Ação zerada')).getByText('Já existe um registro com esse nome.')).toBeTruthy()
      expect(screen.getByLabelText('Nome do ativo')).toBeTruthy()
    })
    describe('extrato do ativo', () => {
      const abrir = async (u: ReturnType<typeof userEvent.setup>) => {
        await u.click(within(await linhaDe('Tesouro Selic')).getByRole('button', { name: 'Extrato de Tesouro Selic' }))
        return within(await linhaDe('Tesouro Selic')).findByRole('list', { name: 'Movimentos de Tesouro Selic' })
      }

      it('abre dentro da linha do ativo com valores e saldo do banco; anulada riscada com o motivo', async () => {
        comZerado()
        const u = userEvent.setup()
        render(<Investimentos />)
        const lista = await abrir(u)
        expect(mock.listarExtratoAtivo).toHaveBeenCalledWith('h1', 'a1')
        expect(lista.textContent).toMatch(/101,00/)
        // a1 não tem ticker (ativo sem cota, migration 104): unidade, preço e saldo em unidades não aparecem
        expect(lista.textContent).not.toMatch(/Saldo: 6/)
        expect(lista.textContent).not.toMatch(/10 × /)
        expect(lista.textContent).toMatch(/3,50/)
        expect(lista.textContent).toMatch(/Dividendos · Recebido/)
        const anulada = within(lista).getByText('Anulada').closest('li') as HTMLElement
        expect(anulada.textContent).toMatch(/Motivo: digitei errado/)
        expect(anulada.querySelector('.line-through')).toBeTruthy()
        // só compra/venda não anulada tem Excluir: o1 e o3 (nem a anulada nem o provento)
        expect(within(lista).getAllByRole('button', { name: /^Excluir / })).toHaveLength(2)
        expect(within(anulada).queryByRole('button', { name: /^Excluir/ })).toBeNull()
      })

      it('excluir operação com avaliação depois dela avisa que o valor muda em proporção; sem avaliação depois, não avisa', async () => {
        comZerado()
        mock.listarExtratoAtivo.mockResolvedValue([
          ...extratoBase(),
          linhaExtrato({ id: 'v1', tipo: 'valuation', data: '2026-10-08', quantidade: null, precoUnitario: '12', taxa: null, valor: c(12000), fonte: 'extrato', saldoQuantidade: null }),
        ])
        const u = userEvent.setup()
        render(<Investimentos />)
        const lista = await abrir(u)
        // compra de 01/10: a avaliação de 08/10 veio depois
        await u.click(within(lista).getByRole('button', { name: 'Excluir compra de 01/10/2026' }))
        expect(screen.getByText(/tem avaliação depois desta operação/)).toBeTruthy()
        await u.click(screen.getByRole('button', { name: 'Cancelar' }))
        // venda de 10/10: nenhuma avaliação depois
        await u.click(within(lista).getByRole('button', { name: 'Excluir venda de 10/10/2026' }))
        expect(screen.queryByText(/tem avaliação depois desta operação/)).toBeNull()
      })

      it('excluir pede o motivo, chama a anulação e recarrega extrato e carteira', async () => {
        comZerado()
        const u = userEvent.setup()
        render(<Investimentos />)
        const lista = await abrir(u)
        const antes = mock.listarCarteiraInvestimentos.mock.calls.length
        await u.click(within(lista).getByRole('button', { name: 'Excluir venda de 10/10/2026' }))
        await u.click(screen.getByRole('button', { name: 'Confirmar exclusão' }))
        expect(screen.getByText(/Informe o motivo da exclusão/)).toBeTruthy()
        expect(mock.anularOperacaoInvestimento).not.toHaveBeenCalled()
        await u.type(screen.getByLabelText('Motivo da exclusão'), 'venda duplicada')
        await u.click(screen.getByRole('button', { name: 'Confirmar exclusão' }))
        expect(mock.anularOperacaoInvestimento).toHaveBeenCalledWith('o3', 'venda duplicada')
        expect(mock.listarExtratoAtivo.mock.calls.length).toBeGreaterThan(1)
        expect(mock.listarCarteiraInvestimentos.mock.calls.length).toBeGreaterThan(antes)
      })

      it('recusa do banco (compra cobre venda posterior) aparece dentro do painel do extrato', async () => {
        comZerado()
        mock.anularOperacaoInvestimento.mockRejectedValue(Object.assign(new Error('não dá para anular: sem esta compra, as vendas posteriores ficariam maiores que a posição. Anule a venda antes.'), { code: '23514' }))
        const u = userEvent.setup()
        render(<Investimentos />)
        const lista = await abrir(u)
        await u.click(within(lista).getByRole('button', { name: 'Excluir compra de 01/10/2026' }))
        await u.type(screen.getByLabelText('Motivo da exclusão'), 'compra errada')
        await u.click(screen.getByRole('button', { name: 'Confirmar exclusão' }))
        const painel = (await screen.findByRole('heading', { name: 'Extrato de Tesouro Selic' })).closest('div')!.parentElement as HTMLElement
        expect((await within(painel).findByRole('alert')).textContent).toMatch(/Anule a venda antes/)
      })
    })
  })

  describe('resumo patrimonial e cabeçalho (etapa 1 do redesenho, pedido do dono, 12/11/2026)', () => {
    const resumo = async () => await screen.findByRole('list', { name: 'Resumo da carteira em reais' })
    const cabecalho = async () => (await screen.findByRole('heading', { level: 1, name: 'Investimentos' })).closest('header') as HTMLElement

    it('cabeçalho: uma ação principal (Registrar operação, em azul cheio); Novo ativo e Registrar provento em peso menor', async () => {
      render(<Investimentos />)
      const topo = await cabecalho()
      const principal = within(topo).getByRole('button', { name: 'Registrar operação' })
      expect(principal.className).toMatch(/bg-azul text-white/)
      for (const nome of ['Novo ativo', 'Registrar provento']) {
        const secundaria = within(topo).getByRole('button', { name: nome })
        expect(secundaria.className).not.toMatch(/bg-azul text-white|border/)
        expect(secundaria.className).toMatch(/text-azul/)
      }
      // só um botão em azul cheio no cabeçalho
      expect(within(topo).getAllByRole('button').filter((b) => /bg-azul text-white/.test(b.className))).toHaveLength(1)
    })

    it('cabeçalho: as ações continuam abrindo a folha certa', async () => {
      const u = userEvent.setup()
      render(<Investimentos />)
      const topo = await cabecalho()
      await u.click(within(topo).getByRole('button', { name: 'Registrar operação' }))
      expect(screen.getByRole('dialog', { name: 'Registrar compra ou venda' })).toBeTruthy()
      await u.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancelar' }))
      await u.click(within(topo).getByRole('button', { name: 'Novo ativo' }))
      expect(screen.getByRole('dialog', { name: 'Novo ativo' })).toBeTruthy()
    })

    it('aviso: uma linha compacta; o detalhe só aparece ao expandir, e o botão diz o estado (aria-expanded)', async () => {
      const u = userEvent.setup()
      render(<Investimentos />)
      await resumo()
      expect(screen.getByText('Cada moeda é contada à parte, sem conversão entre elas.')).toBeTruthy()
      expect(screen.queryByText(/cotação diária da B3/)).toBeNull()
      const botao = screen.getByRole('button', { name: 'Como funciona' })
      expect(botao.getAttribute('aria-expanded')).toBe('false')
      await u.click(botao)
      expect(botao.getAttribute('aria-expanded')).toBe('true')
      const detalhe = screen.getByText(/cotação diária da B3/)
      expect(detalhe.textContent).toMatch(/sem virar despesa nem receita/)
      expect(botao.getAttribute('aria-controls')).toBe(detalhe.id)
      expect(botao.textContent).toBe('Mostrar menos')
      await u.click(botao)
      expect(screen.queryByText(/cotação diária da B3/)).toBeNull()
    })

    it('resumo: o valor atual da carteira vem primeiro e maior; Aportado e Rendimento são indicadores menores', async () => {
      mock.listarCarteiraInvestimentos.mockResolvedValue({
        posicoes: [posicao('a1', 'Tesouro Selic', 'fixed_income', 60000)],
        totais: [{ moeda: 'BRL', custoTotal: c(100000), valorAtual: c(107300), resultado: c(7300) }],
      })
      render(<Investimentos />)
      const itens = within(await resumo()).getAllByRole('listitem')
      expect(within(itens[0]).getByText('Valor atual da carteira')).toBeTruthy()
      expect(itens[0].textContent).toMatch(/R\$\s1\.073,00/)
      expect(itens[1].textContent).toMatch(/^Aportado/)
      expect(itens[2].textContent).toMatch(/^Rendimento/)
      const tamanho = (li: HTMLElement) => li.innerHTML.match(/text-(3xl|4xl|2xl|xl|lg)\b/)?.[1]
      expect(tamanho(itens[0])).toBe('3xl')
      expect(tamanho(itens[1])).toBe('lg')
      expect(tamanho(itens[2])).toBe('lg')
    })

    it('resumo com proventos no mês: o quarto indicador entra depois dos outros, e o destaque continua primeiro', async () => {
      mock.listarTotalProventos.mockResolvedValue([{ moeda: 'BRL', recebido: c(12000), previsto: c(0) }])
      render(<Investimentos />)
      await waitFor(async () => expect(within(await resumo()).getAllByRole('listitem')).toHaveLength(4))
      const itens = within(await resumo()).getAllByRole('listitem')
      expect(itens.map((li) => li.textContent?.slice(0, 8))).toEqual(['Valor at', 'Aportado', 'Rendimen', 'Proventos'.slice(0, 8)])
    })

    it('com "ocultar valores": o destaque e os indicadores mostram só a máscara, sem número', async () => {
      definirValoresOcultos(true)
      try {
        render(<Investimentos />)
        const lista = await resumo()
        expect(lista.textContent).toMatch(/Valor atual da carteira/)
        expect(lista.textContent).toMatch(/••••/)
        expect(lista.textContent).not.toMatch(/\d/)
      } finally { definirValoresOcultos(false) }
    })

    it('outras moedas continuam em cartões à parte, fora do destaque em reais e sem ser somadas a ele', async () => {
      mock.listarAtivosInvestimento.mockResolvedValue([ativo('a1', 'Tesouro Selic', 'fixed_income'), ativo('u1', 'REIT de teste', 'reit', { moeda: 'USD' })])
      mock.listarCarteiraInvestimentos.mockResolvedValue({
        posicoes: [posicao('a1', 'Tesouro Selic', 'fixed_income', 60000), { ...posicao('u1', 'REIT de teste', 'reit', 300), moeda: 'USD', custoTotal: c(250), resultado: c(50) }],
        totais: [{ moeda: 'BRL', custoTotal: c(60000), valorAtual: c(60000), resultado: c(0) }, { moeda: 'USD', custoTotal: c(250), valorAtual: c(300), resultado: c(50) }],
      })
      render(<Investimentos />)
      const lista = await resumo()
      expect(within(lista).getAllByRole('listitem')[0].textContent).toMatch(/R\$\s600,00/)
      expect(lista.textContent).not.toMatch(/US\$|603|3,00/)
      const dolar = (await screen.findByText('Valor de mercado em USD')).closest('div') as HTMLElement
      expect(dolar.textContent).toMatch(/US\$\s3,00/)
      expect(lista.contains(dolar)).toBe(false)
    })
  })

  describe('compra e venda numa folha, no desenho de Lançamentos (pedido do dono, 10/11/2026)', () => {
    const abrir = async (u: ReturnType<typeof userEvent.setup>) => {
      render(<Investimentos />)
      await u.click(await screen.findByRole('button', { name: 'Registrar operação' }))
      return screen.getByRole('dialog', { name: 'Registrar compra ou venda' })
    }

    it('topo: carteira em destaque, parado na corretora (do banco), e Investir/Resgatar abrem a folha já em Compra ou Venda', async () => {
      mock.listarContas.mockResolvedValue({ contas: [{ id: 'c1', nome: 'Corretora', ativa: true }], total: c(0),
        porTipo: [{ tipo: 'brokerage', total: c(9999), totalAtivas: c(1304) }, { tipo: 'checking', total: c(5), totalAtivas: c(5) }] })
      const u = userEvent.setup()
      render(<Investimentos />)
      const card = (await screen.findByRole('list', { name: 'Resumo da carteira em reais' })).parentElement as HTMLElement
      expect(within(card).getByText('Valor atual da carteira').closest('li')?.textContent).toMatch(/R\$\s750,00/)
      expect(within(card).getByText(/Parado na corretora/).textContent).toMatch(/R\$\s13,04/)
      await u.click(within(card).getByRole('button', { name: 'Resgatar' }))
      let folha = screen.getByRole('dialog', { name: 'Registrar compra ou venda' })
      expect(within(folha).getByRole('radio', { name: 'Venda' }).getAttribute('aria-checked')).toBe('true')
      await u.click(within(folha).getByRole('button', { name: 'Cancelar' }))
      await u.click(within(card).getByRole('button', { name: 'Investir' }))
      folha = screen.getByRole('dialog', { name: 'Registrar compra ou venda' })
      expect(within(folha).getByRole('radio', { name: 'Compra' }).getAttribute('aria-checked')).toBe('true')
    })

    it('"Registrar compra" lá embaixo abre a folha por cima da tela (não um formulário no topo)', async () => {
      mock.listarCarteiraInvestimentos.mockResolvedValue({ posicoes: [], totais: [] })
      render(<Investimentos />)
      await userEvent.click(await screen.findByRole('button', { name: 'Registrar compra' }))
      expect(screen.getByRole('dialog', { name: 'Registrar compra ou venda' })).toBeTruthy()
    })

    it('ativo sem cota e sem histórico: "Só o valor" manda só o valor ao banco, sem conta no front', async () => {
      mock.listarAtivosInvestimento.mockResolvedValue([ativo('p1', 'Previdência', 'other', { liquidez: 'restricted' })])
      const u = userEvent.setup()
      const folha = await abrir(u)
      // ativo sem ticker é só por valor: não há como trocar para quantidade e preço (revisão de dinheiro da #294)
      expect(within(folha).queryByRole('radiogroup', { name: 'Como informar' })).toBeNull()
      expect(within(folha).queryByLabelText('Quantidade')).toBeNull()
      await u.type(within(folha).getByLabelText('Valor de hoje (BRL)'), '193.636,78')
      await u.click(within(folha).getByRole('button', { name: 'Registrar compra' }))
      expect(mock.registrarOperacaoPorValor).toHaveBeenCalledWith(expect.objectContaining({ ativoId: 'p1', tipo: 'buy', valor: 19363678 }))
      // nem quantidade nem preço saem do front: quem converte é o banco (migration 104)
      expect(mock.registrarOperacaoPorValor.mock.lastCall?.[0]).not.toHaveProperty('quantidade')
      expect(mock.registrarOperacaoInvestimento).not.toHaveBeenCalled()
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    })

    it('conta da compra é opcional: escolhida, vai junto; sem escolher, não vai; ativo em dólar não pede conta', async () => {
      mock.listarAtivosInvestimento.mockResolvedValue([ativo('p1', 'Previdência', 'other'), ativo('u1', 'Stock', 'equity', { moeda: 'USD', ticker: 'AAPL' })])
      const u = userEvent.setup()
      const folha = await abrir(u)
      expect((within(folha).getByLabelText('Saiu da conta') as HTMLSelectElement).value).toBe('')
      await u.selectOptions(within(folha).getByLabelText('Saiu da conta'), 'c1')
      expect(within(folha).getByText(/sai da conta escolhida e vai para a carteira, sem virar despesa/)).toBeTruthy()
      await u.type(within(folha).getByLabelText('Valor de hoje (BRL)'), '100,00')
      await u.click(within(folha).getByRole('button', { name: 'Registrar compra' }))
      expect(mock.registrarOperacaoPorValor).toHaveBeenLastCalledWith(expect.objectContaining({ ativoId: 'p1', contaId: 'c1' }))

      await u.click(await screen.findByRole('button', { name: 'Registrar operação' }))
      const outra = screen.getByRole('dialog', { name: 'Registrar compra ou venda' })
      await u.type(within(outra).getByLabelText('Valor de hoje (BRL)'), '50,00')
      await u.click(within(outra).getByRole('button', { name: 'Registrar compra' }))
      expect(mock.registrarOperacaoPorValor.mock.lastCall?.[0]).not.toHaveProperty('contaId')

      await u.click(await screen.findByRole('button', { name: 'Registrar operação' }))
      const usd = screen.getByRole('dialog', { name: 'Registrar compra ou venda' })
      await u.selectOptions(within(usd).getByLabelText('Ativo'), 'u1')
      expect(within(usd).queryByLabelText('Saiu da conta')).toBeNull()
    })

    it('ativo com ticker começa em "Quantidade e preço"; quantidade e preço vão como digitados; venda troca o botão', async () => {
      mock.listarAtivosInvestimento.mockResolvedValue([ativo('a2', 'Ação Y', 'equity', { ticker: 'ACAO3', quantidadeOperacoes: 2 })])
      const u = userEvent.setup()
      const folha = await abrir(u)
      expect(within(folha).getByRole('radio', { name: 'Quantidade e preço' }).getAttribute('aria-checked')).toBe('true')
      await u.click(within(folha).getByRole('radio', { name: 'Venda' }))
      await u.type(within(folha).getByLabelText('Quantidade'), '10,5')
      await u.type(within(folha).getByLabelText('Preço por unidade (BRL)'), '25,75')
      await u.click(within(folha).getByRole('button', { name: 'Registrar venda' }))
      expect(mock.registrarOperacaoInvestimento).toHaveBeenCalledWith(expect.objectContaining({ ativoId: 'a2', tipo: 'sell', quantidade: '10,5', precoUnitario: '25,75' }))
      expect(mock.registrarOperacaoPorValor).not.toHaveBeenCalled()
    })

    it('ativo sem cota COM histórico (cofrinho): aporte e resgate só pelo valor, com a conta; sem tarifas nem unidades (migration 104)', async () => {
      mock.listarAtivosInvestimento.mockResolvedValue([ativo('k1', 'Cofrinho 140% CDI', 'fixed_income', { quantidadeOperacoes: 3, quantidadeAvaliacoes: 2 })])
      const u = userEvent.setup()
      let folha = await abrir(u)
      // com histórico e avaliação, "1 × R$ 500" gravaria 1 unidade ao preço da avaliação: a opção não existe
      expect(within(folha).queryByRole('radiogroup', { name: 'Como informar' })).toBeNull()
      expect(within(folha).queryByRole('radio', { name: 'Quantidade e preço' })).toBeNull()
      expect(within(folha).queryByLabelText('Quantidade')).toBeNull()
      expect(within(folha).queryByLabelText('Tarifas (BRL)')).toBeNull()
      await u.selectOptions(within(folha).getByLabelText('Saiu da conta'), 'c1')
      await u.type(within(folha).getByLabelText('Valor do aporte (BRL)'), '500,00')
      await u.click(within(folha).getByRole('button', { name: 'Registrar compra' }))
      expect(mock.registrarOperacaoPorValor).toHaveBeenLastCalledWith(expect.objectContaining({ ativoId: 'k1', tipo: 'buy', valor: 50000, contaId: 'c1' }))

      await u.click(await screen.findByRole('button', { name: 'Registrar operação' }))
      folha = screen.getByRole('dialog', { name: 'Registrar compra ou venda' })
      await u.click(within(folha).getByRole('radio', { name: 'Venda' }))
      expect(within(folha).queryByRole('radio', { name: 'Quantidade e preço' })).toBeNull()
      await u.selectOptions(within(folha).getByLabelText('Volta para a conta'), 'c1')
      await u.click(within(folha).getByRole('button', { name: 'Registrar venda' }))
      expect(within(folha).getByText('Informe o valor do resgate.')).toBeTruthy()
      await u.type(within(folha).getByLabelText('Valor do resgate (BRL)'), '200,10')
      await u.click(within(folha).getByRole('button', { name: 'Registrar venda' }))
      expect(mock.registrarOperacaoPorValor).toHaveBeenLastCalledWith(expect.objectContaining({ ativoId: 'k1', tipo: 'sell', valor: 20010, contaId: 'c1' }))
      expect(mock.registrarOperacaoInvestimento).not.toHaveBeenCalled()
    })

    it('ativo novo com ticker começa em "Quantidade e preço", mas pode trocar para "Só o valor"; na venda vira "Valor do resgate"', async () => {
      mock.listarAtivosInvestimento.mockResolvedValue([ativo('a9', 'FII Z', 'reit', { ticker: 'FIIZ11' })])
      const u = userEvent.setup()
      const folha = await abrir(u)
      expect(within(folha).getByRole('radio', { name: 'Quantidade e preço' }).getAttribute('aria-checked')).toBe('true')
      await u.click(within(folha).getByRole('radio', { name: 'Só o valor' }))
      expect(within(folha).getByLabelText('Valor de hoje (BRL)')).toBeTruthy()
      await u.click(within(folha).getByRole('radio', { name: 'Venda' }))
      expect(within(folha).getByLabelText('Valor do resgate (BRL)')).toBeTruthy()
      await u.click(within(folha).getByRole('radio', { name: 'Quantidade e preço' }))
      expect(within(folha).getByLabelText('Quantidade')).toBeTruthy()
    })

    it('novo ativo, avaliação e provento também abrem em folha; o erro do banco aparece dentro dela', async () => {
      mock.criarAtivoInvestimento.mockRejectedValue(new Error('já existe um ativo com esse nome'))
      mock.registrarProventoInvestimento.mockRejectedValue(new Error('conta arquivada'))
      const u = userEvent.setup()
      render(<Investimentos />)
      await u.click(await screen.findByRole('button', { name: 'Novo ativo' }))
      let folha = screen.getByRole('dialog', { name: 'Novo ativo' })
      await u.type(within(folha).getByLabelText('Nome do ativo'), 'Tesouro Selic')
      await u.selectOptions(within(folha).getByLabelText('Categoria'), 'tesouro')
      await u.click(within(folha).getByRole('button', { name: 'Salvar ativo' }))
      expect(await within(folha).findByRole('alert')).toBeTruthy()
      await u.click(within(folha).getByRole('button', { name: 'Cancelar' }))

      await u.click(screen.getByRole('button', { name: 'Registrar provento' }))
      folha = screen.getByRole('dialog', { name: 'Registrar provento' })
      await u.type(within(folha).getByLabelText('Valor líquido recebido (R$)'), '10')
      await u.click(within(folha).getByRole('button', { name: 'Registrar provento' }))
      expect(await within(folha).findByRole('alert')).toBeTruthy()
    })

    it('avaliação: ativo sem cota pede o valor de hoje e manda o TOTAL ao banco, mesmo com unidades quebradas; com ticker, o preço por unidade', async () => {
      const u = userEvent.setup()
      mock.listarAtivosInvestimento.mockResolvedValue([ativo('a1', 'Cofrinho 140% CDI', 'fixed_income'), ativo('a2', 'Ação Y', 'equity', { ticker: 'ACAO3' })])
      mock.listarCarteiraInvestimentos.mockResolvedValue({
        // 1,002538105337 unidades: é o que sobra depois de um aporte por valor (o banco converte)
        posicoes: [{ ...posicao('a1', 'Cofrinho 140% CDI', 'fixed_income', 60000), quantidade: '1.002538105337' }, { ...posicao('a2', 'Ação Y', 'equity', 10000), ticker: 'ACAO3', quantidade: '20' }],
        totais: [],
      })
      render(<Investimentos />)
      await u.click(await screen.findByRole('button', { name: 'Registrar avaliação' }))
      let folha = screen.getByRole('dialog', { name: 'Registrar avaliação' })
      await u.type(within(folha).getByLabelText('Valor de hoje (BRL)'), '1.036,61')
      await u.click(within(folha).getByRole('button', { name: 'Salvar avaliação' }))
      expect(mock.registrarAvaliacaoTotal).toHaveBeenCalledWith(expect.objectContaining({ ativoId: 'a1', valor: 103661 }))
      expect(mock.registrarAvaliacaoInvestimento).not.toHaveBeenCalled()

      await u.click(await screen.findByRole('button', { name: 'Registrar avaliação' }))
      folha = screen.getByRole('dialog', { name: 'Registrar avaliação' })
      await u.selectOptions(within(folha).getByLabelText('Ativo'), 'a2')
      await u.type(within(folha).getByLabelText('Preço atual por unidade (BRL)'), '25,7512')
      await u.click(within(folha).getByRole('button', { name: 'Salvar avaliação' }))
      expect(mock.registrarAvaliacaoInvestimento).toHaveBeenCalledWith(expect.objectContaining({ ativoId: 'a2', precoUnitario: '25,7512' }))
      expect(mock.registrarAvaliacaoTotal).toHaveBeenCalledTimes(1)
    })

    it('campo vazio ou erro do banco aparecem dentro da folha, que continua aberta', async () => {
      mock.listarAtivosInvestimento.mockResolvedValue([ativo('p1', 'Previdência', 'other')])
      mock.registrarOperacaoPorValor.mockRejectedValue(new Error('resgate maior que o valor do ativo'))
      const u = userEvent.setup()
      const folha = await abrir(u)
      await u.click(within(folha).getByRole('button', { name: 'Registrar compra' }))
      expect(within(folha).getByText('Informe o valor de hoje.')).toBeTruthy()
      expect(mock.registrarOperacaoPorValor).not.toHaveBeenCalled()
      await u.type(within(folha).getByLabelText('Valor de hoje (BRL)'), '100,00')
      await u.click(within(folha).getByRole('button', { name: 'Registrar compra' }))
      expect(await within(folha).findByRole('alert')).toBeTruthy()
      expect(screen.getByRole('dialog', { name: 'Registrar compra ou venda' })).toBeTruthy()
    })
  })
  it('novo ativo sem categoria escolhida não é salvo (antes vinha "Renda fixa" e um FII foi gravado como renda fixa)', async () => {
    const u = userEvent.setup()
    render(<Investimentos />)
    await u.click(await screen.findByRole('button', { name: 'Novo ativo' }))
    expect((screen.getByLabelText('Categoria') as HTMLSelectElement).value).toBe('')
    await u.type(screen.getByLabelText('Nome do ativo'), 'GGR Covepi Renda FII')
    await u.click(screen.getByRole('button', { name: 'Salvar ativo' }))
    expect(screen.getByText(/Escolha a categoria do ativo/)).toBeTruthy()
    expect(mock.criarAtivoInvestimento).not.toHaveBeenCalled()
    await u.selectOptions(screen.getByLabelText('Categoria'), 'brasil')
    await u.selectOptions(screen.getByLabelText('Tipo'), 'FII')
    await u.click(screen.getByRole('button', { name: 'Salvar ativo' }))
    expect(mock.criarAtivoInvestimento).toHaveBeenCalledWith(expect.objectContaining({ nome: 'GGR Covepi Renda FII', classe: 'reit' }))
    await waitFor(() => expect(mock.definirSubclasseAtivo).toHaveBeenCalledWith('novo-id', 'FIIs'))
  })

  describe('categorias do novo ativo (pedido do dono, 10/11/2026)', () => {
    const abrir = async (u: ReturnType<typeof userEvent.setup>) => {
      render(<Investimentos />)
      await u.click(await screen.findByRole('button', { name: 'Novo ativo' }))
      return screen.getByRole('dialog', { name: 'Novo ativo' })
    }
    const opcoes = (el: HTMLElement) => [...(el as HTMLSelectElement).options].map((o) => o.textContent)

    it('a lista é a que o dono pediu, na ordem dele, com Moedas e Ativos Personalizados no fim', async () => {
      const folha = await abrir(userEvent.setup())
      expect(opcoes(within(folha).getByLabelText('Categoria'))).toEqual([
        'Escolha a categoria', 'Ativos Brasil (Ação, ETF, BDR, FII, FI Agro, FIDC, ...)', 'CDB/LCI/LCA/LC/RDB', 'Tesouro Direto',
        'Fundo de Investimento', 'Internacionais', 'Criptomoedas', 'Debêntures', 'Moedas', 'Ativos Personalizados',
      ])
      expect(within(folha).queryByLabelText('Tipo')).toBeNull() // só aparece quando a categoria tem mais de um tipo
    })

    it.each([
      ['brasil', 'Ação', 'equity', 'Ações'], ['brasil', 'ETF', 'etf', 'ETFs'], ['brasil', 'BDR', 'equity', 'BDRs'],
      ['brasil', 'FI Agro', 'reit', 'Fiagro'], ['brasil', 'FIDC', 'fund', 'FIDC'],
      ['bancario', 'LCA', 'fixed_income', 'LCA'], ['bancario', 'RDB', 'fixed_income', 'RDB'],
      ['tesouro', null, 'fixed_income', 'Tesouro Direto'], ['cripto', null, 'crypto', 'Cripto'], ['debenture', null, 'fixed_income', 'Debêntures'],
      ['moedas', null, 'other', 'Moedas'], ['personalizado', 'FGTS', 'other', 'FGTS'], ['personalizado', 'Previdência', 'other', 'Previdência'],
    ])('%s / %s grava a classe %s e a subclasse %s', async (categoria, tipo, classe, subclasse) => {
      const u = userEvent.setup()
      const folha = await abrir(u)
      await u.type(within(folha).getByLabelText('Nome do ativo'), 'Ativo de teste')
      await u.selectOptions(within(folha).getByLabelText('Categoria'), categoria)
      if (tipo) await u.selectOptions(within(folha).getByLabelText('Tipo'), tipo)
      else expect(within(folha).queryByLabelText('Tipo')).toBeNull()
      await u.click(within(folha).getByRole('button', { name: 'Salvar ativo' }))
      expect(mock.criarAtivoInvestimento).toHaveBeenCalledWith(expect.objectContaining({ classe, moeda: 'BRL' }))
      await waitFor(() => expect(mock.definirSubclasseAtivo).toHaveBeenCalledWith('novo-id', subclasse))
    })

    it('Internacionais sugere dólar (dá para trocar) e grava Stock, REIT ou ETF', async () => {
      const u = userEvent.setup()
      const folha = await abrir(u)
      await u.type(within(folha).getByLabelText('Nome do ativo'), 'REIT de teste')
      await u.selectOptions(within(folha).getByLabelText('Categoria'), 'internacional')
      expect((within(folha).getByLabelText('Moeda do ativo') as HTMLSelectElement).value).toBe('USD')
      await u.selectOptions(within(folha).getByLabelText('Tipo'), 'REIT')
      await u.click(within(folha).getByRole('button', { name: 'Salvar ativo' }))
      expect(mock.criarAtivoInvestimento).toHaveBeenCalledWith(expect.objectContaining({ classe: 'reit', moeda: 'USD' }))
      await waitFor(() => expect(mock.definirSubclasseAtivo).toHaveBeenCalledWith('novo-id', 'REITs'))
    })

    it('trocar a categoria troca a sugestão de subclasse e volta a moeda para real; fundo e personalizado não sugerem subclasse', async () => {
      const u = userEvent.setup()
      const folha = await abrir(u)
      const sub = () => (within(folha).getByLabelText('Subclasse (opcional)') as HTMLInputElement).value
      await u.selectOptions(within(folha).getByLabelText('Categoria'), 'internacional')
      expect(sub()).toBe('Stocks')
      await u.selectOptions(within(folha).getByLabelText('Categoria'), 'fundo')
      expect(sub()).toBe('')
      expect((within(folha).getByLabelText('Moeda do ativo') as HTMLSelectElement).value).toBe('BRL')
      await u.selectOptions(within(folha).getByLabelText('Categoria'), 'moedas')
      expect(sub()).toBe('Moedas')
      // personalizado começa sem subclasse (a pessoa escreve a dela); previdência e FGTS são tipos dele
      await u.selectOptions(within(folha).getByLabelText('Categoria'), 'personalizado')
      expect(sub()).toBe('')
      await u.selectOptions(within(folha).getByLabelText('Tipo'), 'Previdência')
      expect(sub()).toBe('Previdência')
    })
  })

  describe('cotação da bolsa (migration 109, pedido do dono de 11/11/2026)', () => {
    const OPCAO = 'Acompanhar a cotação da bolsa'
    const hojeISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
    const diasAtras = (n: number) => new Date(Date.parse(`${hojeISO()}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10)
    const novoAtivo = async (u: ReturnType<typeof userEvent.setup>) => {
      render(<Investimentos />)
      await u.click(await screen.findByRole('button', { name: 'Novo ativo' }))
      return screen.getByRole('dialog', { name: 'Novo ativo' })
    }

    it('novo ativo: a opção só aparece com ação, FII, ETF ou fundo, em reais, com código da B3; nasce marcada e liga depois de criar', async () => {
      const u = userEvent.setup()
      const folha = await novoAtivo(u)
      const opcao = () => within(folha).queryByRole('checkbox', { name: new RegExp(OPCAO) }) as HTMLInputElement | null
      await u.type(within(folha).getByLabelText('Nome do ativo'), 'Ação de teste')
      expect(opcao()).toBeNull() // sem categoria
      await u.selectOptions(within(folha).getByLabelText('Categoria'), 'brasil')
      expect(opcao()).toBeNull() // sem código
      await u.type(within(folha).getByLabelText('Ticker ou código (opcional)'), 'taz')
      expect(opcao()).toBeNull() // código incompleto
      await u.type(within(folha).getByLabelText('Ticker ou código (opcional)'), 'l3')
      expect(opcao()?.checked).toBe(true)
      await u.selectOptions(within(folha).getByLabelText('Moeda do ativo'), 'USD')
      expect(opcao()).toBeNull() // em dólar não acompanha a B3
      await u.selectOptions(within(folha).getByLabelText('Moeda do ativo'), 'BRL')
      await u.click(within(folha).getByRole('button', { name: 'Salvar ativo' }))
      await waitFor(() => expect(mock.definirCotacaoBolsaAtivo).toHaveBeenCalledWith('novo-id', true))
      expect(mock.criarAtivoInvestimento).toHaveBeenCalledWith(expect.objectContaining({ ticker: 'tazl3', classe: 'equity', moeda: 'BRL' }))
    })

    it('novo ativo: desmarcada, ou em ativo que não pode (renda fixa com código), não liga nada', async () => {
      const u = userEvent.setup()
      let folha = await novoAtivo(u)
      await u.type(within(folha).getByLabelText('Nome do ativo'), 'FII de teste')
      await u.selectOptions(within(folha).getByLabelText('Categoria'), 'brasil')
      await u.selectOptions(within(folha).getByLabelText('Tipo'), 'FII')
      await u.type(within(folha).getByLabelText('Ticker ou código (opcional)'), 'TAZL11')
      await u.click(within(folha).getByRole('checkbox', { name: new RegExp(OPCAO) }))
      await u.click(within(folha).getByRole('button', { name: 'Salvar ativo' }))
      await waitFor(() => expect(mock.criarAtivoInvestimento).toHaveBeenCalledTimes(1))

      await u.click(await screen.findByRole('button', { name: 'Novo ativo' }))
      folha = screen.getByRole('dialog', { name: 'Novo ativo' })
      await u.type(within(folha).getByLabelText('Nome do ativo'), 'CDB com código')
      await u.selectOptions(within(folha).getByLabelText('Categoria'), 'bancario')
      await u.type(within(folha).getByLabelText('Ticker ou código (opcional)'), 'TAZL3')
      expect(within(folha).queryByRole('checkbox', { name: new RegExp(OPCAO) })).toBeNull()
      await u.click(within(folha).getByRole('button', { name: 'Salvar ativo' }))
      await waitFor(() => expect(mock.criarAtivoInvestimento).toHaveBeenCalledTimes(2))
      expect(mock.definirCotacaoBolsaAtivo).not.toHaveBeenCalled()
    })

    it('novo ativo: se o banco recusar a cotação depois de criar, o aviso diz que o ativo existe e ficou sem ela', async () => {
      mock.definirCotacaoBolsaAtivo.mockRejectedValue(new Error('função não encontrada'))
      const u = userEvent.setup()
      const folha = await novoAtivo(u)
      await u.type(within(folha).getByLabelText('Nome do ativo'), 'Ação de teste')
      await u.selectOptions(within(folha).getByLabelText('Categoria'), 'brasil')
      await u.type(within(folha).getByLabelText('Ticker ou código (opcional)'), 'TAZL3')
      await u.click(within(folha).getByRole('button', { name: 'Salvar ativo' }))
      expect((await screen.findByRole('alert')).textContent).toMatch(/Ativo cadastrado, mas sem acompanhar a cotação da bolsa/)
    })

    it('banco sem a migration 109 (a escolha vem nula): a opção não aparece no cadastro nem na edição, e nada é chamado', async () => {
      mock.listarAtivosInvestimento.mockResolvedValue([ativo('a2', 'Ação Y', 'equity', { ticker: 'ACAO3', cotacaoBolsa: null })])
      const u = userEvent.setup()
      const folha = await novoAtivo(u)
      await u.type(within(folha).getByLabelText('Nome do ativo'), 'Ação de teste')
      await u.selectOptions(within(folha).getByLabelText('Categoria'), 'brasil')
      await u.type(within(folha).getByLabelText('Ticker ou código (opcional)'), 'TAZL3')
      expect(within(folha).queryByRole('checkbox', { name: new RegExp(OPCAO) })).toBeNull()
      await u.click(within(folha).getByRole('button', { name: 'Salvar ativo' }))
      await waitFor(() => expect(mock.criarAtivoInvestimento).toHaveBeenCalledTimes(1))

      await u.click(await screen.findByRole('button', { name: 'Editar Ação Y' }))
      expect(screen.queryByRole('checkbox', { name: new RegExp(OPCAO) })).toBeNull()
      await u.click(screen.getByRole('button', { name: 'Salvar' }))
      await waitFor(() => expect(mock.editarAtivoInvestimento).toHaveBeenCalledTimes(1))
      expect(mock.definirCotacaoBolsaAtivo).not.toHaveBeenCalled()
    })

    it('editar ativo: a escolha só vai para o banco quando mudou; liga e desliga', async () => {
      mock.listarAtivosInvestimento.mockResolvedValue([ativo('a2', 'Ação Y', 'equity', { ticker: 'ACAO3', cotacaoBolsa: false })])
      const u = userEvent.setup()
      render(<Investimentos />)
      await u.click(await screen.findByRole('button', { name: 'Editar Ação Y' }))
      const opcao = screen.getByRole('checkbox', { name: new RegExp(OPCAO) }) as HTMLInputElement
      expect(opcao.checked).toBe(false)
      await u.click(screen.getByRole('button', { name: 'Salvar' }))
      await waitFor(() => expect(mock.editarAtivoInvestimento).toHaveBeenCalledTimes(1))
      expect(mock.definirCotacaoBolsaAtivo).not.toHaveBeenCalled()

      await u.click(await screen.findByRole('button', { name: 'Editar Ação Y' }))
      await u.click(screen.getByRole('checkbox', { name: new RegExp(OPCAO) }))
      await u.click(screen.getByRole('button', { name: 'Salvar' }))
      await waitFor(() => expect(mock.definirCotacaoBolsaAtivo).toHaveBeenCalledWith('a2', true))

      mock.listarAtivosInvestimento.mockResolvedValue([ativo('a2', 'Ação Y', 'equity', { ticker: 'ACAO3', cotacaoBolsa: true })])
      cleanup()
      render(<Investimentos />)
      await u.click(await screen.findByRole('button', { name: 'Editar Ação Y' }))
      expect((screen.getByRole('checkbox', { name: new RegExp(OPCAO) }) as HTMLInputElement).checked).toBe(true)
      await u.click(screen.getByRole('checkbox', { name: new RegExp(OPCAO) }))
      await u.click(screen.getByRole('button', { name: 'Salvar' }))
      await waitFor(() => expect(mock.definirCotacaoBolsaAtivo).toHaveBeenLastCalledWith('a2', false))
    })

    it('editar ativo: a recusa do banco (ex.: lançado só pelo valor) vira aviso; nome e código já foram gravados', async () => {
      mock.listarAtivosInvestimento.mockResolvedValue([ativo('a2', 'Ação Y', 'equity', { ticker: 'ACAO3', cotacaoBolsa: false })])
      mock.definirCotacaoBolsaAtivo.mockRejectedValue(new Error('este ativo tem lançamento só pelo valor'))
      const u = userEvent.setup()
      render(<Investimentos />)
      await u.click(await screen.findByRole('button', { name: 'Editar Ação Y' }))
      await u.click(screen.getByRole('checkbox', { name: new RegExp(OPCAO) }))
      await u.click(screen.getByRole('button', { name: 'Salvar' }))
      expect((await screen.findByRole('alert')).textContent).toMatch(/Ativo atualizado, mas a escolha da cotação da bolsa não foi salva/)
      expect(mock.editarAtivoInvestimento).toHaveBeenCalledTimes(1)
    })

    it('compra e venda: ativo que acompanha a bolsa é só por quantidade e preço ("Só o valor" some)', async () => {
      mock.listarAtivosInvestimento.mockResolvedValue([ativo('a2', 'Ação Y', 'equity', { ticker: 'ACAO3', cotacaoBolsa: true, quantidadeOperacoes: 2 })])
      const u = userEvent.setup()
      render(<Investimentos />)
      await u.click(await screen.findByRole('button', { name: 'Registrar operação' }))
      const folha = screen.getByRole('dialog', { name: 'Registrar compra ou venda' })
      expect(within(folha).queryByRole('radio', { name: 'Só o valor' })).toBeNull()
      expect(within(folha).getByText(/acompanha a cotação da bolsa/)).toBeTruthy()
      await u.type(within(folha).getByLabelText('Quantidade'), '10')
      await u.type(within(folha).getByLabelText('Preço por unidade (BRL)'), '25,75')
      await u.click(within(folha).getByRole('button', { name: 'Registrar compra' }))
      expect(mock.registrarOperacaoInvestimento).toHaveBeenCalledWith(expect.objectContaining({ ativoId: 'a2', quantidade: '10', precoUnitario: '25,75' }))
      expect(mock.registrarOperacaoPorValor).not.toHaveBeenCalled()
    })

    it('compra e venda: ativo ligado cujo código saiu da bolsa NÃO oferece "Só o valor" (B2) e avisa para corrigir o código', async () => {
      mock.listarAtivosInvestimento.mockResolvedValue([ativo('a2', 'Ação Y', 'equity', { ticker: 'XX', cotacaoBolsa: true, quantidadeOperacoes: 2 })])
      const u = userEvent.setup()
      render(<Investimentos />)
      await u.click(await screen.findByRole('button', { name: 'Registrar operação' }))
      const folha = screen.getByRole('dialog', { name: 'Registrar compra ou venda' })
      expect(within(folha).queryByRole('radio', { name: 'Só o valor' })).toBeNull()
      expect(within(folha).getByText(/não é da bolsa agora/)).toBeTruthy()
    })

    it('compra e venda: com a opção desligada, o ativo com código continua podendo trocar para "Só o valor"', async () => {
      mock.listarAtivosInvestimento.mockResolvedValue([ativo('a2', 'Ação Y', 'equity', { ticker: 'ACAO3', cotacaoBolsa: false, quantidadeOperacoes: 2 })])
      const u = userEvent.setup()
      render(<Investimentos />)
      await u.click(await screen.findByRole('button', { name: 'Registrar operação' }))
      const folha = screen.getByRole('dialog', { name: 'Registrar compra ou venda' })
      expect(within(folha).getByRole('radio', { name: 'Só o valor' })).toBeTruthy()
      expect(within(folha).queryByText(/acompanha a cotação da bolsa/)).toBeNull()
    })

    describe('tabela: data do preço e aviso de cotação parada', () => {
      const comPosicao = (dataAvaliacao: string | null, fonte: string | null, extra: Record<string, unknown> = {}) => {
        mock.listarAtivosInvestimento.mockResolvedValue([ativo('a2', 'Ação Y', 'equity', { ticker: 'ACAO3', cotacaoBolsa: true, ...extra })])
        mock.listarCarteiraInvestimentos.mockResolvedValue({
          posicoes: [{ ...posicao('a2', 'Ação Y', 'equity', 27000), ticker: 'ACAO3', quantidade: '10', precoAtual: '27', dataAvaliacao, fonteAvaliacao: fonte }],
          totais: [{ moeda: 'BRL', custoTotal: c(20000), valorAtual: c(27000), resultado: c(7000) }],
        })
      }
      const linha = async () => (await screen.findByRole('rowheader', { name: /Ação Y/ }))

      it('cotação de hoje: mostra a data e a fonte, sem aviso', async () => {
        comPosicao(hojeISO(), 'brapi')
        render(<Investimentos />)
        const l = await linha()
        expect(l.textContent).toMatch(/Valor de \d{2}\/\d{2}\/\d{4} · brapi/)
        expect(l.textContent).not.toMatch(/parada|Ainda sem cotação/)
      })

      it('cotação de 4 dias atrás (fim de semana com feriado): ainda sem aviso; de 5 dias: avisa com o número de dias', async () => {
        comPosicao(diasAtras(4), 'brapi')
        render(<Investimentos />)
        expect((await linha()).textContent).not.toMatch(/parada/)
        cleanup()
        comPosicao(diasAtras(5), 'brapi')
        render(<Investimentos />)
        expect((await linha()).textContent).toMatch(/Cotação da bolsa parada há 5 dias: confira o código do ativo\./)
      })

      it('ligada e ainda sem nenhum preço: diz que a primeira cotação ainda não veio', async () => {
        comPosicao(null, null)
        render(<Investimentos />)
        expect((await linha()).textContent).toMatch(/Ainda sem cotação da bolsa/)
      })

      it('ativo que NÃO acompanha a bolsa nunca ganha o aviso, por mais velha que seja a avaliação', async () => {
        comPosicao(diasAtras(90), 'Digitado', { cotacaoBolsa: false })
        render(<Investimentos />)
        expect((await linha()).textContent).not.toMatch(/parada|Ainda sem cotação/)
        cleanup()
        comPosicao(null, null, { cotacaoBolsa: false })
        render(<Investimentos />)
        expect((await linha()).textContent).not.toMatch(/parada|Ainda sem cotação/)
      })
    })
  })
})

describe('Composição da carteira: uma área, um seletor de moeda (etapa 2 do redesenho, 12/11/2026)', () => {
  const posEstr = (assetId: string, nome: string, moedaCodigo: string, valor: number) => ({ ...posicao(assetId, nome, 'equity', valor), moeda: moedaCodigo })
  const comTresMoedas = () => {
    mock.listarCarteiraInvestimentos.mockResolvedValue({
      posicoes: [posicao('a1', 'Tesouro Selic', 'fixed_income', 60000), posEstr('u1', 'REIT de teste', 'USD', 30000), posEstr('e1', 'ETF europeu', 'EUR', 20000)],
      totais: [
        { moeda: 'BRL', custoTotal: c(60000), valorAtual: c(60000), resultado: c(0) },
        { moeda: 'USD', custoTotal: c(25000), valorAtual: c(30000), resultado: c(5000) },
        { moeda: 'EUR', custoTotal: c(20000), valorAtual: c(20000), resultado: c(0) },
      ],
    })
    mock.listarAlocacaoInvestimentos.mockResolvedValue([
      { moeda: 'BRL', nivel: 'macro', macro: 'fixed_income', subclasse: null, valor: c(60000), percentual: 100 },
      { moeda: 'BRL', nivel: 'subclass', macro: 'fixed_income', subclasse: 'Tesouro Direto', valor: c(60000), percentual: 100 },
      { moeda: 'USD', nivel: 'macro', macro: 'variable', subclasse: null, valor: c(30000), percentual: 100 },
      { moeda: 'USD', nivel: 'subclass', macro: 'variable', subclasse: 'REITs', valor: c(30000), percentual: 100 },
      { moeda: 'EUR', nivel: 'macro', macro: 'variable', subclasse: null, valor: c(20000), percentual: 100 },
      { moeda: 'EUR', nivel: 'subclass', macro: 'variable', subclasse: 'ETFs', valor: c(20000), percentual: 100 },
    ])
    mock.listarLiquidezInvestimentos.mockResolvedValue([
      { moeda: 'BRL', liquidez: 'liquid', valor: c(60000) },
      { moeda: 'USD', liquidez: 'liquid', valor: c(10000) },
      { moeda: 'USD', liquidez: 'restricted', valor: c(20000) },
      { moeda: 'EUR', liquidez: 'liquid', valor: c(20000) },
    ])
  }
  const secao = async () => (await screen.findByRole('heading', { name: 'Composição da carteira' })).closest('section') as HTMLElement
  const moedaTab = (s: HTMLElement, nome: string) => within(within(s).getByRole('tablist', { name: 'Moeda da composição' })).getByRole('tab', { name: nome })

  it('seletor BRL, EUR e USD (só as moedas com posição); começa em BRL e cada moeda mostra os seus valores, sem somar', async () => {
    comTresMoedas()
    const u = userEvent.setup()
    render(<Investimentos />)
    const s = await secao()
    const abas = within(within(s).getByRole('tablist', { name: 'Moeda da composição' })).getAllByRole('tab')
    expect(abas.map((a) => a.textContent)).toEqual(['BRL', 'EUR', 'USD'])
    expect(abas.map((a) => a.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false'])
    expect(s.textContent).toMatch(/Tesouro Direto/)
    expect(s.textContent).toMatch(/R\$\s600,00/)
    expect(s.textContent).not.toMatch(/US\$|€|REITs|ETFs/)

    await u.click(moedaTab(s, 'USD'))
    expect(moedaTab(s, 'USD').getAttribute('aria-selected')).toBe('true')
    expect(s.textContent).toMatch(/REITs/)
    expect(s.textContent).toMatch(/US\$\s300,00/)
    expect(s.textContent).toMatch(/100%/)
    // nada de reais nem de euros no painel do dólar, e nenhum total misturado (300 + 200 + 600 = 1.100)
    expect(s.textContent).not.toMatch(/Tesouro Direto|R\$|€|1\.100|500,00|900,00/)

    await u.click(moedaTab(s, 'EUR'))
    expect(s.textContent).toMatch(/ETFs/)
    expect(s.textContent).toMatch(/€\s200,00/)
    expect(s.textContent).not.toMatch(/REITs|US\$|R\$/)
    // a seção "Alocação da carteira" das outras moedas não existe mais: está tudo aqui
    expect(screen.queryByRole('heading', { name: 'Alocação da carteira' })).toBeNull()
  })

  it('moeda sem posição não ganha seletor: com só reais não há seletor; com reais e dólar há dois, sem EUR', async () => {
    const u = userEvent.setup()
    render(<Investimentos />)
    const s = await secao()
    expect(within(s).queryByRole('tablist', { name: 'Moeda da composição' })).toBeNull()
    expect(within(s).getByRole('tab', { name: 'Classe' })).toBeTruthy()
    cleanup()

    comTresMoedas()
    mock.listarCarteiraInvestimentos.mockResolvedValue({
      posicoes: [posicao('a1', 'Tesouro Selic', 'fixed_income', 60000), posEstr('u1', 'REIT de teste', 'USD', 30000)],
      totais: [{ moeda: 'BRL', custoTotal: c(60000), valorAtual: c(60000), resultado: c(0) }, { moeda: 'USD', custoTotal: c(25000), valorAtual: c(30000), resultado: c(5000) }],
    })
    render(<Investimentos />)
    const s2 = await secao()
    await waitFor(() => expect(within(within(s2).getByRole('tablist', { name: 'Moeda da composição' })).getAllByRole('tab').map((a) => a.textContent)).toEqual(['BRL', 'USD']))
    await u.click(moedaTab(s2, 'USD'))
    expect(s2.textContent).toMatch(/REITs/)
  })

  it('só moeda estrangeira (sem reais): o seletor não existe e a composição já abre na moeda que tem', async () => {
    comTresMoedas()
    mock.listarCarteiraInvestimentos.mockResolvedValue({
      posicoes: [posEstr('u1', 'REIT de teste', 'USD', 30000)],
      totais: [{ moeda: 'USD', custoTotal: c(25000), valorAtual: c(30000), resultado: c(5000) }],
    })
    render(<Investimentos />)
    const s = await secao()
    expect(within(s).queryByRole('tablist', { name: 'Moeda da composição' })).toBeNull()
    expect(s.textContent).toMatch(/REITs/)
    expect(s.textContent).toMatch(/US\$\s300,00/)
  })

  it('as quatro visões valem em cada moeda: Liquidez e Ativos do dólar usam só os valores do dólar, e a visão escolhida fica ao trocar de moeda', async () => {
    comTresMoedas()
    mock.listarInstituicoesInvestimentos.mockResolvedValue([
      { moeda: 'BRL', instituicao: 'Corretora A', valor: c(60000) },
      { moeda: 'USD', instituicao: null, valor: c(30000) },
    ])
    const u = userEvent.setup()
    render(<Investimentos />)
    const s = await secao()
    await u.click(within(s).getByRole('tab', { name: 'Liquidez' }))
    await u.click(moedaTab(s, 'USD'))
    expect(within(s).getByRole('tab', { name: 'Liquidez' }).getAttribute('aria-selected')).toBe('true')
    const linhas = within(s).getByRole('list', { name: 'Lista da carteira por liquidez' })
    expect(within(linhas).getAllByRole('listitem').map((li) => li.textContent?.replace(/\s/g, ' '))).toEqual([
      'LíquidoUS$ 100,0033,3%', 'Restrito (previdência, FGTS)US$ 200,0066,7%',
    ])
    await u.click(within(s).getByRole('tab', { name: 'Ativos' }))
    expect(within(within(s).getByRole('list', { name: 'Lista da carteira por ativos' })).getAllByRole('listitem').map((li) => li.textContent?.split('US$')[0])).toEqual(['REIT de teste'])
    // Instituição existe em BRL e USD, e não em EUR (sem linha): ao chegar no EUR a visão volta para Classe
    await u.click(within(s).getByRole('tab', { name: 'Instituição' }))
    expect(within(within(s).getByRole('list', { name: 'Lista da carteira por instituição' })).getAllByRole('listitem').map((li) => li.textContent?.replace(/\s/g, ' '))).toEqual(['Sem instituiçãoUS$ 300,00100%'])
    await u.click(moedaTab(s, 'EUR'))
    expect(within(s).queryByRole('tab', { name: 'Instituição' })).toBeNull()
    expect(within(s).getByRole('tab', { name: 'Classe' }).getAttribute('aria-selected')).toBe('true')
  })

  it('previdência grande: a visão Liquidez fica a um clique da Classe, sem mudar valor nem percentual; sem restrito, o atalho não aparece', async () => {
    comTresMoedas()
    const u = userEvent.setup()
    render(<Investimentos />)
    const s = await secao()
    // em reais não há restrito: sem atalho
    expect(within(s).queryByRole('button', { name: 'Ver por liquidez' })).toBeNull()
    await u.click(moedaTab(s, 'USD'))
    const classeAntes = s.textContent
    await u.click(within(s).getByRole('button', { name: 'Ver por liquidez' }))
    expect(within(s).getByRole('tab', { name: 'Liquidez' }).getAttribute('aria-selected')).toBe('true')
    expect(s.textContent).toMatch(/US\$\s200,00/)
    expect(s.textContent).toMatch(/66,7%/)
    await u.click(within(s).getByRole('tab', { name: 'Classe' }))
    expect(s.textContent).toBe(classeAntes)
  })

  it('com "ocultar valores": trocar de moeda não mostra nenhum valor, só a máscara', async () => {
    comTresMoedas()
    definirValoresOcultos(true)
    try {
      const u = userEvent.setup()
      render(<Investimentos />)
      const s = await secao()
      await u.click(moedaTab(s, 'USD'))
      expect(s.textContent).toMatch(/••••/)
      expect(s.textContent).not.toMatch(/US\$|R\$|€|300,00|100,00|200,00/)
      await u.click(within(s).getByRole('tab', { name: 'Liquidez' }))
      expect(s.textContent).toMatch(/••••/)
      expect(s.textContent).not.toMatch(/US\$|R\$|€|\d,\d\d\b(?!%)/)
    } finally { definirValoresOcultos(false) }
  })

  it('teclado: só a aba ativa entra no Tab; setas, Home e End trocam a moeda e levam o foco; cada aba aponta para o painel', async () => {
    comTresMoedas()
    const u = userEvent.setup()
    render(<Investimentos />)
    const s = await secao()
    const abas = within(within(s).getByRole('tablist', { name: 'Moeda da composição' })).getAllByRole('tab')
    expect(abas.map((a) => a.tabIndex)).toEqual([0, -1, -1])
    expect(abas.every((a) => !!document.getElementById(a.getAttribute('aria-controls') ?? ''))).toBe(true)
    expect(document.getElementById(abas[0].getAttribute('aria-controls')!)?.getAttribute('role')).toBe('tabpanel')
    abas[0].focus()
    await u.keyboard('{ArrowRight}')
    expect(document.activeElement).toBe(abas[1])
    expect(abas[1].getAttribute('aria-selected')).toBe('true')
    expect(s.textContent).toMatch(/ETFs/)
    await u.keyboard('{End}')
    expect(document.activeElement).toBe(abas[2])
    expect(s.textContent).toMatch(/REITs/)
    await u.keyboard('{ArrowRight}')
    expect(document.activeElement).toBe(abas[0])
    await u.keyboard('{ArrowLeft}')
    expect(document.activeElement).toBe(abas[2])
    await u.keyboard('{Home}')
    expect(document.activeElement).toBe(abas[0])
    expect(abas.map((a) => a.tabIndex)).toEqual([0, -1, -1])
    // o mesmo vale para as visões (Classe, Liquidez, ...)
    const visoes = within(within(s).getByRole('tablist', { name: 'Ver a carteira por' })).getAllByRole('tab')
    visoes[0].focus()
    await u.keyboard('{ArrowRight}')
    expect(document.activeElement).toBe(visoes[1])
    expect(visoes[1].getAttribute('aria-selected')).toBe('true')
  })
})

describe('Investimentos: ordem dos blocos e período da evolução', () => {
  const linhasDaTabela = () => screen.getAllByRole('row').map((tr) => tr.textContent ?? '').filter((t) => /de \d\d/.test(t))

  it('ordem da proposta: resumo, evolução, composição, posições, proventos, ativos cadastrados', async () => {
    mock.listarProventosPorAtivo.mockResolvedValue([
      { assetId: 'a2', nome: 'Ação Y', moeda: 'BRL', recebido: c(8500), previsto: c(0), ultimoRecebimento: '2026-10-20' },
    ])
    render(<Investimentos />)
    const titulos = ['Resumo da carteira', 'Evolução dos investimentos', 'Composição da carteira', 'Posições', 'Proventos recebidos', 'Ativos cadastrados']
    const hs = await Promise.all(titulos.map((t) => screen.findByRole('heading', { name: t, level: 2 })))
    for (let i = 1; i < hs.length; i++) {
      expect(hs[i - 1].compareDocumentPosition(hs[i]) & Node.DOCUMENT_POSITION_FOLLOWING, `${titulos[i - 1]} antes de ${titulos[i]}`).toBeTruthy()
    }
  })

  it('começa em 12 meses, com a leitura de sempre e sem pedir os 24', async () => {
    render(<Investimentos />)
    await screen.findByRole('heading', { name: 'Evolução em BRL' })
    const grupo = screen.getByRole('group', { name: 'Período do gráfico' })
    expect(within(grupo).getByRole('button', { name: '12 meses' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText(/nos últimos 12 meses/)).toBeTruthy()
    expect(linhasDaTabela()).toHaveLength(12)
    expect(mock.listarHistoricoInvestimentos).toHaveBeenCalledTimes(1)
  })

  it('6 meses mostra só os 6 últimos da mesma leitura (nenhuma leitura nova)', async () => {
    const u = userEvent.setup()
    render(<Investimentos />)
    await screen.findByRole('heading', { name: 'Evolução em BRL' })
    await u.click(within(screen.getByRole('group', { name: 'Período do gráfico' })).getByRole('button', { name: '6 meses' }))
    expect(linhasDaTabela()).toHaveLength(6)
    expect(screen.getByText(/nos últimos 6 meses/)).toBeTruthy()
    expect(mock.listarHistoricoInvestimentos).toHaveBeenCalledTimes(1)
  })

  it('24 meses lê a série longa só ao escolher, uma vez, e mostra os 24', async () => {
    const u = userEvent.setup()
    render(<Investimentos />)
    await screen.findByRole('heading', { name: 'Evolução em BRL' })
    const grupo = screen.getByRole('group', { name: 'Período do gráfico' })
    await u.click(within(grupo).getByRole('button', { name: '24 meses' }))
    await waitFor(() => expect(linhasDaTabela()).toHaveLength(24))
    expect(mock.listarHistoricoInvestimentos).toHaveBeenCalledTimes(2)
    const [, de24, ate24] = mock.listarHistoricoInvestimentos.mock.calls[1]
    expect(serieHistorico(de24, ate24)).toHaveLength(24)
    // ir e voltar não lê de novo
    await u.click(within(grupo).getByRole('button', { name: '6 meses' }))
    await u.click(within(grupo).getByRole('button', { name: '24 meses' }))
    expect(linhasDaTabela()).toHaveLength(24)
    expect(mock.listarHistoricoInvestimentos).toHaveBeenCalledTimes(2)
  })

  it('se a leitura de 24 meses falhar, o gráfico volta para 12 e a tela segue sem erro', async () => {
    const u = userEvent.setup()
    render(<Investimentos />)
    await screen.findByRole('heading', { name: 'Evolução em BRL' })
    mock.listarHistoricoInvestimentos.mockRejectedValueOnce(new Error('timeout'))
    await u.click(within(screen.getByRole('group', { name: 'Período do gráfico' })).getByRole('button', { name: '24 meses' }))
    await waitFor(() => expect(within(screen.getByRole('group', { name: 'Período do gráfico' })).getByRole('button', { name: '12 meses' }).getAttribute('aria-pressed')).toBe('true'))
    expect(linhasDaTabela()).toHaveLength(12)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('sem histórico, o seletor de período não aparece', async () => {
    mock.listarHistoricoInvestimentos.mockResolvedValue([])
    render(<Investimentos />)
    await screen.findByText(/O gráfico aparecerá depois da primeira compra/)
    expect(screen.queryByRole('group', { name: 'Período do gráfico' })).toBeNull()
  })

  it('aporte líquido (migration 114): a linha "Aportado" usa o que veio do banco, não o custo, e não avisa', async () => {
    mock.listarHistoricoAportes.mockImplementation(async (_f: string, de: string, ate: string) =>
      serieHistorico(de, ate).map((p) => ({ mes: p.mes, moeda: p.moeda, liquido: c(777700) })))
    render(<Investimentos />)
    await screen.findByRole('heading', { name: 'Evolução em BRL' })
    const linhas = screen.getAllByRole('row').filter((tr) => /de \d\d/.test(tr.textContent ?? ''))
    expect(linhas).toHaveLength(12)
    expect(linhas[0].textContent).toContain('R$ 7.777,00') // o líquido do banco, e não o custo de 900,00
    expect(screen.queryByText(/custo do que ainda está investido: ele cai a cada resgate/)).toBeNull()
    expect(mock.listarHistoricoAportes).toHaveBeenCalledTimes(1)
  })

  it('banco sem a migration 114: o aportado cai para o custo e o gráfico avisa, sem erro na tela', async () => {
    render(<Investimentos />)
    await screen.findByRole('heading', { name: 'Evolução em BRL' })
    expect(screen.getByText(/custo do que ainda está investido: ele cai a cada resgate/)).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('24 meses também lê o aporte líquido, do mesmo período', async () => {
    const u = userEvent.setup()
    mock.listarHistoricoAportes.mockImplementation(async (_f: string, de: string, ate: string) =>
      serieHistorico(de, ate).map((p) => ({ mes: p.mes, moeda: p.moeda, liquido: c(777700) })))
    render(<Investimentos />)
    await screen.findByRole('heading', { name: 'Evolução em BRL' })
    await u.click(within(screen.getByRole('group', { name: 'Período do gráfico' })).getByRole('button', { name: '24 meses' }))
    await waitFor(() => expect(mock.listarHistoricoAportes).toHaveBeenCalledTimes(2))
    expect(mock.listarHistoricoAportes.mock.calls[1][1]).toBe(mock.listarHistoricoInvestimentos.mock.calls[1][1])
  })
})
