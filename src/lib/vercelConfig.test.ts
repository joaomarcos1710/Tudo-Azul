import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Os arquivos de /assets têm o hash do conteúdo no nome: podem ficar guardados no navegador por 1 ano.
// Antes o Vercel mandava max-age=0 e o celular baixava o app inteiro a cada abertura.
const config = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8')) as {
  rewrites: { source: string; destination: string }[]
  headers: { source: string; headers: { key: string; value: string }[] }[]
}

describe('vercel.json', () => {
  it('arquivos de /assets ficam no cache do navegador por 1 ano (immutable)', () => {
    const assets = config.headers.find((h) => h.source === '/assets/(.*)')
    expect(assets?.headers).toContainEqual({ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' })
  })

  it('arquivo de /assets que não existe dá 404, não o index.html (senão o HTML ficaria guardado 1 ano no lugar do JS)', () => {
    const spa = config.rewrites.find((r) => r.destination === '/index.html')
    const re = new RegExp(`^${spa!.source.replace(/\(\?!/g, '(?!')}$`)
    expect(re.test('/assets/Lancamentos-antigo.js')).toBe(false)
    expect(re.test('/lancamentos')).toBe(true)
    expect(re.test('/contas/abc')).toBe(true)
  })

  it('o service worker nunca fica em cache', () => {
    const sw = config.headers.find((h) => h.source === '/sw.js')
    expect(sw?.headers).toContainEqual({ key: 'Cache-Control', value: 'no-cache' })
  })
})
