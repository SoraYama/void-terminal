// Run from the workspace root: node prototypes/world-map/verify.cjs <atlas.html>
const {chromium,devices}=require(process.cwd()+'/node_modules/playwright');
const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const file=path.resolve(process.argv[2]);
const output=path.dirname(file);
const report=JSON.parse(readFileSync(path.join(output,'audit-7.2.json'),'utf8'));
const url=pathToFileURL(file).href;

(async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  const p=await browser.newPage({viewport:{width:1440,height:950}});
  const errors=[];p.on('pageerror',e=>errors.push(e.message));
  p.on('requestfailed',r=>errors.push(r.url().slice(0,120)));
  await p.goto(url);
  await p.evaluate(()=>{state.hd=false;schedule();});
  const wait=async(scene,floor='')=>{
   await p.waitForFunction(({scene,floor})=>{
    const d=document.querySelector('#map')?.dataset;
    return d?.scene===scene && d.floor===floor && Number(d.tiles)>0 && (!floor || d.overlay==='ready');
   },{scene,floor});
  };
  const count=async()=>Number(await p.locator('#map').getAttribute('data-count'));
  const choose=async filter=>p.locator('[data-filter="'+filter+'"]').click();
  await wait('teyvat');
  assert.equal(await count(),Object.values(report.scenes.teyvat.oculi).reduce((a,b)=>a+b,0));
  await p.locator('#type-select').selectOption('833');
  assert.equal(await count(),230);
  await p.locator('#region-select').selectOption('snezhnaya');
  await p.waitForFunction(()=>Number(document.querySelector('#map').dataset.tiles)>0);
  await p.screenshot({path:path.join(output,'atlas72-snezhnaya.png')});
  await p.getByRole('button',{name:'枫丹',exact:true}).click();
  await wait('fontaine');
  assert.equal(await count(),225);
  await p.locator('#search').fill('69143');
  await p.locator('[data-point="69143"]').click();
  await wait('castle','165');
  assert.match(await p.locator('.detail-icon').getAttribute('src'),/^data:image\/svg/);
  await p.locator('#search').fill('');
  assert.equal(await count(),2);
  // A typed search clears the selection: select again to exercise the entrance.
  await p.locator('#search').fill('69143');
  await p.locator('[data-point="69143"]').click();
  await p.getByRole('button',{name:/双向通路.*68936/}).click();
  await p.locator('#detail').getByRole('heading',{name:'双向通路'}).waitFor();
  await p.locator('[data-point="69143"]').click();
  await p.screenshot({path:path.join(output,'atlas72-castle.png')});
  await p.locator('#search').fill('');
  for(const [label,floor,n] of [['B1','162',3],['B2','163',0],['B3','164',1],['B4','165',2]]) {
   await p.getByRole('button',{name:label,exact:true}).click();
   await wait('castle',floor);assert.equal(await count(),n);
  }
  await p.getByRole('button',{name:'枫丹',exact:true}).click();
  await choose('material');
  await p.locator('#search').fill('湖光铃兰');
  assert.equal(await count(),79);
  assert.equal(await p.locator('#results .item-icon').count(),1);
  await p.locator('[data-resource-type="548"]').click();
  await p.locator('#search').fill('56744');
  await p.locator('#results [data-point]').first().click();
  const before=await p.locator('#map').getAttribute('data-center');
  const box=await p.locator('#map').boundingBox();
  await p.mouse.move(box.x+box.width/2,box.y+box.height/2);
  await p.mouse.wheel(0,-300);
  await p.mouse.down();await p.mouse.move(box.x+box.width/2+70,box.y+box.height/2+35,{steps:5});await p.mouse.up();
  await p.waitForFunction(c=>document.querySelector('#map').dataset.center!==c,before);
  await p.screenshot({path:path.join(output,'atlas72-icons-map.png')});
  await p.locator('#search').fill('');
  await choose('chest');assert.equal(await count(),435);
  await p.locator('#map-select').selectOption('sea');
  await wait('sea');assert.equal(await count(),48);
  await choose('oculus');assert.equal(await count(),46);
  await p.locator('#search').fill('69623');
  await p.locator('[data-point="69623"]').click();
  await p.getByRole('button',{name:'查看所在楼层'}).click();
  await wait('sea','166');
  await p.getByRole('button',{name:'返回场景全图'}).click();
  await wait('sea');
  await p.locator('#search').fill('');
  for(const scene of ['enkanomiya','chasm','sacred','space','moon']) {
   await p.locator('#map-select').selectOption(scene);
   await wait(scene);await choose('all');
   assert.ok(await count()>0);
   await p.locator('#type-select').selectOption({index:1});
   assert.ok(await count()>0);
   if(scene==='moon')await p.screenshot({path:path.join(output,'atlas72-moon.png')});
  }
  // Verify the rendered icons decode; individual unlabelled source entries stay explicit.
  const imgs=await p.locator('.item-icon').evaluateAll(a=>a.map(i=>i.complete&&i.naturalWidth>0));
  assert.ok(imgs.length && imgs.every(Boolean));
  assert.deepEqual(errors,[]);
  const m=await browser.newPage(devices['iPhone 13']);
  await m.goto(url);
  await m.evaluate(()=>{state.hd=false;schedule();});
  await m.waitForFunction(()=>Number(document.querySelector('#map')?.dataset.tiles)>0);
  assert.equal(await m.evaluate(()=>document.documentElement.scrollWidth),390);
  const c=await m.context().newCDPSession(m), b=await m.locator('#map').boundingBox();
  const x=b.x+b.width/2,y=b.y+b.height/2;
  await c.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:x-30,y,id:0},{x:x+30,y,id:1}]});
  await c.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-65,y,id:0},{x:x+65,y,id:1}]});
  await c.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await m.waitForFunction(()=>Number(document.querySelector('#map').dataset.zoom)>125);
  await m.getByRole('button',{name:'枫丹',exact:true}).click();
  await m.screenshot({path:path.join(output,'atlas72-mobile.png'),fullPage:true});
  console.log('PASS: seven scenes, latest Cryoculi 230, Fontaine material/chest counts, four castle floors/access, Sea layer, real/custom icons, desktop zoom/pan and mobile pinch');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
