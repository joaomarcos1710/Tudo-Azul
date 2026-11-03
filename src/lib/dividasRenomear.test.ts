import { beforeEach, describe, expect, it, vi } from 'vitest'

const fake = vi.hoisted(() => {
  const estado = { rpcs: [] as { nome: string; args: Record<string, unknown> }[], resposta: { data: null as unknown, error: null as unknown } }
  return { estado, supabase: { rpc: (nome: string, args: Record<string, unknown>) => { estado.rpcs.push({ nome, args }); return Promise.resolve(estado.resposta) } } }
})
vi.mock('./supabase', () => ({ supabase: fake.supabase }))

import { renomearDivida } from './dividas'

beforeEach(() => {
  fake.estado.rpcs = []
  fake.estado.resposta = { data: null, error: null }
})

describe('renomearDivida', () => {
  it('chama debt_rename com o nome aparado', async () => {
    await renomearDivida('d1', '  Financiamento do imóvel ')
    expect(fake.estado.rpcs).toEqual([{ nome: 'debt_rename', args: { p_id: 'd1', p_name: 'Financiamento do imóvel' } }])
  })

  it('erro do banco sobe', async () => {
    fake.estado.resposta = { data: null, error: { message: 'nome inválido' } }
    await expect(renomearDivida('d1', 'x')).rejects.toMatchObject({ message: 'nome inválido' })
  })
})
