// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { IconeConta } from '../components/ui/IconeConta'
import { bancoDaConta, bancoEscolhidoOuDoNome, tipoSemBanco } from './bancos'
import { ajudaTipoConta, ehTipoConta, GRUPOS_TIPO_CONTA, rotuloDoTipo, rotuloTipoConta, TIPOS_CONTA } from './contas'

afterEach(cleanup)

describe('tipos de conta (migration 070: onde o dinheiro está)', () => {
  it('são exatamente os 7 do banco, na ordem de balance_totals_by_type', () => {
    expect(TIPOS_CONTA).toEqual(['checking', 'savings', 'brokerage', 'fixed_income', 'variable_income', 'crypto', 'cash'])
    expect(Object.keys(rotuloTipoConta).sort()).toEqual([...TIPOS_CONTA].sort())
    expect(Object.keys(ajudaTipoConta).sort()).toEqual([...TIPOS_CONTA].sort())
  })

  it('rótulos da tela', () => {
    expect(rotuloTipoConta).toEqual({
      checking: 'Conta corrente',
      savings: 'Poupança / reserva',
      brokerage: 'Corretora (saldo a aplicar)',
      fixed_income: 'Renda fixa',
      variable_income: 'Renda variável',
      crypto: 'Cripto',
      cash: 'Dinheiro (carteira)',
    })
    expect(ajudaTipoConta.brokerage).toMatch(/não rende/)
  })

  it('os grupos do formulário cobrem cada tipo uma vez só', () => {
    const todos = GRUPOS_TIPO_CONTA.flatMap((g) => g.tipos)
    expect([...todos].sort()).toEqual([...TIPOS_CONTA].sort())
    expect(new Set(todos).size).toBe(TIPOS_CONTA.length)
  })

  it('tipos antigos (antes da 070) não são aceitos no formulário, mas têm rótulo legível', () => {
    expect(ehTipoConta('investment')).toBe(false)
    expect(ehTipoConta('other')).toBe(false)
    expect(ehTipoConta('brokerage')).toBe(true)
    expect(rotuloDoTipo('investment')).toBe('Investimento (tipo antigo)')
    expect(rotuloDoTipo('other')).toBe('Outra (tipo antigo)')
    expect(rotuloDoTipo('fixed_income')).toBe('Renda fixa')
  })

  it('só a carteira em dinheiro não tem banco', () => {
    expect(TIPOS_CONTA.filter(tipoSemBanco)).toEqual(['cash'])
    expect(bancoDaConta('Caixa da casa', 'cash')).toBeNull()
    expect(bancoEscolhidoOuDoNome('nubank', 'Carteira', 'cash')).toBeNull()
    expect(bancoEscolhidoOuDoNome('nubank', 'Corretora de teste', 'brokerage')?.chave).toBe('nubank')
  })

  it('sem banco, o selo mostra o ícone do tipo (um diferente para cada tipo)', () => {
    const desenhos = TIPOS_CONTA.map((tipo) => {
      const { container } = render(<IconeConta nome="Sem banco" tipo={tipo} />)
      const selo = container.querySelector('[data-banco=""]')!
      expect(selo.getAttribute('data-tipo')).toBe(tipo)
      const svg = selo.querySelector('svg')!.innerHTML
      cleanup()
      return svg
    })
    expect(new Set(desenhos).size).toBe(TIPOS_CONTA.length)
  })
})
