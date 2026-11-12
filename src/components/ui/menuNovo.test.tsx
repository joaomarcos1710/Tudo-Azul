// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MenuNovo, useAtalhosNovo } from './MenuNovo'
import type { ItemNovo } from './MenuNovo'

type Chave = 'despesa' | 'receita'
const ITENS: ItemNovo<Chave>[] = [
  { chave: 'despesa', rotulo: 'Nova despesa', tecla: 'D' },
  { chave: 'receita', rotulo: 'Nova receita', tecla: 'R' },
]

function Tela({ aoEscolher, ativo = true }: { aoEscolher: (c: Chave) => void; ativo?: boolean }) {
  useAtalhosNovo(ITENS, ativo, aoEscolher)
  return (<><input aria-label="Campo" /><MenuNovo itens={ITENS} aoEscolher={aoEscolher} forma="primario" /></>)
}

afterEach(() => cleanup())

describe('MenuNovo', () => {
  it('lista os itens com a tecla de cada um; o título do botão mostra as teclas; abre com o foco no primeiro item', async () => {
    const u = userEvent.setup()
    render(<Tela aoEscolher={vi.fn()} />)
    const botao = screen.getByRole('button', { name: 'Novo lançamento' })
    expect(botao.getAttribute('title')).toBe('Novo lançamento (teclas D, R)')
    await u.click(botao)
    const itens = within(screen.getByRole('menu', { name: 'Novo lançamento' })).getAllByRole('menuitem')
    expect(itens.map((i) => i.textContent)).toEqual(['Nova despesatecla D', 'Nova receitatecla R'])
    expect(document.activeElement).toBe(itens[0])
  })

  it('setas, Home e End andam entre os itens; Tab e Esc fecham; o Esc devolve o foco ao botão', async () => {
    const u = userEvent.setup()
    render(<Tela aoEscolher={vi.fn()} />)
    const botao = screen.getByRole('button', { name: 'Novo lançamento' })
    await u.click(botao)
    const itens = screen.getAllByRole('menuitem')
    await u.keyboard('{End}')
    expect(document.activeElement).toBe(itens[1])
    await u.keyboard('{Home}')
    expect(document.activeElement).toBe(itens[0])
    await u.keyboard('{ArrowUp}')
    expect(document.activeElement).toBe(itens[1])
    await u.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(botao)
    await u.click(botao)
    await u.keyboard('{Tab}')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('escolher um item devolve o foco ao botão ANTES de avisar quem abre a folha (ele guarda o botão como origem)', async () => {
    const u = userEvent.setup()
    let focoNaEscolha: Element | null = null
    render(<Tela aoEscolher={() => { focoNaEscolha = document.activeElement }} />)
    const botao = screen.getByRole('button', { name: 'Novo lançamento' })
    await u.click(botao)
    await u.click(screen.getByRole('menuitem', { name: /Nova receita/ }))
    expect(focoNaEscolha).toBe(botao)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('clicar fora fecha o menu; desabilitado não abre', async () => {
    const u = userEvent.setup()
    const { rerender } = render(<><p>fora</p><MenuNovo itens={ITENS} aoEscolher={vi.fn()} /></>)
    await u.click(screen.getByRole('button', { name: 'Novo lançamento' }))
    await u.click(screen.getByText('fora'))
    expect(screen.queryByRole('menu')).toBeNull()
    rerender(<MenuNovo itens={ITENS} aoEscolher={vi.fn()} desabilitado />)
    expect((screen.getByRole('button', { name: 'Novo lançamento' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('useAtalhosNovo', () => {
  it('a tecla do item o escolhe (maiúscula ou minúscula); campo de texto, Ctrl e repetição são ignorados', async () => {
    const u = userEvent.setup()
    const escolher = vi.fn()
    render(<Tela aoEscolher={escolher} />)
    await u.keyboard('d')
    await u.keyboard('R')
    expect(escolher.mock.calls).toEqual([['despesa'], ['receita']])
    escolher.mockClear()
    await u.click(screen.getByLabelText('Campo'))
    await u.keyboard('d')
    await u.keyboard('{Control>}d{/Control}')
    await u.keyboard('x')
    expect(escolher).not.toHaveBeenCalled()
  })

  it('com `ativo` falso a tecla não faz nada', async () => {
    const u = userEvent.setup()
    const escolher = vi.fn()
    render(<Tela aoEscolher={escolher} ativo={false} />)
    await u.keyboard('d')
    expect(escolher).not.toHaveBeenCalled()
  })
})
