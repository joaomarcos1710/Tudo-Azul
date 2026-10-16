// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const mock = vi.hoisted(() => ({
  estado: { familia: null as null | { id: string; nome: string; papel: 'owner' | 'member' }, carregando: false, erro: false },
  recarregar: vi.fn(),
  criarFamilia: vi.fn(),
  criarConvite: vi.fn(),
  aceitarConvite: vi.fn(),
  listarMembros: vi.fn(),
  listarConvitesPendentes: vi.fn(),
}))

vi.mock('../lib/FamiliaContext', () => ({
  useFamilia: () => ({ ...mock.estado, recarregar: mock.recarregar }),
}))
vi.mock('../lib/auth', () => ({ useAuth: () => ({ sessao: { user: { email: 'ana@exemplo.com' } }, carregando: false }) }))
vi.mock('../lib/familia', async (original) => ({
  ...(await original<typeof import('../lib/familia')>()),
  criarFamilia: mock.criarFamilia,
  criarConvite: mock.criarConvite,
  aceitarConvite: mock.aceitarConvite,
  listarMembros: mock.listarMembros,
  listarConvitesPendentes: mock.listarConvitesPendentes,
}))

import Familia from './Familia'
import Convite from './Convite'
import { ExigeFamilia } from '../components/layout/ExigeFamilia'
import { linkDoConvite, mensagemErroBanco, tokenDoTexto } from '../lib/familia'

function montar(inicio: string) {
  return render(
    <MemoryRouter initialEntries={[inicio]}>
      <Routes>
        <Route path="/familia" element={<Familia />} />
        <Route path="/convite" element={<Convite />} />
        <Route element={<ExigeFamilia />}>
          <Route path="/" element={<p>Painel interno</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mock.estado = { familia: null, carregando: false, erro: false }
  mock.listarMembros.mockResolvedValue([])
  mock.listarConvitesPendentes.mockResolvedValue([])
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('funções do convite', () => {
  it('o token vai depois do # e é recuperado de um link colado', () => {
    expect(linkDoConvite('abc123', 'https://app.exemplo')).toBe('https://app.exemplo/convite#abc123')
    expect(tokenDoTexto(' https://app.exemplo/convite#abc123 ')).toBe('abc123')
    expect(tokenDoTexto('#abc123')).toBe('abc123')
    expect(tokenDoTexto('abc123')).toBe('abc123')
    expect(tokenDoTexto('')).toBe('')
  })
  it('erros de regra do banco aparecem em português; os demais ficam genéricos', () => {
    expect(mensagemErroBanco({ code: '22023', message: 'convite inválido ou expirado' })).toBe('Convite inválido ou expirado.')
    expect(mensagemErroBanco({ code: '42501', message: 'permission denied for table x' })).toBe('Você não tem permissão para esta ação.')
    expect(mensagemErroBanco({ code: 'XX000', message: 'detalhe interno' })).toMatch(/Não foi possível concluir/)
  })
})

describe('ExigeFamilia', () => {
  it('sem família, leva para /familia', () => {
    montar('/')
    expect(screen.getByRole('heading', { name: 'Família' })).toBeTruthy()
    expect(screen.queryByText('Painel interno')).toBeNull()
  })
  it('com família, mostra a página', () => {
    mock.estado.familia = { id: 'h1', nome: 'Casa', papel: 'owner' }
    montar('/')
    expect(screen.getByText('Painel interno')).toBeTruthy()
  })
})

describe('Família sem família ainda', () => {
  it('cria a família e recarrega', async () => {
    mock.criarFamilia.mockResolvedValue(undefined)
    montar('/familia')
    const u = userEvent.setup()
    await u.type(screen.getByLabelText('Nome da família'), 'Casa Bomfim')
    await u.click(screen.getByRole('button', { name: 'Criar família' }))
    expect(mock.criarFamilia).toHaveBeenCalledWith('Casa Bomfim')
    expect(mock.recarregar).toHaveBeenCalled()
  })
  it('mostra o erro de regra do banco', async () => {
    mock.criarFamilia.mockRejectedValue({ code: '55000', message: 'o usuário já pertence a uma família' })
    montar('/familia')
    const u = userEvent.setup()
    await u.type(screen.getByLabelText('Nome da família'), 'Casa')
    await u.click(screen.getByRole('button', { name: 'Criar família' }))
    expect((await screen.findByRole('alert')).textContent).toBe('O usuário já pertence a uma família.')
  })
})

describe('Família com família', () => {
  it('dono vê membros, gera convite e recebe link com o token após o #', async () => {
    mock.estado.familia = { id: 'h1', nome: 'Casa Bomfim', papel: 'owner' }
    mock.listarMembros.mockResolvedValue([{ userId: 'u1', nome: 'João', papel: 'owner' }])
    mock.criarConvite.mockResolvedValue('tok123')
    montar('/familia')
    expect(await screen.findByText('João')).toBeTruthy()
    const u = userEvent.setup()
    await u.type(screen.getByLabelText('E-mail da pessoa'), 'mariane@exemplo.com')
    await u.click(screen.getByRole('button', { name: 'Gerar convite' }))
    expect(mock.criarConvite).toHaveBeenCalledWith('mariane@exemplo.com')
    expect(await screen.findByText(`${window.location.origin}/convite#tok123`)).toBeTruthy()
    const whatsapp = screen.getByRole('link', { name: 'Enviar pelo WhatsApp' }).getAttribute('href') ?? ''
    expect(decodeURIComponent(whatsapp)).toContain('/convite#tok123')
  })
  it('membro comum não vê a área de convite', async () => {
    mock.estado.familia = { id: 'h1', nome: 'Casa Bomfim', papel: 'member' }
    montar('/familia')
    expect(await screen.findByText('Casa Bomfim')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Gerar convite' })).toBeNull()
    expect(mock.listarConvitesPendentes).not.toHaveBeenCalled()
  })
})

describe('Convite', () => {
  it('aceita com o token do link e recarrega a família', async () => {
    mock.aceitarConvite.mockResolvedValue(undefined)
    montar('/convite#tok123')
    await userEvent.setup().click(screen.getByRole('button', { name: 'Aceitar convite' }))
    expect(mock.aceitarConvite).toHaveBeenCalledWith('tok123')
    expect(mock.recarregar).toHaveBeenCalled()
  })
  it('convite inválido mostra a mensagem do banco', async () => {
    mock.aceitarConvite.mockRejectedValue({ code: '22023', message: 'convite inválido ou expirado' })
    montar('/convite#tok123')
    await userEvent.setup().click(screen.getByRole('button', { name: 'Aceitar convite' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Convite inválido ou expirado.')
  })
  it('link sem token explica o problema', () => {
    montar('/convite')
    expect(screen.getByRole('alert').textContent).toMatch(/incompleto/)
  })
})
