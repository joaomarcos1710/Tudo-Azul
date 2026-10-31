import { describe, expect, it } from 'vitest'
import { mensagemErroBanco } from './erros'

describe('mensagemErroBanco', () => {
  it('mostra uma mensagem de estado inválido em português e converte datas para DD/MM/AAAA', () => {
    const erro = { code: '55000', message: 'a operação não está disponível desde 2026-10-05' }
    expect(mensagemErroBanco(erro)).toBe('A operação não está disponível desde 05/10/2026.')
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

describe('erros de rede do Safari/iOS', () => {
  it('"Load failed" e "internet connection appears to be offline" viram "Sem conexão"', () => {
    for (const m of ['Load failed', 'The Internet connection appears to be offline.', 'Failed to fetch']) {
      expect(mensagemErroBanco(new Error(m)), m).toMatch(/Sem conexão/)
    }
  })
})
