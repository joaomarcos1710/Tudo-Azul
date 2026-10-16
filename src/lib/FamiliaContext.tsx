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

/** Família do usuário logado; muda quando a sessão muda. */
export function FamiliaProvider({ children }: { children: ReactNode }) {
  const { sessao } = useAuth()
  const userId = sessao?.user.id
  const [estado, setEstado] = useState({ familia: null as Familia | null, carregando: true, erro: false })

  const recarregar = useCallback(async () => {
    if (!userId) {
      setEstado({ familia: null, carregando: false, erro: false })
      return
    }
    setEstado((s) => ({ ...s, carregando: true }))
    try {
      setEstado({ familia: await carregarFamilia(userId), carregando: false, erro: false })
    } catch {
      setEstado({ familia: null, carregando: false, erro: true })
    }
  }, [userId])

  useEffect(() => { void recarregar() }, [recarregar])

  return <FamiliaContext.Provider value={{ ...estado, recarregar }}>{children}</FamiliaContext.Provider>
}

export function useFamilia(): EstadoFamilia {
  return useContext(FamiliaContext)
}
