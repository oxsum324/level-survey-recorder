async page => {
  await page.waitForFunction(() => document.querySelector('#saveState').textContent.includes('已儲存') || document.querySelector('#saveState').textContent.includes('已載入'));
  await page.locator('[data-tab="measure"]').click();
  const bs=page.locator('[data-field="bs"]');
  await bs.fill('1.5001.500'); await bs.press('Tab');
  await page.waitForFunction(() => !document.querySelector('#editReasonDialog').open && !document.querySelector('.bs-entry .reading-warning').hidden && document.querySelector('[data-field="bs"]').value==='1.5001.500');
  const stored=await page.evaluate(async () => {const {loadProject}=await import('./store.js'); const p=await loadProject(); return {bs:p.setups[0].bs,audit:p.auditLog.length};});
  await page.waitForFunction(async () => { const {loadProject}=await import('./store.js'); const p=await loadProject(); return p.setups[0].bs==='1.500' && p.auditLog.length===0; });
  await page.screenshot({path:'output/playwright/v071-format-warning.png'});
  await bs.fill('1.417'); await bs.press('Tab');
  await page.waitForFunction(() => document.querySelector('#editReasonDialog').open && document.activeElement.id==='editReasonChoice' && document.querySelector('#editReasonContext').textContent==='第 1 站 BM1 點 ‧ 後視：1.500 m → 1.417 m');
  await page.screenshot({path:'output/playwright/v071-correction.png'});
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#editReasonDialog').open && document.querySelector('[data-field="bs"]').value==='1.500');
  return {malformedInputPreserved:true,stored,previewAndFocus:true,escapeRestores:true};
}
