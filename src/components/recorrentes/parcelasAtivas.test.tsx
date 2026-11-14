// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'
import type { Cents } from '../../lib/format'
import { MASCARA, definirValoresOcultos } from '../../lib/privacidade'

const mock = vi.hoisted(() => ({ listarParcelasAtivas: vi.fn(), listarParcelasQueAcabam: vi.fn(), listarCronogramaParcelas: vi.fn(), registrarFalhaConsulta: vi.fn() }))
vi.mock('../../lib/parcelasAtivas', () => ({ listarParcelasAtivas: mock.listarParcelasAtivas, listarParcelasQueAcabam: mock.listarParcelasQueAcabam, listarCronogramaParcelas: mock.listarCronogramaParcelas }))
vi.mock('../../lib/consultaOpcional', () => ({ registrarFalhaConsulta: mock.registrarFalhaConsulta }))

import { ParcelasAtivas } from './ParcelasAtivas'
import type { ParcelaDoCronograma, ParcelamentoAtivo, ParcelasAtivas as Dados } from '../../lib/parcelasAtivas'

const c = (n: number) => n as Cents
const plano = (p: Partial<ParcelamentoAtivo> = {}): ParcelamentoAtivo => ({
  chave: 'card:k1:p1', origem: 'card', moeda: 'BRL', descricao: 'Geladeira', origemId: 'k1', origemNome: 'Nubank',
  valorParcela: c(10000), parcelaAtual: 5, totalParcelas: 10, parcelasPagas: 4, percentualPago: 40,
  total: c(100000), pago: c(40000), saldoRestante: c(60000), futuro: c(50000), situacaoMes: 'pending',
  proximoVencimento: '2026-11-15', emAtraso: 0, ...p,
})
const dados = (parcelamentos: ParcelamentoAtivo[], totais: Dados['totais'] = []): Dados => ({ parcelamentos, totais })
const montar = () => render(<MemoryRouter><ParcelasAtivas familiaId="h1" /></MemoryRouter>)
const brl = (cents: number, moeda = 'BRL') => ({ moeda, qtde: 1, saldoRestante: c(cents), futuro: c(cents) })

beforeEach(() => { localStorage.clear(); definirValoresOcultos(false); mock.listarParcelasQueAcabam.mockResolvedValue({ planos: [], totais: [] }); mock.listarCronogramaParcelas.mockResolvedValue(new Map()) })
afterEach(() => { cleanup(); vi.clearAllMocks(); definirValoresOcultos(false) })

describe('Parcelas ativas', () => {
  it('cada parcelamento vira um cartão: descrição, origem, parcela n de N, % pago, saldo restante e situação do mês', async () => {
    mock.listarParcelasAtivas.mockResolvedValue(dados([
      plano(),
      plano({ chave: 'account:g1', origem: 'account', descricao: 'Sofá', origemId: 'a1', origemNome: 'Banco', parcelaAtual: 3, totalParcelas: 5,
        percentualPago: 20, saldoRestante: c(40000), situacaoMes: 'paid', proximoVencimento: '2026-12-12' }),
      plano({ chave: 'card:k1:p2', descricao: 'Curso', situacaoMes: 'none', proximoVencimento: null }),
    ], [brl(80000)]))
    montar()
    const cartoes = await screen.findAllByTestId('parcelamento')
    expect(cartoes).toHaveLength(3)

    const geladeira = within(cartoes[0])
    expect(geladeira.getByRole('heading', { name: 'Geladeira' })).toBeTruthy()
    expect(geladeira.getByText(/Cartão de crédito/)).toBeTruthy()
    expect(geladeira.getByText('Parcela 5 de 10')).toBeTruthy()
    expect(geladeira.getByText('40% pago')).toBeTruthy()
    expect(geladeira.getByText('Saldo restante').nextSibling?.textContent).toBe('−R$ 600,00')
    expect(geladeira.getByText('−R$ 100,00')).toBeTruthy()
    // a parcela que vence no mês e não foi paga ganha o selo "Pendente de pagamento" (volta a pedido do dono) e o link ao cartão
    expect(geladeira.getByText('Pendente de pagamento')).toBeTruthy()
    expect(geladeira.getByRole('link', { name: 'Ver fatura no cartão' }).getAttribute('href')).toBe('/cartoes/k1')
    expect(geladeira.getByText('Próximo vencimento 15/11/2026')).toBeTruthy()

    const sofa = within(cartoes[1])
    expect(sofa.getByText(/Parcelamento em conta/)).toBeTruthy()
    expect(sofa.getByText('Parcela 3 de 5')).toBeTruthy()
    expect(sofa.getByText('Parcela deste mês paga')).toBeTruthy()
    expect(sofa.queryByText('Pendente de pagamento')).toBeNull()
    // carnê: o pagamento é um lançamento da conta, no mês do vencimento
    expect(sofa.getByRole('link', { name: 'Ver lançamento' }).getAttribute('href')).toBe('/lancamentos?mes=2026-12')

    expect(within(cartoes[2]).queryByText('Nenhuma parcela neste mês')).toBeNull()
    expect(within(cartoes[2]).queryByText(/Próximo vencimento/)).toBeNull()
    expect(within(cartoes[2]).queryByText('Pendente de pagamento')).toBeNull()
  })

  it('a barra de progresso é acessível e usa o percentual que veio do banco (nada é recalculado a partir dos valores)', async () => {
    // valores que, se recalculados no front, dariam outro número (pago 90% do total): o que vale é percentualPago = 37
    mock.listarParcelasAtivas.mockResolvedValue(dados([
      plano({ percentualPago: 37, total: c(100000), pago: c(90000), saldoRestante: c(10000) }),
    ], [brl(10000)]))
    montar()
    const barra = await screen.findByRole('progressbar', { name: 'Geladeira: 37% pago' })
    expect(barra.getAttribute('aria-valuenow')).toBe('37')
    expect(barra.getAttribute('aria-valuemin')).toBe('0')
    expect(barra.getAttribute('aria-valuemax')).toBe('100')
    expect((barra.firstElementChild as HTMLElement).style.width).toBe('37%')
  })

  it('o total vem do banco: a tela não soma os saldos dos cartões', async () => {
    mock.listarParcelasAtivas.mockResolvedValue(dados([
      plano({ saldoRestante: c(60000) }), plano({ chave: 'card:k1:p2', saldoRestante: c(20000) }),
    ], [{ moeda: 'BRL', qtde: 2, saldoRestante: c(123456), futuro: c(7890) }]))
    montar()
    const total = await screen.findByTestId('total-parcelas-BRL')
    expect(within(total).getByText('−R$ 1.234,56')).toBeTruthy()
    expect(within(total).getByText('−R$ 78,90')).toBeTruthy()
    expect(within(total).getByText(/Saldo restante · 2 parcelamentos/)).toBeTruthy()
    expect(within(total).getByText(/Nas faturas futuras/)).toBeTruthy()
    // a soma dos dois cartões (R$ 800,00) nunca é calculada
    expect(within(total).queryByText('−R$ 800,00')).toBeNull()
  })

  it('moedas diferentes têm totais separados, cada um na sua moeda', async () => {
    mock.listarParcelasAtivas.mockResolvedValue(dados([
      plano(), plano({ chave: 'account:g2', origem: 'account', moeda: 'USD', descricao: 'Curso em dólar', valorParcela: c(10000), saldoRestante: c(20000) }),
    ], [brl(60000), { moeda: 'USD', qtde: 1, saldoRestante: c(20000), futuro: c(20000) }]))
    montar()
    expect(await screen.findByTestId('total-parcelas-BRL')).toBeTruthy()
    const usd = screen.getByTestId('total-parcelas-USD')
    expect(usd.textContent).toContain('(USD)')
    expect(usd.textContent).toMatch(/US\$\s?200,00/)
  })

  it('atraso aparece com texto (a cor não é a única informação)', async () => {
    mock.listarParcelasAtivas.mockResolvedValue(dados([plano({ emAtraso: 1 }), plano({ chave: 'card:k1:p2', emAtraso: 2 })], [brl(1)]))
    montar()
    expect(await screen.findByText('1 parcela em atraso')).toBeTruthy()
    expect(screen.getByText('2 parcelas em atraso')).toBeTruthy()
  })

  it('valor da parcela e saldo restante são saídas: vermelho e com o sinal de menos', async () => {
    mock.listarParcelasAtivas.mockResolvedValue(dados([plano()], [brl(60000)]))
    montar()
    const cartao = await screen.findByTestId('parcelamento')
    for (const texto of ['−R$ 100,00', '−R$ 600,00']) {
      expect(within(cartao).getByText(texto).className).toContain('text-prejuizo')
    }
  })

  it('ocultar valores: nenhum valor em dinheiro aparece; o progresso (que não é dinheiro) continua', async () => {
    definirValoresOcultos(true)
    mock.listarParcelasAtivas.mockResolvedValue(dados([plano()], [brl(60000)]))
    montar()
    const cartao = await screen.findByTestId('parcelamento')
    expect(cartao.textContent).not.toMatch(/\d+,\d{2}/)
    expect(within(cartao).getAllByText(`−${MASCARA}`).length).toBe(2)
    expect(screen.getByTestId('total-parcelas-BRL').textContent).not.toMatch(/\d+,\d{2}/)
    expect(within(cartao).getByText('40% pago')).toBeTruthy()
    // ligar e desligar na hora, sem recarregar
    act(() => definirValoresOcultos(false))
    expect(within(cartao).getByText('−R$ 600,00')).toBeTruthy()
  })

  it('o cartão do parcelamento leva para a página do cartão', async () => {
    mock.listarParcelasAtivas.mockResolvedValue(dados([plano()], [brl(60000)]))
    montar()
    const link = await screen.findByRole('link', { name: 'Nubank' })
    expect(link.getAttribute('href')).toBe('/cartoes/k1')
  })

  it('"+ Novo parcelamento" abre o fluxo que já existe (compra no cartão); a despesa em conta tem o seu atalho', async () => {
    mock.listarParcelasAtivas.mockResolvedValue(dados([plano()], [brl(60000)]))
    montar()
    await screen.findByTestId('parcelamento')
    expect(screen.getByRole('link', { name: '+ Novo parcelamento' }).getAttribute('href')).toBe('/lancamentos?novo=cartao')
    expect(screen.getByRole('link', { name: 'Parcelar uma despesa em conta' }).getAttribute('href')).toBe('/lancamentos?novo=despesa')
  })

  it('a grade é responsiva: 1 coluna no celular, 2 no tablet e 3 no computador', async () => {
    mock.listarParcelasAtivas.mockResolvedValue(dados([plano()], [brl(60000)]))
    montar()
    const lista = (await screen.findByTestId('parcelamento')).parentElement as HTMLElement
    expect(lista.className).toContain('grid')
    expect(lista.className).toContain('md:grid-cols-2')
    expect(lista.className).toContain('xl:grid-cols-3')
    expect(lista.className).toMatch(/(^|\s)grid-cols-1(\s|$)/)
    expect(lista.className).not.toMatch(/(^|\s)grid-cols-[2-9]/)
  })

  it('sem parcelamento: estado vazio claro, com o botão de criar', async () => {
    mock.listarParcelasAtivas.mockResolvedValue(dados([]))
    montar()
    expect(await screen.findByText(/Nenhum parcelamento em andamento/)).toBeTruthy()
    expect(screen.queryByTestId('parcelamento')).toBeNull()
    expect(screen.getByRole('link', { name: '+ Novo parcelamento' })).toBeTruthy()
  })

  it('carregando: avisa e não mostra cartão nem vazio', () => {
    mock.listarParcelasAtivas.mockReturnValue(new Promise(() => undefined))
    montar()
    expect(screen.getByRole('status').textContent).toContain('Carregando')
    expect(screen.queryByText(/Nenhum parcelamento/)).toBeNull()
  })

  it('se a leitura falhar, só este bloco avisa (e a falha vai ao Sentry com o nome da consulta)', async () => {
    const falha = { code: '57014' }
    mock.listarParcelasAtivas.mockRejectedValue(falha)
    montar()
    expect(await screen.findByText(/Não foi possível carregar as parcelas ativas/)).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Parcelas ativas' })).toBeTruthy()
    expect(screen.queryByTestId('parcelamento')).toBeNull()
    expect(screen.queryByText(/Nenhum parcelamento/)).toBeNull()
    expect(mock.registrarFalhaConsulta).toHaveBeenCalledWith('active_installment_plans', falha)
  })

  it('selo só na exceção: "Última parcela" e a parcela em atraso; o "paga" fica; o resto sem selo', async () => {
    mock.listarParcelasAtivas.mockResolvedValue(dados([
      plano({ chave: 'a', descricao: 'Quase quitado', parcelaAtual: 10, totalParcelas: 10 }),
      plano({ chave: 'b', descricao: 'Atrasado', emAtraso: 2 }),
      plano({ chave: 'c', descricao: 'Normal' }),
    ], [brl(1000)]))
    montar()
    const cartoes = await screen.findAllByTestId('parcelamento')
    expect(within(cartoes[0]).getByText('Última parcela')).toBeTruthy()
    expect(within(cartoes[1]).getByText('2 parcelas em atraso')).toBeTruthy()
    expect(within(cartoes[1]).queryByText('Última parcela')).toBeNull()
    expect(within(cartoes[2]).queryByText('Última parcela')).toBeNull()
    expect(within(cartoes[2]).queryByText(/atraso/)).toBeNull()
  })

  describe('ordenação', () => {
    const lista = [
      plano({ chave: 'a', descricao: 'Ana', parcelaAtual: 2, totalParcelas: 12, valorParcela: c(20000), saldoRestante: c(200000) }), // 10 a quitar
      plano({ chave: 'b', descricao: 'Beto', parcelaAtual: 9, totalParcelas: 10, valorParcela: c(50000), saldoRestante: c(50000) }), // 1 a quitar
      plano({ chave: 'c', descricao: 'Caio', parcelaAtual: 4, totalParcelas: 6, valorParcela: c(10000), saldoRestante: c(900000) }), // 2 a quitar
    ]
    const nomes = () => screen.getAllByTestId('parcelamento').map((li) => within(li).getByRole('heading', { level: 3 }).textContent)

    it('começa na ordem do banco (próximo vencimento) e reordena por quitação, parcela e saldo, sem consultar o banco de novo', async () => {
      const u = (await import('@testing-library/user-event')).default.setup()
      mock.listarParcelasAtivas.mockResolvedValue(dados(lista, [brl(1000)]))
      montar()
      await screen.findAllByTestId('parcelamento')
      expect(nomes()).toEqual(['Ana', 'Beto', 'Caio'])
      await u.selectOptions(screen.getByLabelText('Ordenar por'), 'quitar')
      expect(nomes()).toEqual(['Beto', 'Caio', 'Ana'])
      await u.selectOptions(screen.getByLabelText('Ordenar por'), 'parcela')
      expect(nomes()).toEqual(['Beto', 'Ana', 'Caio'])
      await u.selectOptions(screen.getByLabelText('Ordenar por'), 'saldo')
      expect(nomes()).toEqual(['Caio', 'Ana', 'Beto'])
      await u.selectOptions(screen.getByLabelText('Ordenar por'), 'vencimento')
      expect(nomes()).toEqual(['Ana', 'Beto', 'Caio'])
      expect(mock.listarParcelasAtivas).toHaveBeenCalledTimes(1)
    })

    it('moedas diferentes não se misturam ao ordenar por valor (cada moeda num bloco)', async () => {
      const u = (await import('@testing-library/user-event')).default.setup()
      mock.listarParcelasAtivas.mockResolvedValue(dados([
        plano({ chave: 'u1', descricao: 'Em dólar pequeno', moeda: 'USD', valorParcela: c(100) }),
        plano({ chave: 'r1', descricao: 'Em reais grande', moeda: 'BRL', valorParcela: c(900000) }),
        plano({ chave: 'r2', descricao: 'Em reais pequeno', moeda: 'BRL', valorParcela: c(1000) }),
      ], [brl(1000)]))
      montar()
      await screen.findAllByTestId('parcelamento')
      await u.selectOptions(screen.getByLabelText('Ordenar por'), 'parcela')
      expect(nomes()).toEqual(['Em reais grande', 'Em reais pequeno', 'Em dólar pequeno'])
    })
  })

  describe('aviso "terminam nos próximos 60 dias" (migration 118)', () => {
    const acaba = (descricao: string, valor: number, moeda = 'BRL') => ({ chave: descricao, moeda, descricao, origemNome: 'Nubank', ultimoVencimento: '2027-01-10', valor: c(valor) })
    const comPlanos = () => mock.listarParcelasAtivas.mockResolvedValue(dados([plano()], [brl(1000)]))

    it('mostra quantos terminam, os nomes e quanto liberam por mês: a soma vem do banco', async () => {
      comPlanos()
      mock.listarParcelasQueAcabam.mockResolvedValue({
        planos: [acaba('Bagaggio', 25000), acaba('Pacco', 21154), acaba('Airbnb', 20000)],
        totais: [{ moeda: 'BRL', qtde: 3, liberado: c(66154) }],
      })
      montar()
      const aviso = await screen.findByTestId('acabam-BRL')
      expect(aviso.textContent).toContain('3 parcelamentos terminam nos próximos 60 dias')
      expect(aviso.textContent).toContain('Bagaggio, Pacco e Airbnb')
      expect(aviso.textContent).toContain('R$ 661,54')
      expect(aviso.textContent).toContain('por mês')
      expect(mock.listarParcelasQueAcabam).toHaveBeenCalledWith('h1', 60)
    })

    it('um só: singular; mais de três: "e mais N"', async () => {
      comPlanos()
      mock.listarParcelasQueAcabam.mockResolvedValue({ planos: [acaba('Curso', 10000)], totais: [{ moeda: 'BRL', qtde: 1, liberado: c(10000) }] })
      montar()
      expect((await screen.findByTestId('acabam-BRL')).textContent).toMatch(/^1 parcelamento termina nos próximos 60 dias: Curso\. Libera R\$\s*100,00 por mês/)
      cleanup()
      mock.listarParcelasQueAcabam.mockResolvedValue({
        planos: ['A', 'B', 'C', 'D', 'E'].map((n) => acaba(n, 1000)), totais: [{ moeda: 'BRL', qtde: 5, liberado: c(5000) }],
      })
      montar()
      expect((await screen.findByTestId('acabam-BRL')).textContent).toContain('A, B, C e mais 2')
    })

    it('moedas diferentes ficam em avisos separados, cada um na sua moeda', async () => {
      comPlanos()
      mock.listarParcelasQueAcabam.mockResolvedValue({
        planos: [acaba('Reais', 10000), acaba('Dólar', 5000, 'USD')],
        totais: [{ moeda: 'BRL', qtde: 1, liberado: c(10000) }, { moeda: 'USD', qtde: 1, liberado: c(5000) }],
      })
      montar()
      expect((await screen.findByTestId('acabam-BRL')).textContent).toContain('(BRL)')
      expect(screen.getByTestId('acabam-USD').textContent).toContain('Dólar')
      expect(screen.getByTestId('acabam-USD').textContent).not.toContain('Reais')
    })

    it('nenhum terminando: nenhum aviso; se a consulta falhar (banco sem a 118), a lista segue normal e sem erro', async () => {
      comPlanos()
      montar()
      await screen.findAllByTestId('parcelamento')
      expect(screen.queryByTestId('acabam-BRL')).toBeNull()
      cleanup()
      mock.listarParcelasQueAcabam.mockRejectedValue({ code: 'PGRST202' })
      montar()
      expect(await screen.findAllByTestId('parcelamento')).toHaveLength(1)
      expect(screen.queryByRole('alert')).toBeNull()
      expect(screen.queryByText(/terminam? nos próximos/)).toBeNull()
    })

    it('valores ocultos mascaram o valor liberado', async () => {
      comPlanos()
      mock.listarParcelasQueAcabam.mockResolvedValue({ planos: [acaba('Curso', 10000)], totais: [{ moeda: 'BRL', qtde: 1, liberado: c(10000) }] })
      definirValoresOcultos(true)
      montar()
      const aviso = await screen.findByTestId('acabam-BRL')
      expect(aviso.textContent).toContain(MASCARA)
      expect(aviso.textContent).not.toContain('100,00')
    })
  })

  describe('linha do tempo (parcela a parcela)', () => {
    const parc = (p: Partial<ParcelaDoCronograma>): ParcelaDoCronograma => ({
      numero: 1, vencimento: '2026-10-15', valor: c(10000), faturaRotulo: '2026-10', estado: 'paid', noMes: false, ...p,
    })

    it('cartão: uma linha por parcela com mês, valor e situação; cada uma leva à fatura dela (o rótulo vem do banco)', async () => {
      mock.listarParcelasAtivas.mockResolvedValue(dados([plano({ totalParcelas: 3 })], [brl(20000)]))
      mock.listarCronogramaParcelas.mockResolvedValue(new Map([['card:k1:p1', [
        parc({ numero: 1 }),
        parc({ numero: 2, vencimento: '2026-11-15', faturaRotulo: '2026-11', estado: 'open', noMes: true }),
        parc({ numero: 3, vencimento: '2026-12-15', faturaRotulo: '2026-12', estado: 'overdue' }),
      ]]]))
      montar()
      const linha = await screen.findByTestId('linha-do-tempo')
      const itens = within(linha).getAllByRole('listitem')
      expect(itens).toHaveLength(3)
      expect(within(itens[0]).getByText('1/3')).toBeTruthy()
      expect(within(itens[0]).getByText('out/2026')).toBeTruthy()
      expect(within(itens[0]).getByText('Paga')).toBeTruthy()
      expect(within(itens[1]).getByText('A vencer')).toBeTruthy()
      expect(within(itens[1]).getByText('neste mês')).toBeTruthy()
      expect(within(itens[2]).getByText('Em atraso')).toBeTruthy()
      expect(within(itens[0]).getByText('−R$ 100,00')).toBeTruthy()
      const links = within(linha).getAllByRole('link')
      expect(links.map((l) => l.getAttribute('href'))).toEqual(['/cartoes/k1/fatura/2026-10', '/cartoes/k1/fatura/2026-11', '/cartoes/k1/fatura/2026-12'])
    })

    it('carnê (conta): cada parcela leva a Lançamentos no mês da data', async () => {
      mock.listarParcelasAtivas.mockResolvedValue(dados([plano({ chave: 'account:g1', origem: 'account', origemId: 'a1', totalParcelas: 2 })], [brl(10000)]))
      mock.listarCronogramaParcelas.mockResolvedValue(new Map([['account:g1', [
        parc({ numero: 1, vencimento: '2026-11-12', faturaRotulo: null, estado: 'open', noMes: true }),
        parc({ numero: 2, vencimento: '2026-12-12', faturaRotulo: null, estado: 'open' }),
      ]]]))
      montar()
      const linha = await screen.findByTestId('linha-do-tempo')
      expect(within(linha).getAllByRole('link').map((l) => l.getAttribute('href'))).toEqual(['/lancamentos?mes=2026-11', '/lancamentos?mes=2026-12'])
    })

    it('cartão sem rótulo de fatura cai na tela do cartão; sem a linha do tempo (função ausente) o card continua igual', async () => {
      mock.listarParcelasAtivas.mockResolvedValue(dados([plano({ totalParcelas: 2 })], [brl(10000)]))
      mock.listarCronogramaParcelas.mockResolvedValue(new Map([['card:k1:p1', [parc({ numero: 1, faturaRotulo: null, estado: 'open' })]]]))
      montar()
      const linha = await screen.findByTestId('linha-do-tempo')
      expect(within(linha).getByRole('link').getAttribute('href')).toBe('/cartoes/k1')
      cleanup()
      mock.listarCronogramaParcelas.mockRejectedValue(new Error('sem a função'))
      montar()
      expect(await screen.findByTestId('parcelamento')).toBeTruthy()
      expect(screen.queryByTestId('linha-do-tempo')).toBeNull()
    })
  })
})
