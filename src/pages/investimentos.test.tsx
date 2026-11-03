// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mock = vi.hoisted(() => ({
  listarAtivosInvestimento: vi.fn(),
  listarCarteiraInvestimentos: vi.fn(),
  listarAlocacaoInvestimentos: vi.fn(),
  criarAtivoInvestimento: vi.fn(),
  definirSubclasseAtivo: vi.fn(),
  listarProventosPorAtivo: vi.fn(),
  registrarProventoInvestimento: vi.fn(),
  listarContas: vi.fn(),
  editarAtivoInvestimento: vi.fn(),
  arquivarAtivoInvestimento: vi.fn(),
  reativarAtivoInvestimento: vi.fn(),
  excluirAtivoInvestimento: vi.fn(),
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
  listarProventosPorAtivo: mock.listarProventosPorAtivo,
  registrarProventoInvestimento: mock.registrarProventoInvestimento,
  editarAtivoInvestimento: mock.editarAtivoInvestimento,
  arquivarAtivoInvestimento: mock.arquivarAtivoInvestimento,
  reativarAtivoInvestimento: mock.reativarAtivoInvestimento,
  excluirAtivoInvestimento: mock.excluirAtivoInvestimento,
}))
vi.mock('../lib/contas', async (o) => ({ ...(await o<typeof import('../lib/contas')>()), listarContas: mock.listarContas }))

import Investimentos from './Investimentos'
import type { Cents } from '../lib/format'

const c = (n: number) => n as Cents
const ativo = (id: string, nome: string, classe: string, extra: Record<string, unknown> = {}) =>
  ({ id, nome, ticker: null, classe, moeda: 'BRL', ativo: true, subclasse: null,
    // contadores de histórico (#125): 0 = nunca teve movimento, então pode ser excluído
    quantidadeOperacoes: 0, quantidadeAvaliacoes: 0, quantidadeProventos: 0, ...extra })
const posicao = (assetId: string, nome: string, classe: string, valor: number) => ({
  assetId, nome, ticker: null, classe, moeda: 'BRL', quantidade: '1', custoMedio: '1', custoTotal: c(valor), precoAtual: '1',
  valorAtual: c(valor), resultado: c(0), dataAvaliacao: null, fonteAvaliacao: null,
})

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
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('Investimentos × macroclasse e subclasse', () => {
  it('mostra a alocação por moeda com valores e % do banco, e "Sem subclasse" para o que não tem', async () => {
    render(<Investimentos />)
    const secao = (await screen.findByRole('heading', { name: 'Alocação da carteira' })).closest('section') as HTMLElement
    expect(within(secao).getByText('Renda fixa')).toBeTruthy()
    expect(within(secao).getByText('Renda variável')).toBeTruthy()
    expect(within(secao).getByText('Fundos e outros')).toBeTruthy()
    expect(secao.textContent).toMatch(/600,00 · 80%/)
    expect(secao.textContent).toMatch(/50,00 · 6,7%/)
    expect(within(secao).getByText('Tesouro Direto')).toBeTruthy()
    expect(within(secao).getByText('Sem subclasse')).toBeTruthy()
  })

  it('filtra as posições por macroclasse e por subclasse', async () => {
    const u = userEvent.setup()
    render(<Investimentos />)
    await screen.findByText('Alocação da carteira')
    const posicoes = () => (screen.getByRole('heading', { name: 'Ativos e posições' }).closest('section') as HTMLElement)
    expect(within(posicoes()).getAllByRole('listitem')).toHaveLength(3)

    await u.selectOptions(screen.getByLabelText('Macroclasse'), 'variable')
    expect(within(posicoes()).getAllByRole('listitem')).toHaveLength(1)
    expect(within(posicoes()).getByText(/Ação Y/)).toBeTruthy()

    await u.selectOptions(screen.getByLabelText('Macroclasse'), '')
    await u.selectOptions(screen.getByLabelText('Subclasse'), 'Tesouro Direto')
    expect(within(posicoes()).getByText(/Tesouro Selic/)).toBeTruthy()
    expect(within(posicoes()).queryByText(/Ação Y/)).toBeNull()

    await u.selectOptions(screen.getByLabelText('Macroclasse'), 'variable') // variável + Tesouro Direto = nada
    expect(within(posicoes()).getByText('Nenhuma posição com esse filtro.')).toBeTruthy()
  })

  it('cadastrar ativo com subclasse: cria e depois grava a subclasse', async () => {
    const u = userEvent.setup()
    render(<Investimentos />)
    await u.click(await screen.findByRole('button', { name: 'Novo ativo' }))
    await u.type(screen.getByLabelText('Nome do ativo'), 'CDB Banco X')
    await u.type(screen.getByLabelText('Subclasse (opcional)'), 'CDB')
    await u.click(screen.getByRole('button', { name: 'Salvar ativo' }))
    expect(mock.criarAtivoInvestimento).toHaveBeenCalledWith(expect.objectContaining({ familiaId: 'h1', nome: 'CDB Banco X', classe: 'fixed_income' }))
    expect(mock.criarAtivoInvestimento.mock.calls[0][0]).not.toHaveProperty('subclasse')
    expect(mock.definirSubclasseAtivo).toHaveBeenCalledWith('novo-id', 'CDB')
  })

  it('sem subclasse digitada, não chama a RPC de subclasse', async () => {
    const u = userEvent.setup()
    render(<Investimentos />)
    await u.click(await screen.findByRole('button', { name: 'Novo ativo' }))
    await u.type(screen.getByLabelText('Nome do ativo'), 'Algo')
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

    it('só oferece contas ativas e só ativos em reais', async () => {
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

    it('se o banco recusar a exclusão, a mensagem dele aparece (a tela não confia só nos contadores)', async () => {
      comZerado()
      mock.excluirAtivoInvestimento.mockRejectedValue(Object.assign(new Error('Este ativo possui operações, avaliações ou proventos. O histórico financeiro não pode ser excluído.'), { code: '55000' }))
      const u = userEvent.setup()
      vi.spyOn(window, 'confirm').mockReturnValue(true)
      render(<Investimentos />)
      await u.click(within(await linhaDe('Nunca usado')).getByRole('button', { name: 'Excluir Nunca usado' }))
      expect((await screen.findByRole('alert')).textContent).toMatch(/histórico financeiro não pode ser excluído/)
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
  })
})
