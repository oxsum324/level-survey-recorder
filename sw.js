const CACHE = 'level-survey-v0.6.3';
const APP_FILES = ['./', './index.html', './app.js', './calc.js', './store.js', './audit.js', './integrity.js', './exif.js', './observation.js', './style.css', './vendor/html2pdf.bundle.min.js', './icon.svg', './icon-180.png', './icon-192.png', './icon-512.png', './manifest.webmanifest', './equipment/pentax-ap-128.jpg'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(APP_FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('level-survey-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok && APP_FILES.some(file => new URL(file, self.registration.scope).href === event.request.url)) {
      const copy = response.clone(); caches.open(CACHE).then(cache => cache.put(event.request, copy));
    }
    return response;
  }).catch(async () => {
    if (event.request.mode === 'navigate') {
      return await caches.match(event.request, { ignoreSearch: true })
        || await caches.match('./index.html')
        || await caches.match('./');
    }
    return caches.match(event.request);
  }));
});
