// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { IconeConta } from '../components/ui/IconeConta'
import { BANCOS, bancoDaConta } from './bancos'

describe('bancoDaConta', () => {
  it('reconhece a Caixa Econômica pelo nome da conta', () => {
    expect(bancoDaConta('Conta corrente Caixa Econômica', 'checking')?.chave).toBe('caixa')
    expect(bancoDaConta('CEF poupança', 'savings')?.chave).toBe('caixa')
  })

  it('ignora acento e maiúsculas', () => {
    expect(bancoDaConta('ITAÚ João', 'checking')?.chave).toBe('itau')
    expect(bancoDaConta('nubank', 'checking')?.chave).toBe('nubank')
  })

  it('só casa palavra inteira', () => {
    expect(bancoDaConta('Internacional', 'checking')).toBeNull()
    expect(bancoDaConta('Nuvem', 'checking')).toBeNull()
  })

  it('carteira em dinheiro nunca vira banco', () => {
    expect(bancoDaConta('Caixa da casa', 'cash')).toBeNull()
  })

  it('nome sem banco fica sem selo', () => {
    expect(bancoDaConta('Reserva da família', 'savings')).toBeNull()
  })

  it('toda sigla e chave são únicas e as cores são hexadecimais', () => {
    expect(new Set(BANCOS.map((b) => b.chave)).size).toBe(BANCOS.length)
    for (const b of BANCOS) {
      expect(b.cor).toMatch(/^#[0-9A-F]{6}$/i)
      expect(b.texto).toMatch(/^#[0-9A-F]{6}$/i)
    }
  })
})

describe('IconeConta', () => {
  afterEach(cleanup)
  it('mostra o selo do banco sem pôr a sigla no texto da página', () => {
    const { container } = render(<p>Conta corrente Caixa Econômica <IconeConta nome="Conta corrente Caixa Econômica" tipo="checking" /></p>)
    const selo = container.querySelector('[data-banco="caixa"]')
    expect(selo).not.toBeNull()
    expect(selo?.getAttribute('data-sigla')).toBe('CX')
    expect(selo?.getAttribute('aria-hidden')).toBe('true')
    expect(screen.getByText(/Conta corrente Caixa Econômica/)).toBeTruthy()
    expect(container.textContent).not.toContain('CX')
  })

  it('sem banco usa o ícone neutro', () => {
    const { container } = render(<IconeConta nome="Reserva" tipo="savings" />)
    expect(container.querySelector('[data-banco=""]')).not.toBeNull()
    expect(container.querySelector('svg')).not.toBeNull()
  })
})
