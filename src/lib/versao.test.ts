import { describe, expect, it } from 'vitest'
import { VERSAO } from './versao'

describe('versão do app', () => {
  it('é ano.edição (sem o terceiro número do package.json)', () => {
    expect(VERSAO).toMatch(/^\d{4}\.\d+$/)
  })
})
