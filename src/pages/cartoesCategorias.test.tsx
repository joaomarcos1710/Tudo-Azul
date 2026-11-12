// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { Cents } from '../lib/format'

/**
 * Botão "Categorias" da página da fatura (pedido do dono, 12/11/2026): abre uma folha com as despesas da fatura por
 * categoria, vindas prontas do banco (card_invoice_categories). Arquivo separado do cartoes.test.tsx de propósito
 * (menos conflito com outras mudanças da mesma tela).
 */
const mock = vi.hoisted(() => ({
  cobrarFaturasFechadas: vi.fn(), listarCartoes: vi.fn(), listarMovimentosDoCartao: vi.fn(), listarFaturas: vi.fn(),
  listarItens: vi.fn(), listarOcorrenciasPrevistas: vi.fn(), listarFaturasAgendadas: vi.fn(), sincronizarAgendados: vi.fn(),
  converterAgendados: vi.fn(), listarCreditosDaFatura: vi.fn(), totalFaturasDoMes: vi.fn(), listarPagamentosDaFatura: vi.fn(),
  visaoDosCartoes: vi.fn(), listarContas: vi.fn(), listarCategorias: vi.fn(), listarPessoasFamilia: vi.fn(),
  listarCategoriasDaFatura: vi.fn(),
}))
vi.mock('../lib/FamiliaContext', () => ({
  useFamilia: () => ({ familia: { id: 'h1', nome: 'Casa', papel: 'owner' }, carregando: false, erro: false, recarregar: vi.fn() }),
}))
vi.mock('../lib/cartoes', async (o) => ({
  ...(await o<typeof import('../lib/cartoes')>()),
  cobrarFaturasFechadas: mock.cobrarFaturasFechadas, listarCartoes: mock.listarCartoes, listarMovimentosDoCartao: mock.listarMovimentosDoCartao,
  listarFaturas: mock.listarFaturas, listarItens: mock.listarItens, listarOcorrenciasPrevistas: mock.listarOcorrenciasPrevistas,
  listarFaturasAgendadas: mock.listarFaturasAgendadas, sincronizarAgendados: mock.sincronizarAgendados, converterAgendados: mock.converterAgendados,
  listarCreditosDaFatura: mock.listarCreditosDaFatura, totalFaturasDoMes: mock.totalFaturasDoMes, listarPagamentosDaFatura: mock.listarPagamentosDaFatura,
  visaoDosCartoes: mock.visaoDosCartoes, listarCategoriasDaFatura: mock.listarCategoriasDaFatura,
}))
vi.mock('../lib/pessoasFamilia', async (o) => ({ ...(await o<typeof import('../lib/pessoasFamilia')>()), listarPessoasFamilia: mock.listarPessoasFamilia }))
vi.mock('../lib/recorrencias', () => ({ gerarOcorrencias: () => Promise.resolve(0), excluirRecorrencia: vi.fn() }))
vi.mock('../lib/contas', async (o) => ({ ...(await o<typeof import('../lib/contas')>()), listarContas: mock.listarContas }))
vi.mock('../lib/categorias', async (o) => ({ ...(await o<typeof import('../lib/categorias')>()), listarCategorias: mock.listarCategorias }))

import Cartoes from './Cartoes'
import { definirValoresOcultos } from '../lib/privacidade'
import type { Fatura } from '../lib/cartoes'

const c = (n: number) => n as Cents
function montar(rota = '/cartoes/k1/fatura/2026-03') {
  return render(
    <MemoryRouter initialEntries={[rota]}>
      <Routes>
        <Route path="/cartoes" element={<Cartoes />} />
        <Route path="/cartoes/:id" element={<Cartoes />} />
        <Route path="/cartoes/:id/fatura/:mes" element={<Cartoes />} />
      </Routes>
    </MemoryRouter>,
  )
}
const nubank = { id: 'k1', nome: 'Nubank', emissor: null, bandeira: null, fechamento: 17, vencimento: 25, ativo: true, divida: c(0), credito: c(0), compromissos: c(0), limite: null, limiteComprometido: null, limiteDisponivel: null }
const fatura = (f: Partial<Fatura>): Fatura => ({
  mes: '2026-03', fechamento: '2026-03-17', vencimento: '2026-03-25', cobrado: c(26050), aCobrar: c(0), total: c(26050), pago: c(0), itens: 3, faturaId: 'f3',
  saldoAnterior: c(0), adiantamentoEntrada: c(0), adiantamentoSaida: c(0), creditos: c(0), ...f,
})
// o que o banco devolve: valores e percentuais prontos (o front não soma nada)
const LINHAS = [
  { categoriaId: 'g1', nome: 'Mercado', valor: c(20050), percentual: 77, total: c(26050) },
  { categoriaId: 'g2', nome: 'Compras pessoais', valor: c(3000), percentual: 11.5, total: c(26050) },
  { categoriaId: 'g3', nome: 'Lazer', valor: c(3000), percentual: 11.5, total: c(26050) },
]
const botao = () => screen.findByRole('button', { name: 'Categorias' })

beforeEach(() => {
  mock.listarMovimentosDoCartao.mockResolvedValue([])
  mock.cobrarFaturasFechadas.mockResolvedValue(0)
  mock.listarCartoes.mockResolvedValue([nubank])
  mock.listarContas.mockResolvedValue({ contas: [], total: c(0) })
  mock.listarCategorias.mockResolvedValue([
    { id: 'g1', nome: 'Mercado', tipo: 'expense', paiId: null, sistema: false, ativa: true, eventual: false },
    { id: 'g2', nome: 'Compras pessoais', tipo: 'expense', paiId: null, sistema: false, ativa: true, eventual: false },
    { id: 'g3', nome: 'Lazer', tipo: 'expense', paiId: null, sistema: false, ativa: true, eventual: false },
  ])
  mock.listarFaturas.mockResolvedValue([fatura({})])
  mock.listarItens.mockResolvedValue([])
  mock.listarPessoasFamilia.mockResolvedValue([])
  mock.listarOcorrenciasPrevistas.mockResolvedValue([])
  mock.listarFaturasAgendadas.mockResolvedValue([])
  mock.sincronizarAgendados.mockResolvedValue(0)
  mock.converterAgendados.mockResolvedValue(0)
  mock.listarCreditosDaFatura.mockResolvedValue([])
  mock.totalFaturasDoMes.mockResolvedValue(null)
  mock.listarPagamentosDaFatura.mockResolvedValue([])
  mock.visaoDosCartoes.mockResolvedValue(null)
  mock.listarCategoriasDaFatura.mockResolvedValue(LINHAS)
})
afterEach(() => {
  definirValoresOcultos(false)
  cleanup()
  vi.clearAllMocks()
})

describe('Categorias da fatura (botão e folha)', () => {
  it('o botão fica no resumo da fatura e abre a folha com nome, valor e percentual de cada categoria, do banco', async () => {
    const u = userEvent.setup()
    montar()
    const gatilho = await botao()
    expect(mock.listarCategoriasDaFatura).not.toHaveBeenCalled() // só lê quando a folha abre
    await u.click(gatilho)
    const folha = await screen.findByRole('dialog', { name: 'Categorias da fatura' })
    expect(mock.listarCategoriasDaFatura).toHaveBeenCalledWith('k1', '2026-03')
    const legenda = await within(folha).findByRole('list', { name: /Legenda: Despesas por categoria na fatura de março de 2026/ })
    const itens = within(legenda).getAllByRole('listitem')
    expect(itens).toHaveLength(3)
    expect(itens[0].textContent).toContain('Mercado')
    expect(itens[0].textContent).toContain('200,50')
    expect(itens[0].textContent).toContain('77%')
    expect(itens[1].textContent).toContain('11,5%')
    // ícone da categoria (decorativo) e nenhuma linha vira link para Lançamentos (fatura não tem essa lista)
    expect(itens[0].querySelector('[data-icone]')).not.toBeNull()
    expect(within(folha).queryAllByRole('link')).toHaveLength(0)
    // o total mostrado é o que o banco mandou; há alternativa em texto (tabela) e o gráfico tem rótulo
    expect(within(folha).getByTestId('total-categorias-fatura').textContent).toContain('260,50')
    expect(within(folha).getByRole('img', { name: /Mercado 77%/ })).toBeTruthy()
    expect(within(folha).getByRole('table', { name: /fatura de março de 2026/ })).toBeTruthy()
  })

  it('Esc, × e clique fora fecham e o foco volta ao botão', async () => {
    const u = userEvent.setup()
    montar()
    const gatilho = await botao()
    await u.click(gatilho)
    await screen.findByRole('dialog', { name: 'Categorias da fatura' })
    await u.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(gatilho)
    await u.click(gatilho)
    await u.click(await screen.findByRole('button', { name: 'Fechar' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(gatilho)
    await u.click(gatilho)
    const dialogo = await screen.findByRole('dialog', { name: 'Categorias da fatura' })
    await u.click(dialogo.parentElement!) // o fundo escuro
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('fatura sem compras: estado vazio claro', async () => {
    const u = userEvent.setup()
    mock.listarCategoriasDaFatura.mockResolvedValue([])
    montar()
    await u.click(await botao())
    expect(await screen.findByText(/não tem compras com categoria/)).toBeTruthy()
    expect(screen.queryByTestId('total-categorias-fatura')).toBeNull()
  })

  it('se a leitura falhar, só a folha avisa: a fatura continua inteira', async () => {
    const u = userEvent.setup()
    mock.listarCategoriasDaFatura.mockRejectedValue(new Error('falha de rede'))
    montar()
    await u.click(await botao())
    const folha = await screen.findByRole('dialog', { name: 'Categorias da fatura' })
    expect(await within(folha).findByText(/Não foi possível carregar as categorias desta fatura/)).toBeTruthy()
    expect(within(folha).getByText(/A fatura continua correta/)).toBeTruthy()
    await u.keyboard('{Escape}')
    expect(screen.getByRole('heading', { name: /Nubank · Março de 2026/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Categorias' })).toBeTruthy()
  })

  it('"ocultar valores" mascara o dinheiro da folha (lista, total e tabela)', async () => {
    const u = userEvent.setup()
    definirValoresOcultos(true)
    montar()
    await u.click(await botao())
    const folha = await screen.findByRole('dialog', { name: 'Categorias da fatura' })
    await within(folha).findByTestId('total-categorias-fatura')
    expect(folha.textContent).not.toContain('200,50')
    expect(folha.textContent).not.toContain('260,50')
    expect(within(folha).getByTestId('total-categorias-fatura').textContent).toContain('••••')
  })

  it('na fatura paga e travada o botão continua (é só leitura)', async () => {
    const u = userEvent.setup()
    mock.listarFaturas.mockResolvedValue([fatura({ pago: c(26050) })])
    mock.listarPagamentosDaFatura.mockResolvedValue([{ id: 'pg1', data: '2026-03-24', valor: c(26050) }])
    montar()
    expect(await screen.findByTestId('fatura-travada')).toBeTruthy()
    await u.click(await botao())
    expect(await screen.findByRole('dialog', { name: 'Categorias da fatura' })).toBeTruthy()
    await waitFor(() => expect(mock.listarCategoriasDaFatura).toHaveBeenCalledTimes(1))
  })
})
