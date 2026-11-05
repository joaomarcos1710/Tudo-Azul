// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mock = vi.hoisted(() => ({
  fluxoDeCaixa: vi.fn(),
  listarContas: vi.fn(),
  listarMembros: vi.fn(),
  resumoPorMoeda: vi.fn(),
  saldosNasDatas: vi.fn(),
}))
vi.mock('../lib/FamiliaContext', () => ({
  useFamilia: () => ({ familia: { id: 'h1', nome: 'Casa', papel: 'owner' }, carregando: false, erro: false, recarregar: vi.fn() }),
}))
vi.mock('../lib/fluxoCaixa', async (o) => ({ ...(await o<typeof import('../lib/fluxoCaixa')>()), fluxoDeCaixa: mock.fluxoDeCaixa }))
vi.mock('../lib/contas', async (o) => ({ ...(await o<typeof import('../lib/contas')>()), listarContas: mock.listarContas }))
vi.mock('../lib/familia', async (o) => ({ ...(await o<typeof import('../lib/familia')>()), listarMembros: mock.listarMembros }))
vi.mock('../lib/lancamentos', async (o) => ({ ...(await o<typeof import('../lib/lancamentos')>()), resumoPorMoeda: mock.resumoPorMoeda }))
vi.mock('../lib/saldoProjetado', async (o) => ({ ...(await o<typeof import('../lib/saldoProjetado')>()), saldosNasDatas: mock.saldosNasDatas }))

import { EntradasSaidas, mesAbreviado } from './EntradasSaidas'
import { fimDoBalde, periodoDoFluxo } from '../lib/fluxoCaixa'
import type { Cents } from '../lib/format'

const c = (n: number) => n as Cents
const ultimaChamada = () => mock.fluxoDeCaixa.mock.calls[mock.fluxoDeCaixa.mock.calls.length - 1]

const fluxo = {
  linhas: [
    { inicio: '2026-09-01', entradas: c(100000), saidas: c(40000), saldo: c(60000), acumulado: c(60000) },
    { inicio: '2026-10-01', entradas: c(50000), saidas: c(70000), saldo: c(-20000), acumulado: c(40000) },
  ],
  totalEntradas: c(150000),
  totalSaidas: c(110000),
}

const contasMuitas = [
  { id: 'a1', nome: 'Banco', ativa: true }, { id: 'a2', nome: 'Carteira', ativa: false },
  ...['Nubank', 'Inter', 'Itaú', 'Caixa', 'Poupança'].map((nome, i) => ({ id: `b${i}`, nome, ativa: true })),
  { id: 'okx', nome: 'OKX', ativa: false },
]

beforeEach(() => {
  mock.fluxoDeCaixa.mockResolvedValue(fluxo)
  mock.listarContas.mockResolvedValue({ contas: [
    { id: 'a1', nome: 'Banco', ativa: true }, { id: 'a2', nome: 'Carteira', ativa: false }, { id: 'a3', nome: 'Poupança', ativa: true },
  ], total: c(0) })
  mock.listarMembros.mockResolvedValue([{ userId: 'u1', nome: 'João', papel: 'owner' }, { userId: 'u2', nome: 'Ana', papel: 'member' }])
  mock.resumoPorMoeda.mockResolvedValue([])
  mock.saldosNasDatas.mockResolvedValue([c(500000), c(-123456)])
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

async function abrirFiltros(u: ReturnType<typeof userEvent.setup>) {
  await u.click(screen.getByRole('button', { name: /^Filtros/ }))
  return screen.getByRole('dialog', { name: 'Filtros' })
}

describe('periodoDoFluxo e fimDoBalde (só datas)', () => {
  it('diário e semanal: o mês escolhido; mensal: 12 meses que terminam nele', () => {
    expect(periodoDoFluxo('2026-02', 'day')).toEqual(['2026-02-01', '2026-02-28'])
    expect(periodoDoFluxo('2026-02', 'week')).toEqual(['2026-02-01', '2026-02-28'])
    expect(periodoDoFluxo('2026-10', 'month')).toEqual(['2025-11-01', '2026-10-31'])
  })
  it('o fim de cada período: o dia; o domingo; o último dia do mês; nunca depois do fim do relatório', () => {
    expect(fimDoBalde('2026-10-05', 'day', '2026-10-31')).toBe('2026-10-05')
    expect(fimDoBalde('2026-10-05', 'week', '2026-10-31')).toBe('2026-10-11')
    expect(fimDoBalde('2026-10-26', 'week', '2026-10-31')).toBe('2026-10-31') // a última semana atravessa o mês
    expect(fimDoBalde('2026-02-01', 'month', '2026-10-31')).toBe('2026-02-28')
    expect(fimDoBalde('2025-12-29', 'week', '2026-01-31')).toBe('2026-01-04') // virada de ano
  })
  it('mês abreviado para celular e iPad em retrato', () => {
    expect(mesAbreviado('2025-12')).toBe('dez/25')
    expect(mesAbreviado('2026-03')).toBe('mar/26')
  })
})

describe('Entradas x Saídas: tabela', () => {
  it('mostra os valores e os totais exatamente como o banco devolveu (o front não soma)', async () => {
    render(<EntradasSaidas />)
    const tabela = await screen.findByRole('table')
    const linhaTotal = within(tabela).getByText('Total').closest('tr') as HTMLElement
    expect(linhaTotal.textContent).toMatch(/1\.500,00/)
    expect(linhaTotal.textContent).toMatch(/1\.100,00/)
    expect(linhaTotal.textContent).toMatch(/400,00/) // o último acumulado, não uma subtração feita no front
    // por extenso no computador e abreviado no celular/iPad retrato (as duas versões no DOM, o CSS escolhe)
    expect(within(tabela).getByText('Setembro de 2026').className).toMatch(/hidden lg:inline/)
    expect(within(tabela).getByText('set/26').className).toMatch(/lg:hidden/)
  })

  it('colunas Período | Entradas | Saídas | Resultado | Saldo, sem Acumulado por padrão', async () => {
    render(<EntradasSaidas />)
    const tabela = await screen.findByRole('table')
    expect(await within(tabela).findByText('R$ 5.000,00')).toBeTruthy()
    const cabecalhos = within(tabela).getAllByRole('columnheader').map((h) => h.textContent)
    expect(cabecalhos).toEqual(['Período', 'Entradas', 'Saídas', 'Resultado', 'Saldo'])
  })

  it('cada valor fica numa linha só (nowrap) com algarismos alinhados; negativo com "−" tipográfico e em vermelho', async () => {
    render(<EntradasSaidas />)
    const tabela = await screen.findByRole('table')
    await within(tabela).findByText('R$ 5.000,00')
    const valores = within(tabela).getAllByText(/R\$/)
    expect(valores).toHaveLength(11) // 2 períodos × 4 colunas + 3 no total
    for (const v of valores) expect(v.className).toMatch(/whitespace-nowrap.*tabular-nums/)
    const negativo = within(tabela).getByText('−R$ 200,00')
    expect(negativo.className).toMatch(/text-negativo/)
    expect(within(tabela).getByText('−R$ 1.234,56').className).toMatch(/text-negativo/)
    expect(within(tabela).queryByText('-R$ 200,00')).toBeNull() // nada de hífen
    expect(within(tabela).getByText('R$ 600,00').className).not.toMatch(/text-negativo/)
  })

  it('a linha de total fica presa no pé da tabela e destacada', async () => {
    render(<EntradasSaidas />)
    const tabela = await screen.findByRole('table')
    const pe = tabela.querySelector('tfoot')!
    expect(pe.className).toMatch(/sticky bottom-0/)
    expect(within(pe).getByText('Total')).toBeTruthy()
  })
})

describe('Entradas x Saídas: saldo das contas (balance_totals_projected)', () => {
  it('pede ao banco o saldo no último dia de cada período, só pagos por padrão, e mostra o que veio', async () => {
    render(<EntradasSaidas />)
    const tabela = await screen.findByRole('table')
    expect(await within(tabela).findByText('R$ 5.000,00')).toBeTruthy()
    expect(mock.saldosNasDatas).toHaveBeenCalledWith('h1', ['2026-09-30', '2026-10-31'], false)
    expect(screen.getByTestId('grafico-saldo')).toBeTruthy()
  })

  it('com conta escolhida o saldo sai (a função do banco não filtra por conta) e a tela explica', async () => {
    const u = userEvent.setup()
    render(<EntradasSaidas />)
    await screen.findByText('R$ 5.000,00')
    mock.saldosNasDatas.mockClear()
    const folha = await abrirFiltros(u)
    await u.click(within(folha).getByRole('checkbox', { name: 'Banco' }))
    await u.click(within(folha).getByRole('button', { name: 'Aplicar' }))
    const tabela = await screen.findByRole('table')
    expect(within(tabela).queryByRole('columnheader', { name: 'Saldo' })).toBeNull()
    expect(screen.queryByTestId('grafico-saldo')).toBeNull()
    expect(screen.getByText(/O saldo aparece só com todas as contas/)).toBeTruthy()
    expect(mock.saldosNasDatas).not.toHaveBeenCalled()
  })

  it('se o saldo falhar, a coluna some e o relatório segue', async () => {
    mock.saldosNasDatas.mockRejectedValue(new Error('rede'))
    render(<EntradasSaidas />)
    expect(await screen.findByText(/O saldo não pôde ser calculado agora/)).toBeTruthy()
    expect(within(screen.getByRole('table')).queryByRole('columnheader', { name: 'Saldo' })).toBeNull()
    expect(screen.getByText('R$ 1.500,00')).toBeTruthy()
  })
})

describe('Entradas x Saídas: gráfico', () => {
  it('barras de entradas e saídas por período acima da tabela, sem repetir o "Ver como tabela"', async () => {
    render(<EntradasSaidas />)
    const tabela = await screen.findByRole('table')
    const pares = screen.getAllByTestId('par-balanco')
    expect(pares).toHaveLength(2)
    expect(pares[0].getAttribute('aria-label')).toBe('Setembro de 2026: entradas R$ 1.000,00, saídas R$ 400,00, resultado R$ 600,00')
    // o gráfico vem antes da tabela, e a tabela é a alternativa acessível
    expect(pares[0].compareDocumentPosition(tabela) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByText('Ver como tabela')).toBeNull()
    expect(screen.getByRole('group', { name: /Entradas e saídas de cada mês.*tabela abaixo/ })).toBeTruthy()
  })
})

describe('Entradas x Saídas: folha de filtros', () => {
  it('pede ao banco o mensal por padrão, sem filtros; o resumo diz isso', async () => {
    render(<EntradasSaidas />)
    await screen.findByRole('table')
    const [fam, de, ate, passo, filtros] = mock.fluxoDeCaixa.mock.calls[0]
    expect(fam).toBe('h1')
    expect(passo).toBe('month')
    expect(de < ate).toBe(true)
    expect(filtros).toEqual({ contas: [], membro: '', incluirNaoPagos: false })
    expect(screen.getByTestId('resumo-filtros').textContent).toBe('Mensal · Só pagos · Todas as contas')
    // sem muro de caixas na tela: as contas só aparecem dentro da folha
    expect(screen.queryByRole('checkbox', { name: 'Banco' })).toBeNull()
  })

  it('contas: "Todas" por padrão, conta as escolhidas e esconde as arquivadas atrás de "Mostrar arquivadas"', async () => {
    const u = userEvent.setup()
    render(<EntradasSaidas />)
    await screen.findByRole('table')
    const folha = await abrirFiltros(u)
    expect(within(folha).getByRole('button', { name: 'Todas as contas' }).getAttribute('aria-pressed')).toBe('true')
    expect(within(folha).getByTestId('contagem-contas').textContent).toMatch(/todas/)
    expect(within(folha).queryByRole('checkbox', { name: /Carteira/ })).toBeNull()
    await u.click(within(folha).getByRole('checkbox', { name: 'Mostrar arquivadas (1)' }))
    expect(within(folha).getByRole('checkbox', { name: /Carteira/ })).toBeTruthy()
    await u.click(within(folha).getByRole('checkbox', { name: 'Banco' }))
    await u.click(within(folha).getByRole('checkbox', { name: 'Poupança' }))
    expect(within(folha).getByTestId('contagem-contas').textContent).toMatch(/2 escolhidas/)
    expect(within(folha).getByRole('button', { name: 'Todas as contas' }).getAttribute('aria-pressed')).toBe('false')
    await u.click(within(folha).getByRole('button', { name: 'Aplicar' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(ultimaChamada()[4]).toEqual({ contas: ['a1', 'a3'], membro: '', incluirNaoPagos: false })
    expect(screen.getByTestId('resumo-filtros').textContent).toBe('Mensal · Só pagos · 2 contas')
  })

  it('com muitas contas há busca, e "Todas as contas" limpa a escolha', async () => {
    mock.listarContas.mockResolvedValue({ contas: contasMuitas, total: c(0) })
    const u = userEvent.setup()
    render(<EntradasSaidas />)
    await screen.findByRole('table')
    const folha = await abrirFiltros(u)
    await u.type(within(folha).getByRole('searchbox', { name: 'Buscar conta' }), 'nu')
    expect(within(folha).getAllByRole('checkbox').filter((x) => x.closest('li'))).toHaveLength(1)
    await u.click(within(folha).getByRole('checkbox', { name: 'Nubank' }))
    expect(within(folha).getByTestId('contagem-contas').textContent).toMatch(/1 escolhida/)
    await u.click(within(folha).getByRole('button', { name: 'Todas as contas' }))
    expect(within(folha).getByTestId('contagem-contas').textContent).toMatch(/todas/)
  })

  it('periodicidade, "Todos" (não pagos) e autor só valem ao Aplicar', async () => {
    const u = userEvent.setup()
    render(<EntradasSaidas />)
    await screen.findByRole('table')
    const chamadas = mock.fluxoDeCaixa.mock.calls.length
    const folha = await abrirFiltros(u)
    await u.click(within(folha).getByRole('button', { name: 'Semanal' }))
    await u.click(within(folha).getByRole('button', { name: 'Todos' }))
    await u.selectOptions(within(folha).getByLabelText('Lançado por'), 'u2')
    await u.click(within(folha).getByRole('checkbox', { name: 'Banco' }))
    expect(mock.fluxoDeCaixa.mock.calls.length).toBe(chamadas) // nada muda antes de aplicar
    await u.click(within(folha).getByRole('button', { name: 'Aplicar' }))
    const ultima = ultimaChamada()
    expect(ultima[3]).toBe('week')
    expect(ultima[4]).toEqual({ contas: ['a1'], membro: 'u2', incluirNaoPagos: true })
    expect(screen.getByTestId('resumo-filtros').textContent).toBe('Semanal · Pagos e não pagos · Banco · Lançado por Ana')
  })

  it('Esc e Cancelar fecham sem aplicar, e o foco volta ao botão Filtros', async () => {
    const u = userEvent.setup()
    render(<EntradasSaidas />)
    await screen.findByRole('table')
    const botao = screen.getByRole('button', { name: /^Filtros/ })
    let folha = await abrirFiltros(u)
    expect(folha.contains(document.activeElement)).toBe(true) // o foco entrou na folha
    await u.click(within(folha).getByRole('button', { name: 'Diário' }))
    await u.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(botao)
    expect(ultimaChamada()[3]).toBe('month')
    folha = await abrirFiltros(u)
    expect(within(folha).getByRole('button', { name: 'Mensal' }).getAttribute('aria-pressed')).toBe('true') // rascunho descartado
    await u.click(within(folha).getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('"Mostrar acumulado" acrescenta a coluna, com o rótulo dizendo de quando a soma começa', async () => {
    const u = userEvent.setup()
    render(<EntradasSaidas />)
    await screen.findByRole('table')
    expect(screen.queryByRole('columnheader', { name: 'Acumulado' })).toBeNull()
    const folha = await abrirFiltros(u)
    await u.click(within(folha).getByRole('checkbox', { name: /Mostrar acumulado/ }))
    await u.click(within(folha).getByRole('button', { name: 'Aplicar' }))
    const tabela = await screen.findByRole('table')
    expect(within(tabela).getByRole('columnheader', { name: 'Acumulado' })).toBeTruthy()
    expect(screen.getByText('Acumulado: soma dos resultados desde setembro de 2026 (não é saldo de conta).')).toBeTruthy()
    // acumulado do banco na última linha (R$ 400,00), igual ao da saída de setembro
    expect(within(tabela).getAllByText('R$ 400,00', { selector: 'tbody span' })).toHaveLength(2)
  })

  it('avisa o que fica de fora quando se filtra por conta, e por autor com não pagos', async () => {
    const u = userEvent.setup()
    render(<EntradasSaidas />)
    await screen.findByRole('table')
    expect(screen.queryByText(/não têm conta/)).toBeNull()
    let folha = await abrirFiltros(u)
    await u.click(within(folha).getByRole('checkbox', { name: 'Banco' }))
    await u.click(within(folha).getByRole('button', { name: 'Aplicar' }))
    expect(screen.getByText(/não têm conta/)).toBeTruthy()
    expect(screen.queryByText(/não têm autor/)).toBeNull()
    folha = await abrirFiltros(u)
    await u.click(within(folha).getByRole('button', { name: 'Todos' }))
    await u.selectOptions(within(folha).getByLabelText('Lançado por'), 'u1')
    await u.click(within(folha).getByRole('button', { name: 'Aplicar' }))
    expect(screen.getByText(/não têm autor/)).toBeTruthy()
  })

  it('sem o filtro de membros quando a família tem uma pessoa só', async () => {
    mock.listarMembros.mockResolvedValue([{ userId: 'u1', nome: 'João', papel: 'owner' }])
    const u = userEvent.setup()
    render(<EntradasSaidas />)
    await screen.findByRole('table')
    const folha = await abrirFiltros(u)
    expect(within(folha).queryByLabelText('Lançado por')).toBeNull()
  })

  it('trocar o filtro tira a tabela antiga enquanto o número novo não chega', async () => {
    const u = userEvent.setup()
    render(<EntradasSaidas />)
    expect((await screen.findAllByText('R$ 1.500,00')).length).toBeGreaterThan(0)
    mock.fluxoDeCaixa.mockReturnValueOnce(new Promise(() => {}))
    const folha = await abrirFiltros(u)
    await u.selectOptions(within(folha).getByLabelText('Lançado por'), 'u2')
    await u.click(within(folha).getByRole('button', { name: 'Aplicar' }))
    expect(screen.getByRole('status').textContent).toMatch(/Carregando/)
    expect(screen.queryByText('R$ 1.500,00')).toBeNull()
  })
})

describe('Entradas x Saídas: mês e erros', () => {
  it('carrossel de mês: setas e os meses dos lados refazem a consulta', async () => {
    const u = userEvent.setup()
    render(<EntradasSaidas />)
    await screen.findByRole('table')
    const antes = ultimaChamada()[2]
    await u.click(screen.getByRole('button', { name: 'Mês anterior' }))
    const depois = ultimaChamada()[2]
    expect(depois < antes).toBe(true)
    const lados = within(screen.getByRole('group', { name: 'Mês do relatório' })).getAllByRole('button', { name: /^Ir para/ })
    expect(lados).toHaveLength(2)
    await u.click(lados[1])
    expect(ultimaChamada()[2]).toBe(antes)
  })

  it('erro do banco (ex.: migration ausente) mostra o aviso e não derruba a tela', async () => {
    mock.fluxoDeCaixa.mockRejectedValue(new Error('function public.cash_flow_report does not exist'))
    render(<EntradasSaidas />)
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })
})

describe('Entradas x Saídas: multimoeda F2 (migration 056)', () => {
  it('o filtro de contas só oferece contas em reais (o relatório é em reais)', async () => {
    mock.listarContas.mockResolvedValue({ contas: [
      { id: 'a1', nome: 'Banco', ativa: true, moeda: 'BRL' }, { id: 'u1', nome: 'Conta em dólar', ativa: true, moeda: 'USD' },
    ], total: c(0) })
    const u = userEvent.setup()
    render(<EntradasSaidas />)
    await screen.findByRole('table')
    const folha = await abrirFiltros(u)
    expect(await within(folha).findByRole('checkbox', { name: 'Banco' })).toBeTruthy()
    expect(within(folha).queryByRole('checkbox', { name: 'Conta em dólar' })).toBeNull()
  })

  it('mostra as outras moedas à parte, do banco, no mesmo período; com filtro de conta o bloco some', async () => {
    mock.resumoPorMoeda.mockResolvedValue([{ moeda: 'USD', receitas: c(100000), despesas: c(4025), resultado: c(95975) }])
    const u = userEvent.setup()
    render(<EntradasSaidas />)
    const bloco = await screen.findByRole('group', { name: 'Em outras moedas' })
    expect(bloco.textContent).toMatch(/\+US\$\s*1\.000,00/)
    expect(bloco.textContent).toMatch(/=\s*US\$\s*959,75/)
    const [de, ate] = ultimaChamada().slice(1, 3)
    expect(mock.resumoPorMoeda).toHaveBeenLastCalledWith('h1', de, ate)
    // os totais em reais continuam os do banco (cash_flow_report), sem o dólar
    expect(within(screen.getByRole('table')).getByText('Total').closest('tr')!.textContent).toMatch(/1\.500,00/)
    const folha = await abrirFiltros(u)
    await u.click(within(folha).getByRole('checkbox', { name: 'Banco' }))
    await u.click(within(folha).getByRole('button', { name: 'Aplicar' }))
    expect(screen.queryByRole('group', { name: 'Em outras moedas' })).toBeNull()
  })
})
