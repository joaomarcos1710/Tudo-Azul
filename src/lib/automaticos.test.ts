import { beforeEach, describe, expect, it, vi } from 'vitest'

const mock = vi.hoisted(() => ({ gerarOcorrencias: vi.fn(), cobrarFaturasFechadas: vi.fn(), sincronizarAgendados: vi.fn(), converterAgendados: vi.fn() }))
vi.mock('./recorrencias', () => ({ gerarOcorrencias: mock.gerarOcorrencias }))
vi.mock('./cartoes', () => ({ cobrarFaturasFechadas: mock.cobrarFaturasFechadas, sincronizarAgendados: mock.sincronizarAgendados, converterAgendados: mock.converterAgendados }))

import { atualizarAutomaticos, esquecerAutomaticos } from './automaticos'

beforeEach(() => {
  esquecerAutomaticos()
  mock.gerarOcorrencias.mockReset().mockResolvedValue(0)
  mock.cobrarFaturasFechadas.mockReset().mockResolvedValue(0)
  mock.sincronizarAgendados.mockReset().mockResolvedValue(0)
  mock.converterAgendados.mockReset().mockResolvedValue(0)
})

describe('atualizarAutomaticos', () => {
  it('gera os recorrentes, cobra as faturas, atualiza as agendadas e só depois converte as da fatura aberta', async () => {
    expect(await atualizarAutomaticos()).toEqual({ recorrentesOk: true, faturasOk: true, mudou: false })
    const ordem = [mock.gerarOcorrencias, mock.cobrarFaturasFechadas, mock.sincronizarAgendados, mock.converterAgendados]
      .map((f) => f.mock.invocationCallOrder[0])
    expect(ordem[0]).toBeLessThan(ordem[1])
    expect(ordem[1]).toBeLessThan(ordem[2])
    expect(ordem[2]).toBeLessThan(ordem[3])
  })

  it('falha ao converter (banco sem a função) não derruba nem marca falha nas outras tarefas', async () => {
    mock.converterAgendados.mockRejectedValue(new Error('function does not exist'))
    expect(await atualizarAutomaticos()).toEqual({ recorrentesOk: true, faturasOk: true, mudou: false })
  })

  it('falha nas agendadas (banco sem a função) não derruba nem marca falha nas outras duas', async () => {
    mock.sincronizarAgendados.mockRejectedValue(new Error('function does not exist'))
    expect(await atualizarAutomaticos()).toEqual({ recorrentesOk: true, faturasOk: true, mudou: false })
  })

  it('falha nos recorrentes ou nas faturas continua sendo avisada, e as agendadas rodam assim mesmo', async () => {
    mock.gerarOcorrencias.mockRejectedValue(new Error('x'))
    mock.cobrarFaturasFechadas.mockRejectedValue(new Error('y'))
    expect(await atualizarAutomaticos()).toEqual({ recorrentesOk: false, faturasOk: false, mudou: false })
    expect(mock.sincronizarAgendados).toHaveBeenCalled()
  })

  it('mudou: só quando algo que aparece na tela foi gravado (recorrente, fatura cobrada ou assinatura convertida)', async () => {
    expect((await atualizarAutomaticos()).mudou).toBe(false)
    mock.sincronizarAgendados.mockResolvedValue(12) // lista de faturas futuras: não muda valores da tela
    expect((await atualizarAutomaticos()).mudou).toBe(false)
    mock.gerarOcorrencias.mockResolvedValue(2)
    expect((await atualizarAutomaticos()).mudou).toBe(true)
    mock.gerarOcorrencias.mockResolvedValue(0)
    mock.cobrarFaturasFechadas.mockResolvedValue(1)
    expect((await atualizarAutomaticos()).mudou).toBe(true)
    mock.cobrarFaturasFechadas.mockResolvedValue(0)
    mock.converterAgendados.mockResolvedValue(3)
    expect((await atualizarAutomaticos()).mudou).toBe(true)
  })
})

describe('atualizarAutomaticos com chave (não repetir a cada tela, 25/11/2026)', () => {
  it('duas telas abrindo juntas dividem a mesma rodada', async () => {
    const [a, b] = await Promise.all([atualizarAutomaticos({ chave: 'h1' }), atualizarAutomaticos({ chave: 'h1' })])
    expect(a).toEqual(b)
    expect(mock.gerarOcorrencias).toHaveBeenCalledTimes(1)
    expect(mock.cobrarFaturasFechadas).toHaveBeenCalledTimes(1)
  })

  it('a tela seguinte reaproveita a rodada boa: nada é gravado de novo e nada "mudou"', async () => {
    mock.gerarOcorrencias.mockResolvedValue(3)
    expect((await atualizarAutomaticos({ chave: 'h1' })).mudou).toBe(true)
    expect(await atualizarAutomaticos({ chave: 'h1' })).toEqual({ recorrentesOk: true, faturasOk: true, mudou: false })
    expect(mock.gerarOcorrencias).toHaveBeenCalledTimes(1)
    expect(mock.converterAgendados).toHaveBeenCalledTimes(1)
  })

  it('rodada com falha não é lembrada: a próxima tela tenta de novo', async () => {
    mock.cobrarFaturasFechadas.mockRejectedValueOnce(new Error('y'))
    expect((await atualizarAutomaticos({ chave: 'h1' })).faturasOk).toBe(false)
    expect((await atualizarAutomaticos({ chave: 'h1' })).faturasOk).toBe(true)
    expect(mock.cobrarFaturasFechadas).toHaveBeenCalledTimes(2)
  })

  it('forcar roda de novo; outra família não reaproveita; passado o prazo, roda de novo', async () => {
    await atualizarAutomaticos({ chave: 'h1' })
    await atualizarAutomaticos({ chave: 'h1', forcar: true })
    expect(mock.gerarOcorrencias).toHaveBeenCalledTimes(2)
    await atualizarAutomaticos({ chave: 'h2' })
    expect(mock.gerarOcorrencias).toHaveBeenCalledTimes(3)
    vi.useFakeTimers()
    try {
      vi.setSystemTime(Date.now() + 11 * 60 * 1000)
      await atualizarAutomaticos({ chave: 'h1' })
      expect(mock.gerarOcorrencias).toHaveBeenCalledTimes(4)
    } finally { vi.useRealTimers() }
  })
})
