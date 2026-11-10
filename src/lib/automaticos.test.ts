import { beforeEach, describe, expect, it, vi } from 'vitest'

const mock = vi.hoisted(() => ({ gerarOcorrencias: vi.fn(), cobrarFaturasFechadas: vi.fn(), sincronizarAgendados: vi.fn() }))
vi.mock('./recorrencias', () => ({ gerarOcorrencias: mock.gerarOcorrencias }))
vi.mock('./cartoes', () => ({ cobrarFaturasFechadas: mock.cobrarFaturasFechadas, sincronizarAgendados: mock.sincronizarAgendados }))

import { atualizarAutomaticos } from './automaticos'

beforeEach(() => {
  mock.gerarOcorrencias.mockReset().mockResolvedValue(0)
  mock.cobrarFaturasFechadas.mockReset().mockResolvedValue(0)
  mock.sincronizarAgendados.mockReset().mockResolvedValue(0)
})

describe('atualizarAutomaticos', () => {
  it('gera os recorrentes, cobra as faturas e só depois atualiza as assinaturas agendadas', async () => {
    expect(await atualizarAutomaticos()).toEqual({ recorrentesOk: true, faturasOk: true })
    const ordem = [mock.gerarOcorrencias, mock.cobrarFaturasFechadas, mock.sincronizarAgendados].map((f) => f.mock.invocationCallOrder[0])
    expect(ordem[0]).toBeLessThan(ordem[1])
    expect(ordem[1]).toBeLessThan(ordem[2])
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
