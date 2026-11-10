import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Aviso } from '../components/ui/Aviso'
import { Button } from '../components/ui/Button'
import { Card, CardTitle } from '../components/ui/Card'
import { Field } from '../components/ui/Field'
import { Versao } from '../components/layout/Versao'
import { useFamilia } from '../lib/FamiliaContext'
import {
  criarConvite, criarFamilia, linkDoConvite, listarConvitesPendentes, listarMembros, mensagemErroBanco, tokenDoTexto,
} from '../lib/familia'
import type { ConvitePendente, Membro } from '../lib/familia'
import { CabecalhoPagina } from '../components/ui/CabecalhoPagina'
import { AvisoDiario } from '../components/AvisoDiario'
import { useAuth } from '../lib/auth'
import { PessoasFamilia } from './PessoasFamilia'

export default function Familia() {
  const { familia, carregando } = useFamilia()
  if (carregando) return <p className="text-sm text-slate-600" role="status">Carregando…</p>
  return (
    <>
      <CabecalhoPagina titulo="Família" descricao="Quem participa, os convites e a versão do app." />
      {familia ? <MinhaFamilia /> : <SemFamilia />}
      <Versao className="mt-8 text-slate-500" comCommit />
    </>
  )
}

/** Primeiro acesso: criar a família ou entrar numa por convite. */
function SemFamilia() {
  const { recarregar } = useFamilia()
  const navigate = useNavigate()
  const [nome, setNome] = useState('')
  const [link, setLink] = useState('')
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function criar(e: FormEvent) {
    e.preventDefault()
    setErro('')
    setEnviando(true)
    try {
      await criarFamilia(nome)
      await recarregar()
    } catch (err) {
      setErro(mensagemErroBanco(err))
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Card>
        <CardTitle>Criar a família</CardTitle>
        <p className="mb-4 text-sm text-slate-600">
          Você será o dono: poderá convidar a outra pessoa. As categorias padrão são criadas junto.
        </p>
        <form onSubmit={criar} className="flex flex-col gap-4" noValidate>
          {erro && <Aviso tipo="erro">{erro}</Aviso>}
          <Field rotulo="Nome da família" placeholder="Ex.: Casa Bomfim" maxLength={80} value={nome} onChange={(e) => setNome(e.target.value)} />
          <Button type="submit" carregando={enviando} disabled={!nome.trim()}>Criar família</Button>
        </form>
      </Card>
      <Card>
        <CardTitle>Recebi um convite</CardTitle>
        <p className="mb-4 text-sm text-slate-600">Cole o link que você recebeu por WhatsApp.</p>
        <div className="flex flex-col gap-4">
          <Field rotulo="Link do convite" value={link} onChange={(e) => setLink(e.target.value)} />
          <Button variante="secundario" disabled={!tokenDoTexto(link)} onClick={() => navigate(`/convite#${tokenDoTexto(link)}`)}>
            Abrir convite
          </Button>
        </div>
      </Card>
    </div>
  )
}

function MinhaFamilia() {
  const { familia } = useFamilia()
  const { sessao } = useAuth()
  const [membros, setMembros] = useState<Membro[]>([])
  const [convites, setConvites] = useState<ConvitePendente[]>([])
  const [erroLista, setErroLista] = useState('')
  const dono = familia?.papel === 'owner'

  const familiaId = familia?.id

  // depende só do id: o objeto da família pode ser recriado sem que ela mude
  const carregarListas = useCallback(async () => {
    if (!familiaId) return
    try {
      const [m, c] = await Promise.all([listarMembros(familiaId), dono ? listarConvitesPendentes(familiaId) : []])
      setMembros(m)
      setConvites(c)
      setErroLista('')
    } catch (err) {
      setErroLista(mensagemErroBanco(err))
    }
  }, [familiaId, dono])

  useEffect(() => { void carregarListas() }, [carregarListas])

  if (!familia) return null
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Card>
        <CardTitle>{familia.nome}</CardTitle>
        {erroLista && <Aviso tipo="erro">{erroLista}</Aviso>}
        <ul className="divide-y divide-slate-100">
          {membros.map((m) => (
            <li key={m.userId} className="flex items-center justify-between py-3">
              <span className="font-medium">{m.nome}</span>
              <span className="text-sm text-slate-500">{m.papel === 'owner' ? 'Dono' : 'Membro'}</span>
            </li>
          ))}
        </ul>
        {convites.length > 0 && (
          <>
            <h3 className="mb-2 mt-5 text-sm font-semibold text-slate-500">Convites pendentes</h3>
            <ul className="divide-y divide-slate-100">
              {convites.map((c) => (
                <li key={c.id} className="flex items-center justify-between py-2 text-sm">
                  <span>{c.email}</span>
                  <span className="text-slate-500">vence em {new Date(c.expiraEm).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
      <div className="md:col-span-2"><PessoasFamilia familiaId={familia.id} /></div>
      {dono && <Convidar aoConvidar={carregarListas} />}
      {sessao?.user.id && <AvisoDiario userId={sessao.user.id} familiaId={familia.id} email={sessao.user.email ?? null} />}
    </div>
  )
}

function Convidar({ aoConvidar }: { aoConvidar: () => Promise<void> }) {
  const [email, setEmail] = useState('')
  const [link, setLink] = useState('')
  const [erro, setErro] = useState('')
  const [copiado, setCopiado] = useState(false)
  const [enviando, setEnviando] = useState(false)

  async function convidar(e: FormEvent) {
    e.preventDefault()
    setErro('')
    setLink('')
    setCopiado(false)
    setEnviando(true)
    try {
      setLink(linkDoConvite(await criarConvite(email)))
      await aoConvidar()
    } catch (err) {
      setErro(mensagemErroBanco(err))
    } finally {
      setEnviando(false)
    }
  }

  async function copiar() {
    try {
      await navigator.clipboard.writeText(link)
      setCopiado(true)
    } catch {
      setCopiado(false)
    }
  }

  const textoWhatsApp = encodeURIComponent(`Convite para a nossa família no Tudo Azul (vale 7 dias): ${link}`)

  return (
    <Card>
      <CardTitle>Convidar</CardTitle>
      <p className="mb-4 text-sm text-slate-600">
        A pessoa precisa criar a conta com <strong>este mesmo e-mail</strong> e depois abrir o link. O link vale 7 dias e só funciona uma vez.
      </p>
      <form onSubmit={convidar} className="flex flex-col gap-4" noValidate>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <Field rotulo="E-mail da pessoa" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Button type="submit" carregando={enviando} disabled={!email.trim()}>Gerar convite</Button>
      </form>
      {link && (
        <div className="mt-5 flex flex-col gap-3">
          <Aviso tipo="sucesso">Convite criado. Este link aparece só agora: envie antes de sair da página.</Aviso>
          <code className="break-all rounded-lg bg-slate-100 p-3 text-xs">{link}</code>
          <div className="flex flex-wrap gap-2">
            <Button variante="secundario" onClick={copiar}>{copiado ? 'Copiado!' : 'Copiar link'}</Button>
            <a
              href={`https://wa.me/?text=${textoWhatsApp}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center rounded-lg bg-azul px-4 text-sm font-semibold text-white hover:opacity-90"
            >
              Enviar pelo WhatsApp
            </a>
          </div>
        </div>
      )}
    </Card>
  )
}
