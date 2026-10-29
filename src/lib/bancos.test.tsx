// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { IconeConta } from '../components/ui/IconeConta'
import { BANCOS, BANCOS_POR_NOME, BANDEIRAS, LOGOS, LOGOS_BANDEIRA, bancoDaConta, bancoEscolhidoOuDoNome, bancoPorChave } from './bancos'

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
  it('banco sem logo mostra a sigla sem pô-la no texto da página', () => {
    const { container } = render(<p>Conta Next <IconeConta nome="Conta Next" tipo="checking" /></p>)
    const selo = container.querySelector('[data-banco="next"]')
    expect(selo).not.toBeNull()
    expect(selo?.getAttribute('data-sigla')).toBe('Nx')
    expect(selo?.getAttribute('aria-hidden')).toBe('true')
    expect(screen.getByText(/Conta Next/)).toBeTruthy()
    expect(container.textContent).not.toContain('Nx')
  })

  it('sem banco usa o ícone neutro', () => {
    const { container } = render(<IconeConta nome="Reserva" tipo="savings" />)
    expect(container.querySelector('[data-banco=""]')).not.toBeNull()
    expect(container.querySelector('svg')).not.toBeNull()
  })
})

describe('LOGOS', () => {
  it('só tem chaves de bancos conhecidos (arquivo com nome errado não aparece em lugar nenhum)', () => {
    const chaves = new Set(BANCOS.map((b) => b.chave))
    for (const chave of Object.keys(LOGOS)) expect(chaves.has(chave)).toBe(true)
  })
})

describe('Logo no selo', () => {
  afterEach(cleanup)
  it('a Caixa tem logo em arquivo e o selo vira imagem, sem sigla', () => {
    expect(LOGOS.caixa).toBeTruthy()
    const { container } = render(<IconeConta nome="Conta corrente Caixa Econômica" tipo="checking" />)
    expect(container.querySelector('[data-logo] img')?.getAttribute('src')).toBe(LOGOS.caixa)
    expect(container.querySelector('[data-sigla]')).toBeNull()
  })

  it('banco sem arquivo de logo continua com a sigla', () => {
    const semLogo = BANCOS.find((b) => !LOGOS[b.chave])
    expect(semLogo).toBeTruthy()
    const { container } = render(<IconeConta nome={semLogo!.nome} tipo="checking" />)
    expect(container.querySelector(`[data-banco="${semLogo!.chave}"][data-sigla]`)).not.toBeNull()
  })
})

describe('banco gravado', () => {
  it('a escolha vale mais que o nome', () => {
    expect(bancoEscolhidoOuDoNome('nubank', 'Conta Caixa', 'checking')?.chave).toBe('nubank')
  })

  it('sem escolha cai no nome; chave desconhecida também', () => {
    expect(bancoEscolhidoOuDoNome(null, 'Conta Caixa', 'checking')?.chave).toBe('caixa')
    expect(bancoEscolhidoOuDoNome('bancoquenaoexiste', 'Conta Caixa', 'checking')?.chave).toBe('caixa')
    expect(bancoEscolhidoOuDoNome(null, 'Reserva', 'savings')).toBeNull()
  })

  it('carteira em dinheiro nunca tem banco, mesmo com chave', () => {
    expect(bancoEscolhidoOuDoNome('caixa', 'Carteira', 'cash')).toBeNull()
  })

  it('bancoPorChave', () => {
    expect(bancoPorChave('itau')?.nome).toBe('Itaú')
    expect(bancoPorChave('')).toBeNull()
    expect(bancoPorChave(undefined)).toBeNull()
  })

  it('a lista do seletor vem em ordem alfabética e sem repetir banco', () => {
    const nomes = BANCOS_POR_NOME.map((b) => b.nome)
    expect(nomes).toEqual([...nomes].sort((a, b) => a.localeCompare(b, 'pt-BR')))
    expect(nomes.length).toBe(BANCOS.length)
  })
})

describe('bandeiras', () => {
  it('as chaves são as aceitas pelo banco e cada uma tem arquivo', () => {
    expect(BANDEIRAS.map((b) => b.chave).sort()).toEqual(['amex', 'diners', 'elo', 'hipercard', 'mastercard', 'visa'])
    for (const b of BANDEIRAS) expect(LOGOS_BANDEIRA[b.chave]).toBeTruthy()
  })
})
