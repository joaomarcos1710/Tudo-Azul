import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Aviso } from '../../components/ui/Aviso'
import { Button } from '../../components/ui/Button'
import { Field } from '../../components/ui/Field'
import { mensagemErroAuth, SENHA_MINIMA, useAuth } from '../../lib/auth'
import { supabase } from '../../lib/supabase'
import { LayoutAuth } from './LayoutAuth'

/** Destino do link de recuperação: o Supabase abre uma sessão temporária e aqui a senha é trocada. */
export default function NovaSenha() {
  const { sessao, carregando } = useAuth()
  const navigate = useNavigate()
  const [senha, setSenha] = useState('')
  const [confirmacao, setConfirmacao] = useState('')
  const [tentou, setTentou] = useState(false)
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)

  if (carregando) return <LayoutAuth titulo="Nova senha"><p className="text-sm text-slate-600">Carregando…</p></LayoutAuth>

  if (!sessao) {
    return (
      <LayoutAuth titulo="Link inválido ou expirado">
        <Aviso tipo="erro">Este link de recuperação não é mais válido. Peça um novo.</Aviso>
        <p className="mt-5 text-center text-sm">
          <Link to="/recuperar-senha" className="text-azul hover:underline">Pedir novo link</Link>
        </p>
      </LayoutAuth>
    )
  }

  const erroSenha = tentou && senha.length < SENHA_MINIMA ? `A senha precisa ter pelo menos ${SENHA_MINIMA} caracteres.` : undefined
  const erroConfirmacao = tentou && confirmacao !== senha ? 'As senhas não conferem.' : undefined

  async function salvar(e: FormEvent) {
    e.preventDefault()
    setTentou(true)
    if (!supabase || senha.length < SENHA_MINIMA || confirmacao !== senha) return
    setErro('')
    setEnviando(true)
    const { error } = await supabase.auth.updateUser({ password: senha })
    setEnviando(false)
    if (error) setErro(mensagemErroAuth(error))
    else navigate('/', { replace: true })
  }

  return (
    <LayoutAuth titulo="Nova senha">
      <form onSubmit={salvar} className="flex flex-col gap-4" noValidate>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <Field rotulo={`Nova senha (mínimo ${SENHA_MINIMA} caracteres)`} type="password" autoComplete="new-password" required value={senha} onChange={(e) => setSenha(e.target.value)} erro={erroSenha} />
        <Field rotulo="Repita a nova senha" type="password" autoComplete="new-password" required value={confirmacao} onChange={(e) => setConfirmacao(e.target.value)} erro={erroConfirmacao} />
        <Button type="submit" carregando={enviando}>Salvar nova senha</Button>
      </form>
    </LayoutAuth>
  )
}
