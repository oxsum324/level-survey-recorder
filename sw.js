const CACHE = 'level-survey-v0.7.5';
const APP_FILES = ['./', './index.html', './app.js', './calc.js', './store.js', './audit.js', './integrity.js', './exif.js', './observation.js', './pdf-pages.js', './style.css', './vendor/html2pdf.bundle.min.js', './icon.svg', './icon-180.png', './icon-192.png', './icon-512.png', './manifest.webmanifest', './equipment/pentax-ap-128.jpg'];
self.addEventListener('install', event => {
  const requests = APP_FILES.map(file => new Request(new URL(file, self.registration.scope), { cache: 'reload' }));
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(requests)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('level-survey-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  url.search = '';
  const navigation = event.request.mode === 'navigate';
  if (!navigation && !APP_FILES.some(file => new URL(file, self.registration.scope).href === url.href)) return;
  const network = fetch(event.request).then(async response => {
    if (response.ok) {
      try {
        const cache = await caches.open(CACHE);
        await cache.put(url.href, response.clone());
      } catch (_) { /* A cache write failure must not discard a network response. */ }
    }
    return response;
  });
  // Keep the late response alive after returning the cached page.
  event.waitUntil(network.then(() => {}, () => {}));
  event.respondWith((async () => {
    let timer;
    try {
      const response = await Promise.race([network, new Promise(resolve => { timer = setTimeout(() => resolve(null), 3000); })]);
      if (response) return response;
    } catch (_) { /* The cache also serves immediate network failures. */ }
    finally { clearTimeout(timer); }
    const cache = await caches.open(CACHE);
    const cached = await cache.match(event.request, { ignoreSearch: navigation })
      || await cache.match(url.href)
      || (navigation && (await cache.match(new URL('./index.html', self.registration.scope).href)
        || await cache.match(self.registration.scope)));
    return cached || network;
  })());
});
