import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import pg from 'pg'
import { assertLocal, DB_URL, HAS_API, HAS_DB, mustRpc, newUser } from './helpers'

// A11: duas sessões reais, com transações abertas ao mesmo tempo. Só o banco local (SUPABASE_DB_URL
// aponta para o Postgres do stack descartável). Usa o dono do banco local para não depender de JWT:
// o que se testa aqui são os gatilhos e travas, não a RLS.
const run = HAS_API && HAS_DB

describe.skipIf(!run)('concorrência (duas sessões)', () => {
  let h = ''
  let cat = ''
  const open: pg.Client[] = []

  const session = async () => {
    const c = new pg.Client({ connectionString: DB_URL })
    await c.connect()
    open.push(c)
    return c
  }
  const code = (e: unknown) => (e as { code?: string }).code
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

  async function newAccount(name: string): Promise<string> {
    const c = await session()
    const r = await c.query(
      `insert into public.accounts (household_id, name, type, opening_date) values ($1, $2, 'checking', '2026-01-01') returning id`,
      [h, name],
    )
    return r.rows[0].id
  }

  // espera até a sessão `pid` aparecer bloqueada (aguardando lock)
  async function waitBlocked(monitor: pg.Client, pid: number) {
    for (let i = 0; i < 50; i++) {
      const r = await monitor.query(`select wait_event_type from pg_stat_activity where pid = $1`, [pid])
      if (r.rows[0]?.wait_event_type === 'Lock') return
      await sleep(100)
    }
    throw new Error('a segunda sessão não ficou bloqueada: a trava não está funcionando')
  }

  beforeAll(async () => {
    assertLocal()
    const owner = await newUser('conc')
    h = await mustRpc<string>(owner, 'create_household', { p_name: 'Concorrência' })
    const c = await session()
    const r = await c.query(`select id from public.categories where household_id = $1 and name = 'Mercado'`, [h])
    cat = r.rows[0].id
  })

  afterAll(async () => {
    for (const c of open) await c.end().catch(() => undefined)
  })

  const insertTx = (c: pg.Client, acc: string, status = 'paid') =>
    c.query(
      `insert into public.transactions (household_id, account_id, category_id, type, amount, date, status)
       values ($1, $2, $3, 'expense', 10, '2026-02-01', $4)`,
      [h, acc, cat, status],
    )

  it('desativar a conta primeiro: o INSERT concorrente espera e é recusado (nunca entra lançamento novo em conta desativada)', async () => {
    const acc = await newAccount('conc-1')
    const s1 = await session()
    const s2 = await session()
    const monitor = await session()
    const pid2 = (await s2.query('select pg_backend_pid() as pid')).rows[0].pid

    await s1.query('begin')
    await s1.query(`update public.accounts set active = false where id = $1`, [acc])
    await s2.query('begin')
    let err: unknown = null
    const pending = insertTx(s2, acc).catch((e) => { err = e })
    await waitBlocked(monitor, pid2)
    await s1.query('commit')
    await pending
    await s2.query('rollback')

    expect(code(err)).toBe('23514')
    const n = await monitor.query(`select count(*)::int as n from public.transactions where account_id = $1`, [acc])
    expect(n.rows[0].n).toBe(0)
  })

  it('INSERT primeiro: a desativação concorrente espera e termina com o lançamento já gravado', async () => {
    const acc = await newAccount('conc-2')
    const s1 = await session()
    const s2 = await session()
    const monitor = await session()
    const pid2 = (await s2.query('select pg_backend_pid() as pid')).rows[0].pid

    await s1.query('begin')
    await insertTx(s1, acc)
    await s2.query('begin')
    let err: unknown = null
    const pending = s2.query(`update public.accounts set active = false where id = $1`, [acc]).catch((e) => { err = e })
    await waitBlocked(monitor, pid2)
    await s1.query('commit')
    await pending
    await s2.query('commit')

    expect(err).toBeNull()
    const n = await monitor.query(`select count(*)::int as n from public.transactions where account_id = $1`, [acc])
    expect(n.rows[0].n).toBe(1) // o lançamento foi gravado enquanto a conta ainda estava ativa; a ordem foi serializada
  })

  it('INSERT de lançamento PLANEJADO primeiro: a desativação concorrente é recusada (planejado em aberto)', async () => {
    const acc = await newAccount('conc-3')
    const s1 = await session()
    const s2 = await session()
    const monitor = await session()
    const pid2 = (await s2.query('select pg_backend_pid() as pid')).rows[0].pid

    await s1.query('begin')
    await insertTx(s1, acc, 'planned')
    await s2.query('begin')
    let err: unknown = null
    const pending = s2.query(`update public.accounts set active = false where id = $1`, [acc]).catch((e) => { err = e })
    await waitBlocked(monitor, pid2)
    await s1.query('commit')
    await pending
    await s2.query('rollback')

    expect(code(err)).toBe('23514')
    const a = await monitor.query(`select active from public.accounts where id = $1`, [acc])
    expect(a.rows[0].active).toBe(true)
  })

  it('mudar a abertura da conta enquanto uma transferência é inserida: nunca sobra transferência anterior à abertura', async () => {
    const accA = await newAccount('conc-4a')
    const accB = await newAccount('conc-4b')
    const s1 = await session()
    const s2 = await session()
    const monitor = await session()
    const pid2 = (await s2.query('select pg_backend_pid() as pid')).rows[0].pid

    await s1.query('begin')
    await s1.query(`update public.accounts set opening_date = '2026-06-01' where id = $1`, [accB])
    await s2.query('begin')
    let err: unknown = null
    const pending = s2.query(
      `insert into public.transactions (household_id, account_id, destination_account_id, type, amount, date)
       values ($1, $2, $3, 'transfer', 10, '2026-03-01')`,
      [h, accA, accB],
    ).catch((e) => { err = e })
    await waitBlocked(monitor, pid2)
    await s1.query('commit')
    await pending
    await s2.query('rollback')

    expect(code(err)).toBe('23514')
    const bad = await monitor.query(
      `select count(*)::int as n from public.transactions t join public.accounts a on a.id in (t.account_id, t.destination_account_id)
        where t.household_id = $1 and t.type = 'transfer' and t.deleted_at is null and t.date < a.opening_date`, [h])
    expect(bad.rows[0].n).toBe(0)
  })
})
