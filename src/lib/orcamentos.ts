import { centsFromDb, centsToDecimal } from './format'
import type { Cents } from './format'
import { supabase } from './supabase'

/**
 * Orçamento mensal por categoria principal (tabela budgets, migration 001) e a projeção até o fim do mês
 * (budget_projection, migration 013). Toda conta de dinheiro fica no banco; aqui só se lê e se grava o limite.
 */
export interface OrcamentoMes {
  categoriaId: string
  nome: string
  limite: Cents
  /** Gasto pago no mês, com cartão e subcategorias (mesma fonte de budget_usage). */
  gasto: Cents
  /** Já previsto até o fim do mês (planejado e parcelas de cartão que ainda vão fechar). null sem projeção. */
  previsto: Cents | null
  /** Parte do previsto que é compra de cartão já lançada em fatura que ainda não fechou (budget_projection.planned_card,
   * migration 101). Fatura fechada já está no gasto. null quando o banco ainda não devolve a coluna; nunca se sobrepõe ao gasto. */
  cartaoLancado: Cents | null
  /** Ritmo do variável × dias que faltam. null sem projeção. */
  ritmo: Cents | null
  /** Gasto + previsto + ritmo. null sem projeção. */
  projetado: Cents | null
  /** Limite − projetado (negativo = vai estourar). null sem projeção. */
  sobra: Cents | null
  /** Limite − gasto, calculado no banco (budget_usage.remaining); negativo = já passou do limite. */
  restante: Cents
}

function cliente() {
  if (!supabase) throw new Error('Supabase não configurado')
  return supabase
}

type Linha = Record<string, string | number | null>

/** Função ainda não existe no banco (migration 013 não aplicada): só nesse caso a leitura cai para budget_usage. */
function funcaoInexistente(err: { code?: string; message?: string }): boolean {
  return err.code === 'PGRST202' || err.code === '42883' || /does not exist|could not find the function/i.test(err.message ?? '')
}

/** Dia em que o mês da pessoa começa (Preferências, 1 a 28). 1 quando nunca escolheu; erro de leitura sobe para quem chama. */
export async function lerDiaInicioDoMes(userId: string): Promise<number> {
  const { data, error } = await cliente().from('user_preferences').select('month_start_day').eq('user_id', userId).maybeSingle()
  if (error) throw error
  const dia = Number(data?.month_start_day ?? 1)
  return Number.isInteger(dia) && dia >= 1 && dia <= 28 ? dia : 1
}

/**
 * Orçamentos do ciclo com a projeção. `mes` é a chave do ciclo (o mês em que ele começa) e `dia` o dia em que o mês começa
 * (migration 144); sem `dia` é o mês de calendário, como o Início. Se a projeção ainda não existir no banco (migration 013),
 * lê só o gasto.
 */
export async function listarOrcamentos(familiaId: string, mes: string, hoje: string, dia?: number): Promise<OrcamentoMes[]> {
  const db = cliente()
  const primeiro = `${mes}-01`
  // dia 1 (ou sem dia) não manda p_dia: a tela continua funcionando contra o banco que ainda não tem a migration 144
  const comDia = dia !== undefined && dia > 1 ? { p_dia: dia } : {}
  const [proj, usoJunto] = await Promise.all([
    db.rpc('budget_projection', { p_household: familiaId, p_month: primeiro, p_today: hoje, ...comDia }),
    db.rpc('budget_usage', { p_household: familiaId, p_month: primeiro, ...comDia }),
  ])
  if (!proj.error) {
    if (usoJunto.error) throw usoJunto.error
    const restantePor = new Map(((usoJunto.data ?? []) as Linha[]).map((r) => [r.category_id as string, centsFromDb(r.remaining ?? 0)]))
    return ((proj.data ?? []) as Linha[]).map((r) => ({
      categoriaId: r.category_id as string,
      nome: r.category_name as string,
      limite: centsFromDb(r.amount_limit ?? 0),
      gasto: centsFromDb(r.spent ?? 0),
      previsto: centsFromDb(r.planned ?? 0),
      cartaoLancado: r.planned_card === undefined || r.planned_card === null ? null : centsFromDb(r.planned_card as string | number),
      ritmo: centsFromDb(r.pace_extra ?? 0),
      projetado: centsFromDb(r.projected ?? 0),
      sobra: centsFromDb(r.remaining ?? 0),
      restante: restantePor.get(r.category_id as string) ?? (0 as Cents),
    }))
  }
  if (!funcaoInexistente(proj.error)) throw proj.error
  const uso = usoJunto
  if (uso.error) throw uso.error
  return ((uso.data ?? []) as Linha[]).map((r) => ({
    categoriaId: r.category_id as string,
    nome: r.category_name as string,
    limite: centsFromDb(r.amount_limit ?? 0),
    gasto: centsFromDb(r.spent ?? 0),
    previsto: null, cartaoLancado: null, ritmo: null, projetado: null, sobra: null,
    restante: centsFromDb(r.remaining ?? 0),
  }))
}

/** Define ou muda o limite do mês para a categoria (o banco só aceita categoria principal e 2 casas decimais). */
export async function definirOrcamento(familiaId: string, categoriaId: string, mes: string, limite: Cents): Promise<void> {
  const db = cliente()
  const primeiro = `${mes}-01`
  const atual = await db.from('budgets').update({ amount_limit: centsToDecimal(limite) })
    .eq('household_id', familiaId).eq('category_id', categoriaId).eq('month', primeiro).select('id')
  if (atual.error) throw atual.error
  if ((atual.data ?? []).length > 0) return
  const { error } = await db.from('budgets').insert({
    household_id: familiaId, category_id: categoriaId, month: primeiro, amount_limit: centsToDecimal(limite),
  })
  if (!error) return
  if (error.code !== '23505') throw error
  // outra aba criou o mesmo limite no meio do caminho: atualiza em vez de acusar "já existe"
  const retry = await db.from('budgets').update({ amount_limit: centsToDecimal(limite) })
    .eq('household_id', familiaId).eq('category_id', categoriaId).eq('month', primeiro)
  if (retry.error) throw retry.error
}

export async function removerOrcamento(familiaId: string, categoriaId: string, mes: string): Promise<void> {
  const { error } = await cliente().from('budgets').delete()
    .eq('household_id', familiaId).eq('category_id', categoriaId).eq('month', `${mes}-01`)
  if (error) throw error
}

/** Copia os limites do mês anterior para as categorias que ainda não têm limite neste mês. Devolve quantos copiou. */
export async function copiarDoMesAnterior(familiaId: string, mes: string, mesAnterior: string): Promise<number> {
  const db = cliente()
  const [de, ate] = await Promise.all([
    db.from('budgets').select('category_id, amount_limit').eq('household_id', familiaId).eq('month', `${mesAnterior}-01`),
    db.from('budgets').select('category_id').eq('household_id', familiaId).eq('month', `${mes}-01`),
  ])
  for (const r of [de, ate]) if (r.error) throw r.error
  const jaTem = new Set((ate.data ?? []).map((b) => b.category_id as string))
  const novos = (de.data ?? []).filter((b) => !jaTem.has(b.category_id as string))
  if (novos.length === 0) return 0
  const { error } = await db.from('budgets').insert(
    novos.map((b) => ({ household_id: familiaId, category_id: b.category_id, month: `${mes}-01`, amount_limit: b.amount_limit })),
  )
  if (error) throw error
  return novos.length
}
