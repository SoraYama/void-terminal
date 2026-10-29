import {test,expect,type Page,type Route} from '@playwright/test';
import path from 'node:path';
const screenshotDir=path.resolve(process.cwd(),'../../artifacts/screenshots');
const source={id:'s1',documentId:'book-1',title:'Browser fixture · 原文',type:'book',language:'zh-CN',text:'浏览器隔离测试原文：旅行者在须弥寻找知识。',path:'fixtures/book.json',locator:'paragraph:1',sourceUrl:'https://example.com/source',snapshotId:'fixture-snapshot',citation:1};
const status={ready:true,activeSnapshot:{id:'fixture-snapshot',sourceRepo:'fixture',sourceCommit:'fixture-commit',gameVersion:null,createdAt:'2026-10-28T00:00:00Z',label:'Browser fixture (mock)',state:'ready'},documentCount:1,chunkCount:1,languages:['zh-CN','en'],retrieval:{lexical:true,semantic:false,model:null},coverage:[{type:'book',discovered:1,imported:1,missingText:0,unresolved:0,notes:[]}],provider:{model:'fixture-model',sharedEnabled:true,byok:true}};
const frame=(event:string,data:unknown)=>`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
async function setup(page:Page){
 await page.route('**/api/status',r=>r.fulfill({json:status}));
 await page.route('**/api/models/test',async r=>{expect(r.request().headers()['x-model-api-key']).toBe('browser-test-key');await r.fulfill({json:{ok:true,model:'fixture-model',message:'Mock connection successful'}})});
 await page.route('**/api/library?*',r=>{const u=new URL(r.request().url());const q=u.searchParams.get('q');return r.fulfill({json:{items:q==='absent'?[]:[{id:'book-1',title:'Browser fixture · 原文',type:'book',language:u.searchParams.get('language'),excerpt:source.text,snapshotId:'fixture-snapshot'}],total:q==='absent'?0:1,page:1,pageSize:24,snapshotId:'fixture-snapshot'}})});
 await page.route('**/api/documents/book-1?*',r=>r.fulfill({json:{document:{id:'book-1',title:source.title,type:'book',language:'zh-CN',text:source.text+'\n这是完整的原文上下文，用于浏览器隔离测试。',source:{repo:'fixture',commit:'fixture-commit',path:source.path,locator:source.locator,url:source.sourceUrl},metadata:{},relations:[{kind:'next',targetId:'book-2',condition:'questState == 3'}]},sources:[source],snapshotId:'fixture-snapshot'}}));
 await page.route('**/api/sources/s1?*',r=>r.fulfill({json:{source,context:[source],related:[{id:'book-2',title:'Browser fixture · 下一段',type:'dialogue',language:'zh-CN',excerpt:'下一段原文',snapshotId:'fixture-snapshot'}]}}));
 await page.route('**/api/documents/book-2?*',r=>r.fulfill({json:{document:{id:'book-2',title:'Browser fixture · 下一段',type:'dialogue',language:'zh-CN',text:'下一段原文，保留资料关联。',source:{repo:'fixture',commit:'fixture-commit',path:'fixtures/next.json',locator:'line:2',url:'https://example.com/next'},metadata:{},relations:[]},sources:[],snapshotId:'fixture-snapshot'}}));
 await page.goto('/');
}
async function settings(page:Page){const menu=page.getByRole('button',{name:'Menu',exact:true});if(await menu.isVisible())await menu.click();await page.getByRole('button',{name:/^(设置|Settings)$/}).click();return page.getByRole('dialog')}
async function choose(page:Page,label:string,option:string){await page.getByRole('combobox',{name:label,exact:true}).click();await page.getByRole('option',{name:option,exact:true}).click()}
async function configure(page:Page){const dialog=await settings(page);await dialog.getByLabel('模型 API Key').fill('browser-test-key');await dialog.getByRole('button',{name:'测试连接'}).click();await expect(dialog.getByRole('status')).toContainText('连接成功');await dialog.getByRole('button',{name:'关闭',exact:true}).click()}
async function library(page:Page){const menu=page.getByRole('button',{name:'Menu',exact:true});if(await menu.isVisible())await menu.click();await page.getByRole('button',{name:'原文库',exact:true}).click()}
async function saveScreenshot(page:Page,name:string,project:string){await page.screenshot({path:path.join(screenshotDir,`${project}-${name}.png`),fullPage:true,scale:'css',style:'nextjs-portal{visibility:hidden}',animations:'disabled'})}
test('mock: deep research remains visibly enabled after hover ends and toggles with the keyboard',async({page},testInfo)=>{
 if(testInfo.project.name==='desktop')await page.setViewportSize({width:948,height:1314});
 await setup(page);const button=page.getByRole('button',{name:'深入考据',exact:true});
 await button.hover();await expect(button).toHaveAttribute('aria-pressed','false');
 await saveScreenshot(page,'deep-research-hover',testInfo.project.name);
 const hoverColor=await button.evaluate(el=>getComputedStyle(el).backgroundColor);
 await button.click();await expect(button).toHaveAttribute('aria-pressed','true');
 await expect.poll(()=>button.evaluate(el=>getComputedStyle(el).backgroundColor)).not.toBe(hoverColor);
 await page.mouse.move(1,1);await expect(button.locator('.depth-check')).toBeVisible();
 await saveScreenshot(page,'deep-research-enabled',testInfo.project.name);
 await button.press('Space');await expect(button).toHaveAttribute('aria-pressed','false');await expect(button.locator('.depth-check')).toHaveCount(0);
 await expect(page.getByRole('dialog')).toHaveCount(0);
});
test('mock: themed dropdown supports pointer, keyboard, dismissal and settings portals',async({page},testInfo)=>{
 await setup(page);
 const type=page.getByRole('combobox',{name:'全部资料',exact:true});
 await type.click();const menu=page.getByRole('listbox');await expect(menu).toBeVisible();
 await expect(page.getByRole('option',{name:'全部资料',exact:true})).toHaveAttribute('aria-selected','true');
 const bounds=await menu.boundingBox();expect(bounds!.x).toBeGreaterThanOrEqual(0);expect(bounds!.y+bounds!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
 await saveScreenshot(page,'dropdown-light',testInfo.project.name);
 await page.getByRole('option',{name:'角色',exact:true}).click();await expect(type).toHaveText('角色');
 await type.focus();await page.keyboard.press('ArrowDown');await expect(menu).toBeVisible();await expect(page.getByRole('option',{name:'角色',exact:true})).toBeFocused();await page.keyboard.press('End');await expect(page.getByRole('option',{name:'其他',exact:true})).toBeFocused();await page.keyboard.press('Enter');await expect(type).toHaveText('其他');
 await type.click();await page.keyboard.press('Escape');await expect(menu).toHaveCount(0);await expect(type).toBeFocused();
 await page.getByRole('textbox',{name:'向虚空提问…'}).click();await expect(page.getByRole('button',{name:'停止生成',exact:true})).toHaveCount(0);
 const dialog=await settings(page);await dialog.getByRole('combobox',{name:'外观',exact:true}).click();await page.getByRole('option',{name:'深色',exact:true}).click();
 await dialog.getByRole('combobox',{name:'模型连接',exact:true}).click();await saveScreenshot(page,'dropdown-settings-dark',testInfo.project.name);await page.keyboard.press('Escape');
 await expect(dialog).toBeVisible();await dialog.getByRole('button',{name:'关闭',exact:true}).click();
 await type.click();await saveScreenshot(page,'dropdown-dark',testInfo.project.name);
 await page.mouse.click(1,1);await expect(menu).toHaveCount(0);
});
test('mock: unavailable shared service stays disabled in the custom menu',async({page})=>{
 await setup(page);await page.route('**/api/status',r=>r.fulfill({json:{...status,provider:{...status.provider,sharedEnabled:false}}}));await page.reload();
 const dialog=await settings(page);const mode=dialog.getByRole('combobox',{name:'模型连接',exact:true});await mode.click();
 await expect(page.getByRole('option',{name:'共享服务（未启用）',exact:true})).toHaveAttribute('aria-disabled','true');
 await page.keyboard.press('End');await expect(page.getByRole('option',{name:'使用自己的密钥',exact:true})).toBeFocused();
 await page.keyboard.press('Enter');await expect(mode).toHaveText('使用自己的密钥');
});
test('mock: custom provider is used for testing and chat, survives refresh without a key, and never overrides shared mode',async({page},testInfo)=>{
 await setup(page);await configure(page);const dialog=await settings(page);
 await dialog.getByLabel('Base URL',{exact:true}).fill('https://models.example.com/api/v1');
 await expect(dialog.getByLabel('模型 API Key',{exact:true})).toHaveValue('');
 await dialog.getByLabel('模型名称（Model name）',{exact:true}).fill('org/custom-model');
 await dialog.getByLabel('模型 API Key',{exact:true}).fill('browser-test-key');
 let tested:any;await page.route('**/api/models/test',r=>{tested=r.request().postDataJSON();return r.fulfill({json:{ok:true,model:'org/custom-model'}})});
 await dialog.getByRole('button',{name:'测试连接',exact:true}).click();await expect(dialog.getByRole('status')).toContainText('org/custom-model');
 expect(tested.provider).toEqual({baseUrl:'https://models.example.com/api/v1',model:'org/custom-model'});
 await saveScreenshot(page,'custom-model-settings',testInfo.project.name);
 await dialog.getByRole('button',{name:'关闭',exact:true}).click();let asked:any;
 await page.route('**/api/chat',r=>{asked=r.request().postDataJSON();expect(r.request().headers()['x-model-api-key']).toBe('browser-test-key');return r.fulfill({contentType:'text/event-stream',body:frame('text_delta',{text:'自定义模型夹具回答。'})+frame('done',{snapshotId:'fixture-snapshot',finishReason:'stop'})})});
 await page.getByRole('textbox',{name:'向虚空提问…'}).fill('讲讲角色故事');await page.getByRole('button',{name:'发送',exact:true}).click();await expect(page.getByText('自定义模型夹具回答。',{exact:true})).toBeVisible();expect(asked.provider).toEqual(tested.provider);
 const d=await settings(page);await choose(page,'模型连接','共享服务');await d.getByRole('button',{name:'测试连接',exact:true}).click();await expect.poll(()=>tested).toEqual({mode:'shared'});
 await choose(page,'模型连接','使用自己的密钥');await d.getByRole('button',{name:'关闭',exact:true}).click();
 const stored=await page.evaluate(()=>JSON.stringify({...localStorage}));expect(stored).not.toContain('browser-test-key');
 await page.reload();const restored=await settings(page);await expect(restored.getByLabel('Base URL',{exact:true})).toHaveValue('https://models.example.com/api/v1');await expect(restored.getByLabel('模型名称（Model name）',{exact:true})).toHaveValue('org/custom-model');await expect(restored.getByLabel('模型 API Key',{exact:true})).toHaveValue('');
});
test('mock: editing provider settings discards an obsolete connection-test success',async({page})=>{
 await page.addInitScript(()=>{
  const original=window.fetch.bind(window);
  window.fetch=async(input,init)=>String(input)==='/api/models/test'?new Promise<Response>(resolve=>{
   // Deliberately ignore abort to prove late responses cannot restore stale UI.
   (window as any).completeModelTest=()=>resolve(Response.json({ok:true,model:'old-provider-model'}));
  }):original(input,init);
 });
 await setup(page);const dialog=await settings(page);await dialog.getByLabel('模型 API Key',{exact:true}).fill('old-key');
 await dialog.getByRole('button',{name:'测试连接',exact:true}).click();await expect.poll(()=>page.evaluate(()=>typeof (window as any).completeModelTest)).toBe('function');
 await dialog.getByLabel('Base URL',{exact:true}).fill('https://new.example.com/v1');
 await page.evaluate(async()=>{(window as any).completeModelTest();await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame)});
 await expect(dialog.getByRole('status')).toHaveCount(0);await expect(dialog.getByLabel('模型 API Key',{exact:true})).toHaveValue('');
 await dialog.getByLabel('模型 API Key',{exact:true}).fill('new-key');await expect(dialog.getByRole('button',{name:'测试连接',exact:true})).toBeEnabled();
});
test('mock: connection feedback follows interface language, including failures',async({page},testInfo)=>{
 await setup(page);const dialog=await settings(page);
 await dialog.getByLabel('模型 API Key').fill('browser-test-key');
 await dialog.getByRole('button',{name:'测试连接',exact:true}).click();
 const result=dialog.getByRole('status');
 await expect(result).toContainText('连接成功');await expect(result).toContainText('未请求生成内容');
 await choose(page,'界面语言','English');
 await expect(result).toContainText('Connected.');await expect(result).toContainText('no generation was requested');
 await saveScreenshot(page,'settings-connection-en',testInfo.project.name);
 await choose(page,'Interface language','简体中文');
 await saveScreenshot(page,'settings-connection-zh',testInfo.project.name);
 await page.route('**/api/models/test',r=>r.fulfill({status:401,json:{ok:false,model:'fixture-model',message:'The model API key was not accepted.'}}));
 await dialog.getByRole('button',{name:'测试连接',exact:true}).click();
 await expect(result).toContainText('密钥未被接受');await expect(result).not.toContainText('HTTP');
 await choose(page,'界面语言','English');
 await expect(result).toContainText('API key was not accepted');
 await page.route('**/api/models/test',r=>r.abort('failed'));
 await dialog.getByRole('button',{name:'Test connection',exact:true}).click();
 await expect(result).toContainText('Check your network');
});
test('mock: visual home, persisted preferences, key memory only, corpus status',async({page},testInfo)=>{
 await setup(page);await expect(page.getByRole('heading',{name:'从一个问题， 走进提瓦特'})).toBeVisible();await saveScreenshot(page,'home-light',testInfo.project.name);
 await configure(page);
 const dialog=await settings(page);await choose(page,'界面语言','English');await choose(page,'Source language','English sources');await choose(page,'Appearance','Dark');await dialog.getByRole('button',{name:'Close',exact:true}).click();
 await expect(page.locator('html')).toHaveAttribute('data-theme','dark');await expect(page.locator('html')).toHaveAttribute('lang','en');
 const storage=await page.evaluate(()=>JSON.stringify({...localStorage}));expect(storage).not.toContain('browser-test-key');expect(storage).not.toContain('apiKey');
 await page.reload();const after=await settings(page);await expect(after.getByLabel('Model API key')).toHaveValue('');await expect(after.getByRole('combobox',{name:'Appearance',exact:true})).toHaveText('Dark');await expect(after.getByRole('combobox',{name:'Source language',exact:true})).toHaveText('English sources');
 await after.getByRole('button',{name:'Corpus status',exact:true}).click();await expect(page.getByRole('dialog').getByText('Browser fixture (mock)',{exact:true})).toBeVisible();await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();
});
test('mock: source-backed stream, citations focus, regenerate and edit branches',async({page},testInfo)=>{
 await setup(page);await configure(page);let calls=0;
 await page.route('**/api/chat',async r=>{calls++;expect(r.request().headers()['x-model-api-key']).toBe('browser-test-key');const req=r.request().postDataJSON();expect(req.messages.at(-1).role).toBe('user');await r.fulfill({contentType:'text/event-stream',body:frame('status',{stage:'reading'})+frame('sources',{sources:[source],snapshotId:'fixture-snapshot'})+frame('text_delta',{text:'## 明确记载\n浏览器隔离测试回答 [1]。\n\n'})+frame('text_delta',{text:'这段内容来自测试夹具，绝不代表真实模型回答。'})+frame('done',{snapshotId:'fixture-snapshot',finishReason:'stop'})})});
 await page.getByRole('textbox',{name:'向虚空提问…'}).fill('浏览器测试问题');await page.getByRole('button',{name:'发送',exact:true}).click();await expect(page.getByText('这段内容来自测试夹具，绝不代表真实模型回答。')).toBeVisible();await expect(page.getByRole('button',{name:'重新生成',exact:true})).toBeVisible();
 const citation=page.locator('.inline-citation');await citation.click();const drawer=page.getByRole('dialog');await expect(drawer.getByText(source.text,{exact:true}).first()).toBeVisible();await expect(drawer.getByText('fixture-snapshot',{exact:true})).toBeVisible();await saveScreenshot(page,'chat-source',testInfo.project.name);await page.keyboard.press('Escape');await expect(citation).toBeFocused();
 const d=await settings(page);await choose(page,'外观','深色');await d.getByRole('button',{name:'关闭',exact:true}).click();await saveScreenshot(page,'chat-dark',testInfo.project.name);await citation.click();await expect(page.getByRole('dialog').getByRole('heading',{name:'上下文',exact:true})).toBeVisible();await saveScreenshot(page,'chat-source-dark',testInfo.project.name);await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'重新生成',exact:true}).click();await expect.poll(()=>calls).toBe(2);await expect(page.getByRole('button',{name:'重新生成',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'编辑并分支',exact:true}).click();await page.locator('.edit-box textarea').fill('修改后的测试问题');await page.locator('.edit-box').getByRole('button',{name:'编辑并分支',exact:true}).click();await expect.poll(()=>calls).toBe(3);await expect(page.locator('.message.user').getByText('修改后的测试问题',{exact:true})).toBeVisible();
 const stored=await page.evaluate(async()=>{const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('void-terminal',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});return await new Promise<any[]>((resolve,reject)=>{const r=db.transaction('conversations').objectStore('conversations').getAll();r.onsuccess=()=>{resolve(r.result);db.close()};r.onerror=()=>reject(r.error)})});expect(stored.length).toBe(3);expect(stored.filter(c=>c.parentId).length).toBe(2);expect(stored.some(c=>c.messages[0].content==='浏览器测试问题')).toBe(true);expect(JSON.stringify(stored)).not.toContain('browser-test-key');
});
test('mock: loading cancellation and provider errors remain explicit',async({page})=>{
 await setup(page);await configure(page);let requestStarted=false,release:()=>void=()=>{};
 await page.route('**/api/chat',async r=>{requestStarted=true;await new Promise<void>(resolve=>{release=resolve});try{await r.fulfill({contentType:'text/event-stream',body:frame('done',{snapshotId:'fixture-snapshot',finishReason:'stop'})})}catch{}});
 await page.getByRole('textbox',{name:'向虚空提问…'}).fill('取消测试');await page.getByRole('button',{name:'发送',exact:true}).click();await expect.poll(()=>requestStarted).toBe(true);await expect(page.getByRole('button',{name:'停止生成'})).toBeVisible();await page.getByRole('button',{name:'停止生成'}).click();await expect(page.getByText('已停止生成',{exact:true}).first()).toBeVisible();release();
 await page.unroute('**/api/chat');await page.route('**/api/chat',r=>r.fulfill({status:503,json:{error:{code:'UPSTREAM_UNAVAILABLE',message:'Mock provider is unavailable'}}}));await page.getByRole('button',{name:'重新生成',exact:true}).click();await expect(page.locator('.chat-bottom').getByRole('alert')).toHaveText('模型服务暂时不可用，请稍后重试。');
});
test('mock: library filtering, document reading and selected-passage question',async({page},testInfo)=>{
 await setup(page);await library(page);await expect(page.getByRole('heading',{name:source.title})).toBeVisible();await saveScreenshot(page,'library-light',testInfo.project.name);await page.getByRole('textbox',{name:'搜索书籍、任务或关键词…'}).fill('absent');await expect(page.getByRole('heading',{name:'暂无匹配的原文'})).toBeVisible();await page.getByRole('textbox',{name:'搜索书籍、任务或关键词…'}).fill('');await page.getByRole('button',{name:/Browser fixture · 原文/}).click();await expect(page.locator('.reading-text')).toContainText(source.text);
 await page.locator('.reading-text p').first().evaluate(el=>{const range=document.createRange();range.selectNodeContents(el);const selection=window.getSelection();selection?.removeAllRanges();selection?.addRange(range);el.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}))});await expect(page.getByRole('button',{name:'询问这段原文'})).toBeVisible();await saveScreenshot(page,'reading-light',testInfo.project.name);await page.getByRole('button',{name:'询问这段原文'}).click();await expect(page.getByRole('textbox',{name:'继续追问…'})).toHaveValue(/浏览器隔离测试原文/);
});
test('mock: long game strings have readable bounded titles and an exact raw-text view',async({page},testInfo)=>{
 await setup(page);
 const raw='#<color=#D3BC8EFF>【活动规则】</color>\\n'+('活动期间，旅行者可以领取对应奖励。\\n'.repeat(45));
 const item={id:'raw-1',title:raw,type:'other',language:'zh-CN',excerpt:raw,snapshotId:'fixture-snapshot',metadata:{kind:'orphan_textmap',contextUnknown:true}};
 await page.route('**/api/library?*',r=>r.fulfill({json:{items:[item],total:1,page:1,pageSize:24,snapshotId:'fixture-snapshot'}}));
 await page.route('**/api/documents/raw-1?*',r=>r.fulfill({json:{document:{...item,text:raw,source:{repo:'fixture',commit:'fixture',path:'TextMap/TextMapCHS.json',locator:'/100',url:'https://example.com/source'},relations:[]},sources:[],snapshotId:'fixture-snapshot'}}));
 await library(page);
 const card=page.locator('.document-card');await expect(card.getByRole('heading')).toHaveText('活动规则');
 await expect(card).not.toContainText('<color');
 expect(await card.locator('h2').evaluate(el=>el.getBoundingClientRect().height)).toBeLessThan(70);
 expect(await page.locator('.library-content').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
 await saveScreenshot(page,'library-readable-titles',testInfo.project.name);
 await card.click();await expect(page.locator('.reading-text')).not.toContainText('<color');
 await page.getByRole('button',{name:'原始文本',exact:true}).click();await expect(page.locator('.reading-text')).toHaveText(raw);
 await page.getByRole('button',{name:'阅读排版',exact:true}).click();await expect(page.locator('.reading-text')).toContainText('活动期间');
 await expect(page.locator('.library-content .context-warning')).toBeVisible();
 await saveScreenshot(page,'reading-game-text',testInfo.project.name);
 if(testInfo.project.name==='desktop')for(const width of [651,768,1024]){
  await page.setViewportSize({width,height:900});
  expect(await page.locator('.library-content').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 }
});
test('mock: unavailable service never renders invented coverage',async({page})=>{
 await page.route('**/api/status',r=>r.fulfill({json:{ready:false,provider:{model:'configured-model',sharedEnabled:false,byok:true},error:{code:'KNOWLEDGE_UNAVAILABLE',message:'Mock knowledge service unavailable'}}}));await page.goto('/');const d=await settings(page);await d.getByRole('button',{name:'数据状态',exact:true}).click();const statusDialog=page.getByRole('dialog');await expect(statusDialog.getByText('Mock knowledge service unavailable',{exact:true})).toBeVisible();await expect(statusDialog.getByText('尚未就绪',{exact:true})).toBeVisible();
});

test('mock: paced browser stream respects manual scroll and cancels mid-answer',async({page})=>{
 await page.addInitScript(()=>{
  const original=window.fetch.bind(window);
  window.fetch=async(input,init)=>{
   if(String(input)!=='/api/chat')return original(input,init);
   const encoder=new TextEncoder();let timer:ReturnType<typeof setInterval>;
   const stream=new ReadableStream<Uint8Array>({start(controller){
    const emit=(event:string,data:unknown)=>controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
    emit('text_delta',{text:Array.from({length:65},(_,i)=>`隔离流式测试段落 ${i+1}。\n\n`).join('')});
    timer=setInterval(()=>emit('text_delta',{text:'新的流式片段。\n\n'}),180);
    init?.signal?.addEventListener('abort',()=>{clearInterval(timer);controller.error(new DOMException('Aborted','AbortError'))},{once:true});
   },cancel(){clearInterval(timer)}});
   return new Response(stream,{headers:{'Content-Type':'text/event-stream'}});
  };
 });
 await setup(page);await configure(page);await page.getByRole('textbox',{name:'向虚空提问…'}).fill('滚动测试');await page.getByRole('button',{name:'发送',exact:true}).click();await expect(page.getByText('隔离流式测试段落 65。',{exact:true})).toBeVisible();
 const scroll=page.locator('.chat-scroll');await scroll.evaluate(el=>{el.scrollTop=0;el.dispatchEvent(new Event('scroll'))});await expect.poll(()=>scroll.evaluate(el=>el.scrollTop)).toBe(0);const count=await page.locator('.markdown p').count();await expect.poll(()=>page.locator('.markdown p').count()).toBeGreaterThan(count+1);expect(await scroll.evaluate(el=>el.scrollTop)).toBe(0);await page.getByRole('button',{name:'回到最新回答 ↓',exact:true}).click();await expect.poll(()=>scroll.evaluate(el=>el.scrollTop)).toBeGreaterThan(0);
 await page.getByRole('button',{name:'停止生成',exact:true}).click();await expect(page.getByRole('button',{name:'重新生成',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'停止生成',exact:true})).toHaveCount(0);
});

test('mock: conversation remains pinned when active corpus changes, including regenerate and edit',async({page})=>{
 await setup(page);await configure(page);const requests:any[]=[];
 await page.route('**/api/chat',r=>{requests.push(r.request().postDataJSON());return r.fulfill({contentType:'text/event-stream',body:frame('sources',{sources:[{...source,snapshotId:'snapshot-v1'}],snapshotId:'snapshot-v1'})+frame('text_delta',{text:'隔离快照测试回答 [1]。'})+frame('done',{snapshotId:'snapshot-v1',finishReason:'stop'})})});
 await page.getByRole('textbox',{name:'向虚空提问…'}).fill('快照第一问');await page.getByRole('button',{name:'发送',exact:true}).click();await expect(page.getByRole('button',{name:'重新生成',exact:true})).toBeVisible();
 await page.route('**/api/status',r=>r.fulfill({json:{...status,activeSnapshot:{...status.activeSnapshot,id:'snapshot-v2',label:'Active snapshot v2'}}}));const d=await settings(page);await d.getByRole('button',{name:'数据状态',exact:true}).click();const sd=page.getByRole('dialog');await sd.getByRole('button',{name:'重试',exact:true}).click();await expect(sd.getByText('Active snapshot v2',{exact:true})).toBeVisible();await sd.getByRole('button',{name:'关闭',exact:true}).click();
 await page.getByRole('textbox',{name:'继续追问…'}).fill('快照追问');await page.getByRole('button',{name:'发送',exact:true}).click();await expect.poll(()=>requests.length).toBe(2);expect(requests[1].snapshotId).toBe('snapshot-v1');await expect(page.getByRole('button',{name:'重新生成',exact:true})).toHaveCount(2);
 await page.getByRole('button',{name:'重新生成',exact:true}).last().click();await expect.poll(()=>requests.length).toBe(3);expect(requests[2].snapshotId).toBe('snapshot-v1');await expect(page.getByRole('button',{name:'重新生成',exact:true})).toHaveCount(2);
 await page.getByRole('button',{name:'编辑并分支',exact:true}).first().click();await page.locator('.edit-box textarea').fill('编辑首问仍应保留快照');await page.locator('.edit-box').getByRole('button',{name:'编辑并分支',exact:true}).click();await expect.poll(()=>requests.length).toBe(4);expect(requests[3].snapshotId).toBe('snapshot-v1');
});
test('mock: original dialogue relation conditions and related records open exact snapshot',async({page})=>{
 await setup(page);await library(page);await page.getByRole('button',{name:/Browser fixture · 原文/}).click();await page.locator('.reading-assistant .source-mini').click();await page.getByRole('dialog').getByRole('button',{name:'Browser fixture · 下一段',exact:true}).click();await expect(page.getByRole('heading',{name:'Browser fixture · 下一段'})).toBeVisible();await page.locator('.back-link').click();await page.getByRole('button',{name:/Browser fixture · 原文/}).click();const relations=page.locator('.record-relations');await expect(relations.getByText('条件原文',{exact:true})).toBeVisible();await expect(relations.locator('code')).toHaveText('questState == 3');
 const nextRequest=page.waitForRequest(r=>r.url().includes('/api/documents/book-2?'));await relations.getByRole('button',{name:/下一段/}).click();expect(new URL((await nextRequest).url()).searchParams.get('snapshotId')).toBe('fixture-snapshot');await expect(page.getByRole('heading',{name:'Browser fixture · 下一段'})).toBeVisible();
});

test('mock: English UI answers remain separate from Chinese source language',async({page})=>{
 await setup(page);await configure(page);const d=await settings(page);await choose(page,'界面语言','English');await expect(d.getByRole('combobox',{name:'Source language',exact:true})).toHaveText('Chinese sources');await d.getByRole('button',{name:'Close',exact:true}).click();let payload:any;
 await page.route('**/api/chat',r=>{payload=r.request().postDataJSON();return r.fulfill({contentType:'text/event-stream',body:frame('text_delta',{text:'English fixture interpretation, not official localization.'})+frame('done',{snapshotId:'fixture-snapshot',finishReason:'stop'})})});
 await page.getByRole('textbox',{name:'Ask the Akasha…'}).fill('Explain this Chinese source in English');await page.getByRole('button',{name:'Send',exact:true}).click();await expect(page.getByText('English fixture interpretation, not official localization.',{exact:true})).toBeVisible();expect(payload.language).toBe('zh-CN');expect(payload.answerLanguage).toBe('en');
});

for(const failureMode of ['http','stream'] as const){
 test(`mock: ${failureMode} chat error appears only above composer and follows interface language`,async({page},testInfo)=>{
  await setup(page);await configure(page);
  const failure={code:'NOT_FOUND',message:'The requested evidence was not found.',retryable:true};
  await page.route('**/api/chat',r=>failureMode==='http'?r.fulfill({status:404,json:{error:failure}}):r.fulfill({contentType:'text/event-stream',body:frame('text_delta',{text:'已经生成的部分回答。'})+frame('error',failure)}));
  await page.getByRole('textbox',{name:'向虚空提问…'}).fill('错误显示测试');await page.getByRole('button',{name:'发送',exact:true}).click();
  const alert=page.locator('.chat-bottom').getByRole('alert');
  await expect(alert).toHaveText('未找到请求的原文，请重新检索或重试。');
  await expect(page.locator('.message.assistant .inline-error')).toHaveCount(0);
  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(1);
  if(failureMode==='stream'){
   await expect(page.locator('.markdown')).toContainText('已经生成的部分回答。');
   await saveScreenshot(page,'chat-error-zh',testInfo.project.name);
  }
  const dialog=await settings(page);await choose(page,'界面语言','English');await dialog.getByRole('button',{name:'Close',exact:true}).click();
  await expect(alert).toHaveText('The requested source could not be found. Search again or retry.');
  if(failureMode==='stream')await saveScreenshot(page,'chat-error-en',testInfo.project.name);
  await page.reload();const menu=page.getByRole('button',{name:'Menu',exact:true});if(await menu.isVisible())await menu.click();
  await page.getByRole('button',{name:'错误显示测试',exact:true}).click();
  await expect(alert).toHaveText('The requested source could not be found. Search again or retry.');
  await expect(page.locator('.message.assistant .inline-error')).toHaveCount(0);
 });
}
