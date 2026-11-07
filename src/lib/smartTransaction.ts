import { z } from 'zod'

function dataIsoValida(valor: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false
  const data = new Date(`${valor}T00:00:00.000Z`)
  return Number.isFinite(data.getTime()) && data.toISOString().slice(0, 10) === valor
}

/** Contrato estrito dos dados sugeridos pela IA. Valores monetários são reais (não centavos). */
export const smartTransactionSchema = z.object({
  description: z.string().trim().min(1).max(200),
  amount: z.number().finite().positive().max(999_999_999_999.99),
  category_id: z.string().uuid().nullable(),
  date: z.string().refine(dataIsoValida, 'Data inválida. Use AAAA-MM-DD.'),
  is_credit_card: z.boolean(),
  installments: z.number().int().min(1).max(72).nullable(),
})

export type SmartTransactionPrefill = z.infer<typeof smartTransactionSchema>
