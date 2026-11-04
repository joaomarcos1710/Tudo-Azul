import { describe, expect, it, vi } from 'vitest'
import type { Cents } from './format'

const upsert = vi.hoisted(() => vi.fn())
vi.mock('./supabase', () => ({ supabase: { from: () => ({ upsert }), rpc: vi.fn() } }))

import { linhasDoAviso, salvarPreferenciaAviso } from './avisoDiario'
import type { ResumoDoDia } from './avisoDiario'

const c = (n: number) => n as Cents
const base: ResumoDoDia = {
  vencidos: 0, vencidosSaida: c(0), hoje: 0, hojeSaida: c(0), faturas: 0, faturasValor: c(0),
  proximaFatura: null, fimDoMes: '2026-11-30', saldoPrevisto: c(-204050),
}

describe('linhasDoAviso', () => {
  it('nada vencido nem vencendo: lista vazia (o e-mail não sai), mesmo com saldo previsto no vermelho', () => {
    expect(linhasDoAviso(base, true)).toEqual([])
    expect(linhasDoAviso(base, false)).toEqual([])
  })

  it('valores escondidos: só quantidades, nenhum R$', () => {
    const r = { ...base, vencidos: 2, vencidosSaida: c(110000), hoje: 1, hojeSaida: c(5000), faturas: 1, faturasValor: c(294067), proximaFatura: '2026-11-07' }
    const l = linhasDoAviso(r, true)
    expect(l).toEqual([
      '⚠️ 2 compromissos vencidos',
      '📅 1 compromisso para hoje',
      '💳 1 fatura vence nos próximos 3 dias, a primeira em 07/11',
      '📉 O saldo previsto para 30/11 está no vermelho',
    ])
    expect(l.join(' ')).not.toMatch(/R\$/)
  })

  it('valores à mostra: cada linha com o valor do banco', () => {
    const r = { ...base, vencidos: 1, vencidosSaida: c(18000) }
    expect(linhasDoAviso(r, false)).toEqual(['⚠️ 1 compromisso vencido (R$ 180,00)', '📉 Saldo previsto em 30/11: -R$ 2.040,50'])
  })

  it('valores escondidos e saldo previsto positivo: não menciona o saldo', () => {
    const r = { ...base, hoje: 1, saldoPrevisto: c(100) }
    expect(linhasDoAviso(r, true)).toEqual(['📅 1 compromisso para hoje'])
  })
})

describe('salvarPreferenciaAviso', () => {
  it('grava a preferência da própria pessoa (upsert por user_id)', async () => {
    upsert.mockResolvedValue({ error: null })
    await salvarPreferenciaAviso('u1', 'h1', { ligado: true, hora: 7, esconderValores: true })
    expect(upsert).toHaveBeenCalledWith({ user_id: 'u1', household_id: 'h1', enabled: true, send_hour: 7, hide_values: true }, { onConflict: 'user_id' })
  })
  it('horário fora de 5h–22h nem chega ao banco', async () => {
    upsert.mockClear()
    await expect(salvarPreferenciaAviso('u1', 'h1', { ligado: true, hora: 4, esconderValores: true })).rejects.toThrow(/entre 5h e 22h/)
    expect(upsert).not.toHaveBeenCalled()
  })
})
