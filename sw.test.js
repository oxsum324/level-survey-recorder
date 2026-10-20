import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

function workerHarness(fetch) {
  const handlers = {}, values = new Map(), installed = [], timers = [];
  const cache = {
    addAll: async requests => installed.push(...requests),
    put: async (key, value) => values.set(String(key), await value.text()),
    match: async (request, options = {}) => {
      const url = new URL(request.url || request);
      if (options.ignoreSearch) url.search = '';
      return values.has(url.href) ? new Response(values.get(url.href)) : undefined;
    },
  };
  vm.runInNewContext(readFileSync(new URL('./sw.js', import.meta.url), 'utf8'), {
    URL, Request, Response, fetch,
    self: { registration: { scope: 'https://test.local/' }, location: { origin: 'https://test.local' },
      addEventListener: (name, handler) => handlers[name] = handler, skipWaiting() {} },
    caches: { open: async () => cache },
    setTimeout: (fn, ms) => { timers.push(ms); queueMicrotask(fn); return 1; }, clearTimeout() {},
  });
  return { values, installed, timers, handlers,
    request(url, mode) {
      const waits = []; let response;
      handlers.fetch({ request: { url, method: 'GET', mode }, waitUntil: value => waits.push(value), respondWith: value => response = value });
      return { response, waits };
    },
  };
}

test('L7 installation reloads all assets instead of trusting the HTTP cache', async () => {
  const h = workerHarness();
  let install;
  h.handlers.install({ waitUntil: promise => install = promise });
  await install;
  assert.ok(h.installed.length > 10);
  assert.ok(h.installed.every(request => request.cache === 'reload'));
});

test('L7 a timed-out navigation serves cached content and its late response still updates the cache', async () => {
  let finish;
  const h = workerHarness(() => new Promise(resolve => finish = resolve));
  h.values.set('https://test.local/', 'cached-page');
  const { response, waits } = h.request('https://test.local/?release=0.7.0', 'navigate');
  assert.equal(await (await response).text(), 'cached-page');
  assert.deepEqual(h.timers, [3000]);
  finish(new Response('updated-page'));
  await Promise.all(waits);
  assert.equal(h.values.get('https://test.local/'), 'updated-page');
});

test('L7 offline query navigation retains the index fallback and slow assets use cached versions', async () => {
  const offline = workerHarness(async () => { throw new Error('offline'); });
  offline.values.set('https://test.local/index.html', 'offline-index');
  assert.equal(await (await offline.request('https://test.local/?release=0.7.0', 'navigate').response).text(), 'offline-index');
  const slow = workerHarness(() => new Promise(() => {}));
  slow.values.set('https://test.local/app.js', 'cached-script');
  assert.equal(await (await slow.request('https://test.local/app.js', 'cors').response).text(), 'cached-script');
});
