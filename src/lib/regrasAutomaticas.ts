import { supabase } from './supabase'
import type { TipoLancamento } from './lancamentos'

export type TipoRegraAutomatica = Extract<TipoLancamento, 'income' | 'expense'>

export interface RegraAutomatica {
  id: string
  nome: string
  trechoDescricao: string
  tipo: TipoRegraAutomatica
  categoriaId: string
  ativa: boolean
  prioridade: number
}

export type DadosRegraAutomatica = Omit<RegraAutomatica, 'id'>

export interface SugestaoRegra {
  regraId: string
  nomeRegra: string
  categoriaId: string
  trechoCorrespondente: string
}

function cliente() {
  if (!supabase) throw new Error('Supabase não configurado')
  return supabase
}

function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ').trim()
}

export function sugerirRegras(
  descricao: string,
  tipo: TipoLancamento,
  regras: readonly RegraAutomatica[],
): SugestaoRegra[] {
  const texto = normalizar(descricao)
  if (!texto || tipo === 'transfer') return []
  return regras
    .filter((r) => r.ativa && r.tipo === tipo && normalizar(r.trechoDescricao).length > 0)
    .filter((r) => texto.includes(normalizar(r.trechoDescricao)))
    .sort((a, b) => b.prioridade - a.prioridade
      || normalizar(b.trechoDescricao).length - normalizar(a.trechoDescricao).length
      || a.id.localeCompare(b.id))
    .map((r) => ({
      regraId: r.id, nomeRegra: r.nome, categoriaId: r.categoriaId,
      trechoCorrespondente: r.trechoDescricao.trim(),
    }))
}

export async function listarRegrasAutomaticas(familiaId: string): Promise<RegraAutomatica[]> {
  const { data, error } = await cliente().from('transaction_rules')
    .select('id, name, description_contains, type, category_id, active, priority')
    .eq('household_id', familiaId)
    .order('active', { ascending: false }).order('priority', { ascending: false }).order('name')
  if (error) throw error
  return (data ?? []).map((r) => ({
    id: r.id, nome: r.name, trechoDescricao: r.description_contains, tipo: r.type,
    categoriaId: r.category_id, ativa: r.active, prioridade: r.priority,
  }))
}

export async function criarRegraAutomatica(familiaId: string, d: DadosRegraAutomatica): Promise<void> {
  const { error } = await cliente().from('transaction_rules').insert({
    household_id: familiaId, name: d.nome.trim(), description_contains: d.trechoDescricao.trim(),
    type: d.tipo, category_id: d.categoriaId, active: d.ativa, priority: d.prioridade,
  })
  if (error) throw error
}

export async function atualizarRegraAutomatica(id: string, d: DadosRegraAutomatica): Promise<void> {
  const { error } = await cliente().from('transaction_rules').update({
    name: d.nome.trim(), description_contains: d.trechoDescricao.trim(),
    type: d.tipo, category_id: d.categoriaId, active: d.ativa, priority: d.prioridade,
  }).eq('id', id)
  if (error) throw error
}

export async function excluirRegraAutomatica(id: string): Promise<void> {
  const { error } = await cliente().from('transaction_rules').delete().eq('id', id)
  if (error) throw error
}
