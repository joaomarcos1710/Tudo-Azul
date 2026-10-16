import { supabase } from './supabase'

/** Família do usuário logado e o papel dele nela. */
export interface Familia {
  id: string
  nome: string
  papel: 'owner' | 'member'
}

export interface Membro {
  userId: string
  nome: string
  papel: 'owner' | 'member'
}

export interface ConvitePendente {
  id: string
  email: string
  expiraEm: string
}

function cliente() {
  if (!supabase) throw new Error('Supabase não configurado')
  return supabase
}

/** null quando o usuário ainda não pertence a nenhuma família (um usuário, uma família: N1). */
export async function carregarFamilia(userId: string): Promise<Familia | null> {
  const { data, error } = await cliente()
    .from('household_members')
    .select('household_id, role, households(name)')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const casa = data.households as unknown as { name: string } | null
  return { id: data.household_id, nome: casa?.name ?? '', papel: data.role }
}

export async function listarMembros(familiaId: string): Promise<Membro[]> {
  const { data, error } = await cliente()
    .from('household_members')
    .select('user_id, role, profiles(name)')
    .eq('household_id', familiaId)
    .order('joined_at')
  if (error) throw error
  return (data ?? []).map((m) => ({
    userId: m.user_id,
    nome: (m.profiles as unknown as { name: string } | null)?.name ?? '',
    papel: m.role,
  }))
}

/** Só o dono enxerga convites (policy invitations_select); para os demais a lista vem vazia. */
export async function listarConvitesPendentes(familiaId: string): Promise<ConvitePendente[]> {
  const { data, error } = await cliente()
    .from('invitations')
    // token_hash nunca é selecionado: a coluna é ilegível para o cliente
    .select('id, email, expires_at')
    .eq('household_id', familiaId)
    .is('accepted_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at')
  if (error) throw error
  return (data ?? []).map((c) => ({ id: c.id, email: c.email, expiraEm: c.expires_at }))
}

export async function criarFamilia(nome: string): Promise<void> {
  const { error } = await cliente().rpc('create_household', { p_name: nome.trim() })
  if (error) throw error
}

/** Devolve o token do convite. Ele só existe nesta resposta: o banco guarda apenas o hash. */
export async function criarConvite(email: string): Promise<string> {
  const { data, error } = await cliente().rpc('create_invitation', { p_email: email.trim() })
  if (error) throw error
  return data as string
}

export async function aceitarConvite(token: string): Promise<void> {
  const { error } = await cliente().rpc('accept_invitation', { p_token: token.trim() })
  if (error) throw error
}

/**
 * Link enviado por WhatsApp. O token vai depois do "#": essa parte não é enviada ao servidor
 * do site, então não aparece em logs de acesso nem no cabeçalho Referer.
 */
export function linkDoConvite(token: string, origem: string = window.location.origin): string {
  return `${origem}/convite#${token}`
}

/** Extrai o token de um link colado ou do próprio token. */
export function tokenDoTexto(texto: string): string {
  const t = texto.trim()
  const i = t.indexOf('#')
  return i >= 0 ? t.slice(i + 1).trim() : t
}

export { mensagemErroBanco } from './erros'
