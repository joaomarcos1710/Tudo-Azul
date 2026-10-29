// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { Cents } from '../lib/format'

const mock = vi.hoisted(() => ({
  carregarPatrimonio: vi.fn(),
  proximosPlanejados: vi.fn(),
  resumoDoMes: vi.fn(),
  listarContas: vi.fn(),
  despesasPorCategoria: vi.fn(),
  despesasPorDia: vi.fn(),
  regularidadeRenda: vi.fn(),
  projecaoDoMes: vi.fn(),
  vencidosPlanejados: vi.fn(),
  resumoDosCartoes: vi.fn(),
  ultimasConferencias: vi.fn(),
  resumoDoPeriodo: vi.fn(),
  listarLancamentos: vi.fn(),
  listarCategorias: vi.fn(),
}))
vi.mock('../lib/FamiliaContext', () => ({
  useFamilia: () => ({ familia: { id: 'h1', nome: 'Casa', papel: 'owner' }, carregando: false, erro: false, recarregar: vi.fn() }),
}))
vi.mock('../lib/painel', () => ({
  carregarPatrimonio: mock.carregarPatrimonio, proximosPlanejados: mock.proximosPlanejados,
  despesasPorCategoria: mock.despesasPorCategoria, despesasPorDia: mock.despesasPorDia,
  regularidadeRenda: mock.regularidadeRenda,
  projecaoDoMes: mock.projecaoDoMes,
  vencidosPlanejados: mock.vencidosPlanejados,
}))
vi.mock('../lib/conciliacao', () => ({ ultimasConferencias: mock.ultimasConferencias }))
vi.mock('../lib/auth', () => ({ useAuth: () => ({ sessao: { user: { user_metadata: { name: 'João Marcos' } } }, carregando: false }) }))
vi.mock('../lib/categorias', async (o) => ({ ...(await o<typeof import('../lib/categorias')>()), listarCategorias: mock.listarCategorias }))
vi.mock('../lib/lancamentos', async (o) => ({ ...(await o<typeof import('../lib/lancamentos')>()), resumoDoMes: mock.resumoDoMes, resumoDoPeriodo: mock.resumoDoPeriodo, listarLancamentos: mock.listarLancamentos }))
const cobrar = vi.hoisted(() => vi.fn())
const gerar = vi.hoisted(() => vi.fn())
vi.mock('../lib/cartoes', () => ({ cobrarFaturasFechadas: cobrar, resumoDosCartoes: mock.resumoDosCartoes }))
vi.mock('../lib/recorrencias', () => ({ gerarOcorrencias: gerar }))
vi.mock('../lib/contas', async (o) => ({ ...(await o<typeof import('../lib/contas')>()), listarContas: mock.listarContas }))

import VisaoGeral from './VisaoGeral'

const c = (n: number) => n as Cents
const montar = (secao: 'inicio' | 'analises' = 'inicio') => render(<MemoryRouter><VisaoGeral secao={secao} /></MemoryRouter>)

beforeEach(() => {
  cobrar.mockResolvedValue(0)
  gerar.mockResolvedValue(0)
  mock.carregarPatrimonio.mockResolvedValue({ disponivel: c(5065105), creditoAReceber: c(24590), divida: c(4002135), patrimonio: c(1087560), compromissos: c(482000) })
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
  mock.resumoDosCartoes.mockResolvedValue([])
  mock.ultimasConferencias.mockResolvedValue(new Map())
  mock.projecaoDoMes.mockResolvedValue({
    diasNoMes: 31, diasDecorridos: 10, diasRestantes: 21, gasto: c(1300000), previsto: c(25000), variavelAteAgora: c(30000),
    ritmoPorDia: c(3000), ritmoRestante: c(63000), projetado: c(1388000),
  })
  
  // ordem do Promise.all da tela: mês até hoje, mesmo período do ano passado, ano até hoje, ano passado
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
  it('o Início saúda pelo primeiro nome; Análises mostra o título próprio', async () => {
    montar()
    expect(await screen.findByText(/, João!/)).toBeTruthy()
    cleanup()
    montar('analises')
    expect(await screen.findByRole('heading', { name: 'Análises' })).toBeTruthy()
    expect(screen.queryByText(/, João!/)).toBeNull()
  })
  it('gráfico de categorias com valores e % do banco (Análises)', async () => {
    montar('analises')
    expect(await screen.findByText('57,7%')).toBeTruthy()
    expect(screen.getAllByText('Moradia').length).toBeGreaterThan(0)
    expect(screen.getByText('Outros')).toBeTruthy()
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

  it('compara com o mês anterior', async () => {
    mock.resumoDoMes.mockResolvedValueOnce({ receitas: c(1215000), despesas: c(866726), resultado: c(348274), receitasPrevistas: c(0), despesasPrevistas: c(0) })
      .mockResolvedValueOnce({ receitas: c(1215000), despesas: c(433363), resultado: c(781637), receitasPrevistas: c(0), despesasPrevistas: c(0) })
    montar('analises')
    expect(await screen.findByText(/100%/)).toBeTruthy() // despesas dobraram
  })
  it('mostra a equação do patrimônio com os valores do banco', async () => {
    montar('analises')
    // equação montada com os valores do banco: disponível + crédito a receber − dívida = patrimônio
    expect(await screen.findByText(/disponível R\$ 50\.651,05 \+ crédito a receber R\$ 245,90 − dívida R\$ 40\.021,35/)).toBeTruthy()
    expect(screen.getByText('R$ 10.875,60')).toBeTruthy()
    expect(screen.getByText(/Não inclui bens nem investimentos/)).toBeTruthy()
    expect(screen.getByText('R$ 4.820,00')).toBeTruthy() // compromissos à parte
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
    mock.carregarPatrimonio.mockResolvedValue({ disponivel: c(0), creditoAReceber: c(0), divida: c(0), patrimonio: c(0), compromissos: c(0) })
    montar('analises')
    await screen.findByText(/Não inclui bens/)
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
    expect(mock.resumoDoPeriodo).toHaveBeenCalledTimes(4)
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
    await screen.findByText(/, João!/)
    const alvo = (nome: string) => (screen.getByRole('link', { name: nome }) as HTMLAnchorElement).getAttribute('href')
    expect(alvo('Despesa')).toBe('/lancamentos?novo=despesa')
    expect(alvo('Receita')).toBe('/lancamentos?novo=receita')
    expect(alvo('Transferência')).toBe('/lancamentos?novo=transferencia')
    expect(alvo('Compra no cartão')).toBe('/lancamentos?novo=cartao')
  })

  it('vencidos: lista o planejado que já passou, o mais antigo primeiro, com há quantos dias e link para o mês', async () => {
    const hojeSP_ = new Date().toISOString().slice(0, 10)
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
    expect(screen.queryByText(/Não foi possível/)).toBeNull()
  })

  it('cartões: fatura a pagar com vencimento, fatura vencida em vermelho e limite disponível', async () => {
    mock.resumoDosCartoes.mockResolvedValue([
      { id: 'k1', nome: 'Nubank', divida: c(133334), vencimento: '2099-12-25', vencida: false, limiteDisponivel: c(527000), credito: c(0) },
      { id: 'k2', nome: 'Inter', divida: c(50000), vencimento: '2020-01-10', vencida: true, limiteDisponivel: null, credito: c(0) },
      { id: 'k3', nome: 'Azul Card', divida: c(0), vencimento: null, vencida: false, limiteDisponivel: null, credito: c(10000) },
    ])
    montar()
    expect(await screen.findByText('Nubank')).toBeTruthy()
    expect(screen.getByText('R$ 1.333,34')).toBeTruthy()
    expect(screen.getByText('vence em 25/12')).toBeTruthy()
    expect(screen.getByText('limite disponível R$ 5.270,00')).toBeTruthy()
    expect(screen.getByText('venceu em 10/01/2020').className).toMatch(/text-negativo/) // vencida mostra o ano
    expect(screen.getByText(/nenhuma fatura fechada a pagar · crédito de R\$ 100,00/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Ver cartões' })).toBeTruthy()
  })

  it('conferência: conta nunca conferida e conta conferida há mais de 30 dias pedem atenção; recente fica neutra', async () => {
    const hojeSP_ = new Date().toISOString().slice(0, 10)
    const dia = (n: number) => new Date(Date.parse(hojeSP_ + 'T12:00:00Z') - n * 86_400_000).toISOString().slice(0, 10)
    mock.listarContas.mockResolvedValue({
      contas: [
        { id: 'a1', nome: 'Itaú', tipo: 'checking', saldoInicial: c(0), abertura: '2026-10-01', ativa: true, saldo: c(1000) },
        { id: 'a3', nome: 'Nubank conta', tipo: 'checking', saldoInicial: c(0), abertura: '2026-10-01', ativa: true, saldo: c(2000) },
        { id: 'a4', nome: 'Carteira', tipo: 'cash', saldoInicial: c(0), abertura: '2026-10-01', ativa: true, saldo: c(300) },
      ],
      total: c(3300),
    })
    mock.ultimasConferencias.mockResolvedValue(new Map([['a3', dia(45)], ['a4', dia(2)]]))
    montar()
    expect(await screen.findByText('Nunca conferida com o extrato')).toBeTruthy()
    expect(screen.getByText(/\(há 45 dias\)/)).toBeTruthy()
    const recente = screen.getByText(`Conferida em ${dia(2).split('-').reverse().join('/')}`)
    expect(recente.className).toMatch(/text-slate-500/)
    const hrefs = screen.getAllByRole('link', { name: /^Conferir / }).map((l) => l.getAttribute('href'))
    expect(screen.getByRole('link', { name: 'Conferir Itaú' })).toBeTruthy()
    expect(hrefs).toEqual(['/contas/a1/conferir', '/contas/a3/conferir', '/contas/a4/conferir'])
  })
})

describe('Início × Análises: cada seção mostra só os seus blocos', () => {
  it('Início não mostra os números de análise (patrimônio, comparação, renda regular)', async () => {
    montar()
    await screen.findByText('Próximos planejados')
    expect(screen.queryByText('Renda regular × despesas')).toBeNull()
    expect(screen.queryByText('Comparação com o ano passado')).toBeNull()
    expect(screen.queryByText('Projeção do mês')).toBeNull()
    expect(screen.queryByText('R$ 10.875,60')).toBeNull()
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
    expect(screen.queryByRole('region', { name: 'Ações rápidas' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Despesa' })).toBeNull()
    expect(screen.queryByText('Vencidos e precisam de atenção')).toBeNull()
    expect(screen.queryByText('Nubank')).toBeNull()
    expect(screen.queryByText('Próximos planejados')).toBeNull()
    expect(screen.queryByText('Contas')).toBeNull()
    // e o Início continua com tudo isso
    cleanup()
    montar()
    expect(await screen.findByText('Vencidos e precisam de atenção')).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Ações rápidas' })).toBeTruthy()
    expect(screen.getByText('Nubank')).toBeTruthy()
  })
  it('Início não consulta patrimônio nem resumos do mês: uma falha neles não derruba o Início', async () => {
    mock.carregarPatrimonio.mockRejectedValue(new Error('rede'))
    mock.resumoDoMes.mockRejectedValue(new Error('rede'))
    montar()
    expect(await screen.findByText('Próximos planejados')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(mock.carregarPatrimonio).not.toHaveBeenCalled()
    expect(mock.resumoDoMes).not.toHaveBeenCalled()
  })
})

describe('Análises: falha isolada derruba só o bloco dela', () => {
  it('mês anterior falhou: indicadores aparecem sem a variação; nada de erro na tela', async () => {
    mock.resumoDoMes
      .mockResolvedValueOnce({ receitas: c(1215000), despesas: c(866726), resultado: c(348274), receitasPrevistas: c(0), despesasPrevistas: c(38990) })
      .mockRejectedValueOnce(new Error('rede'))
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
  it('resumo do mês falhou: patrimônio e os outros blocos seguem; o gráfico que depende do total fica indisponível', async () => {
    mock.resumoDoMes.mockRejectedValue(new Error('rede'))
    montar('analises')
    expect(await screen.findByText('Resumo do mês indisponível agora. O restante da tela continua.')).toBeTruthy()
    expect(screen.getByText('R$ 10.875,60')).toBeTruthy()
    expect(screen.queryByText('Despesas do mês')).toBeNull()
    expect(screen.getByText('Gráfico indisponível agora.')).toBeTruthy()
    expect(screen.getByText('Renda regular × despesas')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
