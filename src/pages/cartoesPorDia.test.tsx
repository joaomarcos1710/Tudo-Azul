// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { Cents } from '../lib/format'

/**
 * Botão "Por dia" da página da fatura (pedido do dono, 17/11/2026): abre uma folha com o ritmo (gasto até hoje, média por
 * dia, projeção do fechamento, fatura anterior no mesmo ponto) e as barras do gasto de cada dia, tudo pronto do banco
 * (card_invoice_pace e card_invoice_daily, migration 137). Arquivo separado, como o das Categorias.
 */
const mock = vi.hoisted(() => ({
  cobrarFaturasFechadas: vi.fn(), listarCartoes: vi.fn(), listarMovimentosDoCartao: vi.fn(), listarFaturas: vi.fn(),
  listarItens: vi.fn(), listarOcorrenciasPrevistas: vi.fn(), listarFaturasAgendadas: vi.fn(), sincronizarAgendados: vi.fn(),
  converterAgendados: vi.fn(), listarCreditosDaFatura: vi.fn(), totalFaturasDoMes: vi.fn(), listarPagamentosDaFatura: vi.fn(),
  visaoDosCartoes: vi.fn(), listarContas: vi.fn(), listarCategorias: vi.fn(), listarPessoasFamilia: vi.fn(),
  listarCategoriasDaFatura: vi.fn(), gastoPorDiaDaFatura: vi.fn(), ritmoDaFatura: vi.fn(),
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
  gastoPorDiaDaFatura: mock.gastoPorDiaDaFatura, ritmoDaFatura: mock.ritmoDaFatura,
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
const DIAS = [
  { dia: '2026-02-18', valor: c(0), acumulado: c(0), jaVinha: c(3000) },
  { dia: '2026-02-19', valor: c(20000), acumulado: c(20000), jaVinha: c(3000) },
  { dia: '2026-02-20', valor: c(0), acumulado: c(20000), jaVinha: c(3000) },
  { dia: '2026-02-21', valor: c(3000), acumulado: c(23000), jaVinha: c(3000) },
]
const RITMO = {
  inicio: '2026-02-18', fechamento: '2026-03-17', dias: 28, passados: 17, gasto: c(23000), jaVinha: c(3000),
  mediaPorDia: c(1353), projecao: c(40882), faturaAnterior: '2026-02', anteriorNoMesmoPonto: c(13000),
}
const botao = () => screen.findByRole('button', { name: 'Por dia' })

beforeEach(() => {
  mock.listarMovimentosDoCartao.mockResolvedValue([])
  mock.cobrarFaturasFechadas.mockResolvedValue(0)
  mock.listarCartoes.mockResolvedValue([nubank])
  mock.listarContas.mockResolvedValue({ contas: [], total: c(0) })
  mock.listarCategorias.mockResolvedValue([])
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
  mock.listarCategoriasDaFatura.mockResolvedValue([])
  mock.gastoPorDiaDaFatura.mockResolvedValue(DIAS)
  mock.ritmoDaFatura.mockResolvedValue(RITMO)
})
afterEach(() => {
  definirValoresOcultos(false)
  cleanup()
  vi.clearAllMocks()
})

describe('Por dia da fatura (botão e folha)', () => {
  it('o botão fica ao lado de Categorias e só lê o banco quando a folha abre; mostra o ritmo e as barras, do banco', async () => {
    const u = userEvent.setup()
    montar()
    const gatilho = await botao()
    expect(screen.getByRole('button', { name: 'Categorias' }).parentElement).toBe(gatilho.parentElement)
    expect(mock.gastoPorDiaDaFatura).not.toHaveBeenCalled()
    await u.click(gatilho)
    const folha = await screen.findByRole('dialog', { name: 'Gasto por dia' })
    expect(mock.gastoPorDiaDaFatura).toHaveBeenCalledWith('k1', '2026-03')
    expect(mock.ritmoDaFatura).toHaveBeenCalledWith('k1', '2026-03', expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/))
    const dl = await within(folha).findByLabelText('Ritmo da fatura')
    expect(dl.textContent).toContain('Gasto até hoje (17 de 28 dias)')
    expect(dl.textContent).toContain('230,00')
    expect(dl.textContent).toContain('13,53')
    expect(within(folha).getByTestId('projecao-fatura').textContent).toContain('408,82')
    expect(dl.textContent).toContain('no mesmo ponto do ciclo')
    expect(dl.textContent).toContain('130,00')
    expect(dl.textContent).toContain('Já vinha')
    expect(dl.textContent).toContain('30,00')
    // gráfico com nome e a tabela só com os dias que tiveram compra
    expect(within(folha).getByRole('img', { name: /Gasto por dia na fatura de março de 2026\. 2 dia\(s\) com compra/ })).toBeTruthy()
    const linhas = within(folha).getAllByRole('row').slice(1)
    expect(linhas.map((l) => l.textContent)).toEqual(['19/02/2026R$ 200,00', '21/02/2026R$ 30,00'])
  })

  it('ciclo encerrado: sem projeção; e banco sem a migration (lista vazia) avisa sem quebrar a fatura', async () => {
    const u = userEvent.setup()
    mock.ritmoDaFatura.mockResolvedValue({ ...RITMO, passados: 28, projecao: c(26000) })
    montar()
    await u.click(await botao())
    const folha = await screen.findByRole('dialog', { name: 'Gasto por dia' })
    await within(folha).findByLabelText('Ritmo da fatura')
    expect(within(folha).queryByTestId('projecao-fatura')).toBeNull()
    expect(within(folha).getByLabelText('Ritmo da fatura').textContent).toContain('Gasto no ciclo')
    cleanup()
    mock.gastoPorDiaDaFatura.mockResolvedValue([])
    mock.ritmoDaFatura.mockResolvedValue(null)
    montar()
    await u.click(await botao())
    expect(await screen.findByText('Ainda não há gasto por dia para esta fatura.')).toBeTruthy()
  })

  it('erro do banco: só a folha avisa', async () => {
    const u = userEvent.setup()
    mock.gastoPorDiaDaFatura.mockRejectedValue(new Error('falha de rede'))
    montar()
    await u.click(await botao())
    expect(await screen.findByText(/Não foi possível carregar o gasto por dia desta fatura/)).toBeTruthy()
  })
})
