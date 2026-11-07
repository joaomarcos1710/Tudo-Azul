import { describe, expect, it } from 'vitest'
import { smartTransactionSchema } from './smartTransaction'

const valido = {
  description: 'Pão', amount: 15, category_id: '9d6e5a82-59a6-4c0a-a8d0-8d28c64e6f31',
  date: '2026-11-07', is_credit_card: true, installments: 2,
}

describe('smartTransactionSchema', () => {
  it('aceita os campos estruturados de uma sugestão válida', () => {
    expect(smartTransactionSchema.parse(valido)).toEqual(valido)
  })
  it('recusa valores nulos, negativos ou não numéricos', () => {
    expect(smartTransactionSchema.safeParse({ ...valido, amount: -15 }).success).toBe(false)
    expect(smartTransactionSchema.safeParse({ ...valido, amount: '15' }).success).toBe(false)
  })
  it('recusa datas impossíveis e parcelas fora do intervalo', () => {
    expect(smartTransactionSchema.safeParse({ ...valido, date: '2026-02-30' }).success).toBe(false)
    expect(smartTransactionSchema.safeParse({ ...valido, installments: 73 }).success).toBe(false)
  })
  it('aceita categoria nula e parcelas nulas quando a IA não consegue inferir', () => {
    expect(smartTransactionSchema.parse({ ...valido, category_id: null, installments: null }).category_id).toBeNull()
  })
})
