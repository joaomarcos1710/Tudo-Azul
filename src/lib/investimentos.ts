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
  /** Subclasse escolhida pela pessoa (Tesouro Direto, CDB, FIIs…); null = sem subclasse (ou banco sem a migration 034). */
  subclasse: string | null
  quantidadeOperacoes: number
  quantidadeAvaliacoes: number
  quantidadeProventos: number
}

/** Macroclasse, derivada da classe do ativo (a mesma regra da função investment_allocation, migration 034). */
export type MacroClasse = 'fixed_income' | 'variable' | 'other'

export const MACROS: { chave: MacroClasse; rotulo: string }[] = [
  { chave: 'fixed_income', rotulo: 'Renda fixa' },
  { chave: 'variable', rotulo: 'Renda variável' },
  { chave: 'other', rotulo: 'Fundos e outros' },
]

/**
 * Só para filtrar e rotular na tela: o dinheiro por macroclasse vem do banco (investment_allocation), nunca daqui.
 * Fundo e "outros" ficam à parte porque podem ser de renda fixa ou variável e o app não adivinha.
 */
export function macroDaClasse(classe: ClasseAtivo): MacroClasse {
  if (classe === 'fixed_income') return 'fixed_income'
  if (classe === 'fund' || classe === 'other') return 'other'
  return 'variable'
}

/** Sugestões de subclasse por classe (só sugestão: o campo é livre). */
export const SUGESTOES_SUBCLASSE: Record<ClasseAtivo, string[]> = {
  fixed_income: ['Tesouro Direto', 'CDB', 'LCI/LCA', 'Debêntures', 'Poupança'],
  equity: ['Ações', 'Exterior'],
  fund: ['Multimercado', 'Renda fixa', 'Ações'],
  reit: ['FIIs', 'REITs'],
  etf: ['ETFs', 'Exterior'],
  crypto: ['Cripto'],
  other: [],
}

/** Uma linha da alocação (investment_allocation). Valor e percentual vêm do banco; moedas nunca se somam. */
export interface LinhaAlocacao {
  moeda: MoedaInvestimento
  nivel: 'macro' | 'subclass'
  macro: MacroClasse
  /** null = ativos sem subclasse. Só faz sentido no nível 'subclass'. */
  subclasse: string | null
  valor: Cents
  /** % do total DA MOEDA, calculado no banco (1 casa). */
  percentual: number
}

export type TipoProvento = 'dividend' | 'jcp' | 'income'

export const TIPOS_PROVENTO: { chave: TipoProvento; rotulo: string }[] = [
  { chave: 'dividend', rotulo: 'Dividendos' },
  { chave: 'jcp', rotulo: 'JCP' },
  { chave: 'income', rotulo: 'Rendimentos' },
]

/** Proventos de um ativo no período (investment_income_by_asset). Valores calculados no banco, a partir dos lançamentos. */
export interface ProventoAtivo {
  assetId: string
  nome: string
  moeda: MoedaInvestimento
  /** Soma dos proventos pagos no período. */
  recebido: Cents
  /** Soma dos proventos planejados no período. */
  previsto: Cents
  ultimoRecebimento: string | null
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

export interface HistoricoInvestimento {
  mes: string
  moeda: MoedaInvestimento
  valorAtual: Cents
  custoTotal: Cents
}

function db() {
  if (!supabase) throw new Error('Supabase não configurado')
  return supabase
}

export function normalizarDecimalInvestimento(valor: string, casas: number): string {
  const t = valor.trim().replace(',', '.')
  const partes = t.split('.')
  const digitos = (parte: string) => parte.length > 0 && [...parte].every((c) => c >= '0' && c <= '9')
  if (partes.length > 2 || !digitos(partes[0]) ||
      (partes.length === 2 && (!digitos(partes[1]) || partes[1].length > casas)) ||
      partes[0].length > 12 || Number(t) <= 0 || !Number.isFinite(Number(t))) {
    throw new Error('Informe um número positivo com até ' + casas + ' casas decimais.')
  }
  return t
}

export async function listarAtivosInvestimento(familiaId: string): Promise<AtivoInvestimento[]> {
  // Preserva a subclasse da migration 034 e conta os registros históricos para proteger a exclusão.
  const ler = (colunas: string) => db().from('investment_assets').select(colunas).eq('household_id', familiaId).order('name')
  let { data, error } = await ler('id,name,ticker,asset_class,currency_code,active,subclass')
  if (error) ({ data, error } = await ler('id,name,ticker,asset_class,currency_code,active'))
  if (error) throw error
  const [operacoes, avaliacoes, proventos] = await Promise.all([
    db().from('investment_operations').select('asset_id').eq('household_id', familiaId),
    db().from('investment_valuations').select('asset_id').eq('household_id', familiaId),
    db().from('investment_distributions').select('asset_id').eq('household_id', familiaId),
  ])
  if (operacoes.error) throw operacoes.error
  if (avaliacoes.error) throw avaliacoes.error
  if (proventos.error) throw proventos.error
  const contar = (rows: { asset_id: string }[] | null) => {
    const mapa = new Map<string, number>()
    for (const row of rows ?? []) mapa.set(row.asset_id, (mapa.get(row.asset_id) ?? 0) + 1)
    return mapa
  }
  const qtdOperacoes = contar(operacoes.data)
  const qtdAvaliacoes = contar(avaliacoes.data)
  const qtdProventos = contar(proventos.data)
  return ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
    id: r.id as string, nome: r.name as string, ticker: r.ticker as string | null, classe: r.asset_class as ClasseAtivo,
    moeda: r.currency_code as MoedaInvestimento, ativo: r.active as boolean,
    subclasse: (r.subclass as string | null | undefined) ?? null,
    quantidadeOperacoes: qtdOperacoes.get(r.id as string) ?? 0,
    quantidadeAvaliacoes: qtdAvaliacoes.get(r.id as string) ?? 0,
    quantidadeProventos: qtdProventos.get(r.id as string) ?? 0,
  }))
}

/** Alocação da carteira por macroclasse e subclasse, por moeda (investment_allocation). */
export async function listarAlocacaoInvestimentos(familiaId: string, dataRef: string): Promise<LinhaAlocacao[]> {
  const { data, error } = await db().rpc('investment_allocation', { p_household: familiaId, p_as_of: dataRef })
  if (error) throw error
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    moeda: r.currency_code as MoedaInvestimento,
    nivel: r.level as 'macro' | 'subclass',
    macro: r.macro as MacroClasse,
    subclasse: (r.subclass as string | null) ?? null,
    valor: centsFromDb(r.market_value as string | number),
    percentual: Number(r.share ?? 0),
  }))
}

/** Define a subclasse do ativo; texto vazio limpa. O banco aceita até 40 caracteres. */
export async function definirSubclasseAtivo(ativoId: string, subclasse: string): Promise<void> {
  const { error } = await db().rpc('investment_asset_set_subclass', { p_asset: ativoId, p_subclass: subclasse.trim() || null })
  if (error) throw error
}

export async function listarCarteiraInvestimentos(familiaId: string, dataRef: string): Promise<{
  posicoes: PosicaoInvestimento[]
  totais: TotalInvestimento[]
}> {
  const [posicoes, totais] = await Promise.all([
    db().rpc('investment_portfolio', { p_household: familiaId, p_as_of: dataRef }),
    db().rpc('investment_totals', { p_household: familiaId, p_as_of: dataRef }),
  ])
  if (posicoes.error) throw posicoes.error
  if (totais.error) throw totais.error
  return {
    posicoes: ((posicoes.data ?? []) as Record<string, unknown>[]).map((r) => ({
      assetId: r.asset_id as string,
      nome: r.name as string,
      ticker: r.ticker as string | null,
      classe: r.asset_class as ClasseAtivo,
      moeda: r.currency_code as MoedaInvestimento,
      quantidade: String(r.quantity),
      custoMedio: String(r.average_cost),
      custoTotal: centsFromDb(r.cost_basis as string | number),
      precoAtual: String(r.unit_price),
      valorAtual: centsFromDb(r.market_value as string | number),
      resultado: centsFromDb(r.unrealized_result as string | number),
      dataAvaliacao: r.valuation_date as string | null,
      fonteAvaliacao: r.valuation_source as string | null,
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
  familiaId: string
  nome: string
  ticker: string
  classe: ClasseAtivo
  moeda: MoedaInvestimento
}): Promise<string> {
  const { data, error } = await db().rpc('investment_asset_create', {
    p_household: d.familiaId,
    p_name: d.nome.trim(),
    p_ticker: d.ticker.trim() || null,
    p_class: d.classe,
    p_currency: d.moeda,
  })
  if (error) throw error
  return data as string
}

export async function registrarOperacaoInvestimento(d: {
  ativoId: string
  data: string
  tipo: TipoOperacaoInvestimento
  quantidade: string
  precoUnitario: string
  tarifas: Cents
  observacao: string
}): Promise<void> {
  const { error } = await db().rpc('investment_operation_record', {
    p_asset: d.ativoId,
    p_date: d.data,
    p_kind: d.tipo,
    p_quantity: normalizarDecimalInvestimento(d.quantidade, 12),
    p_unit_price: normalizarDecimalInvestimento(d.precoUnitario, 10),
    p_fees: centsToDecimal(d.tarifas),
    p_notes: d.observacao.trim() || null,
  })
  if (error) throw error
}

export async function registrarAvaliacaoInvestimento(d: {
  ativoId: string
  data: string
  precoUnitario: string
  fonte: string
}): Promise<void> {
  const { error } = await db().rpc('investment_valuation_record', {
    p_asset: d.ativoId,
    p_date: d.data,
    p_unit_price: normalizarDecimalInvestimento(d.precoUnitario, 10),
    p_source: d.fonte.trim(),
  })
  if (error) throw error
}

/**
 * Registra um provento como RECEITA na conta, ligada ao ativo (investment_distribution_record). O valor é o LÍQUIDO,
 * o que caiu na conta. Só ativos em BRL nesta fase (as contas ainda são só em reais): o banco recusa os demais.
 */
export async function registrarProventoInvestimento(d: {
  ativoId: string
  tipo: TipoProvento
  data: string
  valor: Cents
  contaId: string
  status: 'paid' | 'planned'
  observacao: string
}): Promise<void> {
  const { error } = await db().rpc('investment_distribution_record', {
    p_asset: d.ativoId, p_kind: d.tipo, p_date: d.data, p_amount: centsToDecimal(d.valor),
    p_account: d.contaId, p_status: d.status, p_notes: d.observacao.trim() || null,
  })
  if (error) throw error
}

export async function listarProventosPorAtivo(familiaId: string, de: string, ate: string): Promise<ProventoAtivo[]> {
  const { data, error } = await db().rpc('investment_income_by_asset', { p_household: familiaId, p_from: de, p_to: ate })
  if (error) throw error
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    assetId: r.asset_id as string,
    nome: r.name as string,
    moeda: r.currency_code as MoedaInvestimento,
    recebido: centsFromDb(r.received as string | number),
    previsto: centsFromDb(r.planned as string | number),
    ultimoRecebimento: (r.last_received as string | null) ?? null,
  }))
}

/** Corrige nome, código e classe do ativo. A moeda não muda (as operações já estão nela). Só a classe muda o agrupamento, nunca um valor. */
export async function editarAtivoInvestimento(d: { ativoId: string; nome: string; ticker: string; classe: ClasseAtivo }): Promise<void> {
  const { error } = await db().rpc('investment_asset_update', {
    p_asset: d.ativoId, p_name: d.nome.trim(), p_ticker: d.ticker.trim() || null, p_class: d.classe,
  })
  if (error) throw error
}

/** Arquiva o ativo (some das escolhas e das posições, o histórico fica). O banco recusa com posição aberta (23514). */
export async function arquivarAtivoInvestimento(ativoId: string): Promise<void> {
  const { error } = await db().rpc('investment_asset_archive', { p_asset: ativoId })
  if (error) throw error
}

export async function reativarAtivoInvestimento(ativoId: string): Promise<void> {
  const { error } = await db().rpc('investment_asset_unarchive', { p_asset: ativoId })
  if (error) throw error
}

/** Exclui somente ativos sem operações ou avaliações, preservando o livro histórico. */
export async function excluirAtivoInvestimento(ativoId: string): Promise<void> {
  const { error } = await db().rpc('investment_asset_delete', { p_asset: ativoId })
  if (error) throw error
}

/** Histórico mensal da carteira, calculado no banco e separado por moeda. */
export async function listarHistoricoInvestimentos(
  familiaId: string, deData: string, ateData: string,
): Promise<HistoricoInvestimento[]> {
  const { data, error } = await db().rpc('investment_history', {
    p_household: familiaId, p_from: deData, p_to: ateData,
  })
  if (error) throw error
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    mes: String(r.month),
    moeda: r.currency_code as MoedaInvestimento,
    valorAtual: centsFromDb(r.market_value as string | number),
    custoTotal: centsFromDb(r.cost_basis as string | number),
  }))
}
