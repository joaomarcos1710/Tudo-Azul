import { supabase } from './supabase'

export const VINCULOS_PESSOA = [
  'Conhecido', 'Familiar', 'Companheiro(a)', 'Pai/Mãe',
  'Filho(a)', 'Irmão/Irmã', 'Pet', 'Amigo(a)',
] as const

export type VinculoPessoa = typeof VINCULOS_PESSOA[number]

export interface PessoaFamilia {
  id: string
  familiaId: string
  nome: string
  fotoUrl: string | null
  nascimento: string | null
  vinculo: VinculoPessoa
  ativo: boolean
  criadaEm: string
  atualizadaEm: string
}

export interface DadosPessoaFamilia {
  nome: string
  nascimento: string | null
  vinculo: VinculoPessoa
  fotoUrl: string | null
}

interface LinhaPessoa {
  id: string
  household_id: string
  name: string
  photo_url: string | null
  birthdate: string | null
  relationship: VinculoPessoa
  status: boolean
  created_at: string
  updated_at: string
}

const COLUNAS = 'id, household_id, name, photo_url, birthdate, relationship, status, created_at, updated_at'

function cliente() {
  if (!supabase) throw new Error('Supabase não configurado')
  return supabase
}

function mapear(p: LinhaPessoa): PessoaFamilia {
  return {
    id: p.id, familiaId: p.household_id, nome: p.name, fotoUrl: p.photo_url,
    nascimento: p.birthdate, vinculo: p.relationship, ativo: p.status,
    criadaEm: p.created_at, atualizadaEm: p.updated_at,
  }
}

/** Lista somente pessoas da família solicitada. A RLS repete a proteção no banco. */
export async function listarPessoasFamilia(familiaId: string): Promise<PessoaFamilia[]> {
  const { data, error } = await cliente().from('household_people').select(COLUNAS)
    .eq('household_id', familiaId).order('name')
  if (error) throw error
  return ((data ?? []) as unknown as LinhaPessoa[]).map(mapear)
}

/** Cria uma pessoa descritiva; não cria perfil, login, e-mail, senha ou convite. */
export async function criarPessoaFamilia(familiaId: string, dados: DadosPessoaFamilia): Promise<PessoaFamilia> {
  const { data, error } = await cliente().from('household_people').insert({
    household_id: familiaId, name: dados.nome.trim(), photo_url: dados.fotoUrl,
    birthdate: dados.nascimento || null, relationship: dados.vinculo,
  }).select(COLUNAS).single()
  if (error) throw error
  return mapear(data as unknown as LinhaPessoa)
}

/** Atualiza apenas dados descritivos; household_id e status não são alterados aqui. */
export async function atualizarPessoaFamilia(familiaId: string, pessoaId: string, dados: DadosPessoaFamilia): Promise<void> {
  const { error } = await cliente().from('household_people').update({
    name: dados.nome.trim(), photo_url: dados.fotoUrl,
    birthdate: dados.nascimento || null, relationship: dados.vinculo,
  }).eq('household_id', familiaId).eq('id', pessoaId)
  if (error) throw error
}

/** Inativa ou reativa sem apagar a pessoa nem o histórico que poderá ser associado a ela. */
export async function definirStatusPessoaFamilia(familiaId: string, pessoaId: string, ativo: boolean): Promise<void> {
  const { error } = await cliente().from('household_people').update({ status: ativo })
    .eq('household_id', familiaId).eq('id', pessoaId)
  if (error) throw error
}
