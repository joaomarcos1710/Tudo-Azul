// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mock = vi.hoisted(() => ({
  serieFluxo: vi.fn(),
  listarContas: vi.fn(),
  listarMembros: vi.fn(),
  resumoPorMoeda: vi.fn(),
}))
vi.mock('../lib/FamiliaContext', () => ({
  useFamilia: () => ({ familia: { id: 'h1', nome: 'Casa', papel: 'owner' }, carregando: false, erro: false, recarregar: vi.fn() }),
}))
vi.mock('../lib/fluxoCaixa', async (o) => ({ ...(await o<typeof import('../lib/fluxoCaixa')>()), serieFluxo: mock.serieFluxo }))
// "hoje" fixo: 05/11/2026 (quinta-feira)
vi.mock('../lib/contas', async (o) => ({ ...(await o<typeof import('../lib/contas')>()), listarContas: mock.listarContas, hojeSP: () => '2026-11-05' }))
vi.mock('../lib/familia', async (o) => ({ ...(await o<typeof import('../lib/familia')>()), listarMembros: mock.listarMembros }))
vi.mock('../lib/lancamentos', async (o) => ({ ...(await o<typeof import('../lib/lancamentos')>()), resumoPorMoeda: mock.resumoPorMoeda }))

import { EntradasSaidas, aparenciaValor } from './EntradasSaidas'
import type { LinhaSerie, SerieFluxo } from '../lib/fluxoCaixa'
import type { Cents } from '../lib/format'
import { ajustarDivisao, divisoes, erroPeriodoLivre, moverPeriodo, periodoDoAno, periodoDoMes, rotuloPeriodo, segundaDaSemana, somarDias, ultimosMeses } from '../lib/periodoRelatorio'
import type { Divisao } from '../lib/periodoRelatorio'
import { limitesDoMes, somarMeses } from '../lib/lancamentos'

const c = (n: number) => n as Cents
const ultimaChamada = () => mock.serieFluxo.mock.calls[mock.serieFluxo.mock.calls.length - 1]

/**
 * Banco de mentira: devolve as linhas que cash_flow_series devolveria para o período e a divisão (os rótulos), com
 * valores fixos. As contagens de verdade são testadas no pgTAP (66_cash_flow_series); aqui importa a tela mostrar as
 * linhas que o banco manda, só do período pedido.
 */
function linhasDoBanco(de: string, ate: string, divisao: Divisao, saldo: boolean = true): SerieFluxo {
  const inicios: [string, string][] = []
  if (divisao === 'total') inicios.push([de, ate])
  else if (divisao === 'day') for (let d = de; d <= ate; d = somarDias(d, 1)) inicios.push([d, d])
  else if (divisao === 'week') for (let s = segundaDaSemana(de); s <= ate; s = somarDias(s, 7)) inicios.push([s, somarDias(s, 6)])
  else for (let m = de.slice(0, 7); m <= ate.slice(0, 7); m = somarMeses(m, 1)) inicios.push(limitesDoMes(m))
  const linhas: LinhaSerie[] = inicios.map(([inicio, fim], i) => ({
    inicio, fim,
    entradas: c(i === 0 ? 100000 : 0), saidas: c(i === 1 ? 160000 : 0), resultado: c(i === 0 ? 100000 : i === 1 ? -160000 : 0),
    saldo: saldo ? c(i === 0 ? 500000 : -123456) : null,
  }))
  return { linhas, totalEntradas: c(100000), totalSaidas: c(160000), totalResultado: c(-60000) }
}

const contasMuitas = [
  { id: 'a1', nome: 'Banco', ativa: true }, { id: 'a2', nome: 'Carteira', ativa: false },
  ...['Nubank', 'Inter', 'Itaú', 'Caixa', 'Poupança'].map((nome, i) => ({ id: `b${i}`, nome, ativa: true })),
  { id: 'okx', nome: 'OKX', ativa: false },
]

beforeEach(() => {
  mock.serieFluxo.mockImplementation(async (_h: string, de: string, ate: string, divisao: Divisao, f: { contas?: string[]; membro?: string }) =>
    linhasDoBanco(de, ate, divisao, !(f.contas?.length) && !f.membro))
  mock.listarContas.mockResolvedValue({ contas: [
    { id: 'a1', nome: 'Banco', ativa: true }, { id: 'a2', nome: 'Carteira', ativa: false }, { id: 'a3', nome: 'Poupança', ativa: true },
  ], total: c(0) })
  mock.listarMembros.mockResolvedValue([{ userId: 'u1', nome: 'João', papel: 'owner' }, { userId: 'u2', nome: 'Ana', papel: 'member' }])
  mock.resumoPorMoeda.mockResolvedValue([])
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

async function abrirFiltros(u: ReturnType<typeof userEvent.setup>) {
  await u.click(screen.getByRole('button', { name: /^Filtros/ }))
  return screen.getByRole('dialog', { name: 'Filtros' })
}
async function abrirPeriodo(u: ReturnType<typeof userEvent.setup>) {
  await u.click(screen.getByRole('button', { name: /Trocar período/ }))
  return screen.getByRole('dialog', { name: 'Período' })
}
const linhas = () => screen.getAllByTestId('linha-fluxo')
const rotulos = () => linhas().map((l) => within(l).getByRole('rowheader').textContent)
const divisao = (nome: string) => within(screen.getByRole('group', { name: 'Divisão do período' })).getByRole('button', { name: new RegExp(`^${nome}`) })

describe('período do relatório (só datas)', () => {
  it('atalhos: este mês, últimos N meses cheios, este ano; as setas andam um período do mesmo tamanho', () => {
    expect(periodoDoMes('2026-11')).toEqual({ tipo: 'mes', de: '2026-11-01', ate: '2026-11-30' })
    expect(ultimosMeses('2026-11-05', 3)).toEqual({ tipo: 'meses', de: '2026-09-01', ate: '2026-11-30' })
    expect(moverPeriodo(periodoDoMes('2026-01'), -1)).toEqual(periodoDoMes('2025-12'))
    expect(moverPeriodo(periodoDoAno(2026), 1)).toEqual(periodoDoAno(2027))
    expect(moverPeriodo(ultimosMeses('2026-11-05', 3), -1)).toEqual({ tipo: 'meses', de: '2026-06-01', ate: '2026-08-31' })
    expect(moverPeriodo({ tipo: 'semana', de: '2026-11-02', ate: '2026-11-08' }, 1)).toEqual({ tipo: 'semana', de: '2026-11-09', ate: '2026-11-15' })
    expect(moverPeriodo({ tipo: 'livre', de: '2026-11-01', ate: '2026-11-10' }, 1)).toEqual({ tipo: 'livre', de: '2026-11-11', ate: '2026-11-20' })
  })
  it('nomes no seletor', () => {
    expect(rotuloPeriodo(periodoDoMes('2026-11'))).toBe('Novembro de 2026')
    expect(rotuloPeriodo(periodoDoAno(2026))).toBe('2026')
    expect(rotuloPeriodo(ultimosMeses('2026-11-05', 3))).toBe('Set a Nov de 2026')
    expect(rotuloPeriodo(ultimosMeses('2026-01-05', 3))).toBe('Nov/25 a Jan/26')
    expect(rotuloPeriodo({ tipo: 'dia', de: '2026-11-05', ate: '2026-11-05' })).toBe('05/11/2026')
    expect(rotuloPeriodo({ tipo: 'livre', de: '2026-10-01', ate: '2026-11-15' })).toBe('01/10 a 15/11/2026')
  })
  it('divisões apagadas: mensal num mês só; semanal numa semana só; diário acima de 62 dias', () => {
    const ativas = (p: Parameters<typeof divisoes>[0]) => divisoes(p).filter((o) => o.ativa).map((o) => o.chave)
    expect(ativas(periodoDoMes('2026-11'))).toEqual(['day', 'week', 'total'])
    expect(ativas({ tipo: 'dia', de: '2026-11-05', ate: '2026-11-05' })).toEqual(['day', 'total'])
    expect(ativas(periodoDoAno(2026))).toEqual(['week', 'month', 'total'])
    expect(ativas({ tipo: 'livre', de: '2026-11-01', ate: '2027-01-01' })).toEqual(['day', 'week', 'month', 'total']) // 62 dias
    expect(ativas({ tipo: 'livre', de: '2026-11-01', ate: '2027-01-02' })).toEqual(['week', 'month', 'total']) // 63 dias
    expect(ajustarDivisao('month', periodoDoMes('2026-11'))).toBe('day')
    expect(ajustarDivisao('day', periodoDoAno(2026))).toBe('month')
    expect(ajustarDivisao('week', periodoDoAno(2026))).toBe('week')
  })
  it('"Escolher período" confere as datas', () => {
    expect(erroPeriodoLivre('2026-11-01', '2026-11-30')).toBeNull()
    expect(erroPeriodoLivre('2026-11-30', '2026-11-01')).toMatch(/inicial não pode ser depois/)
    expect(erroPeriodoLivre('', '2026-11-01')).toMatch(/Escolha a data/)
    expect(erroPeriodoLivre('2010-01-01', '2026-11-01')).toMatch(/até 10 anos/)
  })
})

describe('Entradas x Saídas: o período escolhido, fatiado pela divisão', () => {
  it('abre em Novembro de 2026, diário: pede ao banco SÓ novembro e mostra as 30 linhas de 01/11 a 30/11', async () => {
    render(<EntradasSaidas />)
    await screen.findByRole('table')
    expect(ultimaChamada().slice(0, 4)).toEqual(['h1', '2026-11-01', '2026-11-30', 'day'])
    expect(mock.serieFluxo).toHaveBeenCalledTimes(1) // uma chamada só: valores e saldo juntos
    expect(linhas()).toHaveLength(30)
    expect(rotulos()[0]).toBe('01/11')
    expect(rotulos()[29]).toBe('30/11')
    expect(screen.getByText('Entradas x Saídas · Novembro de 2026')).toBeTruthy()
    // a dica antiga ("Mensal mostra 12 meses até o mês escolhido") não existe mais
    expect(screen.queryByText(/12 meses até/)).toBeNull()
  })

  it('auditoria 5h (axe): a caixa rolável da tabela recebe foco pelo teclado e tem nome', async () => {
    render(<EntradasSaidas />)
    await screen.findByRole('table')
    const caixa = screen.getByTestId('caixa-tabela')
    expect(caixa.getAttribute('tabindex')).toBe('0')
    expect(screen.getByRole('region', { name: 'Tabela de entradas e saídas por dia' })).toBe(caixa)
  })

  it('período da página (o mesmo da aba Contas): usa o recebido, começa numa divisão que vale nele e avisa a página ao trocar', async () => {
    const u = userEvent.setup()
    const aoMudar = vi.fn()
    render(<EntradasSaidas periodo={periodoDoAno(2026)} aoMudarPeriodo={aoMudar} />)
    await screen.findByRole('table')
    // o ano não cabe no diário: começa no mensal
    expect(ultimaChamada().slice(1, 4)).toEqual(['2026-01-01', '2026-12-31', 'month'])
    await u.click(screen.getByRole('button', { name: 'Próximo período' }))
    expect(aoMudar).toHaveBeenCalledWith(periodoDoAno(2027))
  })

  it('novembro semanal: as 6 semanas que tocam novembro, de "26/10 a 01/11" a "30/11 a 06/12"; o período pedido continua novembro', async () => {
    const u = userEvent.setup()
    render(<EntradasSaidas />)
    await screen.findByRole('table')
    await u.click(divisao('Semanal'))
    expect(ultimaChamada().slice(1, 4)).toEqual(['2026-11-01', '2026-11-30', 'week'])
    await screen.findByText('26/10 a 01/11')
    const longos = linhas().map((l) => l.querySelector('th .hidden')!.textContent)
    expect(longos).toEqual(['26/10 a 01/11', '02/11 a 08/11', '09/11 a 15/11', '16/11 a 22/11', '23/11 a 29/11', '30/11 a 06/12'])
    expect(screen.getByText('26/10–01/11').className).toMatch(/lg:hidden/) // curto no celular e no iPad
    expect(screen.getByText(/na primeira e na última, só os dias dentro do período/)).toBeTruthy()
  })

  it('novembro acumulado: uma linha só, "Novembro de 2026", sem linha de total e sem a área do saldo', async () => {
    const u = userEvent.setup()
    render(<EntradasSaidas />)
    await screen.findByRole('table')
    await u.click(divisao('Acumulado'))
    expect(ultimaChamada()[3]).toBe('total')
    await within(screen.getByRole('table')).findByText('Nov de 2026')
    expect(linhas()).toHaveLength(1)
    expect(within(screen.getByRole('table')).getByText('Nov de 2026').className).toMatch(/lg:hidden/) // "Novembro de 2026" no computador
    expect(screen.getByRole('table').querySelector('tbody th')!.textContent).toMatch(/Novembro de 2026/)
    expect(screen.getByRole('table').querySelector('tfoot')).toBeNull()
    expect(screen.getAllByTestId('par-balanco')).toHaveLength(1)
    expect(screen.queryByTestId('area-saldo')).toBeNull()
  })

  it('"Este ano": mensal com os 12 meses de 2026 (o diário fica apagado e a divisão passa sozinha para mensal); acumulado = "2026"', async () => {
    const u = userEvent.setup()
    render(<EntradasSaidas />)
    await screen.findByRole('table')
    const menu = await abrirPeriodo(u)
    await u.click(within(menu).getByRole('button', { name: /^Este ano/ }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(ultimaChamada().slice(1, 4)).toEqual(['2026-01-01', '2026-12-31', 'month'])
    await screen.findByText('Janeiro de 2026')
    expect(linhas()).toHaveLength(12)
    expect(divisao('Diário').getAttribute('aria-disabled')).toBe('true')
    await u.click(divisao('Acumulado'))
    expect(await screen.findByRole('rowheader', { name: '2026' })).toBeTruthy()
    expect(linhas()).toHaveLength(1)
    expect(screen.getByTestId('resumo-filtros').textContent).toMatch(/^Acumulado · /)
  })

  it('anos: de "2026" a seta vai para "2025", com os 12 meses de 2025 no mensal', async () => {
    const u = userEvent.setup()
    render(<EntradasSaidas />)
    await screen.findByRole('table')
    await u.click(within(await abrirPeriodo(u)).getByRole('button', { name: /^Este ano/ }))
    await u.click(screen.getByRole('button', { name: 'Período anterior' }))
    expect(screen.getByRole('button', { name: /Trocar período/ }).textContent).toMatch(/^2025/)
    expect(ultimaChamada().slice(1, 4)).toEqual(['2025-01-01', '2025-12-31', 'month'])
    await screen.findByText('Dezembro de 2025')
    expect(linhas()).toHaveLength(12)
    expect(screen.getByTestId('resumo-filtros').textContent).toMatch(/^Mensal · /)
  })

  it('as setas trocam de mês, e o período (não a divisão) é o que muda', async () => {
    const u = userEvent.setup()
    render(<EntradasSaidas />)
    await screen.findByRole('table')
    await u.click(screen.getByRole('button', { name: 'Período anterior' }))
    expect(ultimaChamada().slice(1, 4)).toEqual(['2026-10-01', '2026-10-31', 'day'])
    expect(screen.getByRole('button', { name: /Trocar período/ }).textContent).toMatch(/Outubro de 2026/)
    await u.click(screen.getByRole('button', { name: 'Próximo período' }))
    await u.click(screen.getByRole('button', { name: 'Próximo período' }))
    expect(ultimaChamada().slice(1, 3)).toEqual(['2026-12-01', '2026-12-31'])
  })
})

describe('Entradas x Saídas: divisões apagadas', () => {
  it('num mês só, "Mensal" fica aria-disabled com o motivo; tocar não muda a consulta e explica', async () => {
    const u = userEvent.setup()
    render(<EntradasSaidas />)
    await screen.findByRole('table')
    const mensal = divisao('Mensal')
    expect(mensal.getAttribute('aria-disabled')).toBe('true')
    expect(mensal.textContent).toMatch(/indisponível\. Mensal precisa de um período com mais de um mês/)
    expect(divisao('Diário').getAttribute('aria-disabled')).toBeNull()
    expect(divisao('Diário').getAttribute('aria-pressed')).toBe('true')
    const chamadas = mock.serieFluxo.mock.calls.length
    await u.click(mensal)
    expect(mock.serieFluxo.mock.calls.length).toBe(chamadas)
    expect(screen.getByRole('status').textContent).toBe('Mensal precisa de um período com mais de um mês.')
  })

  it('"Hoje": só diário e acumulado', async () => {
    const u = userEvent.setup()
    render(<EntradasSaidas />)
    await screen.findByRole('table')
    const menu = await abrirPeriodo(u)
    await u.click(within(menu).getByRole('button', { name: /^Hoje/ }))
    expect(ultimaChamada().slice(1, 4)).toEqual(['2026-11-05', '2026-11-05', 'day'])
    expect(divisao('Semanal').getAttribute('aria-disabled')).toBe('true')
    expect(divisao('Mensal').getAttribute('aria-disabled')).toBe('true')
    expect(divisao('Acumulado').getAttribute('aria-disabled')).toBeNull()
  })
})

describe('Entradas x Saídas: "Escolher período"', () => {
  it('datas livres: aplica de/até e pede ao banco exatamente esse período', async () => {
    const u = userEvent.setup()
    render(<EntradasSaidas />)
    await screen.findByRole('table')
    const menu = await abrirPeriodo(u)
    await u.click(within(menu).getByRole('button', { name: 'Escolher período' }))
    fireEvent.change(within(menu).getByLabelText('Data inicial'), { target: { value: '2026-10-10' } })
    fireEvent.change(within(menu).getByLabelText('Data final'), { target: { value: '2026-11-20' } })
    await u.click(within(menu).getByRole('button', { name: 'Aplicar período' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(ultimaChamada().slice(1, 4)).toEqual(['2026-10-10', '2026-11-20', 'day'])
    expect(screen.getByText('Entradas x Saídas · 10/10 a 20/11/2026')).toBeTruthy()
    expect(divisao('Mensal').getAttribute('aria-disabled')).toBeNull() // passa de um mês
    await screen.findByText('10/10')
    expect(linhas()).toHaveLength(42)
  })

  it('data inicial depois da final: avisa e não muda o relatório', async () => {
    const u = userEvent.setup()
    render(<EntradasSaidas />)
    await screen.findByRole('table')
    const chamadas = mock.serieFluxo.mock.calls.length
    const menu = await abrirPeriodo(u)
    await u.click(within(menu).getByRole('button', { name: 'Escolher período' }))
    fireEvent.change(within(menu).getByLabelText('Data inicial'), { target: { value: '2026-12-10' } })
    fireEvent.change(within(menu).getByLabelText('Data final'), { target: { value: '2026-11-20' } })
    await u.click(within(menu).getByRole('button', { name: 'Aplicar período' }))
    expect(within(menu).getByRole('alert').textContent).toMatch(/inicial não pode ser depois da final/)
    expect(mock.serieFluxo.mock.calls.length).toBe(chamadas)
  })
})

describe('Entradas x Saídas: cores e sinal (azul, vermelho, cinza)', () => {
  it('aparenciaValor: entrada e positivo azul; saída com "−" e vermelha; negativo vermelho; zero cinza', () => {
    expect(aparenciaValor(c(100000), 'entrada')).toEqual({ texto: 'R$ 1.000,00', cor: 'text-azul' })
    expect(aparenciaValor(c(160000), 'saida')).toEqual({ texto: '−R$ 1.600,00', cor: 'text-negativo' })
    expect(aparenciaValor(c(-60000), 'saldo')).toEqual({ texto: '−R$ 600,00', cor: 'text-negativo' })
    expect(aparenciaValor(c(500000), 'saldo')).toEqual({ texto: 'R$ 5.000,00', cor: 'text-azul' })
    for (const t of ['entrada', 'saida', 'saldo'] as const) expect(aparenciaValor(c(0), t)).toEqual({ texto: 'R$ 0,00', cor: 'text-slate-500' })
  })

  it('na tabela: nada verde; "−" tipográfico (nunca hífen); nowrap e tabular-nums em todo valor', async () => {
    render(<EntradasSaidas />)
    const tabela = await screen.findByRole('table')
    const [l1, l2, l3] = linhas()
    for (const v of within(l1).getAllByText('R$ 1.000,00')) expect(v.className).toMatch(/text-azul/) // entrada e resultado positivo
    expect(within(l1).getByText('R$ 5.000,00').className).toMatch(/text-azul/) // saldo positivo
    const neg = within(l2).getAllByText('−R$ 1.600,00') // saída e resultado negativo
    expect(neg).toHaveLength(2)
    for (const v of neg) expect(v.className).toMatch(/text-negativo/)
    expect(within(l2).getByText('−R$ 1.234,56').className).toMatch(/text-negativo/) // saldo negativo
    for (const z of within(l3).getAllByText('R$ 0,00')) expect(z.className).toMatch(/text-slate-500/)
    expect(tabela.innerHTML).not.toMatch(/text-positivo|text-green|-R\$/)
    for (const v of within(tabela).getAllByText(/R\$/)) expect(v.className).toMatch(/hidden sm:inline whitespace-nowrap tabular-nums/)
    // no celular o mesmo valor sem o "R$", com a mesma cor e o mesmo sinal
    expect(within(l2).getAllByText('−1.600,00')[0].className).toMatch(/sm:hidden whitespace-nowrap tabular-nums text-negativo/)
    expect(screen.getByText('Valores em R$.')).toBeTruthy()
    const pe = tabela.querySelector('tfoot')!
    expect(pe.className).toMatch(/sticky bottom-0/)
    expect(pe.textContent).toMatch(/Total.*R\$ 1\.000,00.*−R\$ 1\.600,00.*−R\$ 600,00/) // totais do banco, não somados aqui
  })

  it('gráfico: barra de entrada azul e de saída vermelha, com o saldo como área clara ao fundo', async () => {
    render(<EntradasSaidas />)
    await screen.findByRole('table')
    const par = screen.getAllByTestId('par-balanco')[1]
    const cores = Array.from(par.querySelectorAll('path')).map((p) => p.getAttribute('fill'))
    expect(cores).toEqual(['#2a78d6', '#dc2626'])
    expect(screen.getByTestId('area-saldo')).toBeTruthy()
    expect(par.getAttribute('aria-label')).toMatch(/, saldo .*1\.234,56$/)
  })

  it('explica numa linha com (i) que a fatura do cartão sai no pagamento e a que falta pagar no vencimento', async () => {
    render(<EntradasSaidas />)
    await screen.findByRole('table')
    const dica = screen.getByTestId('explicacao-cartao')
    expect(dica.querySelector('summary')!.textContent).toMatch(/a fatura sai no dia do pagamento; a que falta pagar, no vencimento/)
    expect(dica.textContent).toMatch(/paga em parte, o que foi pago entra na data do pagamento e o que falta, no vencimento/)
  })
})

describe('Entradas x Saídas: saldo', () => {
  it('com conta escolhida o banco não manda saldo: a coluna e a área somem e a tela explica', async () => {
    const u = userEvent.setup()
    render(<EntradasSaidas />)
    await screen.findByRole('table')
    const folha = await abrirFiltros(u)
    await u.click(within(folha).getByRole('checkbox', { name: 'Banco' }))
    await u.click(within(folha).getByRole('button', { name: 'Aplicar' }))
    const tabela = await screen.findByRole('table')
    expect(within(tabela).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Período', 'Entradas', 'Saídas', 'Resultado'])
    expect(screen.queryByTestId('area-saldo')).toBeNull()
    expect(screen.getByText(/O saldo aparece só com todas as contas/)).toBeTruthy()
    expect(screen.getByText(/o cartão entra só pelos pagamentos de fatura feitos por ela/)).toBeTruthy()
  })

  it('sem filtro: colunas Período | Entradas | Saídas | Resultado | Saldo', async () => {
    render(<EntradasSaidas />)
    const tabela = await screen.findByRole('table')
    expect(within(tabela).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Período', 'Entradas', 'Saídas', 'Resultado', 'Saldo'])
  })
})

describe('Entradas x Saídas: folha de filtros', () => {
  it('sem filtros por padrão; o resumo diz a divisão de verdade', async () => {
    render(<EntradasSaidas />)
    await screen.findByRole('table')
    expect(ultimaChamada()[4]).toEqual({ contas: [], membro: '', incluirNaoPagos: false })
    expect(screen.getByTestId('resumo-filtros').textContent).toBe('Diário · Só pagos · Todas as contas')
    expect(screen.queryByRole('checkbox', { name: 'Banco' })).toBeNull()
  })

  it('contas: "Todas" por padrão, conta as escolhidas e esconde as arquivadas atrás de "Mostrar arquivadas"', async () => {
    const u = userEvent.setup()
    render(<EntradasSaidas />)
    await screen.findByRole('table')
    const folha = await abrirFiltros(u)
    expect(within(folha).queryByRole('button', { name: 'Mensal' })).toBeNull() // a divisão saiu da folha
    expect(within(folha).getByRole('button', { name: 'Todas as contas' }).getAttribute('aria-pressed')).toBe('true')
    expect(within(folha).queryByRole('checkbox', { name: /Carteira/ })).toBeNull()
    await u.click(within(folha).getByRole('checkbox', { name: 'Mostrar arquivadas (1)' }))
    expect(within(folha).getByRole('checkbox', { name: /Carteira/ })).toBeTruthy()
    await u.click(within(folha).getByRole('checkbox', { name: 'Banco' }))
    await u.click(within(folha).getByRole('checkbox', { name: 'Poupança' }))
    expect(within(folha).getByTestId('contagem-contas').textContent).toMatch(/2 escolhidas/)
    await u.click(within(folha).getByRole('button', { name: 'Aplicar' }))
    expect(ultimaChamada()[4]).toEqual({ contas: ['a1', 'a3'], membro: '', incluirNaoPagos: false })
    expect(screen.getByTestId('resumo-filtros').textContent).toBe('Diário · Só pagos · 2 contas')
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

  it('"Todos" (não pagos) e autor só valem ao Aplicar; o período e a divisão continuam', async () => {
    const u = userEvent.setup()
    render(<EntradasSaidas />)
    await screen.findByRole('table')
    const chamadas = mock.serieFluxo.mock.calls.length
    const folha = await abrirFiltros(u)
    await u.click(within(folha).getByRole('button', { name: 'Pagos e não pagos' }))
    await u.click(within(folha).getByRole('button', { name: 'Ana' }))
    expect(mock.serieFluxo.mock.calls.length).toBe(chamadas)
    await u.click(within(folha).getByRole('button', { name: 'Aplicar' }))
    expect(ultimaChamada().slice(1)).toEqual(['2026-11-01', '2026-11-30', 'day', { contas: [], membro: 'u2', incluirNaoPagos: true }])
    expect(screen.getByTestId('resumo-filtros').textContent).toBe('Diário · Pagos e não pagos · Todas as contas · Lançado por Ana')
    expect(screen.getByText(/As faturas a pagar não têm autor/)).toBeTruthy()
  })

  it('Esc fecha sem aplicar, e o foco volta ao botão Filtros', async () => {
    const u = userEvent.setup()
    render(<EntradasSaidas />)
    await screen.findByRole('table')
    const botao = screen.getByRole('button', { name: /^Filtros/ })
    const folha = await abrirFiltros(u)
    await u.click(within(folha).getByRole('button', { name: 'Pagos e não pagos' }))
    await u.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(botao)
    expect(ultimaChamada()[4].incluirNaoPagos).toBe(false)
  })

  it('trocar o filtro tira a tabela antiga enquanto o número novo não chega', async () => {
    const u = userEvent.setup()
    render(<EntradasSaidas />)
    await screen.findByRole('table')
    mock.serieFluxo.mockReturnValueOnce(new Promise(() => {}))
    const folha = await abrirFiltros(u)
    await u.click(within(folha).getByRole('button', { name: 'Ana' }))
    await u.click(within(folha).getByRole('button', { name: 'Aplicar' }))
    expect(screen.getByText('Carregando…')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })
})

describe('Entradas x Saídas: erros e outras moedas', () => {
  it('erro do banco (ex.: migration 066 ausente) mostra o aviso e não derruba a tela', async () => {
    mock.serieFluxo.mockRejectedValue(new Error('function public.cash_flow_series does not exist'))
    render(<EntradasSaidas />)
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('o filtro de contas só oferece contas em reais', async () => {
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

  it('outras moedas à parte, no mesmo período do relatório', async () => {
    mock.resumoPorMoeda.mockResolvedValue([{ moeda: 'USD', receitas: c(100000), despesas: c(4025), resultado: c(95975) }])
    render(<EntradasSaidas />)
    const bloco = await screen.findByRole('group', { name: 'Em outras moedas' })
    expect(bloco.textContent).toMatch(/\+US\$\s*1\.000,00/)
    expect(mock.resumoPorMoeda).toHaveBeenLastCalledWith('h1', '2026-11-01', '2026-11-30')
  })
})
