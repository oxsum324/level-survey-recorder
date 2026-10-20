async page => {
  const mobile = () => Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => 'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Mobile' });
  await page.evaluate(mobile);
  await page.addInitScript(mobile);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('http://127.0.0.1:4192/');
  await page.waitForFunction(() => document.querySelector('#saveState').textContent.includes('已載入'));
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  const context = page.context();
  let delayed = 0;
  await context.route('**/*', async route => {
    if (!route.request().url().includes('check=slow')) return route.continue();
    delayed++;
    await new Promise(resolve => setTimeout(resolve, 10000));
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()) + '<!-- late-refresh -->' });
  });
  const started = Date.now();
  await page.goto('http://127.0.0.1:4192/?release=0.7.0&check=slow', { waitUntil: 'domcontentloaded', timeout: 4000 });
  await page.waitForFunction(() => document.querySelector('#saveState').textContent.includes('已載入'), { timeout: 4000 });
  const elapsedMs = Date.now() - started;
  await page.getByRole('button', { name: '② 觀測讀數' }).click();
  await page.waitForSelector('#addStation', { state: 'visible' });
  await page.screenshot({ path: 'output/playwright/v07-l7-slow.png' });
  await page.waitForFunction(async () => {
    const cache = await caches.open('level-survey-v0.7.0');
    const response = await cache.match(location.origin + '/');
    return response && (await response.text()).includes('late-refresh');
  }, null, { timeout: 15000 });
  await context.unroute('**/*');
  await context.setOffline(true);
  const offlineStarted = Date.now();
  await page.goto('http://127.0.0.1:4192/?release=0.7.0', { waitUntil: 'domcontentloaded', timeout: 4000 });
  await page.waitForFunction(() => !navigator.onLine && document.querySelector('#saveState').textContent.includes('已載入'));
  const offlineMs = Date.now() - offlineStarted;
  await page.screenshot({ path: 'output/playwright/v07-l7-offline.png' });
  await context.setOffline(false);
  return { delayedRequests: delayed, elapsedMs, offlineMs, lateCacheUpdated: true, screenshots: ['v07-l7-slow.png', 'v07-l7-offline.png'] };
}
