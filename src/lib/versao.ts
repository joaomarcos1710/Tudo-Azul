/** Versão do app no formato ano.edição (ex.: "2026.1"); a regra está em docs/VERSOES.md. */
export const VERSAO = __APP_VERSAO__.split('.').slice(0, 2).join('.')

/** "2026.1" ou "2026.1 · 98e83d0" (commit do build, quando o deploy informa). */
export const ROTULO_VERSAO = __APP_COMMIT__ ? `${VERSAO} · ${__APP_COMMIT__}` : VERSAO
