import { centsFromDb } from './format'
import type { Cents } from './format'
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

export function gerarCsv(linhas: LinhaExportada[]): string {
  const cabecalho = ['Data', 'Tipo', 'Descrição', 'Categoria', 'Conta', 'Conta destino', 'Valor', 'Situação', 'Observações']
  const corpo = linhas.map((l) => {
    const [a, m, d] = l.data.split('-')
    // valor com sinal pelo efeito: despesa negativa, receita positiva, transferência positiva (movimento entre contas)
    const valor = l.tipo === 'expense' ? (-l.valor as Cents) : l.valor
    return [
      celula(`${d}/${m}/${a}`), celula(rotulos[l.tipo]), celula(l.descricao), celula(l.categoria), celula(l.conta),
      celula(l.contaDestino), celula(decimalBR(valor), false), celula(l.situacao === 'paid' ? 'Pago' : 'Planejado'), celula(l.notas),
    ].join(';')
  })
  return '﻿' + [cabecalho.join(';'), ...corpo].join('\r\n') + '\r\n'
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
