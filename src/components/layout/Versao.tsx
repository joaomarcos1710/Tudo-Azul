import { ROTULO_VERSAO } from '../../lib/versao'

/** Versão do app (ano.edição), discreta: serve para dizer qual edição está rodando ao reportar algo. */
export function Versao({ className = '' }: { className?: string }) {
  return <p className={`text-xs ${className}`} aria-label={`Versão ${ROTULO_VERSAO}`}>Versão {ROTULO_VERSAO}</p>
}
