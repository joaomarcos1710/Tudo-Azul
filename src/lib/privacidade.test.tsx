// @vitest-environment jsdom
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import type { Cents } from './format'
import { formatBRL, formatBRLCampo, formatBRLSinal, parseBRL } from './format'
import { MASCARA, definirValoresOcultos, valoresOcultos } from './privacidade'
import { brlCompacto } from '../components/graficos/LinhaAcumulada'
import { AppShell } from '../components/layout/AppShell'

vi.mock('./supabase', () => ({ supabase: null, supabaseConfigurado: true }))
const c = (n: number) => n as Cents

describe('ocultar valores', () => {
  beforeEach(() => { localStorage.clear(); definirValoresOcultos(false) })
  afterEach(() => { cleanup(); definirValoresOcultos(false) })

  it('formatBRL devolve a máscara (sem vazar o tamanho do valor); formatBRLCampo nunca é mascarado', () => {
    expect(formatBRL(c(125050))).toBe('R$ 1.250,50')
    definirValoresOcultos(true)
    expect(formatBRL(c(125050))).toBe(MASCARA)
    expect(formatBRL(c(-3000))).toBe(MASCARA)
    expect(formatBRL(c(0))).toBe(MASCARA)
    expect(formatBRLCampo(c(125050))).toBe('1.250,50')
    expect(formatBRLCampo(c(-3000))).toBe('-30,00')
    // o que preenche um campo de edição lê de volta o mesmo valor, com ou sem máscara
    expect(parseBRL(formatBRLCampo(c(125050)))).toBe(125050)
    expect(parseBRL(formatBRLCampo(c(-3000)))).toBe(-3000)
  })

  it('formatBRLSinal também devolve só a máscara, sem revelar o sinal', () => {
    definirValoresOcultos(true)
    expect(formatBRLSinal(c(-3000))).toBe(MASCARA)
    expect(formatBRLSinal(c(3000))).toBe(MASCARA)
  })

  it('o rótulo compacto do gráfico também some', () => {
    expect(brlCompacto(150000)).toBe('R$ 1,5 mil')
    definirValoresOcultos(true)
    expect(brlCompacto(150000)).toBe(MASCARA)
  })

  it('a preferência fica no aparelho (localStorage) e o botão do menu liga e desliga', async () => {
    const u = userEvent.setup()
    render(<MemoryRouter><AppShell /></MemoryRouter>)
    const botoes = screen.getAllByRole('button', { name: 'Ocultar valores' }) // barra lateral e cabeçalho do celular
    expect(botoes[0].getAttribute('aria-pressed')).toBe('false')
    await u.click(botoes[0])
    expect(valoresOcultos()).toBe(true)
    expect(localStorage.getItem('tudo-azul:ocultar-valores')).toBe('1')
    expect(screen.getAllByRole('button', { name: 'Ocultar valores' })[0].getAttribute('aria-pressed')).toBe('true')
    await u.click(screen.getAllByRole('button', { name: 'Ocultar valores' })[1])
    expect(valoresOcultos()).toBe(false)
    expect(localStorage.getItem('tudo-azul:ocultar-valores')).toBe('0')
  })

  it('quem usa o hook re-renderiza ao alternar (é o que atualiza todas as telas)', async () => {
    const { useValoresOcultos } = await import('./privacidade')
    function Sonda() {
      useValoresOcultos()
      return <p>{formatBRL(c(1000))}</p>
    }
    render(<Sonda />)
    expect(screen.getByText('R$ 10,00')).toBeTruthy()
    act(() => definirValoresOcultos(true))
    expect(screen.getByText(MASCARA)).toBeTruthy()
  })
})

/** Trava de segurança: campo de edição NUNCA pode ser preenchido com formatBRL (com a máscara ligada, o campo viria "R$ ••••"). */
describe('guarda contra preencher campo com valor mascarado', () => {
  function arquivos(dir: string): string[] {
    return readdirSync(dir).flatMap((n) => {
      const p = join(dir, n)
      if (statSync(p).isDirectory()) return arquivos(p)
      return /\.tsx?$/.test(n) && !/\.test\./.test(n) ? [p] : []
    })
  }

  it('nenhum código usa formatBRL(...).replace(...) nem formatBRL dentro de useState/value/defaultValue', () => {
    const problemas: string[] = []
    for (const f of arquivos('src')) {
      const linhas = readFileSync(f, 'utf8').split('\n')
      linhas.forEach((l, i) => {
        if (/formatBRL\([^)]*\)\s*\.replace/.test(l)) problemas.push(`${f}:${i + 1} formatBRL(...).replace(...)`)
        if (/useState\([^)]*formatBRL\(/.test(l)) problemas.push(`${f}:${i + 1} useState com formatBRL`)
        if (/(value|defaultValue)=\{[^}]*formatBRL\(/.test(l)) problemas.push(`${f}:${i + 1} value/defaultValue com formatBRL`)
      })
    }
    expect(problemas).toEqual([])
  })
})
