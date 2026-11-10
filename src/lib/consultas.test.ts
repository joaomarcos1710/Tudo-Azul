import { QueryObserver } from '@tanstack/react-query'
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

  it('invalidar durante a PRIMEIRA carga refaz a leitura (a que estava em curso pode ter lido antes da gravação)', async () => {
    const cliente = criarClienteConsultas()
    const queryKey = chaveVisaoGeral('inicio', 'fam-a', '2026-11', '2026-11-10')
    let noBanco = 'antes da gravação'
    let leituras = 0
    const soltar: Array<() => void> = []
    const obs = new QueryObserver<string>(cliente, {
      queryKey,
      queryFn: () => { leituras += 1; const lido = noBanco; return new Promise<string>((ok) => soltar.push(() => ok(lido))) },
    })
    const parar = obs.subscribe(() => {})
    expect(leituras).toBe(1)
    noBanco = 'depois da gravação'
    const invalidando = invalidarDadosHome(cliente, 'fam-a')
    await new Promise((r) => setTimeout(r, 0))
    soltar.forEach((s) => s())
    await new Promise((r) => setTimeout(r, 0))
    soltar.forEach((s) => s())
    await invalidando
    expect(leituras).toBe(2)
    expect(cliente.getQueryData(queryKey)).toBe('depois da gravação')
    parar()
  })

  it('clear() esvazia tudo (é o que o logout chama)', () => {
    const cliente = criarClienteConsultas()
    cliente.setQueryData(chaveVisaoGeral('inicio', 'fam-a', '2026-11', '2026-11-10'), { saldo: 1 })
    cliente.clear()
    expect(cliente.getQueryCache().getAll()).toHaveLength(0)
  })
})
