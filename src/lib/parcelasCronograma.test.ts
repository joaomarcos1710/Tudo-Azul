import { beforeEach, describe, expect, it, vi } from 'vitest'

// Linha do tempo das parcelas (migration 20261114120000): nome e parâmetros da RPC, agrupamento por plano e conversão em centavos.
const fake = vi.hoisted(() => {
  const chamadas: unknown[][] = []
  const resposta: { data: unknown; error: unknown } = { data: [], error: null }
  return { chamadas, resposta, supabase: { rpc: (nome: string, args: unknown) => { chamadas.push([nome, args]); return Promise.resolve(resposta) } } }
})
vi.mock('./supabase', () => ({ supabase: fake.supabase }))

import { listarCronogramaParcelas } from './parcelasAtivas'

beforeEach(() => { fake.chamadas.length = 0; fake.resposta.error = null; fake.resposta.data = [] })

describe('listarCronogramaParcelas', () => {
  it('chama installment_plan_schedule com a família, agrupa por chave do plano e converte reais do banco em centavos inteiros', async () => {
    fake.resposta.data = [
      { plan_key: 'card:k1:p1', installment_number: 1, due_date: '2026-10-15', amount: '33.34', invoice_label: '2026-10', state: 'paid', in_month: false },
      { plan_key: 'card:k1:p1', installment_number: 2, due_date: '2026-11-15', amount: 33.33, invoice_label: '2026-11', state: 'open', in_month: true },
      { plan_key: 'account:g1', installment_number: 1, due_date: null, amount: '100.00', invoice_label: null, state: 'overdue', in_month: false },
    ]
    const m = await listarCronogramaParcelas('h1')
    expect(fake.chamadas).toEqual([['installment_plan_schedule', { p_household: 'h1' }]])
    expect(m.get('card:k1:p1')).toEqual([
      { numero: 1, vencimento: '2026-10-15', valor: 3334, faturaRotulo: '2026-10', estado: 'paid', noMes: false },
      { numero: 2, vencimento: '2026-11-15', valor: 3333, faturaRotulo: '2026-11', estado: 'open', noMes: true },
    ])
    expect(m.get('account:g1')).toEqual([{ numero: 1, vencimento: null, valor: 10000, faturaRotulo: null, estado: 'overdue', noMes: false }])
  })
  it('sem dados devolve mapa vazio; erro do banco sobe (a tela segue sem a linha do tempo)', async () => {
    fake.resposta.data = null
    expect((await listarCronogramaParcelas('h1')).size).toBe(0)
    fake.resposta.error = { code: 'PGRST202' }
    await expect(listarCronogramaParcelas('h1')).rejects.toMatchObject({ code: 'PGRST202' })
  })
})
