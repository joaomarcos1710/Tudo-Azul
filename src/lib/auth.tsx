import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'

interface EstadoAuth {
  /** Sessão atual, ou null se ninguém entrou. */
  sessao: Session | null
  /** True até a primeira leitura da sessão terminar (evita piscar a tela de login). */
  carregando: boolean
}

const AuthContext = createContext<EstadoAuth>({ sessao: null, carregando: true })

/** Mantém a sessão do Supabase Auth em contexto e acompanha entradas, saídas e renovações. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [estado, setEstado] = useState<EstadoAuth>({ sessao: null, carregando: Boolean(supabase) })

  useEffect(() => {
    if (!supabase) return
    let ativo = true
    supabase.auth.getSession().then(({ data }) => {
      if (ativo) setEstado({ sessao: data.session, carregando: false })
    })
    const { data } = supabase.auth.onAuthStateChange((_evento, sessao) => {
      if (ativo) setEstado({ sessao, carregando: false })
    })
    return () => {
      ativo = false
      data.subscription.unsubscribe()
    }
  }, [])

  return <AuthContext.Provider value={estado}>{children}</AuthContext.Provider>
}

export function useAuth(): EstadoAuth {
  return useContext(AuthContext)
}

/** Tamanho mínimo de senha exigido pela tela (o Supabase hospedado deve usar o mesmo valor). */
export const SENHA_MINIMA = 8

const mensagens: Record<string, string> = {
  invalid_credentials: 'E-mail ou senha incorretos.',
  email_not_confirmed: 'Confirme seu e-mail antes de entrar: procure a mensagem do Tudo Azul na sua caixa de entrada.',
  user_already_exists: 'Já existe uma conta com este e-mail. Tente entrar ou recuperar a senha.',
  email_exists: 'Já existe uma conta com este e-mail. Tente entrar ou recuperar a senha.',
  weak_password: `Senha fraca. Use pelo menos ${SENHA_MINIMA} caracteres, misturando letras e números.`,
  same_password: 'A nova senha precisa ser diferente da atual.',
  over_email_send_rate_limit: 'Muitas tentativas seguidas. Aguarde alguns minutos e tente de novo.',
  over_request_rate_limit: 'Muitas tentativas seguidas. Aguarde alguns minutos e tente de novo.',
  signup_disabled: 'O cadastro de novas contas está desativado.',
  email_address_invalid: 'Este e-mail não foi aceito. Confira o endereço ou use outro.',
  email_address_not_authorized: 'O envio de e-mails ainda não está liberado para este endereço. Peça ao administrador para configurar o e-mail (SMTP) do Supabase.',
}

/** Traduz um erro do Supabase Auth para uma mensagem clara em português, sem expor detalhes técnicos. */
export function mensagemErroAuth(erro: { code?: string; message?: string; status?: number } | null | undefined): string {
  if (!erro) return ''
  if (erro.code && mensagens[erro.code]) return mensagens[erro.code]
  if (erro.status === 0 || /failed to fetch|network/i.test(erro.message ?? '')) {
    return 'Sem conexão com o servidor. Verifique sua internet e tente de novo.'
  }
  // O código ajuda a diagnosticar sem expor a mensagem técnica.
  const codigo = erro.code ?? (erro.status ? String(erro.status) : '')
  return `Não foi possível concluir agora. Tente de novo em instantes.${codigo ? ` (código: ${codigo})` : ''}`
}
