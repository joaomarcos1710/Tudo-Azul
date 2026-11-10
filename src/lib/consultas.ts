import { QueryClient } from '@tanstack/react-query'

/**
 * Cache das consultas do Início (TanStack Query), decisão do dono em 10/11/2026.
 *
 * - Só em MEMÓRIA: nada de saldo, dívida ou fatura é gravado no aparelho. Recarregar a página ou abrir outra aba começa
 *   do zero (aparece "Carregando…"); voltar ao Início pela navegação do app mostra na hora o que já estava carregado.
 * - staleTime 0: o que está guardado aparece na hora, mas TODA volta à tela revalida no banco. Número financeiro nunca
 *   fica "congelado" por minutos.
 * - Sem novas tentativas automáticas: a tela já tem as mensagens de erro dela, e repetir consulta pesada só atrasa o aviso.
 * - Sem revalidar ao focar a janela: as consultas do Início ainda são pesadas (ver "40 - Pendências", velocidade).
 * - Ao sair da conta o cache é limpo (lib/auth.tsx).
 */
export function criarClienteConsultas(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { staleTime: 0, gcTime: 5 * 60 * 1000, retry: false, refetchOnWindowFocus: false } },
  })
}

export const clienteConsultas = criarClienteConsultas()

const RAIZ_HOME = 'home'

/** Chave da carga do Início/Análises: seção, família, mês e dia. Mudou qualquer um, é outra entrada (nada vaza). */
export function chaveVisaoGeral(secao: string, familiaId: string, mes: string, hoje: string) {
  return [RAIZ_HOME, familiaId, secao, mes, hoje] as const
}

/**
 * Chame depois de qualquer gravação que mude saldos, lançamentos, parcelas ou faturas com o Início montado (ex.: as
 * tarefas automáticas): os blocos revalidam em segundo plano, sem voltar ao "Carregando…".
 */
export async function invalidarDadosHome(cliente: QueryClient, familiaId: string): Promise<void> {
  const queryKey = [RAIZ_HOME, familiaId]
  // Uma PRIMEIRA carga ainda em andamento pode ter lido o banco antes da gravação, e o TanStack não a refaz ao
  // invalidar (sem dado guardado, ele reaproveita a busca em curso): cancelar força uma leitura nova.
  await cliente.cancelQueries({ queryKey, predicate: (q) => q.state.data === undefined })
  return cliente.invalidateQueries({ queryKey })
}
