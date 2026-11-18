// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
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
    // a principal não entrou na busca: a filha traz "em Principal" para não perder o contexto
    expect(Array.from(folha.querySelectorAll('[data-categoria-id]')).map((b) => b.textContent)).toEqual(['Netflixem Assinaturas e serviços'])
    expect(within(folha).getByText('em Assinaturas e serviços')).toBeTruthy()
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

  it('o botão fechado mostra "Principal › Filha"; principal escolhida mostra só o nome', async () => {
    const u = userEvent.setup()
    render(<Host />)
    await u.click(screen.getByLabelText('Categoria'))
    await u.click(within(screen.getByRole('dialog', { name: 'Selecionar uma categoria' })).getByRole('button', { name: 'Padaria' }))
    expect(screen.getByLabelText('Categoria').textContent).toBe('Alimentação › Padaria')
    await u.click(screen.getByLabelText('Categoria'))
    await u.click(within(screen.getByRole('dialog', { name: 'Selecionar uma categoria' })).getByRole('button', { name: 'Alimentação' }))
    expect(screen.getByLabelText('Categoria').textContent).toBe('Alimentação')
  })

  it('na grade, cada principal é um cabeçalho de linha inteira e as filhas ficam embaixo', async () => {
    const u = userEvent.setup()
    render(<Host />)
    await u.click(screen.getByLabelText('Categoria'))
    const folha = screen.getByRole('dialog', { name: 'Selecionar uma categoria' })
    await u.click(within(folha).getByRole('button', { name: 'Grade' }))
    const principais = Array.from(folha.querySelectorAll('li.col-span-4 [data-categoria-id]')).map((b) => b.textContent)
    expect(principais).toEqual(['Alimentação', 'Assinaturas e serviços'])
    // a filha não é cabeçalho
    expect(folha.querySelector('li.col-span-4 [data-categoria-id="caf"]')).toBeNull()
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

describe('SeletorCategoria no computador: a lista abre embaixo do campo, sem pop-up (pedido do dono, 18/11/2026)', () => {
  /** matchMedia só existe no navegador: aqui ele diz que a tela tem a largura do computador (lg). */
  function telaDoComputador(ehComputador: boolean) {
    window.matchMedia = ((q: string) => ({ matches: ehComputador && q === '(min-width: 1024px)', media: q, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as unknown as typeof window.matchMedia
  }
  beforeEach(() => telaDoComputador(true))
  afterEach(() => { delete (window as { matchMedia?: unknown }).matchMedia })
  const lista = () => screen.getByTestId('lista-categorias')

  it('não abre pop-up: a lista aparece junto do campo, com a principal e as filhas embaixo, e tocar escolhe e fecha', async () => {
    const u = userEvent.setup()
    render(<Host />)
    await u.click(screen.getByLabelText('Categoria'))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(Array.from(lista().querySelectorAll('[data-categoria-id]')).map((b) => b.textContent)).toEqual(['Alimentação', 'Cafeteria', 'Padaria', 'Assinaturas e serviços', 'Netflix'])
    await u.click(within(lista()).getByRole('button', { name: 'Padaria' }))
    expect(screen.queryByTestId('lista-categorias')).toBeNull()
    expect(screen.getByTestId('valor').textContent).toBe('pad')
    expect(screen.getByLabelText('Categoria').textContent).toBe('Alimentação › Padaria')
    // o foco volta para o campo, para seguir no formulário com o teclado
    expect(document.activeElement).toBe(screen.getByLabelText('Categoria'))
  })

  it('ao abrir, o cursor já está na busca; a busca filtra a lista do mesmo jeito da folha', async () => {
    const u = userEvent.setup()
    render(<Host />)
    await u.click(screen.getByLabelText('Categoria'))
    expect(document.activeElement).toBe(within(lista()).getByLabelText('Buscar uma categoria'))
    await u.keyboard('netf')
    expect(Array.from(lista().querySelectorAll('[data-categoria-id]')).map((b) => b.textContent)).toEqual(['Netflixem Assinaturas e serviços'])
  })

  it('Esc fecha só a lista e não chega ao formulário em volta; clicar fora e tocar no campo de novo também fecham', async () => {
    const u = userEvent.setup()
    const emVolta = vi.fn()
    render(<div onKeyDown={emVolta}><Host /></div>)
    await u.click(screen.getByLabelText('Categoria'))
    await u.keyboard('{Escape}')
    expect(screen.queryByTestId('lista-categorias')).toBeNull()
    expect(emVolta).not.toHaveBeenCalled() // o formulário (que também fecha no Esc) não viu a tecla
    expect(document.activeElement).toBe(screen.getByLabelText('Categoria'))
    await u.click(screen.getByLabelText('Categoria'))
    expect(screen.getByTestId('lista-categorias')).toBeTruthy()
    fireEvent.mouseDown(document.body)
    expect(screen.queryByTestId('lista-categorias')).toBeNull()
    await u.click(screen.getByLabelText('Categoria'))
    await u.click(screen.getByLabelText('Categoria'))
    expect(screen.queryByTestId('lista-categorias')).toBeNull()
  })

  it('Criar categoria funciona dentro da lista: cria, entra e já fica escolhida', async () => {
    mock.criarCategoriaRapida.mockResolvedValue(cat('nova', 'Sorveteria'))
    const u = userEvent.setup()
    render(<Host />)
    await u.click(screen.getByLabelText('Categoria'))
    await u.keyboard('Sorveteria')
    await u.click(within(lista()).getByRole('button', { name: 'Criar categoria' }))
    await u.click(within(lista()).getByRole('button', { name: 'Criar' }))
    expect(mock.criarCategoriaRapida).toHaveBeenCalledWith('h1', 'Sorveteria', 'expense')
    expect(screen.getByTestId('valor').textContent).toBe('nova')
    expect(screen.queryByTestId('lista-categorias')).toBeNull()
  })

  it('a lista fica fixa na tela, com a altura limitada ao espaço: abre para baixo; sem espaço embaixo e com mais em cima, para cima', async () => {
    const u = userEvent.setup()
    window.innerHeight = 800
    const caixa = (top: number, bottom: number) => vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ top, bottom, left: 40, right: 340, width: 300, height: bottom - top, x: 40, y: top, toJSON: () => ({}) })
    const medir = caixa(100, 140)
    const { unmount } = render(<Host />)
    await u.click(screen.getByLabelText('Categoria'))
    expect(lista().getAttribute('data-direcao')).toBe('baixo')
    expect(lista().style.position).toBe('fixed') // fora do formulário que rola: não é cortada por ele
    expect(lista().style.top).toBe('144px')
    expect(lista().style.maxHeight).toBe('320px')
    unmount()
    medir.mockRestore()
    caixa(700, 740) // sobram 52 px embaixo e 692 em cima
    render(<Host />)
    await u.click(screen.getByLabelText('Categoria'))
    expect(lista().getAttribute('data-direcao')).toBe('cima')
    expect(lista().style.bottom).toBe('104px') // 800 − 700 + 4
    expect(lista().style.maxHeight).toBe('320px')
    vi.restoreAllMocks()
  })

  it('cabendo uns 290 px embaixo, abre para baixo (não cobre o formulário) e a lista rola dentro dessa altura', async () => {
    const u = userEvent.setup()
    window.innerHeight = 720
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ top: 390, bottom: 430, left: 0, right: 300, width: 300, height: 40, x: 0, y: 390, toJSON: () => ({}) })
    render(<Host />)
    await u.click(screen.getByLabelText('Categoria'))
    expect(lista().getAttribute('data-direcao')).toBe('baixo')
    expect(lista().style.maxHeight).toBe('282px') // 720 − 430 − 8
    vi.restoreAllMocks()
  })

  it('pouco espaço nos dois lados: a lista usa o que tem (nunca passa da borda da tela)', async () => {
    const u = userEvent.setup()
    window.innerHeight = 400
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ top: 150, bottom: 190, left: 0, right: 300, width: 300, height: 40, x: 0, y: 150, toJSON: () => ({}) })
    render(<Host />)
    await u.click(screen.getByLabelText('Categoria'))
    expect(lista().getAttribute('data-direcao')).toBe('baixo') // 202 px embaixo, 142 em cima
    expect(lista().style.maxHeight).toBe('202px')
    vi.restoreAllMocks()
  })

  it('rolar o formulário ou mudar a janela fecha a lista (ela é fixa na tela); rolar dentro dela não', async () => {
    const u = userEvent.setup()
    render(<div data-testid="formulario"><Host /></div>)
    await u.click(screen.getByLabelText('Categoria'))
    fireEvent.scroll(lista())
    expect(screen.getByTestId('lista-categorias')).toBeTruthy()
    fireEvent.scroll(screen.getByTestId('formulario'))
    expect(screen.queryByTestId('lista-categorias')).toBeNull()
    await u.click(screen.getByLabelText('Categoria'))
    fireEvent(window, new Event('resize'))
    expect(screen.queryByTestId('lista-categorias')).toBeNull()
  })

  it('no celular (tela estreita) continua a folha: o pop-up de antes', async () => {
    telaDoComputador(false)
    const u = userEvent.setup()
    render(<Host />)
    await u.click(screen.getByLabelText('Categoria'))
    expect(screen.getByRole('dialog', { name: 'Selecionar uma categoria' })).toBeTruthy()
    expect(screen.queryByTestId('lista-categorias')).toBeNull()
  })
})
