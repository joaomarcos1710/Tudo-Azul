import { hojeSP } from './contas'

/**
 * Aviso de autoria (ideia 03, pedido do dono): o mesmo texto na tela de entrar e no menu de perfil, vindo de um lugar
 * só para as duas telas não divergirem. O ano é o de hoje em São Paulo (vira sozinho em 1º de janeiro), não um número
 * fixo que ficaria errado no ano seguinte. É uma declaração de autoria, não proteção legal.
 */
export const AUTOR = 'João Marcos'
export const PRODUTO = 'Tudo Azul'

export function linhasAutoria(hoje: string = hojeSP()): [string, string] {
  return [`© ${hoje.slice(0, 4)} ${PRODUTO}.`, `Todos os direitos reservados a ${AUTOR}.`]
}
