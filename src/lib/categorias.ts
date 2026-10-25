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
  /** Receita eventual (13º, férias, PLR…): fica fora da "renda regular" do relatório. Só vale em receita. */
  eventual: boolean
}

/** Categoria raiz com suas subcategorias (só 1 nível, regra do banco). */
export interface GrupoCategoria extends Categoria {
  filhas: Categoria[]
}

function cliente() {
  if (!supabase) throw new Error('Supabase não configurado')
  return supabase
}

/**
 * `comEventual` só é pedido pela tela de Categorias. As demais telas só precisam de nome e hierarquia e não
 * devem quebrar se o front subir antes da migration 012; se a coluna não existir, lê sem ela (tudo regular).
 */
export async function listarCategorias(familiaId: string, opcoes: { comEventual?: boolean } = {}): Promise<Categoria[]> {
  const base = 'id, name, type, parent_id, system_key, active'
  const ler = (colunas: string) => cliente().from('categories').select(colunas).eq('household_id', familiaId).order('name')
  let { data, error } = opcoes.comEventual ? await ler(`${base}, eventual`) : await ler(base)
  if (error && opcoes.comEventual) ({ data, error } = await ler(base))
  if (error) throw error
  return ((data ?? []) as unknown as Record<string, unknown>[]).map((c) => ({
    id: c.id as string,
    nome: c.name as string,
    tipo: c.type as TipoCategoria,
    paiId: c.parent_id as string | null,
    sistema: c.system_key !== null,
    ativa: c.active as boolean,
    eventual: c.eventual === true,
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

/** Marca ou desmarca a categoria de receita como eventual. Subcategoria herda a marca da categoria mãe. */
export async function definirCategoriaEventual(id: string, eventual: boolean): Promise<void> {
  const { error } = await cliente().from('categories').update({ eventual }).eq('id', id)
  if (error) throw error
}
