// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { Cents } from '../lib/format'

const mock = vi.hoisted(() => ({
  listarRecorrencias: vi.fn(),
  criarRecorrencia: vi.fn(),
  editarRecorrencia: vi.fn(),
  excluirRecorrencia: vi.fn(),
  resumoRecorrencias: vi.fn(),
  resumoPorNatureza: vi.fn(),
  resumoVisaoGeral: vi.fn(),
  listarProventosPrevistos: vi.fn(),
  listarProventosAcabando: vi.fn(),
  faturaDaProximaCobranca: vi.fn(),
  proximasDatasDasContas: vi.fn(),
  definirNaturezaRecorrencia: vi.fn(),
  listarContas: vi.fn(),
  listarCartoes: vi.fn(),
  listarCategorias: vi.fn(),
  listarParcelasAtivas: vi.fn(),
  resumoParcelasDoMes: vi.fn(),
}))
vi.mock('../lib/FamiliaContext', () => ({
  useFamilia: () => ({ familia: { id: 'h1', nome: 'Casa', papel: 'owner' }, carregando: false, erro: false, recarregar: vi.fn() }),
}))
vi.mock('../lib/recorrencias', async (o) => ({
  ...(await o<typeof import('../lib/recorrencias')>()),
  listarRecorrencias: mock.listarRecorrencias, criarRecorrencia: mock.criarRecorrencia,
  editarRecorrencia: mock.editarRecorrencia, excluirRecorrencia: mock.excluirRecorrencia,
  resumoRecorrencias: mock.resumoRecorrencias, resumoPorNatureza: mock.resumoPorNatureza, resumoVisaoGeral: mock.resumoVisaoGeral,
  definirNaturezaRecorrencia: mock.definirNaturezaRecorrencia, proximasDatasDasContas: mock.proximasDatasDasContas,
}))
vi.mock('../lib/investimentos', async (o) => ({
  ...(await o<typeof import('../lib/investimentos')>()),
  listarProventosPrevistos: mock.listarProventosPrevistos,
  listarProventosAcabando: mock.listarProventosAcabando,
}))
vi.mock('../lib/contas', async (o) => ({ ...(await o<typeof import('../lib/contas')>()), listarContas: mock.listarContas }))
vi.mock('../lib/parcelasAtivas', () => ({ listarParcelasAtivas: mock.listarParcelasAtivas, listarParcelasQueAcabam: vi.fn().mockResolvedValue({ planos: [], totais: [] }), listarCronogramaParcelas: vi.fn().mockResolvedValue(new Map()), resumoParcelasDoMes: mock.resumoParcelasDoMes }))
vi.mock('../lib/projecaoCompromissos', () => ({ carregarProjecaoCompromissos: vi.fn().mockResolvedValue([]) }))
vi.mock('../lib/cartoes', async (o) => ({ ...(await o<typeof import('../lib/cartoes')>()), listarCartoes: mock.listarCartoes, faturaDaProximaCobranca: mock.faturaDaProximaCobranca }))
vi.mock('../lib/categorias', async (o) => ({ ...(await o<typeof import('../lib/categorias')>()), listarCategorias: mock.listarCategorias }))

import Recorrentes from './Recorrentes'


const c = (n: number) => n as Cents
const luz = {
  id: 'r1', tipo: 'expense' as const, descricao: 'Luz', valor: c(18000), dia: 10 as number | null, unidade: 'month' as const, cada: 1,
  inicio: '2026-10-01', fim: null as string | null,
  contaId: 'a1', destinoId: null, cartaoId: null, categoriaId: 'g1', ativa: true,
}
/** `entrada` = a rota inicial: "/" abre em Saídas; "/?v=entradas" abre em Entradas. */
const montar = (entrada = '/') => render(<MemoryRouter initialEntries={[entrada]}><Recorrentes /></MemoryRouter>)
const ENTRADAS = '/?v=entradas'
/** Texto da linha de metadados de um item (a subcategoria vem em dois spans: visível e para leitor de tela). */
const metas = () => screen.getAllByTestId('meta-recorrente').map((p) => Array.from(p.childNodes)
  .map((n) => ((n as HTMLElement).className === 'sr-only' ? '' : n.textContent)).join(''))

beforeEach(() => {
  mock.listarParcelasAtivas.mockResolvedValue({ parcelamentos: [], totais: [] })
  mock.resumoParcelasDoMes.mockResolvedValue([])
  mock.listarRecorrencias.mockResolvedValue([])
  mock.resumoRecorrencias.mockResolvedValue([])
  mock.resumoPorNatureza.mockResolvedValue([])
  mock.resumoVisaoGeral.mockResolvedValue([])
  mock.listarProventosPrevistos.mockResolvedValue([])
  mock.listarProventosAcabando.mockResolvedValue([])
  mock.faturaDaProximaCobranca.mockResolvedValue(new Map())
  mock.proximasDatasDasContas.mockResolvedValue(null as unknown as Map<string, string>) // padrão: sem datas reais, cai na data da regra (sem falha)
  mock.definirNaturezaRecorrencia.mockResolvedValue(undefined)
  mock.listarContas.mockResolvedValue({
    contas: [
      { id: 'a1', nome: 'Itaú', tipo: 'checking', saldoInicial: c(0), abertura: '2026-01-01', ativa: true, saldo: c(0) },
      { id: 'a2', nome: 'Poupança', tipo: 'savings', saldoInicial: c(0), abertura: '2026-01-01', ativa: true, saldo: c(0) },
    ],
    total: c(0),
  })
  mock.listarCartoes.mockResolvedValue([
    { id: 'k1', nome: 'Nubank', fechamento: 17, vencimento: 25, ativo: true, divida: c(0), credito: c(0), compromissos: c(0) },
  ])
  mock.listarCategorias.mockResolvedValue([
    { id: 'g1', nome: 'Moradia', tipo: 'expense', paiId: null, sistema: false, ativa: true },
    { id: 'g2', nome: 'Salário', tipo: 'income', paiId: null, sistema: false, ativa: true },
  ])
  for (const f of [mock.criarRecorrencia, mock.editarRecorrencia]) f.mockResolvedValue(undefined)
  mock.excluirRecorrencia.mockResolvedValue(0)
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('Recorrentes', () => {
  it('mostra a seção "Parcelas ativas" com os parcelamentos do banco', async () => {
    mock.listarParcelasAtivas.mockResolvedValue({
      parcelamentos: [{
        chave: 'card:k1:p1', origem: 'card', moeda: 'BRL', descricao: 'Geladeira', origemId: 'k1', origemNome: 'Nubank',
        valorParcela: c(10000), parcelaAtual: 5, totalParcelas: 10, parcelasPagas: 4, percentualPago: 40,
        total: c(100000), pago: c(40000), saldoRestante: c(60000), futuro: c(50000), situacaoMes: 'pending',
        proximoVencimento: '2026-11-15', emAtraso: 0,
      }],
      totais: [{ moeda: 'BRL', qtde: 1, saldoRestante: c(60000), futuro: c(50000) }],
    })
    montar()
    // as parcelas ficam na aba "Parcelas ativas" e só carregam quando ela abre
    await screen.findByRole('tab', { name: 'Parcelas' })
    expect(mock.listarParcelasAtivas).not.toHaveBeenCalled()
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Parcelas' }))
    expect(await screen.findByRole('heading', { name: 'Parcelas ativas' })).toBeTruthy()
    expect(await screen.findByText('Parcela 5 de 10')).toBeTruthy()
  })

  it('se as parcelas ativas falharem, só esse bloco avisa: os recorrentes continuam na tela', async () => {
    mock.listarParcelasAtivas.mockRejectedValue({ code: '57014' })
    mock.listarRecorrencias.mockResolvedValue([luz])
    mock.resumoRecorrencias.mockResolvedValue([
      { nivel: 'medium', meio: 'account', alvoId: null, alvoNome: null, tipo: 'expense', frequencia: null, qtde: 1, porOcorrencia: c(18000), porMes: c(18000) },
    ])
    const u = userEvent.setup()
    montar()
    expect(await screen.findByText('Luz')).toBeTruthy()
    await u.click(screen.getByRole('tab', { name: 'Parcelas' }))
    expect(await screen.findByText(/Não foi possível carregar as parcelas ativas/)).toBeTruthy()
    // a falha é só do bloco: voltar para a lista mostra os recorrentes de sempre
    await u.click(screen.getByRole('tab', { name: 'Recorrentes' }))
    expect(await screen.findByText('Luz')).toBeTruthy()
    expect(screen.queryByText('Nenhum recorrente ainda')).toBeNull()
  })

  it('sem regras, convida a cadastrar', async () => {
    montar()
    expect(await screen.findByText('Nenhum recorrente ainda')).toBeTruthy()
  })

  it('lista as regras ativas com dia, conta, categoria e valor', async () => {
    mock.listarRecorrencias.mockResolvedValue([luz, { ...luz, id: 'r2', descricao: 'Academia antiga', ativa: false, fim: '2026-09-30' }])
    montar()
    expect(await screen.findByText('Luz')).toBeTruthy()
    expect(metas()[0]).toMatch(/^próxima \d\d\/\d\d(\/\d{4})? · Itaú · dia 10 · Moradia$/)
    expect(screen.getByText('−R$ 180,00')).toBeTruthy()
  })

  it('não existe mais "Encerrar": o fim de um recorrente é excluí-lo', async () => {
    mock.listarRecorrencias.mockResolvedValue([luz])
    montar()
    await screen.findByText('Luz')
    expect(screen.queryByRole('button', { name: 'Encerrar' })).toBeNull()
  })

  it('não exibe regras inativas/encerradas como arquivo', async () => {
    mock.listarRecorrencias.mockResolvedValue([{ ...luz, id: 'r2', descricao: 'Academia antiga', ativa: false, fim: '2026-09-30' }])
    montar()
    expect(await screen.findByText('Nenhum recorrente ainda')).toBeTruthy()
    expect(screen.queryByText('Academia antiga')).toBeNull()
    expect(screen.queryByText(/Encerrados/)).toBeNull()
  })

  it('próxima de conta vem do banco (já descontada a paga adiantada); cartão e falha do banco seguem pela regra', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-15T15:00:00Z'))
    mock.listarRecorrencias.mockResolvedValue([
      { ...luz, id: 'r1', descricao: 'Light', dia: 5, inicio: '2026-06-05' },
      { ...luz, id: 'r2', descricao: 'Assinatura', tipo: 'card' as const, contaId: null, cartaoId: 'k1', dia: 20, inicio: '2026-06-20' },
    ])
    // a regra diria 05/12 para a Light, mas essa ocorrência já foi paga: a próxima real é 05/01. O cartão não vem do banco.
    mock.proximasDatasDasContas.mockResolvedValue(new Map([['r1', '2027-01-05'], ['r2', '2027-03-01']]))
    montar()
    expect(await screen.findByText('Light')).toBeTruthy()
    await vi.waitFor(() => expect(metas().some((m) => m.startsWith('próxima 05/01/2027'))).toBe(true))
    expect(metas().some((m) => m.startsWith('próxima 05/12'))).toBe(false)
    expect(metas().some((m) => m.startsWith('próxima 20/11'))).toBe(true)
    cleanup()
    // o banco falhou (ou ainda não tem a função): volta para a data da regra, como antes
    mock.proximasDatasDasContas.mockRejectedValue(new Error('sem a função'))
    montar()
    expect(await screen.findByText('Light')).toBeTruthy()
    expect(metas().some((m) => m.startsWith('próxima 05/12'))).toBe(true)
    vi.useRealTimers()
  })

  it('lista mostra a frequência, a próxima data e a data final', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-28T15:00:00Z'))
    mock.listarRecorrencias.mockResolvedValue([
      { ...luz, id: 'r3', descricao: 'PLR', tipo: 'income' as const, categoriaId: 'g2', dia: 20, cada: 12, inicio: '2027-02-01' },
      { ...luz, id: 'r4', descricao: 'Diarista', unidade: 'week' as const, cada: 2, dia: null, inicio: '2026-10-23', fim: '2027-06-30' },
    ])
    montar()
    expect(await screen.findByText('Diarista')).toBeTruthy()
    // saídas: a quinzenal; "próxima" curta no ano corrente (auditoria 5h: a próxima data abre a linha)
    expect(metas()).toEqual(['próxima 06/11 · Itaú · quinzenal · sexta · Moradia · até 30/06/2027'])
    cleanup()
    // entradas: a anual, em outra visão
    montar(ENTRADAS)
    expect(await screen.findByText('PLR')).toBeTruthy()
    expect(metas()).toEqual(['próxima 20/02/2027 · Itaú · 20 de fev · Salário'])
    // o detalhe completo continua no title
    expect(screen.getAllByTestId('meta-recorrente')[0].getAttribute('title')).toBe(
      'Anual · 20 de fevereiro · Itaú · Salário · Receita em conta · próxima 20/02/2027')
    vi.useRealTimers()
  })

  describe('multimoeda F2 (migration 056)', () => {
    const contasMoedas = [
      { id: 'a1', nome: 'Itaú', tipo: 'checking', saldoInicial: c(0), abertura: '2026-01-01', ativa: true, saldo: c(0), moeda: 'BRL' },
      { id: 'a3', nome: 'Conta em euro', tipo: 'checking', saldoInicial: c(0), abertura: '2026-01-01', ativa: true, saldo: c(0), moeda: 'EUR' },
      { id: 'a4', nome: 'Reserva em euro', tipo: 'savings', saldoInicial: c(0), abertura: '2026-01-01', ativa: true, saldo: c(0), moeda: 'EUR' },
    ]
    /** "€ 9,90" com o espaço do Intl (NBSP ou espaço comum). */
    const moeda = (texto: string) => new RegExp(`^${texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(' ', '[\\s\\u00a0]')}$`)

    it('a lista mostra o valor na moeda da conta', async () => {
      mock.listarContas.mockResolvedValue({ contas: contasMoedas, total: c(0) })
      mock.listarRecorrencias.mockResolvedValue([{ ...luz, descricao: 'Assinatura', valor: c(990), contaId: 'a3' }])
      montar()
      expect(await screen.findByText(moeda('−€ 9,90'))).toBeTruthy()
    })
  })

  describe('resumo e grupos (migration 063)', () => {
    type Linha = { nivel: string; meio: string | null; alvoId?: string | null; alvoNome?: string | null; tipo: string; frequencia?: string | null; qtde: number; porOcorrencia: Cents; porMes: Cents }
    const l = (x: Linha) => ({ alvoId: null, alvoNome: null, frequencia: null, ...x })
    // valores do "banco" de propósito diferentes da soma dos itens: a tela tem de mostrar o que veio, sem somar
    const resumo = [
      l({ nivel: 'medium', meio: 'card', tipo: 'expense', qtde: 2, porOcorrencia: c(17590), porMes: c(6590) }),
      l({ nivel: 'medium', meio: 'account', tipo: 'expense', qtde: 3, porOcorrencia: c(307000), porMes: c(235416) }),
      l({ nivel: 'medium', meio: 'account', tipo: 'income', qtde: 1, porOcorrencia: c(500000), porMes: c(500000) }),
      l({ nivel: 'medium', meio: 'account', tipo: 'transfer', qtde: 1, porOcorrencia: c(20000), porMes: c(20000) }),
      l({ nivel: 'target', meio: 'card', alvoId: 'k1', alvoNome: 'Nubank', tipo: 'expense', qtde: 2, porOcorrencia: c(17590), porMes: c(6590) }),
      l({ nivel: 'frequency_all', meio: null, tipo: 'expense', frequencia: 'monthly', qtde: 2, porOcorrencia: c(111111), porMes: c(111111) }),
      l({ nivel: 'frequency_all', meio: null, tipo: 'expense', frequencia: 'yearly', qtde: 2, porOcorrencia: c(132000), porMes: c(11000) }),
      l({ nivel: 'frequency', meio: 'card', tipo: 'expense', frequencia: 'monthly', qtde: 1, porOcorrencia: c(5590), porMes: c(5590) }),
      l({ nivel: 'frequency', meio: 'card', tipo: 'expense', frequencia: 'yearly', qtde: 1, porOcorrencia: c(12000), porMes: c(1000) }),
      l({ nivel: 'frequency', meio: 'account', tipo: 'expense', frequencia: 'monthly', qtde: 1, porOcorrencia: c(18000), porMes: c(18000) }),
      l({ nivel: 'frequency', meio: 'account', tipo: 'expense', frequencia: 'yearly', qtde: 1, porOcorrencia: c(120000), porMes: c(10000) }),
    ]
    // Condomínio fica sem natureza (o app sugere); o resto é classificado
    const regras = [
      { ...luz, id: 'r1', descricao: 'Condomínio do prédio com nome bem comprido', categoriaId: 'g3', dia: 1 },
      { ...luz, id: 'r2', descricao: 'Seguro', cada: 12, dia: 10, inicio: '2027-03-10', valor: c(120000), nature: 'fixed' as const },
      { ...luz, id: 'r3', tipo: 'card' as const, descricao: 'Streaming', contaId: null, cartaoId: 'k1', dia: 15, valor: c(5590), nature: 'subscription' as const },
      { ...luz, id: 'r4', tipo: 'card' as const, descricao: 'Antivírus', contaId: null, cartaoId: 'k1', cada: 12, dia: 20, inicio: '2027-02-20', valor: c(12000), nature: 'subscription' as const },
    ]
    // totais por natureza do "banco": sentinelas que não batem com nenhuma soma dos itens (a tela só mostra)
    const porNatureza = [
      { natureza: 'all' as const, tipo: 'expense' as const, qtde: 4, porMes: c(999900) },
      { natureza: 'fixed' as const, tipo: 'expense' as const, qtde: 1, porMes: c(10101) },
      { natureza: 'subscription' as const, tipo: 'expense' as const, qtde: 2, porMes: c(6789) },
      { natureza: 'none' as const, tipo: 'expense' as const, qtde: 1, porMes: c(18018) },
      { natureza: 'none' as const, tipo: 'income' as const, qtde: 1, porMes: c(505050) },
    ]
    const categoriasComFilha = [
      { id: 'g1', nome: 'Moradia', tipo: 'expense', paiId: null, sistema: false, ativa: true },
      { id: 'g3', nome: 'Condomínio', tipo: 'expense', paiId: 'g1', sistema: false, ativa: true },
    ]
    const cabecalhos = () => screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
      .filter((t) => !['Todo mês, com o que se repete', 'Projeção de compromissos', 'Parcelas ativas'].includes(t ?? ''))
    const card = (titulo: RegExp) => screen.getByRole('region', { name: titulo })
    /** Nomes das linhas de um grupo, na ordem da tela. */
    const nomes = (grupo: HTMLElement) => Array.from(grupo.querySelectorAll('li span.line-clamp-2')).map((p) => p.textContent)

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2026-11-05T15:00:00Z'))
      mock.resumoRecorrencias.mockResolvedValue(resumo)
      mock.resumoPorNatureza.mockResolvedValue(porNatureza)
      mock.listarRecorrencias.mockResolvedValue(regras)
      mock.listarCategorias.mockResolvedValue(categoriasComFilha)
    })
    afterEach(() => { vi.useRealTimers() })

    it('"No cartão · Na conta" vem do banco (nível medium das saídas), no card do topo; o "Por cartão e por conta" saiu', async () => {
      const u = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      montar()
      await screen.findByText('Streaming')
      expect(mock.resumoRecorrencias).toHaveBeenCalledWith('h1')
      const linha = within(screen.getByTestId('resumo-do-mes')).getByTestId('no-cartao-na-conta')
      expect(linha.textContent).toBe('No cartão R$ 65,90 · Na conta R$ 2.354,16')
      expect(screen.queryByText('Por cartão e por conta')).toBeNull()
      // só nas saídas: entradas não têm "no cartão"
      await u.click(screen.getByRole('tab', { name: /^Entradas/ }))
      expect(screen.queryByTestId('no-cartao-na-conta')).toBeNull()
    })

    it('um card por natureza presente, na ordem da legenda, sem contador; natureza sem itens não aparece', async () => {
      montar()
      await screen.findByText('Streaming')
      expect(cabecalhos()).toEqual(['Custos fixos', 'Assinaturas', 'Sem natureza'])
      expect(screen.queryByRole('heading', { name: /^Gastos variáveis/ })).toBeNull()
      expect(screen.queryByRole('heading', { name: /^Transferências/ })).toBeNull()
      // a assinatura do cartão e a conta anual ficam cada uma no grupo da sua natureza (não mais por tipo)
      expect(nomes(card(/^Assinaturas/))).toEqual(['Antivírus', 'Streaming'])
      expect(nomes(card(/^Custos fixos/))).toEqual(['Seguro'])
      expect(nomes(card(/^Sem natureza/))).toEqual(['Condomínio do prédio com nome bem comprido'])
    })

    it('transferências ficam num grupo à parte depois das naturezas; "Já terminaram" é o último card; Entradas tem os seus grupos', async () => {
      mock.listarRecorrencias.mockResolvedValue([...regras,
        { ...luz, id: 'r5', tipo: 'income' as const, descricao: 'Salário', categoriaId: 'g2', dia: 5 },
        { ...luz, id: 'r6', tipo: 'transfer' as const, descricao: 'Guardar', categoriaId: null, destinoId: 'a2', dia: 6 },
        { ...luz, id: 'r7', descricao: 'Academia antiga', fim: '2026-09-30' },
      ])
      montar()
      await screen.findByText('Guardar')
      expect(cabecalhos()).toEqual(['Custos fixos', 'Assinaturas', 'Sem natureza', 'Transferências · à parte, fora dos gastos', 'Já terminaram · fora dos totais'])
      // o total das transferências é o do banco (nível medium da conta), não a soma
      expect(screen.getByTestId('total-transferencias').textContent).toBe('R$ 200,00/mês')
      expect(within(card(/^Já terminaram/)).getByText('Academia antiga')).toBeTruthy()
      cleanup()
      montar(ENTRADAS)
      await screen.findByText('Salário', { selector: '[title]' })
      expect(cabecalhos()).toEqual(['Sem natureza'])
      expect(screen.getByTestId('total-grupo-none').textContent).toBe('R$ 5.050,50/mês')
      expect(screen.queryByText('Academia antiga')).toBeNull()
    })

    it('o título de cada grupo traz o total por mês do banco (recurrence_nature_summary), não a soma dos itens', async () => {
      montar()
      await screen.findByText('Streaming')
      expect(within(card(/^Custos fixos/)).getByTestId('total-grupo-fixed').textContent).toBe('R$ 101,01/mês')
      expect(within(card(/^Assinaturas/)).getByTestId('total-grupo-subscription').textContent).toBe('R$ 67,89/mês')
      expect(within(card(/^Sem natureza/)).getByTestId('total-grupo-none').textContent).toBe('R$ 180,18/mês')
      // os totais antigos por tipo e por frequência (recurrence_summary) não aparecem mais na lista
      expect(screen.queryByText(/1\.111,11/)).toBeNull()
      expect(screen.queryByText(/por vez · ≈/)).toBeNull()
    })

    it('sem faixas "MENSAIS · N" nem contadores: a frequência vira selo neutro só fora do mensal, com "por ano" embaixo do valor', async () => {
      montar()
      await screen.findByText('Streaming')
      expect(screen.queryAllByRole('heading', { level: 3 }).filter((h) => /Mensais|Anuais/.test(h.textContent ?? ''))).toEqual([])
      expect(screen.queryByText(/Mensais|Anuais/)).toBeNull()
      const linha = (nome: string) => screen.getByText(nome, { selector: '[title]' }).closest('li')!
      const selo = within(linha('Antivírus')).getByTestId('selo-frequencia')
      expect(selo.textContent).toBe('Anual')
      expect(selo.className).toContain('bg-neutro-fundo')
      expect(within(linha('Antivírus')).getByTestId('por-vez').textContent).toBe('por ano')
      // o valor da linha é o de cada vez, sem ≈/mês calculado na tela
      expect(linha('Antivírus').textContent).toContain('−R$ 120,00')
      expect(linha('Antivírus').textContent).not.toContain('/mês')
      // mensal: nem selo nem "por…"
      expect(within(linha('Streaming')).queryByTestId('selo-frequencia')).toBeNull()
      expect(within(linha('Streaming')).queryByTestId('por-vez')).toBeNull()
      // nada de "· 2" ou "2 recorrentes" na tela
      expect(screen.getAllByRole('heading').map((h) => h.textContent).filter((t) => /· \d+$/.test(t ?? ''))).toEqual([])
      expect(screen.getByTestId('visao-geral').textContent).not.toMatch(/recorrente/)
      expect(document.body.textContent).not.toMatch(/\d+ recorrentes?\b/)
    })

    it('outras frequências também viram selo no singular, com o "por…" certo', async () => {
      mock.listarRecorrencias.mockResolvedValue([
        { ...luz, id: 's1', descricao: 'Feira', unidade: 'week' as const, cada: 1, dia: null, inicio: '2026-11-06' },
        { ...luz, id: 's2', descricao: 'Diarista', unidade: 'week' as const, cada: 2, dia: null, inicio: '2026-11-06' },
        { ...luz, id: 's3', descricao: 'IPVA', cada: 3 },
        { ...luz, id: 's4', descricao: 'Revisão', cada: 6 },
      ])
      montar()
      await screen.findByText('Feira')
      const de = (nome: string) => {
        const li = screen.getByText(nome, { selector: '[title]' }).closest('li')!
        return [within(li).getByTestId('selo-frequencia').textContent, within(li).getByTestId('por-vez').textContent]
      }
      expect(de('Feira')).toEqual(['Semanal', 'por semana'])
      expect(de('Diarista')).toEqual(['Quinzenal', 'por quinzena'])
      expect(de('IPVA')).toEqual(['Trimestral', 'por trimestre'])
      expect(de('Revisão')).toEqual(['Semestral', 'por semestre'])
    })

    it('ordem dentro do grupo: do maior valor para o menor (não pela próxima data)', async () => {
      mock.listarRecorrencias.mockResolvedValue([...regras,
        { ...luz, id: 'r8', descricao: 'Internet', dia: 15, valor: c(12000) },
        { ...luz, id: 'r9', descricao: 'Água', dia: 2, valor: c(25000) },
      ])
      montar()
      await screen.findByText('Internet')
      // Condomínio vence antes (dia 1) mas vale menos que a Água; a Internet (próxima 15/11, a mais perto) é a menor
      expect(nomes(card(/^Sem natureza/))).toEqual(['Água', 'Condomínio do prédio com nome bem comprido', 'Internet'])
      // o anual de R$ 120,00 vem antes do mensal de R$ 55,90 (o valor de cada vez, sem converter)
      expect(nomes(card(/^Assinaturas/))).toEqual(['Antivírus', 'Streaming'])
    })

    it('a linha diz onde é ("Cartão Nubank" ou o nome da conta), já que o grupo não diz mais', async () => {
      montar()
      await screen.findByText('Streaming')
      expect(metas()).toContain('próxima 15/11 · Cartão Nubank · dia 15 · Moradia')
      expect(metas()).toContain('próxima 01/12 · Itaú · dia 1 · Condomínio')
    })

    it('aba Cartão mostra só o que é do cartão; aba Conta, só o de conta; o total do banco por natureza (conta + cartão) some no recorte', async () => {
      const u = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      mock.listarRecorrencias.mockResolvedValue([...regras, { ...luz, id: 'r7', descricao: 'Academia antiga', fim: '2026-09-30' }])
      montar()
      await screen.findByText('Streaming')
      expect(screen.getByRole('button', { name: 'Todos', pressed: true })).toBeTruthy()
      await u.click(screen.getByRole('button', { name: 'Cartão' }))
      expect(screen.getByRole('button', { name: 'Cartão', pressed: true })).toBeTruthy()
      expect(cabecalhos()).toEqual(['Assinaturas'])
      expect(screen.queryByText('Seguro')).toBeNull()
      expect(screen.queryByText('Academia antiga')).toBeNull()
      expect(screen.getByText('Antivírus')).toBeTruthy()
      // o banco não dá o total por natureza só do cartão: a tela não mostra um total que não vale para o recorte
      expect(screen.queryByTestId('total-grupo-subscription')).toBeNull()
      await u.click(screen.getByRole('button', { name: 'Conta' }))
      expect(cabecalhos()).toEqual(['Custos fixos', 'Sem natureza'])
      expect(screen.queryByText('Streaming')).toBeNull()
      expect(screen.getByText('Seguro')).toBeTruthy()
    })

    it('aba sem nenhum card avisa', async () => {
      const u = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      mock.listarRecorrencias.mockResolvedValue(regras.filter((r) => r.tipo !== 'card'))
      montar()
      await screen.findByText('Seguro')
      await u.click(screen.getByRole('button', { name: 'Cartão' }))
      expect(screen.getByText('Nenhum recorrente no cartão.')).toBeTruthy()
      expect(cabecalhos()).toEqual([])
    })

    it('item compacto: título, valor numa coluna própria, uma linha de metadados e um link para o lugar de mudar', async () => {
      montar()
      const titulo = await screen.findByText('Condomínio do prédio com nome bem comprido')
      expect(titulo.className).toContain('line-clamp-2') // até 2 linhas (17/11: os dois Googles só se distinguem no fim do nome)
      const li = titulo.closest('li')!
      const valor = li.querySelector('span.tabular-nums')!
      expect(valor.textContent).toBe('−R$ 180,00')
      expect(valor.className).toContain('whitespace-nowrap')
      // no máximo 2 linhas de texto (nome e metadados), as duas dentro do botão da natureza
      expect(li.querySelectorAll('button > span.block, button > span.flex')).toHaveLength(2)
      // só consulta: sem Editar, Excluir nem menu ⋯; um link leva ao lugar onde se muda
      expect(screen.queryByRole('button', { name: 'Editar' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Excluir' })).toBeNull()
      expect(screen.queryByRole('button', { name: /^Ações de/ })).toBeNull()
      expect(within(li).getByRole('button', { name: /^Natureza de Condomínio do prédio com nome bem comprido: sugerida pelo app\. Corrigir/ })).toBeTruthy()
      // "Gerenciar" escrito (antes só "›"); conta abre Lançamentos no mês da próxima ocorrência
      const gerenciar = within(li).getByRole('link', { name: 'Gerenciar Condomínio do prédio com nome bem comprido em Lançamentos' })
      expect(gerenciar.textContent).toContain('Gerenciar')
      expect(gerenciar.getAttribute('href')).toMatch(/^\/lancamentos\?mes=\d{4}-\d{2}$/)
    })

    it('visual (17/11/2026): ícone da categoria, próxima data num selo verde e a ajuda de onde editar ou encerrar', async () => {
      montar()
      const titulo = await screen.findByText('Condomínio do prédio com nome bem comprido')
      const li = titulo.closest('li')!
      expect(li.querySelector('[data-icone]')).not.toBeNull()
      const selo = within(li).getByTestId('selo-proxima')
      expect(selo.textContent).toMatch(/^próxima /)
      expect(selo.className).toContain('bg-agendado-fundo')
      expect(screen.getByTestId('ajuda-gerenciar').textContent).toMatch(/Cancelar cobrança → esta e as próximas.*Parar de repetir a partir daqui/)
    })

    it('mostra só a subcategoria; o caminho completo fica no title e para o leitor de tela', async () => {
      montar()
      await screen.findByText('Streaming')
      const meta = screen.getAllByTestId('meta-recorrente').find((p) => p.textContent?.includes('dia 1 '))!
      expect(metas()).toContain('próxima 01/12 · Itaú · dia 1 · Condomínio')
      expect(meta.querySelector('[aria-hidden="true"]')?.textContent).toBe('Condomínio')
      expect(meta.querySelector('.sr-only')?.textContent).toBe('Moradia › Condomínio')
      expect(meta.getAttribute('title')).toContain('Moradia › Condomínio')
      // auditoria 5h: a linha é o bloco de contenção do sr-only (absolute); sem isso ele vazava a 390px e alargava a página
      expect(meta.className).toMatch(/(^| )relative( |$)/)
    })

    it('a explicação completa fica atrás do (i), que abre e fecha', async () => {
      const u = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      montar()
      const info = await screen.findByRole('button', { name: 'Como funcionam os recorrentes' })
      expect(info.getAttribute('aria-expanded')).toBe('false')
      expect(screen.queryByText(/os próximos 12 meses aparecem/)).toBeNull() // fechado: o texto longo não está na tela
      await u.click(info)
      expect(info.getAttribute('aria-expanded')).toBe('true')
      const painel = document.getElementById(info.getAttribute('aria-controls')!)!
      expect(painel.textContent).toContain('equivalente por mês')
      expect(painel.textContent).toContain('os próximos 12 meses aparecem')
      await u.keyboard('{Escape}')
      expect(info.getAttribute('aria-expanded')).toBe('false')
      expect(screen.queryByText(/os próximos 12 meses aparecem/)).toBeNull()
      expect(document.activeElement).toBe(info)
    })

    it('recorrente em outra moeda: avisa que fica fora dos totais em reais', async () => {
      mock.listarContas.mockResolvedValue({
        contas: [{ id: 'a1', nome: 'Itaú', tipo: 'checking', saldoInicial: c(0), abertura: '2026-01-01', ativa: true, saldo: c(0), moeda: 'BRL' },
          { id: 'a3', nome: 'Conta em euro', tipo: 'checking', saldoInicial: c(0), abertura: '2026-01-01', ativa: true, saldo: c(0), moeda: 'EUR' }],
        total: c(0),
      })
      mock.listarRecorrencias.mockResolvedValue([...regras, { ...luz, id: 'r9', descricao: 'Em euro', contaId: 'a3' }])
      montar()
      expect(await screen.findByText('1 recorrente em outra moeda fica fora dos totais (que são em reais).')).toBeTruthy()
    })
  })
})

describe('Recorrentes: natureza', () => {

  it('cada regra fica no grupo da sua natureza; as sem classificação vão para "Sem natureza" (o grupo substitui o selo)', async () => {
    mock.listarRecorrencias.mockResolvedValue([
      { ...luz, nature: 'fixed' as const },
      { ...luz, id: 'r2', descricao: 'Streaming', nature: 'subscription' as const },
      { ...luz, id: 'r3', descricao: 'Mercado', nature: null },
      { ...luz, id: 'r4', descricao: 'Água' },
    ])
    montar()
    await screen.findByTitle('Luz')
    const grupo = (nome: string) => screen.getByRole('region', { name: nome })
    expect(within(grupo('Custos fixos')).getByTitle('Luz')).toBeTruthy()
    expect(within(grupo('Assinaturas')).getByTitle('Streaming')).toBeTruthy()
    expect(within(grupo('Sem natureza')).getByTitle('Mercado')).toBeTruthy()
    expect(within(grupo('Sem natureza')).getByTitle('Água')).toBeTruthy()
    // dentro de um grupo da natureza, o selo da natureza seria repetido: saiu
    expect(screen.queryByTestId('selo-natureza')).toBeNull()
  })
})

describe('Recorrentes: resumo e filtro por natureza', () => {
  const internet = { ...luz, id: 'r2', descricao: 'Internet', valor: c(12000) }
  const seguro = { ...luz, id: 'r3', descricao: 'Seguro', valor: c(120000), cada: 12 }
  const netflix = {
    ...luz, id: 'r4', tipo: 'card' as const, descricao: 'Netflix', valor: c(3990), contaId: null, cartaoId: 'k1', nature: 'subscription' as const,
  }
  const regras = [{ ...luz, nature: 'fixed' as const }, internet, seguro, netflix]
  // números do banco: o front só mostra (sentinelas diferentes de qualquer soma da tela)
  const porNatureza = [
    { natureza: 'all' as const, tipo: 'expense' as const, qtde: 4, porMes: c(777700) },
    { natureza: 'fixed' as const, tipo: 'expense' as const, qtde: 1, porMes: c(18000) },
    { natureza: 'none' as const, tipo: 'expense' as const, qtde: 2, porMes: c(22000) },
    { natureza: 'subscription' as const, tipo: 'expense' as const, qtde: 1, porMes: c(3990) },
  ]
  const grupo = () => screen.getByRole('group', { name: 'Filtrar por natureza' })
  const nomesNaLista = () => screen.getAllByTestId('meta-recorrente').length

  it('com uma natureza só (tudo "Sem natureza"), a legenda mostra o total mas não vira filtro (filtrar daria a mesma lista)', async () => {
    mock.listarRecorrencias.mockResolvedValue([luz, internet])
    mock.resumoPorNatureza.mockResolvedValue([{ natureza: 'none' as const, tipo: 'expense' as const, qtde: 2, porMes: c(30303) }])
    montar()
    await screen.findByText('Internet')
    expect(screen.queryByRole('group', { name: 'Filtrar por natureza' })).toBeNull()
    expect(screen.getByTestId('natureza-none').tagName).not.toBe('BUTTON')
    expect(screen.getByTestId('natureza-none').textContent).toBe('Sem naturezaR$ 303,03/mês')
  })

  it('legenda no card do topo: só as naturezas que existem, na ordem fixa, com o total do banco e sem contador nem exemplos', async () => {
    mock.listarRecorrencias.mockResolvedValue(regras)
    mock.resumoPorNatureza.mockResolvedValue(porNatureza)
    montar()
    await screen.findByText('Internet')
    expect(within(screen.getByTestId('resumo-do-mes')).getByRole('group', { name: 'Filtrar por natureza' })).toBe(grupo())
    const ids = within(grupo()).getAllByRole('button').map((b) => b.getAttribute('data-testid'))
    expect(ids).toEqual(['natureza-fixed', 'natureza-subscription', 'natureza-none'])
    expect(screen.queryByTestId('natureza-variable')).toBeNull() // ninguém é "variável": a linha não aparece
    expect(screen.getByTestId('natureza-fixed').textContent).toBe('Custos fixosR$ 180,00/mês')
    expect(screen.getByTestId('natureza-subscription').textContent).toBe('AssinaturasR$ 39,90/mês')
    expect(screen.getByTestId('natureza-none').textContent).toBe('Sem naturezaR$ 220,00/mês')
  })

  it('a barra é dividida pelas naturezas na proporção do valor do banco, com uma cor fixa (não de status) por natureza', async () => {
    mock.listarRecorrencias.mockResolvedValue(regras)
    mock.resumoPorNatureza.mockResolvedValue(porNatureza)
    montar()
    await screen.findByText('Internet')
    const barra = screen.getByTestId('barra-naturezas')
    expect(barra.getAttribute('aria-hidden')).toBe('true') // só desenho: os valores estão na legenda
    expect(barra.className).toContain('gap-[2px]')
    const partes = Array.from(barra.children) as HTMLElement[]
    expect(partes.map((p) => p.dataset.natureza)).toEqual(['fixed', 'subscription', 'none'])
    expect(partes.map((p) => p.style.flexGrow)).toEqual(['18000', '3990', '22000'])
    const cores = partes.map((p) => p.style.backgroundColor)
    expect(new Set(cores).size).toBe(3)
    // a bolinha da legenda tem a mesma cor da parte da barra
    expect((screen.getByTestId('natureza-fixed').querySelector('span[aria-hidden]') as HTMLElement).style.backgroundColor).toBe(cores[0])
  })

  it('tocar numa linha da legenda filtra a lista pelo grupo da natureza (com o total do banco no título)', async () => {
    const u = userEvent.setup()
    mock.listarRecorrencias.mockResolvedValue(regras)
    mock.resumoPorNatureza.mockResolvedValue(porNatureza)
    montar()
    await screen.findByText('Internet')
    await u.click(screen.getByTestId('natureza-fixed'))
    expect(nomesNaLista()).toBe(1)
    expect(screen.getByTitle('Luz')).toBeTruthy()
    expect(screen.queryByTitle('Internet')).toBeNull()
    expect(screen.getByTestId('total-grupo-fixed').textContent).toBe('R$ 180,00/mês')
    expect(screen.queryByRole('region', { name: 'Sem natureza' })).toBeNull()
    expect(screen.getByTestId('natureza-fixed').getAttribute('aria-pressed')).toBe('true')
  })

  it('"Sem natureza" mostra as regras sem classificação; tocar de novo limpa o filtro', async () => {
    const u = userEvent.setup()
    mock.listarRecorrencias.mockResolvedValue(regras)
    mock.resumoPorNatureza.mockResolvedValue(porNatureza)
    montar()
    await screen.findByText('Internet')
    await u.click(screen.getByTestId('natureza-none'))
    expect(nomesNaLista()).toBe(2)
    expect(screen.getByTitle('Internet')).toBeTruthy()
    expect(screen.getByTitle('Seguro')).toBeTruthy()
    expect(screen.getByTestId('total-grupo-none').textContent).toBe('R$ 220,00/mês')
    await u.click(screen.getByTestId('natureza-none'))
    expect(nomesNaLista()).toBe(4)
    expect(screen.getByTestId('natureza-none').getAttribute('aria-pressed')).toBe('false')
  })

  it('tocar na legenda estando em Projeção volta para a lista já filtrada', async () => {
    const u = userEvent.setup()
    mock.listarRecorrencias.mockResolvedValue(regras)
    mock.resumoPorNatureza.mockResolvedValue(porNatureza)
    montar()
    await screen.findByText('Internet')
    await u.click(screen.getByRole('tab', { name: 'Projeção' }))
    expect(screen.queryByTitle('Luz')).toBeNull()
    await u.click(screen.getByTestId('natureza-fixed'))
    expect(screen.getByRole('tab', { name: 'Recorrentes' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByTitle('Luz')).toBeTruthy()
    expect(nomesNaLista()).toBe(1)
  })

  it('transferência não tem natureza: sai da lista com qualquer filtro (inclusive "Sem natureza")', async () => {
    const u = userEvent.setup()
    const transf = { ...luz, id: 'r5', tipo: 'transfer' as const, descricao: 'Reserva', destinoId: 'a2', categoriaId: null }
    mock.listarRecorrencias.mockResolvedValue([{ ...luz, nature: 'fixed' as const }, internet, transf])
    mock.resumoPorNatureza.mockResolvedValue(porNatureza)
    montar()
    await screen.findByTitle('Internet')
    expect(screen.getByText('Reserva')).toBeTruthy()
    await u.click(screen.getByTestId('natureza-none'))
    expect(screen.queryByText('Reserva')).toBeNull()
    expect(screen.getByTitle('Internet')).toBeTruthy()
    await u.click(screen.getByTestId('natureza-fixed'))
    expect(screen.queryByText('Reserva')).toBeNull()
    await u.click(screen.getByTestId('natureza-fixed'))
    expect(screen.getByText('Reserva')).toBeTruthy()
  })

  it('trocar de visão limpa o filtro de natureza (cada visão tem as suas naturezas)', async () => {
    const u = userEvent.setup()
    mock.listarRecorrencias.mockResolvedValue([...regras, { ...luz, id: 'r9', tipo: 'income' as const, descricao: 'Salário', categoriaId: 'g2' }])
    mock.resumoPorNatureza.mockResolvedValue(porNatureza)
    montar()
    await screen.findByText('Internet')
    await u.click(screen.getByTestId('natureza-fixed'))
    expect(screen.queryByRole('region', { name: 'Sem natureza' })).toBeNull()
    await u.click(screen.getByRole('tab', { name: /^Entradas/ }))
    expect(screen.queryByTestId('natureza-fixed')).toBeNull() // a legenda de Entradas tem as naturezas de entrada
    expect(within(await screen.findByRole('region', { name: 'Sem natureza' })).getByTitle('Salário')).toBeTruthy()
    await u.click(screen.getByRole('tab', { name: /^Saídas/ }))
    expect(screen.getByTestId('natureza-fixed').getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByRole('region', { name: 'Sem natureza' })).toBeTruthy()
  })

  it('se o resumo por natureza falhar, a tela segue, o bloco fica sem total e um aviso diz o que faltou', async () => {
    mock.listarRecorrencias.mockResolvedValue(regras)
    mock.resumoPorNatureza.mockRejectedValue({ code: 'PGRST202' })
    montar()
    expect(await screen.findByText('Internet')).toBeTruthy()
    // sem o resumo do banco a legenda fica sem total ("—"), sem barra e sem total nos grupos; a lista e os filtros seguem
    expect(screen.getByTestId('natureza-none').textContent).toContain('—')
    expect(screen.queryByTestId('barra-naturezas')).toBeNull()
    expect(screen.queryByTestId('total-grupo-none')).toBeNull()
    expect(screen.getByTestId('recorrentes-blocos-falharam').textContent).toMatch(/Não foi possível carregar: resumo por natureza/)
  })

  it('cada consulta secundária que falha entra no aviso (nada vira "sem dados" em silêncio)', async () => {
    mock.listarRecorrencias.mockResolvedValue(regras)
    mock.resumoVisaoGeral.mockRejectedValue(new Error('x'))
    mock.listarProventosPrevistos.mockRejectedValue(new Error('x'))
    mock.proximasDatasDasContas.mockRejectedValue(new Error('x'))
    mock.resumoParcelasDoMes.mockRejectedValue(new Error('x'))
    mock.faturaDaProximaCobranca.mockRejectedValue(new Error('x'))
    montar()
    const aviso = (await screen.findByTestId('recorrentes-blocos-falharam')).textContent ?? ''
    for (const bloco of ['visão por mês e por ano', 'proventos previstos', 'próxima cobrança das contas', 'card Parcelas & carnês', 'fatura da próxima cobrança']) {
      expect(aviso).toContain(bloco)
    }
  })

  it('sem falha nenhuma, não há aviso', async () => {
    mock.listarRecorrencias.mockResolvedValue(regras)
    montar()
    await screen.findByText('Internet')
    expect(screen.queryByTestId('recorrentes-blocos-falharam')).toBeNull()
  })
})


describe('Recorrentes: só informativa, separada em Saídas e Entradas', () => {
  const salario = { ...luz, id: 'r5', tipo: 'income' as const, descricao: 'Salário', categoriaId: 'g2', dia: 5 }
  const netflix = { ...luz, id: 'r8', tipo: 'card' as const, descricao: 'Netflix', contaId: null, cartaoId: 'k1', dia: 20 }
  const guardar = { ...luz, id: 'r6', tipo: 'transfer' as const, descricao: 'Guardar', categoriaId: null, destinoId: 'a2', dia: 6 }

  it('não tem como cadastrar, editar nem excluir: sem botão de novo, sem menu e sem formulário', async () => {
    mock.listarRecorrencias.mockResolvedValue([luz, netflix])
    montar()
    await screen.findByText('Luz')
    expect(screen.queryByRole('button', { name: /Novo recorrente|Cadastrar/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Ações de/ })).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('menuitem')).toBeNull()
    // diz onde fazer cada coisa
    expect(screen.getByText(/só para consulta/)).toBeTruthy()
    expect(screen.getAllByRole('link', { name: 'Lançamentos' }).length).toBeGreaterThan(0)
  })

  it('são duas visões: Saídas mostra cartão, conta e transferências (à parte, no fim); Entradas mostra só as receitas', async () => {
    mock.listarRecorrencias.mockResolvedValue([guardar, salario, netflix, luz])
    const u = userEvent.setup()
    montar()
    await screen.findByText('Netflix')
    // visão Saídas (a padrão)
    expect(screen.getByRole('tab', { name: /^Saídas/ }).getAttribute('aria-selected')).toBe('true')
    const titulos = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    expect(within(screen.getByRole('region', { name: 'Sem natureza' })).getByTitle('Netflix')).toBeTruthy()
    expect(within(screen.getByRole('region', { name: 'Sem natureza' })).getByTitle('Luz')).toBeTruthy()
    expect(titulos.indexOf('Sem natureza')).toBeLessThan(titulos.indexOf('Transferências · à parte, fora dos gastos'))
    expect(titulos.some((t) => t?.startsWith('Receitas'))).toBe(false)
    expect(screen.queryByTitle('Salário')).toBeNull()
    // visão Entradas
    await u.click(screen.getByRole('tab', { name: /^Entradas/ }))
    expect(screen.getByRole('tab', { name: /^Entradas/ }).getAttribute('aria-selected')).toBe('true')
    expect(await screen.findByTitle('Salário')).toBeTruthy()
    expect(screen.queryByText('Netflix')).toBeNull()
    expect(screen.queryByText('Guardar')).toBeNull()
    expect(screen.queryByRole('tablist', { name: 'Seções de Recorrentes' })).toBeNull() // projeção e parcelas são das saídas
  })

  it('a visão vai na URL (?v=entradas): abre direto em Entradas, com só as entradas', async () => {
    mock.listarRecorrencias.mockResolvedValue([salario, luz])
    montar(ENTRADAS)
    expect(await screen.findByTitle('Salário')).toBeTruthy()
    expect(screen.getByRole('tab', { name: /^Entradas/ }).getAttribute('aria-selected')).toBe('true')
    expect(screen.queryByTitle('Luz')).toBeNull()
  })

  it('o card do topo: "Sai ≈" e "Entra ≈" do banco lado a lado, que são as abas Saídas/Entradas; as setas do teclado trocam', async () => {
    mock.listarRecorrencias.mockResolvedValue([salario, luz])
    mock.resumoVisaoGeral.mockResolvedValue([
      { tipo: 'expense', recorte: 'all', qtde: 1, sugeridas: 1, porMes: c(18000), porAno: c(216000) },
      { tipo: 'income', recorte: 'all', qtde: 1, sugeridas: 0, porMes: c(500000), porAno: c(6000000) },
    ])
    const u = userEvent.setup()
    montar()
    await screen.findByTestId('visao-saidas-mes')
    const card = screen.getByTestId('resumo-do-mes')
    expect(within(card).getByRole('heading', { name: 'Todo mês, com o que se repete' })).toBeTruthy()
    expect(within(card).getByRole('tablist', { name: 'Saídas ou entradas' })).toBeTruthy()
    const sai = screen.getByRole('tab', { name: /^Saídas/ })
    expect(sai.textContent).toContain('Sai ≈')
    expect(screen.getByRole('tab', { name: /^Entradas/ }).textContent).toContain('Entra ≈')
    expect(screen.getByTestId('visao-saidas-mes').textContent).toBe('R$ 180,00')
    expect(screen.getByTestId('visao-saidas-ano').textContent).toBe('R$ 2.160,00 por ano')
    expect(screen.getByTestId('visao-entradas-mes').textContent).toBe('R$ 5.000,00')
    // vermelho e azul; text-xl no celular e text-2xl do sm em diante (a 390 px o 2xl não cabe lado a lado)
    expect(screen.getByTestId('visao-saidas-mes').className).toContain('text-prejuizo')
    expect(screen.getByTestId('visao-entradas-mes').className).toContain('text-lucro')
    expect(screen.getByTestId('visao-saidas-mes').className).toMatch(/(^| )text-xl( |$)/)
    expect(screen.getByTestId('visao-saidas-mes').className).toContain('sm:text-2xl')
    expect(screen.getByTestId('nota-aproximado').textContent).toBe('≈ por mês: anuais divididos por 12; variáveis pelo valor cadastrado (a conta de verdade pode mudar).')
    // abas: só a escolhida entra no Tab; as setas trocam e o foco vai junto
    expect(sai.getAttribute('tabindex')).toBe('0')
    expect(screen.getByRole('tab', { name: /^Entradas/ }).getAttribute('tabindex')).toBe('-1')
    sai.focus()
    await u.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: /^Entradas/ }).getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: /^Entradas/ }))
    await u.keyboard('{ArrowLeft}')
    expect(screen.getByRole('tab', { name: /^Saídas/ }).getAttribute('aria-selected')).toBe('true')
  })

  it('visão Entradas sem nenhuma receita avisa, em vez de ficar em branco', async () => {
    mock.listarRecorrencias.mockResolvedValue([luz])
    montar(ENTRADAS)
    expect(await screen.findByText('Nenhum recorrente de entrada.')).toBeTruthy()
  })

  it('cada item leva ao lugar de mudar: assinatura de cartão → a fatura do cartão; conta → Lançamentos', async () => {
    mock.listarRecorrencias.mockResolvedValue([luz, netflix])
    montar()
    await screen.findByText('Netflix')
    const cartao = screen.getByRole('link', { name: 'Gerenciar Netflix em Cartões' }).getAttribute('href')!
    expect(cartao).toContain('/cartoes')
    expect(cartao).toContain('k1')
    // conta: o mês da próxima ocorrência (a Luz vence todo dia 10)
    expect(screen.getByRole('link', { name: 'Gerenciar Luz em Lançamentos' }).getAttribute('href')).toMatch(/^\/lancamentos\?mes=\d{4}-\d{2}$/)
  })

  it('sem nenhum recorrente, aponta para Lançamentos em vez de oferecer um formulário', async () => {
    montar()
    expect(await screen.findByText('Nenhum recorrente ainda')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Ir para Lançamentos' }).getAttribute('href')).toBe('/lancamentos')
  })
})


describe('Recorrentes: visão geral por mês e por ano, fixo × variável sugerido (migration 116)', () => {
  const linha = (tipo: 'expense' | 'income', recorte: 'all' | 'fixed' | 'variable', qtde: number, sugeridas: number, mes: number, ano: number) =>
    ({ tipo, recorte, qtde, sugeridas, porMes: c(mes), porAno: c(ano) })
  const visao = [
    linha('expense', 'all', 7, 5, 241752, 2853023),
    linha('expense', 'fixed', 5, 4, 207752, 2493023),
    linha('expense', 'variable', 2, 1, 30000, 360000),
    linha('income', 'all', 2, 0, 550000, 6600000),
  ]
  beforeEach(() => { mock.listarRecorrencias.mockResolvedValue([luz]) })

  it('mostra quanto gasta e quanto entra, por mês e por ano, com os números do banco', async () => {
    mock.resumoVisaoGeral.mockResolvedValue(visao)
    montar()
    await screen.findByTestId('visao-geral')
    expect(screen.getByTestId('visao-saidas-mes').textContent).toBe('R$ 2.417,52')
    expect(screen.getByTestId('visao-saidas-ano').textContent).toBe('R$ 28.530,23 por ano')
    expect(screen.getByTestId('visao-entradas-mes').textContent).toBe('R$ 5.500,00')
    expect(screen.getByTestId('visao-entradas-ano').textContent).toBe('R$ 66.000,00 por ano')
    // sem "7 recorrentes" (os contadores saíram da tela)
    expect(screen.getByTestId('visao-geral').textContent).not.toMatch(/recorrente/)
  })

  it('o card novo substitui o fixo × variável, a grade de naturezas e o "Por cartão e por conta"', async () => {
    mock.resumoVisaoGeral.mockResolvedValue(visao)
    mock.resumoRecorrencias.mockResolvedValue([
      { nivel: 'target', meio: 'card', alvoId: 'k1', alvoNome: 'Nubank', tipo: 'expense', frequencia: null, qtde: 1, porOcorrencia: c(100), porMes: c(100) },
    ])
    montar()
    await screen.findByTestId('visao-geral')
    expect(screen.queryByTestId('visao-fixo')).toBeNull()
    expect(screen.queryByTestId('visao-variável')).toBeNull()
    expect(screen.queryByText(/A natureza que você marcou vale mais/)).toBeNull()
    expect(screen.queryByTestId('cartoes-natureza')).toBeNull()
    expect(screen.queryByText('Por cartão e por conta')).toBeNull()
  })

  it('sem a linha de entradas no banco, o "Entra" mostra "sem total ainda" (a tela não inventa)', async () => {
    mock.resumoVisaoGeral.mockResolvedValue([linha('expense', 'all', 2, 0, 20000, 240000), linha('expense', 'fixed', 2, 0, 20000, 240000)])
    montar()
    await screen.findByTestId('visao-geral')
    expect(screen.getByTestId('visao-saidas-mes').textContent).toBe('R$ 200,00')
    expect(screen.queryByTestId('visao-entradas-mes')).toBeNull()
    expect(screen.getByRole('tab', { name: /^Entradas/ }).textContent).toContain('sem total ainda')
  })

  it('consulta da visão por mês e por ano falhou (migration 116): a tela cai no resumo de antes e avisa', async () => {
    mock.resumoVisaoGeral.mockRejectedValue({ code: 'PGRST202' })
    mock.resumoRecorrencias.mockResolvedValue([
      { nivel: 'medium', meio: 'account', alvoId: null, alvoNome: null, tipo: 'expense', frequencia: null, qtde: 1, porOcorrencia: c(18000), porMes: c(18000) },
    ])
    montar()
    await screen.findByText('Luz')
    // as duas visões continuam: sem o resumo do banco o seletor só não mostra os totais ("sem total ainda")
    expect(screen.getByRole('tab', { name: /^Saídas/ }).textContent).toContain('sem total ainda')
    expect(screen.getByRole('tab', { name: /^Entradas/ }).textContent).toContain('sem total ainda')
    expect(screen.queryByTestId('visao-saidas-mes')).toBeNull()
    expect(screen.getByTestId('recorrentes-blocos-falharam').textContent).toContain('visão por mês e por ano')
  })
})


describe('Recorrentes: proventos previstos de investimentos (migration 117)', () => {
  const previstos = [
    { ativoId: 'a1', nome: 'FII de teste', qtde: 12, proximaData: '2026-12-10', proximoValor: c(8550), total12m: c(102600) },
    { ativoId: 'a2', nome: 'Ação de teste', qtde: 4, proximaData: '2027-01-15', proximoValor: c(4000), total12m: c(16000) },
  ]

  it('mostra um card com os ativos: próximo provento e o total de 12 meses, do banco; avisa que é previsão fora do total', async () => {
    mock.listarRecorrencias.mockResolvedValue([luz])
    mock.listarProventosPrevistos.mockResolvedValue(previstos)
    montar(ENTRADAS)
    const lista = await screen.findByTestId('proventos-previstos')
    expect(screen.getByRole('heading', { name: 'Proventos previstos' })).toBeTruthy() // dentro de Entradas, ao lado das receitas
    expect(within(lista).getByText('FII de teste')).toBeTruthy()
    expect(lista.textContent).toContain('+R$ 1.026,00')
    expect(lista.textContent).toContain('R$ 85,50')
    expect(lista.textContent).toContain('12 previstos em 12 meses')
    expect(lista.textContent).toContain('4 previstos em 12 meses')
    expect(screen.getByText(/Fora do total "Vai entrar"/)).toBeTruthy()
    expect(within(lista).getByRole('link', { name: 'Abrir FII de teste em Investimentos' }).getAttribute('href')).toBe('/investimentos')
  })

  it('só com proventos previstos (sem nenhum recorrente), a tela não diz "Nenhum recorrente ainda"', async () => {
    mock.listarRecorrencias.mockResolvedValue([])
    mock.listarProventosPrevistos.mockResolvedValue(previstos)
    const u = userEvent.setup()
    montar()
    // a visão Entradas aparece mesmo sem nenhum recorrente: é onde os proventos previstos moram
    await u.click(await screen.findByRole('tab', { name: /^Entradas/ }))
    await screen.findByTestId('proventos-previstos')
    expect(screen.queryByText('Nenhum recorrente ainda')).toBeNull()
    expect(screen.queryByText(/Nenhum recorrente de entrada/)).toBeNull()
  })

  it('proventos só existem na visão Entradas; em Saídas não aparecem, e filtrar por natureza (de entrada) também os esconde', async () => {
    mock.listarRecorrencias.mockResolvedValue([
      { ...luz, id: 'r2', tipo: 'income' as const, descricao: 'Reembolso', categoriaId: 'g2', nature: 'reimbursement' as const },
      { ...luz, id: 'r3', tipo: 'income' as const, descricao: 'Salário', categoriaId: 'g2' },
    ])
    mock.listarProventosPrevistos.mockResolvedValue(previstos)
    const u = userEvent.setup()
    montar()
    await screen.findByRole('tab', { name: /^Entradas/ })
    expect(screen.queryByTestId('proventos-previstos')).toBeNull() // visão Saídas
    await u.click(screen.getByRole('tab', { name: /^Entradas/ }))
    await screen.findByTestId('proventos-previstos')
    await u.click(screen.getByTestId('natureza-reimbursement'))
    expect(screen.queryByTestId('proventos-previstos')).toBeNull()
  })

  it('consulta de proventos falhou (migration 117): a tela segue sem o card e avisa', async () => {
    mock.listarRecorrencias.mockResolvedValue([luz])
    mock.listarProventosPrevistos.mockRejectedValue({ code: 'PGRST202' })
    montar(ENTRADAS)
    await screen.findByRole('tab', { name: /^Entradas/ })
    expect(screen.queryByTestId('proventos-previstos')).toBeNull()
    expect(screen.getByTestId('recorrentes-blocos-falharam').textContent).toContain('proventos previstos')
  })
})


describe('Recorrentes: abas (assinaturas e contas, projeção, parcelas ativas)', () => {
  beforeEach(() => { mock.listarRecorrencias.mockResolvedValue([luz]) })

  it('abre em "Recorrentes"; projeção e parcelas não carregam até a aba abrir', async () => {
    montar()
    expect(await screen.findByText('Luz')).toBeTruthy()
    const abas = within(screen.getByRole('tablist', { name: 'Seções de Recorrentes' })).getAllByRole('tab').map((a) => a.textContent)
    expect(abas).toEqual(['Recorrentes', 'Projeção', 'Parcelas'])
    expect(screen.getByRole('tab', { name: 'Recorrentes' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tabpanel').id).toBe('painel-lista')
    expect(screen.queryByRole('heading', { name: 'Parcelas ativas' })).toBeNull()
    expect(screen.queryByText('Projeção de compromissos')).toBeNull()
    expect(mock.listarParcelasAtivas).not.toHaveBeenCalled()
  })

  it('clicar troca o painel: só o da aba escolhida aparece', async () => {
    const u = userEvent.setup()
    montar()
    await screen.findByText('Luz')
    await u.click(screen.getByRole('tab', { name: 'Projeção' }))
    expect(screen.getByRole('tab', { name: 'Projeção' }).getAttribute('aria-selected')).toBe('true')
    expect(await screen.findByText('Projeção de compromissos')).toBeTruthy()
    expect(screen.queryByText('Luz')).toBeNull()
    await u.click(screen.getByRole('tab', { name: 'Parcelas' }))
    expect(await screen.findByRole('heading', { name: 'Parcelas ativas' })).toBeTruthy()
    expect(screen.queryByText('Projeção de compromissos')).toBeNull()
  })

  it('setas movem entre as abas e o foco acompanha', async () => {
    const u = userEvent.setup()
    montar()
    await screen.findByText('Luz')
    screen.getByRole('tab', { name: 'Recorrentes' }).focus()
    await u.keyboard('{ArrowRight}')
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Projeção' }))
    expect(screen.getByRole('tab', { name: 'Projeção' }).getAttribute('aria-selected')).toBe('true')
    await u.keyboard('{ArrowLeft}{ArrowLeft}')
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Parcelas' })) // volta dando a volta
  })

  it('sem nenhum recorrente, as abas de projeção e parcelas continuam úteis (a tela não esconde tudo)', async () => {
    mock.listarRecorrencias.mockResolvedValue([])
    montar()
    expect(await screen.findByText('Nenhum recorrente ainda')).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Parcelas' })).toBeTruthy()
  })
})


describe('Recorrentes: corrigir a natureza (a única edição da página)', () => {
  const streaming = { ...luz, id: 'r2', tipo: 'card' as const, descricao: 'Streaming', contaId: null, cartaoId: 'k1', nature: 'subscription' as const }
  const salario = { ...luz, id: 'r3', tipo: 'income' as const, descricao: 'Salário', categoriaId: 'g2' }
  const guardar = { ...luz, id: 'r4', tipo: 'transfer' as const, descricao: 'Guardar', categoriaId: null, destinoId: 'a2' }
  const abrirNatureza = async (u: ReturnType<typeof userEvent.setup>, nome: string) => {
    await u.click(await screen.findByRole('button', { name: new RegExp(`^Natureza de ${nome}:`) }))
    return screen.findByRole('dialog', { name: `Natureza · ${nome}` })
  }

  it('tocar na linha abre um card no meio com as naturezas do tipo e a opção de o app sugerir; a atual vem marcada', async () => {
    mock.listarRecorrencias.mockResolvedValue([streaming, luz])
    const u = userEvent.setup()
    montar()
    const card = await abrirNatureza(u, 'Streaming')
    expect(card.parentElement!.className).toContain('items-center')
    expect(within(card).getAllByRole('radio').map((r) => r.parentElement!.textContent))
      .toEqual(['Custo fixo', 'Assinatura ou app', 'Gasto variável', 'Deixar o app sugerir'])
    expect(within(card).getByRole('radio', { name: 'Assinatura ou app' })).toHaveProperty('checked', true)
    expect((within(card).getByRole('button', { name: 'Salvar' }) as HTMLButtonElement).disabled).toBe(true) // nada mudou
  })

  it('escolher e salvar manda a natureza ao banco, fecha o card e recarrega a lista (os totais do topo se refazem)', async () => {
    mock.listarRecorrencias.mockResolvedValue([luz])
    const u = userEvent.setup()
    montar()
    const card = await abrirNatureza(u, 'Luz')
    await u.click(within(card).getByRole('radio', { name: 'Gasto variável' }))
    await u.click(within(card).getByRole('button', { name: 'Salvar' }))
    expect(mock.definirNaturezaRecorrencia).toHaveBeenCalledWith('r1', 'variable')
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(mock.listarRecorrencias).toHaveBeenCalledTimes(2)
    expect(mock.resumoVisaoGeral).toHaveBeenCalledTimes(2)
  })

  it('"Deixar o app sugerir" tira a marcação (null)', async () => {
    mock.listarRecorrencias.mockResolvedValue([streaming])
    const u = userEvent.setup()
    montar()
    const card = await abrirNatureza(u, 'Streaming')
    await u.click(within(card).getByRole('radio', { name: 'Deixar o app sugerir' }))
    await u.click(within(card).getByRole('button', { name: 'Salvar' }))
    expect(mock.definirNaturezaRecorrencia).toHaveBeenCalledWith('r2', null)
  })

  it('receita só oferece ressarcimento (e "sem natureza"); transferência não tem natureza (a linha nem é botão)', async () => {
    mock.listarRecorrencias.mockResolvedValue([salario, guardar])
    const u = userEvent.setup()
    montar(ENTRADAS)
    const card = await abrirNatureza(u, 'Salário')
    expect(within(card).getAllByRole('radio').map((r) => r.parentElement!.textContent)).toEqual(['Ressarcimento a receber', 'Sem natureza'])
    await u.click(within(card).getByRole('button', { name: 'Cancelar' }))
    cleanup()
    montar() // a transferência é uma saída (à parte) e não tem natureza: a linha nem é botão
    expect(await screen.findByText('Guardar')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Natureza de Guardar/ })).toBeNull()
  })

  it('recusa do banco aparece dentro do card, que continua aberto; Cancelar não grava nada', async () => {
    mock.listarRecorrencias.mockResolvedValue([luz])
    mock.definirNaturezaRecorrencia.mockRejectedValue({ code: '55000', message: 'esta natureza só vale para despesa ou assinatura de cartão' })
    const u = userEvent.setup()
    montar()
    const card = await abrirNatureza(u, 'Luz')
    await u.click(within(card).getByRole('radio', { name: 'Custo fixo' }))
    await u.click(within(card).getByRole('button', { name: 'Salvar' }))
    expect(await within(card).findByText(/Esta natureza só vale para despesa/)).toBeTruthy()
    expect(screen.getByRole('dialog', { name: 'Natureza · Luz' })).toBeTruthy()
    expect(mock.listarRecorrencias).toHaveBeenCalledTimes(1)
    await u.click(within(card).getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('só classifica: nenhuma outra chamada de escrita (valor, data e lançamentos ficam como estão)', async () => {
    mock.listarRecorrencias.mockResolvedValue([luz])
    const u = userEvent.setup()
    montar()
    const card = await abrirNatureza(u, 'Luz')
    await u.click(within(card).getByRole('radio', { name: 'Custo fixo' }))
    await u.click(within(card).getByRole('button', { name: 'Salvar' }))
    await vi.waitFor(() => expect(mock.definirNaturezaRecorrencia).toHaveBeenCalledTimes(1))
    expect(mock.editarRecorrencia).not.toHaveBeenCalled()
    expect(mock.criarRecorrencia).not.toHaveBeenCalled()
    expect(mock.excluirRecorrencia).not.toHaveBeenCalled()
  })
})

describe('Recorrentes: layout (lado a lado no computador, sem estourar no celular)', () => {
  it('os cards de cada bloco ficam numa grade de uma coluna no celular e duas no computador (sem a coluna "auto" que estourava a largura)', async () => {
    mock.listarRecorrencias.mockResolvedValue([luz, { ...luz, id: 'r8', tipo: 'card' as const, descricao: 'Netflix', contaId: null, cartaoId: 'k1' }])
    montar()
    await screen.findByText('Netflix')
    const grade = screen.getByRole('region', { name: 'Sem natureza' }).parentElement!.parentElement as HTMLElement
    expect(grade.getAttribute('data-testid')).toBe('grade-grupos')
    expect(grade.className).toContain('grid-cols-1')
    expect(grade.className).toContain('lg:grid-cols-2')
  })

  it('proventos previstos ficam no bloco Entradas (uma entrada prevista), ao lado das receitas', async () => {
    mock.listarRecorrencias.mockResolvedValue([{ ...luz, id: 'r5', tipo: 'income' as const, descricao: 'Salário', categoriaId: 'g2' }])
    mock.listarProventosPrevistos.mockResolvedValue([{ ativoId: 'a1', nome: 'FII', qtde: 12, proximaData: '2026-12-10', proximoValor: c(8550), total12m: c(102600) }])
    montar(ENTRADAS)
    await screen.findByTestId('proventos-previstos')
    const grade = screen.getByRole('region', { name: 'Sem natureza' }).parentElement!.parentElement as HTMLElement
    expect(within(grade).getByTestId('proventos-previstos')).toBeTruthy()
    expect(within(grade).getByTitle('Salário')).toBeTruthy()
  })
})

describe('Recorrentes: card "Parcelas & carnês" (Saídas)', () => {
  const brl = { moeda: 'BRL', ativos: 6, comParcelaNoMes: 5, totalMes: c(43333), pagoMes: c(10000), faltaMes: c(33333), exemplos: ['Notebook', 'Sofá', 'Curso'] }

  it('virou uma linha dentro do card do topo: o valor do mês (do banco), quanto falta e "Ver ›", sem contador; tocar abre a aba Parcelas', async () => {
    mock.listarRecorrencias.mockResolvedValue([luz])
    mock.resumoParcelasDoMes.mockResolvedValue([brl])
    montar()
    const card = await screen.findByTestId('card-parcelas-BRL')
    expect(within(screen.getByTestId('resumo-do-mes')).getByTestId('card-parcelas-BRL')).toBe(card)
    expect(card.textContent).toContain('Parcelas e carnês')
    expect(card.textContent).toContain('R$ 433,33/mês')
    expect(card.textContent).toContain('Ver ›')
    expect(within(card).getByTestId('parcelas-falta-BRL').textContent).toBe('fora do "Sai" · faltam R$ 333,33 neste mês')
    expect(card.textContent).not.toContain('· 6')
    expect(card.textContent).not.toContain('Notebook')
    await userEvent.click(card)
    expect(screen.getByRole('tab', { name: 'Parcelas', selected: true })).toBeTruthy()
  })

  it('o "faltam…" quebra linha em vez de virar "…" (celular de 390 px)', async () => {
    mock.listarRecorrencias.mockResolvedValue([luz])
    mock.resumoParcelasDoMes.mockResolvedValue([brl])
    montar()
    const card = await screen.findByTestId('card-parcelas-BRL')
    const falta = within(card).getByTestId('parcelas-falta-BRL')
    expect(falta.className).not.toContain('truncate')
    expect(falta.className).toContain('break-words')
  })

  it('tudo pago e sem parcela no mês têm texto próprio; a linha não filtra a lista (não é natureza)', async () => {
    mock.listarRecorrencias.mockResolvedValue([luz])
    mock.resumoParcelasDoMes.mockResolvedValue([{ ...brl, faltaMes: c(0), pagoMes: c(43333) }])
    montar()
    expect((await screen.findByTestId('parcelas-falta-BRL')).textContent).toContain('tudo pago neste mês')
    expect(screen.getByTestId('card-parcelas-BRL').hasAttribute('aria-pressed')).toBe(false)
    cleanup()
    mock.resumoParcelasDoMes.mockResolvedValue([{ ...brl, comParcelaNoMes: 0, totalMes: c(0), pagoMes: c(0), faltaMes: c(0) }])
    montar()
    expect((await screen.findByTestId('parcelas-falta-BRL')).textContent).toContain('nenhuma parcela neste mês')
  })

  it('moedas diferentes ganham um card cada, sem misturar; em Entradas o card não aparece; sem a função (falha) a tela segue sem o card', async () => {
    mock.listarRecorrencias.mockResolvedValue([luz, { ...luz, id: 'r5', tipo: 'income' as const, descricao: 'Salário', categoriaId: 'g2' }])
    mock.resumoParcelasDoMes.mockResolvedValue([brl, { ...brl, moeda: 'USD', ativos: 1, totalMes: c(10000), faltaMes: c(10000), exemplos: ['Em dólar'] }])
    montar()
    expect(await screen.findByTestId('card-parcelas-BRL')).toBeTruthy()
    expect(screen.getByTestId('card-parcelas-USD').textContent).toContain('US$')
    cleanup()
    montar(ENTRADAS)
    await screen.findByTitle('Salário')
    expect(screen.queryByTestId('card-parcelas-BRL')).toBeNull()
    cleanup()
    mock.resumoParcelasDoMes.mockRejectedValue(new Error('sem a função'))
    montar()
    await screen.findByTitle('Luz')
    expect(screen.queryByTestId('card-parcelas-BRL')).toBeNull()
  })
})

describe('Recorrentes: aviso "a previsão de proventos está acabando" (Entradas)', () => {
  const previsto = (ativoId: string, nome: string) => ({ ativoId, nome, qtde: 2, proximaData: '2026-12-10', proximoValor: c(8550), total12m: c(17100) })
  const acabando = { ativoId: 'a1', nome: 'FII', ultimaData: '2027-01-10', ultimoValor: c(8550), qtdePrevistos: 2 }

  it('avisa no card Proventos previstos: faixa com a contagem e o link para Investimentos, e o selo "Previsão termina em" só no ativo certo', async () => {
    mock.listarProventosPrevistos.mockResolvedValue([previsto('a1', 'FII'), previsto('a2', 'Ação')])
    mock.listarProventosAcabando.mockResolvedValue([acabando])
    montar(ENTRADAS)
    const aviso = await screen.findByTestId('aviso-proventos-acabando')
    expect(aviso.textContent).toContain('A previsão de 1 ativo está acabando')
    expect(aviso.textContent).toContain('próximos 60 dias')
    expect(within(aviso).getByRole('link', { name: 'Investimentos' }).getAttribute('href')).toBe('/investimentos')
    expect(within(screen.getByTestId('acabando-a1')).getByText(/Previsão termina em/)).toBeTruthy()
    expect(screen.queryByTestId('acabando-a2')).toBeNull()
  })

  it('sem ativo acabando, ou com falha na consulta (banco sem a função), não há aviso e o card segue normal; o plural concorda', async () => {
    mock.listarProventosPrevistos.mockResolvedValue([previsto('a1', 'FII')])
    montar(ENTRADAS)
    await screen.findByTestId('proventos-previstos')
    expect(screen.queryByTestId('aviso-proventos-acabando')).toBeNull()
    cleanup()
    mock.listarProventosAcabando.mockRejectedValue(new Error('sem a função'))
    montar(ENTRADAS)
    await screen.findByTestId('proventos-previstos')
    expect(screen.queryByTestId('aviso-proventos-acabando')).toBeNull()
    cleanup()
    mock.listarProventosPrevistos.mockResolvedValue([previsto('a1', 'FII'), previsto('a2', 'Ação')])
    mock.listarProventosAcabando.mockResolvedValue([acabando, { ...acabando, ativoId: 'a2', nome: 'Ação' }])
    montar(ENTRADAS)
    expect((await screen.findByTestId('aviso-proventos-acabando')).textContent).toContain('A previsão de 2 ativos está acabando')
  })
})

describe('Recorrentes: "Já terminaram" só mostra o recente (nada é apagado)', () => {
  // hoje = 05/11/2026: o limite de 90 dias é 07/08/2026 (o dia do limite ainda é "recente")
  const encerrada = (id: string, nome: string, fim: string) => ({ ...luz, id, descricao: nome, fim })
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-05T15:00:00Z'))
  })
  afterEach(() => vi.useRealTimers())

  it('mostra o que terminou nos últimos 90 dias (inclusive o dia do limite) e esconde o mais antigo atrás de um botão que mostra e esconde', async () => {
    mock.listarRecorrencias.mockResolvedValue([luz,
      encerrada('t1', 'Terminou ontem', '2026-11-04'),
      encerrada('t2', 'No limite', '2026-08-07'),
      encerrada('t3', 'Um dia além do limite', '2026-08-06'),
      encerrada('t4', 'Terminou faz tempo', '2026-01-15'),
    ])
    montar()
    await screen.findByText('Luz')
    const bloco = screen.getByRole('region', { name: /Já terminaram/ })
    expect(within(bloco).getByTitle('Terminou ontem')).toBeTruthy()
    expect(within(bloco).getByTitle('No limite')).toBeTruthy()
    expect(within(bloco).queryByTitle('Um dia além do limite')).toBeNull()
    expect(within(bloco).queryByTitle('Terminou faz tempo')).toBeNull()
    const botao = within(bloco).getByTestId('terminadas-antigas')
    expect(botao.textContent).toBe('Mostrar os 2 que terminaram há mais de 90 dias')
    await userEvent.click(botao)
    expect(within(bloco).getByTitle('Um dia além do limite')).toBeTruthy()
    expect(within(bloco).getByTitle('Terminou faz tempo')).toBeTruthy()
    expect(within(bloco).getByTestId('terminadas-antigas').textContent).toBe('Esconder os mais antigos')
    await userEvent.click(within(bloco).getByTestId('terminadas-antigas'))
    expect(within(bloco).queryByTitle('Terminou faz tempo')).toBeNull()
  })

  it('só com recorrentes antigos, o bloco avisa que nenhum terminou nos últimos 90 dias e oferece mostrar (singular concorda)', async () => {
    mock.listarRecorrencias.mockResolvedValue([luz, encerrada('t4', 'Terminou faz tempo', '2026-01-15')])
    montar()
    await screen.findByText('Luz')
    const bloco = screen.getByRole('region', { name: /Já terminaram/ })
    expect(within(bloco).getByTestId('terminadas-vazio').textContent).toBe('Nenhum terminou nos últimos 90 dias.')
    expect(within(bloco).queryByTitle('Terminou faz tempo')).toBeNull()
    const botao = within(bloco).getByTestId('terminadas-antigas')
    expect(botao.textContent).toBe('Mostrar 1 que terminou há mais de 90 dias')
    await userEvent.click(botao)
    expect(within(bloco).getByTitle('Terminou faz tempo')).toBeTruthy()
    expect(within(bloco).queryByTestId('terminadas-vazio')).toBeNull()
  })

  it('sem nenhum antigo não há botão nem aviso de vazio', async () => {
    mock.listarRecorrencias.mockResolvedValue([luz, encerrada('t1', 'Terminou ontem', '2026-11-04')])
    montar()
    await screen.findByText('Luz')
    expect(screen.queryByTestId('terminadas-antigas')).toBeNull()
    expect(screen.queryByTestId('terminadas-vazio')).toBeNull()
  })
})

