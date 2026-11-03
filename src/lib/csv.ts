import { centsFromDb } from './format'
import type { Cents } from './format'
import { rotuloTipoConta } from './contas'
import type { TipoConta } from './contas'
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
    ['Data', 'Tipo', 'Descrição', 'Categoria', 'Conta', 'Conta destino', 'Valor', 'Situação', 'Observações'],
    linhas.map((l) => [
      // valor com sinal pelo efeito: despesa negativa, receita positiva, transferência positiva (movimento entre contas)
      dataBR(l.data), rotulos[l.tipo], l.descricao, l.categoria, l.conta, l.contaDestino,
      { centavos: l.tipo === 'expense' ? (-l.valor as Cents) : l.valor }, l.situacao === 'paid' ? 'Pago' : 'Planejado', l.notas,
    ]),
  )
}

/** Todos os lançamentos fora da lixeira, com nomes de conta e categoria, em páginas de 1.000. */
export async function lancamentosParaExportar(familiaId: string, periodo?: { de: string; ate: string }): Promise<LinhaExportada[]> {
  if (!supabase) throw new Error('Supabase não configurado')
  const [contas, categorias] = await Promise.all([
    supabase.from('accounts').select('id, name').eq('household_id', familiaId),
    supabase.from('categories').select('id, name').eq('household_id', familiaId),
  ])
  if (contas.error) throw contas.error
  if (categorias.error) throw categorias.error
  const nomeConta = new Map((contas.data ?? []).map((c) => [c.id, c.name as string]))
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
        situacao: t.status,
        notas: t.notes ?? '',
      })
    }
    if (!data || data.length < pagina) break
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
// Exportação completa (critério 3 do corte): o que é preciso para conferir os saldos fora do app.
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
  let { data, error } = await db.from('debts')
    .select('id, name, kind, reference_date, reference_balance, active, creditor, contract_number, payment_method, payment_account_id')
    .eq('household_id', familiaId).order('name')
  if (error && schemaAindaNaoAplicado(error)) {
    const legado = await db.from('debts')
      .select('id, name, kind, reference_date, reference_balance, active')
      .eq('household_id', familiaId).order('name')
    data = legado.data
    error = legado.error
  }
  if (error) throw error
  return (data ?? []) as Registro[]
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
}

/**
 * Efeito de cada evento na dívida: a MESMA regra de public.debt_balances (migration 003).
 * +1 aumenta a dívida, −1 reduz, 0 não mexe (juros e tarifa saem da conta; cancelamento só reduz parcela futura).
 * Com isso, valor de referência + soma da coluna "Efeito na dívida" (até a data) = dívida do arquivo de cadastros.
 */
export const efeitoNaDivida: Record<string, 1 | -1 | 0> = {
  disbursement: 1, charge: 1, refund_cash: 1, payment: -1, extra_principal: -1, credit: -1, payroll_payment: -1, interest: 0, fee: 0, cancel: 0,
}

const texto = (v: unknown) => (v === null || v === undefined ? '' : String(v))
const centavos = (v: unknown) => ({ centavos: centsFromDb((v ?? 0) as number | string) })
/** Vazio quando o banco não devolveu valor (ex.: conta aberta depois de hoje), em vez de um 0,00 inventado. */
const talvez = (v: unknown): Celula => (v === null || v === undefined ? '' : centavos(v))

/** Os 5 arquivos da exportação completa, com saldos na data `hoje` (YYYY-MM-DD, fuso de São Paulo). */
export async function exportacaoCompleta(familiaId: string, hoje: string): Promise<ArquivoExportado[]> {
  if (!supabase) throw new Error('Supabase não configurado')
  const db = supabase
  const [contas, categorias, listaDividas, faturas, saldos, saldosDividas] = await Promise.all([
    db.from('accounts').select('id, name, type, initial_balance, opening_date, active').eq('household_id', familiaId).order('name'),
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

  const [lancamentos, parcelas, eventos, agendaDividas, ...movimentosPorConta] = await Promise.all([
    lancamentosParaExportar(familiaId),
    todas(() => db.from('debt_installments')
      .select('id, debt_id, plan, seq, description, purchase_date, due_date, face, category_id')
      .eq('household_id', familiaId).order('due_date').order('id')),
    buscarEventosExportacao(db, familiaId),
    buscarAgendaDividasExportacao(db, familiaId),
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
        texto(m.description) || 'Sem descrição', centavos(m.amount), m.reconciled ? 'Sim' : 'Não',
      ])
    }
  })

  const cadastros: Celula[][] = [
    ...listaContas.map((c): Celula[] => [
      'Conta', texto(c.name), rotuloTipoConta[c.type as TipoConta] ?? texto(c.type), dataBR(texto(c.opening_date)),
      centavos(c.initial_balance), c.active ? 'Sim' : 'Não', talvez(saldoConta.get(c.id)), '',
    ]),
    ...listaDividas.map((d): Celula[] => {
      const s = saldoDivida.get(d.id)
      return [
        rotuloDivida[texto(d.kind)] ?? texto(d.kind), texto(d.name), '', dataBR(texto(d.reference_date)),
        centavos(d.reference_balance), d.active ? 'Sim' : 'Não', talvez(s?.balance), talvez(s?.planned_remaining),
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

  return [
    { nome: `tudo-azul-${hoje}-1-lancamentos.csv`, conteudo: gerarCsv(lancamentos), linhas: lancamentos.length },
    {
      nome: `tudo-azul-${hoje}-2-movimentos-por-conta.csv`, linhas: movimentos.length,
      conteudo: montarCsv(['Conta', 'Data', 'Origem', 'Descrição', 'Valor', 'Conferido'], movimentos),
    },
    {
      nome: `tudo-azul-${hoje}-3-cadastros.csv`, linhas: cadastros.length,
      conteudo: montarCsv(['Cadastro', 'Nome', 'Tipo', 'Data inicial', 'Valor inicial', 'Ativo',
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
  ]
}
