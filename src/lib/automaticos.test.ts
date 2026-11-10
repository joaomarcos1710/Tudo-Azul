import { beforeEach, describe, expect, it, vi } from 'vitest'

const mock = vi.hoisted(() => ({ gerarOcorrencias: vi.fn(), cobrarFaturasFechadas: vi.fn(), sincronizarAgendados: vi.fn(), converterAgendados: vi.fn() }))
vi.mock('./recorrencias', () => ({ gerarOcorrencias: mock.gerarOcorrencias }))
vi.mock('./cartoes', () => ({ cobrarFaturasFechadas: mock.cobrarFaturasFechadas, sincronizarAgendados: mock.sincronizarAgendados, converterAgendados: mock.converterAgendados }))

import { atualizarAutomaticos } from './automaticos'

beforeEach(() => {
  mock.gerarOcorrencias.mockReset().mockResolvedValue(0)
  mock.cobrarFaturasFechadas.mockReset().mockResolvedValue(0)
  mock.sincronizarAgendados.mockReset().mockResolvedValue(0)
  mock.converterAgendados.mockReset().mockResolvedValue(0)
})

describe('atualizarAutomaticos', () => {
  it('gera os recorrentes, cobra as faturas, atualiza as agendadas e só depois converte as da fatura aberta', async () => {
    expect(await atualizarAutomaticos()).toEqual({ recorrentesOk: true, faturasOk: true })
    const ordem = [mock.gerarOcorrencias, mock.cobrarFaturasFechadas, mock.sincronizarAgendados, mock.converterAgendados]
      .map((f) => f.mock.invocationCallOrder[0])
    expect(ordem[0]).toBeLessThan(ordem[1])
    expect(ordem[1]).toBeLessThan(ordem[2])
    expect(ordem[2]).toBeLessThan(ordem[3])
  })

  it('falha ao converter (banco sem a função) não derruba nem marca falha nas outras tarefas', async () => {
    mock.converterAgendados.mockRejectedValue(new Error('function does not exist'))
    expect(await atualizarAutomaticos()).toEqual({ recorrentesOk: true, faturasOk: true })
  })

  it('falha nas agendadas (banco sem a função) não derruba nem marca falha nas outras duas', async () => {
    mock.sincronizarAgendados.mockRejectedValue(new Error('function does not exist'))
    expect(await atualizarAutomaticos()).toEqual({ recorrentesOk: true, faturasOk: true })
  })

  it('falha nos recorrentes ou nas faturas continua sendo avisada, e as agendadas rodam assim mesmo', async () => {
    mock.gerarOcorrencias.mockRejectedValue(new Error('x'))
    mock.cobrarFaturasFechadas.mockRejectedValue(new Error('y'))
    expect(await atualizarAutomaticos()).toEqual({ recorrentesOk: false, faturasOk: false })
    expect(mock.sincronizarAgendados).toHaveBeenCalled()
  })
})
