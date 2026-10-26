// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FamiliaProvider, useFamilia } from './FamiliaContext'

const mock = vi.hoisted(() => ({ sessao: null as { user: { id: string } } | null, carregarFamilia: vi.fn() }))
vi.mock('./auth', () => ({ useAuth: () => ({ sessao: mock.sessao }) }))
vi.mock('./familia', () => ({ carregarFamilia: mock.carregarFamilia }))

/** Registra tudo o que o ExigeFamilia veria a cada renderização. */
function Sonda({ vistos }: { vistos: { nome: string | null; carregando: boolean }[] }) {
  const { familia, carregando } = useFamilia()
  vistos.push({ nome: familia?.nome ?? null, carregando })
  return null
}

describe('FamiliaProvider', () => {
  it('quando a sessão aparece (abrir o app já logado), nunca mostra "sem família" antes de carregar', async () => {
    mock.sessao = null
    mock.carregarFamilia.mockResolvedValue({ id: 'h1', nome: 'Casa', papel: 'owner' })
    const vistos: { nome: string | null; carregando: boolean }[] = []
    const { rerender } = render(<FamiliaProvider><Sonda vistos={vistos} /></FamiliaProvider>)
    // a sessão chega depois da primeira renderização (a restauração da sessão é assíncrona)
    mock.sessao = { user: { id: 'u1' } }
    vistos.length = 0
    rerender(<FamiliaProvider><Sonda vistos={vistos} /></FamiliaProvider>)
    await vi.waitFor(() => expect(vistos[vistos.length - 1]).toEqual({ nome: 'Casa', carregando: false }))
    // antes de a família chegar, só pode aparecer "carregando": nunca (sem família, não carregando),
    // que é o que mandava para /familia em vez do Início
    expect(vistos.filter((v) => v.nome === null && !v.carregando)).toEqual([])
  })

  it('quem realmente não tem família termina em "sem família", não carregando', async () => {
    mock.sessao = { user: { id: 'u2' } }
    mock.carregarFamilia.mockResolvedValue(null)
    const vistos: { nome: string | null; carregando: boolean }[] = []
    render(<FamiliaProvider><Sonda vistos={vistos} /></FamiliaProvider>)
    await vi.waitFor(() => expect(vistos[vistos.length - 1]).toEqual({ nome: null, carregando: false }))
  })
})
