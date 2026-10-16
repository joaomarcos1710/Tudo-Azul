import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Aviso } from '../../components/ui/Aviso'
import { Button } from '../../components/ui/Button'
import { Field } from '../../components/ui/Field'
import { mensagemErroAuth } from '../../lib/auth'
import { supabase } from '../../lib/supabase'
import { LayoutAuth } from './LayoutAuth'

export default function RecuperarSenha() {
  const [email, setEmail] = useState('')
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [enviado, setEnviado] = useState(false)

  async function enviar(e: FormEvent) {
    e.preventDefault()
    if (!supabase) return
    setErro('')
    setEnviando(true)
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/nova-senha`,
    })
    setEnviando(false)
    // Mesma resposta exista ou não a conta, para não revelar quais e-mails estão cadastrados.
    // Só limite de tentativas e falha de rede viram erro na tela.
    if (error && (error.code?.startsWith('over_') || error.status === 0)) setErro(mensagemErroAuth(error))
    else setEnviado(true)
  }

  return (
    <LayoutAuth titulo="Recuperar senha">
      {enviado ? (
        <Aviso tipo="sucesso">
          Se existir uma conta com <strong>{email.trim()}</strong>, enviamos um link para criar uma nova senha. Confira também a caixa de spam.
        </Aviso>
      ) : (
        <form onSubmit={enviar} className="flex flex-col gap-4" noValidate>
          {erro && <Aviso tipo="erro">{erro}</Aviso>}
          <p className="text-sm text-slate-600">Informe o e-mail da sua conta. Enviaremos um link para você criar uma nova senha.</p>
          <Field rotulo="E-mail" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <Button type="submit" carregando={enviando} disabled={!email.trim()}>Enviar link</Button>
        </form>
      )}
      <p className="mt-5 text-center text-sm">
        <Link to="/entrar" className="text-azul hover:underline">Voltar para entrar</Link>
      </p>
    </LayoutAuth>
  )
}
