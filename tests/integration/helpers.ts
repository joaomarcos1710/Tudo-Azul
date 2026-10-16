import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export const API_URL = process.env.SUPABASE_URL ?? ''
export const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY ?? ''
export const DB_URL = process.env.SUPABASE_DB_URL ?? ''
export const HAS_API = Boolean(API_URL && ANON_KEY)
export const HAS_DB = Boolean(DB_URL)

// Segurança: estes testes criam usuários e dados. Só podem apontar para o stack local.
export function assertLocal(): void {
  const host = new URL(API_URL).hostname
  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new Error(`Recusado: SUPABASE_URL (${host}) não é local. Estes testes só rodam no stack local descartável.`)
  }
}

export function anonClient(): SupabaseClient {
  return createClient(API_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
}

export type TestUser = { client: SupabaseClient; id: string; email: string; token: string }

let seq = 0
export async function newUser(label: string): Promise<TestUser> {
  const client = anonClient()
  const email = `it.${label}.${Date.now()}.${seq++}.${Math.floor(Math.random() * 1e6)}@example.com`
  const { data, error } = await client.auth.signUp({ email, password: 'Senha-de-teste-123', options: { data: { name: label } } })
  if (error) throw new Error(`signUp falhou: ${error.message}`)
  if (!data.session || !data.user) throw new Error('signUp não devolveu sessão (confirmação de e-mail ligada?)')
  return { client, id: data.user.id, email, token: data.session.access_token }
}

// Lê a resposta do PostgREST como TEXTO, sem passar pelo JSON.parse: mostra o formato exato do número.
export async function rawGet(user: TestUser, pathAndQuery: string): Promise<string> {
  const res = await fetch(`${API_URL}/rest/v1/${pathAndQuery}`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${user.token}` },
  })
  return res.text()
}

export async function mustRpc<T = unknown>(user: TestUser, fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await user.client.rpc(fn, args)
  if (error) throw new Error(`rpc ${fn} falhou: ${error.code} ${error.message}`)
  return data as T
}
