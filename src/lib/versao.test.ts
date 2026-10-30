import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { VERSAO } from './versao'

describe('versão do app', () => {
  it('é ano.número-da-PR (sem o terceiro número do package.json)', () => {
    expect(VERSAO).toMatch(/^\d{4}\.\d+$/)
  })

  it('package.json e package-lock.json seguem a regra AAAA.N.0, com o mesmo valor nos dois', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }
    const lock = JSON.parse(readFileSync(new URL('../../package-lock.json', import.meta.url), 'utf8')) as { version: string; packages: { '': { version: string } } }
    expect(pkg.version).toMatch(/^20\d\d\.\d+\.0$/)
    expect(lock.version).toBe(pkg.version)
    expect(lock.packages[''].version).toBe(pkg.version)
  })
})
