import { describe, expect, it } from 'vitest'
import { mensagemErroBanco } from './erros'

describe('mensagemErroBanco', () => {
  it('mostra o texto do banco em português e converte datas para DD/MM/AAAA (período conciliado)', () => {
    const erro = { code: '55000', message: 'a conta já foi conciliada até 2026-10-05 : lançamento nesse período não pode ser alterado' }
    expect(mensagemErroBanco(erro)).toBe('A conta já foi conciliada até 05/10/2026 : lançamento nesse período não pode ser alterado.')
  })
  it('não inventa data onde não há', () => {
    expect(mensagemErroBanco({ code: '22023', message: 'valor 1234-5 inválido' })).toBe('Valor 1234-5 inválido.')
  })
  it('esconde detalhe técnico e trata permissão e rede', () => {
    expect(mensagemErroBanco({ code: '23514', message: 'violates check constraint "x"' })).toMatch(/Não foi possível concluir/)
    expect(mensagemErroBanco({ code: '42501', message: 'x' })).toBe('Você não tem permissão para esta ação.')
    expect(mensagemErroBanco(new Error('Failed to fetch'))).toMatch(/Sem conexão/)
  })
})
