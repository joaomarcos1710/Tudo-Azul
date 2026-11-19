import { describe, expect, it } from 'vitest'
import { gruposMenuPerfil, gruposNavegacao, itemAtivo } from './navegacao'

describe('navegação de Preferências', () => {
  it('Preferências está no menu do perfil (computador/iPad) e no menu Mais (celular)', () => {
    const perfil = gruposMenuPerfil.flatMap((grupo) => grupo.itens)
    const sidebar = gruposNavegacao.flatMap((grupo) => grupo.itens)
    expect(perfil.some((item) => item.caminho === '/preferencias')).toBe(true)
    expect(sidebar.some((item) => item.caminho === '/preferencias')).toBe(true) // o Mais do iPhone usa gruposNavegacao
    expect(itemAtivo('/preferencias')?.rotulo).toBe('Preferências')
  })
})
