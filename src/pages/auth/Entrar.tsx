import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Aviso } from '../../components/ui/Aviso'
import { Button } from '../../components/ui/Button'
import { Field } from '../../components/ui/Field'
import { mensagemErroAuth, useAuth } from '../../lib/auth'
import { supabase } from '../../lib/supabase'
import { destinoSeguro } from '../../lib/destinoSeguro'
import { LayoutAuth } from './LayoutAuth'

export default function Entrar() {
  const { sessao } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const destino = destinoSeguro((location.state as { de?: unknown } | null)?.de)
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)

  if (sessao) return <Navigate to={destino} replace />

  async function entrar(e: FormEvent) {
    e.preventDefault()
    if (!supabase) return
    setErro('')
    setEnviando(true)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: senha })
    setEnviando(false)
    if (error) setErro(mensagemErroAuth(error))
    else navigate(destino, { replace: true })
  }

  return (
    <LayoutAuth titulo="Entrar">
      <form onSubmit={entrar} className="flex flex-col gap-4" noValidate>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <Field rotulo="E-mail" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Field rotulo="Senha" type="password" autoComplete="current-password" required value={senha} onChange={(e) => setSenha(e.target.value)} />
        <Button type="submit" carregando={enviando} disabled={!email.trim() || !senha}>Entrar</Button>
      </form>
      <div className="mt-5 flex flex-col gap-2 text-center text-sm">
        <Link to="/recuperar-senha" className="text-azul hover:underline">Esqueci minha senha</Link>
        <Link to="/cadastro" className="text-azul hover:underline">Criar conta</Link>
      </div>
    </LayoutAuth>
  )
}
