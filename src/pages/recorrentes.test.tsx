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
  listarContas: vi.fn(),
  listarCartoes: vi.fn(),
  listarCategorias: vi.fn(),
}))
vi.mock('../lib/FamiliaContext', () => ({
  useFamilia: () => ({ familia: { id: 'h1', nome: 'Casa', papel: 'owner' }, carregando: false, erro: false, recarregar: vi.fn() }),
}))
vi.mock('../lib/recorrencias', async (o) => ({
  ...(await o<typeof import('../lib/recorrencias')>()),
  listarRecorrencias: mock.listarRecorrencias, criarRecorrencia: mock.criarRecorrencia,
  editarRecorrencia: mock.editarRecorrencia, excluirRecorrencia: mock.excluirRecorrencia,
  resumoRecorrencias: mock.resumoRecorrencias,
}))
vi.mock('../lib/contas', async (o) => ({ ...(await o<typeof import('../lib/contas')>()), listarContas: mock.listarContas }))
vi.mock('../lib/projecaoCompromissos', () => ({ carregarProjecaoCompromissos: vi.fn().mockResolvedValue([]) }))
vi.mock('../lib/cartoes', async (o) => ({ ...(await o<typeof import('../lib/cartoes')>()), listarCartoes: mock.listarCartoes }))
vi.mock('../lib/categorias', async (o) => ({ ...(await o<typeof import('../lib/categorias')>()), listarCategorias: mock.listarCategorias }))

import Recorrentes from './Recorrentes'

/** Categoria agora é um seletor em folha (como no Organizze): abre pelo botão e toca na categoria. */
async function escolherCategoria(u: ReturnType<typeof userEvent.setup>, campo: HTMLElement, id: string) {
  await u.click(campo)
  const folhas = screen.getAllByRole('dialog', { name: 'Selecionar uma categoria' })
  const folha = folhas[folhas.length - 1]
  await u.click(folha.querySelector(`[data-categoria-id="${id}"]`) as HTMLElement)
}


const c = (n: number) => n as Cents
const luz = {
  id: 'r1', tipo: 'expense' as const, descricao: 'Luz', valor: c(18000), dia: 10 as number | null, unidade: 'month' as const, cada: 1,
  inicio: '2026-10-01', fim: null as string | null,
  contaId: 'a1', destinoId: null, cartaoId: null, categoriaId: 'g1', ativa: true,
}
const montar = () => render(<MemoryRouter><Recorrentes /></MemoryRouter>)
/** Texto da linha de metadados de um item (a subcategoria vem em dois spans: visível e para leitor de tela). */
const metas = () => screen.getAllByTestId('meta-recorrente').map((p) => Array.from(p.childNodes)
  .map((n) => ((n as HTMLElement).className === 'sr-only' ? '' : n.textContent)).join(''))
/** Abre o menu "⋯" do item e escolhe a ação. */
async function acao(u: ReturnType<typeof userEvent.setup>, item: string, nome: string) {
  await u.click(await screen.findByRole('button', { name: `Ações de ${item}` }))
  await u.click(screen.getByRole('menuitem', { name: nome }))
}

beforeEach(() => {
  mock.listarRecorrencias.mockResolvedValue([])
  mock.resumoRecorrencias.mockResolvedValue([])
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

  it('cadastra despesa mensal em conta', async () => {
    const u = userEvent.setup()
    montar()
    await u.click(await screen.findByRole('button', { name: 'Novo recorrente' }))
    await u.type(screen.getByLabelText('Descrição'), 'Luz')
    await u.type(screen.getByLabelText('Valor estimado (R$)'), '180,00')
    await u.selectOptions(screen.getByLabelText('Dia do mês'), '10')
    await escolherCategoria(u, screen.getByLabelText('Categoria'), 'g1')
    await u.click(screen.getByRole('button', { name: 'Cadastrar recorrente' }))
    expect(mock.criarRecorrencia).toHaveBeenCalledWith(expect.objectContaining({
      tipo: 'expense', descricao: 'Luz', valor: 18000, dia: 10, contaId: 'a1', destinoId: null, cartaoId: null, categoriaId: 'g1',
      unidade: 'month', cada: 1, fim: null,
    }))
  })

  it('assinatura no cartão: pede o cartão, não a conta', async () => {
    const u = userEvent.setup()
    montar()
    await u.click(await screen.findByRole('button', { name: 'Novo recorrente' }))
    await u.selectOptions(screen.getByLabelText('Tipo'), 'card')
    expect(screen.queryByLabelText('Conta')).toBeNull()
    await u.type(screen.getByLabelText('Descrição'), 'Netflix')
    await u.type(screen.getByLabelText('Valor (R$)'), '55,90')
    await u.selectOptions(screen.getByLabelText('Dia do mês'), '5')
    await escolherCategoria(u, screen.getByLabelText('Categoria'), 'g1')
    await u.click(screen.getByRole('button', { name: 'Cadastrar recorrente' }))
    expect(mock.criarRecorrencia).toHaveBeenCalledWith(expect.objectContaining({
      tipo: 'card', valor: 5590, dia: 5, contaId: null, cartaoId: 'k1', categoriaId: 'g1',
    }))
  })

  it('receita só oferece categorias de receita', async () => {
    const u = userEvent.setup()
    montar()
    await u.click(await screen.findByRole('button', { name: 'Novo recorrente' }))
    await u.selectOptions(screen.getByLabelText('Tipo'), 'income')
    // a categoria abre a folha do seletor: só as de receita aparecem
    await u.click(screen.getByLabelText('Categoria'))
    const folha = screen.getByRole('dialog', { name: 'Selecionar uma categoria' })
    expect(within(folha).queryByRole('button', { name: 'Moradia' })).toBeNull()
    expect(within(folha).getByRole('button', { name: 'Salário' })).toBeTruthy()
  })

  it('transferência exige destino diferente e não tem categoria', async () => {
    const u = userEvent.setup()
    montar()
    await u.click(await screen.findByRole('button', { name: 'Novo recorrente' }))
    await u.selectOptions(screen.getByLabelText('Tipo'), 'transfer')
    expect(screen.queryByLabelText('Categoria')).toBeNull()
    await u.type(screen.getByLabelText('Descrição'), 'Guardar')
    await u.type(screen.getByLabelText('Valor estimado (R$)'), '500,00')
    await u.selectOptions(screen.getByLabelText('Dia do mês'), '31')
    await u.click(screen.getByRole('button', { name: 'Cadastrar recorrente' }))
    expect(screen.getByText('Escolha uma conta de destino diferente.')).toBeTruthy()
    await u.selectOptions(screen.getByLabelText('Para a conta'), 'a2')
    await u.click(screen.getByRole('button', { name: 'Cadastrar recorrente' }))
    expect(mock.criarRecorrencia).toHaveBeenCalledWith(expect.objectContaining({ tipo: 'transfer', contaId: 'a1', destinoId: 'a2', categoriaId: null }))
  })

  it('editar muda valor', async () => {
    const u = userEvent.setup()
    mock.listarRecorrencias.mockResolvedValue([luz])
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    montar()
    await acao(u, 'Luz', 'Editar')
    expect(screen.queryByLabelText('Dia do mês')).toBeNull() // dia e conta não mudam na edição
    // avisa o alcance de cada campo e que a correção feita à mão em um mês não é desfeita pelo reajuste
    expect(screen.getByText(/Valor e descrição valem para os planejados ainda não pagos de hoje em diante\. A categoria vale para todos os meses, inclusive os já pagos e os passados\. Em qualquer caso, o que você corrigiu à mão em um mês fica como está\./)).toBeTruthy()
    // frequência não muda na edição: diz como mudar
    expect(screen.queryByLabelText('Frequência')).toBeNull()
    expect(screen.getByText(/Todo dia 10\. .*Para mudar o dia, edite em Lançamentos .*"Este e os próximos".*Para mudar a frequência, exclua este recorrente e cadastre outro\./)).toBeTruthy()
    const valor = screen.getByLabelText('Valor estimado (R$)')
    await u.clear(valor)
    await u.type(valor, '200,00')
    await u.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(mock.editarRecorrencia).toHaveBeenCalledWith('r1', { descricao: 'Luz', valor: 20000, categoriaId: 'g1', personId: null, isSharedExpense: false })
  })

  it('excluir pede confirmação e só então exclui; recusar a confirmação não faz nada', async () => {
    const u = userEvent.setup()
    mock.listarRecorrencias.mockResolvedValue([luz])
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValue(false)
    montar()
    await acao(u, 'Luz', 'Excluir')
    expect(confirmar).toHaveBeenCalledWith(expect.stringContaining('Excluir "Luz"?'))
    expect(mock.excluirRecorrencia).not.toHaveBeenCalled()
    confirmar.mockReturnValue(true)
    await acao(u, 'Luz', 'Excluir')
    expect(mock.excluirRecorrencia).toHaveBeenCalledWith('r1')
    expect(mock.listarRecorrencias).toHaveBeenCalledTimes(2) // recarrega a lista
    expect(mock.resumoRecorrencias).toHaveBeenCalledTimes(2) // e os totais do banco
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

  it('erro ao excluir aparece na tela e a lista não some', async () => {
    const u = userEvent.setup()
    mock.listarRecorrencias.mockResolvedValue([luz])
    mock.excluirRecorrencia.mockRejectedValue({ code: '42501', message: 'registro não encontrado' })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    montar()
    await acao(u, 'Luz', 'Excluir')
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByText('Luz')).toBeTruthy()
  })

  it('lista mostra a frequência, a próxima data e a data final', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-28T15:00:00Z'))
    mock.listarRecorrencias.mockResolvedValue([
      { ...luz, id: 'r3', descricao: 'PLR', tipo: 'income' as const, categoriaId: 'g2', dia: 20, cada: 12, inicio: '2027-02-01' },
      { ...luz, id: 'r4', descricao: 'Diarista', unidade: 'week' as const, cada: 2, dia: null, inicio: '2026-10-23', fim: '2027-06-30' },
    ])
    montar()
    expect(await screen.findByText('PLR')).toBeTruthy()
    // grupos por frequência: semanais antes de anuais; dentro do item, "próxima" curta no ano corrente
    expect(metas()).toEqual([
      // auditoria 5h: a próxima data abre a linha (no fim, era cortada pelas reticências no celular)
      'próxima 06/11 · quinzenal · sexta · Itaú · Moradia · até 30/06/2027',
      'próxima 20/02/2027 · 20 de fev · Itaú · Salário',
    ])
    // o detalhe completo continua no title
    expect(screen.getAllByTestId('meta-recorrente')[1].getAttribute('title')).toBe(
      'Anual · 20 de fevereiro · Itaú · Salário · Receita em conta · próxima 20/02/2027')
    vi.useRealTimers()
  })

  it('cadastra quinzenal: sem dia do mês, primeira data, data final e prévia das próximas', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-28T15:00:00Z'))
    const u = userEvent.setup()
    montar()
    await u.click(await screen.findByRole('button', { name: 'Novo recorrente' }))
    await u.selectOptions(screen.getByLabelText('Tipo'), 'income')
    await u.type(screen.getByLabelText('Descrição'), 'Freela')
    await u.type(screen.getByLabelText('Valor estimado (R$)'), '700,00')
    await u.selectOptions(screen.getByLabelText('Frequência'), 'quinzenal')
    expect(screen.queryByLabelText('Dia do mês')).toBeNull()
    const primeira = screen.getByLabelText('Primeira vez em')
    await u.clear(primeira)
    await u.type(primeira, '2026-10-30')
    await u.type(screen.getByLabelText('Até (opcional)'), '2027-03-31')
    expect(screen.getByText(/Repete toda sexta, a cada 14 dias\./)).toBeTruthy()
    expect(screen.getByText('30/10/2026 · 13/11/2026 · 27/11/2026')).toBeTruthy()
    await escolherCategoria(u, screen.getByLabelText('Categoria'), 'g2')
    await u.click(screen.getByRole('button', { name: 'Cadastrar recorrente' }))
    expect(mock.criarRecorrencia).toHaveBeenCalledWith(expect.objectContaining({
      tipo: 'income', unidade: 'week', cada: 2, dia: null, inicio: '2026-10-30', fim: '2027-03-31',
    }))
    vi.useRealTimers()
  })

  it('anual (PLR): dia do mês e mês do início; prévia mostra os anos seguintes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-28T15:00:00Z'))
    const u = userEvent.setup()
    montar()
    await u.click(await screen.findByRole('button', { name: 'Novo recorrente' }))
    await u.selectOptions(screen.getByLabelText('Tipo'), 'income')
    await u.type(screen.getByLabelText('Descrição'), 'PLR')
    await u.type(screen.getByLabelText('Valor estimado (R$)'), '9.000,00')
    await u.selectOptions(screen.getByLabelText('Frequência'), 'anual')
    await u.selectOptions(screen.getByLabelText('Dia do mês'), '20')
    const inicio = screen.getByLabelText('A partir de')
    await u.clear(inicio)
    await u.type(inicio, '2027-02-01')
    expect(screen.getByText('20/02/2027 · 20/02/2028 · 20/02/2029')).toBeTruthy()
    await escolherCategoria(u, screen.getByLabelText('Categoria'), 'g2')
    await u.click(screen.getByRole('button', { name: 'Cadastrar recorrente' }))
    expect(mock.criarRecorrencia).toHaveBeenCalledWith(expect.objectContaining({ unidade: 'month', cada: 12, dia: 20, inicio: '2027-02-01', fim: null }))
    vi.useRealTimers()
  })

  it('personalizada valida o limite (1–4 semanas) e avisa que datas antes de hoje não entram', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-28T15:00:00Z'))
    const u = userEvent.setup()
    montar()
    await u.click(await screen.findByRole('button', { name: 'Novo recorrente' }))
    await u.type(screen.getByLabelText('Descrição'), 'Faxina')
    await u.type(screen.getByLabelText('Valor estimado (R$)'), '200,00')
    await u.selectOptions(screen.getByLabelText('Frequência'), 'personalizada')
    await u.selectOptions(screen.getByLabelText('Unidade'), 'week')
    const cada = screen.getByLabelText('A cada')
    await u.clear(cada)
    await u.type(cada, '5')
    const primeira = screen.getByLabelText('Primeira vez em')
    await u.clear(primeira)
    await u.type(primeira, '2026-09-01')
    expect(screen.getByText(/Datas antes de hoje não são criadas\./)).toBeTruthy()
    await escolherCategoria(u, screen.getByLabelText('Categoria'), 'g1')
    await u.click(screen.getByRole('button', { name: 'Cadastrar recorrente' }))
    expect(screen.getByText('Use de 1 a 4 semanas.')).toBeTruthy()
    expect(mock.criarRecorrencia).not.toHaveBeenCalled()
    await u.clear(cada)
    await u.type(cada, '3')
    await u.click(screen.getByRole('button', { name: 'Cadastrar recorrente' }))
    expect(mock.criarRecorrencia).toHaveBeenCalledWith(expect.objectContaining({ unidade: 'week', cada: 3, dia: null }))
    vi.useRealTimers()
  })

  it('data final antes do início é recusada', async () => {
    const u = userEvent.setup()
    montar()
    await u.click(await screen.findByRole('button', { name: 'Novo recorrente' }))
    await u.type(screen.getByLabelText('Descrição'), 'Luz')
    await u.type(screen.getByLabelText('Valor estimado (R$)'), '180,00')
    await u.selectOptions(screen.getByLabelText('Dia do mês'), '10')
    const inicio = screen.getByLabelText('A partir de')
    await u.clear(inicio)
    await u.type(inicio, '2027-01-01')
    await u.type(screen.getByLabelText('Até (opcional)'), '2026-12-01')
    await escolherCategoria(u, screen.getByLabelText('Categoria'), 'g1')
    await u.click(screen.getByRole('button', { name: 'Cadastrar recorrente' }))
    expect(screen.getByText('A data final não pode ser antes do início.')).toBeTruthy()
    expect(mock.criarRecorrencia).not.toHaveBeenCalled()
  })

  describe('multimoeda F2 (migration 056)', () => {
    const contasMoedas = [
      { id: 'a1', nome: 'Itaú', tipo: 'checking', saldoInicial: c(0), abertura: '2026-01-01', ativa: true, saldo: c(0), moeda: 'BRL' },
      { id: 'a3', nome: 'Conta em euro', tipo: 'checking', saldoInicial: c(0), abertura: '2026-01-01', ativa: true, saldo: c(0), moeda: 'EUR' },
      { id: 'a4', nome: 'Reserva em euro', tipo: 'savings', saldoInicial: c(0), abertura: '2026-01-01', ativa: true, saldo: c(0), moeda: 'EUR' },
    ]
    /** "€ 9,90" com o espaço do Intl (NBSP ou espaço comum). */
    const moeda = (texto: string) => new RegExp(`^${texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(' ', '[\\s\\u00a0]')}$`)

    it('conta em euro é oferecida no recorrente de despesa e o valor pede €', async () => {
      mock.listarContas.mockResolvedValue({ contas: contasMoedas, total: c(0) })
      const u = userEvent.setup()
      montar()
      await u.click(await screen.findByRole('button', { name: 'Novo recorrente' }))
      const opcoes = Array.from((screen.getByLabelText('Conta') as HTMLSelectElement).options).map((o) => o.textContent)
      expect(opcoes).toEqual(['Escolha…', 'Itaú', 'Conta em euro', 'Reserva em euro'])
      await u.selectOptions(screen.getByLabelText('Conta'), 'a3')
      await u.type(screen.getByLabelText('Descrição'), 'Assinatura')
      await u.type(screen.getByLabelText('Valor estimado (€)'), '9,90')
      await u.selectOptions(screen.getByLabelText('Dia do mês'), '5')
      await escolherCategoria(u, screen.getByLabelText('Categoria'), 'g1')
      await u.click(screen.getByRole('button', { name: 'Cadastrar recorrente' }))
      expect(mock.criarRecorrencia).toHaveBeenCalledWith(expect.objectContaining({ tipo: 'expense', contaId: 'a3', valor: 990 }))
    })

    it('transferência: o destino só oferece contas da moeda da origem', async () => {
      mock.listarContas.mockResolvedValue({ contas: contasMoedas, total: c(0) })
      const u = userEvent.setup()
      montar()
      await u.click(await screen.findByRole('button', { name: 'Novo recorrente' }))
      await u.selectOptions(screen.getByLabelText('Tipo'), 'transfer')
      await u.selectOptions(screen.getByLabelText('Da conta'), 'a3')
      const destinos = Array.from((screen.getByLabelText('Para a conta') as HTMLSelectElement).options).map((o) => o.textContent)
      expect(destinos).toEqual(['Escolha…', 'Reserva em euro'])
    })

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
    const cabecalhos = () => screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent).filter((t) => t !== 'Resumo por mês' && t !== 'Projeção de compromissos')
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

    it('cartões do topo mostram o equivalente mensal e o total por ocorrência vindos do banco', async () => {
      montar()
      const cartao = (await screen.findByRole('heading', { name: 'No cartão, por mês' })).parentElement!
      expect(cartao.textContent).toContain('R$ 65,90')
      expect(cartao.textContent).toContain('equivalente por mês · R$ 175,90 por ocorrência · 2 assinaturas')
      const saidas = screen.getByRole('heading', { name: 'Na conta, por mês — saídas' }).parentElement!
      expect(saidas.textContent).toContain('R$ 2.354,16')
      expect(saidas.textContent).toContain('R$ 3.070,00 por ocorrência · 3 despesas')
      expect(screen.getByRole('heading', { name: 'Na conta, por mês — entradas' }).parentElement!.textContent).toContain('R$ 5.000,00')
      const transf = screen.getByRole('heading', { name: 'Transferências, por mês' }).parentElement!
      expect(transf.textContent).toContain('à parte, fora dos gastos')
      expect(mock.resumoRecorrencias).toHaveBeenCalledWith('h1')
      // por cartão e por conta (lista expansível)
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
      await screen.findByText('Salário')
      expect(cabecalhos()).toEqual(['Assinaturas no cartão · 2', 'Contas fixas · 2', 'Receitas · 1', 'Transferências · 1',
        'Já terminaram · fora dos totais'])
      // sem linha 'frequency' do banco para receitas: a faixa mostra só a contagem, a tela não soma
      expect(within(card(/^Receitas/)).getByRole('region', { name: 'Mensais · 1 · Receitas' }).textContent).not.toContain('/mês')
      expect(screen.getByTestId('total-income').textContent).toBe('R$ 5.000,00/mês')
      expect(within(card(/^Já terminaram/)).getByText('Academia antiga')).toBeTruthy()
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
      expect(Array.from(mensais.querySelectorAll('li p:first-child')).map((p) => p.textContent))
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

    it('item compacto: título, valor numa coluna própria, uma linha de metadados e ações no menu ⋯', async () => {
      const u = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      montar()
      const titulo = await screen.findByText('Condomínio do prédio com nome bem comprido')
      expect(titulo.className).toContain('truncate')
      const li = titulo.closest('li')!
      const valor = li.querySelector('span.tabular-nums')!
      expect(valor.textContent).toBe('−R$ 180,00')
      expect(valor.className).toContain('whitespace-nowrap')
      expect(li.querySelectorAll('p')).toHaveLength(2) // no máximo 2 linhas de texto
      // sem botões soltos de Editar/Excluir: só o menu
      expect(screen.queryByRole('button', { name: 'Editar' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Excluir' })).toBeNull()
      await u.click(screen.getByRole('button', { name: 'Ações de Condomínio do prédio com nome bem comprido' }))
      expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Editar', 'Excluir'])
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
