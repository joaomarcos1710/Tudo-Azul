import { supabase } from './supabase'

/**
 * Etiquetas livres nas contas (migration 072, decisão do dono de 06/11/2026). Os 7 tipos de conta continuam fixos
 * (os cálculos dependem deles); a etiqueta é só organização da família ("Reserva de emergência", "Conjunta", "PJ").
 * Etiqueta NÃO entra em nenhum cálculo de dinheiro nem em relatório.
 */
export interface Etiqueta {
  id: string
  nome: string
}

/** Limites do banco (trigger da 072): a tela avisa antes, o banco recusa de qualquer jeito. */
export const MAX_NOME_ETIQUETA = 30
export const MAX_ETIQUETAS_FAMILIA = 50
export const MAX_ETIQUETAS_CONTA = 10

export interface EtiquetasDaFamilia {
  /** false = o banco ainda não tem a migration 072 (o front sobe antes): a tela esconde as etiquetas. */
  disponivel: boolean
  etiquetas: Etiqueta[]
  /** id da conta -> ids das etiquetas marcadas nela. */
  porConta: Map<string, string[]>
}

function cliente() {
  if (!supabase) throw new Error('Supabase não configurado')
  return supabase
}

/** Tabela ou função ainda não aplicada no banco. */
const SEM_MIGRATION = ['PGRST205', '42P01', 'PGRST202', '42883']

/** Nome como o banco guarda: sem espaço nas pontas nem espaço repetido no meio. */
export function nomeEtiqueta(nome: string): string {
  return nome.trim().replace(/\s+/g, ' ')
}

/** Mensagem de validação do nome (null = ok). Mesmas regras do banco: 1 a 30 caracteres, único sem olhar maiúscula. */
export function erroNomeEtiqueta(nome: string, existentes: Etiqueta[], ignorarId?: string): string | null {
  const n = nomeEtiqueta(nome)
  if (!n) return 'Informe o nome da etiqueta.'
  if (n.length > MAX_NOME_ETIQUETA) return `Use até ${MAX_NOME_ETIQUETA} caracteres.`
  const igual = existentes.find((e) => e.id !== ignorarId && e.nome.toLocaleLowerCase('pt-BR') === n.toLocaleLowerCase('pt-BR'))
  return igual ? `Já existe a etiqueta "${igual.nome}".` : null
}

export async function listarEtiquetas(familiaId: string): Promise<EtiquetasDaFamilia> {
  const db = cliente()
  const [tags, links] = await Promise.all([
    db.from('account_tags').select('id, name').eq('household_id', familiaId).order('name'),
    db.from('account_tag_links').select('account_id, tag_id').eq('household_id', familiaId),
  ])
  for (const r of [tags, links]) {
    if (r.error) {
      if (SEM_MIGRATION.includes(r.error.code ?? '')) return { disponivel: false, etiquetas: [], porConta: new Map() }
      throw r.error
    }
  }
  const etiquetas = ((tags.data ?? []) as { id: string; name: string }[])
    .map((t) => ({ id: t.id, nome: t.name }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
  const porConta = new Map<string, string[]>()
  for (const l of (links.data ?? []) as { account_id: string; tag_id: string }[]) {
    porConta.set(l.account_id, [...(porConta.get(l.account_id) ?? []), l.tag_id])
  }
  return { disponivel: true, etiquetas, porConta }
}

/** Cria e devolve a etiqueta (para já marcar na conta que está sendo editada). */
export async function criarEtiqueta(familiaId: string, nome: string): Promise<Etiqueta> {
  const { data, error } = await cliente().from('account_tags')
    .insert({ household_id: familiaId, name: nomeEtiqueta(nome) }).select('id, name').single()
  if (error) throw error
  const t = data as { id: string; name: string }
  return { id: t.id, nome: t.name }
}

export async function renomearEtiqueta(id: string, nome: string): Promise<void> {
  const { error } = await cliente().from('account_tags').update({ name: nomeEtiqueta(nome) }).eq('id', id)
  if (error) throw error
}

/** Apaga a etiqueta: ela sai de todas as contas (cascade). As contas e o dinheiro não mudam. */
export async function apagarEtiqueta(id: string): Promise<void> {
  const { error } = await cliente().from('account_tags').delete().eq('id', id)
  if (error) throw error
}

/** Troca as etiquetas de uma conta pelas da lista, numa transação só (account_tags_set). Lista vazia = sem etiqueta. */
export async function definirEtiquetasDaConta(contaId: string, etiquetaIds: string[]): Promise<void> {
  const { error } = await cliente().rpc('account_tags_set', { p_account: contaId, p_tags: [...new Set(etiquetaIds)] })
  if (error) throw error
}

/** Mesmo conjunto de etiquetas (ordem não importa): evita gravar quando nada mudou. */
export function mesmasEtiquetas(a: readonly string[], b: readonly string[]): boolean {
  const sa = new Set(a)
  const sb = new Set(b)
  return sa.size === sb.size && [...sa].every((x) => sb.has(x))
}
