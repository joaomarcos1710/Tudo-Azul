import { centsFromDb, centsToDecimal } from './format'
import type { Cents } from './format'
import { supabase } from './supabase'

export type MoedaInvestimento = 'BRL' | 'USD' | 'EUR'
export type ClasseAtivo = 'fixed_income' | 'equity' | 'fund' | 'reit' | 'etf' | 'crypto' | 'other'
export type TipoOperacaoInvestimento = 'buy' | 'sell'

export interface AtivoInvestimento {
  id: string
  nome: string
  ticker: string | null
  classe: ClasseAtivo
  moeda: MoedaInvestimento
  ativo: boolean
}
export interface PosicaoInvestimento {
  assetId: string
  nome: string
  ticker: string | null
  classe: ClasseAtivo
  moeda: MoedaInvestimento
  quantidade: string
  custoMedio: string
  custoTotal: Cents
  precoAtual: string
  valorAtual: Cents
  resultado: Cents
  dataAvaliacao: string | null
  fonteAvaliacao: string | null
}
export interface TotalInvestimento {
  moeda: MoedaInvestimento
  custoTotal: Cents
  valorAtual: Cents
  resultado: Cents
}

function db() {
  if (!supabase) throw new Error('Supabase não configurado')
  return supabase
}

function textoDecimal(valor: string, casas: number): string {
  const t = valor.trim().replace(',', '.')
  const re = new RegExp('^\\\\d{1,12}(?:\\\\.\\\\d{1,' + casas + '})?
  if (!re.test(t) || Number(t) <= 0 || !Number.isFinite(Number(t))) {
    throw new Error('Informe um número positivo com até ' + casas + ' casas decimais.')
  }
  return t
}

export async function listarAtivosInvestimento(familiaId: string): Promise<AtivoInvestimento[]> {
  const { data, error } = await db().from('investment_assets')
    .select('id,name,ticker,asset_class,currency_code,active')
    .eq('household_id', familiaId).order('name')
  if (error) throw error
  return (data ?? []).map((r) => ({
    id: r.id, nome: r.name, ticker: r.ticker, classe: r.asset_class as ClasseAtivo,
    moeda: r.currency_code as MoedaInvestimento, ativo: r.active,
  }))
}

export async function listarCarteiraInvestimentos(familiaId: string, dataRef: string): Promise<{
  posicoes: PosicaoInvestimento[]; totais: TotalInvestimento[]
}> {
  const [posicoes, totais] = await Promise.all([
    db().rpc('investment_portfolio', { p_household: familiaId, p_as_of: dataRef }),
    db().rpc('investment_totals', { p_household: familiaId, p_as_of: dataRef }),
  ])
  if (posicoes.error) throw posicoes.error
  if (totais.error) throw totais.error
  return {
    posicoes: ((posicoes.data ?? []) as Record<string, unknown>[]).map((r) => ({
      assetId: r.asset_id as string, nome: r.name as string, ticker: r.ticker as string | null,
      classe: r.asset_class as ClasseAtivo, moeda: r.currency_code as MoedaInvestimento,
      quantidade: String(r.quantity), custoMedio: String(r.average_cost),
      custoTotal: centsFromDb(r.cost_basis as string | number),
      precoAtual: String(r.unit_price), valorAtual: centsFromDb(r.market_value as string | number),
      resultado: centsFromDb(r.unrealized_result as string | number),
      dataAvaliacao: r.valuation_date as string | null, fonteAvaliacao: r.valuation_source as string | null,
    })),
    totais: ((totais.data ?? []) as Record<string, unknown>[]).map((r) => ({
      moeda: r.currency_code as MoedaInvestimento,
      custoTotal: centsFromDb(r.cost_basis as string | number),
      valorAtual: centsFromDb(r.market_value as string | number),
      resultado: centsFromDb(r.unrealized_result as string | number),
    })),
  }
}

export async function criarAtivoInvestimento(d: {
  familiaId: string; nome: string; ticker: string; classe: ClasseAtivo; moeda: MoedaInvestimento
}): Promise<string> {
  const { data, error } = await db().rpc('investment_asset_create', {
    p_household: d.familiaId, p_name: d.nome.trim(), p_ticker: d.ticker.trim() || null,
    p_class: d.classe, p_currency: d.moeda,
  })
  if (error) throw error
  return data as string
}

export async function registrarOperacaoInvestimento(d: {
  ativoId: string; data: string; tipo: TipoOperacaoInvestimento; quantidade: string;
  precoUnitario: string; tarifas: Cents; observacao: string
}): Promise<void> {
  const { error } = await db().rpc('investment_operation_record', {
    p_asset: d.ativoId, p_date: d.data, p_kind: d.tipo,
    p_quantity: textoDecimal(d.quantidade, 12), p_unit_price: textoDecimal(d.precoUnitario, 10),
    p_fees: centsToDecimal(d.tarifas), p_notes: d.observacao.trim() || null,
  })
  if (error) throw error
}

export async function registrarAvaliacaoInvestimento(d: {
  ativoId: string; data: string; precoUnitario: string; fonte: string
}): Promise<void> {
  const { error } = await db().rpc('investment_valuation_record', {
    p_asset: d.ativoId, p_date: d.data,
    p_unit_price: textoDecimal(d.precoUnitario, 10), p_source: d.fonte.trim(),
  })
  if (error) throw error
}
)
  if (!re.test(t) || Number(t) <= 0 || !Number.isFinite(Number(t))) {
    throw new Error('Informe um número positivo com até ' + casas + ' casas decimais.')
  }
  return t
}

export async function listarAtivosInvestimento(familiaId: string): Promise<AtivoInvestimento[]> {
  const { data, error } = await db().from('investment_assets')
    .select('id,name,ticker,asset_class,currency_code,active')
    .eq('household_id', familiaId).order('name')
  if (error) throw error
  return (data ?? []).map((r) => ({
    id: r.id, nome: r.name, ticker: r.ticker, classe: r.asset_class as ClasseAtivo,
    moeda: r.currency_code as MoedaInvestimento, ativo: r.active,
  }))
}

export async function listarCarteiraInvestimentos(familiaId: string, dataRef: string): Promise<{
  posicoes: PosicaoInvestimento[]; totais: TotalInvestimento[]
}> {
  const [posicoes, totais] = await Promise.all([
    db().rpc('investment_portfolio', { p_household: familiaId, p_as_of: dataRef }),
    db().rpc('investment_totals', { p_household: familiaId, p_as_of: dataRef }),
  ])
  if (posicoes.error) throw posicoes.error
  if (totais.error) throw totais.error
  return {
    posicoes: ((posicoes.data ?? []) as Record<string, unknown>[]).map((r) => ({
      assetId: r.asset_id as string, nome: r.name as string, ticker: r.ticker as string | null,
      classe: r.asset_class as ClasseAtivo, moeda: r.currency_code as MoedaInvestimento,
      quantidade: String(r.quantity), custoMedio: String(r.average_cost),
      custoTotal: centsFromDb(r.cost_basis as string | number),
      precoAtual: String(r.unit_price), valorAtual: centsFromDb(r.market_value as string | number),
      resultado: centsFromDb(r.unrealized_result as string | number),
      dataAvaliacao: r.valuation_date as string | null, fonteAvaliacao: r.valuation_source as string | null,
    })),
    totais: ((totais.data ?? []) as Record<string, unknown>[]).map((r) => ({
      moeda: r.currency_code as MoedaInvestimento,
      custoTotal: centsFromDb(r.cost_basis as string | number),
      valorAtual: centsFromDb(r.market_value as string | number),
      resultado: centsFromDb(r.unrealized_result as string | number),
    })),
  }
}

export async function criarAtivoInvestimento(d: {
  familiaId: string; nome: string; ticker: string; classe: ClasseAtivo; moeda: MoedaInvestimento
}): Promise<string> {
  const { data, error } = await db().rpc('investment_asset_create', {
    p_household: d.familiaId, p_name: d.nome.trim(), p_ticker: d.ticker.trim() || null,
    p_class: d.classe, p_currency: d.moeda,
  })
  if (error) throw error
  return data as string
}

export async function registrarOperacaoInvestimento(d: {
  ativoId: string; data: string; tipo: TipoOperacaoInvestimento; quantidade: string;
  precoUnitario: string; tarifas: Cents; observacao: string
}): Promise<void> {
  const { error } = await db().rpc('investment_operation_record', {
    p_asset: d.ativoId, p_date: d.data, p_kind: d.tipo,
    p_quantity: textoDecimal(d.quantidade, 12), p_unit_price: textoDecimal(d.precoUnitario, 10),
    p_fees: centsToDecimal(d.tarifas), p_notes: d.observacao.trim() || null,
  })
  if (error) throw error
}

export async function registrarAvaliacaoInvestimento(d: {
  ativoId: string; data: string; precoUnitario: string; fonte: string
}): Promise<void> {
  const { error } = await db().rpc('investment_valuation_record', {
    p_asset: d.ativoId, p_date: d.data,
    p_unit_price: textoDecimal(d.precoUnitario, 10), p_source: d.fonte.trim(),
  })
  if (error) throw error
}
