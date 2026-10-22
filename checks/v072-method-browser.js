async page => {
  await page.setViewportSize({width:900,height:1000});
  await page.locator('[data-tab="result"]').click();
  await page.locator('#printSummary').click();
  const note='中間視改正後高程＝改正後儀器視線高 − 中間視讀數；改正後儀器視線高採該測站後視點的改正後高程加後視讀數，不在站內按距離分配。';
  await page.waitForFunction(note=>document.querySelector('#previewSheet .print-note')?.textContent.includes(note),note);
  await page.waitForFunction(()=>document.querySelector('#pdfStatus').textContent.includes('PDF 已備妥'));
  await page.locator('#previewSheet .print-note').screenshot({path:'docs/versions/assets/v0.7.2-method-note.png'});
  const result=await page.evaluate(()=>({text:document.querySelector('#previewSheet .print-note').textContent,status:document.querySelector('#pdfStatus').textContent}));
  await page.locator('#closePreview').click();
  return result;
}
