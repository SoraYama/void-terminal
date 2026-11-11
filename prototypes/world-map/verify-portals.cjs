const {chromium,devices}=require(process.cwd()+'/node_modules/playwright');
const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const {writeFileSync}=require('node:fs');
const path=require('node:path');
const file=path.resolve(process.argv[2]),output=path.dirname(file);
const destinations={enkanomiya:'渊下宫',chasm:'层岩巨渊',sea:'旧日之海',sacred:'远古圣山',space:'空之神殿',moon:'霜月'};
(async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  const p=await browser.newPage({viewport:{width:1440,height:950}}),errors=[],checked=[];
  p.on('pageerror',e=>errors.push(e.message));
  await p.goto(pathToFileURL(file).href);await p.evaluate(()=>{state.hd=false;schedule();});
  await p.waitForFunction(()=>Number(document.querySelector('#map').dataset.tiles)>0);
  const labels=await p.locator('.map-portal').evaluateAll(a=>a.map(b=>b.textContent));
  assert.deepEqual(labels,Object.values(destinations).map(n=>'前往'+n));
  const center=async(scene)=>{
   await p.evaluate(scene=>{
    const dest=D.maps[scene],portal=sceneMap().portals.find(p=>p.targetMapKey===dest.key);
    state.cx=portal.position.x;state.cy=latY(portal.position.y);state.scale=state.baseline*4;schedule();
   },scene);
  };
  for(const [scene,name] of Object.entries(destinations)) {
   await center(scene);
   const b=p.getByRole('button',{name:'前往'+name,exact:true});
   await b.waitFor({state:'visible'});
   assert.equal(await b.locator('svg').count(),1);
   assert.ok(!(await b.textContent()).includes('↔'));
   if(scene==='enkanomiya') {
    await p.waitForFunction(()=>[...images.values()].every(im=>im.complete));
    await p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    await p.screenshot({path:path.join(output,'atlas-portals-fixed.png')});
    await b.focus();await p.keyboard.press('Enter');
   } else await b.click();
   await p.waitForFunction(scene=>document.querySelector('#map').dataset.scene===scene,scene);
   await center('teyvat');
   await p.getByRole('button',{name:'返回提瓦特',exact:true}).click();
   await p.waitForFunction(()=>document.querySelector('#map').dataset.scene==='teyvat');
   checked.push({scene,label:'前往'+name,exit:'返回提瓦特'});
  }
  await p.locator('#map-select').selectOption('castle');
  await p.waitForFunction(()=>document.querySelector('#map').dataset.floor==='162');
  assert.equal(await p.locator('.map-portal:visible').count(),0);
  const m=await browser.newPage(devices['iPhone 13']);
  m.on('pageerror',e=>errors.push(e.message));
  await m.goto(pathToFileURL(file).href);await m.evaluate(()=>{state.hd=false;schedule();});
  await m.evaluate(()=>{const a=D.maps.teyvat.portals.find(p=>p.targetMapKey==='sea-of-bygone-eras');state.cx=a.position.x;state.cy=latY(a.position.y);state.scale=state.baseline*6;schedule();});
  const entry=m.getByRole('button',{name:'前往旧日之海',exact:true});
  await entry.waitFor({state:'visible'});
  const box=await entry.boundingBox();assert.ok(box.width>=44 && box.height>=44);
  await m.waitForFunction(()=>[...images.values()].every(im=>im.complete));
  await m.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await m.screenshot({path:path.join(output,'atlas-portals-mobile.png'),fullPage:true});
  await entry.tap();
  await m.waitForFunction(()=>document.querySelector('#map').dataset.scene==='sea');
  assert.equal(await m.evaluate(()=>document.documentElement.scrollWidth),390);
  assert.deepEqual(errors,[]);
  writeFileSync(path.join(output,'portal-audit.json'),JSON.stringify({labels,checked,errors,mobileTap:true},null,2));
  console.log('PASS: six real destination labels, all entrance/exit clicks, keyboard activation, floors hide portals, mobile 44px tap');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
