import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Cents } from './format'

// Mudar o dia "daqui pra frente": usa o "esta e as próximas" que o banco já tem (conta: 074; cartão: card_scheduled_from_here).
const fake = vi.hoisted(() => {
  const chamadas: unknown[][] = []
  const estado: { tabelas: Record<string, unknown[]>; rpcErro: Record<string, { code: string; message: string }> } = { tabelas: {}, rpcErro: {} }
  const supabase = {
    from: (tabela: string) => ({
      select: (colunas: string) => {
        chamadas.push(['select', tabela, colunas])
        const cadeia: Record<string, unknown> = {}
        for (const m of ['eq', 'is', 'gte', 'order', 'limit']) {
          cadeia[m] = (...a: unknown[]) => { chamadas.push([m, tabela, ...a]); return cadeia }
        }
        cadeia.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: estado.tabelas[tabela] ?? [], error: null }).then(ok)
        return cadeia
      },
    }),
    rpc: (nome: string, args: Record<string, unknown>) => {
      chamadas.push(['rpc', nome, args])
      return Promise.resolve({ data: 0, error: estado.rpcErro[nome] ?? null })
    },
  }
  return { chamadas, estado, supabase }
})
vi.mock('./supabase', () => ({ supabase: fake.supabase }))
vi.mock('./contas', async (o) => ({ ...(await o<typeof import('./contas')>()), hojeSP: () => '2026-11-13' }))

import { dataComODia, diasDoMes, listarOcorrenciasMoviveis, mudarODiaDaquiPraFrente, podeMudarODia } from './recorrenciasDia'
import type { Recorrencia } from './recorrencias'

const c = (n: number) => n as Cents
const luz: Recorrencia = {
  id: 'r1', tipo: 'expense', descricao: 'Luz', valor: c(18000), dia: 10, unidade: 'month', cada: 1, inicio: '2026-10-10', fim: null,
  contaId: 'a1', destinoId: null, cartaoId: null, categoriaId: 'g1', ativa: true,
}
const netflix: Recorrencia = {
  ...luz, id: 'r9', tipo: 'card', descricao: 'Netflix', valor: c(5590), contaId: null, cartaoId: 'k1', categoriaId: 'g2', nature: 'subscription',
}
const rpcs = () => fake.chamadas.filter((x) => x[0] === 'rpc')

beforeEach(() => {
  fake.chamadas.length = 0
  fake.estado.tabelas = {}
  fake.estado.rpcErro = {}
})

describe('ajudantes', () => {
  it('só mensal e ativo tem "dia do mês" para mudar', () => {
    expect(podeMudarODia({ unidade: 'month', ativa: true })).toBe(true)
    expect(podeMudarODia({ unidade: 'week', ativa: true })).toBe(false)
    expect(podeMudarODia({ unidade: 'day', ativa: true })).toBe(false)
    expect(podeMudarODia({ unidade: 'month', ativa: false })).toBe(false)
  })
  it('dataComODia troca só o dia; diasDoMes respeita o mês (fevereiro bissexto e comum)', () => {
    expect(dataComODia('2026-12-10', 5)).toBe('2026-12-05')
    expect(dataComODia('2026-12-10', 25)).toBe('2026-12-25')
    expect(diasDoMes('2028-02-10')).toHaveLength(29)
    expect(diasDoMes('2027-02-10')).toHaveLength(28)
    expect(diasDoMes('2026-11-10')).toHaveLength(30)
    expect(diasDoMes('2026-12-10')).toHaveLength(31)
  })
})

describe('listarOcorrenciasMoviveis', () => {
  it('conta: só planejados fora da lixeira a partir do mês atual, e só os que ainda seguem a regra', async () => {
    fake.estado.tabelas.transactions = [
      { id: 't1', date: '2026-11-10', amount: '180.00', description: 'Luz', category_id: 'g1', status: 'planned', notes: null, account_id: 'a1', destination_account_id: null },
      { id: 't2', date: '2026-12-10', amount: '210.00', description: 'Luz', category_id: 'g1', status: 'planned', notes: 'corrigi', account_id: 'a1', destination_account_id: null }, // valor corrigido à mão
      { id: 't3', date: '2027-01-10', amount: '180.00', description: 'Luz da casa', category_id: 'g1', status: 'planned', notes: null, account_id: 'a1', destination_account_id: null }, // descrição corrigida
      { id: 't4', date: '2027-02-10', amount: '180.00', description: 'Luz', category_id: 'g9', status: 'planned', notes: null, account_id: 'a1', destination_account_id: null }, // categoria corrigida
      { id: 't5', date: '2027-03-10', amount: 180, description: ' Luz ', category_id: 'g1', status: 'planned', notes: 'n', account_id: 'a1', destination_account_id: null },
    ]
    const lista = await listarOcorrenciasMoviveis(luz)
    expect(lista.map((o) => o.id)).toEqual(['t1', 't5'])
    expect(lista[1].restante).toEqual({ status: 'planned', notes: 'n', accountId: 'a1', destinationId: null })
    expect(fake.chamadas).toContainEqual(['eq', 'transactions', 'recurrence_id', 'r1'])
    expect(fake.chamadas).toContainEqual(['eq', 'transactions', 'status', 'planned'])
    expect(fake.chamadas).toContainEqual(['is', 'transactions', 'deleted_at', null])
    expect(fake.chamadas).toContainEqual(['gte', 'transactions', 'date', '2026-11-01'])
  })

  it('cartão: itens agendados não editados à mão, com a data da cobrança', async () => {
    fake.estado.tabelas.card_scheduled_items = [
      { id: 'i1', charge_date: '2026-12-20', amount: '55.90', description: 'Netflix', category_id: 'g2', edited: false },
      { id: 'i2', charge_date: '2027-01-20', amount: '59.90', description: 'Netflix', category_id: 'g2', edited: false },
    ]
    const lista = await listarOcorrenciasMoviveis(netflix)
    expect(lista).toEqual([{ id: 'i1', data: '2026-12-20' }])
    expect(fake.chamadas).toContainEqual(['eq', 'card_scheduled_items', 'status', 'scheduled'])
    expect(fake.chamadas).toContainEqual(['eq', 'card_scheduled_items', 'edited', false])
  })
})

describe('mudarODiaDaquiPraFrente', () => {
  it('conta: recurrence_update_from com a data nova e os valores da REGRA (não sobrescreve a regra com o da ocorrência)', async () => {
    const r = await mudarODiaDaquiPraFrente(luz, {
      id: 't1', data: '2026-12-10', restante: { status: 'planned', notes: 'obs', accountId: 'a1', destinationId: null },
    }, 15)
    expect(r).toEqual({ naturezaPerdida: false })
    expect(rpcs()).toEqual([['rpc', 'recurrence_update_from', {
      p_transaction: 't1', p_date: '2026-12-15', p_description: 'Luz', p_amount: '180.00', p_category: 'g1',
      p_status: 'planned', p_notes: 'obs', p_account: 'a1', p_destination: null,
    }]])
  })

  it('conta: a recusa do banco sobe como erro (nada some em silêncio)', async () => {
    fake.estado.rpcErro.recurrence_update_from = { code: '22023', message: 'a data nova precisa ficar entre as vizinhas' }
    await expect(mudarODiaDaquiPraFrente(luz, { id: 't1', data: '2026-12-10', restante: { status: 'planned', notes: null, accountId: 'a1', destinationId: null } }, 15))
      .rejects.toMatchObject({ code: '22023' })
  })

  it('cartão: card_scheduled_from_here "update" com a data nova e o valor, a descrição e a categoria da regra', async () => {
    fake.estado.tabelas.recurrences = [{ id: 'r10' }]
    const r = await mudarODiaDaquiPraFrente(netflix, { id: 'i1', data: '2026-12-20' }, 5)
    expect(r).toEqual({ naturezaPerdida: false })
    expect(rpcs()[0]).toEqual(['rpc', 'card_scheduled_from_here', {
      p_item: 'i1', p_action: 'update', p_charge_date: '2026-12-05', p_amount: '55.90', p_description: 'Netflix', p_category: 'g2',
    }])
  })

  it('cartão com natureza: a regra nova (criada pela divisão, sem natureza) recebe a natureza de volta', async () => {
    fake.estado.tabelas.recurrences = [{ id: 'r10' }]
    await mudarODiaDaquiPraFrente(netflix, { id: 'i1', data: '2026-12-20' }, 5)
    expect(fake.chamadas).toContainEqual(['eq', 'recurrences', 'start_date', '2026-12-05'])
    expect(fake.chamadas).toContainEqual(['is', 'recurrences', 'nature', null])
    expect(rpcs()[1]).toEqual(['rpc', 'recurrence_update_with_nature', {
      p_id: 'r10', p_description: 'Netflix', p_amount: '55.90', p_category: 'g2', p_person_id: null, p_is_shared_expense: false, p_nature: 'subscription',
    }])
  })

  it('cartão com natureza: se a regra nova não for achada, avisa em vez de perder a natureza em silêncio', async () => {
    fake.estado.tabelas.recurrences = []
    const r = await mudarODiaDaquiPraFrente(netflix, { id: 'i1', data: '2026-12-20' }, 5)
    expect(r).toEqual({ naturezaPerdida: true })
  })

  it('cartão com natureza: falha ao devolver a natureza também avisa (a mudança de dia já valeu)', async () => {
    fake.estado.tabelas.recurrences = [{ id: 'r10' }]
    fake.estado.rpcErro.recurrence_update_with_nature = { code: '42501', message: 'x' }
    const r = await mudarODiaDaquiPraFrente(netflix, { id: 'i1', data: '2026-12-20' }, 5)
    expect(r).toEqual({ naturezaPerdida: true })
  })

  it('cartão sem natureza: só a chamada do banco, nenhuma busca extra', async () => {
    await mudarODiaDaquiPraFrente({ ...netflix, nature: null }, { id: 'i1', data: '2026-12-20' }, 5)
    expect(rpcs()).toHaveLength(1)
    expect(fake.chamadas.some((x) => x[1] === 'recurrences')).toBe(false)
  })
})
