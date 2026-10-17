import { cobrarFaturasFechadas } from './cartoes'
import { gerarOcorrencias } from './recorrencias'

/**
 * Tarefas automáticas que o app faz ao abrir uma tela de valores, nesta ordem:
 * 1. gera as ocorrências dos recorrentes (inclusive assinaturas no cartão de hoje);
 * 2. cobra as parcelas de cartão cujo fechamento chegou.
 * Falha aqui não impede a tela: ela mostra o que já está gravado.
 */
export async function atualizarAutomaticos(): Promise<void> {
  await gerarOcorrencias().catch(() => 0)
  await cobrarFaturasFechadas().catch(() => 0)
}
