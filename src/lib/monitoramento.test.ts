import { describe, expect, it } from 'vitest'
import type { ErrorEvent } from '@sentry/react'
import { filtrarRastro, limparEvento, limparTexto } from './monitoramento'

describe('monitoramento: nada de dado pessoal nem valor sai do app', () => {
  it('troca valores em reais e e-mails por marcadores', () => {
    expect(limparTexto('saldo R$ 1.250,50 de joao@exemplo.com')).toBe('saldo [valor] de [email]')
    expect(limparTexto('-R$ 50,00 e 12.345,67 e R$ 10')).toBe('[valor] e [valor] e [valor]')
    expect(limparTexto('Erro 23514: tem saldo')).toBe('Erro 23514: tem saldo') // código de erro não é valor
  })

  it('evento sai sem usuário, sem extra, sem cabeçalhos/cookies e com URL sem query', () => {
    const e = limparEvento({
      type: undefined,
      message: 'falhou com R$ 2.277,88',
      user: { id: 'u1', email: 'joao@exemplo.com', ip_address: '1.2.3.4' },
      extra: { saldo: 227788 },
      request: { url: 'https://tudo-azul.vercel.app/contas?x=1', headers: { authorization: 'Bearer x' }, cookies: { a: 'b' } },
      exception: { values: [{ type: 'Error', value: 'conta de joao@exemplo.com com 1.000,00' }] },
      breadcrumbs: [
        { category: 'console', message: 'saldo 1.000,00' },
        { category: 'fetch', data: { url: 'https://x.supabase.co/rest/v1/transactions?household_id=eq.abc&amount=eq.100' } },
      ],
    } as ErrorEvent)
    expect(e.user).toBeUndefined()
    expect(e.extra).toBeUndefined()
    expect(e.request).toEqual({ url: 'https://tudo-azul.vercel.app/contas' })
    expect(e.message).toBe('falhou com [valor]')
    expect(e.exception?.values?.[0].value).toBe('conta de [email] com [valor]')
    expect(e.breadcrumbs).toEqual([{ category: 'fetch', data: { url: 'https://x.supabase.co/rest/v1/transactions' } }])
  })

  it('rastro de console é descartado; navegação vai sem query', () => {
    expect(filtrarRastro({ category: 'console', message: 'x' })).toBeNull()
    expect(filtrarRastro({ category: 'navigation', data: { from: '/a?b=1', to: '/contas?id=2' } }))
      .toEqual({ category: 'navigation', data: { from: '/a', to: '/contas' } })
  })
})
