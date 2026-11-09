/* Tudo Azul — service worker.
 * Regra de ouro: guarda SÓ o app (HTML, JS, CSS, ícones, fontes). Nunca guarda dados financeiros:
 * tudo que vem do Supabase (outro domínio) passa direto pela rede, para nunca mostrar saldo velho.
 * - Navegação (HTML): rede primeiro; sem internet OU com a rede lenta demais (4 s), usa a última versão guardada do app.
 *   Só guarda resposta de sucesso (uma página de erro nunca vira a "última versão").
 * - /assets/* (arquivos com hash no nome, imutáveis): cache primeiro. Só guarda JS/CSS de verdade: no Vercel um arquivo que
 *   não existe volta como index.html com status 200, e guardar isso quebraria o app até limpar o cache do site.
 * - Ícones e fontes: cache primeiro, atualiza em segundo plano.
 */
// v2: troca o prefixo para o activate apagar os caches v1 (que podiam conter uma página de erro no lugar do app)
const VERSAO = 'tudo-azul-v3'
const APP = `${VERSAO}-app`
const ESTATICOS = `${VERSAO}-estaticos`

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(APP).then((c) => c.addAll(['/', '/manifest.webmanifest', '/favicon.png', '/icons/icon-192.png'])))
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((nomes) => Promise.all(nomes.filter((n) => !n.startsWith(VERSAO)).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  const fonte = url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com'
  // outro domínio (Supabase, Vercel analytics...): não intercepta — dados sempre da rede
  if (url.origin !== self.location.origin && !fonte) return

  if (req.mode === 'navigate') {
    const rede = fetch(req).then((r) => {
      if (r.ok) { const copia = r.clone(); caches.open(APP).then((c) => c.put('/', copia)) }
      return r
    })
    e.respondWith(
      caches.match('/').then((guardado) => {
        // primeira visita (nada guardado): só resta esperar a rede
        if (!guardado) return rede.catch(() => Response.error())
        // sinal ruim: depois de 4 s abre a versão guardada em vez de uma tela em branco; a rede segue e atualiza a cópia
        const espera = new Promise((resolve) => setTimeout(() => resolve(guardado), 4000))
        return Promise.race([rede.then((r) => (r.ok ? r : guardado)), espera]).catch(() => guardado)
      }),
    )
    return
  }

  if (url.pathname.startsWith('/assets/')) {
    const ehHtml = (r) => /text\/html/i.test(r.headers.get('content-type') ?? '')
    e.respondWith(
      // uma entrada HTML guardada por engano no lugar de um arquivo do app é ignorada e refeita pela rede
      caches.match(req).then((guardado) => (guardado && !ehHtml(guardado) ? guardado : fetch(req).then((r) => {
        if (r.ok && !ehHtml(r)) { const copia = r.clone(); caches.open(ESTATICOS).then((c) => c.put(req, copia)) }
        return r
      }))),
    )
    return
  }

  if (fonte || url.pathname.startsWith('/icons/') || url.pathname === '/favicon.png' || url.pathname === '/manifest.webmanifest') {
    e.respondWith(
      caches.match(req).then((guardado) => {
        const rede = fetch(req).then((r) => {
          if (r.ok || r.type === 'opaque') { const copia = r.clone(); caches.open(ESTATICOS).then((c) => c.put(req, copia)) }
          return r
        }).catch(() => guardado)
        return guardado ?? rede
      }),
    )
  }
})
