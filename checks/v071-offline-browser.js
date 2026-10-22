async page => {
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await page.context().setOffline(true);
  const offlinePage=await page.context().newPage();
  try {
    await offlinePage.setViewportSize({width:375,height:812});
    await offlinePage.goto('http://127.0.0.1:4191/?release=0.7.1&check=offline');
    await offlinePage.waitForFunction(() => document.querySelector('h1')?.textContent.includes('0.7.1') && document.querySelector('#saveState').textContent.includes('已載入') && !navigator.onLine);
    await offlinePage.locator('[data-tab="measure"]').click();
    await offlinePage.waitForFunction(() => document.querySelector('[data-field=bs]')?.value==='1.500' && document.querySelector('[data-is-value="0:0"]')?.value==='0.500');
    await offlinePage.screenshot({path:'output/playwright/v071-offline.png'});
    return {offlineQueryOpen:true,version:'0.7.1',backsight:'1.500',intermediate:'0.500'};
  } finally {await offlinePage.close(); await page.context().setOffline(false);}
}
