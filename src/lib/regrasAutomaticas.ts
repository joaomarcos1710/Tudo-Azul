import type { TipoLancamento } from './lancamentos'

/**
 * Regra de classificação sugerida para um lançamento.
 * A função é pura: não grava nada e nunca altera valor, conta, data ou tipo.
 */
export interface RegraAutomatica {
  id: string
  nome: string
  trechoDescricao: string
  tipo: TipoLancamento
  categoriaId: string
  ativa: boolean
  prioridade: number
}

export interface SugestaoRegra {
  regraId: string
  nomeRegra: string
  categoriaId: string
  trechoCorrespondente: string
}

function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Retorna sugestões de classificação em ordem determinística.
 * Maior prioridade vem primeiro; em empate, o critério mais específico vem primeiro.
 * Regras inativas, sem critério e de outro tipo nunca correspondem.
 */
export function sugerirRegras(
  descricao: string,
  tipo: TipoLancamento,
  regras: readonly RegraAutomatica[],
): SugestaoRegra[] {
  const texto = normalizar(descricao)
  if (!texto) return []

  return regras
    .filter((r) => r.ativa && r.tipo === tipo && normalizar(r.trechoDescricao).length > 0)
    .filter((r) => texto.includes(normalizar(r.trechoDescricao)))
    .sort((a, b) => b.prioridade - a.prioridade
      || normalizar(b.trechoDescricao).length - normalizar(a.trechoDescricao).length
      || a.id.localeCompare(b.id))
    .map((r) => ({
      regraId: r.id,
      nomeRegra: r.nome,
      categoriaId: r.categoriaId,
      trechoCorrespondente: r.trechoDescricao.trim(),
    }))
}
