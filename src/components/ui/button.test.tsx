import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? arquivos(p) : p.endsWith('.tsx') && !p.includes('.test.') ? [p] : []
  })
}

describe('Button', () => {
  it('ninguém passa padding por className (o px-4 do botão venceria no CSS); para botão menor use `compacto`', () => {
    const raiz = join(__dirname, '../..')
    const errados = arquivos(raiz).flatMap((p) =>
      (readFileSync(p, 'utf8').match(/<Button\b[^>]*className="[^"]*\bp[xytblr]?-\d/g) ?? []).map((m) => `${p}: ${m.slice(0, 80)}`))
    expect(errados).toEqual([])
  })
})
