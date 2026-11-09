import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { Aviso } from '../../components/ui/Aviso'
import { Button } from '../../components/ui/Button'
import { Field } from '../../components/ui/Field'
import { mensagemErroAuth, SENHA_MINIMA, useAuth } from '../../lib/auth'
import { supabase } from '../../lib/supabase'
import { LayoutAuth } from './LayoutAuth'

export default function Cadastro() {
  const { sessao } = useAuth()
  const navigate = useNavigate()
  const [nome, setNome] = useState('')
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [confirmacao, setConfirmacao] = useState('')
  const [erro, setErro] = useState('')
  const [tentou, setTentou] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [confirmarEmail, setConfirmarEmail] = useState(false)

  if (sessao) return <Navigate to="/painel" replace />

  const erroNome = tentou && !nome.trim() ? 'Informe seu nome.' : nome.trim().length > 80 ? 'Use no máximo 80 caracteres.' : undefined
  const erroSenha = tentou && senha.length < SENHA_MINIMA ? `A senha precisa ter pelo menos ${SENHA_MINIMA} caracteres.` : undefined
  const erroConfirmacao = tentou && confirmacao !== senha ? 'As senhas não conferem.' : undefined

  async function cadastrar(e: FormEvent) {
    e.preventDefault()
    setTentou(true)
    if (!supabase || !nome.trim() || nome.trim().length > 80 || senha.length < SENHA_MINIMA || confirmacao !== senha) return
    setErro('')
    setEnviando(true)
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password: senha,
      // `name` é lido por private.handle_new_user para criar o perfil
      options: { data: { name: nome.trim() }, emailRedirectTo: `${window.location.origin}/painel` },
    })
    setEnviando(false)
    if (error) setErro(mensagemErroAuth(error))
    else if (data.session) navigate('/painel', { replace: true })
    else setConfirmarEmail(true) // projeto com confirmação de e-mail ligada
  }

  if (confirmarEmail) {
    return (
      <LayoutAuth titulo="Confira seu e-mail">
        <Aviso tipo="sucesso">
          Enviamos um link de confirmação para <strong>{email.trim()}</strong>. Abra o e-mail e toque no link para ativar a conta.
        </Aviso>
        <p className="mt-5 text-center text-sm">
          <Link to="/entrar" className="text-azul hover:underline">Voltar para entrar</Link>
        </p>
      </LayoutAuth>
    )
  }

  return (
    <LayoutAuth titulo="Criar conta">
      <form onSubmit={cadastrar} className="flex flex-col gap-4" noValidate>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <Field rotulo="Seu nome" autoComplete="name" required maxLength={80} value={nome} onChange={(e) => setNome(e.target.value)} erro={erroNome} />
        <Field rotulo="E-mail" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Field rotulo={`Senha (mínimo ${SENHA_MINIMA} caracteres)`} type="password" autoComplete="new-password" required value={senha} onChange={(e) => setSenha(e.target.value)} erro={erroSenha} />
        <Field rotulo="Repita a senha" type="password" autoComplete="new-password" required value={confirmacao} onChange={(e) => setConfirmacao(e.target.value)} erro={erroConfirmacao} />
        <Button type="submit" carregando={enviando} disabled={!email.trim()}>Criar conta</Button>
      </form>
      <p className="mt-5 text-center text-sm">
        Já tem conta? <Link to="/entrar" className="text-azul hover:underline">Entrar</Link>
      </p>
    </LayoutAuth>
  )
}
