async page => {
  const diagnostics = []; page.on('pageerror', error => diagnostics.push(error.message));
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForFunction(() => /已載入|已儲存/.test(document.querySelector('#saveState').textContent));
  await page.evaluate(async () => {
    const { replaceProject } = await import('./store.js');
    const p = (await (await fetch('./checks/fixtures/v070-case.json')).json()).backup.project;
    Object.assign(p, { id: 'v072-report', name: 'V0.7.2 報告分頁驗證', number: 'V072-R1', date: '2026-10-22' });
    p.points = ['BM1', ...Array.from({length:7},(_,i)=>`S${i+1}`), 'TP1'].map(code => ({id:code,code,type:code==='BM1'?'BM':code==='TP1'?'TP':'S',description:`${code} 現場位置`,position:null}));
    Object.assign(p.route, {startId:'BM1',endId:'BM1',startHeight:'86.653',startHeightKind:'known',toleranceMm:'5',toleranceBasis:'測試指定值'});
    p.setups = [
      {bsPointId:'BM1',bs:'0.595',fsPointId:'S4',fs:'1.417',intermediate:[['S1','0.848'],['S2','1.187'],['S3','1.258']].map(([pointId,value])=>({pointId,value}))},
      {bsPointId:'S4',bs:'0.640',fsPointId:'TP1',fs:'0.525',intermediate:[['S5','0.810'],['S6','1.088'],['S7','1.244']].map(([pointId,value])=>({pointId,value}))},
      {bsPointId:'TP1',bs:'1.590',fsPointId:'BM1',fs:'0.883',intermediate:[]}
    ];
    window.__readmeCase = structuredClone(p);
    p.points=p.points.filter(point=>['BM1','S1'].includes(point.id));
    p.setups=[{bsPointId:'BM1',bs:'1.500',fsPointId:'BM1',fs:'1.500',intermediate:[{pointId:'S1',value:'0.500'}]}];
    await replaceProject(p, []);
  });
  const readmeCase = await page.evaluate(() => window.__readmeCase);
  { const old = page; page = await page.context().newPage(); await page.setViewportSize({width:375,height:812}); await page.goto(old.url()); await old.close(); }
  await page.waitForFunction(() => document.querySelector('#caseNo').value==='V072-R1' && /已載入|已儲存/.test(document.querySelector('#saveState').textContent));
  const instrument = async () => page.evaluate(async () => {
    const { pageCanvasPlan, reportBreakPoints } = await import('./pdf-pages.js');
    window.__plans=[]; window.__canvases=[];
    const Worker=html2pdf.Worker.prototype;
    if (!Worker.__v072OriginalContainer) {
      Worker.__v072OriginalContainer=Worker.toContainer;
      Worker.toContainer=function() {return Worker.__v072OriginalContainer.call(this).then(function() {
        if(this.prop.container.firstElementChild?.id==='printPanel') {
          const c=this.prop.container, height=this.prop.pageSize.inner.px.height;
          const blocks=reportBreakPoints(c);
          window.__plans.push({...pageCanvasPlan(c.getBoundingClientRect().width,c.scrollHeight,height,2,blocks),blocks,pageHeight:height,height:c.scrollHeight});
        }
      });};
      Worker.__v072OriginalCanvas=Worker.toCanvas;
      Worker.toCanvas=function() {return Worker.__v072OriginalCanvas.call(this).then(function() {
        const c=this.prop.canvas; window.__canvases.push({width:c.width,height:c.height,area:c.width*c.height});
      });};
    }
  });
  const results={ diagnostics };
  const exportReport = async name => {
    await instrument();
    await page.locator('[data-tab="result"]').click();
    await page.locator('#printReport').click();
    await page.waitForFunction(() => /PDF 已備妥|失敗/.test(document.querySelector('#pdfStatus').textContent), null, {timeout:180000});
    await page.waitForFunction(() => document.querySelector('#pdfStatus').textContent.includes('PDF 已備妥') && window.__plans.length===1 && window.__canvases.length===window.__plans[0].pages, null, {timeout:30000});
    const data=await page.evaluate(()=>({plan:window.__plans[0],canvases:window.__canvases,status:document.querySelector('#pdfStatus').textContent,photos:document.querySelectorAll('#previewSheet .print-photo').length}));
    if(data.plan.slices.some(slice=>slice.hardCuts.length)) throw new Error('DOM 區塊仍跨頁：'+JSON.stringify(data.plan.slices.filter(slice=>slice.hardCuts.length)));
    if(data.canvases.some(c=>c.width>16384||c.height>16384||c.area>16777216)) throw new Error('畫布超限');
    const download=page.waitForEvent('download'); await page.locator('#downloadPdf').click();
    await (await download).saveAs(`output/pdf/v0.7.2-${name}.pdf`);
    await page.screenshot({path:`docs/versions/assets/v0.7.2-${name}-preview.png`});
    await page.locator('#closePreview').click();
    return data;
  };
  results.general=await exportReport('general');
  await page.evaluate(async readmeCase => {
    const {loadProject,replaceProject}=await import('./store.js');
    const p=readmeCase,media=[]; p.name='V0.7.2 README 算例與 30 張照片';p.number='V072-R1-L9';p.photos=[];
    for(let i=1;i<=30;i++) {
      const code=`S${i}`;
      if(i>7) {p.points.push({id:code,code,type:'S',description:`測點 ${i} 圍牆位置`,position:null});p.setups[0].intermediate.push({pointId:code,value:'0.500'});}
      const canvas=document.createElement('canvas');canvas.width=800;canvas.height=600;
      const ctx=canvas.getContext('2d');ctx.fillStyle=`hsl(${i*11} 35% 85%)`;ctx.fillRect(0,0,800,600);
      ctx.fillStyle='#17343b';ctx.font='48px sans-serif';ctx.fillText(`V0.7.2 Photo ${i} / 30`,65,280);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.96));
      p.photos.push({id:`photo-${i}`,pointId:code,mediaId:`media-${i}`,name:`photo-${i}.jpg`,description:`測點 ${i} 照片`,addedAt:'2026-10-22T00:00:00.000Z'});
      media.push({id:`media-${i}`,blob});
    }
    await replaceProject(p,media);
  }, readmeCase);
  { const old = page; page = await page.context().newPage(); await page.setViewportSize({width:375,height:812}); await page.goto(old.url()); await old.close(); }
  await page.waitForFunction(()=>document.querySelector('#caseNo').value==='V072-R1-L9' && /已載入|已儲存/.test(document.querySelector('#saveState').textContent));
  results.long=await exportReport('long');
  return results;
}
