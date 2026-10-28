// @vitest-environment jsdom
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { Card } from './Card'

afterEach(cleanup)

describe('Card', () => {
  it('tem padding por padrão', () => {
    const { container } = render(<Card>x</Card>)
    expect(container.firstElementChild?.className.split(/\s+/)).toContain('p-5')
  })

  it('semPadding não aplica p-5 (lista encostada na borda não ganha padding dobrado)', () => {
    const { container } = render(<Card semPadding>x</Card>)
    expect(container.firstElementChild?.className.split(/\s+/)).not.toContain('p-5')
  })

  it('nenhuma tela tenta zerar o padding com className (p-5 venceria no CSS)', () => {
    const pasta = join(__dirname, '../../pages')
    const culpados = readdirSync(pasta)
      .filter((f) => f.endsWith('.tsx') && !f.includes('.test.'))
      .filter((f) => /<Card[^>]*className="[^"]*(?<![!\w-])p-0\b/.test(readFileSync(join(pasta, f), 'utf8')))
    expect(culpados).toEqual([])
  })
})
