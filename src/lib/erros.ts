/**
 * Mensagem para erros vindos do banco (RPCs, triggers e constraints). As regras de negócio
 * levantam texto em português escrito nas migrations (ex.: "convite inválido ou expirado"),
 * que pode ir para a tela; o resto vira mensagem genérica, sem detalhe técnico.
 */
const comTextoProprio = new Set([
  '22023', // parâmetro inválido (RPCs)
  '55000', // estado não permite a operação
  '23514', // regra de integridade (triggers)
  '22003', // valor fora do formato (ex.: mais de 2 casas decimais)
])

/** O banco escreve datas como 2026-10-05; na tela é 05/10/2026. */
function datasParaBR(texto: string): string {
  return texto.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, '$3/$2/$1')
}

export function mensagemErroBanco(erro: unknown): string {
  const e = (erro ?? {}) as { code?: string; message?: string }
  if (e.code && comTextoProprio.has(e.code) && e.message && !/violates|constraint|column|relation/i.test(e.message)) {
    const msg = datasParaBR(e.message)
    return msg.charAt(0).toUpperCase() + msg.slice(1) + '.'
  }
  if (e.code === '23505') return 'Já existe um registro com esse nome.'
  if (e.code === '42501') return 'Você não tem permissão para esta ação.'
  if (/failed to fetch|network|load failed|internet connection|offline/i.test(e.message ?? '')) return 'Sem conexão com o servidor. Verifique sua internet e tente de novo.'
  return 'Não foi possível concluir agora. Tente de novo em instantes.'
}
