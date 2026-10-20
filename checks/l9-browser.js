async page => {
  const mobile = () => Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => 'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Mobile' });
  await page.evaluate(mobile);
  await page.addInitScript(mobile);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.evaluate(async () => {
    const { replaceProject } = await import('./store.js');
    const count = 30, points = [{ id: 'bm1', code: 'BM1', type: 'BM', description: '', position: null }], photos = [], media = [], intermediate = [];
    for (let i = 1; i <= count; i++) {
      const code = `S${i}`;
      points.push({ id: code, code, type: 'S', description: `測點 ${i} 圍牆位置`, position: null });
      intermediate.push({ pointId: code, value: '0.500' });
      const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 600;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = `hsl(${i * 11} 35% 85%)`; ctx.fillRect(0, 0, 800, 600);
      ctx.fillStyle = '#17343b'; ctx.font = '48px sans-serif'; ctx.fillText(`V0.7 Photo ${i} / 30`, 65, 280);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.96));
      photos.push({ id: `photo-${i}`, pointId: code, mediaId: `media-${i}`, name: `photo-${i}.jpg`, description: `測點 ${i} 照片`, addedAt: '2026-10-20T00:00:00.000Z' });
      media.push({ id: `media-${i}`, blob });
    }
    await replaceProject({ schema: 1, appVersion: '0.7.0', id: 'v07-long', name: 'V0.7 30 張照片報告測試', number: 'V07-L9', date: '2026-10-20', observer: '測試觀測者', photographer: '測試攝影者', instrument: 'PENTAX AP-128', datum: '', points, photos,
      route: { startId: 'bm1', endId: 'bm1', startHeight: '10.000', startHeightKind: 'assumed', endHeight: '', toleranceMm: '', adjustMethod: 'stations' },
      setups: [{ bsPointId: 'bm1', bs: '1.000', fsPointId: 'bm1', fs: '1.000', intermediate }], updatedAt: '2026-10-20T00:00:00.000Z' }, media);
  });
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#caseName').value === 'V0.7 30 張照片報告測試' && document.querySelector('#saveState').textContent === '已儲存於此裝置');
  await page.evaluate(() => {
    window.__pdfCanvases = [];
    const original = html2pdf.Worker.prototype.toCanvas;
    html2pdf.Worker.prototype.toCanvas = function () {
      return original.call(this).then(function () {
        const c = this.prop.canvas;
        window.__pdfCanvases.push({ width: c.width, height: c.height, area: c.width * c.height });
      });
    };
  });
  await page.getByRole('button', { name: '④ 計算與成果' }).click();
  const started = Date.now();
  await page.getByRole('button', { name: '預覽整份報告' }).click();
  await page.waitForFunction(() => /PDF 已備妥|失敗|頁數較多/.test(document.querySelector('#pdfStatus').textContent), null, { timeout: 120000 });
  await page.waitForFunction(() => document.querySelector('#pdfStatus').textContent.includes('PDF 已備妥') &&
    window.__pdfCanvases.length === 33 && window.__pdfCanvases.every(c => c.width <= 16384 && c.height <= 16384 && c.area <= 16777216));
  const result = await page.evaluate(() => ({ status: document.querySelector('#pdfStatus').textContent, canvases: window.__pdfCanvases }));
  result.elapsedMs = Date.now() - started;
  if (result.status.includes('已備妥')) {
    const downloadEvent = page.waitForEvent('download');
    await page.getByRole('button', { name: '下載 PDF', exact: true }).click();
    await (await downloadEvent).saveAs('output/pdf/v07-long-report.pdf');
  }
  await page.screenshot({ path: 'output/playwright/v07-l9-preview.png' });
  return result;
}
