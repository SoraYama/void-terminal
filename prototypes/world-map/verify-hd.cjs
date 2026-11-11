// Real CDN checks for resolution/coordinates; controlled failure verifies fallback.
const {chromium,devices}=require(process.cwd()+'/node_modules/playwright');
const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const {writeFileSync}=require('node:fs');
const path=require('node:path');
const file=path.resolve(process.argv[2]),output=path.dirname(file);
(async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  const p=await browser.newPage({viewport:{width:1440,height:950},deviceScaleFactor:2});
  const errors=[],responses=[];
  p.on('pageerror',e=>errors.push(e.message));
  p.on('response',r=>{if(r.url().includes('/15/tile-'))responses.push({url:r.url(),status:r.status()});});
  await p.goto(pathToFileURL(file).href);
  assert.equal(await p.locator('#hd,.quality').count(),0);
  assert.equal(await p.evaluate(()=>state.hd),true);
  await p.locator('[data-region="fontaine"]').click();
  await p.locator('[data-filter="material"]').click();
  await p.locator('#search').fill('56744');
  await p.locator('[data-point="56744"]').click();
  for(let i=0;i<3;i++)await p.locator('#plus').click();
  await p.waitForFunction(()=>{
   const d=document.querySelector('#map').dataset;
   return d.tileLevel==='15' && Number(d.hdReady)>0 && d.hdReady===d.hdWanted;
  },null,{timeout:45000});
  assert.ok(responses.some(r=>r.url.endsWith('/15/tile-14_29.jpg') && r.status===200));
  const online=await p.locator('#map').evaluate(c=>({...c.dataset,pixelWidth:c.width,cssWidth:c.clientWidth}));
  assert.equal(online.pixelWidth,online.cssWidth*2);
  await p.screenshot({path:path.join(output,'atlas72-hd-fontaine.png')});
  // DPR selects the next source level at identical CSS zoom, independent of max zoom.
  const levels=await p.evaluate(()=>{
   state.scale=256*2**13/360;state.dpr=1;draw();const one=canvas.dataset.tileLevel;
   state.dpr=2;draw();return {one,two:canvas.dataset.tileLevel};
  });
  assert.deepEqual(levels,{one:'13',two:'14'});
  // CDN failures cannot remove embedded map or prevent search/pan.
  await p.route('https://game-cdn.appsample.com/**',r=>r.abort());
  await p.evaluate(()=>{setScene('teyvat');state.cx=-.31;state.cy=.12;state.scale=18000;schedule();});
  await p.waitForFunction(()=>Number(canvas.dataset.hdFailed)>0);
  const fallback=await p.locator('#map').evaluate(c=>({...c.dataset}));
  assert.ok(Number(fallback.tiles)>0);
  assert.equal(await p.locator('#map').getAttribute('data-tile-status'),'fallback');
  await p.evaluate(()=>{state.hd=false;schedule();});
  await p.waitForFunction(()=>canvas.dataset.hdWanted==='0');
  assert.equal(await p.locator('#map').getAttribute('data-tile-status'),'offline');
  // Large pans do not retain an ever-growing decoded bitmap cache.
  const limits=await p.evaluate(()=>({cache:hdTiles.size,pending:[...hdTiles.values()].filter(t=>t.status==='loading').length}));
  assert.ok(limits.cache<=256);assert.equal(limits.pending,0);
  assert.deepEqual(errors,[]);
  const m=await browser.newPage(devices['iPhone 13']);
  await m.route('https://game-cdn.appsample.com/**',r=>r.abort());
  await m.goto(pathToFileURL(file).href);
  await m.evaluate(()=>{state.hd=false;schedule();});
  await m.locator('#map-select').selectOption('castle');
  await m.waitForFunction(()=>document.querySelector('#map').dataset.overlay==='ready');
  assert.equal(await m.evaluate(()=>document.documentElement.scrollWidth),390);
  assert.equal(await m.locator('#map').getAttribute('data-tile-status'),'floor');
  await m.screenshot({path:path.join(output,'atlas72-hd-mobile.png'),fullPage:true});
  writeFileSync(path.join(output,'hd-audit.json'),JSON.stringify({online,levels,fallback,limits,responses,errors},null,2));
  console.log('PASS: real level-15 CDN, exact sample tile, Retina selection, offline fallback, cache bounds, mobile floor controls');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
