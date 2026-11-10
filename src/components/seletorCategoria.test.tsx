// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import type { Categoria } from '../lib/categorias'

const mock = vi.hoisted(() => ({ criarCategoriaRapida: vi.fn() }))
vi.mock('../lib/FamiliaContext', () => ({
  useFamilia: () => ({ familia: { id: 'h1', nome: 'Casa', papel: 'owner' }, carregando: false, erro: false, recarregar: vi.fn() }),
}))
vi.mock('../lib/categorias', async (original) => ({
  ...(await original<typeof import('../lib/categorias')>()),
  criarCategoriaRapida: mock.criarCategoriaRapida,
}))

import { SeletorCategoria } from './SeletorCategoria'

const cat = (id: string, nome: string, paiId: string | null = null): Categoria =>
  ({ id, nome, tipo: 'expense', paiId, sistema: false, ativa: true, eventual: false })
const categorias = [cat('ali', 'Alimentação'), cat('caf', 'Cafeteria', 'ali'), cat('pad', 'Padaria', 'ali'), cat('ass', 'Assinaturas e serviços'), cat('net', 'Netflix', 'ass')]

function Host({ comCriar = true }: { comCriar?: boolean }) {
  const [valor, setValor] = useState('')
  const [lista, setLista] = useState(categorias)
  return (
    <>
      <SeletorCategoria rotulo="Categoria" valor={valor} aoMudar={setValor} opcoes={lista} categorias={lista} tipo="expense"
        aoCriada={comCriar ? (c) => setLista((l) => [...l, c]) : undefined} />
      <output data-testid="valor">{valor}</output>
    </>
  )
}

afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('SeletorCategoria (como no Organizze)', () => {
  it('abre a folha; a principal vem com as subcategorias embaixo; tocar escolhe e fecha', async () => {
    const u = userEvent.setup()
    render(<Host />)
    const botao = screen.getByLabelText('Categoria')
    expect(botao.textContent).toBe('Escolher')
    await u.click(botao)
    const folha = screen.getByRole('dialog', { name: 'Selecionar uma categoria' })
    const nomes = Array.from(folha.querySelectorAll('[data-categoria-id]')).map((b) => b.textContent)
    expect(nomes).toEqual(['Alimentação', 'Cafeteria', 'Padaria', 'Assinaturas e serviços', 'Netflix'])
    await u.click(within(folha).getByRole('button', { name: 'Padaria' }))
    expect(screen.queryByRole('dialog', { name: 'Selecionar uma categoria' })).toBeNull()
    expect(screen.getByTestId('valor').textContent).toBe('pad')
    expect(screen.getByLabelText('Categoria').textContent).toContain('Padaria')
  })

  it('busca pelo nome e pela principal; sem resultado avisa', async () => {
    const u = userEvent.setup()
    render(<Host />)
    await u.click(screen.getByLabelText('Categoria'))
    const folha = screen.getByRole('dialog', { name: 'Selecionar uma categoria' })
    await u.type(within(folha).getByLabelText('Buscar uma categoria'), 'netf')
    expect(Array.from(folha.querySelectorAll('[data-categoria-id]')).map((b) => b.textContent)).toEqual(['Netflix'])
    await u.clear(within(folha).getByLabelText('Buscar uma categoria'))
    await u.type(within(folha).getByLabelText('Buscar uma categoria'), 'alimen')
    // a subcategoria aparece também quando a busca acerta o nome da principal
    expect(Array.from(folha.querySelectorAll('[data-categoria-id]')).map((b) => b.textContent)).toEqual(['Alimentação', 'Cafeteria', 'Padaria'])
    await u.clear(within(folha).getByLabelText('Buscar uma categoria'))
    await u.type(within(folha).getByLabelText('Buscar uma categoria'), 'xyz')
    expect(within(folha).getByText('Nenhuma categoria com esse nome.')).toBeTruthy()
  })

  it('lista e grade: o botão do modo fica marcado e a grade mostra as mesmas categorias', async () => {
    const u = userEvent.setup()
    render(<Host />)
    await u.click(screen.getByLabelText('Categoria'))
    const folha = screen.getByRole('dialog', { name: 'Selecionar uma categoria' })
    expect(within(folha).getByRole('button', { name: 'Lista' }).getAttribute('aria-pressed')).toBe('true')
    await u.click(within(folha).getByRole('button', { name: 'Grade' }))
    expect(within(folha).getByRole('button', { name: 'Grade' }).getAttribute('aria-pressed')).toBe('true')
    expect(folha.querySelectorAll('[data-categoria-id]')).toHaveLength(5)
  })

  it('Criar categoria: cria no banco, entra na lista e já fica escolhida', async () => {
    mock.criarCategoriaRapida.mockResolvedValue(cat('nova', 'Sorveteria'))
    const u = userEvent.setup()
    render(<Host />)
    await u.click(screen.getByLabelText('Categoria'))
    const folha = screen.getByRole('dialog', { name: 'Selecionar uma categoria' })
    await u.type(within(folha).getByLabelText('Buscar uma categoria'), 'Sorveteria')
    await u.click(within(folha).getByRole('button', { name: 'Criar categoria' }))
    // o nome buscado já vem preenchido
    expect((within(folha).getByLabelText('Nome da nova categoria') as HTMLInputElement).value).toBe('Sorveteria')
    await u.click(within(folha).getByRole('button', { name: 'Criar' }))
    expect(mock.criarCategoriaRapida).toHaveBeenCalledWith('h1', 'Sorveteria', 'expense')
    expect(screen.getByTestId('valor').textContent).toBe('nova')
    expect(screen.getByLabelText('Categoria').textContent).toContain('Sorveteria')
  })

  it('Criar categoria: nome vazio não chama o banco; erro do banco aparece e a folha continua', async () => {
    mock.criarCategoriaRapida.mockRejectedValue({ code: '23505', message: 'duplicate key value violates unique constraint' })
    const u = userEvent.setup()
    render(<Host />)
    await u.click(screen.getByLabelText('Categoria'))
    const folha = screen.getByRole('dialog', { name: 'Selecionar uma categoria' })
    await u.click(within(folha).getByRole('button', { name: 'Criar categoria' }))
    await u.click(within(folha).getByRole('button', { name: 'Criar' }))
    expect(within(folha).getByRole('alert').textContent).toBe('Informe o nome.')
    expect(mock.criarCategoriaRapida).not.toHaveBeenCalled()
    await u.type(within(folha).getByLabelText('Nome da nova categoria'), 'Padaria')
    await u.click(within(folha).getByRole('button', { name: 'Criar' }))
    expect(within(folha).getByRole('alert')).toBeTruthy()
    expect(screen.getByRole('dialog', { name: 'Selecionar uma categoria' })).toBeTruthy()
    expect(screen.getByTestId('valor').textContent).toBe('')
  })

  it('sem aoCriada não oferece "Criar categoria"', async () => {
    const u = userEvent.setup()
    render(<Host comCriar={false} />)
    await u.click(screen.getByLabelText('Categoria'))
    expect(screen.queryByRole('button', { name: 'Criar categoria' })).toBeNull()
  })
})
