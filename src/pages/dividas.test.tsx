// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mock = vi.hoisted(() => ({
  listarDividas: vi.fn(),
  listarContas: vi.fn(),
  listarCategorias: vi.fn(),
  renomearDivida: vi.fn(),
  listarParcelasDivida: vi.fn(),
  registrarPagamentoParcela: vi.fn(),
  arquivarDivida: vi.fn(),
  reativarDivida: vi.fn(),
  excluirDivida: vi.fn(),
  definirCategoriaPrincipal: vi.fn(),
  registrarPagamentoDivida: vi.fn(),
}))
vi.mock('../lib/FamiliaContext', () => ({
  useFamilia: () => ({ familia: { id: 'h1', nome: 'Casa', papel: 'owner' }, carregando: false, erro: false, recarregar: vi.fn() }),
}))
vi.mock('../lib/dividas', async (o) => ({ ...(await o<typeof import('../lib/dividas')>()), listarDividas: mock.listarDividas, renomearDivida: mock.renomearDivida, listarParcelasDivida: mock.listarParcelasDivida, registrarPagamentoDivida: mock.registrarPagamentoDivida, registrarPagamentoParcela: mock.registrarPagamentoParcela, arquivarDivida: mock.arquivarDivida, reativarDivida: mock.reativarDivida, excluirDivida: mock.excluirDivida, definirCategoriaPrincipal: mock.definirCategoriaPrincipal }))
vi.mock('../lib/contas', async (o) => ({ ...(await o<typeof import('../lib/contas')>()), listarContas: mock.listarContas }))
vi.mock('../lib/categorias', async (o) => ({ ...(await o<typeof import('../lib/categorias')>()), listarCategorias: mock.listarCategorias }))

import Dividas from './Dividas'
import type { Cents } from '../lib/format'

const c = (n: number) => n as Cents
/** As ações de cada dívida moram no ⋯ (pedido do dono, 10/11/2026): abre o menu da dívida e escolhe a ação. */
async function acao(nomeDivida: string, rotulo: string, u: ReturnType<typeof userEvent.setup> = userEvent.setup()) {
  await u.click(await screen.findByRole('button', { name: `Ações de ${nomeDivida}` }))
  await u.click(screen.getByRole('menuitem', { name: rotulo }))
}

const ativas = () => [
  { id: 'd1', nome: 'Financiamento do imóvel', tipo: 'financing', saldo: c(25000000), compromissos: c(0), ativa: true, taxaMensalBps: 90, pagamentoMinimo: c(250000) },
  { id: 'd2', nome: 'Empréstimo pessoal', tipo: 'loan', saldo: c(500000), compromissos: c(0), ativa: true, taxaMensalBps: 200, pagamentoMinimo: c(50000) },
]
const quitada = { id: 'd9', nome: 'Consignado antigo', tipo: 'loan', saldo: c(0), compromissos: c(0), ativa: false, taxaMensalBps: 0, pagamentoMinimo: c(0) }
// a tela lê duas listas: ativas (padrão) e arquivadas
const porSituacao = (lista: unknown[], arquivadas: unknown[] = []) =>
  (_f: string, _d: string, situacao = 'ativas') => Promise.resolve(situacao === 'arquivadas' ? arquivadas : lista)

beforeEach(() => {
  mock.listarDividas.mockImplementation(porSituacao(ativas()))
  mock.arquivarDivida.mockResolvedValue(undefined)
  mock.reativarDivida.mockResolvedValue(undefined)
  mock.excluirDivida.mockResolvedValue(undefined)
  mock.definirCategoriaPrincipal.mockResolvedValue(undefined)
  mock.listarContas.mockResolvedValue({ contas: [], total: c(0) })
  mock.listarCategorias.mockResolvedValue([])
  mock.renomearDivida.mockResolvedValue(undefined)
  mock.listarParcelasDivida.mockResolvedValue([])
  mock.registrarPagamentoParcela.mockResolvedValue(undefined)
  mock.registrarPagamentoDivida.mockResolvedValue(undefined)
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('Dívidas', () => {
  it('lista empréstimos e financiamentos, com a grafia correta do tipo', async () => {
    render(<Dividas />)
    expect(await screen.findByText('Financiamento do imóvel')).toBeTruthy()
    expect(screen.getByText('Empréstimo pessoal')).toBeTruthy()
    expect(screen.getByText('Financiamento')).toBeTruthy() // rótulo do tipo
    expect(screen.getByText('Empréstimo')).toBeTruthy()
  })

  it('multimoeda F1: conta em outra moeda não aparece como conta de saída do pagamento (o banco também recusa)', async () => {
    mock.listarContas.mockResolvedValue({ contas: [
      { id: 'a1', nome: 'Itaú', tipo: 'checking', saldoInicial: c(0), abertura: '2026-01-01', ativa: true, saldo: c(0), moeda: 'BRL' },
      { id: 'a3', nome: 'Conta em dólar', tipo: 'checking', saldoInicial: c(0), abertura: '2026-01-01', ativa: true, saldo: c(0), moeda: 'USD' },
    ], total: c(0) })
    render(<Dividas />)
    const u = userEvent.setup()
    await screen.findByText('Financiamento do imóvel')
    await acao('Financiamento do imóvel', 'Registrar pagamento', u)
    const opcoes = Array.from((screen.getByLabelText('Conta de saída') as HTMLSelectElement).options).map((o) => o.textContent)
    expect(opcoes).toEqual(['Selecione a conta', 'Itaú'])
  })

  it('amortização extra com FGTS: "Nenhuma (FGTS ou fora do app)" manda conta nula; juros ou tarifa sem conta são recusados na tela', async () => {
    mock.listarDividas.mockImplementation(porSituacao([{ ...ativas()[0], parcelasRestantes: 353, parcelasOriginais: 412, valorParcela: c(119922) }]))
    mock.listarContas.mockResolvedValue({ contas: [
      { id: 'a1', nome: 'CAIXA', tipo: 'checking', saldoInicial: c(0), abertura: '2026-01-01', ativa: true, saldo: c(0), moeda: 'BRL' },
    ], total: c(0) })
    render(<Dividas />)
    const u = userEvent.setup()
    await acao('Financiamento do imóvel', 'Amortização extra', u)
    await u.selectOptions(screen.getByLabelText('Conta de saída'), '__sem_conta__')
    expect(screen.getByText(/Nenhuma conta muda: só o saldo da dívida diminui/)).toBeTruthy()
    await u.type(screen.getByLabelText('Valor total pago (R$)'), '18.009,57')
    await u.clear(screen.getByLabelText('Juros incluídos (R$)'))
    await u.type(screen.getByLabelText('Juros incluídos (R$)'), '10,00')
    await u.click(screen.getByRole('button', { name: 'Confirmar baixa' }))
    expect(screen.getByText(/Sem conta \(ex\.: FGTS\), registre só a amortização/)).toBeTruthy()
    expect(mock.registrarPagamentoDivida).not.toHaveBeenCalled()
    await u.clear(screen.getByLabelText('Juros incluídos (R$)'))
    await u.type(screen.getByLabelText('Juros incluídos (R$)'), '0,00')
    await u.click(screen.getByLabelText(/reduziu o prazo/))
    await u.type(screen.getByLabelText(/Parcelas restantes agora/), '300')
    await u.click(screen.getByRole('button', { name: 'Confirmar baixa' }))
    expect(mock.registrarPagamentoDivida).toHaveBeenCalledWith(expect.objectContaining({ dividaId: 'd1', contaId: null, principal: 1800957, juros: 0, tarifa: 0, extra: true,
      ajuste: { modo: 'term', parcelasRestantes: 300 } }))
  })

  describe('amortização extra: reduz o prazo ou a parcela (migration 103; o dono digita o que o banco informou)', () => {
    async function abrir() {
      mock.listarDividas.mockImplementation(porSituacao([{ ...ativas()[0], parcelasRestantes: 353, parcelasOriginais: 412, valorParcela: c(119922) }]))
      mock.listarContas.mockResolvedValue({ contas: [
        { id: 'a1', nome: 'CAIXA', tipo: 'checking', saldoInicial: c(0), abertura: '2026-01-01', ativa: true, saldo: c(0), moeda: 'BRL' },
      ], total: c(0) })
      render(<Dividas />)
      const u = userEvent.setup()
      await screen.findByText('Financiamento do imóvel')
      await acao('Financiamento do imóvel', 'Amortização extra', u)
      await u.selectOptions(screen.getByLabelText('Conta de saída'), 'a1')
      await u.type(screen.getByLabelText('Valor total pago (R$)'), '10.000,00')
      return u
    }

    it('sem escolher prazo ou parcela, não grava', async () => {
      const u = await abrir()
      await u.click(screen.getByRole('button', { name: 'Confirmar baixa' }))
      expect(screen.getByText('Informe se a amortização reduziu o prazo ou a parcela.')).toBeTruthy()
      expect(mock.registrarPagamentoDivida).not.toHaveBeenCalled()
    })

    it('reduziu o prazo: manda as parcelas restantes novas; prazo maior que o atual é recusado', async () => {
      const u = await abrir()
      await u.click(screen.getByLabelText(/reduziu o prazo/))
      await u.type(screen.getByLabelText(/Parcelas restantes agora/), '400')
      await u.click(screen.getByRole('button', { name: 'Confirmar baixa' }))
      expect(screen.getByText(/de 0 a 353/)).toBeTruthy()
      expect(mock.registrarPagamentoDivida).not.toHaveBeenCalled()
      await u.clear(screen.getByLabelText(/Parcelas restantes agora/))
      await u.type(screen.getByLabelText(/Parcelas restantes agora/), '310')
      await u.click(screen.getByRole('button', { name: 'Confirmar baixa' }))
      expect(mock.registrarPagamentoDivida).toHaveBeenCalledWith(expect.objectContaining({ contaId: 'a1', principal: 1000000, extra: true,
        ajuste: { modo: 'term', parcelasRestantes: 310 } }))
    })

    it('reduziu a parcela: manda o valor novo em centavos; parcela maior que a atual é recusada', async () => {
      const u = await abrir()
      await u.click(screen.getByLabelText(/reduziu a parcela/))
      await u.type(screen.getByLabelText(/Parcela nova/), '1.500,00')
      await u.click(screen.getByRole('button', { name: 'Confirmar baixa' }))
      expect(screen.getByText(/não maior que a atual/)).toBeTruthy()
      expect(mock.registrarPagamentoDivida).not.toHaveBeenCalled()
      await u.clear(screen.getByLabelText(/Parcela nova/))
      await u.type(screen.getByLabelText(/Parcela nova/), '1.050,10')
      await u.click(screen.getByRole('button', { name: 'Confirmar baixa' }))
      expect(mock.registrarPagamentoDivida).toHaveBeenCalledWith(expect.objectContaining({ extra: true,
        ajuste: { modo: 'installment', valorParcela: 105010 } }))
    })

    it('dívida sem parcelas em aberto não pergunta nada (pagamento comum)', async () => {
      render(<Dividas />)
      const u = userEvent.setup()
      await screen.findByText('Financiamento do imóvel')
      await acao('Financiamento do imóvel', 'Registrar pagamento', u)
      await u.click(screen.getByLabelText('Amortização extraordinária de principal'))
      expect(screen.queryByText(/Depois da amortização, o banco/)).toBeNull()
    })
  })

  it('pagamento comum (sem ser amortização extra) não oferece "sem conta"', async () => {
    mock.listarContas.mockResolvedValue({ contas: [
      { id: 'a1', nome: 'CAIXA', tipo: 'checking', saldoInicial: c(0), abertura: '2026-01-01', ativa: true, saldo: c(0), moeda: 'BRL' },
    ], total: c(0) })
    render(<Dividas />)
    const u = userEvent.setup()
    await screen.findByText('Financiamento do imóvel')
    await acao('Financiamento do imóvel', 'Registrar pagamento', u)
    const opcoes = Array.from((screen.getByLabelText('Conta de saída') as HTMLSelectElement).options).map((o) => o.textContent)
    expect(opcoes).not.toContain('Nenhuma (FGTS ou fora do app)')
  })

  it('linha compacta: tipo, credor e forma; parcela, restam e próxima; "Confirmar parcela" abre a baixa da próxima', async () => {
    mock.listarDividas.mockImplementation(porSituacao([{ ...ativas()[0], credor: 'Caixa', formaPagamento: 'account_debit', contaPagamentoId: 'a1',
      valorParcela: c(119922), parcelasRestantes: 353, parcelasOriginais: 412 }]))
    mock.listarContas.mockResolvedValue({ contas: [
      { id: 'a1', nome: 'CAIXA', tipo: 'checking', saldoInicial: c(0), abertura: '2026-01-01', ativa: true, saldo: c(0), moeda: 'BRL' },
    ], total: c(0) })
    mock.listarParcelasDivida.mockResolvedValue([{ id: 'p1', dividaId: 'd1', nomeDivida: 'Financiamento do imóvel', numero: 1,
      vencimento: '2026-12-06', valor: c(119922), formaPagamento: 'account_debit', contaPagamentoId: 'a1' }])
    const u = userEvent.setup()
    render(<Dividas />)
    expect(await screen.findByText('Financiamento · Caixa · débito em CAIXA')).toBeTruthy()
    const linha = screen.getByRole('button', { name: 'Ações de Financiamento do imóvel' }).closest('li') as HTMLElement
    const pares = Array.from(linha.querySelectorAll('dl')[0].querySelectorAll('dt')).map((dt) => `${dt.textContent} ${dt.nextElementSibling?.textContent}`)
    expect(pares).toEqual(['Parcela R$ 1.199,22', 'Restam 353 de 412', 'Próxima 06/12/2026'])
    await u.click(within(linha).getByRole('button', { name: 'Confirmar a parcela de 06/12/2026, Financiamento do imóvel' }))
    expect(screen.getByRole('heading', { name: 'Baixar parcela: Financiamento do imóvel' })).toBeTruthy()
  })

  it('não oferece o simulador de quitação (removido a pedido do dono)', async () => {
    render(<Dividas />)
    await screen.findByText('Financiamento do imóvel')
    expect(screen.queryByText(/simulador/i)).toBeNull()
    expect(screen.queryByText(/snowball/i)).toBeNull()
    expect(screen.queryByText(/avalanche/i)).toBeNull()
    expect(screen.queryByLabelText(/Orçamento mensal total/)).toBeNull()
    // o que continua: registrar pagamento e os parâmetros do contrato
    expect(screen.getAllByRole('button', { name: /^Ações de / })).toHaveLength(2)
    await userEvent.click(screen.getByRole('button', { name: 'Ações de Financiamento do imóvel' }))
    expect(screen.getByRole('menuitem', { name: 'Registrar pagamento' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Parâmetros da dívida' })).toBeTruthy()
  })

  it('renomear: corrige o nome de um financiamento cadastrado com erro de digitação', async () => {
    mock.listarDividas.mockImplementation(porSituacao([
      { id: 'd1', nome: 'Financiamenyo', tipo: 'financing', saldo: c(25000000), compromissos: c(0), ativa: true, taxaMensalBps: 90, pagamentoMinimo: c(250000) },
    ]))
    const u = userEvent.setup()
    render(<Dividas />)
    await acao('Financiamenyo', 'Renomear', u)
    const campo = screen.getByLabelText('Nome')
    await u.clear(campo)
    await u.type(campo, '  Financiamento do imóvel ')
    await u.click(screen.getByRole('button', { name: 'Salvar nome' }))
    expect(mock.renomearDivida).toHaveBeenCalledWith('d1', '  Financiamento do imóvel ')
  })

  it('renomear: nome vazio não chama o banco', async () => {
    const u = userEvent.setup()
    render(<Dividas />)
    await acao('Empréstimo pessoal', 'Renomear', u)
    await u.clear(screen.getByLabelText('Nome'))
    await u.click(screen.getByRole('button', { name: 'Salvar nome' }))
    expect(screen.getByText('Informe o nome.')).toBeTruthy()
    expect(mock.renomearDivida).not.toHaveBeenCalled()
  })

  it('renomear: erro do banco aparece e a tela segue', async () => {
    mock.renomearDivida.mockRejectedValue(new Error('nome inválido: use de 1 a 60 caracteres'))
    const u = userEvent.setup()
    render(<Dividas />)
    await acao('Empréstimo pessoal', 'Renomear', u)
    await u.type(screen.getByLabelText('Nome'), ' novo')
    await u.click(screen.getByRole('button', { name: 'Salvar nome' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByText('Empréstimo pessoal')).toBeTruthy()
  })
  it('consignado: a parcela traz juros e só o principal abate o saldo; sem conta de saída', async () => {
    mock.listarParcelasDivida.mockResolvedValue([
      { id: 'p1', dividaId: 'd2', nomeDivida: 'Empréstimo pessoal', numero: 1, vencimento: '2027-01-05', valor: c(56000), formaPagamento: 'payroll', contaPagamentoId: null },
    ])
    render(<Dividas />)
    await userEvent.click(await screen.findByRole('button', { name: 'Baixar parcela' }))
    expect(screen.queryByLabelText('Conta de saída')).toBeNull()
    const juros = screen.getByLabelText('Juros incluídos (R$)')
    await userEvent.clear(juros)
    await userEvent.type(juros, '60,00')
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar baixa' }))
    expect(mock.registrarPagamentoParcela).toHaveBeenCalledWith(expect.objectContaining({
      parcelaId: 'p1', contaId: null, principal: c(50000), juros: c(6000), tarifa: c(0),
    }))
  })
  it('arquivar: confirma dentro do card da própria dívida e recarrega a lista', async () => {
    render(<Dividas />)
    await acao('Empréstimo pessoal', 'Arquivar')
    const painel = screen.getByRole('group', { name: 'Arquivar Empréstimo pessoal' })
    expect(painel.closest('li')).toBe(screen.getByRole('button', { name: 'Ações de Empréstimo pessoal' }).closest('li'))
    const antes = mock.listarDividas.mock.calls.length
    await userEvent.click(within(painel).getByRole('button', { name: 'Arquivar dívida' }))
    expect(mock.arquivarDivida).toHaveBeenCalledWith('d2')
    await vi.waitFor(() => expect(mock.listarDividas.mock.calls.length).toBeGreaterThan(antes))
  })

  it('arquivar com saldo: a recusa do banco aparece no próprio card, não no topo da página', async () => {
    mock.arquivarDivida.mockRejectedValue({ code: '23514', message: 'tem saldo ou parcelas a vencer: quite ou cancele antes de arquivar' })
    render(<Dividas />)
    await acao('Financiamento do imóvel', 'Arquivar')
    const painel = screen.getByRole('group', { name: 'Arquivar Financiamento do imóvel' })
    await userEvent.click(within(painel).getByRole('button', { name: 'Arquivar dívida' }))
    expect(await within(painel).findByText(/quite ou cancele antes de arquivar/)).toBeTruthy()
  })

  it('excluir chama o banco com a dívida certa', async () => {
    render(<Dividas />)
    await acao('Financiamento do imóvel', 'Excluir')
    await userEvent.click(within(screen.getByRole('group', { name: 'Excluir Financiamento do imóvel' })).getByRole('button', { name: 'Excluir dívida' }))
    expect(mock.excluirDivida).toHaveBeenCalledWith('d1')
  })

  it('arquivadas aparecem em seção própria, com Reativar', async () => {
    mock.listarDividas.mockImplementation(porSituacao(ativas(), [quitada]))
    render(<Dividas />)
    const secao = (await screen.findByRole('heading', { name: 'Arquivadas' })).closest('section')!
    expect(within(secao).getByText('Consignado antigo')).toBeTruthy()
    expect(within(secao).queryByText('Empréstimo pessoal')).toBeNull()
    await userEvent.click(within(secao).getByRole('button', { name: 'Reativar Consignado antigo' }))
    expect(mock.reativarDivida).toHaveBeenCalledWith('d9')
  })

  it('só com dívidas arquivadas: a seção aparece mesmo sem nenhuma ativa', async () => {
    mock.listarDividas.mockImplementation(porSituacao([], [quitada]))
    render(<Dividas />)
    expect(await screen.findByRole('heading', { name: 'Arquivadas' })).toBeTruthy()
  })
  it('vindo de Lançamentos (?baixar=), abre a baixa da parcela; a agenda inclui as vencidas e as marca', async () => {
    mock.listarParcelasDivida.mockResolvedValue([
      { id: 'p1', dividaId: 'd2', nomeDivida: 'Empréstimo pessoal', numero: 1, vencimento: '2026-01-05', valor: c(56000), formaPagamento: 'boleto', contaPagamentoId: null },
    ])
    window.history.pushState(null, '', '/dividas?baixar=p1')
    render(<Dividas />)
    expect(await screen.findByRole('heading', { name: 'Baixar parcela: Empréstimo pessoal' })).toBeTruthy()
    expect(screen.getByText('Vencida ·')).toBeTruthy()
    expect(window.location.search).toBe('')
    expect(mock.listarParcelasDivida.mock.calls[0][1]).toBe('2000-01-01')
  })
  it('categoria da parcela: escolhida da aba Categorias, gravada na dívida; vazio volta para "Sem categoria"', async () => {
    mock.listarCategorias.mockResolvedValue([
      { id: 'fin', nome: 'Financiamento', tipo: 'expense', ativa: true, paiId: null, sistema: false },
      { id: 'sal', nome: 'Salário', tipo: 'income', ativa: true, paiId: null, sistema: false },
    ])
    const lista = ativas().map((d) => (d.id === 'd1' ? { ...d, categoriaPrincipalId: 'fin' } : d))
    mock.listarDividas.mockImplementation(porSituacao(lista))
    render(<Dividas />)
    const campo = await screen.findByLabelText('Categoria da parcela de Empréstimo pessoal') as HTMLSelectElement
    expect(campo.value).toBe('')
    expect(within(campo).queryByRole('option', { name: 'Salário' })).toBeNull() // só despesa
    await userEvent.selectOptions(campo, 'fin')
    expect(mock.definirCategoriaPrincipal).toHaveBeenCalledWith('d2', 'fin')
    const doImovel = screen.getByLabelText('Categoria da parcela de Financiamento do imóvel') as HTMLSelectElement
    expect(doImovel.value).toBe('fin')
    await userEvent.selectOptions(doImovel, '')
    expect(mock.definirCategoriaPrincipal).toHaveBeenCalledWith('d1', null)
  })

  it('agenda: todas as parcelas, separadas por dívida, até a última (antes, só as 12 primeiras de todas juntas)', async () => {
    const parc = (d: string, nome: string, n: number) => ({ id: `${d}-${n}`, dividaId: d, nomeDivida: nome, numero: n,
      vencimento: `2027-${String(n).padStart(2, '0')}-05`.replace(/-(1[3-9]|[2-9]\d)-/, '-12-'), valor: c(250000), formaPagamento: 'boleto', contaPagamentoId: null })
    mock.listarParcelasDivida.mockResolvedValue([
      ...Array.from({ length: 15 }, (_, i) => parc('d1', 'Financiamento do imóvel', i + 1)),
      parc('d2', 'Empréstimo pessoal', 1), parc('d2', 'Empréstimo pessoal', 2),
    ])
    const u = userEvent.setup()
    render(<Dividas />)
    // a agenda completa fica recolhida; cada dívida mostra a próxima parcela no próprio card
    expect(await screen.findByRole('button', { name: 'Confirmar a parcela de 05/01/2027, Financiamento do imóvel' })).toBeTruthy()
    const agenda = (await screen.findByText('Todas as próximas parcelas (17)')).closest('details') as HTMLDetailsElement
    agenda.open = true
    const imovel = within(agenda).getByRole('heading', { name: /Financiamento do imóvel/ }).closest('div[class*="rounded"]') as HTMLElement
    const emprestimo = within(agenda).getByRole('heading', { name: /Empréstimo pessoal/ }).closest('div[class*="rounded"]') as HTMLElement
    expect(within(emprestimo).getAllByRole('listitem')).toHaveLength(2) // a segunda dívida não some
    expect(within(imovel).getAllByRole('listitem')).toHaveLength(3)
    await u.click(within(imovel).getByRole('button', { name: 'Ver todas as 15 parcelas' }))
    expect(within(imovel).getAllByRole('listitem')).toHaveLength(15)
    expect(within(imovel).getByText('Parcela 15')).toBeTruthy()
    // só a primeira de cada dívida pode ser baixada
    expect(within(imovel).getAllByRole('button', { name: 'Baixar parcela' })).toHaveLength(1)
    expect(within(emprestimo).getAllByRole('button', { name: 'Baixar parcela' })).toHaveLength(1)
  })

  it('agenda que falha avisa, em vez de sumir (parecia que não havia nada a pagar)', async () => {
    mock.listarParcelasDivida.mockRejectedValue(new Error('rede'))
    render(<Dividas />)
    expect(await screen.findByText(/Não foi possível carregar as próximas parcelas/)).toBeTruthy()
  })
})
