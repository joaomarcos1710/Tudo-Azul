import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** True quando as variáveis públicas do Supabase estão configuradas. */
export const supabaseConfigurado = Boolean(url && anonKey)

/**
 * Cliente do navegador. Usa APENAS a anon key (pública por design);
 * a proteção dos dados vem do RLS no banco. Nunca use a service_role aqui.
 */
export const supabase = supabaseConfigurado ? createClient(url!, anonKey!) : null
