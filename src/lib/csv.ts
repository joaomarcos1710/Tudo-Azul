import { centsFromDb } from './format'
import type { Cents } from './format'
import { COLUNA_INEXISTENTE, rotuloDoTipo } from './contas'
import { supabase } from './supabase'

/**
 * Exportação CSV no formato que o Excel e o Google Planilhas em português abrem direto:
 * separador ";", decimal com vírgula, data DD/MM/AAAA e BOM UTF-8 para os acentos.
 */

export interface LinhaExportada {
  data: string
  tipo: 'income' | 'expense' | 'transfer'
  descricao: string
  categoria: string
  conta: string
  contaDestino: string
  valor: Cents
  /** Moeda da conta do lançamento (multimoeda F2, migration 056); parcela de dívida é sempre BRL. */
  moeda: string
  situacao: 'paid' | 'planned'
  notas: string
}

const rotulos = { income: 'Receita', expense: 'Despesa', transfer: 'Transferência' } as const

/** Aspas quando precisa; aspas internas duplicadas (RFC 4180). Evita fórmula no Excel (=, +, -, @). */
function celula(v: string, texto = true): string {
  const seguro = texto && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v
  return /[;"\n\r]/.test(seguro) ? `"${seguro.replace(/"/g, '""')}"` : seguro
}

/** Centavos -> "1250,50" / "-30,00", sem ponto de milhar (planilhas leem como número). */
function decimalBR(c: Cents): string {
  const abs = Math.abs(c)
  return `${c < 0 ? '-' : ''}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}`
}

/** Célula numérica (centavos) ou texto. Números não recebem a proteção de fórmula (o "-" é o sinal). */
type Celula = string | { centavos: Cents }

function dataBR(iso: string | null | undefined): string {
  if (!iso) return ''
  const [a, m, d] = iso.split('-')
  return `${d}/${m}/${a}`
}

/** Monta o arquivo: BOM UTF-8, ";" e quebra de linha CRLF. */
export function montarCsv(cabecalho: string[], linhas: Celula[][]): string {
  const corpo = linhas.map((l) => l.map((c) => (typeof c === 'string' ? celula(c) : celula(decimalBR(c.centavos), false))).join(';'))
  return '\uFEFF' + [cabecalho.join(';'), ...corpo].join('\r\n') + '\r\n'
}

export function gerarCsv(linhas: LinhaExportada[]): string {
  return montarCsv(
    ['Data', 'Tipo', 'Descrição', 'Categoria', 'Conta', 'Conta destino', 'Valor', 'Moeda', 'Situação', 'Observações'],
    linhas.map((l) => [
      // valor com sinal pelo efeito: despesa negativa, receita positiva, transferência positiva (movimento entre contas)
      // e na moeda da conta: nunca somar a coluna Valor sem separar pela Moeda
      dataBR(l.data), rotulos[l.tipo], l.descricao, l.categoria, l.conta, l.contaDestino,
      { centavos: l.tipo === 'expense' ? (-l.valor as Cents) : l.valor }, l.moeda, l.situacao === 'paid' ? 'Pago' : 'Planejado', l.notas,
    ]),
  )
}

/** Todos os lançamentos fora da lixeira, com nomes de conta e categoria, em páginas de 1.000. */
export async function lancamentosParaExportar(familiaId: string, periodo?: { de: string; ate: string }): Promise<LinhaExportada[]> {
  if (!supabase) throw new Error('Supabase não configurado')
  const db = supabase
  // moeda da conta (migration 055); banco ainda sem a coluna: lê sem ela e tudo sai como BRL
  const lerContas = async (colunas: string): Promise<{ data: unknown; error: { code?: string } | null }> =>
    db.from('accounts').select(colunas).eq('household_id', familiaId)
  const [contas, categorias] = await Promise.all([
    lerContas('id, name, currency_code').then((r) => (r.error?.code === COLUNA_INEXISTENTE ? lerContas('id, name') : r)),
    supabase.from('categories').select('id, name').eq('household_id', familiaId),
  ])
  if (contas.error) throw contas.error
  if (categorias.error) throw categorias.error
  const listaContas = (contas.data ?? []) as Registro[]
  const nomeConta = new Map(listaContas.map((c) => [c.id as string, c.name as string]))
  const moedaConta = new Map(listaContas.map((c) => [c.id as string, moedaDaConta(c)]))
  const nomeCategoria = new Map((categorias.data ?? []).map((c) => [c.id, c.name as string]))

  const linhas: LinhaExportada[] = []
  const pagina = 1000
  for (let inicio = 0; ; inicio += pagina) {
    let q = supabase
      .from('transactions')
      .select('id, type, account_id, destination_account_id, category_id, description, amount, date, status, notes')
      .eq('household_id', familiaId)
      .is('deleted_at', null)
    if (periodo) q = q.gte('date', periodo.de).lte('date', periodo.ate)
    const { data, error } = await q.order('date').order('created_at').order('id').range(inicio, inicio + pagina - 1)
    if (error) throw error
    for (const t of data ?? []) {
      linhas.push({
        data: t.date,
        tipo: t.type,
        descricao: t.description,
        categoria: t.category_id ? nomeCategoria.get(t.category_id) ?? '' : '',
        conta: nomeConta.get(t.account_id) ?? '',
        contaDestino: t.destination_account_id ? nomeConta.get(t.destination_account_id) ?? '' : '',
        valor: centsFromDb(t.amount),
        moeda: moedaConta.get(t.account_id) ?? 'BRL',
        situacao: t.status,
        notas: t.notes ?? '',
      })
    }
    if (!data || data.length < pagina) break
  }
  linhas.push(...await parcelasDeDividaParaExportar(familiaId, nomeConta, nomeCategoria, periodo))
  // ordem por data; no mesmo dia, a ordem de leitura (lançamentos antes das parcelas)
  return linhas.map((l, i) => [l, i] as const).sort((a, b) => (a[0].data < b[0].data ? -1 : a[0].data > b[0].data ? 1 : a[1] - b[1])).map(([l]) => l)
}

type DividaExport = { id: string; name: string; kind: string; principal_category_id?: string | null; payment_method?: string | null; payment_account_id?: string | null; active?: boolean }
const rotuloParcela: Record<string, string> = { payment: 'principal', extra_principal: 'amortização extra', interest: 'juros', fee: 'tarifa' }

/**
 * Parcelas de empréstimo/financiamento (migration 046: a parcela é despesa do mês em que é paga).
 * Pagas: principal, amortização, juros e tarifa que saíram de uma conta. Planejadas: agenda do contrato ainda não
 * baixada (consignado fica de fora: o salário já entra líquido). O principal vai na categoria escolhida na dívida.
 */
async function parcelasDeDividaParaExportar(
  familiaId: string, nomeConta: Map<string, string>, nomeCategoria: Map<string, string>, periodo?: { de: string; ate: string },
): Promise<LinhaExportada[]> {
  if (!supabase) throw new Error('Supabase não configurado')
  const db = supabase
  let dividas = await db.from('debts').select('id, name, kind, principal_category_id, payment_method, payment_account_id, active').eq('household_id', familiaId)
  if (dividas.error) dividas = await db.from('debts').select('id, name, kind').eq('household_id', familiaId) as typeof dividas
  if (dividas.error) throw dividas.error
  const emprestimos = new Map(((dividas.data ?? []) as DividaExport[]).filter((d) => d.kind === 'loan' || d.kind === 'financing').map((d) => [d.id, d]))
  if (emprestimos.size === 0) return []
  const categoriaPrincipal = (d: DividaExport) => (d.principal_category_id ? nomeCategoria.get(d.principal_category_id) ?? 'Sem categoria' : 'Sem categoria')

  const linhas: LinhaExportada[] = []
  const pagina = 1000
  for (let inicio = 0; ; inicio += pagina) {
    let q = db.from('debt_events').select('id, debt_id, date, kind, amount, account_id, category_id, voided_at')
      .eq('household_id', familiaId).is('voided_at', null)
    if (periodo) q = q.gte('date', periodo.de).lte('date', periodo.ate)
    const { data, error } = await q.order('date').order('created_at').order('id').range(inicio, inicio + pagina - 1)
    if (error) throw error
    for (const e of (data ?? []) as { debt_id: string; date: string; kind: string; amount: number | string; account_id: string | null; category_id: string | null; voided_at: string | null }[]) {
      const d = emprestimos.get(e.debt_id)
      if (!d || e.voided_at || !e.account_id || !(e.kind in rotuloParcela)) continue
      const principal = e.kind === 'payment' || e.kind === 'extra_principal'
      linhas.push({
        data: e.date, tipo: 'expense', descricao: `Parcela de ${d.name} (${rotuloParcela[e.kind]})`,
        categoria: principal ? categoriaPrincipal(d) : e.category_id ? nomeCategoria.get(e.category_id) ?? '' : '',
        conta: nomeConta.get(e.account_id) ?? '', contaDestino: '', valor: centsFromDb(e.amount), moeda: 'BRL', situacao: 'paid', notas: 'Parcela de dívida',
      })
    }
    if (!data || data.length < pagina) break
  }

  let agenda = db.from('debt_payment_schedule').select('id, debt_id, installment_number, due_date, amount, status')
    .eq('household_id', familiaId).eq('status', 'planned')
  if (periodo) agenda = agenda.gte('due_date', periodo.de).lte('due_date', periodo.ate)
  const planejadas = await agenda.order('due_date').order('installment_number')
  // agenda ainda não aplicada no banco (migration 038): segue sem as planejadas
  if (!planejadas.error) {
    for (const r of (planejadas.data ?? []) as { debt_id: string; installment_number: number; due_date: string; amount: number | string; status: string }[]) {
      const d = emprestimos.get(r.debt_id)
      if (!d || r.status !== 'planned' || d.active === false || d.payment_method === 'payroll') continue
      linhas.push({
        data: r.due_date, tipo: 'expense', descricao: `Parcela ${r.installment_number} de ${d.name}`, categoria: categoriaPrincipal(d),
        conta: d.payment_account_id ? nomeConta.get(d.payment_account_id) ?? '' : '', contaDestino: '', valor: centsFromDb(r.amount),
        moeda: 'BRL', situacao: 'planned', notas: 'Parcela de dívida (contrato)',
      })
    }
  }
  return linhas
}

/** Dispara o download no navegador. */
export function baixarArquivo(nome: string, conteudo: string): void {
  const url = URL.createObjectURL(new Blob([conteudo], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = nome
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

// ---------------------------------------------------------------------------
// Exportação completa (critério 3 do corte): o que é preciso para refazer os saldos fora do app.
// Só leitura; quem calcula saldo e dívida é o banco (account_movements, account_balances, debt_balances).
// NÃO é restaurável automaticamente: o app ainda não importa estes arquivos.
// ---------------------------------------------------------------------------

export interface ArquivoExportado {
  nome: string
  conteudo: string
  linhas: number
}

type Registro = Record<string, unknown>
type Pagina = { range: (de: number, ate: number) => PromiseLike<{ data: unknown; error: unknown }> }

/** Busca todas as linhas em páginas de 1.000 (limite do PostgREST); a consulta precisa ter ordem total. */
async function todas(consulta: () => Pagina): Promise<Registro[]> {
  const tudo: Registro[] = []
  const pagina = 1000
  for (let inicio = 0; ; inicio += pagina) {
    const { data, error } = await consulta().range(inicio, inicio + pagina - 1)
    if (error) throw error
    const lote = (data ?? []) as Registro[]
    tudo.push(...lote)
    if (lote.length < pagina) return tudo
  }
}

function schemaAindaNaoAplicado(erro: unknown): boolean {
  const codigo = erro && typeof erro === 'object' && 'code' in erro
    ? String((erro as { code?: unknown }).code ?? '')
    : ''
  return ['PGRST204', 'PGRST205', '42703', '42P01'].includes(codigo)
}

async function buscarDividasExportacao(db: NonNullable<typeof supabase>, familiaId: string): Promise<Registro[]> {
  const atual = await db.from('debts')
    .select('id, name, kind, reference_date, reference_balance, active, creditor, contract_number, payment_method, payment_account_id')
    .eq('household_id', familiaId).order('name')
  if (atual.error) {
    if (!schemaAindaNaoAplicado(atual.error)) throw atual.error
    const legado = await db.from('debts')
      .select('id, name, kind, reference_date, reference_balance, active')
      .eq('household_id', familiaId).order('name')
    if (legado.error) throw legado.error
    return (legado.data ?? []) as Registro[]
  }
  return (atual.data ?? []) as Registro[]
}

async function buscarEventosExportacao(db: NonNullable<typeof supabase>, familiaId: string): Promise<Registro[]> {
  try {
    return await todas(() => db.from('debt_events')
      .select('id, debt_id, date, kind, amount, account_id, installment_id, invoice_id, category_id, note, schedule_id, op_id')
      .eq('household_id', familiaId).is('voided_at', null).order('date').order('id'))
  } catch (erro) {
    if (!schemaAindaNaoAplicado(erro)) throw erro
    return todas(() => db.from('debt_events')
      .select('id, debt_id, date, kind, amount, account_id, installment_id, invoice_id, category_id, note, op_id')
      .eq('household_id', familiaId).is('voided_at', null).order('date').order('id'))
  }
}

async function buscarAgendaDividasExportacao(db: NonNullable<typeof supabase>, familiaId: string): Promise<Registro[]> {
  try {
    return await todas(() => db.from('debt_payment_schedule')
      .select('id, debt_id, installment_number, due_date, amount, status, payment_op_id, payment_date')
      .eq('household_id', familiaId).order('due_date').order('id'))
  } catch (erro) {
    if (!schemaAindaNaoAplicado(erro)) throw erro
    return []
  }
}

const rotuloOrigem: Record<string, string> = { opening: 'Saldo inicial', transaction: 'Lançamento', debt: 'Cartão/dívida' }
const rotuloDivida: Record<string, string> = { card: 'Cartão', loan: 'Empréstimo', financing: 'Financiamento' }
const rotuloEvento: Record<string, string> = {
  charge: 'Cobrança de parcela', credit: 'Estorno', cancel: 'Cancelamento de parcela', payment: 'Pagamento',
  extra_principal: 'Amortização extra', interest: 'Juros', fee: 'Tarifa', disbursement: 'Liberação de crédito',
  refund_cash: 'Devolução em dinheiro', payroll_payment: 'Consignado (amortização)',
  income_credit: 'Crédito no cartão (receita)',
}

/**
 * Efeito de cada evento na dívida: a MESMA regra de public.debt_balances (migration 003).
 * +1 aumenta a dívida, −1 reduz, 0 não mexe (juros e tarifa saem da conta; cancelamento só reduz parcela futura).
 * Com isso, valor de referência + soma da coluna "Efeito na dívida" (até a data) = dívida do arquivo de cadastros.
 */
export const efeitoNaDivida: Record<string, 1 | -1 | 0> = {
  disbursement: 1, charge: 1, refund_cash: 1, payment: -1, extra_principal: -1, credit: -1, payroll_payment: -1, income_credit: -1, interest: 0, fee: 0, cancel: 0,
}

const texto = (v: unknown) => (v === null || v === undefined ? '' : String(v))
const centavos = (v: unknown) => ({ centavos: centsFromDb((v ?? 0) as number | string) })
/** Vazio quando o banco não devolveu valor (ex.: conta aberta depois de hoje), em vez de um 0,00 inventado. */
const talvez = (v: unknown): Celula => (v === null || v === undefined ? '' : centavos(v))

/**
 * Quantidade, preço unitário e participação (até 12 e 10 casas, não são centavos): o texto exato do banco
 * (lido com `::text`), só trocando o ponto pela vírgula. Nenhuma conta no front.
 */
const decimalTexto = (v: unknown) => texto(v).replace('.', ',')

const rotuloClasse: Record<string, string> = {
  fixed_income: 'Renda fixa', equity: 'Ações', fund: 'Fundos de investimento', reit: 'FIIs / REITs', etf: 'ETFs',
  crypto: 'Criptoativos', other: 'Outros',
}
const rotuloProvento: Record<string, string> = { dividend: 'Dividendos', jcp: 'JCP', income: 'Rendimentos' }
const rotuloTipoBem: Record<string, string> = { real_estate: 'Imóvel', vehicle: 'Veículo', collectible: 'Bem de valor', other: 'Outro' }
const rotuloSituacaoBem: Record<string, string> = { active: 'Ativo', sold: 'Vendido', disposed: 'Baixado' }

/** Lançamento ligado ao provento (o valor e a data do provento são os do lançamento). */
type LancamentoProvento = { date?: unknown; amount?: unknown; status?: unknown; deleted_at?: unknown; account_id?: unknown }

/**
 * Arquivo 7: cada ativo seguido das suas operações (inclusive as anuladas), avaliações e proventos, por data.
 * O provento também está no arquivo 1 (é uma receita na conta); aqui só aparece ligado ao ativo.
 */
function linhasInvestimentos(
  ativos: Registro[], operacoes: Registro[], avaliacoes: Registro[], proventos: Registro[], nomeConta: Map<unknown, string>,
): Celula[][] {
  const linhas: Celula[][] = []
  for (const a of ativos) {
    const base = (registro: string): Celula[] => [
      registro, texto(a.name), texto(a.ticker), rotuloClasse[texto(a.asset_class)] ?? texto(a.asset_class), texto(a.subclass), texto(a.currency_code),
    ]
    linhas.push([...base('Ativo'), '', '', '', '', '', '', '', a.active ? 'Ativo' : 'Arquivado', ''])
    const doAtivo: [string, Celula[]][] = [
      ...operacoes.filter((o) => o.asset_id === a.id).map((o): [string, Celula[]] => [texto(o.operation_date), [
        ...base('Operação'), dataBR(texto(o.operation_date)), o.kind === 'sell' ? 'Venda' : 'Compra',
        decimalTexto(o.quantity), decimalTexto(o.unit_price), centavos(o.fees), '', '',
        o.voided_at ? 'Anulada' : 'Válida', [texto(o.notes), o.voided_at ? `Anulada: ${texto(o.void_reason)}` : ''].filter(Boolean).join(' · '),
      ]]),
      ...avaliacoes.filter((v) => v.asset_id === a.id).map((v): [string, Celula[]] => [texto(v.valuation_date), [
        ...base('Avaliação'), dataBR(texto(v.valuation_date)), 'Avaliação', '', decimalTexto(v.unit_price), '', '', '', '', texto(v.source),
      ]]),
      ...proventos.filter((p) => p.asset_id === a.id).map((p): [string, Celula[]] => {
        const t = (p.transaction ?? {}) as LancamentoProvento
        const situacao = t.deleted_at ? 'Na lixeira' : t.status === 'planned' ? 'Planejado' : 'Pago'
        return [texto(t.date), [
          ...base('Provento'), dataBR(texto(t.date)), rotuloProvento[texto(p.kind)] ?? texto(p.kind), '', '', '', talvez(t.amount),
          t.account_id ? nomeConta.get(t.account_id) ?? '' : '', situacao, '',
        ]]
      }),
    ]
    // ordem por data (texto AAAA-MM-DD); no mesmo dia, operações, avaliações e proventos nessa ordem
    doAtivo.map((x, i) => [x, i] as const).sort((p, q) => (p[0][0] < q[0][0] ? -1 : p[0][0] > q[0][0] ? 1 : p[1] - q[1]))
      .forEach(([x]) => linhas.push(x[1]))
  }
  return linhas
}

/** Arquivo 8: cada bem seguido das suas avaliações (valor total do bem, na moeda dele; a parte da família não é calculada aqui). */
function linhasBens(bens: Registro[], avaliacoes: Registro[]): Celula[][] {
  const linhas: Celula[][] = []
  for (const b of bens) {
    linhas.push([
      'Bem', texto(b.name), rotuloTipoBem[texto(b.asset_type)] ?? texto(b.asset_type), texto(b.currency_code), texto(b.ownership_label),
      decimalTexto(b.household_share), dataBR(texto(b.acquired_on)), dataBR(texto(b.ended_on)), '', '', '',
      rotuloSituacaoBem[texto(b.status)] ?? texto(b.status), texto(b.description),
    ])
    for (const v of avaliacoes.filter((x) => x.asset_id === b.id)) {
      linhas.push([
        'Avaliação', texto(b.name), '', texto(b.currency_code), '', '', '', '', dataBR(texto(v.valuation_date)), centavos(v.total_value),
        texto(v.source), '', texto(v.notes),
      ])
    }
  }
  return linhas
}

/** Moeda da conta exportada (valores do saldo e dos movimentos estão nela); sem a coluna no banco, BRL. */
function moedaDaConta(c: Registro): string {
  return typeof c.currency_code === 'string' && c.currency_code ? c.currency_code : 'BRL'
}

/** Os 8 arquivos da exportação completa, com saldos na data `hoje` (YYYY-MM-DD, fuso de São Paulo). */
export async function exportacaoCompleta(familiaId: string, hoje: string): Promise<ArquivoExportado[]> {
  if (!supabase) throw new Error('Supabase não configurado')
  const db = supabase
  // moeda da conta (migration 055); banco ainda sem a coluna: lê sem ela e tudo sai como BRL
  const lerContas = async (colunas: string): Promise<{ data: unknown; error: { code?: string } | null }> =>
    db.from('accounts').select(colunas).eq('household_id', familiaId).order('name')
  const [contas, categorias, listaDividas, faturas, saldos, saldosDividas] = await Promise.all([
    lerContas('id, name, type, initial_balance, opening_date, active, currency_code')
      .then((r) => (r.error?.code === COLUNA_INEXISTENTE ? lerContas('id, name, type, initial_balance, opening_date, active') : r)),
    db.from('categories').select('id, name').eq('household_id', familiaId),
    buscarDividasExportacao(db, familiaId),
    db.from('debt_invoices').select('id, label').eq('household_id', familiaId),
    db.rpc('account_balances', { p_household: familiaId, p_as_of: hoje }),
    db.rpc('debt_balances', { p_household: familiaId, p_as_of: hoje }),
  ])
  for (const r of [contas, categorias, faturas, saldos, saldosDividas]) if (r.error) throw r.error
  const listaContas = (contas.data ?? []) as Registro[]
  const nomeConta = new Map(listaContas.map((c) => [c.id, texto(c.name)]))
  const nomeDivida = new Map(listaDividas.map((d) => [d.id, texto(d.name)]))
  const nomeCategoria = new Map(((categorias.data ?? []) as Registro[]).map((c) => [c.id, texto(c.name)]))
  const rotuloFatura = new Map(((faturas.data ?? []) as Registro[]).map((f) => [f.id, texto(f.label)]))
  const saldoConta = new Map(((saldos.data ?? []) as Registro[]).map((s) => [s.account_id, s.balance]))
  const saldoDivida = new Map(((saldosDividas.data ?? []) as Registro[]).map((s) => [s.debt_id, s]))

  const [lancamentos, parcelas, eventos, agendaDividas, ativos, operacoes, avaliacoes, proventos, bens, avaliacoesBens, ...movimentosPorConta] = await Promise.all([
    lancamentosParaExportar(familiaId),
    todas(() => db.from('debt_installments')
      .select('id, debt_id, plan, seq, description, purchase_date, due_date, face, category_id')
      .eq('household_id', familiaId).order('due_date').order('id')),
    buscarEventosExportacao(db, familiaId),
    buscarAgendaDividasExportacao(db, familiaId),
    todas(() => db.from('investment_assets').select('id, name, ticker, asset_class, subclass, currency_code, active')
      .eq('household_id', familiaId).order('name').order('id')),
    todas(() => db.from('investment_operations')
      .select('id, asset_id, operation_date, kind, quantity::text, unit_price::text, fees, notes, voided_at, void_reason')
      .eq('household_id', familiaId).order('operation_date').order('id')),
    todas(() => db.from('investment_valuations').select('id, asset_id, valuation_date, unit_price::text, source')
      .eq('household_id', familiaId).order('valuation_date').order('id')),
    todas(() => db.from('investment_distributions')
      .select('id, asset_id, kind, transaction:transactions(date, amount, status, deleted_at, account_id)')
      .eq('household_id', familiaId).order('id')),
    todas(() => db.from('family_assets')
      .select('id, name, asset_type, description, currency_code, ownership_label, household_share::text, acquired_on, status, ended_on')
      .eq('household_id', familiaId).order('name').order('id')),
    todas(() => db.from('family_asset_valuations').select('id, asset_id, valuation_date, total_value, source, notes')
      .eq('household_id', familiaId).order('valuation_date').order('id')),
    ...listaContas.map((c) => todas(() => db.rpc('account_movements', { p_account: c.id, p_to: hoje })
      .order('date').order('source').order('id'))),
  ])

  // "n/N": N = parcelas do mesmo plano no cartão (contagem, não dinheiro)
  const totalDoPlano = new Map<string, number>()
  for (const p of parcelas) totalDoPlano.set(`${p.debt_id}|${p.plan}`, (totalDoPlano.get(`${p.debt_id}|${p.plan}`) ?? 0) + 1)
  const parcelaPorId = new Map(parcelas.map((p) => [p.id, p]))
  const dividaPorId = new Map(listaDividas.map((d) => [d.id, d]))
  const agendaPorId = new Map(agendaDividas.map((p) => [p.id, p]))
  // situação da parcela pelos eventos que existem (rótulo, sem conta de dinheiro; os valores estão no arquivo 5)
  const comCobranca = new Set(eventos.filter((e) => e.kind === 'charge').map((e) => e.installment_id))
  const comCancelamento = new Set(eventos.filter((e) => e.kind === 'cancel').map((e) => e.installment_id))
  const situacaoParcela = (id: unknown) =>
    comCancelamento.has(id) ? 'Com cancelamento (ver eventos)' : comCobranca.has(id) ? 'Cobrada' : 'A cobrar'

  const movimentos: Celula[][] = []
  listaContas.forEach((c, i) => {
    for (const m of movimentosPorConta[i]) {
      movimentos.push([
        texto(c.name), dataBR(texto(m.date)), rotuloOrigem[texto(m.source)] ?? texto(m.source),
        texto(m.description) || 'Sem descrição', centavos(m.amount), moedaDaConta(c),
      ])
    }
  })

  const cadastros: Celula[][] = [
    ...listaContas.map((c): Celula[] => [
      'Conta', texto(c.name), rotuloDoTipo(texto(c.type)), dataBR(texto(c.opening_date)),
      centavos(c.initial_balance), moedaDaConta(c), c.active ? 'Sim' : 'Não', talvez(saldoConta.get(c.id)), '',
    ]),
    ...listaDividas.map((d): Celula[] => {
      const s = saldoDivida.get(d.id)
      return [
        rotuloDivida[texto(d.kind)] ?? texto(d.kind), texto(d.name), '', dataBR(texto(d.reference_date)),
        centavos(d.reference_balance), 'BRL', d.active ? 'Sim' : 'Não', talvez(s?.balance), talvez(s?.planned_remaining),
      ]
    }),
  ]

  const linhasParcelas: Celula[][] = parcelas.map((p) => [
    nomeDivida.get(p.debt_id) ?? '', texto(p.description) || texto(p.plan), `${texto(p.seq)}/${totalDoPlano.get(`${p.debt_id}|${p.plan}`)}`,
    dataBR(texto(p.purchase_date)), dataBR(texto(p.due_date)), nomeCategoria.get(p.category_id) ?? '', centavos(p.face),
    situacaoParcela(p.id),
  ])

  const linhasAgendaDividas: Celula[][] = agendaDividas.map((p) => {
    const d = dividaPorId.get(p.debt_id)
    const forma = texto(d?.payment_method)
    const formaRotulo = forma === 'account_debit' ? 'Débito automático'
      : forma === 'boleto' ? 'Boleto' : forma === 'payroll' ? 'Consignado' : forma === 'manual' ? 'Manual' : forma
    return [
      nomeDivida.get(p.debt_id) ?? '', texto(d?.creditor), texto(d?.contract_number),
      texto(p.installment_number), dataBR(texto(p.due_date)), centavos(p.amount),
      p.status === 'paid' ? 'Paga' : p.status === 'cancelled' ? 'Cancelada' : 'Planejada',
      dataBR(texto(p.payment_date)), formaRotulo,
      d?.payment_account_id ? nomeConta.get(d.payment_account_id) ?? '' : '',
      texto(p.payment_op_id),
    ]
  })

  const linhasEventos: Celula[][] = eventos.map((e) => {
    const parcela = e.installment_id ? parcelaPorId.get(e.installment_id) : undefined
    const parcelaContrato = e.schedule_id ? agendaPorId.get(e.schedule_id) : undefined
    const efeito = efeitoNaDivida[texto(e.kind)] ?? 0
    const valor = centsFromDb(e.amount as number | string)
    return [
      nomeDivida.get(e.debt_id) ?? '', dataBR(texto(e.date)), rotuloEvento[texto(e.kind)] ?? texto(e.kind), { centavos: valor },
      { centavos: (efeito === 0 ? 0 : efeito * valor) as Cents }, texto(e.date) <= hoje ? 'Sim' : 'Não',
      e.account_id ? nomeConta.get(e.account_id) ?? '' : '', e.invoice_id ? rotuloFatura.get(e.invoice_id) ?? '' : '',
      parcela ? `${texto(parcela.description) || texto(parcela.plan)} ${texto(parcela.seq)}/${totalDoPlano.get(`${parcela.debt_id}|${parcela.plan}`)}` : '',
      parcelaContrato ? `Parcela ${texto(parcelaContrato.installment_number)}` : '',
      e.category_id ? nomeCategoria.get(e.category_id) ?? '' : '', texto(e.note),
    ]
  })

  const linhasInv = linhasInvestimentos(ativos, operacoes, avaliacoes, proventos, nomeConta)
  const linhasBem = linhasBens(bens, avaliacoesBens)

  return [
    { nome: `tudo-azul-${hoje}-1-lancamentos.csv`, conteudo: gerarCsv(lancamentos), linhas: lancamentos.length },
    {
      nome: `tudo-azul-${hoje}-2-movimentos-por-conta.csv`, linhas: movimentos.length,
      conteudo: montarCsv(['Conta', 'Data', 'Origem', 'Descrição', 'Valor', 'Moeda'], movimentos),
    },
    {
      nome: `tudo-azul-${hoje}-3-cadastros.csv`, linhas: cadastros.length,
      conteudo: montarCsv(['Cadastro', 'Nome', 'Tipo', 'Data inicial', 'Valor inicial', 'Moeda', 'Ativo',
        `Saldo em ${dataBR(hoje)}`, 'Parcelas futuras'], cadastros),
    },
    {
      nome: `tudo-azul-${hoje}-4-parcelas-cartao.csv`, linhas: linhasParcelas.length,
      conteudo: montarCsv(['Cartão', 'Descrição', 'Parcela', 'Data da compra', 'Fechamento da fatura', 'Categoria', 'Valor da parcela', 'Situação'], linhasParcelas),
    },
    {
      nome: `tudo-azul-${hoje}-5-eventos-cartao-e-dividas.csv`, linhas: linhasEventos.length,
      conteudo: montarCsv(['Cartão/dívida', 'Data', 'Evento', 'Valor', 'Efeito na dívida', `Até ${dataBR(hoje)}`, 'Conta', 'Fatura',
        'Parcela do cartão', 'Parcela do contrato', 'Categoria', 'Observação'], linhasEventos),
    },
    {
      nome: `tudo-azul-${hoje}-6-agenda-parcelas-dividas.csv`, linhas: linhasAgendaDividas.length,
      conteudo: montarCsv(['Dívida', 'Credor', 'Contrato', 'Parcela', 'Vencimento', 'Valor', 'Situação',
        'Data do pagamento', 'Forma de pagamento', 'Conta de pagamento', 'Operação'], linhasAgendaDividas),
    },
    {
      nome: `tudo-azul-${hoje}-7-investimentos.csv`, linhas: linhasInv.length,
      conteudo: montarCsv(['Registro', 'Ativo', 'Ticker', 'Classe', 'Subclasse', 'Moeda', 'Data', 'Tipo', 'Quantidade', 'Preço unitário',
        'Taxas', 'Valor do provento', 'Conta', 'Situação', 'Observação'], linhasInv),
    },
    {
      nome: `tudo-azul-${hoje}-8-bens.csv`, linhas: linhasBem.length,
      conteudo: montarCsv(['Registro', 'Bem', 'Tipo', 'Moeda', 'Titularidade', 'Participação da família (%)', 'Aquisição', 'Encerramento',
        'Data da avaliação', 'Valor total', 'Fonte', 'Situação', 'Observação'], linhasBem),
    },
  ]
}

/** Data do lançamento mais antigo da família (fora da lixeira); null sem lançamentos. Para "desde o primeiro dia de uso". */
export async function primeiraDataDeLancamento(familiaId: string): Promise<string | null> {
  if (!supabase) throw new Error('Supabase não configurado')
  const { data, error } = await supabase.from('transactions').select('date').eq('household_id', familiaId)
    .is('deleted_at', null).order('date', { ascending: true }).limit(1)
  if (error) throw error
  return ((data ?? []) as { date: string }[])[0]?.date ?? null
}
