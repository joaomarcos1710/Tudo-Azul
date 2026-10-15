import { describe, expect, it } from 'vitest'
import { assertBrowserPublishableKey } from './supabase'

describe('assertBrowserPublishableKey', () => {
  it('aceita a publishable key no formato esperado', () => {
    expect(() => assertBrowserPublishableKey('sb_publishable_abc123')).not.toThrow()
  })

  it('aceita configuração ausente durante o desenvolvimento inicial', () => {
    expect(() => assertBrowserPublishableKey(undefined)).not.toThrow()
  })

  it('recusa uma secret key antes de criar o cliente no navegador', () => {
    expect(() => assertBrowserPublishableKey('sb_secret_do_not_use_in_browser')).toThrow(
      /VITE_SUPABASE_PUBLISHABLE_KEY.*sb_secret_.*Use a publishable key/s,
    )
  })
})
