/*
 * Consulta opcional de uma tela: se falhar, o bloco dela some (null) e o resto da tela segue — mas a falha não é mais
 * silenciosa: vai ao Sentry só com o nome da consulta e o código do erro (nada de mensagem, valor, data ou id).
 * O SDK é carregado sob demanda (como no main.tsx), para não pesar na primeira abertura; sem Sentry iniciado
 * (desenvolvimento, testes, produção sem DSN) o captureException não faz nada.
 */

/** Código curto do erro: o do PostgREST/Postgres (ex.: 57014 = statement timeout), o status HTTP ou o tipo do erro. */
export function codigoDoErro(erro: unknown): string {
  if (erro && typeof erro === 'object') {
    const e = erro as { code?: unknown; status?: unknown; name?: unknown }
    if (typeof e.code === 'string' && e.code) return e.code
    if (typeof e.status === 'number') return String(e.status)
    if (typeof e.name === 'string' && e.name) return e.name
  }
  return 'desconhecido'
}

/** Manda ao Sentry que a consulta falhou: só o nome dela e o código do erro. Nunca lança. */
export function registrarFalhaConsulta(consulta: string, erro: unknown): Promise<void> {
  const codigo = codigoDoErro(erro)
  return import('@sentry/react')
    .then((s) => {
      s.captureException(new Error(`Consulta opcional falhou: ${consulta} (${codigo})`), {
        tags: { consulta, codigo },
        fingerprint: ['consulta-opcional', consulta, codigo],
      })
    })
    .catch(() => undefined)
}

/** O resultado da consulta, ou null se ela falhar (a falha vai ao Sentry). */
export function opcional<T>(consulta: string, p: Promise<T>): Promise<T | null> {
  return p.catch((erro: unknown) => {
    void registrarFalhaConsulta(consulta, erro)
    return null
  })
}
