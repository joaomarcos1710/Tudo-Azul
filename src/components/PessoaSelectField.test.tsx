// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PessoaSelectField } from './PessoaSelectField'
import type { PessoaFamilia } from '../lib/pessoasFamilia'

const pessoas: PessoaFamilia[] = [
  { id: 'p1', familiaId: 'h1', nome: 'Mariane', fotoUrl: null, nascimento: null, vinculo: 'Companheiro(a)', ativo: true, criadaEm: '', atualizadaEm: '' },
  { id: 'p2', familiaId: 'h1', nome: 'Bidu', fotoUrl: null, nascimento: null, vinculo: 'Pet', ativo: false, criadaEm: '', atualizadaEm: '' },
]

describe('PessoaSelectField', () => {
  it('distingue não classificada, toda a família e uma pessoa individual', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<PessoaSelectField pessoas={pessoas} personId={null} isSharedExpense={false} onChange={onChange} />)
    const select = screen.getByLabelText('Despesa de quem?')
    await user.selectOptions(select, 'shared')
    expect(onChange).toHaveBeenLastCalledWith({ personId: null, isSharedExpense: true })
    await user.selectOptions(select, 'p1')
    expect(onChange).toHaveBeenLastCalledWith({ personId: 'p1', isSharedExpense: false })
    await user.selectOptions(select, 'unassigned')
    expect(onChange).toHaveBeenLastCalledWith({ personId: null, isSharedExpense: false })
  })

  it('não oferece pessoas inativas em novos lançamentos, mas mantém a selecionada no histórico', () => {
    const onChange = vi.fn()
    const { rerender } = render(<PessoaSelectField pessoas={pessoas} personId={null} isSharedExpense={false} onChange={onChange} />)
    expect(screen.queryByRole('option', { name: 'Bidu (inativa)' })).toBeNull()
    rerender(<PessoaSelectField pessoas={pessoas} personId="p2" isSharedExpense={false} onChange={onChange} />)
    expect(screen.getByRole('option', { name: 'Bidu (inativa)' })).toBeTruthy()
  })
})
