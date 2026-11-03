import { browserTracingIntegration, init } from '@sentry/react'
import type { Breadcrumb, ErrorEvent } from '@sentry/react'
import { COMMIT, VERSAO } from './versao'

/*
 * Monitoramento de erros (Sentry). Só liga em produção e só com VITE_SENTRY_DSN definido no Vercel.
 * App de finanças: nada de dado pessoal nem de valor sai daqui.
 *  - sem dado pessoal: dataCollection todo desligado (usuário, cookies, cabeçalhos, query, corpo), sem Replay, sem console;
 *  - URLs vão sem query string (os filtros do Supabase carregam ids e datas);
 *  - valores em R$ e e-mails que apareçam numa mensagem de erro são trocados por marcadores;
 *  - nenhum cabeçalho de rastreio é enviado ao Supabase (tracePropagationTargets vazio).
 * Este arquivo (e o SDK) é carregado sob demanda pelo main.tsx, depois da página, para não pesar na primeira abertura.
 */

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g
// R$ 1.234,56 · -R$ 50,00 · 1.234,56 (formato brasileiro com centavos)
const DINHEIRO = /(?:-?R\$\s?)?-?\d{1,3}(?:\.\d{3})*,\d{2}\b|-?R\$\s?-?\d+(?:,\d{1,2})?/g

export function limparTexto(texto: string): string {
  return texto.replace(EMAIL, '[email]').replace(DINHEIRO, '[valor]')
}

function semQuery(url: string): string {
  const i = url.search(/[?#]/)
  return i === -1 ? url : url.slice(0, i)
}

/** Antes de enviar um erro: tira pessoa, requisição e textos sensíveis. */
export function limparEvento(evento: ErrorEvent): ErrorEvent {
  delete evento.user
  delete evento.extra
  if (evento.request) evento.request = { url: evento.request.url ? semQuery(evento.request.url) : undefined }
  if (evento.message) evento.message = limparTexto(evento.message)
  for (const ex of evento.exception?.values ?? []) {
    if (ex.value) ex.value = limparTexto(ex.value)
  }
  evento.breadcrumbs = (evento.breadcrumbs ?? []).map(filtrarRastro).filter((b): b is Breadcrumb => b !== null)
  return evento
}

/** Rastro do que aconteceu antes do erro: sem console, URLs sem query, mensagens limpas. */
export function filtrarRastro(rastro: Breadcrumb): Breadcrumb | null {
  if (rastro.category === 'console') return null
  const r: Breadcrumb = { ...rastro }
  if (r.message) r.message = limparTexto(r.message)
  if (r.data && typeof r.data.url === 'string') r.data = { ...r.data, url: semQuery(r.data.url) }
  if (r.data && typeof r.data.to === 'string') r.data = { ...r.data, to: semQuery(r.data.to), from: typeof r.data.from === 'string' ? semQuery(r.data.from) : r.data.from }
  return r
}

export function iniciarMonitoramento(dsn: string): void {
  init({
    dsn,
    release: COMMIT ? `tudo-azul@${VERSAO}+${COMMIT}` : `tudo-azul@${VERSAO}`,
    environment: 'producao',
    // tudo desligado: o padrão do SDK coleta cabeçalhos, cookies, query e corpo das requisições (que levariam valores e tokens)
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
    },
    // velocidade real (carregamento e navegação) numa amostra das visitas; sem cabeçalho extra para o Supabase
    integrations: [browserTracingIntegration()],
    tracesSampleRate: 0.2,
    tracePropagationTargets: [],
    beforeSend: (evento) => limparEvento(evento),
    beforeBreadcrumb: (rastro) => filtrarRastro(rastro),
  })
}
