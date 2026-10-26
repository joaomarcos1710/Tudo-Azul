import { COMMIT, VERSAO } from '../../lib/versao'

/**
 * Versão do app (ano.edição), discreta, em todas as telas. Com `comCommit` (tela Família) mostra também o
 * commit do build, útil para saber exatamente qual código está rodando ao reportar algo.
 */
export function Versao({ className = '', comCommit = false }: { className?: string; comCommit?: boolean }) {
  const rotulo = comCommit && COMMIT ? `${VERSAO} · ${COMMIT}` : VERSAO
  return <p className={`text-xs ${className}`} aria-label={`Versão ${rotulo}`}>Versão {rotulo}</p>
}
