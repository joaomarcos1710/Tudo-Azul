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
  /** 'restricted' = não vira dinheiro rápido (previdência, FGTS). Banco sem a migration da liquidez: tudo 'liquid'. */
  liquidez: Liquidez
  /** Onde o investimento está (corretora, banco, fundo de pensão); null = não informado (ou banco sem a migration 106). */
  instituicao: string | null
  /** O valor acompanha a cotação da bolsa (migration 109). null = banco ainda sem a migration: a opção não aparece. */
  cotacaoBolsa: boolean | null
  quantidadeOperacoes: number
  quantidadeAvaliacoes: number
  quantidadeProventos: number
}

export type Liquidez = 'liquid' | 'restricted'

/** Classes do ativo, na ordem dos formulários. */
export const CLASSES_ATIVO: [ClasseAtivo, string][] = [
  ['fixed_income', 'Renda fixa'], ['equity', 'Ações'], ['fund', 'Fundos de investimento'],
  ['reit', 'FIIs / REITs'], ['etf', 'ETFs'], ['crypto', 'Criptoativos'], ['other', 'Outros'],
]

export const LIQUIDEZES: [Liquidez, string][] = [
  ['liquid', 'Líquido: dá para resgatar ou vender'],
  ['restricted', 'Restrito: previdência, FGTS'],
]

/** Valor de mercado da carteira por moeda e liquidez (investment_liquidity_totals). */
export interface LinhaLiquidez { moeda: MoedaInvestimento; liquidez: Liquidez; valor: Cents }

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

/** Um tipo dentro da categoria do cadastro: grava a classe (que o banco conhece) e sugere a subclasse. */
export interface TipoNovoAtivo { rotulo: string; classe: ClasseAtivo; subclasse: string }

/**
 * Categorias do cadastro de ativo (pedido do dono, 10/11/2026, a partir da lista de uma planilha de carteira dele):
 * a pessoa escolhe pelo nome do produto e o app grava a classe e a subclasse. A classe do banco não muda (macroclasse,
 * alocação e filtros continuam como eram). "Moedas" e "Ativos Personalizados" fecham a lista do dono; previdência e
 * FGTS, que já existem na carteira, são tipos de "Ativos Personalizados" (o padrão é "Personalizado", sem subclasse).
 * Moedas e personalizados gravam a classe "Outros" do banco. `moeda` é só a sugestão inicial do campo Moeda.
 */
export const CATEGORIAS_NOVO_ATIVO: { chave: string; rotulo: string; moeda?: MoedaInvestimento; tipos: TipoNovoAtivo[] }[] = [
  { chave: 'brasil', rotulo: 'Ativos Brasil (Ação, ETF, BDR, FII, FI Agro, FIDC, ...)', tipos: [
    { rotulo: 'Ação', classe: 'equity', subclasse: 'Ações' }, { rotulo: 'ETF', classe: 'etf', subclasse: 'ETFs' },
    { rotulo: 'BDR', classe: 'equity', subclasse: 'BDRs' }, { rotulo: 'FII', classe: 'reit', subclasse: 'FIIs' },
    { rotulo: 'FI Agro', classe: 'reit', subclasse: 'Fiagro' }, { rotulo: 'FIDC', classe: 'fund', subclasse: 'FIDC' },
  ] },
  { chave: 'bancario', rotulo: 'CDB/LCI/LCA/LC/RDB', tipos: ['CDB', 'LCI', 'LCA', 'LC', 'RDB'].map((x) => ({ rotulo: x, classe: 'fixed_income' as const, subclasse: x })) },
  { chave: 'tesouro', rotulo: 'Tesouro Direto', tipos: [{ rotulo: 'Tesouro Direto', classe: 'fixed_income', subclasse: 'Tesouro Direto' }] },
  { chave: 'fundo', rotulo: 'Fundo de Investimento', tipos: [{ rotulo: 'Fundo de investimento', classe: 'fund', subclasse: '' }] },
  { chave: 'internacional', rotulo: 'Internacionais', moeda: 'USD', tipos: [
    { rotulo: 'Stock (ação)', classe: 'equity', subclasse: 'Stocks' }, { rotulo: 'REIT', classe: 'reit', subclasse: 'REITs' },
    { rotulo: 'ETF', classe: 'etf', subclasse: 'ETFs internacionais' },
  ] },
  { chave: 'cripto', rotulo: 'Criptomoedas', tipos: [{ rotulo: 'Criptomoeda', classe: 'crypto', subclasse: 'Cripto' }] },
  { chave: 'debenture', rotulo: 'Debêntures', tipos: [{ rotulo: 'Debênture', classe: 'fixed_income', subclasse: 'Debêntures' }] },
  { chave: 'moedas', rotulo: 'Moedas', tipos: [{ rotulo: 'Moeda', classe: 'other', subclasse: 'Moedas' }] },
  { chave: 'personalizado', rotulo: 'Ativos Personalizados', tipos: [
    { rotulo: 'Personalizado', classe: 'other', subclasse: '' },
    { rotulo: 'Previdência', classe: 'other', subclasse: 'Previdência' }, { rotulo: 'FGTS', classe: 'other', subclasse: 'FGTS' },
  ] },
]

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
  let { data, error } = await ler('id,name,ticker,asset_class,currency_code,active,subclass,liquidity,institution,market_quote')
  // banco ainda sem a coluna market_quote (109), sem a institution (106), sem a liquidity ou sem a subclass (034): lê o que existe
  if (error) ({ data, error } = await ler('id,name,ticker,asset_class,currency_code,active,subclass,liquidity,institution'))
  if (error) ({ data, error } = await ler('id,name,ticker,asset_class,currency_code,active,subclass,liquidity'))
  if (error) ({ data, error } = await ler('id,name,ticker,asset_class,currency_code,active,subclass'))
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
    liquidez: r.liquidity === 'restricted' ? 'restricted' : 'liquid',
    instituicao: (r.institution as string | null | undefined) ?? null,
    cotacaoBolsa: typeof r.market_quote === 'boolean' ? r.market_quote : null,
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

/** Marca o ativo como líquido ou restrito (previdência, FGTS). Só muda em qual balde o valor aparece. */
export async function definirLiquidezAtivo(ativoId: string, liquidez: Liquidez): Promise<void> {
  const { error } = await db().rpc('investment_asset_set_liquidity', { p_asset: ativoId, p_liquidity: liquidez })
  if (error) throw error
}

/** Carteira por moeda e liquidez; os valores vêm somados do banco. */
export async function listarLiquidezInvestimentos(familiaId: string, dataRef: string): Promise<LinhaLiquidez[]> {
  const { data, error } = await db().rpc('investment_liquidity_totals', { p_household: familiaId, p_as_of: dataRef })
  if (error) throw error
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    moeda: r.currency_code as MoedaInvestimento,
    liquidez: r.liquidity === 'restricted' ? 'restricted' : 'liquid',
    valor: centsFromDb(r.market_value as string | number),
  }))
}

/** Valor de mercado da carteira por moeda e instituição (investment_institution_totals, migration 106). */
export interface LinhaInstituicao { moeda: MoedaInvestimento; instituicao: string | null; valor: Cents }

export async function listarInstituicoesInvestimentos(familiaId: string, dataRef: string): Promise<LinhaInstituicao[]> {
  const { data, error } = await db().rpc('investment_institution_totals', { p_household: familiaId, p_as_of: dataRef })
  if (error) throw error
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    moeda: r.currency_code as MoedaInvestimento,
    instituicao: (r.institution as string | null) ?? null,
    valor: centsFromDb(r.market_value as string | number),
  }))
}

/**
 * Aportes e resgates de um ativo ou de uma moeda (investment_contributions, migration 107): `aportado` é tudo o que
 * entrou, `resgatado` tudo o que saiu, `liquido` a diferença (o que saiu do bolso e ainda não voltou; negativo quando já
 * se tirou mais do que se pôs) e `ganho` tudo o que rendeu, contando o que já saiu nos resgates. No banco,
 * valorAtual = liquido + ganho, no centavo.
 */
export interface Aportes { moeda: MoedaInvestimento; aportado: Cents; resgatado: Cents; liquido: Cents; valorAtual: Cents; ganho: Cents }
export interface AportesCarteira { porAtivo: Map<string, Aportes>; totais: Aportes[] }

export async function listarAportesInvestimentos(familiaId: string, dataRef: string): Promise<AportesCarteira> {
  const { data, error } = await db().rpc('investment_contributions', { p_household: familiaId, p_as_of: dataRef })
  if (error) throw error
  const porAtivo = new Map<string, Aportes>()
  const totais: Aportes[] = []
  for (const r of (data ?? []) as Record<string, unknown>[]) {
    const linha: Aportes = {
      moeda: r.currency_code as MoedaInvestimento,
      aportado: centsFromDb(r.contributed as string | number),
      resgatado: centsFromDb(r.redeemed as string | number),
      liquido: centsFromDb(r.net_contributed as string | number),
      valorAtual: centsFromDb(r.market_value as string | number),
      ganho: centsFromDb(r.total_result as string | number),
    }
    if (r.level === 'total') totais.push(linha)
    else porAtivo.set(r.asset_id as string, linha)
  }
  return { porAtivo, totais }
}

/**
 * O código que a cotação da bolsa usaria para este ativo, ou null quando ele não pode acompanhar a bolsa: só ação, FII,
 * ETF ou fundo, em reais, com código da B3 (4 letras e 1 ou 2 números). É o mesmo critério do banco
 * (private.investment_quote_symbol, migration 109), repetido aqui só para decidir o que a tela oferece; quem decide é o banco.
 */
export function codigoDaBolsa(ticker: string | null, classe: ClasseAtivo | '', moeda: MoedaInvestimento): string | null {
  const codigo = (ticker ?? '').trim().toUpperCase()
  const classeDaBolsa = classe === 'equity' || classe === 'reit' || classe === 'etf' || classe === 'fund'
  return moeda === 'BRL' && classeDaBolsa && /^[A-Z]{4}[0-9]{1,2}$/.test(codigo) ? codigo : null
}

/** O ativo está com a cotação da bolsa ligada E ainda pode usá-la (o código pode ter sido trocado depois). */
export function segueABolsa(a: Pick<AtivoInvestimento, 'cotacaoBolsa' | 'ticker' | 'classe' | 'moeda'>): boolean {
  return a.cotacaoBolsa === true && codigoDaBolsa(a.ticker, a.classe, a.moeda) !== null
}

/** Dias corridos sem preço novo a partir dos quais a tela avisa: cobre fim de semana com feriado colado (sexta → terça). */
export const DIAS_COTACAO_PARADA = 4

/**
 * Há quantos dias corridos o preço de um ativo que segue a bolsa não muda, quando isso já merece aviso; null = em dia.
 * `dataPreco` nulo (nenhuma cotação nem avaliação ainda) devolve 'sem-preco'. Datas no formato AAAA-MM-DD.
 */
export function cotacaoParada(dataPreco: string | null, hoje: string): number | 'sem-preco' | null {
  if (!dataPreco) return 'sem-preco'
  const dias = Math.round((Date.parse(`${hoje}T00:00:00Z`) - Date.parse(`${dataPreco}T00:00:00Z`)) / 86_400_000)
  return dias > DIAS_COTACAO_PARADA ? dias : null
}

/** Liga ou desliga a cotação da bolsa no ativo (investment_asset_set_market_quote, migration 109). */
export async function definirCotacaoBolsaAtivo(ativoId: string, ligada: boolean): Promise<void> {
  const { error } = await db().rpc('investment_asset_set_market_quote', { p_asset: ativoId, p_on: ligada })
  if (error) throw error
}

/** Define a instituição do ativo (corretora, banco); texto vazio limpa. O banco aceita até 40 caracteres. */
export async function definirInstituicaoAtivo(ativoId: string, instituicao: string): Promise<void> {
  const { error } = await db().rpc('investment_asset_set_institution', { p_asset: ativoId, p_institution: instituicao.trim() || null })
  if (error) throw error
}

/** Proventos recebidos e previstos por moeda no período (investment_income_totals, migration 106): o total vem do banco. */
export interface TotalProventos { moeda: MoedaInvestimento; recebido: Cents; previsto: Cents }

export async function listarTotalProventos(familiaId: string, de: string, ate: string): Promise<TotalProventos[]> {
  const { data, error } = await db().rpc('investment_income_totals', { p_household: familiaId, p_from: de, p_to: ate })
  if (error) throw error
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    moeda: r.currency_code as MoedaInvestimento,
    recebido: centsFromDb(r.received as string | number),
    previsto: centsFromDb(r.planned as string | number),
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
  /** Conta de onde saiu (compra) ou para onde volta (venda); o banco cria a transferência com a carteira (migration 100).
   * Vazio = não passou por conta do app (ex.: previdência): só a operação, como antes. */
  contaId?: string
}): Promise<void> {
  const { error } = await db().rpc('investment_operation_record', {
    // só envia a conta quando há uma: assim a gravação segue funcionando no banco sem a migration 100
    ...(d.contaId ? { p_account: d.contaId } : {}),
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

/**
 * Aporte ou resgate só pelo valor (migration 104), para ativo sem cota (cofrinho, CDB, reserva, previdência): o banco
 * converte o valor em unidades pelo valor atual do ativo, como a cota de um fundo. Nenhuma conta é feita no front.
 * Na primeira posição grava 1 unidade pelo valor. Resgatar o valor todo zera a posição.
 */
export async function registrarOperacaoPorValor(d: {
  ativoId: string
  data: string
  tipo: TipoOperacaoInvestimento
  valor: Cents
  observacao: string
  /** Conta de onde saiu (aporte) ou para onde volta (resgate); vazio = não passou por conta do app. */
  contaId?: string
}): Promise<void> {
  const { error } = await db().rpc('investment_operation_record_by_value', {
    p_asset: d.ativoId,
    p_date: d.data,
    p_kind: d.tipo,
    p_amount: centsToDecimal(d.valor),
    p_notes: d.observacao.trim() || null,
    p_account: d.contaId ?? null,
  })
  if (error) throw error
}

/** "Hoje este investimento vale R$ X" (migration 104): o banco divide pelo número de unidades; o front não faz conta. */
export async function registrarAvaliacaoTotal(d: { ativoId: string; data: string; valor: Cents; fonte: string }): Promise<void> {
  const { error } = await db().rpc('investment_valuation_record_total', {
    p_asset: d.ativoId,
    p_date: d.data,
    p_total: centsToDecimal(d.valor),
    p_source: d.fonte.trim(),
  })
  if (error) throw error
}

/**
 * Move o saldo de uma conta para a carteira (migration 100): o banco cria o ativo com o saldo de hoje da conta, transfere
 * esse saldo para a carteira (a conta zera sem despesa) e arquiva a conta. O valor sai do banco, nunca do front.
 */
export async function moverContaParaCarteira(d: {
  contaId: string
  nome: string
  classe: ClasseAtivo
  liquidez: Liquidez
  subclasse: string
}): Promise<string> {
  const { data, error } = await db().rpc('account_move_to_portfolio', {
    p_account: d.contaId,
    p_name: d.nome.trim(),
    p_class: d.classe,
    p_liquidity: d.liquidez,
    p_subclass: d.subclasse.trim() || null,
  })
  if (error) throw error
  return data as string
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

/** Exclui o ativo com todo o histórico (operações, avaliações e vínculo dos proventos; a receita na conta fica).
 *  O banco só aceita se `nomeDigitado` for o nome exato do ativo (migration 050). */
export async function excluirAtivoComHistorico(
  ativoId: string, nomeDigitado: string,
): Promise<{ operacoes: number; avaliacoes: number; proventos: number }> {
  const { data, error } = await db().rpc('investment_asset_purge', { p_asset: ativoId, p_confirm_name: nomeDigitado })
  if (error) throw error
  const r = (Array.isArray(data) ? data[0] : data) as { operations: number; valuations: number; distributions: number } | null
  return { operacoes: r?.operations ?? 0, avaliacoes: r?.valuations ?? 0, proventos: r?.distributions ?? 0 }
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

export type TipoLinhaExtrato = 'buy' | 'sell' | 'valuation' | 'distribution'

/** Uma linha do extrato do ativo. Valor e saldo de quantidade vêm calculados do banco. */
export interface LinhaExtratoAtivo {
  id: string
  tipo: TipoLinhaExtrato
  data: string
  quantidade: string | null
  precoUnitario: string | null
  taxa: Cents | null
  valor: Cents | null
  tipoProvento: TipoProvento | null
  statusProvento: 'paid' | 'planned' | null
  fonte: string | null
  observacao: string | null
  anulada: boolean
  motivoAnulacao: string | null
  saldoQuantidade: string | null
}

/** Compras, vendas, avaliações e proventos do ativo, em ordem de data (investment_asset_statement, migration 043). */
export async function listarExtratoAtivo(familiaId: string, ativoId: string): Promise<LinhaExtratoAtivo[]> {
  const { data, error } = await db().rpc('investment_asset_statement', { p_household: familiaId, p_asset: ativoId })
  if (error) throw error
  const texto = (v: unknown) => (v === null || v === undefined ? null : String(v))
  const centavos = (v: unknown) => (v === null || v === undefined ? null : centsFromDb(v as string | number))
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.entry_id),
    tipo: r.entry_kind as TipoLinhaExtrato,
    data: String(r.entry_date),
    quantidade: texto(r.quantity),
    precoUnitario: texto(r.unit_price),
    taxa: centavos(r.fees),
    valor: centavos(r.amount),
    tipoProvento: (r.distribution_kind as TipoProvento | null) ?? null,
    statusProvento: (r.distribution_status as 'paid' | 'planned' | null) ?? null,
    fonte: texto(r.source),
    observacao: texto(r.notes),
    anulada: Boolean(r.voided),
    motivoAnulacao: texto(r.void_reason),
    saldoQuantidade: texto(r.balance_quantity),
  }))
}

/** Anula (não apaga) uma compra ou venda, com motivo de 3 a 200 caracteres. O banco recusa se a posição ficar negativa (23514). */
export async function anularOperacaoInvestimento(operacaoId: string, motivo: string): Promise<void> {
  const { error } = await db().rpc('investment_operation_void', { p_operation: operacaoId, p_reason: motivo.trim() })
  if (error) throw error
}
