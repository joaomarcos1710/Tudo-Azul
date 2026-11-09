/**
 * Para onde voltar depois de entrar. Só aceita caminho interno do app (uma barra no início, nunca duas):
 * `//outro.site/x` é URL relativa a protocolo e `https://…` é externa; os dois cairiam fora do app (open redirect).
 * Revisão de segurança de 09/11/2026.
 */
export function destinoSeguro(de: unknown): string {
  if (typeof de !== 'string' || !de.startsWith('/') || de.startsWith('//') || de.startsWith('/\\')) return '/'
  return de
}
