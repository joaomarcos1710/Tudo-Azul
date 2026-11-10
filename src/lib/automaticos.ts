import { cobrarFaturasFechadas, sincronizarAgendados } from './cartoes'
import { gerarOcorrencias } from './recorrencias'

export interface ResultadoAutomaticos {
  /** false: a geração dos recorrentes falhou (os planejados podem estar faltando). */
  recorrentesOk: boolean
  /** false: a cobrança das faturas falhou (valores de cartão podem estar defasados). */
  faturasOk: boolean
}

/**
 * Tarefas automáticas que o app faz ao abrir uma tela de valores, nesta ordem:
 * 1. gera as ocorrências dos recorrentes (inclusive assinaturas no cartão de hoje);
 * 2. cobra as parcelas de cartão cujo fechamento chegou;
 * 3. atualiza as assinaturas de cartão agendadas nas faturas dos próximos 12 meses (card_scheduled_sync).
 * Uma falha não impede a outra nem a tela; o resultado diz o que falhou, para a tela avisar. A etapa 3 é só leitura
 * futura (não mexe em fatura, limite nem saldo): se falhar, nada é avisado e a lista de faturas futuras fica como estava.
 */
export async function atualizarAutomaticos(): Promise<ResultadoAutomaticos> {
  const recorrentesOk = await gerarOcorrencias().then(() => true, () => false)
  const faturasOk = await cobrarFaturasFechadas().then(() => true, () => false)
  try { await sincronizarAgendados() } catch { /* opcional: banco ainda sem a função, ou falha passageira */ }
  return { recorrentesOk, faturasOk }
}
