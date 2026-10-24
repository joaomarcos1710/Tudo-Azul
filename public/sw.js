/* Tudo Azul — service worker.
 * Regra de ouro: guarda SÓ o app (HTML, JS, CSS, ícones, fontes). Nunca guarda dados financeiros:
 * tudo que vem do Supabase (outro domínio) passa direto pela rede, para nunca mostrar saldo velho.
 * - Navegação (HTML): rede primeiro; sem internet, usa a última versão guardada do app.
 * - /assets/* (arquivos com hash no nome, imutáveis): cache primeiro.
 * - Ícones e fontes: cache primeiro, atualiza em segundo plano.
 */
const VERSAO = 'tudo-azul-v1'
const APP = `${VERSAO}-app`
const ESTATICOS = `${VERSAO}-estaticos`

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(APP).then((c) => c.addAll(['/', '/manifest.webmanifest', '/favicon.svg', '/icons/icon-192.png'])))
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
    e.respondWith(
      fetch(req)
        .then((r) => {
          const copia = r.clone()
          caches.open(APP).then((c) => c.put('/', copia))
          return r
        })
        .catch(() => caches.match('/').then((r) => r ?? Response.error())),
    )
    return
  }

  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(
      caches.match(req).then((guardado) => guardado ?? fetch(req).then((r) => {
        if (r.ok) { const copia = r.clone(); caches.open(ESTATICOS).then((c) => c.put(req, copia)) }
        return r
      })),
    )
    return
  }

  if (fonte || url.pathname.startsWith('/icons/') || url.pathname === '/favicon.svg' || url.pathname === '/manifest.webmanifest') {
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
