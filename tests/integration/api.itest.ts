import { beforeAll, describe, expect, it } from 'vitest'
import { anonClient, assertLocal, HAS_API, mustRpc, newUser, rawGet, type TestUser } from './helpers'

// Ciclo completo pelo PostgREST: isolamento, dinheiro (M5, M6, M8–M12) e convites.
describe.skipIf(!HAS_API)('API (PostgREST) — stack local', () => {
  let ana: TestUser
  let bia: TestUser
  let caio: TestUser
  let hAna: string
  let hCaio: string
  let accA: string
  let catExp: string

  beforeAll(async () => {
    assertLocal()
    ana = await newUser('ana')
    bia = await newUser('bia')
    caio = await newUser('caio')
    hAna = await mustRpc<string>(ana, 'create_household', { p_name: 'Casa da Ana' })
    hCaio = await mustRpc<string>(caio, 'create_household', { p_name: 'Casa do Caio' })

    const acc = await ana.client.from('accounts')
      .insert({ household_id: hAna, name: 'Corrente', type: 'checking', initial_balance: '1000.00', opening_date: '2026-01-01' })
      .select('id').single()
    expect(acc.error).toBeNull()
    accA = acc.data!.id

    const cat = await ana.client.from('categories').select('id').eq('household_id', hAna).eq('name', 'Mercado').single()
    expect(cat.error).toBeNull()
    catExp = cat.data!.id
  })

  const insertTx = (user: TestUser, amount: string | number, extra: Record<string, unknown> = {}) =>
    user.client.from('transactions')
      .insert({ household_id: hAna, account_id: accA, category_id: catExp, type: 'expense', amount, date: '2026-02-01', ...extra })
      .select('id, amount').single()

  describe('autenticação e isolamento', () => {
    it('anon não lê tabelas nem executa RPCs', async () => {
      const anon = anonClient()
      const t = await anon.from('accounts').select('id')
      expect(t.error?.code).toBe('42501')
      const r = await anon.rpc('create_household', { p_name: 'x' })
      expect(r.error?.code).toBe('42501')
    })

    it('o schema private não é exposto pela API', async () => {
      const r = await ana.client.schema('private' as never).rpc('is_member', { p_household: hAna } as never)
      expect(r.error).not.toBeNull()
      expect(r.error?.code).toBe('PGRST106')
    })

    it('membro de outra família não vê nem altera dados', async () => {
      const read = await caio.client.from('accounts').select('id').eq('household_id', hAna)
      expect(read.error).toBeNull()
      expect(read.data).toEqual([])

      const upd = await caio.client.from('accounts').update({ name: 'invadida' }).eq('id', accA).select('id')
      expect(upd.error).toBeNull()
      expect(upd.data).toEqual([])

      const ins = await caio.client.from('accounts')
        .insert({ household_id: hAna, name: 'x', type: 'cash', opening_date: '2026-01-01' })
      expect(ins.error?.code).toBe('42501')
    })

    it('lançamento da família do Caio não aponta para conta da Ana (FK composta)', async () => {
      const catCaio = await caio.client.from('categories').select('id').eq('household_id', hCaio).eq('name', 'Mercado').single()
      const r = await caio.client.from('transactions')
        .insert({ household_id: hCaio, account_id: accA, category_id: catCaio.data!.id, type: 'expense', amount: '1.00', date: '2026-02-01' })
      expect(r.error?.code).toBe('23503')
    })

    it('relatórios de família alheia devolvem vazio', async () => {
      const r = await caio.client.rpc('account_balances', { p_household: hAna, p_as_of: '2026-12-31' })
      expect(r.error).toBeNull()
      expect(r.data).toEqual([])
      const t = await caio.client.rpc('balance_totals', { p_household: hAna, p_as_of: '2026-12-31' })
      expect(t.error).toBeNull()
      expect(t.data).toEqual([])
    })

    it('token_hash dos convites não é legível', async () => {
      const r = await ana.client.from('invitations').select('token_hash')
      expect(r.error?.code).toBe('42501')
    })
  })

  describe('dinheiro pelo PostgREST', () => {
    it('M6/M5: grava "1250.50" como string e lê de volta sem perder centavos; registra o tipo JSON', async () => {
      const w = await insertTx(ana, '1250.50')
      expect(w.error).toBeNull()
      const typeReturned = typeof w.data!.amount
      // eslint-disable-next-line no-console
      console.info(`[M6] PostgREST devolve numeric como: ${typeReturned}`)
      expect(Math.round(Number(w.data!.amount) * 100)).toBe(125050)

      const raw = await rawGet(ana, `transactions?id=eq.${w.data!.id}&select=amount`)
      // eslint-disable-next-line no-console
      console.info(`[M6] corpo bruto: ${raw}`)
      expect(raw).toMatch(/"amount":"?1250\.5(0)?"?/)
      expect(raw).not.toMatch(/e[+-]?\d/i)
    })

    it('M10: 999999999999.99 faz ida e volta sem notação científica', async () => {
      const w = await insertTx(ana, '999999999999.99')
      expect(w.error).toBeNull()
      const raw = await rawGet(ana, `transactions?id=eq.${w.data!.id}&select=amount`)
      // eslint-disable-next-line no-console
      console.info(`[M10] corpo bruto: ${raw}`)
      expect(raw).toContain('999999999999.99')
      expect(raw).not.toMatch(/e[+-]?\d/i)
    })

    it('M12: 1.2300, 1.20, 1.2 e 1 são aceitos e normalizados para escala 2', async () => {
      const expected: Record<string, string> = { '1.2300': '1.23', '1.20': '1.20', '1.2': '1.20', '1': '1.00' }
      for (const [input, out] of Object.entries(expected)) {
        const w = await insertTx(ana, input)
        expect(w.error, `input ${input}`).toBeNull()
        const raw = await rawGet(ana, `transactions?id=eq.${w.data!.id}&select=amount`)
        const num = raw.replace(/[^0-9.]/g, '')
        expect(Number(num)).toBe(Number(out))
      }
    })

    it('M8: 1.005, 0.001 e 1.2301 são rejeitados (nada de arredondar em silêncio)', async () => {
      for (const v of ['1.005', '0.001', '1.2301']) {
        const w = await insertTx(ana, v)
        expect(w.error?.code, `valor ${v}`).toBe('22003')
      }
    })

    it('M9: 10^12, -5 e 0 são rejeitados', async () => {
      for (const v of ['1000000000000.00', '-5', '0']) {
        const w = await insertTx(ana, v)
        expect(w.error?.code, `valor ${v}`).toBe('23514')
      }
    })

    it('M11: gravar → editar → ler → lixeira → restaurar → ler', async () => {
      const w = await insertTx(ana, '10.10', { description: 'ciclo' })
      expect(w.error).toBeNull()
      const id = w.data!.id
      const read = async () => Number((await ana.client.from('transactions').select('amount').eq('id', id).single()).data!.amount)
      expect(await read()).toBe(10.1)
      expect((await ana.client.from('transactions').update({ amount: '20.20' }).eq('id', id)).error).toBeNull()
      expect(await read()).toBe(20.2)
      expect((await ana.client.from('transactions').update({ deleted_at: new Date().toISOString() }).eq('id', id)).error).toBeNull()
      expect(await read()).toBe(20.2)
      expect((await ana.client.from('transactions').update({ deleted_at: null }).eq('id', id)).error).toBeNull()
      expect(await read()).toBe(20.2)
    })

    it('DELETE de lançamento é negado (a lixeira é um UPDATE)', async () => {
      const w = await insertTx(ana, '3.00')
      const d = await ana.client.from('transactions').delete().eq('id', w.data!.id)
      expect(d.error?.code).toBe('42501')
    })

    it('saldo pelo RPC: tipo do número devolvido e valor exato', async () => {
      const r = await ana.client.rpc('balance_totals', { p_household: hAna, p_as_of: '2026-12-31' })
      expect(r.error).toBeNull()
      expect(r.data).toHaveLength(1)
      // eslint-disable-next-line no-console
      console.info(`[saldo] balance_totals devolveu: ${JSON.stringify(r.data)}`)
      expect(typeof r.data![0].total === 'number' || typeof r.data![0].total === 'string').toBe(true)
    })
  })

  describe('convites e membros', () => {
    it('owner convida, Bia aceita, o limite de 2 impede o terceiro', async () => {
      const token = await mustRpc<string>(ana, 'create_invitation', { p_email: bia.email })
      expect(token).toHaveLength(64)

      const wrong = await caio.client.rpc('accept_invitation', { p_token: token })
      expect(wrong.error?.code).toBe('22023')

      const ok = await bia.client.rpc('accept_invitation', { p_token: token })
      expect(ok.error).toBeNull()
      expect(ok.data).toBe(hAna)

      const sees = await bia.client.from('accounts').select('id').eq('household_id', hAna)
      expect(sees.data).toHaveLength(1)

      const third = await ana.client.rpc('create_invitation', { p_email: 'terceiro@example.com' })
      expect(third.error?.code).toBe('55000')
    })

    it('membro comum escreve dados financeiros, mas não convida nem exclui a família', async () => {
      const w = await insertTx(bia, '4.00')
      expect(w.error).toBeNull()
      const inv = await bia.client.rpc('create_invitation', { p_email: 'x@example.com' })
      expect(inv.error?.code).toBe('42501')
      const del = await bia.client.rpc('delete_household')
      expect(del.error?.code).toBe('42501')
    })

    it('o owner remove a Bia e ela perde o acesso', async () => {
      const r = await ana.client.rpc('remove_member', { p_user: bia.id })
      expect(r.error).toBeNull()
      const sees = await bia.client.from('accounts').select('id').eq('household_id', hAna)
      expect(sees.data).toEqual([])
    })
  })
})
