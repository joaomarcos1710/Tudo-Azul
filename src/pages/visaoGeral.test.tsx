// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { Cents } from '../lib/format'

const mock = vi.hoisted(() => ({
  carregarPatrimonio: vi.fn(),
  carregarResumoInvestimentos: vi.fn(),
  proximosPlanejados: vi.fn(),
  resumoDoMes: vi.fn(),
  listarContas: vi.fn(),
  totaisPorMoeda: vi.fn(),
  despesasPorCategoria: vi.fn(),
  despesasPorDia: vi.fn(),
  regularidadeRenda: vi.fn(),
  projecaoDoMes: vi.fn(),
  vencidosPlanejados: vi.fn(),
  resumoDosCartoes: vi.fn(),
  totalFaturasDoMes: vi.fn(),
  resumoDoPeriodo: vi.fn(),
  resumoPorMoeda: vi.fn(),
  listarLancamentos: vi.fn(),
  listarCategorias: vi.fn(),
  saldosProjetados: vi.fn(),
  evolucaoPatrimonio: vi.fn(),
  listarOrcamentos: vi.fn(),
  avisosDoInicio: vi.fn(),
  fluxoDeCaixa: vi.fn(),
}))
vi.mock('../lib/FamiliaContext', () => ({
  useFamilia: () => ({ familia: { id: 'h1', nome: 'Casa', papel: 'owner' }, carregando: false, erro: false, recarregar: vi.fn() }),
}))
vi.mock('../lib/painel', () => ({
  carregarPatrimonio: mock.carregarPatrimonio, carregarResumoInvestimentos: mock.carregarResumoInvestimentos,
  proximosPlanejados: mock.proximosPlanejados,
  despesasPorCategoria: mock.despesasPorCategoria, despesasPorDia: mock.despesasPorDia,
  regularidadeRenda: mock.regularidadeRenda,
  projecaoDoMes: mock.projecaoDoMes,
  vencidosPlanejados: mock.vencidosPlanejados,
  evolucaoPatrimonio: mock.evolucaoPatrimonio,
}))
vi.mock('../lib/auth', () => ({ useAuth: () => ({ sessao: { user: { id: 'u1', user_metadata: { name: 'João Marcos' } } }, carregando: false }) }))
vi.mock('../lib/categorias', async (o) => ({ ...(await o<typeof import('../lib/categorias')>()), listarCategorias: mock.listarCategorias }))
vi.mock('../lib/lancamentos', async (o) => ({ ...(await o<typeof import('../lib/lancamentos')>()), resumoDoMes: mock.resumoDoMes, resumoDoPeriodo: mock.resumoDoPeriodo, listarLancamentos: mock.listarLancamentos, resumoPorMoeda: mock.resumoPorMoeda }))
const cobrar = vi.hoisted(() => vi.fn())
const gerar = vi.hoisted(() => vi.fn())
vi.mock('../lib/cartoes', () => ({ cobrarFaturasFechadas: cobrar, resumoDosCartoes: mock.resumoDosCartoes, totalFaturasDoMes: mock.totalFaturasDoMes }))
vi.mock('../lib/recorrencias', () => ({ gerarOcorrencias: gerar }))
vi.mock('../lib/saldoProjetado', () => ({ saldosProjetados: mock.saldosProjetados }))
vi.mock('../lib/orcamentos', () => ({ listarOrcamentos: mock.listarOrcamentos }))
vi.mock('../lib/fluxoCaixa', async (o) => ({ ...(await o<typeof import('../lib/fluxoCaixa')>()), fluxoDeCaixa: mock.fluxoDeCaixa }))
vi.mock('../lib/avisosInicio', async (o) => ({ ...(await o<typeof import('../lib/avisosInicio')>()), avisosDoInicio: mock.avisosDoInicio }))
vi.mock('../lib/contas', async (o) => ({ ...(await o<typeof import('../lib/contas')>()), listarContas: mock.listarContas, totaisPorMoeda: mock.totaisPorMoeda }))

import { hojeSP } from '../lib/contas'
import VisaoGeral from './VisaoGeral'

const c = (n: number) => n as Cents
const montar = (secao: 'inicio' | 'analises' = 'inicio') => render(<MemoryRouter><VisaoGeral secao={secao} /></MemoryRouter>)

beforeEach(() => {
  window.localStorage.clear()
  mock.totaisPorMoeda.mockResolvedValue([])
  mock.resumoPorMoeda.mockResolvedValue([])
  cobrar.mockResolvedValue(0)
  gerar.mockResolvedValue(0)
  mock.carregarPatrimonio.mockResolvedValue({ disponivel: c(5065105), creditoAReceber: c(24590), divida: c(4002135), bens: c(0), patrimonio: c(1087560), compromissos: c(482000) })
  mock.carregarResumoInvestimentos.mockResolvedValue([{ moeda: 'BRL', valorAtual: c(36000) }, { moeda: 'USD', valorAtual: c(20100) }])
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
  mock.vencidosPlanejados.mockResolvedValue({ itens: [], total: 0 })
  mock.saldosProjetados.mockResolvedValue({ contas: [], total: null })
  mock.listarOrcamentos.mockResolvedValue([])
  mock.avisosDoInicio.mockResolvedValue([])
  mock.fluxoDeCaixa.mockResolvedValue({ linhas: [], totalEntradas: c(0), totalSaidas: c(0) })
  mock.evolucaoPatrimonio.mockResolvedValue([])
  mock.resumoDosCartoes.mockResolvedValue([])
  mock.totalFaturasDoMes.mockResolvedValue(null)
  mock.projecaoDoMes.mockResolvedValue({
    diasNoMes: 31, diasDecorridos: 10, diasRestantes: 21, gasto: c(1300000), previsto: c(25000), variavelAteAgora: c(30000),
    ritmoPorDia: c(3000), ritmoRestante: c(63000), projetado: c(1388000),
  })
  
  // ordem do Promise.all da tela: mês até hoje, mesmo período do ano passado, ano até hoje, ano passado
  // padrão para a comparação dos indicadores (dia 1 até hoje × mês anterior até o mesmo dia), que vem depois
  mock.resumoDoPeriodo.mockResolvedValue({ receitas: c(1000000), despesas: c(800000), resultado: c(200000), receitasPrevistas: c(0), despesasPrevistas: c(0) })
  mock.resumoDoPeriodo
    .mockResolvedValueOnce({ receitas: c(1000000), despesas: c(600000), resultado: c(400000), receitasPrevistas: c(0), despesasPrevistas: c(0) })
    .mockResolvedValueOnce({ receitas: c(800000), despesas: c(800000), resultado: c(0), receitasPrevistas: c(0), despesasPrevistas: c(0) })
    .mockResolvedValueOnce({ receitas: c(9000000), despesas: c(6600000), resultado: c(2400000), receitasPrevistas: c(0), despesasPrevistas: c(0) })
    .mockResolvedValueOnce({ receitas: c(8000000), despesas: c(6000000), resultado: c(2000000), receitasPrevistas: c(0), despesasPrevistas: c(0) })
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
  it('o Início saúda pelo nome (até dois nomes) com receita e despesa do mês do banco; Análises mostra o título próprio', async () => {
    montar()
    expect(await screen.findByRole('heading', { name: 'João Marcos!' })).toBeTruthy()
    expect(screen.getByText(/^(Bom dia|Boa tarde|Boa noite),$/)).toBeTruthy()
    const cabecalho = screen.getByRole('heading', { name: 'João Marcos!' }).closest('header')!
    expect(within(cabecalho).getByText('Receita mensal').nextElementSibling?.textContent).toMatch(/^R\$ /)
    expect(within(cabecalho).getByText('Despesa mensal').nextElementSibling?.textContent).toMatch(/^R\$ /)
    expect(within(cabecalho).getByRole('link', { name: 'Ver análises do mês' }).getAttribute('href')).toBe('/analises')
    cleanup()
    montar('analises')
    expect(await screen.findByRole('heading', { name: 'Análises' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'João Marcos!' })).toBeNull()
  })
  it('gráfico de categorias com valores e % do banco (Análises)', async () => {
    montar('analises')
    expect((await screen.findAllByText('57,7%')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Moradia').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Outros').length).toBeGreaterThan(0)
    expect(screen.getByRole('img', { name: /Despesa acumulada no mês: R\$ 8\.667,26/ })).toBeTruthy()
  })
  it('últimos lançamentos: só pagos, com categoria', async () => {
    montar()
    expect(await screen.findByText('Aluguel')).toBeTruthy()
    expect(screen.queryByText('Planejado')).toBeNull()
  })
  it('Início: últimos, próximos e vencidos mostram o ícone da categoria', async () => {
    mock.proximosPlanejados.mockResolvedValue([{ id: 't1', tipo: 'expense', descricao: 'Internet', valor: c(12000), data: '2026-10-20', categoriaId: 'g1' }])
    mock.vencidosPlanejados.mockResolvedValue({ itens: [{ id: 'v1', tipo: 'transfer', descricao: 'Reserva', valor: c(100), data: '2026-10-01', categoriaId: null }], total: 1 })
    montar()
    const icone = (texto: string | RegExp) => screen.getByText(texto).closest('li')!.querySelector('[data-icone]')!.getAttribute('data-icone')
    await screen.findByText('Aluguel')
    expect(icone('Aluguel')).toBe('casa') // g1 = Moradia
    expect(icone(/Internet/)).toBe('casa')
    expect(icone(/Reserva/)).toBe('transferencia')
  })

  describe('transferências com De → Para', () => {
    const contasComNubank = () => mock.listarContas.mockResolvedValue({
      contas: [
        { id: 'a1', nome: 'Itaú', tipo: 'checking', saldoInicial: c(0), abertura: '2026-10-01', ativa: true, saldo: c(100000) },
        { id: 'a3', nome: 'Nubank', tipo: 'checking', saldoInicial: c(0), abertura: '2026-10-01', ativa: true, saldo: c(50000) },
        { id: 'a2', nome: 'Antiga', tipo: 'checking', saldoInicial: c(0), abertura: '2026-10-01', ativa: false, saldo: c(0) },
      ],
      total: c(150000),
    })

    it('próximos planejados: a transferência mostra "De → Para" com o nome (e a logo) de cada conta', async () => {
      contasComNubank()
      mock.proximosPlanejados.mockResolvedValue([
        { id: 't9', tipo: 'transfer', descricao: 'Reserva', valor: c(30000), data: '2026-10-20', categoriaId: null, contaId: 'a1', destinoId: 'a3' },
      ])
      montar()
      const item = (await screen.findByText(/Reserva/)).closest('li')!
      expect(item.textContent).toMatch(/De\s*Itaú\s*→\s*Para\s*Nubank/)
      expect(item.querySelectorAll('[data-banco], img, svg').length).toBeGreaterThan(0)
    })

    it('vencidos: a transferência também mostra De → Para', async () => {
      contasComNubank()
      mock.vencidosPlanejados.mockResolvedValue({
        itens: [{ id: 'v9', tipo: 'transfer', descricao: 'Guardar', valor: c(10000), data: '2026-10-01', categoriaId: null, contaId: 'a3', destinoId: 'a1' }], total: 1,
      })
      montar()
      const item = (await screen.findByText(/Guardar/)).closest('li')!
      expect(item.textContent).toMatch(/De\s*Nubank\s*→\s*Para\s*Itaú/)
    })

    it('conta arquivada aparece com o nome dela; só conta desconhecida vira "outra conta"', async () => {
      contasComNubank()
      mock.proximosPlanejados.mockResolvedValue([
        { id: 't8', tipo: 'transfer', descricao: 'Saque', valor: c(5000), data: '2026-10-21', categoriaId: null, contaId: 'a1', destinoId: 'a2' },
        { id: 't7', tipo: 'transfer', descricao: 'Sumida', valor: c(5000), data: '2026-10-22', categoriaId: null, contaId: 'a1', destinoId: 'zz' },
      ])
      montar()
      expect((await screen.findByText(/Saque/)).closest('li')!.textContent).toMatch(/De\s*Itaú\s*→\s*Para\s*Antiga/)
      expect(screen.getByText(/Sumida/).closest('li')!.textContent).toMatch(/Para\s*outra conta/)
    })

    it('últimos lançamentos: transferência paga mostra "De Mercado Pago → Para Caixa"', async () => {
      mock.listarContas.mockResolvedValue({
        contas: [
          { id: 'mp', nome: 'Mercado Pago', tipo: 'checking', saldoInicial: c(0), abertura: '2026-10-01', ativa: true, saldo: c(0) },
          { id: 'cx', nome: 'Caixa Econômica', tipo: 'checking', saldoInicial: c(0), abertura: '2026-10-01', ativa: true, saldo: c(0) },
        ],
        total: c(0),
      })
      mock.listarLancamentos.mockResolvedValue([
        { id: 'l9', tipo: 'transfer', contaId: 'mp', destinoId: 'cx', categoriaId: null, descricao: 'Transferência', valor: c(20000), data: '2026-10-05', status: 'paid', notas: '' },
      ])
      montar()
      const card = (await screen.findByText('Últimos lançamentos')).closest('div[class*="rounded"]') as HTMLElement
      expect(within(card).getByText('Transferência').closest('li')!.textContent).toMatch(/De\s*Mercado Pago\s*→\s*Para\s*Caixa Econômica/)
    })

    it('receita e despesa não ganham De → Para', async () => {
      contasComNubank()
      mock.proximosPlanejados.mockResolvedValue([
        { id: 't1', tipo: 'expense', descricao: 'Internet', valor: c(12000), data: '2026-10-20', categoriaId: 'g1', contaId: 'a1', destinoId: null },
      ])
      montar()
      const item = (await screen.findByText(/Internet/)).closest('li')!
      expect(item.textContent).not.toMatch(/De → Para/)
    })
  })

  it('compara com o mês anterior até o mesmo dia, não com o mês anterior inteiro', async () => {
    // mês anterior inteiro: despesa 4x maior; até o mesmo dia: metade. Antes a tela mostrava "▼ 75%"; o certo é "▲ 100%"
    mock.resumoDoMes.mockResolvedValueOnce({ receitas: c(1215000), despesas: c(866726), resultado: c(348274), receitasPrevistas: c(0), despesasPrevistas: c(0) })
      .mockResolvedValueOnce({ receitas: c(1215000), despesas: c(3466904), resultado: c(0), receitasPrevistas: c(0), despesasPrevistas: c(0) })
    const hoje = hojeSP()
    const [a, m] = hoje.split('-').map(Number)
    const ant = `${m === 1 ? a - 1 : a}-${String(m === 1 ? 12 : m - 1).padStart(2, '0')}`
    const ultimoAnt = new Date(Date.UTC(Number(ant.slice(0, 4)), Number(ant.slice(5)), 0)).getUTCDate()
    const ateAnt = `${ant}-${String(Math.min(Number(hoje.slice(8)), ultimoAnt)).padStart(2, '0')}`
    mock.resumoDoPeriodo.mockReset()
    mock.resumoDoPeriodo.mockImplementation((_f: string, de: string, ate: string) => Promise.resolve(
      de === `${ant}-01` && ate === ateAnt
        ? { receitas: c(1215000), despesas: c(433363), resultado: c(781637), receitasPrevistas: c(0), despesasPrevistas: c(0) }
        : { receitas: c(1215000), despesas: c(866726), resultado: c(348274), receitasPrevistas: c(0), despesasPrevistas: c(0) }))
    montar('analises')
    const despesas = (await screen.findByText('Despesas do mês')).closest('div') as HTMLElement
    expect(within(despesas).getByText(/▲ 100%/)).toBeTruthy()
    expect(within(despesas).getByText(new RegExp(`até dia ${Number(ateAnt.slice(8))}`))).toBeTruthy()
    expect(mock.resumoDoPeriodo).toHaveBeenCalledWith('h1', `${ant}-01`, ateAnt)
  })
  it('valores ocultos: o saldo em dólar também vira máscara no Início', async () => {
    const { definirValoresOcultos } = await import('../lib/privacidade')
    definirValoresOcultos(true)
    try {
      montar()
      const card = (await screen.findByText(/Saldo em USD/)).parentElement as HTMLElement
      expect(within(card).queryByText(/US\$|201/)).toBeNull()
    } finally {
      definirValoresOcultos(false)
    }
  })
  it('uma carga antiga que chega depois da nova é descartada (Início → Análises)', async () => {
    let soltarInicio: (v: unknown) => void = () => {}
    mock.listarContas.mockReturnValueOnce(new Promise((r) => { soltarInicio = r }))
    const tela = render(<MemoryRouter><VisaoGeral secao="inicio" /></MemoryRouter>)
    tela.rerender(<MemoryRouter><VisaoGeral secao="analises" /></MemoryRouter>)
    expect(await screen.findByText('Comparação com o ano passado')).toBeTruthy()
    soltarInicio({ contas: [], total: c(0) })
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByText('Próximos planejados')).toBeNull()
    expect(screen.getByText('Comparação com o ano passado')).toBeTruthy()
  })
  it('mostra a equação do patrimônio com os valores do banco', async () => {
    montar('analises')
    // patrimônio consolidado inclui a participação familiar nos bens em BRL
    expect(await screen.findByText('Patrimônio líquido')).toBeTruthy()
    expect(screen.getByText('R$ 10.875,60')).toBeTruthy()
    expect(screen.getByText('R$ 4.820,00')).toBeTruthy() // compromissos à parte
    cleanup()
    montar()
    expect(await screen.findByText(/Saldo em USD/)).toBeTruthy() // investimentos aparecem no Início, em moeda segregada
  })
  it('resumo do mês (Análises): receitas e despesas do banco', async () => {
    montar('analises')
    expect(await screen.findByText('+R$ 12.150,00')).toBeTruthy()
    expect(screen.getByText('−R$ 8.667,26')).toBeTruthy()
  })
  it('próximos planejados e só contas ativas (Início)', async () => {
    montar()
    expect(await screen.findByText(/Internet/)).toBeTruthy()
    expect(screen.getByText('Itaú')).toBeTruthy()
    expect(screen.queryByText('Antiga')).toBeNull()
  })
  it('sem compromissos, não mostra a faixa', async () => {
    mock.carregarPatrimonio.mockResolvedValue({ disponivel: c(0), creditoAReceber: c(0), divida: c(0), bens: c(0), patrimonio: c(0), compromissos: c(0) })
    mock.carregarResumoInvestimentos.mockResolvedValue([])
    montar('analises')
    expect(await screen.findByText('Patrimônio líquido')).toBeTruthy()
    expect(screen.queryByText(/Compromissos futuros/)).toBeNull()
  })

  it('se a geração dos recorrentes falhar, avisa e mantém o painel', async () => {
    gerar.mockRejectedValue(new Error('x'))
    render(<MemoryRouter><VisaoGeral /></MemoryRouter>)
    expect(await screen.findByText(/Não foi possível lançar os recorrentes/)).toBeTruthy()
    expect(screen.getByText('Próximos planejados')).toBeTruthy() // o Início segue de pé mesmo com o aviso
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
    montar('analises')
    expect(await screen.findByText('R$ 10.875,60')).toBeTruthy()
    expect(screen.getAllByText(/Gráfico indisponível agora/)).toHaveLength(2)
    expect(screen.queryByText(/Não foi possível/)).toBeNull()
  })

  it('renda regular × despesas: mês e últimos 12 meses, com a cobertura vinda do banco', async () => {
    montar('analises')
    expect(await screen.findByText('Renda regular × despesas')).toBeTruthy()
    expect(screen.getByText('Últimos 12 meses')).toBeTruthy()
    expect(screen.getByText('125%')).toBeTruthy()
    expect(screen.getByText('83,3%')).toBeTruthy()
    expect(screen.getByText('R$ 60.000,00')).toBeTruthy()
    expect(screen.queryByText(/Nenhuma receita eventual nos últimos 12 meses/)).toBeNull()
  })
  it('sem nenhuma receita eventual nos 12 meses, sugere marcar em Categorias', async () => {
    mock.regularidadeRenda.mockReset()
    mock.regularidadeRenda.mockResolvedValue({ regular: c(500000), eventual: c(0), despesas: c(400000), cobertura: 125 })
    montar('analises')
    expect(await screen.findByText(/Nenhuma receita eventual nos últimos 12 meses/)).toBeTruthy()
  })
  it('mês sem despesas: não inventa percentual', async () => {
    mock.regularidadeRenda.mockReset()
    mock.regularidadeRenda.mockResolvedValue({ regular: c(0), eventual: c(0), despesas: c(0), cobertura: null })
    montar('analises')
    expect((await screen.findAllByText('Sem despesas no período.')).length).toBe(2)
  })
  it('se o relatório falhar (banco sem a migration 012), o resto do painel aparece', async () => {
    mock.regularidadeRenda.mockReset()
    mock.regularidadeRenda.mockRejectedValue(new Error('function does not exist'))
    montar('analises')
    expect(await screen.findByText('R$ 10.875,60')).toBeTruthy()
    expect(screen.queryByText('Renda regular × despesas')).toBeNull()
    expect(screen.queryByText(/Não foi possível/)).toBeNull()
  })

  it('comparação com o ano passado: mesmo recorte de dias, despesa menor é bom e maior é ruim', async () => {
    montar('analises')
    expect(await screen.findByText('Comparação com o ano passado')).toBeTruthy()
    // mês: despesas 6.000 contra 8.000 = −25% (bom); ano: 66.000 contra 60.000 = +10% (ruim)
    const bom = screen.getByText('▼ 25%')
    expect(bom.className).toMatch(/text-positivo/)
    const ruim = screen.getByText('▲ 10%')
    expect(ruim.className).toMatch(/text-negativo/)
    expect(screen.getByText(/Mesmos dias nos dois anos/)).toBeTruthy()
    // 4 consultas de período, cada uma com datas no formato AAAA-MM-DD
    expect(mock.resumoDoPeriodo).toHaveBeenCalledTimes(6) // + 2 da comparação dos indicadores
    for (const [, de, ate] of mock.resumoDoPeriodo.mock.calls) {
      expect(de).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(ate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })
  it('se a comparação falhar, o resto do painel aparece', async () => {
    mock.resumoDoPeriodo.mockReset()
    mock.resumoDoPeriodo.mockRejectedValue(new Error('x'))
    montar('analises')
    expect(await screen.findByText('R$ 10.875,60')).toBeTruthy()
    expect(screen.queryByText('Comparação com o ano passado')).toBeNull()
    expect(screen.queryByText(/Não foi possível/)).toBeNull()
  })
  it('comparação: valor igual ao do ano passado fica neutro, sem seta nem cor', async () => {
    mock.resumoDoPeriodo.mockReset()
    const igual = { receitas: c(100000), despesas: c(50000), resultado: c(50000), receitasPrevistas: c(0), despesasPrevistas: c(0) }
    mock.resumoDoPeriodo.mockResolvedValue(igual)
    montar('analises')
    expect((await screen.findAllByText('= igual')).length).toBe(6)
    const card = screen.getByText('Comparação com o ano passado').closest('div') as HTMLElement
    expect(within(card).queryByText(/▲|▼/)).toBeNull()
  })
  it('projeção do mês: total, as três partes e o ritmo por dia vindos do banco', async () => {
    montar('analises')
    expect(await screen.findByText('Projeção do mês')).toBeTruthy()
    expect(screen.getByText('R$ 13.880,00')).toBeTruthy()
    expect(screen.getByText('R$ 13.000,00')).toBeTruthy()
    expect(screen.getByText('R$ 250,00')).toBeTruthy()
    expect(screen.getByText(/Ritmo do que é variável: R\$ 30,00 por dia × 21 dias/)).toBeTruthy()
    expect(screen.getByText('R$ 630,00')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Ver por categoria em Orçamentos' })).toBeTruthy()
  })
  it('projeção nos primeiros dias avisa que ainda está instável', async () => {
    mock.projecaoDoMes.mockReset()
    mock.projecaoDoMes.mockResolvedValue({
      diasNoMes: 31, diasDecorridos: 3, diasRestantes: 28, gasto: c(0), previsto: c(150000), variavelAteAgora: c(0),
      ritmoPorDia: c(0), ritmoRestante: c(0), projetado: c(150000),
    })
    montar('analises')
    expect(await screen.findByText(/O ritmo só entra a partir do 7º dia do mês \(hoje é o dia 3\)/)).toBeTruthy()
  })
  it('família sem gasto nem previsto: o card de projeção não aparece com R$ 0,00', async () => {
    mock.projecaoDoMes.mockReset()
    mock.projecaoDoMes.mockResolvedValue({
      diasNoMes: 31, diasDecorridos: 10, diasRestantes: 21, gasto: c(0), previsto: c(0), variavelAteAgora: c(0),
      ritmoPorDia: c(0), ritmoRestante: c(0), projetado: c(0),
    })
    montar('analises')
    await screen.findByText('R$ 10.875,60')
    expect(screen.queryByText('Projeção do mês')).toBeNull()
  })
  it('se a projeção falhar (banco sem a migration 013), o resto do painel aparece', async () => {
    mock.projecaoDoMes.mockReset()
    mock.projecaoDoMes.mockRejectedValue(new Error('function does not exist'))
    montar('analises')
    expect(await screen.findByText('R$ 10.875,60')).toBeTruthy()
    expect(screen.queryByText('Projeção do mês')).toBeNull()
    expect(screen.queryByText(/Não foi possível/)).toBeNull()
  })

  it('grades de painéis têm grid-cols-1 no celular (sem ela a coluna cresce até o item mais largo e a tela rola de lado)', async () => {
    // jsdom não calcula layout; a medição real (sem rolagem lateral em 320px) foi feita no navegador. Aqui fica a trava.
    montar()
    const painel = (await screen.findByText('Últimos lançamentos')).closest('div.grid')
    expect(painel?.className.split(/\s+/)).toContain('grid-cols-1')
  })

  it('ações rápidas: despesa, receita, transferência e compra no cartão abrem o lançamento já no tipo certo', async () => {
    montar()
    const acoes = await screen.findByRole('navigation', { name: 'Ações rápidas' })
    expect(acoes.closest('header')).toBeTruthy() // no cabeçalho, ao lado da saudação (estilo Organizze), sem repetir abaixo
    expect(screen.getAllByRole('link', { name: 'Despesa' })).toHaveLength(1)
    const alvo = (nome: string) => (within(acoes).getByRole('link', { name: nome }) as HTMLAnchorElement).getAttribute('href')
    expect(alvo('Despesa')).toBe('/lancamentos?novo=despesa')
    expect(alvo('Receita')).toBe('/lancamentos?novo=receita')
    expect(alvo('Transferência')).toBe('/lancamentos?novo=transferencia')
    expect(alvo('Compra no cartão')).toBe('/lancamentos?novo=cartao')
  })

  it('vencidos: lista o planejado que já passou, o mais antigo primeiro, com há quantos dias e link para o mês', async () => {
    const hojeSP_ = hojeSP() // data de São Paulo, a mesma do app (UTC erra o dia entre 21h e 24h em SP)
    const dia = (n: number) => new Date(Date.parse(hojeSP_ + 'T12:00:00Z') - n * 86_400_000).toISOString().slice(0, 10)
    mock.vencidosPlanejados.mockResolvedValue({
      total: 7,
      itens: [
        { id: 'v1', tipo: 'expense', descricao: 'Luz', valor: c(18000), data: dia(5) },
        { id: 'v2', tipo: 'income', descricao: 'Aluguel recebido', valor: c(150000), data: dia(1) },
      ],
    })
    montar()
    expect(await screen.findByText('Vencidos e precisam de atenção')).toBeTruthy()
    expect(screen.getByText(/7 compromissos planejados já passaram/)).toBeTruthy()
    expect(screen.getByText('venceu há 5 dias')).toBeTruthy()
    expect(screen.getByText('venceu ontem')).toBeTruthy()
    expect(screen.getByText('−R$ 180,00')).toBeTruthy()
    expect(screen.getByText('+R$ 1.500,00')).toBeTruthy()
    expect(screen.getByText(/e mais 5/)).toBeTruthy()
    const link = screen.getByText(/Luz/).closest('a') as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe(`/lancamentos?mes=${dia(5).slice(0, 7)}`)
  })

  it('sem vencidos, a seção não aparece; se a consulta falhar, o resto do painel aparece', async () => {
    montar()
    await screen.findByText('Próximos planejados')
    expect(screen.queryByText('Vencidos e precisam de atenção')).toBeNull()
    cleanup()
    mock.vencidosPlanejados.mockRejectedValue(new Error('x'))
    montar()
    expect(await screen.findByText('Próximos planejados')).toBeTruthy() // o Início segue de pé com a consulta de vencidos falhando
    // mas avisa: sem aviso, "Vencidos" ausente pareceria "nada vencido"
    expect(screen.getByRole('alert').textContent).toMatch(/Não foi possível verificar agora os vencidos/)
  })

  it('cartões: mostra a próxima fatura (valor e vencimento) mesmo sem fatura fechada a pagar', async () => {
    mock.resumoDosCartoes.mockResolvedValue([
      { id: 'k1', nome: 'Caixa', divida: c(0), vencimento: null, vencida: false, limiteDisponivel: null, credito: c(0),
        proxima: { mes: '2026-11', vencimento: '2026-11-28', total: c(43897) } },
    ])
    montar('inicio')
    // como no Organizze: limite disponível ao lado da fatura atual (aberta), com o vencimento
    const cartao = (await screen.findByText('Caixa')).closest('li') as HTMLElement
    expect(within(cartao).getByText('Fatura atual · vence 28/11')).toBeTruthy()
    expect(within(cartao).getByText('R$ 438,97')).toBeTruthy()
    expect(within(cartao).getByText('Limite disponível')).toBeTruthy()
    expect(within(cartao).queryByText(/Fatura fechada a pagar/)).toBeNull()
  })

  it('cartões: total das faturas que vencem no mês, vindo do banco, no topo do bloco', async () => {
    mock.resumoDosCartoes.mockResolvedValue([
      { id: 'k1', nome: 'Nubank', divida: c(0), vencimento: null, vencida: false, limiteDisponivel: null, credito: c(0) },
    ])
    mock.totalFaturasDoMes.mockResolvedValue({ faturas: 3, total: c(1284664), pago: c(0), falta: c(1284664) })
    montar('inicio')
    const bloco = await screen.findByTestId('faturas-do-mes')
    expect(bloco.textContent).toContain('R$ 12.846,64')
    expect(bloco.textContent).toContain('3 faturas')
    expect(bloco.textContent).not.toContain('já pago')
  })

  it('cartões: com pagamento no mês mostra quanto já foi pago e quanto falta', async () => {
    mock.resumoDosCartoes.mockResolvedValue([
      { id: 'k1', nome: 'Nubank', divida: c(0), vencimento: null, vencida: false, limiteDisponivel: null, credito: c(0) },
    ])
    mock.totalFaturasDoMes.mockResolvedValue({ faturas: 1, total: c(10000), pago: c(4000), falta: c(6000) })
    montar('inicio')
    const bloco = await screen.findByTestId('faturas-do-mes')
    expect(bloco.textContent).toContain('1 fatura')
    expect(bloco.textContent).toContain('já pago R$ 40,00')
    expect(bloco.textContent).toContain('falta R$ 60,00')
  })

  it('cartões: mês sem fatura ou banco sem a função não mostram o total e o resto do bloco segue', async () => {
    mock.resumoDosCartoes.mockResolvedValue([
      { id: 'k1', nome: 'Nubank', divida: c(0), vencimento: null, vencida: false, limiteDisponivel: null, credito: c(0) },
    ])
    mock.totalFaturasDoMes.mockResolvedValue({ faturas: 0, total: c(0), pago: c(0), falta: c(0) })
    const { unmount } = montar('inicio')
    expect(await screen.findByText('Limite disponível')).toBeTruthy()
    expect(screen.queryByTestId('faturas-do-mes')).toBeNull()
    unmount()
    mock.totalFaturasDoMes.mockRejectedValue({ code: '42883', message: 'function does not exist' })
    montar('inicio')
    expect(await screen.findByText('Limite disponível')).toBeTruthy()
    expect(screen.queryByTestId('faturas-do-mes')).toBeNull()
  })

  it('cartões: fatura a pagar com vencimento, fatura vencida em vermelho e limite disponível', async () => {
    mock.resumoDosCartoes.mockResolvedValue([
      { id: 'k1', nome: 'Nubank', divida: c(133334), vencimento: '2099-12-25', vencida: false, limiteDisponivel: c(527000), credito: c(0) },
      { id: 'k2', nome: 'Inter', divida: c(50000), vencimento: '2020-01-10', vencida: true, limiteDisponivel: null, credito: c(0) },
      { id: 'k3', nome: 'Azul Card', divida: c(0), vencimento: null, vencida: false, limiteDisponivel: null, credito: c(10000) },
    ])
    montar()
    expect(await screen.findByText('Nubank')).toBeTruthy()
    const nubank = screen.getByText('Nubank').closest('li') as HTMLElement
    expect(within(nubank).getByText('R$ 1.333,34')).toBeTruthy()
    expect(nubank.textContent).toContain('Fatura fechada a pagar R$ 1.333,34 · vence em 25/12')
    expect(within(nubank).getByText('R$ 5.270,00')).toBeTruthy() // limite disponível
    const inter = screen.getByText('Inter').closest('li') as HTMLElement
    const aviso = within(inter).getByText(/Fatura fechada a pagar/)
    expect(aviso.textContent).toContain('venceu em 10/01/2020') // vencida mostra o ano
    expect(aviso.className).toMatch(/text-negativo/)
    expect(screen.getByText('Crédito no cartão de R$ 100,00')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Ver cartões' })).toBeTruthy()
  })

  it('Minhas contas: saldo geral do banco no topo; conta arquivada fica escondida', async () => {
    montar()
    const card = (await screen.findByText('Minhas contas')).closest('div[class*="rounded"]') as HTMLElement
    expect(within(card).getByText('Saldo geral')).toBeTruthy()
    expect(within(card).getAllByText('R$ 12.820,30').length).toBe(2) // total do banco (balance_totals) e a única conta ativa
    expect(within(card).queryByText('Antiga')).toBeNull()
    // só contas em reais: nada de "Em outras moedas"
    expect(screen.queryByRole('group', { name: 'Em outras moedas' })).toBeNull()
  })

  it('Minhas contas: só as ativas com saldo diferente de zero, com o link para a aba Contas', async () => {
    mock.listarContas.mockResolvedValue({
      contas: [
        { id: 'a1', nome: 'Itaú', tipo: 'checking', saldoInicial: c(0), abertura: '2026-10-01', ativa: true, saldo: c(1282030) },
        { id: 'a3', nome: 'Zerada', tipo: 'checking', saldoInicial: c(0), abertura: '2026-10-01', ativa: true, saldo: c(0) },
        { id: 'a4', nome: 'No vermelho', tipo: 'checking', saldoInicial: c(0), abertura: '2026-10-01', ativa: true, saldo: c(-5000) },
      ],
      total: c(1277030),
    })
    montar()
    const card = (await screen.findByText('Minhas contas')).closest('div[class*="rounded"]') as HTMLElement
    expect(within(card).getByText('Itaú')).toBeTruthy()
    expect(within(card).getByText('No vermelho')).toBeTruthy()
    expect(within(card).queryByText('Zerada')).toBeNull()
    expect(within(card).getByRole('link', { name: 'Ver todas as contas' }).getAttribute('href')).toBe('/contas')
    // o total continua o do banco, com todas as contas
    expect(within(card).getByText('R$ 12.770,30')).toBeTruthy()
  })

  it('Minhas contas: todas zeradas mostra uma linha curta e o link', async () => {
    mock.listarContas.mockResolvedValue({
      contas: [{ id: 'a3', nome: 'Zerada', tipo: 'checking', saldoInicial: c(0), abertura: '2026-10-01', ativa: true, saldo: c(0) }],
      total: c(0),
    })
    montar()
    const card = (await screen.findByText('Minhas contas')).closest('div[class*="rounded"]') as HTMLElement
    expect(within(card).getByText('Todas as contas estão zeradas.')).toBeTruthy()
    expect(within(card).queryByText('Zerada')).toBeNull()
    expect(within(card).getByRole('link', { name: 'Ver todas as contas' })).toBeTruthy()
  })

  it('avisos do topo: sem aviso do banco, a faixa não aparece', async () => {
    montar()
    await screen.findByRole('heading', { name: 'João Marcos!' })
    expect(mock.avisosDoInicio).toHaveBeenCalledWith('h1', hojeSP())
    expect(screen.queryByRole('region', { name: 'Avisos' })).toBeNull()
  })

  it('avisos do topo: com avisos do banco, a faixa aparece no Início (e não em Análises); falha da consulta não derruba a tela', async () => {
    mock.avisosDoInicio.mockResolvedValue([
      { tipo: 'receivable', quantidade: 1, total: c(20000), data: '2026-10-23', cartaoId: null, cartaoNome: null },
    ])
    montar()
    const faixa = await screen.findByRole('region', { name: 'Avisos' })
    expect(within(faixa).getByRole('link', { name: /Você tem 1 conta a receber no total de R\$ 200,00/ }).getAttribute('href'))
      .toBe('/lancamentos?mes=2026-10&tipo=receita')
    cleanup()
    montar('analises')
    await screen.findByRole('heading', { name: 'Análises' })
    expect(screen.queryByRole('region', { name: 'Avisos' })).toBeNull()
    cleanup()
    mock.avisosDoInicio.mockRejectedValue(new Error('sem a migration 057'))
    montar()
    expect(await screen.findByRole('heading', { name: 'João Marcos!' })).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Avisos' })).toBeNull()
  })

  it('avisos do topo: o de vencidos leva ao card de vencidos da própria tela', async () => {
    mock.avisosDoInicio.mockResolvedValue([
      { tipo: 'overdue_payable', quantidade: 2, total: c(13000), data: '2026-10-01', cartaoId: null, cartaoNome: null },
    ])
    mock.vencidosPlanejados.mockResolvedValue({ itens: [{ id: 't5', tipo: 'expense', descricao: 'Luz', valor: c(13000), data: '2026-10-01', categoriaId: null, contaId: 'a1', destinoId: null }], total: 2 })
    montar()
    const link = await screen.findByRole('link', { name: /Você tem 2 contas a pagar já vencidas no total de R\$ 130,00/ })
    expect(link.getAttribute('href')).toBe('#vencidos')
    expect(document.getElementById('vencidos')?.textContent).toMatch(/Vencidos e precisam de atenção/)
  })

  it('multimoeda F1: conta em dólar no Início fica na moeda dela e em "Em outras moedas", fora do saldo em reais', async () => {
    mock.listarContas.mockResolvedValue({
      contas: [
        { id: 'a1', nome: 'Itaú', tipo: 'checking', saldoInicial: c(0), abertura: '2026-10-01', ativa: true, saldo: c(1282030), moeda: 'BRL' },
        { id: 'u1', nome: 'Conta em dólar', tipo: 'checking', saldoInicial: c(0), abertura: '2026-10-01', ativa: true, saldo: c(25050), moeda: 'USD' },
      ],
      total: c(1282030),
      porMoeda: [{ moeda: 'BRL', total: c(1282030), totalAtivas: c(1282030) }, { moeda: 'USD', total: c(25050), totalAtivas: c(25050) }],
    })
    montar()
    const card = (await screen.findByText('Minhas contas')).closest('div[class*="rounded"]') as HTMLElement
    expect(within(card).getByText('Saldo geral em reais')).toBeTruthy()
    expect(within(card).getByText('R$ 12.820,30', { selector: 'span.font-bold' })).toBeTruthy() // o total do banco, sem o dólar
    expect(within(card).getByText(/US\$\s*250,50/)).toBeTruthy()
    const bloco = screen.getByRole('group', { name: 'Em outras moedas' })
    expect(bloco.textContent).toMatch(/US\$\s*250,50/)
  })

  it('multimoeda F2: Início mostra receitas e despesas do mês em dólar à parte (period_summary_by_currency) e o lançamento na moeda da conta', async () => {
    mock.listarContas.mockResolvedValue({
      contas: [
        { id: 'a1', nome: 'Itaú', tipo: 'checking', saldoInicial: c(0), abertura: '2026-10-01', ativa: true, saldo: c(1282030), moeda: 'BRL' },
        { id: 'u1', nome: 'Conta em dólar', tipo: 'checking', saldoInicial: c(0), abertura: '2026-10-01', ativa: true, saldo: c(25050), moeda: 'USD' },
      ],
      total: c(1282030),
    })
    mock.listarLancamentos.mockResolvedValue([
      { id: 't9', tipo: 'expense', contaId: 'u1', destinoId: null, categoriaId: null, descricao: 'Café em NY', valor: c(4025), data: hojeSP(), status: 'paid', notas: '' },
    ])
    mock.resumoPorMoeda.mockResolvedValue([{ moeda: 'USD', receitas: c(100000), despesas: c(4025), resultado: c(95975) }])
    montar()
    const linha = (await screen.findByText('Café em NY')).closest('li') as HTMLElement
    expect(linha.textContent).toMatch(/−US\$\s*40,25/)
    expect(linha.textContent).not.toMatch(/R\$/)
    const blocos = screen.getAllByRole('group', { name: 'Em outras moedas' })
    expect(blocos.some((b) => /\+US\$\s*1\.000,00/.test(b.textContent ?? '') && /=\s*US\$\s*959,75/.test(b.textContent ?? ''))).toBe(true)
    // o cabeçalho continua com a receita em reais do banco (period_summary), sem o dólar
    expect(within(screen.getByRole('banner')).getByText('R$ 12.150,00')).toBeTruthy()
    const [de, ate] = [`${hojeSP().slice(0, 7)}-01`, expect.stringMatching(new RegExp(`^${hojeSP().slice(0, 7)}-\\d{2}$`))]
    expect(mock.resumoPorMoeda).toHaveBeenCalledWith('h1', de, ate)
  })

  it('multimoeda F2: Análises também mostra o resultado do mês em outras moedas', async () => {
    mock.resumoPorMoeda.mockResolvedValue([{ moeda: 'EUR', receitas: c(0), despesas: c(990), resultado: c(-990) }])
    montar('analises')
    const bloco = await screen.findByRole('group', { name: 'Em outras moedas' })
    expect(bloco.textContent).toMatch(/−€\s*9,90/)
    expect(bloco.textContent).not.toMatch(/R\$/)
  })

  it('multimoeda F1: Análises mostra "Em outras moedas" junto do patrimônio, do banco (balance_totals_by_currency)', async () => {
    mock.totaisPorMoeda.mockResolvedValue([{ moeda: 'BRL', total: c(100), totalAtivas: c(100) }, { moeda: 'EUR', total: c(8000), totalAtivas: c(8000) }])
    montar('analises')
    const bloco = await screen.findByRole('group', { name: 'Em outras moedas' })
    expect(bloco.textContent).toMatch(/€\s*80,00/)
    expect(bloco.textContent).not.toMatch(/R\$/)
    expect(mock.totaisPorMoeda).toHaveBeenCalledWith('h1', expect.any(String))
  })

  it('Início sem número repetido: Patrimônio só com Bens e Dívida; saldo hoje e previsto num card; receita e despesa só no cabeçalho', async () => {
    mock.carregarPatrimonio.mockResolvedValue({ disponivel: c(249449), creditoAReceber: c(0), divida: c(28193112), bens: c(42000000), patrimonio: c(14056337), compromissos: c(0) })
    mock.saldosProjetados.mockResolvedValue({ contas: [], total: { efetuado: c(249449), planejado: c(-100000), faturas: c(-50000), faturasSemConta: c(0), saldo: c(99449) } })
    montar()
    const painel = await screen.findByRole('region', { name: 'Resumo financeiro personalizável' })
    const pat = within(painel).getByText('Patrimônio líquido').closest('div[class*="rounded"]') as HTMLElement
    expect(Array.from(pat.querySelectorAll('dt')).map((dt) => dt.textContent)).toEqual(['Bens', 'Dívida'])
    expect(within(painel).getAllByText('R$ 2.494,49')).toHaveLength(1) // saldo das contas uma vez só
    expect(within(painel).getByText('Saldo hoje')).toBeTruthy()
    expect(within(painel).getByText('R$ 994,49')).toBeTruthy() // previsto no fim do mês, do banco
    // cada item na sua linha, rótulo e valor juntos (em duas colunas o rótulo quebrava e o valor saía do card)
    const linhas = Array.from(within(painel).getByText('Saldo hoje').closest('dl')!.children)
    expect(linhas.map((l) => l.textContent)).toEqual(['Saldo hojeR$ 2.494,49', expect.stringMatching(/^Previsto em \d{2}\/\d{2}R\$ 994,49$/)])
    // card estreito (4 colunas → ~240px): o valor pode descer para baixo do rótulo, nunca sair do card
    for (const l of linhas) expect(l.className).toMatch(/flex-wrap/)
    for (const dt of linhas.map((l) => l.querySelector('dt')!)) expect(dt.className).not.toMatch(/whitespace-nowrap/)
    expect(painel.querySelector('[aria-label="Indicadores financeiros"]')!.className).toMatch(/xl:grid-cols-3/)
    expect(within(painel).queryByText('Entradas do mês')).toBeNull()
    expect(within(painel).queryByText('Despesas do mês')).toBeNull()
    expect(within(screen.getByRole('banner')).getByText('R$ 12.150,00')).toBeTruthy() // receita no cabeçalho
    expect(within(screen.getByRole('banner')).getByText('a pagar R$ 389,90')).toBeTruthy()
  })

  it('orçamentos do mês: no máximo 4, os mais perto de estourar primeiro, com aviso de estouro', async () => {
    const o = (id: string, nome: string, limite: number, gasto: number, sobra: number | null) =>
      ({ categoriaId: id, nome, limite: c(limite), gasto: c(gasto), previsto: null, ritmo: null, projetado: null, sobra: sobra === null ? null : c(sobra) })
    mock.listarOrcamentos.mockResolvedValue([
      o('a', 'Lazer', 100000, 10000, 50000), o('b', 'Mercado', 100000, 120000, -20000), o('c', 'Saúde', 100000, 90000, -5000),
      o('d', 'Moradia', 100000, 50000, 0), o('e', 'Educação', 100000, 5000, 90000),
    ])
    montar()
    const card = (await screen.findByText('Orçamentos do mês')).closest('div[class*="rounded"]') as HTMLElement
    expect(within(card).getAllByRole('progressbar').map((b) => b.getAttribute('aria-label'))).toEqual([
      'Mercado: 100% do orçamento', 'Saúde: 90% do orçamento', 'Moradia: 50% do orçamento', 'Lazer: 10% do orçamento',
    ])
    expect(within(card).getByText('Passou do limite')).toBeTruthy()
    expect(within(card).getByText('No ritmo atual, vai passar do limite')).toBeTruthy()
    expect(within(card).getByRole('link', { name: 'Ver todos' }).getAttribute('href')).toBe('/orcamentos')
  })

  it('vencidos aparecem antes dos indicadores: o que pede ação vem primeiro', async () => {
    mock.vencidosPlanejados.mockResolvedValue({ itens: [{ id: 't9', tipo: 'expense', descricao: 'Luz', valor: c(18000), data: '2026-10-01', categoriaId: null, contaId: null, destinoId: null }], total: 1 })
    montar()
    const vencidos = await screen.findByText('Vencidos e precisam de atenção')
    const painel = screen.getByRole('region', { name: 'Resumo financeiro personalizável' })
    expect(vencidos.compareDocumentPosition(painel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('Análises: patrimônio e saldo mês a mês em dois gráficos, com tabela dos valores do banco', async () => {
    mock.evolucaoPatrimonio.mockResolvedValue([
      { mes: '2026-09', data: '2026-09-30', patrimonio: c(13000000), disponivel: c(-50000) },
      { mes: '2026-10', data: '2026-10-31', patrimonio: c(13500000), disponivel: c(120000) },
      { mes: '2026-11', data: '2026-11-04', patrimonio: c(14056337), disponivel: c(249449) },
    ])
    montar('analises')
    const secao = await screen.findByRole('region', { name: 'Evolução nos últimos 12 meses' })
    expect(within(secao).getByText('Patrimônio líquido mês a mês')).toBeTruthy()
    expect(within(secao).getByText('Saldo das contas mês a mês')).toBeTruthy()
    const [pat, saldo] = within(secao).getAllByRole('table')
    expect(Array.from(pat.querySelectorAll('tbody tr')).map((r) => r.textContent)).toEqual([
      'setembro de 2026R$ 130.000,00', 'outubro de 2026R$ 135.000,00', 'novembro de 2026R$ 140.563,37',
    ])
    const negativo = within(saldo).getByText('-R$ 500,00')
    expect(negativo.className).toMatch(/text-negativo/)
    expect(within(secao).getAllByRole('img')[0].getAttribute('aria-label')).toMatch(/R\$ 140\.563,37 em novembro de 2026/)
    expect(mock.evolucaoPatrimonio).toHaveBeenCalledWith('h1', hojeSP())
  })

  it('Análises: se a evolução falhar, o resto segue e o bloco some; o Início nem consulta', async () => {
    mock.evolucaoPatrimonio.mockRejectedValue(new Error('rede'))
    montar('analises')
    expect(await screen.findByText('R$ 10.875,60')).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Evolução nos últimos 12 meses' })).toBeNull()
    cleanup(); mock.evolucaoPatrimonio.mockClear()
    montar()
    await screen.findByText('Próximos planejados')
    expect(mock.evolucaoPatrimonio).not.toHaveBeenCalled()
  })

  it('Análises: card de patrimônio com Disponível, Bens e Dívida em linhas', async () => {
    mock.carregarPatrimonio.mockResolvedValue({ disponivel: c(249449), creditoAReceber: c(0), divida: c(28193112), bens: c(42000000), patrimonio: c(14056337), compromissos: c(0) })
    montar('analises')
    const patrimonio = (await screen.findAllByText('Patrimônio líquido')).map((el) => el.closest('div[class*="rounded"]') as HTMLElement).find((el) => el?.querySelector('dl'))!
    expect(within(patrimonio).getByText('R$ 140.563,37')).toBeTruthy()
    const linhas = Array.from(patrimonio.querySelectorAll('dt')).map((dt) => `${dt.textContent} ${dt.nextElementSibling?.textContent}`)
    expect(linhas).toEqual(['Disponível R$ 2.494,49', 'Bens R$ 420.000,00', 'Dívida R$ 281.931,12'])
    expect(screen.queryByText(/Dívida atual/)).toBeNull()
    expect(screen.queryByText(/· bens/)).toBeNull()
  })
})

describe('Personalização dos widgets do Início', () => {
  it('restaura a preferência salva do usuário e permite remover e adicionar indicadores', async () => {
    window.localStorage.setItem('tudo-azul:dashboard-widgets:u1', JSON.stringify(['disponivel', 'resultado']))
    montar()
    expect(await screen.findByText('Próximos planejados')).toBeTruthy()
    const painel = screen.getByRole('region', { name: 'Resumo financeiro personalizável' })
    expect(within(painel).getByText('Saldo hoje')).toBeTruthy()
    expect(within(painel).getByText('Resultado do mês')).toBeTruthy()
    expect(within(painel).queryByText('Patrimônio líquido')).toBeNull()
    fireEvent.click(within(painel).getByRole('button', { name: 'Personalizar painel' }))
    fireEvent.click(within(painel).getAllByRole('button', { name: 'Adicionar' })[0])
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem('tudo-azul:dashboard-widgets:u1') || '[]')).toContain('patrimonio'))
    expect(within(painel).getAllByText('Patrimônio líquido').length).toBeGreaterThan(0)
    fireEvent.click(within(painel).getAllByRole('button', { name: 'Remover' })[0])
  })

  it('ignora IDs desconhecidos e repetidos na preferência salva', async () => {
    // 'receitas' e 'despesas' saíram do Início (estão no cabeçalho): preferência antiga com eles é ignorada
    window.localStorage.setItem('tudo-azul:dashboard-widgets:u1', JSON.stringify(['disponivel', 'desconhecido', 'disponivel', 'receitas', 'despesas']))
    montar()
    const painel = await screen.findByRole('region', { name: 'Resumo financeiro personalizável' })
    expect(within(painel).getAllByText('Saldo hoje')).toHaveLength(1)
    expect(within(painel).queryByText('Entradas do mês')).toBeNull()
    expect(within(painel).queryByText('Patrimônio líquido')).toBeNull()
  })

  it('permite reordenar e restaurar a ordem padrão', async () => {
    montar()
    const painel = await screen.findByRole('region', { name: 'Resumo financeiro personalizável' })
    fireEvent.click(within(painel).getByRole('button', { name: 'Personalizar painel' }))
    fireEvent.click(within(painel).getByRole('button', { name: 'Mover Patrimônio líquido para baixo' }))
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem('tudo-azul:dashboard-widgets:u1') || '[]').slice(0, 2))
      .toEqual(['disponivel', 'patrimonio']))
    fireEvent.click(within(painel).getByRole('button', { name: 'Restaurar padrão' }))
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem('tudo-azul:dashboard-widgets:u1') || '[]'))
      .toEqual(['patrimonio', 'disponivel', 'resultado']))
  })
})

describe('Início × Análises: cada seção mostra só os seus blocos', () => {
  it('Início mostra os widgets financeiros, sem os blocos detalhados de Análises', async () => {
    montar()
    await screen.findByText('Próximos planejados')
    expect(screen.getByRole('heading', { name: 'Visão geral financeira' })).toBeTruthy()
    expect(screen.getByText('Patrimônio líquido')).toBeTruthy()
    expect(screen.getByText('Saldo hoje')).toBeTruthy()
    expect(screen.queryByText('Entradas do mês')).toBeNull()
    expect(screen.queryByText('Despesas do mês')).toBeNull()
    expect(screen.getByText('Resultado do mês')).toBeTruthy()
    expect(screen.getByText('Saldo de investimentos')).toBeTruthy()
    expect(screen.getByText('R$ 360,00')).toBeTruthy()
    expect(screen.getByText('Saldo em USD')).toBeTruthy()
    expect(screen.queryByText('Renda regular × despesas')).toBeNull()
    expect(screen.queryByText('Comparação com o ano passado')).toBeNull()
    expect(screen.queryByText('Projeção do mês')).toBeNull()
  })
  it('Análises não mostra as ações do dia a dia (ações rápidas, vencidos, cartões, próximos, contas)', async () => {
    // com dados de vencidos e cartões, para a ausência não ser só "lista vazia"
    mock.vencidosPlanejados.mockResolvedValue({ total: 1, itens: [{ id: 'v1', tipo: 'expense', descricao: 'Luz', valor: c(18000), data: '2026-10-05' }] })
    mock.resumoDosCartoes.mockResolvedValue([
      { id: 'k1', nome: 'Nubank', divida: c(133334), vencimento: '2099-12-25', vencida: false, limiteDisponivel: c(527000), credito: c(0) },
    ])
    montar('analises')
    await screen.findByRole('heading', { name: 'Análises' })
    expect(screen.getByText('R$ 10.875,60')).toBeTruthy()
    expect(screen.queryByRole('navigation', { name: 'Ações rápidas' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Despesa' })).toBeNull()
    expect(screen.queryByText('Vencidos e precisam de atenção')).toBeNull()
    expect(screen.queryByText('Nubank')).toBeNull()
    expect(screen.queryByText('Próximos planejados')).toBeNull()
    expect(screen.queryByText('Contas')).toBeNull()
    // e o Início continua com tudo isso
    cleanup()
    montar()
    expect(await screen.findByText('Vencidos e precisam de atenção')).toBeTruthy()
    expect(screen.getByRole('navigation', { name: 'Ações rápidas' })).toBeTruthy()
    expect(screen.getByText('Nubank')).toBeTruthy()
  })
  it('falha nos indicadores financeiros não derruba as demais seções do Início', async () => {
    mock.carregarPatrimonio.mockRejectedValue(new Error('rede'))
    mock.resumoDoMes.mockRejectedValue(new Error('rede'))
    montar()
    expect(await screen.findByText('Próximos planejados')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(mock.carregarPatrimonio).toHaveBeenCalled()
    expect(mock.resumoDoMes).toHaveBeenCalled()
    expect(screen.getAllByText('Indicador indisponível agora.').length).toBeGreaterThan(0)
  })
})

describe('Análises: falha isolada derruba só o bloco dela', () => {
  it('mês anterior falhou: indicadores aparecem sem a variação; nada de erro na tela', async () => {
    mock.resumoDoMes
      .mockResolvedValueOnce({ receitas: c(1215000), despesas: c(866726), resultado: c(348274), receitasPrevistas: c(0), despesasPrevistas: c(38990) })
      .mockRejectedValueOnce(new Error('rede'))
    mock.resumoDoPeriodo.mockReset()
    mock.resumoDoPeriodo.mockRejectedValue(new Error('rede'))
    montar('analises')
    expect(await screen.findByText('Despesas do mês')).toBeTruthy()
    expect(screen.getByText('−R$ 8.667,26')).toBeTruthy()
    expect(screen.queryByText(/vs set|vs out|vs nov/)).toBeNull()
    expect(screen.queryByText(/No mês passado inteiro/)).toBeNull()
    expect(screen.getByText('R$ 10.875,60')).toBeTruthy() // patrimônio segue
    expect(screen.queryByRole('alert')).toBeNull()
  })
  it('patrimônio falhou: o resumo do mês segue e o patrimônio avisa que está indisponível', async () => {
    mock.carregarPatrimonio.mockRejectedValue(new Error('rede'))
    montar('analises')
    expect(await screen.findByText('Despesas do mês')).toBeTruthy()
    expect(screen.getByText('Patrimônio indisponível agora.')).toBeTruthy()
    expect(screen.queryByText('Patrimônio líquido')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })
  it('resumo do mês falhou: patrimônio, as barras de categoria e os outros blocos seguem', async () => {
    mock.resumoDoMes.mockRejectedValue(new Error('rede'))
    montar('analises')
    expect(await screen.findByText('Resumo do mês indisponível agora. O restante da tela continua.')).toBeTruthy()
    expect(screen.getByText('R$ 10.875,60')).toBeTruthy()
    expect(screen.queryByText('Despesas do mês')).toBeNull()
    // as barras de categoria não dependem do total do mês (o % vem do próprio expenses_by_category)
    expect(screen.getByRole('list', { name: /Despesas por categoria/ })).toBeTruthy()
    expect(screen.getByText('Renda regular × despesas')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('Análises: despesas por categoria em barras (PR #167)', () => {
  const sete = [
    { categoriaId: 'g1', nome: 'Moradia', valor: c(500000), percentual: 40 },
    { categoriaId: 'g2', nome: 'Mercado', valor: c(250000), percentual: 20 },
    { categoriaId: 'g3', nome: 'Transporte', valor: c(125000), percentual: 10 },
    { categoriaId: 'g4', nome: 'Saúde', valor: c(100000), percentual: 8 },
    { categoriaId: 'g5', nome: 'Lazer', valor: c(75000), percentual: 6 },
    { categoriaId: 'g6', nome: 'Educação', valor: c(50000), percentual: 4 },
    { categoriaId: null, nome: 'Outros', valor: c(150000), percentual: 12 },
  ]
  it('pede ao banco as 6 maiores + "Outros" e desenha barras com nome, valor e % (sem rosca)', async () => {
    mock.despesasPorCategoria.mockResolvedValue(sete)
    montar('analises')
    const lista = await screen.findByRole('list', { name: /Despesas por categoria/ })
    const [fam, de, ate, top] = mock.despesasPorCategoria.mock.calls[0]
    expect([fam, top]).toEqual(['h1', 6])
    expect(de.slice(8)).toBe('01')
    expect(ate.slice(0, 7)).toBe(de.slice(0, 7))
    const linhas = within(lista).getAllByRole('listitem')
    expect(linhas).toHaveLength(7)
    expect(linhas[0].textContent).toContain('Moradia')
    expect(linhas[0].textContent).toContain('R$ 5.000,00')
    expect(linhas[0].textContent).toContain('40%')
    // "Outros" vem pronto do banco, no fim (nada somado no front)
    expect(linhas[6].textContent).toContain('Outros')
    expect(linhas[6].textContent).toContain('R$ 1.500,00')
    // largura = razão com a maior barra
    const barras = within(lista).getAllByTestId('barra-categoria')
    expect(barras[0].style.width).toBe('100%')
    expect(barras[1].style.width).toBe('50%')
    expect(screen.queryByRole('img', { name: /Despesas por categoria:/ })).toBeNull()
  })
  it('cada barra leva aos lançamentos de despesa do mês', async () => {
    mock.despesasPorCategoria.mockResolvedValue(sete)
    montar('analises')
    const lista = await screen.findByRole('list', { name: /Despesas por categoria/ })
    const mes = (mock.despesasPorCategoria.mock.calls[0][1] as string).slice(0, 7)
    const link = within(lista).getByRole('link', { name: /^Mercado: R\$ 2\.500,00, 20% das despesas/ })
    expect(link.getAttribute('href')).toBe(`/lancamentos?mes=${mes}&tipo=despesa`)
  })
  it('tem a tabela alternativa ("Ver como tabela") com os mesmos valores do banco', async () => {
    mock.despesasPorCategoria.mockResolvedValue(sete)
    montar('analises')
    const card = (await screen.findByRole('list', { name: /Despesas por categoria/ })).parentElement as HTMLElement
    expect(within(card).getByText('Ver como tabela')).toBeTruthy()
    const tabela = within(card).getByRole('table')
    expect(within(tabela).getAllByRole('row')).toHaveLength(8) // cabeçalho + 7
    expect(within(tabela).getByText('R$ 1.250,00')).toBeTruthy()
  })
  it('valores ocultos: barras e tabela mostram a máscara', async () => {
    mock.despesasPorCategoria.mockResolvedValue(sete)
    const { definirValoresOcultos } = await import('../lib/privacidade')
    definirValoresOcultos(true)
    try {
      montar('analises')
      const card = (await screen.findByRole('list', { name: /Despesas por categoria/ })).parentElement as HTMLElement
      expect(card.textContent).not.toMatch(/5\.000,00|1\.500,00/)
      expect(within(card).getAllByText('R$ ••••').length).toBeGreaterThan(0)
    } finally {
      definirValoresOcultos(false)
    }
  })
})

describe('Análises: balanço dos últimos 6 meses (PR #167)', () => {
  const linhas = [
    ['2026-06-01', 800000, 600000, 200000], ['2026-07-01', 800000, 900000, -100000], ['2026-08-01', 810000, 700000, 110000],
    ['2026-09-01', 820000, 750000, 70000], ['2026-10-01', 830000, 500000, 330000], ['2026-11-01', 100000, 50000, 50000],
  ].map(([inicio, e, s, b]) => ({ inicio: inicio as string, entradas: c(e as number), saidas: c(s as number), saldo: c(b as number), acumulado: c(0) }))
  it('pede ao banco um balde por mês (cash_flow_report, 6 meses) e mostra o resultado do banco acima de cada par', async () => {
    mock.fluxoDeCaixa.mockResolvedValue({ linhas, totalEntradas: c(0), totalSaidas: c(0) })
    montar('analises')
    const pares = await screen.findAllByTestId('par-balanco')
    expect(pares).toHaveLength(6)
    const [fam, de, ate, passo, filtros] = mock.fluxoDeCaixa.mock.calls[0]
    expect([fam, passo, filtros]).toEqual(['h1', 'month', undefined])
    expect(de.slice(8)).toBe('01')
    // de = 1º dia de 5 meses antes do mês de "ate"
    const [a1, m1] = de.split('-').map(Number), [a2, m2] = ate.split('-').map(Number)
    expect((a2 * 12 + m2) - (a1 * 12 + m1)).toBe(5)
    expect(pares[1].getAttribute('aria-label')).toBe('Julho de 2026: receitas R$ 8.000,00, despesas R$ 9.000,00, resultado -R$ 1.000,00')
    // sinal em texto, nunca só na cor
    expect(pares[1].textContent).toContain('−R$ 1 mil')
    expect(pares[0].textContent).toContain('+R$ 2 mil')
  })
  it('o resultado mostrado é o do banco, não receita − despesa feita na tela', async () => {
    mock.fluxoDeCaixa.mockResolvedValue({ linhas: [{ inicio: '2026-11-01', entradas: c(100000), saidas: c(40000), saldo: c(12345), acumulado: c(0) }], totalEntradas: c(0), totalSaidas: c(0) })
    montar('analises')
    const [par] = await screen.findAllByTestId('par-balanco')
    expect(par.getAttribute('aria-label')).toContain('resultado R$ 123,45')
  })
  it('eixo começa no zero, legenda com os dois nomes, foco mostra o tooltip e há tabela alternativa', async () => {
    mock.fluxoDeCaixa.mockResolvedValue({ linhas, totalEntradas: c(0), totalSaidas: c(0) })
    montar('analises')
    const pares = await screen.findAllByTestId('par-balanco')
    const card = pares[0].closest('div.rounded-card') as HTMLElement
    expect(within(card).getAllByText('Receitas').length).toBe(2) // legenda e tabela
    expect(within(card).getAllByText('Despesas').length).toBe(2)
    expect(within(card).getByText('R$ 0')).toBeTruthy() // marca do zero no eixo
    fireEvent.focus(pares[4])
    const dica = within(card).getByRole('status')
    expect(dica.textContent).toContain('Outubro de 2026')
    expect(dica.textContent).toContain('Resultado: R$ 3.300,00')
    const tabela = within(card).getByRole('table')
    expect(within(tabela).getAllByRole('row')).toHaveLength(7)
    expect(within(tabela).getByText('-R$ 1.000,00')).toBeTruthy()
  })
  it('se o relatório falhar, só o balanço fica indisponível', async () => {
    mock.fluxoDeCaixa.mockRejectedValue(new Error('rede'))
    montar('analises')
    const card = (await screen.findByRole('heading', { name: 'Balanço dos últimos 6 meses' })).closest('div.rounded-card') as HTMLElement
    expect(within(card).getByText('Gráfico indisponível agora.')).toBeTruthy()
    expect(screen.getByRole('list', { name: /Despesas por categoria/ })).toBeTruthy()
  })
  it('com conta em outra moeda, avisa que ela fica fora do gráfico (só reais)', async () => {
    mock.fluxoDeCaixa.mockResolvedValue({ linhas, totalEntradas: c(0), totalSaidas: c(0) })
    mock.totaisPorMoeda.mockResolvedValue([{ moeda: 'BRL', total: c(100), totalAtivas: c(100) }, { moeda: 'USD', total: c(5000), totalAtivas: c(5000) }])
    montar('analises')
    const card = (await screen.findByRole('heading', { name: 'Balanço dos últimos 6 meses' })).closest('div.rounded-card') as HTMLElement
    expect(card.textContent).toContain('Contas em outras moedas ficam fora deste gráfico.')
  })
  it('o Início não consulta o balanço', async () => {
    montar()
    await screen.findByText('Minhas contas')
    expect(mock.fluxoDeCaixa).not.toHaveBeenCalled()
  })
})

describe('Início: Minhas contas só com o saldo de hoje (pedido do dono, 05/11/2026)', () => {
  const contas = [
    { id: 'a1', nome: 'Itaú', tipo: 'checking', saldoInicial: c(0), abertura: '2026-10-01', ativa: true, saldo: c(1282030) },
    { id: 'a3', nome: 'Só no fim', tipo: 'checking', saldoInicial: c(0), abertura: '2026-10-01', ativa: true, saldo: c(0) },
  ]
  const projetado = {
    contas: [
      { id: 'a1', nome: 'Itaú', ativa: true, moeda: 'BRL', efetuado: c(1282030), planejado: c(-100000), faturas: c(0), saldo: c(1182030) },
      { id: 'a3', nome: 'Só no fim', ativa: true, moeda: 'BRL', efetuado: c(0), planejado: c(-20000), faturas: c(0), saldo: c(-20000) },
    ],
    total: { efetuado: c(1282030), planejado: c(-120000), faturas: c(0), faturasSemConta: c(0), saldo: c(1162030) },
  }
  it('cada conta mostra só o saldo de hoje, sem "Fim do mês"', async () => {
    mock.listarContas.mockResolvedValue({ contas, total: c(1282030) })
    mock.saldosProjetados.mockResolvedValue(projetado)
    montar()
    const card = (await screen.findByText('Minhas contas')).closest('div[class*="rounded"]') as HTMLElement
    const itau = within(card).getByText('Itaú').closest('li') as HTMLElement
    expect(within(itau).getByTestId('saldos-da-conta').textContent).toBe('R$ 12.820,30')
    expect(within(card).queryByText(/Fim do mês/)).toBeNull()
    // conta zerada hoje fica escondida, mesmo com planejado no mês
    expect(within(card).queryByText('Só no fim')).toBeNull()
  })
  it('valores ocultos: o saldo vira máscara', async () => {
    mock.listarContas.mockResolvedValue({ contas, total: c(1282030) })
    mock.saldosProjetados.mockResolvedValue(projetado)
    const { definirValoresOcultos } = await import('../lib/privacidade')
    definirValoresOcultos(true)
    try {
      montar()
      const card = (await screen.findByText('Minhas contas')).closest('div[class*="rounded"]') as HTMLElement
      const itau = within(card).getByText('Itaú').closest('li') as HTMLElement
      expect(within(itau).getByTestId('saldos-da-conta').textContent).toBe('R$ ••••')
    } finally {
      definirValoresOcultos(false)
    }
  })
})

describe('Análises: base dos gastos de cartão no gráfico por categoria (PR #170, migration 062)', () => {
  it('padrão: Data da fatura marcada, a consulta vai com a base da fatura e o aviso dos totais aparece', async () => {
    montar('analises')
    const grupo = await screen.findByRole('group', { name: 'Gastos de cartão com base na:' })
    expect((within(grupo).getByRole('radio', { name: 'Data da fatura' }) as HTMLInputElement).checked).toBe(true)
    expect((within(grupo).getByRole('radio', { name: 'Data da compra' }) as HTMLInputElement).checked).toBe(false)
    expect((within(grupo).getByRole('radio', { name: 'Data da parcela' }) as HTMLInputElement).checked).toBe(false)
    expect(mock.despesasPorCategoria.mock.calls[0][4]).toBe('invoice')
    expect(grupo.textContent).toContain('Cada parcela conta no mês em que a fatura do cartão fecha.')
    expect(grupo.textContent).toContain('Totais do mês e orçamento seguem a data da fatura')
  })
  it('escolher Data da compra recarrega só o gráfico com a base "purchase", troca a frase e guarda a escolha', async () => {
    montar('analises')
    const grupo = await screen.findByRole('group', { name: 'Gastos de cartão com base na:' })
    await screen.findByRole('list', { name: /Despesas por categoria/ })
    const cargasDaTela = mock.resumoDoMes.mock.calls.length
    mock.despesasPorCategoria.mockResolvedValueOnce([{ categoriaId: 'g1', nome: 'Moradia', valor: c(120000), percentual: 100 }])
    fireEvent.click(within(grupo).getByRole('radio', { name: 'Data da compra' }))
    await waitFor(() => expect(screen.getByRole('list', { name: /Despesas por categoria/ }).textContent).toContain('R$ 1.200,00'))
    const chamadas = mock.despesasPorCategoria.mock.calls
    const ultima = chamadas[chamadas.length - 1]
    expect(ultima?.[3]).toBe(6)
    expect(ultima?.[4]).toBe('purchase')
    expect(mock.resumoDoMes.mock.calls.length).toBe(cargasDaTela)
    expect(grupo.textContent).toContain('A compra conta inteira')
    expect(grupo.textContent).toContain('Totais do mês e orçamento seguem a data da fatura')
    expect(window.localStorage.getItem('tudoazul:base-gastos-cartao')).toBe('purchase')
  })
  it('a base guardada no aparelho (Data da parcela) já vale na primeira carga; valor inválido volta para a fatura', async () => {
    window.localStorage.setItem('tudoazul:base-gastos-cartao', 'installment')
    montar('analises')
    const grupo = await screen.findByRole('group', { name: 'Gastos de cartão com base na:' })
    expect((within(grupo).getByRole('radio', { name: 'Data da parcela' }) as HTMLInputElement).checked).toBe(true)
    await waitFor(() => expect(mock.despesasPorCategoria).toHaveBeenCalled())
    expect(mock.despesasPorCategoria.mock.calls[0][4]).toBe('installment')
    cleanup()
    mock.despesasPorCategoria.mockClear()
    window.localStorage.setItem('tudoazul:base-gastos-cartao', 'vencimento')
    montar('analises')
    await screen.findByRole('group', { name: 'Gastos de cartão com base na:' })
    await waitFor(() => expect(mock.despesasPorCategoria).toHaveBeenCalled())
    expect(mock.despesasPorCategoria.mock.calls[0][4]).toBe('invoice')
  })
  it('o seletor não aparece no Início', async () => {
    montar('inicio')
    await screen.findByText(/João Marcos/)
    expect(screen.queryByRole('group', { name: 'Gastos de cartão com base na:' })).toBeNull()
  })
})
