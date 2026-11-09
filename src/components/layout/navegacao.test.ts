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

describe('destino do painel', () => {
  it('mantém o Início dentro da área autenticada em /painel', () => {
    const inicio = gruposNavegacao.flatMap((grupo) => grupo.itens).find((item) => item.rotulo === 'Início')
    expect(inicio?.caminho).toBe('/painel')
    expect(itemAtivo('/painel')?.rotulo).toBe('Início')
    expect(itemAtivo('/')?.rotulo).toBeUndefined()
  })
})
