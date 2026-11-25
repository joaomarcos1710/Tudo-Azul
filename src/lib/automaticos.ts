import { cobrarFaturasFechadas, converterAgendados, sincronizarAgendados } from './cartoes'
import { gerarOcorrencias } from './recorrencias'

export interface ResultadoAutomaticos {
  /** false: a geração dos recorrentes falhou (os planejados podem estar faltando). */
  recorrentesOk: boolean
  /** false: a cobrança das faturas falhou (valores de cartão podem estar defasados). */
  faturasOk: boolean
  /**
   * true: alguma tarefa gravou algo que muda valores já na tela (recorrente gerado, fatura cobrada, assinatura convertida
   * em compra). Quem mostra os dados antes de as tarefas terminarem usa isto para recarregar. O sync das assinaturas
   * futuras não conta: só alimenta a lista de faturas futuras do cartão.
   */
  mudou: boolean
}

/** Quanto tempo o resultado de uma rodada vale para as próximas telas (mesma família, mesmo dia). */
const VALIDADE_MS = 10 * 60 * 1000
const diaSP = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
/** Rodadas em andamento, por chave: duas telas que abrem juntas dividem a mesma. */
const emAndamento = new Map<string, Promise<ResultadoAutomaticos>>()
/** Última rodada sem falha, por chave. */
const ultimaBoa = new Map<string, { dia: string; quando: number }>()

/** Esquece as rodadas lembradas (troca de usuário; testes). */
export function esquecerAutomaticos(): void {
  emAndamento.clear()
  ultimaBoa.clear()
}

/**
 * Tarefas automáticas que o app faz ao abrir uma tela de valores, nesta ordem:
 * 1. gera as ocorrências dos recorrentes (inclusive assinaturas no cartão de hoje);
 * 2. cobra as parcelas de cartão cujo fechamento chegou;
 * 3. atualiza as assinaturas de cartão agendadas nas faturas dos próximos 12 meses (card_scheduled_sync);
 * 4. converte em parcela as agendadas da fatura que já é a aberta, porque a anterior fechou (card_scheduled_convert).
 * Uma falha não impede a outra nem a tela; o resultado diz o que falhou, para a tela avisar. A etapa 3 é só leitura
 * futura (não mexe em fatura, limite nem saldo): se falhar, nada é avisado e a lista de faturas futuras fica como estava.
 *
 * Com `chave` (a família), as quatro gravações não se repetem a cada troca de tela (25/11/2026: eram ~4 chamadas pesadas
 * por tela, com o banco saturado): duas telas ao mesmo tempo dividem a mesma rodada, e uma rodada sem falha vale por
 * 10 minutos no mesmo dia (as tarefas dependem da data; o que a pessoa grava na tela já chama a sua própria atualização).
 * `forcar` roda de novo mesmo assim (Cartões, depois de gravar compra em fatura já fechada). Sem `chave`, roda sempre.
 */
export async function atualizarAutomaticos(opcoes: { chave?: string; forcar?: boolean } = {}): Promise<ResultadoAutomaticos> {
  const { chave, forcar = false } = opcoes
  if (chave === undefined) return rodar()
  const andando = emAndamento.get(chave)
  if (andando) {
    if (!forcar) return andando
    await andando.catch(() => undefined)
  }
  const boa = ultimaBoa.get(chave)
  if (!forcar && boa && boa.dia === diaSP() && Date.now() - boa.quando < VALIDADE_MS) {
    return { recorrentesOk: true, faturasOk: true, mudou: false }
  }
  const rodada = rodar().then((r) => {
    if (r.recorrentesOk && r.faturasOk) ultimaBoa.set(chave, { dia: diaSP(), quando: Date.now() })
    else ultimaBoa.delete(chave)
    return r
  }).finally(() => { if (emAndamento.get(chave) === rodada) emAndamento.delete(chave) })
  emAndamento.set(chave, rodada)
  return rodada
}

async function rodar(): Promise<ResultadoAutomaticos> {
  let mudou = false
  const contar = (n: unknown) => { if (typeof n === 'number' && n > 0) mudou = true }
  const recorrentesOk = await gerarOcorrencias().then((n) => { contar(n); return true }, () => false)
  const faturasOk = await cobrarFaturasFechadas().then((n) => { contar(n); return true }, () => false)
  try { await sincronizarAgendados() } catch { /* opcional: banco ainda sem a função, ou falha passageira */ }
  try { contar(await converterAgendados()) } catch { /* opcional: banco ainda sem a função, ou falha passageira */ }
  return { recorrentesOk, faturasOk, mudou }
}
