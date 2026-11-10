import { describe, expect, it } from 'vitest'
import { AUTOR, linhasAutoria } from './autoria'

describe('aviso de autoria (ideia 03)', () => {
  it('usa o ano da data informada e o nome do dono, nas duas linhas', () => {
    expect(linhasAutoria('2026-11-09')).toEqual(['© 2026 Tudo Azul.', `Todos os direitos reservados a ${AUTOR}.`])
    expect(linhasAutoria('2027-01-01')[0]).toBe('© 2027 Tudo Azul.')
  })
  it('sem data, usa o ano de hoje (não um ano fixo)', () => {
    expect(linhasAutoria()[0]).toMatch(/^© \d{4} Tudo Azul\.$/)
    expect(linhasAutoria()[0]).toContain(String(new Date().getFullYear()).slice(0, 3))
  })
})
