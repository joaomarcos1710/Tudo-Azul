import { describe, expect, it } from 'vitest'
import { gerarCsv } from './csv'
import type { LinhaExportada } from './csv'
import type { Cents } from './format'

const l = (extra: Partial<LinhaExportada>): LinhaExportada => ({
  data: '2026-10-15', tipo: 'expense', descricao: 'Mercado', categoria: 'Mercado', conta: 'Itaú', contaDestino: '',
  valor: 125050 as Cents, situacao: 'paid', notas: '', ...extra,
})

describe('gerarCsv', () => {
  it('formato brasileiro: BOM, ";", data DD/MM/AAAA, decimal com vírgula, despesa negativa', () => {
    const csv = gerarCsv([l({}), l({ tipo: 'income', descricao: 'Salário', valor: 800000 as Cents, situacao: 'planned' })])
    const linhas = csv.split('\r\n')
    expect(csv.startsWith('﻿')).toBe(true)
    expect(linhas[0]).toBe('﻿Data;Tipo;Descrição;Categoria;Conta;Conta destino;Valor;Situação;Observações')
    expect(linhas[1]).toBe('15/10/2026;Despesa;Mercado;Mercado;Itaú;;-1250,50;Pago;')
    expect(linhas[2]).toBe('15/10/2026;Receita;Salário;Mercado;Itaú;;8000,00;Planejado;')
  })
  it('transferência leva as duas contas e valor positivo', () => {
    const csv = gerarCsv([l({ tipo: 'transfer', categoria: '', contaDestino: 'Nubank', valor: 5 as Cents })])
    expect(csv.split('\r\n')[1]).toBe('15/10/2026;Transferência;Mercado;;Itaú;Nubank;0,05;Pago;')
  })
  it('protege ";", aspas, quebras de linha e fórmulas', () => {
    const csv = gerarCsv([l({ descricao: 'Pão; leite "integral"', notas: 'linha 1\nlinha 2', categoria: '=SOMA(A1)' })])
    expect(csv).toContain('"Pão; leite ""integral"""')
    expect(csv).toContain('"linha 1\nlinha 2"')
    expect(csv).toContain(";'=SOMA(A1);")
  })
})
