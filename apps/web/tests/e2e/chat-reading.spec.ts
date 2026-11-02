import {test,expect,type Page} from '@playwright/test';
import path from 'node:path';

const references=Array.from({length:40},(_,i)=>({id:`reading-${i}`,documentId:`doc-${i}`,title:`原文记录 ${i+1} · 在生命的雷同`,type:'quest',language:'zh-CN',text:'用于阅读回归的原文。',path:'fixture.json',locator:`line:${i}`,snapshotId:'reading-fixture',citation:i+1}));
async function start(page:Page,theme:'light'|'dark'){
 await page.addInitScript(({theme,references})=>{
  localStorage.setItem('void.preferences',JSON.stringify({theme,locale:'zh-CN',sourceLanguage:'zh-CN',mode:'byok'}));
  const original=window.fetch.bind(window);
  window.fetch=async(input,init)=>{
   if(String(input)!=='/api/chat')return original(input,init);
   const encoder=new TextEncoder();let timer:ReturnType<typeof setInterval>;
   const body=new ReadableStream<Uint8Array>({start(c){
    const emit=(event:string,data:unknown)=>c.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
    emit('sources',{sources:references,snapshotId:'reading-fixture'});
    emit('text_delta',{text:Array.from({length:32},(_,i)=>`### 旅途的第 ${i+1} 幕\n\n旅行者循着原文，回望须弥城中的人们。这是隔离的浏览器测试内容。[1]\n\n`).join('')});
    timer=setInterval(()=>emit('text_delta',{text:'故事仍在继续，新的片段正在写入。\n\n'}),250);
    init?.signal?.addEventListener('abort',()=>{clearInterval(timer);c.error(new DOMException('Aborted','AbortError'))},{once:true});
   },cancel(){clearInterval(timer)}});
   return new Response(body,{headers:{'Content-Type':'text/event-stream'}});
  };
 },{theme,references});
 await page.route('**/api/status',r=>r.fulfill({json:{ready:true,provider:{sharedEnabled:false,model:'fixture'},coverage:[]}}));
 await page.route('**/api/sources/*',r=>r.fulfill({json:{source:references[0],context:[],related:[]}}));
 await page.goto('/');
 const menu=page.getByRole('button',{name:'Menu',exact:true});if(await menu.isVisible())await menu.click();
 await page.getByRole('button',{name:'设置',exact:true}).click();
 await page.getByLabel('模型 API Key',{exact:true}).fill('reading-test-key');
 await page.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).click();
 await page.getByRole('textbox',{name:'向虚空提问…'}).fill('请讲述须弥魔神任务的来龙去脉');
 await page.getByRole('button',{name:'发送',exact:true}).click();
 await expect(page.locator('.markdown h3').last()).toContainText('32');
}
for(const theme of ['light','dark'] as const){
 test(`reading: ${theme} stream follows text, references stay compact and user scroll wins`,async({page},info)=>{
  await start(page,theme);
  const disclosure=page.locator('details.citations');
  await expect(disclosure).toHaveCount(1);await expect(disclosure).not.toHaveAttribute('open','');
  expect((await disclosure.boundingBox())!.height).toBeLessThanOrEqual(48);
  const tail=page.locator('.answer-tail').last(),scroll=page.locator('.chat-scroll');
  await expect(tail).toBeInViewport();
  // Even a small upward gesture must suspend following, not just a full page jump.
  const originalTop=await scroll.evaluate(el=>el.scrollTop);
  await scroll.hover();await page.mouse.wheel(0,-35);
  await expect.poll(()=>scroll.evaluate(el=>el.scrollTop)).toBeLessThan(originalTop);
  const smallScroll=await scroll.evaluate(el=>el.scrollTop),before=await page.locator('.markdown p').count();
  await expect.poll(()=>page.locator('.markdown p').count()).toBeGreaterThan(before+1);
  expect(await scroll.evaluate(el=>el.scrollTop)).toBe(smallScroll);
  await scroll.evaluate(el=>{el.scrollTop=0;el.dispatchEvent(new Event('scroll'))});
  await expect.poll(()=>scroll.evaluate(el=>el.scrollTop)).toBe(0);
  const count=await page.locator('.markdown p').count();await expect.poll(()=>page.locator('.markdown p').count()).toBeGreaterThan(count+1);
  expect(await scroll.evaluate(el=>el.scrollTop)).toBe(0);
  await expect(page.locator('.conversation-header')).toHaveAttribute('data-compact','false');
  await page.screenshot({path:path.resolve(`../../artifacts/screenshots/${info.project.name}-reading-${theme}-expanded.png`),animations:'disabled'});
  await page.getByRole('button',{name:'回到最新回答 ↓',exact:true}).click();await expect(tail).toBeInViewport();
  await expect(page.locator('.conversation-header')).toHaveAttribute('data-compact','true');
  await expect(page.locator('.conversation-header h2')).toHaveText('请讲述须弥魔神任务的来龙去脉');
  const bounds=await page.locator('.chat-scroll').boundingBox();expect(bounds!.height/page.viewportSize()!.height).toBeGreaterThan(.65);
  const composer=page.locator('.chat-bottom .composer');expect((await composer.boundingBox())!.height).toBeLessThanOrEqual(126);
  expect(await composer.evaluate(el=>getComputedStyle(el).boxShadow)).not.toBe('none');
  await page.screenshot({path:path.resolve(`../../artifacts/screenshots/${info.project.name}-reading-${theme}-streaming.png`),animations:'disabled',scale:'css',style:'nextjs-portal{visibility:hidden}'});
  await disclosure.locator('summary').click();
  const position=await scroll.evaluate(el=>el.scrollTop),paragraphs=await page.locator('.markdown p').count();
  await expect.poll(()=>page.locator('.markdown p').count()).toBeGreaterThan(paragraphs+1);
  expect(await scroll.evaluate(el=>el.scrollTop)).toBe(position);
  await page.getByRole('button',{name:'停止生成',exact:true}).click();
  await expect(disclosure).toHaveAttribute('open','');
  const chip=disclosure.locator('[data-source-trigger]').first();await chip.click();
  await expect(page.getByRole('dialog')).toBeVisible();await page.keyboard.press('Escape');await expect(chip).toBeFocused();
  await disclosure.locator('summary').click();
  await page.screenshot({path:path.resolve(`../../artifacts/screenshots/${info.project.name}-reading-${theme}-compact.png`),animations:'disabled'});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 });
}
test('reading: reduced motion and short narrow viewport preserve controls and multiline input',async({page})=>{
 await page.setViewportSize({width:360,height:640});await page.emulateMedia({reducedMotion:'reduce'});await start(page,'dark');
 await expect(page.locator('.conversation-header')).toHaveAttribute('data-compact','true');
 const textarea=page.getByRole('textbox',{name:'继续追问…'});await textarea.fill('第一行\n第二行\n第三行\n第四行');
 expect(await textarea.evaluate(el=>el.clientHeight)).toBeGreaterThan(60);
 await expect(page.getByRole('button',{name:'停止生成',exact:true})).toBeInViewport();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.setViewportSize({width:360,height:420});
 await expect(page.getByRole('button',{name:'停止生成',exact:true})).toBeInViewport();
 await expect(textarea).toBeInViewport();
 await page.getByRole('button',{name:'停止生成',exact:true}).click();
});
test('reading: latest returns upward from expanded references',async({page})=>{
 await page.setViewportSize({width:360,height:640});
 await start(page,'light');
 await page.getByRole('button',{name:'停止生成',exact:true}).click();
 const scroll=page.locator('.chat-scroll'),tail=page.locator('.answer-tail').last();
 await page.locator('details.citations summary').click();
 await scroll.evaluate(el=>{el.scrollTop=el.scrollHeight;el.dispatchEvent(new Event('scroll'))});
 await expect(tail).not.toBeInViewport();
 await page.getByRole('button',{name:'回到最新回答 ↓',exact:true}).click();
 await expect(tail).toBeInViewport();
});
test('reading: switching equal-height chats keeps the compact title and export available',async({page})=>{
 await start(page,'light');await page.getByRole('button',{name:'停止生成',exact:true}).click();
 // Equal-height histories can retain exactly the same scrollTop, so no scroll event fires.
 await page.evaluate(async()=>{
  const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('void-terminal',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
  const records=await new Promise<any[]>(resolve=>{const r=db.transaction('conversations').objectStore('conversations').getAll();r.onsuccess=()=>resolve(r.result)});
  await new Promise<void>(resolve=>{const tx=db.transaction('conversations','readwrite');tx.objectStore('conversations').put({...records[0],id:'same-height-history',title:'等高历史对话',updatedAt:Date.now()+1});tx.oncomplete=()=>{db.close();resolve()}});
 });
 await page.reload();
 const menu=page.getByRole('button',{name:'Menu',exact:true});if(await menu.isVisible())await menu.click();
 await page.getByRole('button',{name:'请讲述须弥魔神任务的来龙去脉',exact:true}).click();
 await expect(page.locator('.conversation-header')).toHaveAttribute('data-compact','true');
 if(await menu.isVisible())await menu.click();
 // Refreshing the sidebar history list above also loaded the equal-height clone.
 await page.getByRole('button',{name:'等高历史对话',exact:true}).click();
 await expect(page.locator('.conversation-header')).toHaveAttribute('data-compact','true');
 await expect(page.getByRole('button',{name:'导出',exact:true})).toBeVisible();
});
