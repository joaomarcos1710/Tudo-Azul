// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { ReactNode } from 'react'

// Cliente Supabase falso: as telas só conversam com supabase.auth.
const mock = vi.hoisted(() => ({
  configurado: true,
  sessao: null as unknown,
  auth: {
    getSession: vi.fn(),
    onAuthStateChange: vi.fn(),
    signInWithPassword: vi.fn(),
    signUp: vi.fn(),
    resetPasswordForEmail: vi.fn(),
    updateUser: vi.fn(),
    signOut: vi.fn(),
  },
}))
vi.mock('../../lib/supabase', () => ({
  get supabase() { return { auth: mock.auth } },
  get supabaseConfigurado() { return mock.configurado },
}))

import { AuthProvider, mensagemErroAuth } from '../../lib/auth'
import { RotaProtegida } from '../../components/layout/RotaProtegida'
import Entrar from './Entrar'
import Cadastro from './Cadastro'
import RecuperarSenha from './RecuperarSenha'

const sessaoFalsa = { access_token: 'x', user: { id: 'u1' } }

beforeEach(() => {
  mock.configurado = true
  mock.sessao = null
  mock.auth.getSession.mockImplementation(async () => ({ data: { session: mock.sessao } }))
  mock.auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } })
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function montar(inicio: string, extra?: ReactNode) {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[inicio]}>
        <Routes>
          <Route path="/entrar" element={<Entrar />} />
          <Route path="/cadastro" element={<Cadastro />} />
          <Route path="/recuperar-senha" element={<RecuperarSenha />} />
          <Route path="/" element={<RotaProtegida><p>Painel interno</p></RotaProtegida>} />
          {extra}
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  )
}

describe('mensagemErroAuth', () => {
  it('traduz códigos conhecidos e nunca mostra a mensagem técnica', () => {
    expect(mensagemErroAuth({ code: 'invalid_credentials', message: 'Invalid login credentials' })).toBe('E-mail ou senha incorretos.')
    expect(mensagemErroAuth({ code: 'email_not_confirmed' })).toMatch(/Confirme seu e-mail/)
    expect(mensagemErroAuth({ message: 'Failed to fetch', status: 0 })).toMatch(/Sem conexão/)
    expect(mensagemErroAuth({ code: 'algo_novo', message: 'stack trace interno' })).toBe('Não foi possível concluir agora. Tente de novo em instantes. (código: algo_novo)')
    expect(mensagemErroAuth({ code: 'email_address_not_authorized' })).toMatch(/SMTP/)
    expect(mensagemErroAuth(null)).toBe('')
  })
})

describe('RotaProtegida', () => {
  it('sem sessão, manda para /entrar', async () => {
    montar('/')
    expect(await screen.findByRole('heading', { name: 'Entrar' })).toBeTruthy()
    expect(screen.queryByText('Painel interno')).toBeNull()
  })
  it('com sessão, mostra o conteúdo', async () => {
    mock.sessao = sessaoFalsa
    montar('/')
    expect(await screen.findByText('Painel interno')).toBeTruthy()
  })
  it('sem Supabase configurado, explica o que falta em vez de quebrar', () => {
    mock.configurado = false
    montar('/')
    expect(screen.getByRole('alert').textContent).toMatch(/VITE_SUPABASE_URL/)
  })
})

describe('telas de acesso sem Supabase configurado', () => {
  it('avisam em vez de deixar o botão sem efeito', () => {
    mock.configurado = false
    montar('/entrar')
    expect(screen.getByRole('alert').textContent).toMatch(/ainda não está ligado ao banco/)
  })
})

describe('Entrar', () => {
<<<<<<< HEAD
  it('mostra o aviso de autoria no rodapé (ideia 03)', async () => {
    montar('/entrar')
    expect(await screen.findByText(/Todos os direitos reservados a João Marcos\./)).toBeTruthy()
    expect(screen.getByText(/^© \d{4} Tudo Azul\.$/)).toBeTruthy()
=======
  it('depois de entrar, não segue um destino que sairia do app (open redirect)', async () => {
    mock.sessao = sessaoFalsa
    render(
      <AuthProvider>
        <MemoryRouter initialEntries={[{ pathname: '/entrar', state: { de: '//evil.example/x' } }]}>
          <Routes>
            <Route path="/entrar" element={<Entrar />} />
            <Route path="/" element={<RotaProtegida><p>Painel interno</p></RotaProtegida>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>,
    )
    expect(await screen.findByText('Painel interno')).toBeTruthy()
>>>>>>> origin/main
  })
  it('envia e-mail sem espaços e mostra erro traduzido', async () => {
    mock.auth.signInWithPassword.mockResolvedValue({ error: { code: 'invalid_credentials', message: 'Invalid login credentials' } })
    montar('/entrar')
    const u = userEvent.setup()
    await u.type(await screen.findByLabelText('E-mail'), '  ana@exemplo.com ')
    await u.type(screen.getByLabelText('Senha'), 'segredo123')
    await u.click(screen.getByRole('button', { name: 'Entrar' }))
    expect(mock.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'ana@exemplo.com', password: 'segredo123' })
    expect((await screen.findByRole('alert')).textContent).toBe('E-mail ou senha incorretos.')
  })
  it('com sucesso, vai para o painel', async () => {
    mock.auth.signInWithPassword.mockImplementation(async () => {
      mock.sessao = sessaoFalsa
      const [[ouvinte]] = mock.auth.onAuthStateChange.mock.calls
      ouvinte('SIGNED_IN', sessaoFalsa)
      return { error: null }
    })
    montar('/entrar')
    const u = userEvent.setup()
    await u.type(await screen.findByLabelText('E-mail'), 'ana@exemplo.com')
    await u.type(screen.getByLabelText('Senha'), 'segredo123')
    await u.click(screen.getByRole('button', { name: 'Entrar' }))
    expect(await screen.findByText('Painel interno')).toBeTruthy()
  })
})

describe('Cadastro', () => {
  async function preencher(senha: string, confirmacao: string) {
    const u = userEvent.setup()
    await u.type(await screen.findByLabelText('Seu nome'), ' Ana ')
    await u.type(screen.getByLabelText('E-mail'), 'ana@exemplo.com')
    await u.type(screen.getByLabelText(/^Senha/), senha)
    await u.type(screen.getByLabelText('Repita a senha'), confirmacao)
    await u.click(screen.getByRole('button', { name: 'Criar conta' }))
  }
  it('não envia senha curta nem senhas diferentes', async () => {
    montar('/cadastro')
    await preencher('curta', 'outra')
    expect(screen.getByText(/pelo menos 8 caracteres/)).toBeTruthy()
    expect(screen.getByText('As senhas não conferem.')).toBeTruthy()
    expect(mock.auth.signUp).not.toHaveBeenCalled()
  })
  it('envia o nome para o perfil e pede confirmação de e-mail quando não há sessão', async () => {
    mock.auth.signUp.mockResolvedValue({ data: { session: null, user: { id: 'u1' } }, error: null })
    montar('/cadastro')
    await preencher('segredo123', 'segredo123')
    expect(mock.auth.signUp).toHaveBeenCalledWith(expect.objectContaining({
      email: 'ana@exemplo.com',
      password: 'segredo123',
      options: expect.objectContaining({ data: { name: 'Ana' } }),
    }))
    expect(await screen.findByRole('heading', { name: 'Confira seu e-mail' })).toBeTruthy()
  })
})

describe('RecuperarSenha', () => {
  it('não revela se o e-mail existe: mesma resposta com erro comum', async () => {
    mock.auth.resetPasswordForEmail.mockResolvedValue({ error: { code: 'user_not_found', status: 400 } })
    montar('/recuperar-senha')
    const u = userEvent.setup()
    await u.type(await screen.findByLabelText('E-mail'), 'ninguem@exemplo.com')
    await u.click(screen.getByRole('button', { name: 'Enviar link' }))
    expect(mock.auth.resetPasswordForEmail).toHaveBeenCalledWith('ninguem@exemplo.com', { redirectTo: `${window.location.origin}/nova-senha` })
    expect((await screen.findByRole('status')).textContent).toMatch(/Se existir uma conta/)
  })
  it('mostra o limite de tentativas', async () => {
    mock.auth.resetPasswordForEmail.mockResolvedValue({ error: { code: 'over_email_send_rate_limit', status: 429 } })
    montar('/recuperar-senha')
    const u = userEvent.setup()
    await u.type(await screen.findByLabelText('E-mail'), 'ana@exemplo.com')
    await u.click(screen.getByRole('button', { name: 'Enviar link' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/Muitas tentativas/)
  })
})
