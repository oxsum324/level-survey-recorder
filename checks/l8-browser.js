async page => {
  const mobile = () => Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => 'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Mobile' });
  await page.evaluate(mobile); await page.addInitScript(mobile);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.getByLabel('案件名稱', { exact: true }).fill('V0.7 大量照片匯出測試');
  await page.waitForFunction(() => document.querySelector('#saveState').textContent === '已儲存於此裝置');
  await page.evaluate(async () => {
    const { loadProject, replaceProject } = await import('./store.js');
    const project = await loadProject(); project.number = 'V07-L8'; project.photos = [];
    const canvas = document.createElement('canvas'); canvas.width = 80; canvas.height = 60;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#bdded0'; ctx.fillRect(0, 0, 80, 60);
    const jpeg = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.96));
    const padding = new Uint8Array(5 * 1024 * 1024 - jpeg.size), media = [];
    for (let i = 1; i <= 40; i++) {
      project.photos.push({ id: `photo-${i}`, mediaId: `media-${i}`, pointId: project.route.startId, name: `synthetic-${i}.jpg`, description: '5 MiB 測試照片', addedAt: '2026-10-20T00:00:00.000Z' });
      media.push({ id: `media-${i}`, blob: new Blob([jpeg, padding], { type: 'image/jpeg' }) });
    }
    await replaceProject(project, media);
  });
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#caseNo').value === 'V07-L8' && document.querySelector('#saveState').textContent === '已載入本機案件');
  const event = page.waitForEvent('download', { timeout: 120000 });
  const start = Date.now();
  await page.locator('#exportBackup').click();
  await page.waitForFunction(() => document.querySelector('#backupSizeNotice').textContent.includes('手機匯出可能較久或失敗'));
  const download = await event;
  await download.saveAs('output/json/v07-large-case.json');
  await page.waitForFunction(() => /^已匯出 \d{2}:\d{2}$/.test(document.querySelector('#exportState').textContent));
  const elapsedMs = Date.now() - start;
  await page.waitForFunction(() => document.querySelector('#message').hidden);
  await page.locator('#backupSizeNotice').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'output/playwright/v07-l8-size-notice.png' });
  return { photos: 40, photoBytes: 5242880, elapsedMs,
    notice: await page.locator('#backupSizeNotice').textContent(), saved: 'output/json/v07-large-case.json' };
}
