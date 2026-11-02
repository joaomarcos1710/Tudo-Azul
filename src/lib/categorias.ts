import { supabase } from './supabase'
import type { GrupoOrcamento } from './regra503020'

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
  /** Ícone escolhido pela pessoa (chave de ICONES); null/ausente = sugestão do app (ver visualCategoria). */
  icone?: string | null
  /** Cor escolhida (#RRGGBB); null/ausente = sugestão do app. */
  cor?: string | null
  /** Grupo da regra 50-30-20 (só despesa); null/ausente = sem grupo. Subcategoria sem grupo próprio herda o da principal. */
  grupo?: GrupoOrcamento | null
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
  const base = 'id, name, type, parent_id, system_key, active, color, icon'
  const ler = (colunas: string) => cliente().from('categories').select(colunas).eq('household_id', familiaId).order('name')
  // escada tolerante a migration ausente: com grupo (032) → só com eventual (012) → básico
  let { data, error } = opcoes.comEventual ? await ler(`${base}, eventual, budget_group`) : await ler(base)
  if (error && opcoes.comEventual) ({ data, error } = await ler(`${base}, eventual`))
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
    icone: (c.icon as string | null) ?? null,
    cor: (c.color as string | null) ?? null,
    grupo: (c.budget_group as GrupoOrcamento | null | undefined) ?? null,
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

/** Ícone e cor: null = usar a sugestão do app. */
export interface EscolhaVisual { icone: string | null; cor: string | null }

export async function criarCategoria(
  familiaId: string, d: { nome: string; tipo: TipoCategoria; paiId: string | null } & Partial<EscolhaVisual>,
): Promise<void> {
  const { error } = await cliente().from('categories').insert({
    household_id: familiaId, name: d.nome.trim(), type: d.tipo, parent_id: d.paiId, icon: d.icone ?? null, color: d.cor ?? null,
  })
  if (error) throw error
}

/** O tipo não muda (o banco recusa); nome, categoria mãe, ícone e cor podem mudar. */
export async function editarCategoria(id: string, d: { nome: string; paiId: string | null } & Partial<EscolhaVisual>): Promise<void> {
  const visual = d.icone === undefined && d.cor === undefined ? {} : { icon: d.icone ?? null, color: d.cor ?? null }
  const { error } = await cliente().from('categories').update({ name: d.nome.trim(), parent_id: d.paiId, ...visual }).eq('id', id)
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

/** Classifica a categoria de despesa na regra 50-30-20 (null = sem grupo). O banco recusa receita e "Sem categoria". */
export async function definirCategoriaGrupo(id: string, grupo: GrupoOrcamento | null): Promise<void> {
  const { error } = await cliente().from('categories').update({ budget_group: grupo }).eq('id', id)
  if (error) throw error
}

export interface OpcaoCategoria { id: string; rotulo: string }

/**
 * Categorias para um seletor, em ÁRVORE: cada principal (ordem alfabética, "Sem categoria" por último) seguida das suas
 * subcategorias ("↳ Nome"). A ordem alfabética solta (a do banco) deixava a subcategoria no lugar do próprio nome,
 * parecendo filha de outra. Subcategoria cuja principal não está na lista (ex.: principal desativada) aparece sozinha
 * como "Principal › Nome". `todas` serve só para achar o nome da principal.
 */
export function opcoesDeCategoria(lista: Categoria[], todas: Categoria[] = lista): OpcaoCategoria[] {
  const porId = new Map(todas.map((c) => [c.id, c]))
  const naLista = new Set(lista.map((c) => c.id))
  const porNome = (a: Categoria, b: Categoria) => a.nome.localeCompare(b.nome, 'pt-BR')
  const rotuloRaiz = (c: Categoria) => (c.paiId ? `${porId.get(c.paiId)?.nome ?? '?'} › ${c.nome}` : c.nome)
  const raizes = lista.filter((c) => !c.paiId || !naLista.has(c.paiId))
    .sort((a, b) => Number(a.sistema) - Number(b.sistema) || rotuloRaiz(a).localeCompare(rotuloRaiz(b), 'pt-BR'))
  return raizes.flatMap((r) => [
    { id: r.id, rotulo: rotuloRaiz(r) },
    ...lista.filter((c) => c.paiId === r.id).sort(porNome).map((f) => ({ id: f.id, rotulo: `↳ ${f.nome}` })),
  ])
}

/** Nome para mostrar em listas: subcategoria como "Principal › Nome"; categoria principal só o nome. */
export function nomesCompletos(categorias: Categoria[]): Map<string, string> {
  const porId = new Map(categorias.map((c) => [c.id, c]))
  return new Map(categorias.map((c) => {
    const pai = c.paiId ? porId.get(c.paiId) : undefined
    return [c.id, pai ? `${pai.nome} › ${c.nome}` : c.nome]
  }))
}
