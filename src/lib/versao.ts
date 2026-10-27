/** Versão do app no formato ano.edição (ex.: "2026.2"); a regra está em docs/VERSOES.md. */
export const VERSAO = __APP_VERSAO__.split('.').slice(0, 2).join('.')

/** Commit curto do build (vazio fora da Vercel). */
export const COMMIT = __APP_COMMIT__
