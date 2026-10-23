async page => {
  await page.setViewportSize({width:375,height:812});
  await page.waitForFunction(()=>document.querySelector('h1').textContent.includes('V0.7.4') && !document.querySelector('#loadTestCase').disabled);
  await page.waitForFunction(()=>document.querySelector('#routePanel').lastElementChild.id==='testTools' && document.querySelectorAll('#loadTestCase').length===1 && document.querySelector('#caseName').getBoundingClientRect().top < document.querySelector('#testTools').getBoundingClientRect().top && document.querySelector('#loadTestCase').getBoundingClientRect().top>innerHeight && document.documentElement.scrollWidth<=innerWidth);
  await page.screenshot({path:'output/playwright/v074-footer-first-screen.png'});
  await page.locator('#caseName').fill('原案件：取消後應保留');
  await page.locator('#testTools').scrollIntoViewIfNeeded();
  await page.screenshot({path:'output/playwright/v074-footer-tools.png'});
  await page.locator('#loadTestCase').click();
  await page.waitForFunction(()=>document.querySelector('#replaceDialog').open);
  await page.screenshot({path:'output/playwright/v074-footer-backup-prompt.png'});
  await page.locator('[data-replace="cancel"]').click();await page.waitForFunction(()=>!document.querySelector('#loadTestCase').disabled && document.querySelector('#caseName').value==='原案件：取消後應保留');
  await page.locator('#loadTestCase').click();await page.waitForFunction(()=>document.querySelector('#replaceDialog').open);
  await page.locator('[data-replace="replace"]').click();
  await page.waitForFunction(()=>!document.querySelector('#resultPanel').hidden && document.querySelector('#caseNo').value==='V072-PDF-30' && !document.querySelector('#loadTestCase').disabled);
  const contents=await page.evaluate(async()=>{const{loadProject,loadMedia}=await import('./store.js');const p=await loadProject();return{points:p.points.length,photos:p.photos.length,media:await Promise.all([p.mapMediaId,...p.photos.map(x=>x.mediaId)].map(async id=>(await loadMedia(id))?.size)),overflow:document.documentElement.scrollWidth>innerWidth};});
  if(contents.points!==33||contents.photos!==30||contents.media.some(n=>!n)||contents.overflow)throw Error('線上資料或版面不符');
  await page.screenshot({path:'output/playwright/v074-footer-results.png'});
  await page.locator('#printSummary').click();await page.waitForFunction(()=>document.querySelector('#pdfStatus').textContent.includes('PDF 已備妥'),null,{timeout:90000});
  const download=page.waitForEvent('download');await page.locator('#downloadPdf').click();await(await download).saveAs('output/playwright/v074-footer-summary.pdf');
  await page.locator('#closePreview').click();
  return{footerPlacement:true,firstScreenClear:true,version:'0.7.4',backupPrompt:true,cancelKeptOriginal:true,sampleLoaded:true,directResult:true,summaryDownload:true,...contents,physicalPhoneTested:false};
}
