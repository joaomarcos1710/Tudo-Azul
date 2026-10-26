import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useAuth } from './auth'
import { carregarFamilia } from './familia'
import type { Familia } from './familia'

interface EstadoFamilia {
  familia: Familia | null
  carregando: boolean
  erro: boolean
  /** Relê a família (depois de criar uma ou aceitar um convite). */
  recarregar: () => Promise<void>
}

const FamiliaContext = createContext<EstadoFamilia>({
  familia: null, carregando: true, erro: false, recarregar: async () => {},
})

/**
 * Família do usuário logado; muda quando a sessão muda.
 * `de` guarda de quem é a família carregada: no instante em que a sessão aparece (abrir o app já logado, ou entrar),
 * o estado ainda é o do "sem usuário" (família nula, não carregando) até o efeito rodar. Sem essa guarda, o
 * ExigeFamilia via esse instante como "sem família" e mandava para /familia em vez de abrir o Início.
 */
export function FamiliaProvider({ children }: { children: ReactNode }) {
  const { sessao } = useAuth()
  const userId = sessao?.user.id
  const [estado, setEstado] = useState({ familia: null as Familia | null, carregando: true, erro: false, de: undefined as string | undefined })

  const recarregar = useCallback(async () => {
    if (!userId) {
      setEstado({ familia: null, carregando: false, erro: false, de: undefined })
      return
    }
    setEstado((s) => ({ ...s, carregando: true }))
    try {
      setEstado({ familia: await carregarFamilia(userId), carregando: false, erro: false, de: userId })
    } catch {
      setEstado({ familia: null, carregando: false, erro: true, de: userId })
    }
  }, [userId])

  useEffect(() => { void recarregar() }, [recarregar])

  const carregando = estado.carregando || (userId !== undefined && estado.de !== userId)
  return (
    <FamiliaContext.Provider value={{ familia: estado.familia, carregando, erro: estado.erro, recarregar }}>
      {children}
    </FamiliaContext.Provider>
  )
}

export function useFamilia(): EstadoFamilia {
  return useContext(FamiliaContext)
}
