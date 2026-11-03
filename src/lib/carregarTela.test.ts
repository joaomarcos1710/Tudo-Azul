// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { importarComRecarga } from './carregarTela'

beforeEach(() => sessionStorage.clear())

describe('importarComRecarga (tela sob demanda depois de um deploy)', () => {
  it('arquivo da tela sumiu (deploy novo): recarrega a página uma vez', async () => {
    const recarregar = vi.fn()
    void importarComRecarga(() => Promise.reject(new Error('Failed to fetch dynamically imported module')), recarregar)
    await vi.waitFor(() => expect(recarregar).toHaveBeenCalledTimes(1))
  })

  it('falhou de novo logo depois de recarregar: mostra o erro em vez de recarregar sem fim', async () => {
    const recarregar = vi.fn()
    void importarComRecarga(() => Promise.reject(new Error('sumiu')), recarregar)
    await vi.waitFor(() => expect(recarregar).toHaveBeenCalledTimes(1))
    await expect(importarComRecarga(() => Promise.reject(new Error('sumiu de novo')), recarregar)).rejects.toThrow('sumiu de novo')
    expect(recarregar).toHaveBeenCalledTimes(1)
  })

  it('carregou bem: libera para recarregar de novo num próximo deploy', async () => {
    const recarregar = vi.fn()
    void importarComRecarga(() => Promise.reject(new Error('sumiu')), recarregar)
    await vi.waitFor(() => expect(recarregar).toHaveBeenCalledTimes(1))
    await expect(importarComRecarga(() => Promise.resolve({ default: 'tela' }))).resolves.toEqual({ default: 'tela' })
    void importarComRecarga(() => Promise.reject(new Error('outro deploy')), recarregar)
    await vi.waitFor(() => expect(recarregar).toHaveBeenCalledTimes(2))
  })
})
