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
  definirNaturezaRecorrencia: mock.definirNaturezaRecorrencia,
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
    expect(metas()[0]).toMatch(/^próxima \d\d\/\d\d(\/\d{4})? · dia 10 · Itaú · Moradia$/)
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
    expect(metas()).toEqual(['próxima 06/11 · quinzenal · sexta · Itaú · Moradia · até 30/06/2027'])
    cleanup()
    // entradas: a anual, em outra visão
    montar(ENTRADAS)
    expect(await screen.findByText('PLR')).toBeTruthy()
    expect(metas()).toEqual(['próxima 20/02/2027 · 20 de fev · Itaú · Salário'])
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
    const regras = [
      { ...luz, id: 'r1', descricao: 'Condomínio do prédio com nome bem comprido', categoriaId: 'g3', dia: 1 },
      { ...luz, id: 'r2', descricao: 'Seguro', cada: 12, dia: 10, inicio: '2027-03-10' },
      { ...luz, id: 'r3', tipo: 'card' as const, descricao: 'Streaming', contaId: null, cartaoId: 'k1', dia: 15 },
      { ...luz, id: 'r4', tipo: 'card' as const, descricao: 'Antivírus', contaId: null, cartaoId: 'k1', cada: 12, dia: 20, inicio: '2027-02-20' },
    ]
    const categoriasComFilha = [
      { id: 'g1', nome: 'Moradia', tipo: 'expense', paiId: null, sistema: false, ativa: true },
      { id: 'g3', nome: 'Condomínio', tipo: 'expense', paiId: 'g1', sistema: false, ativa: true },
    ]
    const cabecalhos = () => screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent).filter((t) => !['Saídas', 'Entradas', 'Transferências · à parte, fora dos gastos'].includes(t ?? '') && t !== 'Saídas e entradas por mês' && t !== 'Projeção de compromissos' && t !== 'Parcelas ativas')
    /** Faixas de frequência (h3) dentro do card de um tipo. */
    const faixas = (card: HTMLElement) => within(card).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    const card = (titulo: RegExp) => screen.getByRole('region', { name: titulo })

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2026-11-05T15:00:00Z'))
      mock.resumoRecorrencias.mockResolvedValue(resumo)
      mock.listarRecorrencias.mockResolvedValue(regras)
      mock.listarCategorias.mockResolvedValue(categoriasComFilha)
    })
    afterEach(() => { vi.useRealTimers() })

    it('o resumo por cartão e por conta vem do banco (lista expansível, só das saídas)', async () => {
      montar()
      await screen.findByText('Streaming')
      expect(mock.resumoRecorrencias).toHaveBeenCalledWith('h1')
      const detalhe = screen.getByText('Por cartão e por conta').closest('details')!
      expect(detalhe.querySelector('li')?.textContent).toBe('Nubank · cartão · 2R$ 65,90/mêsR$ 175,90 por vez')
    })

    it('um card por tipo presente, na ordem; tipo sem itens não aparece', async () => {
      montar()
      await screen.findByText('Streaming')
      expect(cabecalhos()).toEqual(['Assinaturas no cartão · 2', 'Contas fixas · 2'])
      expect(screen.queryByRole('heading', { name: /^Receitas/ })).toBeNull()
      expect(screen.queryByRole('heading', { name: /^Transferências ·/ })).toBeNull()
      expect(within(card(/^Assinaturas no cartão/)).queryByText('Seguro')).toBeNull()
      expect(within(card(/^Contas fixas/)).getByText('Seguro')).toBeTruthy()
    })

    it('receitas e transferências ganham card próprio; "Já terminaram" é o último card', async () => {
      mock.listarRecorrencias.mockResolvedValue([...regras,
        { ...luz, id: 'r5', tipo: 'income' as const, descricao: 'Salário', categoriaId: 'g2', dia: 5 },
        { ...luz, id: 'r6', tipo: 'transfer' as const, descricao: 'Guardar', categoriaId: null, destinoId: 'a2', dia: 6 },
        { ...luz, id: 'r7', descricao: 'Academia antiga', fim: '2026-09-30' },
      ])
      montar()
      await screen.findByText('Guardar')
      // Saídas: cartão, contas fixas e as transferências (à parte); "Já terminaram" é o último card (só de saídas)
      expect(cabecalhos()).toEqual(['Assinaturas no cartão · 2', 'Contas fixas · 2', 'Transferências · 1', 'Já terminaram · fora dos totais'])
      expect(within(card(/^Já terminaram/)).getByText('Academia antiga')).toBeTruthy()
      cleanup()
      // Entradas: as receitas, numa visão própria
      montar(ENTRADAS)
      await screen.findByText('Salário', { selector: '[title]' })
      expect(cabecalhos()).toEqual(['Receitas · 1'])
      // sem linha 'frequency' do banco para receitas: a faixa mostra só a contagem, a tela não soma
      expect(within(card(/^Receitas/)).getByRole('region', { name: 'Mensais · 1 · Receitas' }).textContent).not.toContain('/mês')
      expect(screen.getByTestId('total-income').textContent).toBe('R$ 5.000,00/mês')
      expect(screen.queryByText('Academia antiga')).toBeNull()
    })

    it('título de cada card traz o total por mês do banco (nível medium), não a soma dos itens', async () => {
      montar()
      await screen.findByText('Streaming')
      expect(screen.getByTestId('total-card').textContent).toBe('R$ 65,90/mês')
      expect(screen.getByTestId('total-expense').textContent).toBe('R$ 2.354,16/mês')
      expect(within(card(/^Assinaturas no cartão/)).getByTestId('total-card')).toBeTruthy()
    })

    it('dentro do card, faixas por frequência com o total do banco daquele tipo; pela próxima data', async () => {
      montar()
      await screen.findByText('Streaming')
      const cartao = card(/^Assinaturas no cartão/)
      expect(faixas(cartao)).toEqual(['Mensais · 1', 'Anuais · 1'])
      expect(within(cartao).getByRole('region', { name: 'Mensais · 1 · Assinaturas no cartão' }).textContent).toContain('R$ 55,90/mês')
      expect(within(cartao).getByRole('region', { name: 'Anuais · 1 · Assinaturas no cartão' }).textContent).toContain('R$ 120,00 por vez · ≈ R$ 10,00/mês')
      const fixas = card(/^Contas fixas/)
      expect(faixas(fixas)).toEqual(['Mensais · 1', 'Anuais · 1'])
      expect(within(fixas).getByRole('region', { name: 'Mensais · 1 · Contas fixas' }).textContent).toContain('R$ 180,00/mês')
      expect(within(fixas).getByRole('region', { name: 'Anuais · 1 · Contas fixas' }).textContent).toContain('R$ 1.200,00 por vez · ≈ R$ 100,00/mês')
      // o total que mistura conta e cartão (frequency_all) não aparece mais
      expect(screen.queryByText(/1\.111,11/)).toBeNull()
    })

    it('ordem dentro da faixa: pela próxima data, não pelo dia', async () => {
      mock.listarRecorrencias.mockResolvedValue([...regras, { ...luz, id: 'r8', descricao: 'Internet', dia: 15 }])
      montar()
      await screen.findByText('Internet')
      const mensais = within(card(/^Contas fixas/)).getByRole('region', { name: 'Mensais · 2 · Contas fixas' })
      // o dia 15 (próxima 15/11) vem antes do dia 1 (próxima 01/12)
      expect(Array.from(mensais.querySelectorAll('li button > span:first-child > span:first-child')).map((p) => p.textContent))
        .toEqual(['Internet', 'Condomínio do prédio com nome bem comprido'])
    })

    it('aba Cartão mostra só o card de assinaturas; aba Conta, só os de conta', async () => {
      const u = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      mock.listarRecorrencias.mockResolvedValue([...regras, { ...luz, id: 'r7', descricao: 'Academia antiga', fim: '2026-09-30' }])
      montar()
      await screen.findByText('Streaming')
      expect(screen.getByRole('button', { name: 'Todos', pressed: true })).toBeTruthy()
      await u.click(screen.getByRole('button', { name: 'Cartão' }))
      expect(screen.getByRole('button', { name: 'Cartão', pressed: true })).toBeTruthy()
      expect(cabecalhos()).toEqual(['Assinaturas no cartão · 2'])
      expect(screen.queryByText('Seguro')).toBeNull()
      expect(screen.queryByText('Academia antiga')).toBeNull()
      expect(screen.getByText('Antivírus')).toBeTruthy()
      await u.click(screen.getByRole('button', { name: 'Conta' }))
      expect(cabecalhos()).toEqual(['Contas fixas · 2'])
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
      expect(titulo.className).toContain('truncate')
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
      expect(within(li).getByRole('link', { name: 'Abrir Condomínio do prédio com nome bem comprido em Lançamentos' }).getAttribute('href')).toBe('/lancamentos')
    })

    it('mostra só a subcategoria; o caminho completo fica no title e para o leitor de tela', async () => {
      montar()
      await screen.findByText('Streaming')
      const meta = screen.getAllByTestId('meta-recorrente').find((p) => p.textContent?.includes('dia 1 '))!
      expect(metas()).toContain('próxima 01/12 · dia 1 · Itaú · Condomínio')
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

  it('a lista mostra o selo da natureza só nas regras classificadas', async () => {
    mock.listarRecorrencias.mockResolvedValue([
      { ...luz, nature: 'fixed' as const },
      { ...luz, id: 'r2', descricao: 'Streaming', nature: 'subscription' as const },
      { ...luz, id: 'r3', descricao: 'Mercado', nature: null },
      { ...luz, id: 'r4', descricao: 'Água' },
    ])
    montar()
    await screen.findByTitle('Luz')
    const selos = screen.getAllByTestId('selo-natureza').map((s) => s.textContent)
    // o selo é curto (cabe no celular); o nome completo fica no title
    expect(selos).toEqual(expect.arrayContaining(['Fixo', 'Assinatura']))
    expect(screen.getAllByTestId('selo-natureza').map((s) => s.getAttribute('title'))).toEqual(expect.arrayContaining(['Custo fixo', 'Assinatura ou app']))
    expect(selos).toHaveLength(2)
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

  it('sem nenhuma natureza escolhida, o filtro nem aparece', async () => {
    mock.listarRecorrencias.mockResolvedValue([luz, internet])
    montar()
    await screen.findByText('Internet')
    expect(screen.queryByRole('group', { name: 'Filtrar por natureza' })).toBeNull()
  })

  it('cards só das naturezas que existem: nome, quantas, total do banco e exemplos; a ordem é fixa', async () => {
    mock.listarRecorrencias.mockResolvedValue(regras)
    mock.resumoPorNatureza.mockResolvedValue(porNatureza)
    montar()
    await screen.findByText('Internet')
    const ids = within(grupo()).getAllByRole('button').map((b) => b.getAttribute('data-testid'))
    expect(ids).toEqual(['natureza-fixed', 'natureza-subscription', 'natureza-none'])
    expect(screen.queryByTestId('natureza-variable')).toBeNull() // ninguém é "variável": o card não aparece
    expect(screen.getByTestId('natureza-fixed').textContent).toContain('R$ 180,00/mês')
    expect(screen.getByTestId('natureza-fixed').textContent).toContain('Custos fixos · 1')
    expect(screen.getByTestId('natureza-subscription').textContent).toContain('R$ 39,90/mês')
    expect(screen.getByTestId('natureza-none').textContent).toContain('R$ 220,00/mês')
    expect(screen.getByTestId('natureza-none').textContent).toContain('Seguro') // exemplo da natureza
  })

  it('tocar num card filtra a lista e mostra o total do banco; os totais por card (que ignoram a natureza) somem', async () => {
    const u = userEvent.setup()
    mock.listarRecorrencias.mockResolvedValue(regras)
    mock.resumoPorNatureza.mockResolvedValue(porNatureza)
    mock.resumoRecorrencias.mockResolvedValue([
      { nivel: 'medium', meio: 'account', alvoId: null, alvoNome: null, tipo: 'expense', frequencia: null, qtde: 3, porOcorrencia: c(150000), porMes: c(23000) },
    ])
    montar()
    await screen.findByText('Internet')
    expect(await screen.findByTestId('total-expense')).toBeTruthy()
    await u.click(screen.getByTestId('natureza-fixed'))
    expect(nomesNaLista()).toBe(1)
    expect(screen.getByTitle('Luz')).toBeTruthy()
    expect(screen.queryByTitle('Internet')).toBeNull()
    const total = screen.getByTestId('total-natureza')
    expect(total.textContent).toContain('R$ 180,00/mês')
    expect(total.textContent).toContain('saídas (1)')
    expect(screen.queryByTestId('total-expense')).toBeNull()
    expect(screen.getByTestId('natureza-fixed').getAttribute('aria-pressed')).toBe('true')
  })

  it('"Sem natureza" mostra as regras sem classificação; tocar no card de novo limpa o filtro', async () => {
    const u = userEvent.setup()
    mock.listarRecorrencias.mockResolvedValue(regras)
    mock.resumoPorNatureza.mockResolvedValue(porNatureza)
    montar()
    await screen.findByText('Internet')
    await u.click(screen.getByTestId('natureza-none'))
    expect(nomesNaLista()).toBe(2)
    expect(screen.getByTitle('Internet')).toBeTruthy()
    expect(screen.getByTitle('Seguro')).toBeTruthy()
    expect(screen.getByTestId('total-natureza').textContent).toContain('R$ 220,00/mês')
    await u.click(screen.getByTestId('natureza-none'))
    expect(nomesNaLista()).toBe(4)
    expect(screen.queryByTestId('total-natureza')).toBeNull()
    expect(screen.getByTestId('natureza-none').getAttribute('aria-pressed')).toBe('false')
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
    expect(screen.getByTestId('total-natureza')).toBeTruthy()
    await u.click(screen.getByRole('tab', { name: /^Entradas/ }))
    expect(screen.queryByTestId('total-natureza')).toBeNull()
    expect(await screen.findByRole('region', { name: /^Receitas/ })).toBeTruthy()
  })

  it('se o resumo por natureza falhar (banco sem a migration), a tela segue e só esse bloco some', async () => {
    mock.listarRecorrencias.mockResolvedValue(regras)
    mock.resumoPorNatureza.mockRejectedValue({ code: 'PGRST202' })
    montar()
    expect(await screen.findByText('Internet')).toBeTruthy()
    // sem o resumo do banco os cards ficam sem total ("—"), mas a lista e os filtros seguem
    expect(screen.getByTestId('natureza-none').textContent).toContain('—')
    expect(screen.queryByText(/Não foi possível/)).toBeNull()
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

  it('são duas visões: Saídas mostra cartão, contas fixas e transferências (à parte); Entradas mostra só as receitas', async () => {
    mock.listarRecorrencias.mockResolvedValue([guardar, salario, netflix, luz])
    const u = userEvent.setup()
    montar()
    await screen.findByText('Netflix')
    // visão Saídas (a padrão)
    expect(screen.getByRole('tab', { name: /^Saídas/ }).getAttribute('aria-selected')).toBe('true')
    const titulos = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    expect(titulos.findIndex((t) => t?.startsWith('Assinaturas no cartão'))).toBeLessThan(titulos.findIndex((t) => t?.startsWith('Contas fixas')))
    expect(titulos).toContain('Transferências · à parte, fora dos gastos')
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

  it('o seletor mostra o total por mês e por ano do banco de cada visão; as setas do teclado trocam', async () => {
    mock.listarRecorrencias.mockResolvedValue([salario, luz])
    mock.resumoVisaoGeral.mockResolvedValue([
      { tipo: 'expense', recorte: 'all', qtde: 1, sugeridas: 1, porMes: c(18000), porAno: c(216000) },
      { tipo: 'income', recorte: 'all', qtde: 1, sugeridas: 0, porMes: c(500000), porAno: c(6000000) },
    ])
    const u = userEvent.setup()
    montar()
    await screen.findByTestId('visao-saidas-mes')
    expect(screen.getByTestId('visao-saidas-mes').textContent).toBe('R$ 180,00/mês')
    expect(screen.getByTestId('visao-saidas-ano').textContent).toContain('R$ 2.160,00 por ano')
    expect(screen.getByTestId('visao-entradas-mes').textContent).toBe('R$ 5.000,00/mês')
    screen.getByRole('tab', { name: /^Saídas/ }).focus()
    await u.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: /^Entradas/ }).getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: /^Entradas/ }))
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
    const cartao = screen.getByRole('link', { name: 'Abrir Netflix em Cartões' }).getAttribute('href')!
    expect(cartao).toContain('/cartoes')
    expect(cartao).toContain('k1')
    expect(screen.getByRole('link', { name: 'Abrir Luz em Lançamentos' }).getAttribute('href')).toBe('/lancamentos')
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
    expect(screen.getByTestId('visao-saidas-mes').textContent).toBe('R$ 2.417,52/mês')
    expect(screen.getByTestId('visao-saidas-ano').textContent).toContain('R$ 28.530,23 por ano')
    expect(screen.getByTestId('visao-entradas-mes').textContent).toBe('R$ 5.500,00/mês')
    expect(screen.getByTestId('visao-entradas-ano').textContent).toContain('R$ 66.000,00 por ano')
  })

  it('fixo e variável aparecem com a marca de sugerido (quantas são sugestão do app)', async () => {
    mock.resumoVisaoGeral.mockResolvedValue(visao)
    montar()
    await screen.findByTestId('visao-geral')
    const fixo = screen.getByTestId('visao-fixo')
    expect(fixo.textContent).toContain('R$ 2.077,52/mês')
    expect(fixo.textContent).toContain('R$ 24.930,23/ano')
    expect(fixo.textContent).toContain('4 sugeridos')
    expect(screen.getByTestId('visao-variável').textContent).toContain('1 sugerido')
    expect(screen.getByText(/A natureza que você marcou vale mais/)).toBeTruthy()
  })

  it('tudo sugerido vira "sugerido"; nada sugerido (natureza toda marcada) não leva a marca nem a nota', async () => {
    mock.resumoVisaoGeral.mockResolvedValue([
      linha('expense', 'all', 2, 2, 20000, 240000), linha('expense', 'fixed', 2, 2, 20000, 240000), linha('income', 'all', 1, 0, 100000, 1200000),
    ])
    montar()
    await screen.findByTestId('visao-geral')
    expect(screen.getByTestId('visao-fixo').textContent).toContain('· sugerido')
    expect(screen.queryByTestId('visao-variável')).toBeNull()
    cleanup()
    mock.resumoVisaoGeral.mockResolvedValue([
      linha('expense', 'all', 2, 0, 20000, 240000), linha('expense', 'fixed', 2, 0, 20000, 240000),
    ])
    montar()
    await screen.findByTestId('visao-geral')
    expect(screen.getByTestId('visao-fixo').textContent).not.toContain('sugerid')
    expect(screen.queryByText(/A natureza que você marcou vale mais/)).toBeNull()
    expect(screen.queryByTestId('visao-entradas-mes')).toBeNull()
  })

  it('banco ainda sem a função (migration 116): a tela cai no resumo de antes, sem erro', async () => {
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
    expect(screen.queryByRole('alert')).toBeNull()
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

  it('banco ainda sem a função (migration 117): a tela segue sem o card e sem erro', async () => {
    mock.listarRecorrencias.mockResolvedValue([luz])
    mock.listarProventosPrevistos.mockRejectedValue({ code: 'PGRST202' })
    montar(ENTRADAS)
    await screen.findByRole('tab', { name: /^Entradas/ })
    expect(screen.queryByTestId('proventos-previstos')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
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
    const grade = screen.getByRole('region', { name: /^Contas fixas/ }).parentElement!.parentElement as HTMLElement
    expect(grade.className).toContain('grid-cols-1')
    expect(grade.className).toContain('lg:grid-cols-2')
  })

  it('proventos previstos ficam no bloco Entradas (uma entrada prevista), ao lado das receitas', async () => {
    mock.listarRecorrencias.mockResolvedValue([{ ...luz, id: 'r5', tipo: 'income' as const, descricao: 'Salário', categoriaId: 'g2' }])
    mock.listarProventosPrevistos.mockResolvedValue([{ ativoId: 'a1', nome: 'FII', qtde: 12, proximaData: '2026-12-10', proximoValor: c(8550), total12m: c(102600) }])
    montar(ENTRADAS)
    await screen.findByTestId('proventos-previstos')
    const grade = screen.getByRole('region', { name: /^Receitas/ }).parentElement!.parentElement as HTMLElement
    expect(within(grade).getByTestId('proventos-previstos')).toBeTruthy()
    expect(within(grade).getByTitle('Salário')).toBeTruthy()
  })
})

describe('Recorrentes: card "Parcelas & carnês" (Saídas)', () => {
  const brl = { moeda: 'BRL', ativos: 6, comParcelaNoMes: 5, totalMes: c(43333), pagoMes: c(10000), faltaMes: c(33333), exemplos: ['Notebook', 'Sofá', 'Curso'] }

  it('mostra quantos parcelamentos, o valor do mês (do banco), quanto falta pagar e exemplos; tocar abre a aba Parcelas', async () => {
    mock.listarRecorrencias.mockResolvedValue([luz])
    mock.resumoParcelasDoMes.mockResolvedValue([brl])
    montar()
    const card = await screen.findByTestId('card-parcelas-BRL')
    expect(within(card).getByText(/Parcelas & carnês/)).toBeTruthy()
    expect(within(card).getByText('· 6')).toBeTruthy()
    expect(card.textContent).toContain('R$ 433,33')
    expect(within(card).getByText('Faltam R$ 333,33 neste mês')).toBeTruthy()
    expect(within(card).getByText('Notebook, Sofá, Curso')).toBeTruthy()
    await userEvent.click(card)
    expect(screen.getByRole('tab', { name: 'Parcelas', selected: true })).toBeTruthy()
  })

  it('tudo pago e sem parcela no mês têm texto próprio; o card não filtra a lista (não é natureza)', async () => {
    mock.listarRecorrencias.mockResolvedValue([luz])
    mock.resumoParcelasDoMes.mockResolvedValue([{ ...brl, faltaMes: c(0), pagoMes: c(43333) }])
    montar()
    expect(await screen.findByText('Tudo pago neste mês')).toBeTruthy()
    cleanup()
    mock.resumoParcelasDoMes.mockResolvedValue([{ ...brl, comParcelaNoMes: 0, totalMes: c(0), pagoMes: c(0), faltaMes: c(0) }])
    montar()
    expect(await screen.findByText('Nenhuma parcela neste mês')).toBeTruthy()
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
