import { useEffect, useState } from 'react'
import { useAuth } from './auth'
import { lerDiaInicioDoMes } from './orcamentos'

/**
 * Dia em que o "mês" da pessoa começa (Preferências, 1 a 28), lido uma vez por pessoa e guardado enquanto o app está
 * aberto. Lançamentos e Relatórios usam para abrir no ciclo (com dia 20: 20/11 a 19/12), como o Orçamento (#445).
 * null = ainda lendo: quem usa espera, para não buscar o mês de calendário e trocar de período em seguida.
 * Sem pessoa logada ou com erro de leitura vale 1 (mês de calendário): o período aparece escrito no seletor, então a
 * pessoa vê em que intervalo está.
 */
const guardado = new Map<string, number>()
const lendo = new Map<string, Promise<number>>()

/** Preferências chama depois de salvar: a próxima tela lê o dia novo. */
export function esquecerDiaDoMes(): void {
  guardado.clear()
  lendo.clear()
}

export function useDiaDoMes(): number | null {
  const { sessao } = useAuth()
  const userId = sessao?.user.id
  const [dia, setDia] = useState<number | null>(() => (userId ? guardado.get(userId) ?? null : 1))

  useEffect(() => {
    if (!userId) { setDia(1); return }
    const pronto = guardado.get(userId)
    if (pronto !== undefined) { setDia(pronto); return }
    let ativo = true
    let pedido = lendo.get(userId)
    if (!pedido) {
      pedido = lerDiaInicioDoMes(userId).catch(() => 1)
      lendo.set(userId, pedido)
    }
    void pedido.then((d) => {
      guardado.set(userId, d)
      if (ativo) setDia(d)
    })
    return () => { ativo = false }
  }, [userId])

  return dia
}
