import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Cents } from './format'

// Natureza da recorrência (migration 20261112120000): leitura com fallback de banco sem a coluna e escolha da RPC certa.
const fake = vi.hoisted(() => {
  const chamadas: unknown[][] = []
  const estado: { colunasAceitas: (c: string) => boolean; rpcErro: Record<string, { code: string }> } = {
    colunasAceitas: () => true, rpcErro: {},
  }
  const linha = {
    id: 'r1', kind: 'expense', description: 'Aluguel', amount: '1500.00', day: 5, freq_unit: 'month', freq_every: 1,
    start_date: '2026-11-01', end_date: null, account_id: 'a1', destination_account_id: null, debt_id: null,
    category_id: 'g1', active: true, person_id: null, is_shared_expense: false, nature: 'fixed',
  }
  const supabase = {
    from: () => ({
      select: (colunas: string) => {
        chamadas.push(['select', colunas])
        const resposta = estado.colunasAceitas(colunas)
          ? { data: [colunas.includes('nature') ? linha : { ...linha, nature: undefined }], error: null }
          : { data: null, error: { code: '42703', message: 'column does not exist' } }
        const cadeia: Record<string, unknown> = {}
        for (const m of ['eq', 'order']) cadeia[m] = () => cadeia
        cadeia.then = (ok: (v: unknown) => unknown) => Promise.resolve(resposta).then(ok)
        return cadeia
      },
    }),
    rpc: (nome: string, args: Record<string, unknown>) => {
      chamadas.push(['rpc', nome, args])
      return Promise.resolve({ data: null, error: estado.rpcErro[nome] ?? null })
    },
  }
  return { chamadas, estado, supabase }
})
vi.mock('./supabase', () => ({ supabase: fake.supabase }))

import { criarRecorrencia, editarRecorrencia, listarRecorrencias, naturezasDoTipo, rotuloNatureza } from './recorrencias'
import type { DadosRecorrencia } from './recorrencias'

const c = (n: number) => n as Cents
const dados: DadosRecorrencia = {
  tipo: 'expense', descricao: 'Aluguel', valor: c(150000), dia: 5, unidade: 'month', cada: 1, inicio: '2026-11-01', fim: null,
  contaId: 'a1', destinoId: null, cartaoId: null, categoriaId: 'g1',
}
const rpcs = () => fake.chamadas.filter((x) => x[0] === 'rpc').map((x) => x[1])

beforeEach(() => {
  fake.chamadas.length = 0
  fake.estado.colunasAceitas = () => true
  fake.estado.rpcErro = {}
})

describe('naturezasDoTipo (espelha o check do banco)', () => {
  it('receita só ressarcimento; despesa e cartão as três outras; transferência nenhuma', () => {
    expect(naturezasDoTipo('income')).toEqual(['reimbursement'])
    expect(naturezasDoTipo('expense')).toEqual(['fixed', 'subscription', 'variable'])
    expect(naturezasDoTipo('card')).toEqual(['fixed', 'subscription', 'variable'])
    expect(naturezasDoTipo('transfer')).toEqual([])
  })
  it('todo valor tem rótulo', () => {
    expect(Object.keys(rotuloNatureza).sort()).toEqual(['fixed', 'reimbursement', 'subscription', 'variable'])
  })
})

describe('listarRecorrencias: natureza', () => {
  it('pede a coluna nature e a devolve', async () => {
    const lista = await listarRecorrencias('h1')
    expect(fake.chamadas[0][1]).toContain('nature')
    expect(lista[0].nature).toBe('fixed')
  })
  it('banco ainda sem a coluna: cai para a leitura sem ela e a natureza vem null', async () => {
    fake.estado.colunasAceitas = (col) => !col.includes('nature')
    const lista = await listarRecorrencias('h1')
    expect(lista).toHaveLength(1)
    expect(lista[0].nature).toBeNull()
    expect(fake.chamadas.map((x) => x[1] as string).some((col) => col.includes('person_id') && !col.includes('nature'))).toBe(true)
  })
  it('banco sem natureza nem pessoa: lê o mais antigo', async () => {
    fake.estado.colunasAceitas = (col) => !col.includes('nature') && !col.includes('person_id')
    const lista = await listarRecorrencias('h1')
    expect(lista[0].nature).toBeNull()
    expect(lista[0].personId).toBeNull()
  })
})

describe('criarRecorrencia: natureza', () => {
  it('com natureza usa a função atômica própria, com p_nature', async () => {
    await criarRecorrencia({ ...dados, nature: 'fixed' })
    expect(rpcs()[0]).toBe('recurrence_create_with_nature')
    expect(fake.chamadas.find((x) => x[1] === 'recurrence_create_with_nature')![2]).toMatchObject({ p_nature: 'fixed', p_kind: 'expense', p_amount: '1500.00' })
  })
  it('sem natureza segue o caminho de sempre (funciona também em banco sem a migration)', async () => {
    await criarRecorrencia({ ...dados, nature: null })
    expect(rpcs()[0]).toBe('recurrence_create_classified')
    expect(rpcs()).not.toContain('recurrence_create_with_nature')
  })
  it('banco sem a função e com natureza escolhida: o erro aparece, a escolha não é descartada em silêncio', async () => {
    fake.estado.rpcErro.recurrence_create_with_nature = { code: 'PGRST202' }
    await expect(criarRecorrencia({ ...dados, nature: 'variable' })).rejects.toMatchObject({ code: 'PGRST202' })
    expect(rpcs()).not.toContain('recurrence_create')
  })
})

describe('editarRecorrencia: natureza', () => {
  const base = { descricao: 'Aluguel', valor: c(150000), categoriaId: 'g1' }
  it('nature ausente: não mexe (caminho de sempre)', async () => {
    await editarRecorrencia('r1', base)
    expect(rpcs()).toEqual(['recurrence_update_classified'])
  })
  it('nature com valor: função atômica própria', async () => {
    await editarRecorrencia('r1', { ...base, nature: 'subscription' })
    expect(rpcs()).toEqual(['recurrence_update_with_nature'])
    expect(fake.chamadas[0][2]).toMatchObject({ p_id: 'r1', p_nature: 'subscription', p_amount: '1500.00' })
  })
  it('nature null: limpa a classificação (manda p_nature nulo, não omite)', async () => {
    await editarRecorrencia('r1', { ...base, nature: null })
    expect(rpcs()).toEqual(['recurrence_update_with_nature'])
    expect(fake.chamadas[0][2]).toHaveProperty('p_nature', null)
  })
  it('banco sem a função e com natureza escolhida: o erro aparece', async () => {
    fake.estado.rpcErro.recurrence_update_with_nature = { code: '42883' }
    await expect(editarRecorrencia('r1', { ...base, nature: 'fixed' })).rejects.toMatchObject({ code: '42883' })
  })
})
