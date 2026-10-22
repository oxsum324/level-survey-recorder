async page => {
  await page.setViewportSize({width:375,height:812});
  const captured=[];
  const capture=()=>{
    const status=document.querySelector('#saveState'), header=document.querySelector('.topbar');
    const box=status.getBoundingClientRect(), range=document.createRange(); range.selectNodeContents(status); const textBox=range.getBoundingClientRect();
    return {text:status.textContent,html:header.outerHTML,topbarHeight:header.getBoundingClientRect().height,viewportWidth:innerWidth,box:{left:box.left,right:box.right,top:box.top,bottom:box.bottom},textBox:{left:textBox.left,right:textBox.right,top:textBox.top,bottom:textBox.bottom},overflow:document.documentElement.scrollWidth>innerWidth};
  };
  const fits=()=>{
    const status=document.querySelector('#saveState'), range=document.createRange();range.selectNodeContents(status);
    const b=document.querySelector('.topbar').getBoundingClientRect(),t=range.getBoundingClientRect();
    return t.left>=b.left && t.right<=b.right && t.top>=b.top && t.bottom<=b.bottom && t.right<=innerWidth && document.querySelector('.topbar').getBoundingClientRect().height<=72;
  };
  await page.waitForFunction(() => document.querySelector('#saveState')?.textContent==='已載入本機案件');
  await page.waitForFunction(fits); captured.push(await page.evaluate(capture));
  await page.locator('#caseName').fill('V0.7.1 補修驗證');
  await page.waitForFunction(() => document.querySelector('#saveState').textContent==='儲存中');
  await page.waitForFunction(fits); captured.push(await page.evaluate(capture));
  await page.waitForFunction(() => document.querySelector('#saveState').textContent==='已儲存於此裝置');
  await page.waitForFunction(fits); captured.push(await page.evaluate(capture));
  await page.locator('[data-tab="measure"]').click();
  await page.locator('#addStation').click();
  const bs=page.locator('[data-field="bs"]');
  await bs.fill(' 1.500 '); await bs.press('Tab');
  await page.waitForFunction(() => document.querySelector('[data-field=bs]').value==='1.500' && !document.querySelector('#editReasonDialog').open);
  await bs.fill('1.500 '); await bs.press('Tab');
  await page.waitForFunction(() => document.querySelector('[data-field=bs]').value==='1.500' && !document.querySelector('#editReasonDialog').open);
  await page.waitForFunction(async () => {const {loadProject}=await import('./store.js'); const p=await loadProject(); return p.setups[0].bs==='1.500' && p.auditLog.length===0;});
  await bs.fill(' 1.417 '); await bs.press('Tab');
  await page.waitForFunction(() => document.querySelector('#editReasonDialog').open && document.querySelector('#editReasonContext').textContent.includes('1.500 m → 1.417 m'));
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#editReasonDialog').open && document.querySelector('[data-field=bs]').value==='1.500');
  await bs.fill('1.5001.500'); await bs.press('Tab');
  await page.waitForFunction(() => !document.querySelector('#editReasonDialog').open && document.querySelector('[data-field=bs]').getAttribute('aria-invalid')==='true');
  await bs.fill('1.500'); await bs.press('Tab');
  await page.waitForFunction(async () => {const {loadProject}=await import('./store.js'); const p=await loadProject();return p.setups[0].bs==='1.500' && p.auditLog.length===0;});
  const proof=await page.context().newPage();
  try {
    await proof.setViewportSize({width:375,height:812});
    await proof.setContent('<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="http://127.0.0.1:4192/style.css"></head><body><h2 style="font-size:16px;margin:8px 10px">375 px：三種儲存狀態實測</h2>'+captured.map((s,i)=>'<section style="margin:8px 0"><p style="font-size:14px;margin:4px 10px">'+(i+1)+'．'+s.text+'</p>'+s.html+'</section>').join('')+'</body></html>');
    await proof.waitForFunction(() => innerWidth===375 && getComputedStyle(document.querySelector('.topbar')).display==='grid' && Array.from(document.querySelectorAll('.topbar')).every(e=>e.getBoundingClientRect().height<=72));
    await proof.waitForFunction(() => Array.from(document.querySelectorAll('#saveState')).every(e=>{const r=document.createRange();r.selectNodeContents(e);const t=r.getBoundingClientRect(),b=e.closest('.topbar').getBoundingClientRect();return t.left>=b.left&&t.right<=b.right&&t.top>=b.top&&t.bottom<=b.bottom&&t.right<=375;}));
    await proof.screenshot({path:'output/playwright/v071-fix-save-states.png'});
  } catch(error) { const details=await proof.evaluate(() => ({viewport:innerWidth,client:document.documentElement.clientWidth,headers:Array.from(document.querySelectorAll('.topbar')).map(e=>({width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height,display:getComputedStyle(e).display}))})); throw new Error(error.message+' '+JSON.stringify(details)); } finally {await proof.close();}
  return {whitespaceOnlyNoCorrection:true,genuineEditStillRequiresReason:true,malformedStillBlocked:true,audit:0,states:captured.map(({html,...state})=>state),proof:'Three actual UI header snapshots displayed together at 375px; states are sequential, not simultaneous.'};
}
