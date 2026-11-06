import { beforeEach, describe, expect, it, vi } from 'vitest'

const sentry = vi.hoisted(() => ({ captureException: vi.fn() }))
vi.mock('@sentry/react', () => sentry)

import { codigoDoErro, opcional } from './consultaOpcional'

beforeEach(() => sentry.captureException.mockClear())

describe('opcional', () => {
  it('falhou: devolve null e manda ao Sentry só o nome da consulta e o código do erro', async () => {
    // erro como o PostgREST devolve num statement timeout (mensagem inventada com um valor, que não pode sair)
    const erro = { code: '57014', message: 'canceling statement due to statement timeout R$ 1.234,56', details: null, hint: null }
    expect(await opcional('net_worth_with_assets', Promise.reject(erro))).toBeNull()
    await vi.waitFor(() => expect(sentry.captureException).toHaveBeenCalledTimes(1))
    const [enviado, contexto] = sentry.captureException.mock.calls[0] as [Error, { tags: Record<string, string>; fingerprint: string[] }]
    expect(enviado.message).toBe('Consulta opcional falhou: net_worth_with_assets (57014)')
    expect(enviado.message).not.toMatch(/1\.234|timeout/)
    expect(contexto.tags).toEqual({ consulta: 'net_worth_with_assets', codigo: '57014' })
    expect(contexto.fingerprint).toEqual(['consulta-opcional', 'net_worth_with_assets', '57014'])
  })

  it('deu certo: devolve o valor e não manda nada', async () => {
    expect(await opcional('x', Promise.resolve(42))).toBe(42)
    await new Promise((ok) => setTimeout(ok, 0))
    expect(sentry.captureException).not.toHaveBeenCalled()
  })

  it('código do erro: do banco, o status HTTP, o tipo do erro ou "desconhecido"', () => {
    expect(codigoDoErro({ code: 'PGRST202' })).toBe('PGRST202')
    expect(codigoDoErro({ status: 500 })).toBe('500')
    expect(codigoDoErro(new TypeError('Failed to fetch'))).toBe('TypeError')
    expect(codigoDoErro('texto')).toBe('desconhecido')
  })
})
