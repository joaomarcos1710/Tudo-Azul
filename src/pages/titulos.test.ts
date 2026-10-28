import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('títulos com mês', () => {
  it('nenhuma tela usa a classe capitalize (ela escreve "Outubro De 2026"; use primeiraMaiuscula)', () => {
    const culpados = readdirSync(__dirname)
      .filter((f) => f.endsWith('.tsx') && !f.includes('.test.'))
      .filter((f) => /className="[^"]*\bcapitalize\b/.test(readFileSync(join(__dirname, f), 'utf8')))
    expect(culpados).toEqual([])
  })
})
