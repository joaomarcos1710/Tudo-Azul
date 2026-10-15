import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

/**
 * Evita o erro comum de colar uma secret key no cliente do navegador.
 * A publishable key é pública; chaves secret/service_role nunca são permitidas aqui.
 */
export function assertBrowserPublishableKey(key: string | undefined): void {
  if (key?.startsWith('sb_secret_')) {
    throw new Error(
      'Configuração insegura do Supabase: VITE_SUPABASE_PUBLISHABLE_KEY recebeu uma chave sb_secret_. ' +
      'Use a publishable key sb_publishable_ no navegador. Nunca exponha chaves secret/service_role.',
    )
  }
}

assertBrowserPublishableKey(publishableKey)

/** True quando as variáveis públicas do Supabase estão configuradas. */
export const supabaseConfigurado = Boolean(url && publishableKey)

/**
 * Cliente do navegador. Usa APENAS a publishable key (pública por design).
 * A proteção dos dados depende das políticas RLS no banco.
 * Nunca use uma secret key ou a service_role no navegador.
 */
export const supabase = supabaseConfigurado ? createClient(url!, publishableKey!) : null
