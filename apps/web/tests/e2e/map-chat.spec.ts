import {test,expect} from '@playwright/test';
import type {MapCard} from '../../src/lib/map-cards';

test('real map API → streamed card → interaction → history with independent version pin',async({page,request},info)=>{
 test.skip(process.env.MAP_E2E_REAL_DATA!=='1','Prepare the audited local map snapshot and set MAP_E2E_REAL_DATA=1.');
 const query=await request.post('/api/maps/query',{data:{region:'奥摩斯港',resource:'草神瞳'}});
 expect(query.status()).toBe(200);const {card}=await query.json() as {card:MapCard};
 expect(card.count).toBe(2);expect(card.status).toBe('crosschecked');
 expect(card.markers.filter(p=>p.role==='included').map(p=>p.id)).toEqual([33876,33877]);
 const question='须弥的奥摩斯港有多少草神瞳？';
 await page.addInitScript(({card,theme})=>{
  localStorage.setItem('void.preferences',JSON.stringify({theme,locale:'zh-CN',sourceLanguage:'zh-CN',mode:'byok'}));
  const original=window.fetch.bind(window),encoder=new TextEncoder();
  type Harness=Window&{mapRequests?:unknown[];mapPush?:(event:string,data:unknown)=>void};
  const w=window as Harness;w.mapRequests=[];
  window.fetch=async(input,init)=>{
   if(String(input)!=='/api/chat')return original(input,init);
   w.mapRequests!.push(JSON.parse(String(init?.body)));
   return new Response(new ReadableStream({start(controller){
    w.mapPush=(event,data)=>{controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));if(event==='done')controller.close()};
    w.mapPush('maps',{mapSnapshotId:card.snapshotId,maps:[card]});
   }}),{headers:{'content-type':'text/event-stream'}});
  };
 },{card,theme:info.project.name==='mobile'?'dark':'light'});
 await page.goto('/');
 const menu=page.getByRole('button',{name:'Menu',exact:true});if(await menu.isVisible())await menu.click();
 await page.getByRole('button',{name:'设置',exact:true}).click();
 await page.getByLabel('模型 API Key',{exact:true}).fill('map-browser-fixture');
 await page.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).click();
 await page.locator('#question').fill(question);await page.getByRole('button',{name:'发送',exact:true}).click();
 const entry=page.locator('[data-map-card]').first(),canvas=entry.locator('canvas');
 await expect(entry).toBeVisible();await expect(entry.locator('.resource-map-total strong')).toHaveText('2');
 await expect.poll(()=>canvas.getAttribute('data-loaded-tiles')).not.toBe('0');
 await expect.poll(async()=>Number(await canvas.getAttribute('data-loaded-tiles'))).toBeGreaterThan(0);
 const initialCenter=await canvas.getAttribute('data-center');
 await canvas.focus();await canvas.press('ArrowRight');
 await expect(canvas).not.toHaveAttribute('data-center',initialCenter!);
 await canvas.press('Home');
 await canvas.scrollIntoViewIfNeeded();
 await expect(canvas).toBeInViewport({ratio:.9});
 const box=await canvas.boundingBox();expect(box).not.toBeNull();
 if(info.project.name==='mobile'){
  const cdp=await page.context().newCDPSession(page),x=box!.x+box!.width/2,y=box!.y+box!.height/2;
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:0,x:x-25,y},{id:1,x:x+25,y}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:0,x:x-50,y},{id:1,x:x+50,y}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await expect.poll(async()=>Number(await canvas.getAttribute('data-zoom'))).toBeGreaterThan(1);
  await cdp.detach();await entry.getByRole('button',{name:'回到查询范围',exact:true}).click();
 }else{
  await page.mouse.move(box!.x+box!.width*.4,box!.y+box!.height*.6);await page.mouse.down();
  await page.mouse.move(box!.x+box!.width*.5,box!.y+box!.height*.65,{steps:4});await page.mouse.up();
  await expect(canvas).not.toHaveAttribute('data-center',initialCenter!);
  await entry.getByRole('button',{name:'回到查询范围',exact:true}).click();
 }
 await entry.locator('summary').click();await entry.locator('[data-map-point="33877"]').click();
 await expect(canvas).toHaveAttribute('data-selected','33877');
 await entry.getByRole('button',{name:'放大地图',exact:true}).click();
 await expect.poll(async()=>Number(await canvas.getAttribute('data-zoom'))).toBeGreaterThan(1);
 const zoom=await canvas.getAttribute('data-zoom');
 await page.evaluate(()=> (window as Window&{mapPush?:(event:string,data:unknown)=>void}).mapPush?.('text_delta',{text:'奥摩斯港范围内有 2 个草神瞳；附近界外的两个不计入。'}));
 await expect(page.locator('.message.assistant .markdown > p')).toContainText('2 个');
 await expect(canvas).toHaveAttribute('data-zoom',zoom!);await expect(canvas).toHaveAttribute('data-selected','33877');
 await page.evaluate(card=>(window as Window&{mapPush?:(event:string,data:unknown)=>void}).mapPush?.('done',{finishReason:'stop',mapSnapshotId:card.snapshotId,maps:[card]}),card);
 await expect(page.getByRole('button',{name:'停止',exact:true})).toHaveCount(0);
 await expect(canvas).toHaveAttribute('data-zoom',zoom!);
 await expect(entry.getByRole('link',{name:'查看标点来源'})).toHaveAttribute('href',/id=33877/);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await entry.getByRole('button',{name:'回到查询范围',exact:true}).click();
 await expect(canvas).toHaveAttribute('data-zoom','1');
 await entry.locator('summary').click();
 await entry.evaluate(element=>{
  const scroll=element.closest('.chat-scroll')!;
  const inset=Number.parseFloat(getComputedStyle(scroll).scrollPaddingTop)||0;
  scroll.scrollTop+=element.getBoundingClientRect().top-scroll.getBoundingClientRect().top-inset;
 });
 // Let the reset frame enqueue its tiles before waiting for network and bitmap paint.
 await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
 await page.waitForLoadState('networkidle');
 await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
 // Reset can requeue aborted tiles after navigation has already reached networkidle.
 // Await the actual visible tile queue, including image decoding, before visual acceptance.
 await expect(canvas).toHaveAttribute('data-pending-tiles','0',{timeout:25000});
 await expect(canvas).toHaveAttribute('data-failed-tiles','0');
 await expect(canvas).toHaveAttribute('data-active-loads','0');
 await expect(canvas).toHaveAttribute('data-tile-state','ready');
 await page.screenshot({path:info.outputPath('map-chat.png'),animations:'disabled',fullPage:true});
 await page.reload();if(await menu.isVisible())await menu.click();
 await page.locator('.history-row').getByRole('button',{name:question,exact:true}).click();
 await expect(entry).toBeVisible();await expect(entry.locator('.resource-map-total strong')).toHaveText('2');
 // BYOK keys deliberately live only in memory and must be re-entered after reload.
 await expect(page.getByRole('dialog')).toHaveCount(0);
 await page.locator('#question').fill('那附近的呢？');await page.getByRole('button',{name:'发送',exact:true}).click();
 await page.getByLabel('模型 API Key',{exact:true}).fill('map-browser-fixture');
 await page.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).click();
 await page.getByRole('button',{name:'发送',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as Window&{mapRequests?:unknown[]}).mapRequests?.length??0)).toBe(1);
 const requests=await page.evaluate(()=>(window as Window&{mapRequests?:Record<string,unknown>[]}).mapRequests);
 expect(requests?.at(-1)?.mapSnapshotId).toBe(card.snapshotId);expect(requests?.at(-1)?.snapshotId).toBeUndefined();
 await page.evaluate(card=>(window as Window&{mapPush?:(event:string,data:unknown)=>void}).mapPush?.('done',{finishReason:'stop',mapSnapshotId:card.snapshotId,maps:[card]}),card);
});
