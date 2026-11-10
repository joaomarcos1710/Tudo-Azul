import { describe, expect, it } from 'vitest'
import { gruposMenuPerfil, gruposNavegacao, itemAtivo } from './navegacao'

describe('navegação de Preferências', () => {
  it('mantém Preferências no menu do perfil, fora dos grupos principais da sidebar', () => {
    const perfil = gruposMenuPerfil.flatMap((grupo) => grupo.itens)
    const sidebar = gruposNavegacao.flatMap((grupo) => grupo.itens)
    expect(perfil.some((item) => item.caminho === '/preferencias')).toBe(true)
    expect(sidebar.some((item) => item.caminho === '/preferencias')).toBe(false)
    expect(itemAtivo('/preferencias')?.rotulo).toBe('Preferências')
  })
})
