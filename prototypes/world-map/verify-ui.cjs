const {chromium,devices}=require(process.cwd()+'/node_modules/playwright');
const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const {writeFileSync}=require('node:fs');
const path=require('node:path');
const file=path.resolve(process.argv[2]),output=path.dirname(file);
(async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  const p=await browser.newPage({viewport:{width:1435,height:1313}}),errors=[];
  p.on('pageerror',e=>errors.push(e.message));
  await p.goto(pathToFileURL(file).href);
  await p.waitForFunction(()=>Number(document.querySelector('#map').dataset.tiles)>0);
  assert.equal(await p.locator('.quality,#hd,#quality-status').count(),0);
  assert.equal(await p.evaluate(()=>state.hd),true);
  await p.evaluate(()=>{state.hd=false;schedule();});
  const names=await p.locator('#region-tabs button').allTextContents();
  assert.deepEqual(names,['提瓦特','蒙德','璃月','稻妻','须弥','枫丹','纳塔','至冬']);
  assert.equal(await p.locator('#results [data-point]').count(),0);
  assert.equal(await p.locator('#results [data-resource-type]').count(),8);
  assert.equal(await p.locator('#result-count').textContent(),'8 类 · 1,549 处');
  const counts=await p.locator('#results [data-resource-type]').evaluateAll(a=>Object.fromEntries(a.map(b=>[b.dataset.resourceType,Number(b.querySelector('.group-count').childNodes[0].textContent.replaceAll(',',''))])));
  assert.equal(counts[5],65);assert.equal(counts[508],225);assert.equal(counts[833],230);
  assert.equal(Object.values(counts).reduce((a,b)=>a+b,0),1549);
  await p.locator('[data-resource-type="508"]').click();
  assert.equal(await p.locator('#map').getAttribute('data-count'),'225');
  assert.equal(await p.locator('#results [data-resource-type]').count(),1);
  await p.locator('#clear-type').click();
  assert.equal(await p.locator('#results [data-resource-type]').count(),8);
  for(const name of names.slice(1)) {
   await p.getByRole('button',{name,exact:true}).click();
   assert.equal(await p.locator('#scene-title').textContent(),name);
   assert.equal(await p.locator('#region-tabs [aria-pressed="true"]').textContent(),name);
   assert.equal(await p.locator('#region-select option:checked').textContent(),name);
  }
  const maps={enkanomiya:'渊下宫',chasm:'层岩巨渊',sea:'旧日之海',sacred:'远古圣山',space:'空之神殿',moon:'霜月',castle:'褪色古堡'};
  for(const [scene,name] of Object.entries(maps)) {
   await p.locator('#map-select').selectOption(scene);
   assert.equal(await p.locator('#scene-title').textContent(),name);
   await p.waitForFunction(scene=>document.querySelector('#map').dataset.scene===scene,scene);
  }
  await p.getByRole('button',{name:'提瓦特',exact:true}).click();
  await p.locator('#region-select').selectOption('liyue');
  assert.equal(await p.locator('#region-tabs [aria-pressed="true"]').textContent(),'璃月');
  const measurements=async page=>page.evaluate(()=>{
   const rect=s=>document.querySelector(s).getBoundingClientRect();
   return {plate:rect('.plate').width,region:rect('#region-control').width,map:rect('#map-select').width,leftAligned:rect('.plate').left===rect('#region-control').left,
    arrows:['#region-control','.more-maps .select-wrap'].map(s=>{const r=rect(s+' select'),a=rect(s+' .select-chevron'),cs=getComputedStyle(document.querySelector(s+' select'));return {left:parseFloat(cs.paddingLeft)+parseFloat(cs.borderLeftWidth),right:r.right-a.right,appearance:cs.appearance};})};
  });
  const desktop=await measurements(p);
  assert.equal(desktop.plate,desktop.region);assert.equal(desktop.map,desktop.region);assert.ok(desktop.leftAligned);
  assert.ok(desktop.arrows.every(a=>Math.abs(a.left-a.right)<.1 && a.appearance==='none'));
  await p.getByRole('button',{name:'提瓦特',exact:true}).click();
  await p.waitForFunction(()=>[...images.values()].every(im=>im.complete));
  await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  await p.screenshot({path:path.join(output,'atlas-ui-desktop.png'),fullPage:true});
  await p.locator('#search').fill('301');
  assert.equal(await p.locator('#results [data-point]').count(),1);
  await p.locator('[data-point="301"]').click();
  assert.match(await p.locator('#detail').textContent(),/#301/);
  const m=await browser.newPage(devices['iPhone 13']);m.on('pageerror',e=>errors.push(e.message));
  await m.goto(pathToFileURL(file).href);await m.evaluate(()=>{state.hd=false;schedule();});
  assert.equal(await m.evaluate(()=>document.documentElement.scrollWidth),390);
  const mobile=await measurements(m);
  assert.equal(mobile.plate,mobile.region);assert.equal(mobile.map,mobile.region);
  assert.ok(mobile.arrows.every(a=>Math.abs(a.left-a.right)<.1));
  await m.getByRole('button',{name:'枫丹',exact:true}).click();
  assert.equal(await m.locator('#results [data-resource-type]').count(),1);
  await m.waitForFunction(()=>[...images.values()].every(im=>im.complete));
  await m.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  await m.screenshot({path:path.join(output,'atlas-ui-mobile.png'),fullPage:true});
  assert.deepEqual(errors,[]);
  writeFileSync(path.join(output,'ui-audit.json'),JSON.stringify({names,maps,counts,desktop,mobile,errors},null,2));
  console.log('PASS: 8 region tabs, all independent/layer map choices, grouped resource counts/filter, exact ID, equal control widths and arrow insets, default HD without switch, desktop/mobile');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
