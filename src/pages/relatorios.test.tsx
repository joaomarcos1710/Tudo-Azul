// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mock = vi.hoisted(() => ({
  baixarArquivo: vi.fn(),
  exportacaoCompleta: vi.fn(),
  lancamentosParaExportar: vi.fn(),
}))
vi.mock('../lib/FamiliaContext', () => ({
  useFamilia: () => ({ familia: { id: 'h1', nome: 'Casa', papel: 'owner' }, carregando: false, erro: false, recarregar: vi.fn() }),
}))
vi.mock('../lib/csv', async (o) => ({
  ...(await o<typeof import('../lib/csv')>()),
  baixarArquivo: mock.baixarArquivo, exportacaoCompleta: mock.exportacaoCompleta, lancamentosParaExportar: mock.lancamentosParaExportar,
}))

// o bloco Entradas x Saídas tem teste próprio (components/entradasSaidas.test.tsx); aqui só importa a exportação
vi.mock('../components/EntradasSaidas', () => ({ EntradasSaidas: () => null }))

import Relatorios from './Relatorios'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Relatórios', () => {
  it('exportação completa: prepara, e cada arquivo é baixado por um clique; avisa que não é restaurável', async () => {
    const u = userEvent.setup()
    mock.exportacaoCompleta.mockResolvedValue(
      [1, 2, 3, 4, 5].map((n) => ({ nome: `arq-${n}.csv`, conteudo: 'x', linhas: n })),
    )
    render(<Relatorios />)
    expect(screen.getByText(/não é restaurável automaticamente/)).toBeTruthy()
    await u.click(screen.getByRole('button', { name: 'Preparar exportação completa' }))
    expect(mock.exportacaoCompleta).toHaveBeenCalledWith('h1', expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/))
    expect(await screen.findByText(/0 de 5 baixados/)).toBeTruthy()
    expect(mock.baixarArquivo).not.toHaveBeenCalled()
    await u.click(screen.getByRole('button', { name: 'Baixar arq-1.csv' }))
    await u.click(screen.getByRole('button', { name: 'Baixar arq-4.csv' }))
    expect(mock.baixarArquivo.mock.calls.map((c) => c[0])).toEqual(['arq-1.csv', 'arq-4.csv'])
    expect(screen.getByText(/2 de 5 baixados/)).toBeTruthy()
    expect(screen.getByText('· 1 linha')).toBeTruthy()
  })

  it('erro na exportação completa não baixa nada e mostra a mensagem', async () => {
    const u = userEvent.setup()
    mock.exportacaoCompleta.mockRejectedValue(new Error('falhou'))
    render(<Relatorios />)
    await u.click(screen.getByRole('button', { name: 'Preparar exportação completa' }))
    expect(mock.baixarArquivo).not.toHaveBeenCalled()
    expect(await screen.findByRole('alert')).toBeTruthy()
  })
})
