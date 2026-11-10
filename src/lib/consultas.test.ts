import { describe, expect, it } from 'vitest'
import { chaveVisaoGeral, criarClienteConsultas, invalidarDadosHome } from './consultas'

describe('cache das consultas do Início', () => {
  it('a chave separa seção, família, mês e dia: nada vaza de uma família ou de um mês para outro', () => {
    const base = chaveVisaoGeral('inicio', 'fam-a', '2026-11', '2026-11-10')
    expect(chaveVisaoGeral('inicio', 'fam-b', '2026-11', '2026-11-10')).not.toEqual(base)
    expect(chaveVisaoGeral('inicio', 'fam-a', '2026-12', '2026-11-10')).not.toEqual(base)
    expect(chaveVisaoGeral('inicio', 'fam-a', '2026-11', '2026-11-11')).not.toEqual(base)
    expect(chaveVisaoGeral('analises', 'fam-a', '2026-11', '2026-11-10')).not.toEqual(base)
    expect(chaveVisaoGeral('inicio', 'fam-a', '2026-11', '2026-11-10')).toEqual(base)
  })

  it('padrões: revalida sempre (staleTime 0), sem repetir consulta que falhou e sem revalidar ao focar a janela', () => {
    const q = criarClienteConsultas().getDefaultOptions().queries
    expect(q?.staleTime).toBe(0)
    expect(q?.retry).toBe(false)
    expect(q?.refetchOnWindowFocus).toBe(false)
  })

  it('invalidarDadosHome marca como velhas só as entradas da família pedida', async () => {
    const cliente = criarClienteConsultas()
    const a = chaveVisaoGeral('inicio', 'fam-a', '2026-11', '2026-11-10')
    const a2 = chaveVisaoGeral('analises', 'fam-a', '2026-11', '2026-11-10')
    const b = chaveVisaoGeral('inicio', 'fam-b', '2026-11', '2026-11-10')
    for (const k of [a, a2, b]) cliente.setQueryData(k, { ok: true })
    await invalidarDadosHome(cliente, 'fam-a')
    expect(cliente.getQueryState(a)?.isInvalidated).toBe(true)
    expect(cliente.getQueryState(a2)?.isInvalidated).toBe(true)
    expect(cliente.getQueryState(b)?.isInvalidated).toBe(false)
  })

  it('clear() esvazia tudo (é o que o logout chama)', () => {
    const cliente = criarClienteConsultas()
    cliente.setQueryData(chaveVisaoGeral('inicio', 'fam-a', '2026-11', '2026-11-10'), { saldo: 1 })
    cliente.clear()
    expect(cliente.getQueryCache().getAll()).toHaveLength(0)
  })
})
