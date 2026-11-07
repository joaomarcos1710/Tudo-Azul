// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mock = vi.hoisted(() => ({ listar: vi.fn(), criar: vi.fn(), atualizar: vi.fn(), status: vi.fn() }))
vi.mock('../lib/pessoasFamilia', () => ({
  listarPessoasFamilia: mock.listar,
  criarPessoaFamilia: mock.criar,
  atualizarPessoaFamilia: mock.atualizar,
  definirStatusPessoaFamilia: mock.status,
  VINCULOS_PESSOA: ['Conhecido', 'Familiar', 'Companheiro(a)', 'Pai/Mãe', 'Filho(a)', 'Irmão/Irmã', 'Pet', 'Amigo(a)'],
}))
vi.mock('../lib/familia', () => ({ mensagemErroBanco: () => 'Não foi possível concluir a operação.' }))

import { PessoasFamilia } from './PessoasFamilia'

const pessoa = {
  id: 'p1', familiaId: 'h1', nome: 'Mariane', fotoUrl: null, nascimento: null,
  vinculo: 'Companheiro(a)' as const, ativo: true,
  criadaEm: '2026-11-06T00:00:00Z', atualizadaEm: '2026-11-06T00:00:00Z',
}

beforeEach(() => {
  mock.listar.mockResolvedValue([])
  mock.criar.mockResolvedValue(pessoa)
  mock.atualizar.mockResolvedValue(undefined)
  mock.status.mockResolvedValue(undefined)
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('Pessoas da família', () => {
  it('mostra estado vazio e exige nome e vínculo para criar', async () => {
    render(<PessoasFamilia familiaId="h1" />)
    expect(await screen.findByText('Nenhuma pessoa cadastrada')).toBeTruthy()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '+ Criar pessoa' }))
    expect(screen.getByRole('button', { name: 'Criar membro' }).hasAttribute('disabled')).toBe(true)
    await user.type(screen.getByLabelText('Nome e sobrenome'), 'Bidu')
    await user.selectOptions(screen.getByLabelText('Vínculo com a família'), 'Pet')
    expect(screen.getByRole('button', { name: 'Criar membro' }).hasAttribute('disabled')).toBe(false)
    await user.click(screen.getByRole('button', { name: 'Criar membro' }))
    expect(mock.criar).toHaveBeenCalledWith('h1', { nome: 'Bidu', nascimento: null, vinculo: 'Pet', fotoUrl: null })
  })

  it('edita os dados descritivos de uma pessoa', async () => {
    mock.listar.mockResolvedValue([pessoa])
    render(<PessoasFamilia familiaId="h1" />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Editar' }))
    const nome = screen.getByLabelText('Nome e sobrenome') as HTMLInputElement
    await user.clear(nome)
    await user.type(nome, 'Mariane Silva')
    await user.click(screen.getByRole('button', { name: 'Salvar alterações' }))
    expect(mock.atualizar).toHaveBeenCalledWith('h1', 'p1', {
      nome: 'Mariane Silva', nascimento: null, vinculo: 'Companheiro(a)', fotoUrl: null,
    })
  })

  it('inativa sem oferecer exclusão', async () => {
    mock.listar.mockResolvedValue([pessoa])
    render(<PessoasFamilia familiaId="h1" />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Inativar' }))
    expect(mock.status).toHaveBeenCalledWith('h1', 'p1', false)
    expect(screen.queryByRole('button', { name: 'Excluir' })).toBeNull()
  })
})
