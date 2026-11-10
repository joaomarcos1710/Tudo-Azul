// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mock = vi.hoisted(() => ({
  listarAtivosInvestimento: vi.fn(),
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
  registrarProventoInvestimento: vi.fn(),
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
  registrarProventoInvestimento: mock.registrarProventoInvestimento,
  editarAtivoInvestimento: mock.editarAtivoInvestimento,
  arquivarAtivoInvestimento: mock.arquivarAtivoInvestimento,
  reativarAtivoInvestimento: mock.reativarAtivoInvestimento,
  excluirAtivoInvestimento: mock.excluirAtivoInvestimento,
  excluirAtivoComHistorico: mock.excluirAtivoComHistorico,
  listarExtratoAtivo: mock.listarExtratoAtivo,
  anularOperacaoInvestimento: mock.anularOperacaoInvestimento,
}))
vi.mock('../lib/contas', async (o) => ({ ...(await o<typeof import('../lib/contas')>()), listarContas: mock.listarContas }))

import Investimentos from './Investimentos'
import type { Cents } from '../lib/format'

const c = (n: number) => n as Cents
const ativo = (id: string, nome: string, classe: string, extra: Record<string, unknown> = {}) =>
  ({ id, nome, ticker: null, classe, moeda: 'BRL', ativo: true, subclasse: null, liquidez: 'liquid',
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

beforeEach(() => {
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
  mock.listarContas.mockResolvedValue({ contas: [{ id: 'c1', nome: 'Corretora', ativa: true }, { id: 'c2', nome: 'Antiga', ativa: false }], total: c(0) })
  for (const f of [mock.editarAtivoInvestimento, mock.arquivarAtivoInvestimento, mock.reativarAtivoInvestimento, mock.excluirAtivoInvestimento]) f.mockResolvedValue(undefined)
  mock.criarAtivoInvestimento.mockResolvedValue('novo-id')
  mock.definirSubclasseAtivo.mockResolvedValue(undefined)
  mock.definirLiquidezAtivo.mockResolvedValue(undefined)
  mock.registrarOperacaoInvestimento.mockResolvedValue(undefined)
  for (const f of [mock.registrarOperacaoPorValor, mock.registrarAvaliacaoInvestimento, mock.registrarAvaliacaoTotal]) f.mockResolvedValue(undefined)
  mock.listarLiquidezInvestimentos.mockResolvedValue([])
  mock.anularOperacaoInvestimento.mockResolvedValue(undefined)
  mock.listarExtratoAtivo.mockResolvedValue(extratoBase())
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('Investimentos × macroclasse e subclasse', () => {
  it('Minha carteira, aba Classe: rosca e lista com valores e % do banco, subclasses embaixo e "Sem subclasse"', async () => {
    render(<Investimentos />)
    const secao = (await screen.findByRole('heading', { name: 'Minha carteira' })).closest('section') as HTMLElement
    expect(within(secao).getByRole('tab', { name: 'Classe' }).getAttribute('aria-selected')).toBe('true')
    expect(within(secao).getAllByRole('img')[0].querySelectorAll('[data-fatia]')).toHaveLength(3)
    expect(within(secao).getByText('Renda fixa')).toBeTruthy()
    expect(within(secao).getByText('Renda variável')).toBeTruthy()
    expect(within(secao).getByText('Fundos e outros')).toBeTruthy()
    expect(secao.textContent).toMatch(/600,0080%/)
    expect(secao.textContent).toMatch(/50,00 · 6,7%/)
    expect(within(secao).getByText('Tesouro Direto')).toBeTruthy()
    expect(within(secao).getByText('Sem subclasse')).toBeTruthy()
  })

  it('filtra as posições por macroclasse e por subclasse', async () => {
    const u = userEvent.setup()
    render(<Investimentos />)
    await screen.findByText('Minha carteira')
    const posicoes = () => (screen.getByRole('heading', { name: 'Ativos e posições' }).closest('section') as HTMLElement)
    expect(within(posicoes()).getAllByRole('listitem')).toHaveLength(3)

    // os filtros moram na tela cheia (como em Lançamentos); cada toque vale na hora
    await u.click(screen.getByRole('button', { name: 'Filtrar' }))
    const tela = () => screen.getByRole('dialog', { name: 'Filtrar posições' })
    await u.click(within(tela()).getByRole('button', { name: 'Renda variável' }))
    expect(within(posicoes()).getAllByRole('listitem')).toHaveLength(1)
    expect(within(posicoes()).getByText(/Ação Y/)).toBeTruthy()

    await u.click(within(tela()).getByRole('button', { name: 'Renda variável' })) // tocar de novo desliga
    await u.click(within(tela()).getByRole('button', { name: 'Tesouro Direto' }))
    expect(within(posicoes()).getByText(/Tesouro Selic/)).toBeTruthy()
    expect(within(posicoes()).queryByText(/Ação Y/)).toBeNull()

    await u.click(within(tela()).getByRole('button', { name: 'Renda variável' })) // variável + Tesouro Direto = nada
    await u.click(within(tela()).getByRole('button', { name: 'Filtrar: ver as posições' }))
    expect(screen.queryByRole('dialog', { name: 'Filtrar posições' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Tirar o filtro Renda variável' })).toBeTruthy()
    expect(within(posicoes()).getByText('Nenhuma posição com esse filtro.')).toBeTruthy()
  })

  it('cadastrar ativo com subclasse: cria e depois grava a subclasse', async () => {
    const u = userEvent.setup()
    render(<Investimentos />)
    await u.click(await screen.findByRole('button', { name: 'Novo ativo' }))
    await u.type(screen.getByLabelText('Nome do ativo'), 'CDB Banco X')
    await u.selectOptions(screen.getByLabelText('Classe'), 'fixed_income')
    await u.type(screen.getByLabelText('Subclasse (opcional)'), 'CDB')
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
      await u.selectOptions(screen.getByLabelText('Classe'), 'other')
      await u.click(screen.getByRole('radio', { name: 'Restrito' }))
      await u.click(screen.getByRole('button', { name: 'Salvar ativo' }))
      expect(mock.criarAtivoInvestimento.mock.calls[0][0]).not.toHaveProperty('liquidez')
      expect(mock.definirLiquidezAtivo).toHaveBeenCalledWith('novo-id', 'restricted')

      mock.definirLiquidezAtivo.mockClear()
      await u.click(await screen.findByRole('button', { name: 'Novo ativo' }))
      await u.type(screen.getByLabelText('Nome do ativo'), 'CDB')
      await u.selectOptions(screen.getByLabelText('Classe'), 'fixed_income')
      await u.click(screen.getByRole('button', { name: 'Salvar ativo' }))
      await waitFor(() => expect(mock.criarAtivoInvestimento).toHaveBeenCalledTimes(2))
      expect(mock.definirLiquidezAtivo).not.toHaveBeenCalled()
    })

    it('Minha carteira, aba Liquidez: Líquido e Restrito com os valores do banco; aba Ativos: lista do maior para o menor', async () => {
      mock.listarLiquidezInvestimentos.mockResolvedValue([
        { moeda: 'BRL', liquidez: 'liquid', valor: c(15000) },
        { moeda: 'BRL', liquidez: 'restricted', valor: c(60000) },
        { moeda: 'USD', liquidez: 'liquid', valor: c(999) },
      ])
      const u = userEvent.setup()
      render(<Investimentos />)
      const secao = (await screen.findByRole('heading', { name: 'Minha carteira' })).closest('section') as HTMLElement
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
      await screen.findByText('Custo de aquisição')
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

  it('sem subclasse digitada, não chama a RPC de subclasse', async () => {
    const u = userEvent.setup()
    render(<Investimentos />)
    await u.click(await screen.findByRole('button', { name: 'Novo ativo' }))
    await u.type(screen.getByLabelText('Nome do ativo'), 'Algo')
    await u.selectOptions(screen.getByLabelText('Classe'), 'fixed_income')
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
    await u.selectOptions(screen.getByLabelText('Classe'), 'fixed_income')
    await u.type(screen.getByLabelText('Subclasse (opcional)'), 'CDB')
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

  it('totais: custo e resultado ficam numa grade só, valores na mesma borda direita', async () => {
    render(<Investimentos />)
    const rotuloCusto = await screen.findByText('Custo de aquisição')
    // "Resultado não realizado" também é rótulo em cada posição: aqui só vale o do cartão de totais
    const grade = rotuloCusto.parentElement!
    const rotuloResultado = within(grade).getByText('Resultado não realizado')
    // o card da carteira não usa a palavra "Patrimônio": ela é do Patrimônio total (decisão de 10/11/2026)
    expect(screen.getByText('Investido (valor de mercado em BRL)')).toBeTruthy()
    expect(screen.queryByText(/^Patrimônio em /)).toBeNull()
    expect(rotuloCusto.tagName).toBe('DT')
    expect(rotuloResultado.tagName).toBe('DT')
    expect(rotuloCusto.parentElement).toBe(rotuloResultado.parentElement) // mesma grade
    for (const dt of [rotuloCusto, rotuloResultado]) {
      expect(dt.nextElementSibling?.tagName).toBe('DD')
      expect(dt.nextElementSibling?.className).toMatch(/text-right/)
    }
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
  describe('compra e venda numa folha, no desenho de Lançamentos (pedido do dono, 10/11/2026)', () => {
    const abrir = async (u: ReturnType<typeof userEvent.setup>) => {
      render(<Investimentos />)
      await u.click(await screen.findByRole('button', { name: 'Registrar operação' }))
      return screen.getByRole('dialog', { name: 'Registrar compra ou venda' })
    }

    it('topo: investido em destaque, parado na corretora (do banco), e Investir/Resgatar abrem a folha já em Compra ou Venda', async () => {
      mock.listarContas.mockResolvedValue({ contas: [{ id: 'c1', nome: 'Corretora', ativa: true }], total: c(0),
        porTipo: [{ tipo: 'brokerage', total: c(9999), totalAtivas: c(1304) }, { tipo: 'checking', total: c(5), totalAtivas: c(5) }] })
      const u = userEvent.setup()
      render(<Investimentos />)
      const titulo = await screen.findByText('Investido (valor de mercado em BRL)')
      const card = titulo.parentElement as HTMLElement
      expect(titulo.nextElementSibling?.textContent).toBe('R$ 750,00') // o número em destaque; o custo também é 750
      const parado = within(card).getByText('Parado na corretora')
      expect(parado.nextElementSibling?.textContent).toBe('R$ 13,04')
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
      await u.selectOptions(within(folha).getByLabelText('Classe'), 'fixed_income')
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

    it('posição de ativo sem cota mostra Aplicado e Rendimento em reais, sem Quantidade nem preço por unidade; com ticker continua como era', async () => {
      mock.listarCarteiraInvestimentos.mockResolvedValue({
        posicoes: [
          { ...posicao('a1', 'Cofrinho 140% CDI', 'fixed_income', 103661), quantidade: '1.002538105337', custoTotal: c(100000), resultado: c(3661) },
          { ...posicao('a2', 'Ação Y', 'equity', 10000), ticker: 'ACAO3', quantidade: '20' },
        ],
        totais: [],
      })
      render(<Investimentos />)
      const cofrinho = (await screen.findAllByText('Valor de mercado estimado'))[0].closest('li') as HTMLElement
      expect(cofrinho.textContent).toMatch(/Cofrinho 140% CDI/)
      expect(cofrinho.textContent).toMatch(/Aplicado \(custo\)R\$\s1\.000,00/)
      expect(cofrinho.textContent).toMatch(/Rendimento não realizado/)
      expect(cofrinho.textContent).not.toMatch(/Quantidade|Preço de referência|1,0025/)
      expect(screen.getAllByText('Quantidade')).toHaveLength(1)
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
  it('novo ativo sem classe escolhida não é salvo (antes vinha "Renda fixa" e um FII foi gravado como renda fixa)', async () => {
    const u = userEvent.setup()
    render(<Investimentos />)
    await u.click(await screen.findByRole('button', { name: 'Novo ativo' }))
    expect((screen.getByLabelText('Classe') as HTMLSelectElement).value).toBe('')
    await u.type(screen.getByLabelText('Nome do ativo'), 'GGR Covepi Renda FII')
    await u.click(screen.getByRole('button', { name: 'Salvar ativo' }))
    expect(screen.getByText(/Escolha a classe do ativo/)).toBeTruthy()
    expect(mock.criarAtivoInvestimento).not.toHaveBeenCalled()
    await u.selectOptions(screen.getByLabelText('Classe'), 'reit')
    await u.click(screen.getByRole('button', { name: 'Salvar ativo' }))
    expect(mock.criarAtivoInvestimento).toHaveBeenCalledWith(expect.objectContaining({ nome: 'GGR Covepi Renda FII', classe: 'reit' }))
  })
})
