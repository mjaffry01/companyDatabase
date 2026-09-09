const CACHE_NAME = 'company-contact-book-v6-user-profile';
const APP_SHELL = ['./', './index.html', './manifest.json', './opportunities.js', './opportunities.css', './profile.js'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key.startsWith('company-contact-book-') && key !== CACHE_NAME).map(key => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if(event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if(url.origin !== self.location.origin) return;
  if(url.search || !APP_SHELL.some(path => new URL(path,self.registration.scope).href === url.href)) return;
  event.respondWith(
    fetch(event.request).then(response => {
      const copy = response.clone();
      if(response.ok) caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
      return response;
    }).catch(() => caches.match(event.request))
  );
});
