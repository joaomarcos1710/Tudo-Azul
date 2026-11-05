// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mock = vi.hoisted(() => ({
  baixarArquivo: vi.fn(),
  exportacaoCompleta: vi.fn(),
  lancamentosParaExportar: vi.fn(),
  primeiraDataDeLancamento: vi.fn(),
}))
vi.mock('../lib/FamiliaContext', () => ({
  useFamilia: () => ({ familia: { id: 'h1', nome: 'Casa', papel: 'owner' }, carregando: false, erro: false, recarregar: vi.fn() }),
}))
vi.mock('../lib/csv', async (o) => ({
  ...(await o<typeof import('../lib/csv')>()),
  baixarArquivo: mock.baixarArquivo, exportacaoCompleta: mock.exportacaoCompleta, lancamentosParaExportar: mock.lancamentosParaExportar, primeiraDataDeLancamento: mock.primeiraDataDeLancamento,
}))

import Exportar from './Exportar'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Exportar dados (Conta)', () => {
  it('exportação completa: prepara, e cada arquivo é baixado por um clique; avisa que não é restaurável', async () => {
    const u = userEvent.setup()
    mock.exportacaoCompleta.mockResolvedValue(
      [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ nome: `arq-${n}.csv`, conteudo: 'x', linhas: n })),
    )
    render(<Exportar />)
    expect(screen.getByText(/não é restaurável automaticamente/)).toBeTruthy()
    // o título diz o número real de arquivos e a lista descreve investimentos e bens (arquivos 7 e 8)
    expect(screen.getByText('Exportação completa (8 arquivos CSV)')).toBeTruthy()
    expect(screen.getByText('Investimentos:')).toBeTruthy()
    expect(screen.getByText('Bens:')).toBeTruthy()
    await u.click(screen.getByRole('button', { name: 'Preparar exportação completa' }))
    expect(mock.exportacaoCompleta).toHaveBeenCalledWith('h1', expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/))
    expect(await screen.findByText(/0 de 8 baixados/)).toBeTruthy()
    expect(mock.baixarArquivo).not.toHaveBeenCalled()
    await u.click(screen.getByRole('button', { name: 'Baixar arq-1.csv' }))
    await u.click(screen.getByRole('button', { name: 'Baixar arq-4.csv' }))
    expect(mock.baixarArquivo.mock.calls.map((c) => c[0])).toEqual(['arq-1.csv', 'arq-4.csv'])
    expect(screen.getByText(/2 de 8 baixados/)).toBeTruthy()
    expect(screen.getByText('· 1 linha')).toBeTruthy()
  })

  it('erro na exportação completa não baixa nada e mostra a mensagem', async () => {
    const u = userEvent.setup()
    mock.exportacaoCompleta.mockRejectedValue(new Error('falhou'))
    render(<Exportar />)
    await u.click(screen.getByRole('button', { name: 'Preparar exportação completa' }))
    expect(mock.baixarArquivo).not.toHaveBeenCalled()
    expect(await screen.findByRole('alert')).toBeTruthy()
  })

  it('CSV de um período: "Desde o primeiro lançamento" vai até o primeiro dia de uso e exporta de lá até a data final', async () => {
    mock.primeiraDataDeLancamento.mockResolvedValue('2025-03-14')
    mock.lancamentosParaExportar.mockResolvedValue([])
    const u = (await import('@testing-library/user-event')).default.setup()
    render(<Exportar />)
    await u.click(screen.getByRole('button', { name: 'Desde o primeiro lançamento' }))
    expect(await screen.findByDisplayValue('2025-03-14')).toBeTruthy()
    const exportar = screen.getByRole('button', { name: /Exportar de 14\/03\/2025 a/ })
    await u.click(exportar)
    expect(mock.lancamentosParaExportar).toHaveBeenCalledWith('h1', expect.objectContaining({ de: '2025-03-14' }))
  })

  it('o CSV começa no mês de hoje e pode ser mudado à mão', async () => {
    const { hojeSP } = await import('../lib/contas')
    const { periodoDoMes } = await import('../lib/periodoRelatorio')
    const p = periodoDoMes(hojeSP().slice(0, 7))
    render(<Exportar />)
    expect((screen.getByLabelText('De') as HTMLInputElement).value).toBe(p.de)
    expect((screen.getByLabelText('Até') as HTMLInputElement).value).toBe(p.ate)
  })

  it('período invertido não exporta', async () => {
    const { fireEvent } = await import('@testing-library/react')
    render(<Exportar />)
    fireEvent.change(screen.getByLabelText('De'), { target: { value: '2099-01-01' } })
    const botao = screen.getByRole('button', { name: 'Escolha o período' }) as HTMLButtonElement
    expect(botao.disabled).toBe(true)
  })

  it('exportação de lançamentos: card compacto de uma linha, e a frase do cartão leva à exportação completa', async () => {
    render(<Exportar />)
    expect(screen.getByText('Exportar lançamentos (CSV)')).toBeTruthy()
    expect(screen.queryByText(/Compras no cartão não estão aqui/)).toBeNull()
    const link = screen.getByRole('link', { name: 'exportação completa' })
    expect(link.closest('p')!.textContent).toMatch(/Compras no cartão: veja a exportação completa\./)
    expect(link.getAttribute('href')).toBe('#exportacao-completa')
    expect(document.getElementById('exportacao-completa')!.textContent).toMatch(/Exportação completa \(8 arquivos CSV\)/)
    expect(screen.getByRole('button', { name: 'Preparar exportação completa' })).toBeTruthy()
  })
})
