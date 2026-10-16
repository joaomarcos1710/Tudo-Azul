import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Aviso } from '../components/ui/Aviso'
import { Button } from '../components/ui/Button'
import { useAuth } from '../lib/auth'
import { useFamilia } from '../lib/FamiliaContext'
import { aceitarConvite, mensagemErroBanco, tokenDoTexto } from '../lib/familia'
import { LayoutAuth } from './auth/LayoutAuth'

/** Destino do link de convite (/convite#token). Exige login: a RotaProtegida traz a pessoa de volta. */
export default function Convite() {
  const { sessao } = useAuth()
  const { familia, recarregar } = useFamilia()
  const navigate = useNavigate()
  const token = tokenDoTexto(useLocation().hash)
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function aceitar() {
    setErro('')
    setEnviando(true)
    try {
      await aceitarConvite(token)
      await recarregar()
      navigate('/', { replace: true })
    } catch (err) {
      setErro(mensagemErroBanco(err))
    } finally {
      setEnviando(false)
    }
  }

  if (!token) {
    return (
      <LayoutAuth titulo="Convite">
        <Aviso tipo="erro">Este link de convite está incompleto. Peça um novo a quem convidou você.</Aviso>
      </LayoutAuth>
    )
  }
  if (familia) {
    return (
      <LayoutAuth titulo="Convite">
        <Aviso tipo="info">Você já faz parte da família <strong>{familia.nome}</strong>. Cada conta participa de uma família só.</Aviso>
        <p className="mt-5 text-center text-sm"><Link to="/" className="text-azul hover:underline">Ir para o app</Link></p>
      </LayoutAuth>
    )
  }
  return (
    <LayoutAuth titulo="Entrar na família">
      <div className="flex flex-col gap-4">
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <p className="text-sm text-slate-600">
          Você recebeu um convite para compartilhar as finanças da família. Aceite com a conta{' '}
          <strong>{sessao?.user.email}</strong>: ela precisa ter o mesmo e-mail do convite.
        </p>
        <Button carregando={enviando} onClick={aceitar}>Aceitar convite</Button>
      </div>
    </LayoutAuth>
  )
}
