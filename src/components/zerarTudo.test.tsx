// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

const mock = vi.hoisted(() => ({
  previaZerar: vi.fn(),
  zerarTudo: vi.fn(),
  exportacaoCompleta: vi.fn(),
  baixarArquivo: vi.fn(),
}))
vi.mock('../lib/FamiliaContext', () => ({
  useFamilia: () => ({ familia: { id: 'h1', nome: 'Casa', papel: 'owner' }, carregando: false, erro: false, recarregar: vi.fn() }),
}))
vi.mock('../lib/zerar', async (o) => ({ ...(await o<typeof import('../lib/zerar')>()), previaZerar: mock.previaZerar, zerarTudo: mock.zerarTudo }))
vi.mock('../lib/csv', async (o) => ({
  ...(await o<typeof import('../lib/csv')>()), exportacaoCompleta: mock.exportacaoCompleta, baixarArquivo: mock.baixarArquivo,
}))

import { ZerarTudo } from './ZerarTudo'

const previa = {
  lancamentos: 12, contas: 2, cartoesEDividas: 1, parcelas: 3, eventos: 4, recorrencias: 1, conciliacoes: 0, orcamentos: 0,
  agendaContrato: 6, ativosInvestimento: 2, operacoesInvestimento: 5, avaliacoesInvestimento: 1, proventos: 3, bens: 1, avaliacoesBens: 2,
}
const nada = Object.fromEntries(Object.keys(previa).map((k) => [k, 0]))
const montar = () => render(<MemoryRouter><ZerarTudo /></MemoryRouter>)
const arquivos = [1, 2].map((n) => ({ nome: `arq-${n}.csv`, conteudo: 'x', linhas: n }))

beforeEach(() => {
  mock.previaZerar.mockResolvedValue(previa)
  mock.zerarTudo.mockResolvedValue(previa)
  mock.exportacaoCompleta.mockResolvedValue(arquivos)
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Zerar tudo', () => {
  it('mostra o que será apagado, o que fica e avisa que não tem volta', async () => {
    montar()
    expect(await screen.findByText(/12 lançamentos/)).toBeTruthy()
    expect(screen.getByText(/2 contas/)).toBeTruthy()
    expect(screen.getByText(/1 cartão ou dívida/)).toBeTruthy()
    expect(screen.getByText(/3 parcelas/)).toBeTruthy()
    expect(screen.getByText(/6 parcelas da agenda de contratos/)).toBeTruthy()
    expect(screen.getByText(/2 investimentos, com 5 operações, 1 avaliação e 3 proventos/)).toBeTruthy()
    expect(screen.getByText(/1 bem da família, com 2 avaliações/)).toBeTruthy()
    expect(screen.getByText(/a família, os membros, as categorias e as etiquetas de conta/)).toBeTruthy()
    expect(screen.getByText(/Não tem volta/)).toBeTruthy()
    // conferência com o extrato saiu do app: sem registro antigo, nem é citada
    expect(screen.queryByText(/confer[eê]ncia|concilia/i)).toBeNull()
  })

  it('conferência antiga que sobrou no banco aparece na contagem do que será apagado', async () => {
    mock.previaZerar.mockResolvedValue({ ...previa, conciliacoes: 2 })
    montar()
    expect(await screen.findByText(/1 recorrência, 2 conferências antigas e 0 orçamentos/)).toBeTruthy()
  })

  it('só libera a frase depois de baixar TODOS os arquivos, e só zera com "zerar tudo"', async () => {
    const u = userEvent.setup()
    montar()
    await screen.findByText(/12 lançamentos/)
    const campo = screen.getByLabelText(/Para confirmar, escreva/) as HTMLInputElement
    const botao = screen.getByRole('button', { name: 'Zerar tudo' }) as HTMLButtonElement
    expect(campo.disabled).toBe(true)
    expect(botao.disabled).toBe(true)

    await u.click(screen.getByRole('button', { name: 'Preparar exportação completa' }))
    await u.click(await screen.findByRole('button', { name: 'Baixar arq-1.csv' }))
    expect(campo.disabled).toBe(true) // falta um arquivo
    await u.click(screen.getByRole('button', { name: 'Baixar arq-2.csv' }))
    expect(campo.disabled).toBe(false)

    await u.type(campo, 'zerar')
    expect(botao.disabled).toBe(true) // frase incompleta
    await u.type(campo, ' tudo')
    expect(botao.disabled).toBe(false)
    await u.click(botao)
    expect(mock.zerarTudo).toHaveBeenCalledWith('h1', 'zerar tudo')
    expect(await screen.findByText(/Pronto, tudo foi zerado/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Contas' }).getAttribute('href')).toBe('/contas')
  })

  it('preparar uma nova exportação invalida a anterior: a frase volta a ficar bloqueada', async () => {
    const u = userEvent.setup()
    montar()
    await screen.findByText(/12 lançamentos/)
    await u.click(screen.getByRole('button', { name: 'Preparar exportação completa' }))
    await u.click(await screen.findByRole('button', { name: 'Baixar arq-1.csv' }))
    await u.click(screen.getByRole('button', { name: 'Baixar arq-2.csv' }))
    expect((screen.getByLabelText(/Para confirmar, escreva/) as HTMLInputElement).disabled).toBe(false)
    await u.click(screen.getByRole('button', { name: 'Preparar exportação completa' }))
    await screen.findByRole('button', { name: 'Baixar arq-1.csv' })
    expect((screen.getByLabelText(/Para confirmar, escreva/) as HTMLInputElement).disabled).toBe(true)
  })

  it('avisa o que a exportação NÃO inclui, para ninguém achar que tem backup de tudo', async () => {
    montar()
    expect(await screen.findByText(/A exportação não inclui/)).toBeTruthy()
    expect(screen.getByText(/não lance nada entre baixar e zerar/)).toBeTruthy()
  })

  it('o banco recusou (ex.: não é o dono): mostra o erro e não finge que zerou', async () => {
    const u = userEvent.setup()
    mock.zerarTudo.mockRejectedValue(Object.assign(new Error('somente o dono da família pode zerar tudo'), { code: '42501' }))
    montar()
    await screen.findByText(/12 lançamentos/)
    await u.click(screen.getByRole('button', { name: 'Preparar exportação completa' }))
    await u.click(await screen.findByRole('button', { name: 'Baixar arq-1.csv' }))
    await u.click(screen.getByRole('button', { name: 'Baixar arq-2.csv' }))
    await u.type(screen.getByLabelText(/Para confirmar, escreva/), 'ZERAR TUDO')
    await u.click(screen.getByRole('button', { name: 'Zerar tudo' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.queryByText(/Pronto, tudo foi zerado/)).toBeNull()
  })

  it('só um bem (sem conta nem lançamento) ainda é algo a zerar: oferece o botão', async () => {
    mock.previaZerar.mockResolvedValue({ ...nada, bens: 1, avaliacoesBens: 1 })
    montar()
    expect(await screen.findByText(/1 bem da família, com 1 avaliação/)).toBeTruthy()
    expect(screen.queryByText(/Não há nada para zerar/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Zerar tudo' })).toBeTruthy()
  })

  it('sem nada para zerar, não oferece o botão', async () => {
    mock.previaZerar.mockResolvedValue(nada)
    montar()
    expect(await screen.findByText(/Não há nada para zerar/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Zerar tudo' })).toBeNull()
  })
})
