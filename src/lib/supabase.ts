import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

/** True quando as variáveis públicas do Supabase estão configuradas. */
export const supabaseConfigurado = Boolean(url && publishableKey)

/**
 * Cliente do navegador. Usa APENAS a publishable key (pública por design).
 * A proteção dos dados depende das políticas RLS no banco.
 * Nunca use uma secret key ou a service_role no navegador.
 */
export const supabase = supabaseConfigurado ? createClient(url!, publishableKey!) : null
