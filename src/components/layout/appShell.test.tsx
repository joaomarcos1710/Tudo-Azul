// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AppShell } from './AppShell'
import { gruposMenuPerfil, gruposNavegacao, itemAtivo, itensBarraLateral, itensFixosNoCelular, itensNavegacao } from './navegacao'
import { definirValoresOcultos } from '../../lib/privacidade'
import { definirBarraRecolhida } from '../../lib/barraLateral'

vi.mock('../../lib/supabase', () => ({ supabase: null, supabaseConfigurado: true }))

function montar(caminho = '/') {
  return render(
    <MemoryRouter initialEntries={[caminho]}>
      <Routes><Route element={<AppShell />}><Route path="*" element={<p>conteúdo</p>} /></Route></Routes>
    </MemoryRouter>,
  )
}

describe('menu em grupos', () => {
  beforeEach(() => definirValoresOcultos(false))
  afterEach(cleanup)

  it('toda tela do app está no menu (inclui Recorrentes, que antes não aparecia) e sem caminhos repetidos', () => {
    const caminhos = itensNavegacao.map((i) => i.caminho)
    expect(new Set(caminhos).size).toBe(caminhos.length)
    for (const c of ['/', '/analises', '/lancamentos', '/calendario', '/recorrentes', '/cartoes', '/contas', '/dividas', '/investimentos', '/categorias', '/orcamentos', '/compromissos', '/reservas', '/relatorios', '/familia', '/exportar']) {
      expect(caminhos).toContain(c)
    }
  })

  it('a sidebar desktop é enxuta (pedido do dono, 17/11/2026): só as 9 telas do dia a dia, numa lista só, sem títulos de grupo', () => {
    montar()
    const lateral = screen.getByRole('navigation', { name: 'Principal' })
    expect(within(lateral).queryAllByRole('group')).toHaveLength(0)
    expect(within(lateral).getAllByRole('link').map((a) => a.textContent)).toEqual(
      ['Início', 'Lançamentos', 'Calendário', 'Cartões', 'Contas', 'Recorrentes', 'Orçamentos', 'Investimentos', 'Análises'])
    expect(itensBarraLateral).toHaveLength(9)
    // o que saiu da barra e o que é raro ficam no menu do nome
    for (const nome of ['Relatórios', 'Compromissos', 'Reservas', 'Categorias', 'Dívidas e empréstimos', 'Bens e patrimônio', 'Família', 'Exportar dados']) {
      expect(within(lateral).queryByRole('link', { name: nome }), nome).toBeNull()
    }
    expect(within(lateral).queryByTestId('tela-atual-fora-da-barra')).toBeNull()
  })

  it('nenhuma tela some: a barra e o menu do nome juntos têm todas as do menu do celular', () => {
    const naBarra = itensBarraLateral.map((i) => i.caminho)
    const noMenu = gruposMenuPerfil.flatMap((g) => g.itens.map((i) => i.caminho))
    expect(new Set([...naBarra, ...noMenu]).size).toBe(naBarra.length + noMenu.length) // nenhuma repetida
    expect([...naBarra, ...noMenu].sort()).toEqual(itensNavegacao.map((i) => i.caminho).sort())
  })

  it('estando numa tela que só está no menu do nome, ela aparece marcada no fim da barra (para não perder o rumo)', () => {
    montar('/relatorios')
    const lateral = screen.getByRole('navigation', { name: 'Principal' })
    const atual = within(lateral).getByTestId('tela-atual-fora-da-barra')
    expect(within(atual).getByRole('link', { name: 'Relatórios' }).getAttribute('aria-current')).toBe('page')
    expect(within(lateral).getAllByRole('link')).toHaveLength(10) // as 9 e a tela atual
    expect(within(lateral).getByRole('link', { name: 'Início' }).getAttribute('aria-current')).toBeNull()
  })

  it('o menu do nome (⋮) guarda "Mais telas" e "Conta", com Sair, autoria e versão; rola se a janela for baixa', async () => {
    const u = userEvent.setup()
    montar()
    await u.click(screen.getByRole('button', { name: 'Perfil de Minha conta' }))
    const menu = screen.getByRole('menu', { name: 'Mais telas e configurações da conta' })
    expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent)).toEqual([
      'Relatórios', 'Compromissos', 'Reservas', 'Categorias', 'Dívidas e empréstimos', 'Bens e patrimônio',
      'Família', 'Exportar dados', 'Preferências', '↪Sair'])
    expect(within(menu).getByRole('region', { name: 'Mais telas' })).toBeTruthy()
    expect(within(menu).getByRole('region', { name: 'Conta' })).toBeTruthy()
    expect(menu.className).toContain('overflow-y-auto') // janela baixa: o menu rola em vez de sair da tela
    expect(menu.className).toContain('max-h-[calc(100vh-6.5rem)]')
    expect(within(menu).getByRole('menuitem', { name: 'Sair' })).toBeTruthy()
    expect(within(menu).getByText(/Versão/)).toBeTruthy()
    // ideia 03: autoria logo abaixo de Sair, dentro do menu
    expect(within(menu).getByText(/Todos os direitos reservados a João Marcos\./)).toBeTruthy()
    expect(within(menu).getByText(/^© \d{4} Tudo Azul\.$/)).toBeTruthy()
    // ordem: Sair, depois a autoria, e só então a versão
    const sair = within(menu).getByRole('menuitem', { name: 'Sair' })
    const autoria = within(menu).getByText(/^© \d{4} Tudo Azul\.$/)
    const versao = within(menu).getByText(/Versão/)
    expect(sair.compareDocumentPosition(autoria) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(autoria.compareDocumentPosition(versao) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('escolher uma "Mais telas" no menu do nome leva à tela e fecha o menu', async () => {
    const u = userEvent.setup()
    montar()
    await u.click(screen.getByRole('button', { name: 'Perfil de Minha conta' }))
    await u.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Compromissos' }))
    expect(screen.queryByRole('menu')).toBeNull()
    expect(screen.getByTestId('tela-atual-fora-da-barra').textContent).toBe('Compromissos')
  })

  describe('recolher e expandir a barra lateral (pedido do dono, 17/11/2026)', () => {
    const lateral = () => document.getElementById('navegacao-lateral') as HTMLElement
    beforeEach(() => { definirBarraRecolhida(false); window.localStorage.clear() })
    afterEach(() => { definirBarraRecolhida(false); window.localStorage.clear() })

    it('começa expandida, com o botão "Recolher menu lateral"; recolher deixa só os ícones, e expandir volta', async () => {
      const u = userEvent.setup()
      montar()
      const botao = screen.getByRole('button', { name: 'Recolher menu lateral' })
      expect(botao.getAttribute('aria-expanded')).toBe('true')
      expect(botao.getAttribute('aria-controls')).toBe('navegacao-lateral')
      expect(lateral().getAttribute('data-recolhida')).toBe('nao')
      expect(lateral().className).toContain('w-64')
      expect(within(lateral()).getByText('tudo azul')).toBeTruthy()
      await u.click(botao)
      const aberta = screen.getByRole('button', { name: 'Expandir menu lateral' })
      expect(aberta.getAttribute('aria-expanded')).toBe('false')
      expect(lateral().getAttribute('data-recolhida')).toBe('sim')
      expect(lateral().className).toContain('w-[4.5rem]')
      expect(lateral().className).not.toContain('w-64')
      expect(within(lateral()).queryByText('tudo azul')).toBeNull() // só o símbolo
      await u.click(aberta)
      expect(lateral().getAttribute('data-recolhida')).toBe('nao')
      expect(within(lateral()).getByText('tudo azul')).toBeTruthy()
    })

    it('recolhida, cada tela continua com nome para o leitor de tela e para o mouse (title), sem texto visível', async () => {
      const u = userEvent.setup()
      montar()
      await u.click(screen.getByRole('button', { name: 'Recolher menu lateral' }))
      const nav = screen.getByRole('navigation', { name: 'Principal' })
      const links = within(nav).getAllByRole('link')
      expect(links.map((a) => a.textContent)).toEqual(
        ['Início', 'Lançamentos', 'Calendário', 'Cartões', 'Contas', 'Recorrentes', 'Orçamentos', 'Investimentos', 'Análises']) // o texto está, escondido
      for (const a of links) {
        expect(a.querySelector('.sr-only'), a.getAttribute('href') ?? '').not.toBeNull()
        expect(a.getAttribute('title')).toBe(a.textContent)
      }
      expect(within(nav).getByRole('link', { name: 'Lançamentos' })).toBeTruthy()
    })

    it('a escolha fica guardada neste aparelho e vale na próxima visita', async () => {
      const u = userEvent.setup()
      const { unmount } = montar()
      await u.click(screen.getByRole('button', { name: 'Recolher menu lateral' }))
      expect(window.localStorage.getItem('tudo-azul:barra-lateral-recolhida')).toBe('1')
      unmount()
      montar()
      expect(lateral().getAttribute('data-recolhida')).toBe('sim')
      await u.click(screen.getByRole('button', { name: 'Expandir menu lateral' }))
      expect(window.localStorage.getItem('tudo-azul:barra-lateral-recolhida')).toBe('0')
    })

    it('recolhida, o menu do nome (⋮) abre ao lado, fixo, com as mesmas telas e Sair; o avatar tem o nome no title', async () => {
      const u = userEvent.setup()
      montar()
      await u.click(screen.getByRole('button', { name: 'Recolher menu lateral' }))
      const perfil = screen.getByRole('button', { name: 'Perfil de Minha conta' })
      expect(perfil.getAttribute('title')).toBe('Minha conta')
      expect(within(perfil).queryByText('Conta familiar')).toBeNull()
      await u.click(perfil)
      const menu = screen.getByRole('menu', { name: 'Mais telas e configurações da conta' })
      expect(menu.className).toContain('fixed') // não é cortado pela rolagem da barra estreita
      expect(menu.className).toContain('left-[5rem]')
      expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent)).toContain('Relatórios')
      expect(within(menu).getByRole('menuitem', { name: 'Sair' })).toBeTruthy()
    })

    it('a tela atual de fora da barra continua marcada, só com o ícone, quando recolhida', async () => {
      const u = userEvent.setup()
      montar('/relatorios')
      await u.click(screen.getByRole('button', { name: 'Recolher menu lateral' }))
      const atual = screen.getByTestId('tela-atual-fora-da-barra')
      const link = within(atual).getByRole('link', { name: 'Relatórios' })
      expect(link.getAttribute('aria-current')).toBe('page')
      expect(link.getAttribute('title')).toBe('Relatórios')
    })

    it('sem armazenamento (navegador bloqueado) o botão ainda funciona, só nesta visita', async () => {
      const u = userEvent.setup()
      const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('bloqueado') })
      montar()
      await u.click(screen.getByRole('button', { name: 'Recolher menu lateral' }))
      expect(lateral().getAttribute('data-recolhida')).toBe('sim')
      setItem.mockRestore()
    })
  })

  it('celular: 4 atalhos fixos + "Mais"; o resto só aparece dentro do Mais', async () => {
    const u = userEvent.setup()
    montar()
    const barra = screen.getByRole('navigation', { name: 'Principal no celular' })
    expect(within(barra).getAllByRole('link').map((a) => a.textContent)).toEqual(['Início', 'Lançam.', 'Cartões', 'Invest.'])
    expect(itensFixosNoCelular).toHaveLength(4)
    expect(screen.queryByRole('dialog')).toBeNull()
    await u.click(within(barra).getByRole('button', { name: 'Mais' }))
    const folha = screen.getByRole('dialog', { name: 'Menu' })
    // todas as telas, em grupos
    const total = gruposNavegacao.reduce((n, g) => n + g.itens.length, 0)
    expect(within(folha).getAllByRole('link')).toHaveLength(total)
    expect(within(folha).getByRole('link', { name: 'Recorrentes' })).toBeTruthy()
    expect(within(folha).getByRole('link', { name: 'Categorias' })).toBeTruthy()
  })

  it('toda tela tem uma frase curta dizendo para que serve', () => {
    for (const i of itensNavegacao) {
      expect(i.descricao.trim(), i.caminho).not.toBe('')
      expect(i.descricao.length, i.caminho).toBeLessThanOrEqual(60)
      expect(i.descricao.endsWith('.'), i.caminho).toBe(true)
    }
  })

  it('o Mais mostra 4 atalhos em cartões e o resto em lista, cada tela uma vez só, com a frase como descrição', async () => {
    const u = userEvent.setup()
    montar()
    await u.click(screen.getByRole('button', { name: 'Mais' }))
    const folha = screen.getByRole('dialog', { name: 'Menu' })
    const atalhos = within(folha).getByRole('group', { name: 'Atalhos' })
    expect(within(atalhos).getAllByRole('link').map((a) => a.getAttribute('aria-label')))
      .toEqual(['Calendário', 'Recorrentes', 'Contas', 'Orçamentos'])
    // nenhuma tela aparece duas vezes (cartão e linha)
    const hrefs = within(folha).getAllByRole('link').map((a) => a.getAttribute('href'))
    expect(new Set(hrefs).size).toBe(hrefs.length)
    // o nome do link continua só o rótulo; a frase é a descrição (leitor de tela lê as duas)
    const cartoes = within(folha).getByRole('link', { name: 'Cartões' })
    expect(cartoes.getAttribute('href')).toBe('/cartoes')
    expect(cartoes.getAttribute('aria-describedby')).toBe('desc-/cartoes')
    expect(folha.querySelector('[id="desc-/cartoes"]')!.textContent).toBe('Fatura, parcelas e limite de cada cartão.')
    // as linhas que sobraram mantêm seus grupos; o grupo que ficou vazio some
    expect(within(folha).getAllByRole('group').map((g) => g.getAttribute('aria-label')))
      .toEqual(['Atalhos', 'Visão geral', 'Movimentações', 'Planejamento', 'Patrimônio', 'Conta'])
  })

  it('os links principais mantêm alvos de toque de pelo menos 44px e o perfil fica no rodapé', () => {
    montar()
    const lateral = screen.getByRole('navigation', { name: 'Principal' })
    for (const l of within(lateral).getAllByRole('link')) expect(l.className).toContain('min-h-11')
    const perfil = screen.getByRole('button', { name: 'Perfil de Minha conta' })
    // o rodapé da barra (botão de recolher e perfil) fica colado embaixo
    expect(screen.getByTestId('rodape-da-barra').className).toContain('mt-auto')
    expect(screen.getByTestId('rodape-da-barra').contains(perfil)).toBe(true)
    expect(perfil.getAttribute('aria-haspopup')).toBe('menu')
    expect(screen.queryByRole('button', { name: 'Sair' })).toBeNull()
  })

  it('o Mais fecha com Esc, no fundo, no ×, e ao escolher um item (que leva à tela)', async () => {
    const u = userEvent.setup()
    montar()
    const mais = () => screen.getByRole('button', { name: 'Mais' })
    await u.click(mais())
    await u.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(mais()) // o foco volta para quem abriu

    await u.click(mais())
    await u.click(screen.getByRole('button', { name: 'Fechar menu' }))
    expect(screen.queryByRole('dialog')).toBeNull()

    await u.click(mais())
    await u.click(screen.getByRole('button', { name: 'Fechar' }))
    expect(screen.queryByRole('dialog')).toBeNull()

    await u.click(mais())
    await u.click(within(screen.getByRole('dialog')).getByRole('link', { name: 'Recorrentes' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('"Mais" fica destacado quando a tela atual não é um dos 4 atalhos', () => {
    montar('/recorrentes')
    expect(screen.getByRole('button', { name: 'Mais' }).className).toContain('text-azul')
    cleanup()
    montar('/lancamentos')
    expect(screen.getByRole('button', { name: 'Mais' }).className).toContain('text-slate-500')
  })

  it('Análises fica no grupo Visão geral, logo depois do Início, e leva a /analises', () => {
    const visao = gruposNavegacao.find((g) => g.titulo === 'Visão geral')!
    expect(visao.itens.map((i) => i.rotulo)).toEqual(['Início', 'Análises', 'Relatórios'])
    expect(visao.itens.find((i) => i.rotulo === 'Análises')?.caminho).toBe('/analises')
  })
  it('em /analises o item ativo é Análises, e não Início', () => {
    expect(itemAtivo('/analises')?.rotulo).toBe('Análises')
    expect(itemAtivo('/')?.rotulo).toBe('Início')
  })

  it('itemAtivo: subtela de conta conta como Contas; raiz só casa com "/"', () => {
    expect(itemAtivo('/contas/abc')?.rotulo).toBe('Contas')
    expect(itemAtivo('/')?.rotulo).toBe('Início')
    expect(itemAtivo('/desconhecida')).toBeUndefined()
  })
  it('largura do conteúdo: até 1280 px (max-w-7xl) nas telas comuns, centralizado; a fatura usa a largura toda', () => {
    montar('/recorrentes')
    const principal = screen.getByRole('main')
    expect(principal.className).toContain('max-w-7xl')
    expect(principal.className).toContain('mx-auto')
    expect(principal.className).not.toContain('max-w-6xl')
    cleanup()
    montar('/cartoes/k1/fatura/2026-11')
    expect(screen.getByRole('main').className).toContain('max-w-none')
  })

  it('a fatura tem modo de foco: recolhe e expande o menu lateral e esconde a barra inferior', async () => {
    const u = userEvent.setup()
    montar('/cartoes/k1/fatura/2026-11')
    const lateral = screen.getByRole('navigation', { name: 'Principal' }).closest('aside')!
    expect(lateral.className).toContain('md:flex')
    expect(screen.getByRole('navigation', { name: 'Principal no celular' }).className).toContain('hidden')
    await u.click(screen.getByRole('button', { name: 'Ocultar menu lateral' }))
    expect(lateral.className).toContain('md:hidden')
    expect(screen.getByRole('button', { name: 'Mostrar menu lateral' }).getAttribute('aria-expanded')).toBe('false')
    await u.click(screen.getByRole('button', { name: 'Mostrar menu lateral' }))
    expect(lateral.className).toContain('md:flex')
  })

})
