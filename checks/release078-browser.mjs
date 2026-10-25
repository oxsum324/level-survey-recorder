import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE || '../../../.github/pages-smoke/node_modules/playwright/index.mjs')).href);
const root=process.cwd(),out=resolve('output/release-078');
const result={version:'0.7.8',mode:'real Chrome UI and IndexedDB; local file request fixtures; serviceWorkers blocked; synthetic data only',cases:[]};
await mkdir(out,{recursive:true});
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml'};
const browser=await chromium.launch({channel:'chrome',headless:true,downloadsPath:resolve(out,'downloads')});
const context=await browser.newContext({acceptDownloads:true,serviceWorkers:'block',viewport:{width:1280,height:900}});
await context.route('**/*',async route=>{const u=new URL(route.request().url());const p=resolve(root,'.'+decodeURIComponent(u.pathname==='/'?'/index.html':u.pathname));if(!p.startsWith(root+sep)){await route.abort();return;}try{await route.fulfill({status:200,contentType:types[extname(p)]||'application/octet-stream',body:await readFile(p)});}catch{await route.fulfill({status:404,body:''});}});
await context.addInitScript(() => {
  const blobs = new Map();
  const original = URL.createObjectURL.bind(URL);
  URL.createObjectURL = blob => { const url = original(blob); blobs.set(url, blob); return url; };
  document.addEventListener('click', event => { const link = event.target.closest?.('a[download]'); if (link) window.__lastDownloadBlob = blobs.get(link.href); }, true);
});
const page=await context.newPage();page.setDefaultTimeout(12000);page.on('dialog',dialog=>dialog.accept());
const db=()=>page.evaluate(async()=>{const m=await import('/store.js');return m.loadProject();});
const seed=async()=>{await page.goto('http://localhost:49177/index.html?release=0.7.8&demo=1');await page.waitForFunction(()=>document.querySelector('#saveState').textContent.includes('已載入'));await page.evaluate(async()=>{const sample=await(await fetch('/test-cases/demo-case.json')).json();const p=sample.project;const bm=p.points.find(x=>x.code==='BM1'),s=p.points.find(x=>x.code==='S1');p.name='PSTACK-SYNTHETIC';p.id='pstack-synthetic';p.points=[bm,s];p.mapMediaId=null;p.photos=[];p.equipmentPhotos=[];p.auditLog=[];p.routeHistory=[];Object.assign(p.route,{startId:bm.id,endId:bm.id,startHeight:'10.000',startHeightKind:'assumed',toleranceMm:'5',adjustMethod:'stations',formulaC:'10'});p.setups=[{bsPointId:bm.id,bs:'1.000',intermediate:[{pointId:s.id,value:'0.490'},{pointId:s.id,value:'0.501'}],fsPointId:bm.id,fs:'1.000',distance:'100'}];const m=await import('/store.js');await m.replaceProject(p,[]);});await page.reload();await page.waitForFunction(()=>document.querySelector('#saveState').textContent.includes('已載入'));};

async function saveProducedDownload(trigger, filename) {
  const pending = page.waitForEvent('download');
  await trigger();
  const download = await pending;
  try { await download.saveAs(filename); }
  catch (error) {
    result.nativeDownloadLimit ??= [];
    result.nativeDownloadLimit.push(await download.failure() || error.message);
    const dataUrl = await page.evaluate(() => new Promise((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error);
      if (!window.__lastDownloadBlob) { reject(Error('missing actual download blob')); return; }
      reader.readAsDataURL(window.__lastDownloadBlob);
    }));
    await writeFile(filename, Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'));
  }
}

page.on('pageerror',error=>{result.pageErrors??=[];result.pageErrors.push(error.message);});
try{
 await seed();
 await page.locator('[data-tab="measure"]').click();await page.locator('.station-records > summary').click();
 await page.locator('[data-is-value="0:0"]').fill('0.500');await page.locator('[data-is-value="0:0"]').press('Tab');await page.waitForSelector('#editReasonDialog[open]');await page.locator('#saveEditReason').click();await page.waitForFunction(()=>document.querySelector('#saveState').textContent.includes('已儲存'));
 await page.locator('[data-tab="result"]').click();assert.equal(((await page.locator('#resultTable').innerText()).match(/※已更正/g)||[]).length,1);
 const stored=await db(),s=stored.points.find(x=>x.code==='S1');assert.ok(stored.auditLog[0].observationId);
 await page.locator('[data-tab="route"]').click();await page.locator(`[data-point-code="${s.id}"]`).fill('S101');await page.locator(`[data-point-code="${s.id}"]`).press('Tab');await page.locator('[data-tab="result"]').click();assert.equal(((await page.locator('#resultTable').innerText()).match(/※已更正/g)||[]).length,1);
 result.cases.push({id:'LS04',singleEditedMarker:true,renamedMarkerRetained:true,stableObservationId:true});await page.screenshot({path:resolve(out,'corrected-observation.png'),fullPage:true});
 await page.locator('#printSummary').click();await page.waitForFunction(()=>document.querySelector('#pdfStatus').textContent.includes('PDF 已備妥'),{},{timeout:60000});assert.equal(((await page.locator('#printPanel').innerText()).match(/※已更正/g)||[]).length,1);
 await saveProducedDownload(()=>page.locator('#downloadPdf').click(),resolve(out,'corrected-summary.pdf'));await page.locator('#closePreview').click();
 await seed();await page.evaluate(async()=>{const m=await import('/store.js');const p=await m.loadProject();Object.assign(p.setups[0],{distance:'25',bs:'1.500',fs:'1.500',bsUpper:'1.600',bsLower:'1.400',fsUpper:'1.700',fsLower:'1.300'});await m.saveProject(p);});await page.reload();await page.waitForFunction(()=>document.querySelector('#saveState').textContent.includes('已載入'));
 await page.locator('[data-tab="measure"]').click();await page.locator('.station-records > summary').click();await page.locator('[data-copy-wire-distance="0"]').click();await page.waitForSelector('#editReasonDialog[open]');await page.locator('#cancelEditReason').click();assert.equal((await db()).setups[0].distance,'25');
 await page.locator('[data-copy-wire-distance="0"]').click();await page.waitForSelector('#editReasonDialog[open]');await page.locator('#saveEditReason').click();await page.waitForFunction(async()=> (await(await import('/store.js')).loadProject())?.setups?.[0]?.distance==='60.000');const copied=await db();assert.equal(copied.auditLog.length,1);assert.equal(copied.auditLog[0].from,'25');assert.ok(copied.auditLog[0].reason);result.cases.push({id:'LS03',cancelPreserved:true,acceptedDistance:'60.000',auditEntries:1});
 await seed();
 await page.evaluate(async()=>{const request=indexedDB.open('level-survey-v1',1);const database=await new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});window.__releaseMedia=false;window.__uploadQueued=false;window.__replacementQueued=false;const tx=database.transaction(['media'],'readwrite');const store=tx.objectStore('media');const keep=()=>{if(!window.__releaseMedia){const r=store.get('__pstack_lock__');r.onsuccess=keep;}};keep();tx.oncomplete=()=>database.close();const original=IDBDatabase.prototype.transaction;window.__restoreTransaction=()=>{IDBDatabase.prototype.transaction=original;};IDBDatabase.prototype.transaction=function(names,...args){const list=typeof names==='string'?[names]:Array.from(names);if(list.length===1&&list[0]==='media'&&args[0]==='readwrite')window.__uploadQueued=true;if(list.includes('project')&&list.includes('media'))window.__replacementQueued=true;return original.call(this,names,...args);};});
 await page.locator('[data-tab="photos"]').click();await page.locator('#equipmentFile').setInputFiles({name:'OLD-CASE-SYNTHETIC.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0JkAAAAASUVORK5CYII=','base64')});await page.waitForFunction(()=>window.__uploadQueued);
 await page.locator('[data-tab="route"]').click();await page.locator('#newCase').click();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));assert.equal(await page.locator('#replaceDialog').evaluate(el=>el.open),false);assert.equal(await page.evaluate(()=>window.__replacementQueued),false);
 await page.evaluate(()=>{window.__releaseMedia=true;window.__restoreTransaction();});await page.waitForSelector('#replaceDialog[open]');const beforeSwitch=await db();assert.equal(beforeSwitch.equipmentPhotos.length,1);const mediaId=beforeSwitch.equipmentPhotos[0].mediaId;assert.ok(await page.evaluate(async id=>!!await(await import('/store.js')).loadMedia(id),mediaId));
 const backupFile=resolve(out,'before-case-switch.json');await saveProducedDownload(()=>page.locator('#backupBeforeReplace').click(),backupFile);await page.waitForFunction(()=>document.querySelector('#message').textContent.includes('已建立新案件'));const clean=await db();assert.notEqual(clean.id,'pstack-synthetic');assert.equal(clean.equipmentPhotos.length,0);const backup=JSON.parse(await readFile(backupFile,'utf8'));assert.equal(backup.project.equipmentPhotos.length,1);assert.ok(backup.media.some(item=>item.id===mediaId));result.cases.push({id:'LS02',waitedForMedia:true,pendingPhotoIncludedInBackup:true,newCaseEquipmentPhotos:0});
 const beforeImport=await db();await page.locator('#importBackup').setInputFiles({name:'malformed.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({format:'level-survey-case.v1',project:{schema:1,points:[null],setups:[],photos:[],route:{}},media:[]}))});await page.waitForFunction(()=>document.querySelector('#message').textContent.includes('開啟失敗'));assert.deepEqual(await db(),beforeImport);assert.equal(await page.locator('#replaceDialog').evaluate(el=>el.open),false);await page.reload();await page.waitForFunction(()=>document.querySelector('#saveState').textContent.includes('已載入'));result.cases.push({id:'LS01',badImportPreservedDatabase:true,reloadWorks:true});
 await page.locator('#importBackup').setInputFiles(backupFile);await page.waitForFunction(()=>document.querySelector('#message').textContent.includes('案件檔已開啟'));const restored=await db();assert.equal(restored.equipmentPhotos[0].name,'OLD-CASE-SYNTHETIC.png');assert.ok(await page.evaluate(async id=>!!await(await import('/store.js')).loadMedia(id),restored.equipmentPhotos[0].mediaId));result.cases.push({id:'BACKUP',photoRoundTrip:true});
 await page.locator('#loadTestCase').click();await page.waitForSelector('#replaceDialog[open]');await page.locator('[data-replace="replace"]').click();await page.waitForFunction(()=>!document.querySelector('#resultPanel').hidden&&document.querySelector('#caseName').value.startsWith('【測試】'));
 await page.setViewportSize({width:375,height:812});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:resolve(out,'mobile-demo.png'),fullPage:true});await page.setViewportSize({width:1280,height:900});
 await page.locator('#printReport').click();await page.waitForFunction(()=>document.querySelector('#pdfStatus').textContent.includes('PDF 已備妥'),{},{timeout:60000});await saveProducedDownload(()=>page.locator('#downloadPdf').click(),resolve(out,'complete-demo-report.pdf'));await page.screenshot({path:resolve(out,'report-preview.png'),fullPage:true});
 assert.equal((await readFile(resolve(out,'complete-demo-report.pdf'))).subarray(0,5).toString(),'%PDF-');assert.deepEqual(result.pageErrors||[],[]);result.cases.push({id:'OUTPUT',fullPhotoReportPdf:true,mobileOverflow:false});result.passed=true;
}catch(e){result.passed=false;result.failure=e.stack;process.exitCode=1;}
finally{await writeFile(resolve(out,'browser-validation.json'),JSON.stringify(result,null,2));await browser.close();console.log(JSON.stringify(result,null,2));}
