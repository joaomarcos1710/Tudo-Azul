import { supabase } from './supabase'

export type TipoCategoria = 'income' | 'expense'

export interface Categoria {
  id: string
  nome: string
  tipo: TipoCategoria
  paiId: string | null
  /** "Sem categoria": criada pelo banco, não pode ser alterada nem excluída. */
  sistema: boolean
  ativa: boolean
}

/** Categoria raiz com suas subcategorias (só 1 nível, regra do banco). */
export interface GrupoCategoria extends Categoria {
  filhas: Categoria[]
}

function cliente() {
  if (!supabase) throw new Error('Supabase não configurado')
  return supabase
}

export async function listarCategorias(familiaId: string): Promise<Categoria[]> {
  const { data, error } = await cliente()
    .from('categories')
    .select('id, name, type, parent_id, system_key, active')
    .eq('household_id', familiaId)
    .order('name')
  if (error) throw error
  return (data ?? []).map((c) => ({
    id: c.id,
    nome: c.name,
    tipo: c.type,
    paiId: c.parent_id,
    sistema: c.system_key !== null,
    ativa: c.active,
  }))
}

/** Monta a árvore de um tipo: "Sem categoria" por último, demais em ordem alfabética. */
export function agrupar(categorias: Categoria[], tipo: TipoCategoria): GrupoCategoria[] {
  const doTipo = categorias.filter((c) => c.tipo === tipo)
  const raizes = doTipo.filter((c) => c.paiId === null)
  const porNome = (a: Categoria, b: Categoria) => a.nome.localeCompare(b.nome, 'pt-BR')
  return raizes
    .sort((a, b) => Number(a.sistema) - Number(b.sistema) || porNome(a, b))
    .map((r) => ({ ...r, filhas: doTipo.filter((c) => c.paiId === r.id).sort(porNome) }))
}

export async function criarCategoria(familiaId: string, d: { nome: string; tipo: TipoCategoria; paiId: string | null }): Promise<void> {
  const { error } = await cliente().from('categories').insert({
    household_id: familiaId, name: d.nome.trim(), type: d.tipo, parent_id: d.paiId,
  })
  if (error) throw error
}

/** O tipo não muda (o banco recusa); nome e categoria mãe podem mudar. */
export async function editarCategoria(id: string, d: { nome: string; paiId: string | null }): Promise<void> {
  const { error } = await cliente().from('categories').update({ name: d.nome.trim(), parent_id: d.paiId }).eq('id', id)
  if (error) throw error
}

/** Categoria com histórico é desativada, nunca apagada: some das novas escolhas, fica nos relatórios. */
export async function definirCategoriaAtiva(id: string, ativa: boolean): Promise<void> {
  const { error } = await cliente().from('categories').update({ active: ativa }).eq('id', id)
  if (error) throw error
}
