import {test,expect,type Page,type TestInfo} from '@playwright/test';
import path from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';

const artifacts=path.resolve(process.cwd(),'../../artifacts/deployment-modes');
const frame=(event:string,data:unknown)=>`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const source={id:'mode-source',documentId:'mode-book',title:'部署模式测试原文',type:'book',language:'zh-CN',text:'用于验证来源按钮的隔离资料。',path:'fixture/book.json',locator:'line:1',sourceUrl:'https://example.test/source',snapshotId:'mode-fixture',citation:1};
const accountFixture={enabled:true,authenticated:true,user:{id:'mode-user',email:'fixture@example.test'},credits:{available:20,held:0,totalGranted:20},trialCredits:20,costs:{standard:1,deep:3},usage:[]};
const modeOf=(info:TestInfo)=>info.project.metadata.deploymentMode as 'self-hosted'|'hosted';

async function navigate(page:Page,name:string){
 const menu=page.getByRole('button',{name:'Menu',exact:true});if(await menu.isVisible())await menu.click();
 await page.getByRole('button',{name,exact:true}).click();
}
async function settings(page:Page){await navigate(page,'设置');return page.getByRole('dialog',{name:'设置',exact:true})}
async function seedPreferences(page:Page,mode:'shared'|'byok'){
 await page.addInitScript(mode=>localStorage.setItem('void.preferences',JSON.stringify({theme:'light',locale:'zh-CN',sourceLanguage:'zh-CN',mode,modelBaseUrl:'https://stale.example.test/v1',modelName:'legacy-model'})),mode);
}
async function noOverflow(page:Page){expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true)}
async function screenshot(page:Page,info:TestInfo,name:string){
 await mkdir(artifacts,{recursive:true});const filename=path.join(artifacts,`${info.project.name}-${name}.png`);
 await page.screenshot({path:filename,fullPage:true,scale:'css',animations:'disabled'});await info.attach(name,{path:filename,contentType:'image/png'});
}
async function expectFixedSettings(page:Page,hosted:boolean){
 const dialog=await settings(page);
 await expect(dialog.getByRole('combobox',{name:'模型连接',exact:true})).toHaveCount(0);
 await expect(dialog.getByLabel('模型 API Key')).toHaveCount(hosted?0:1);
 await expect(dialog.getByLabel('Base URL',{exact:true})).toHaveCount(hosted?0:1);
 await expect(dialog.getByRole('button',{name:'测试连接',exact:true})).toHaveCount(1);
 await expect(dialog.getByRole('button',{name:'清除密钥',exact:true})).toHaveCount(hosted?0:1);
 await noOverflow(page);return dialog;
}

test('runtime: status and forbidden transport remain fixed when knowledge and account services are unavailable',async({request},info)=>{
 const mode=modeOf(info),hosted=mode==='hosted';
 // This request bypasses all page route mocks and reaches the actual runtime.
 const response=await request.get('/api/status');expect(response.status()).toBe(503);
 const status=await response.json();expect(status).toMatchObject({ready:false,deployment:{mode},provider:{byok:!hosted,sharedEnabled:false}});
 const forbiddenMode=hosted?'byok':'shared';
 for(const endpoint of ['/api/chat','/api/models/test']){
  const body=endpoint.endsWith('/chat')?{mode:forbiddenMode,messages:[{role:'user',content:'No provider call is allowed'}],language:'zh-CN',depth:'standard',provider:{baseUrl:'http://127.0.0.1:9',model:'injected'}}:{mode:forbiddenMode,provider:{baseUrl:'http://127.0.0.1:9',model:'injected'}};
  const denied=await request.post(endpoint,{headers:{'X-Model-Api-Key':'must-not-be-used'},data:body});expect(denied.status()).toBe(403);expect(await denied.json()).toMatchObject(endpoint.endsWith('/chat')?{error:{code:'MODE_NOT_ALLOWED'}}:{ok:false,code:'MODE_NOT_ALLOWED'});
 }
 const account=await request.get('/api/account');expect(await account.json()).toMatchObject({enabled:false,authenticated:false});
});

for(const entrypoint of ['/','/museum','/characters'])test(`runtime: ${entrypoint} renders its deployment mode with stale preferences and unavailable status`,async({page},info)=>{
 const hosted=modeOf(info)==='hosted';await seedPreferences(page,hosted?'byok':'shared');
 await page.route('**/api/items?*',r=>r.fulfill({json:{items:[],total:0,page:1,pageSize:48,snapshotId:null,ready:false,counts:{}}}));
 await page.route('**/api/characters?*',r=>r.fulfill({json:{items:[],total:0,page:1,pageSize:48,snapshotId:null,ready:false,counts:{}}}));
 let accountRequests=0;page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/account'))accountRequests++});
 await page.goto(entrypoint);const dialog=await expectFixedSettings(page,hosted);
 await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('void.preferences')||'{}').mode)).toBe(hosted?'shared':'byok');
 if(entrypoint==='/')await screenshot(page,info,'settings-unavailable');
 await expect(page.locator('.sidebar .account-nav')).toHaveCount(hosted?1:0);
 if(hosted){await dialog.getByRole('button',{name:'登录',exact:true}).click();await expect(page.getByRole('dialog',{name:'账户与额度',exact:true})).toContainText('账户服务暂未开放')}
 else {await dialog.getByRole('button',{name:'关闭',exact:true}).click();expect(accountRequests).toBe(0)}
 await noOverflow(page);
});

test('self-hosted: a failed account endpoint is never fetched and the first draft/key can be used immediately',async({page},info)=>{
 test.skip(modeOf(info)!=='self-hosted');await seedPreferences(page,'shared');
 let accountCalls=0;const models:Array<{headers:Record<string,string>;body:any}>=[],chats:Array<{headers:Record<string,string>;body:any}>=[];
 await page.route('**/api/account',r=>{accountCalls++;return r.abort('failed')});
 await page.route('**/api/auth/**',r=>{accountCalls++;return r.abort('failed')});
 await page.route('**/api/models/test',r=>{models.push({headers:r.request().headers(),body:r.request().postDataJSON()});return r.fulfill({json:{ok:true,model:'fixture-model'}})});
 await page.route('**/api/chat',r=>{chats.push({headers:r.request().headers(),body:r.request().postDataJSON()});return r.fulfill({contentType:'text/event-stream',body:frame('text_delta',{text:'无需账户服务的自托管回答。'})+frame('done',{snapshotId:'mode-fixture',finishReason:'stop'})})});
 await page.goto('/');const question=page.locator('#question');await question.fill('自托管首条草稿');
 const dialog=await expectFixedSettings(page,false);await dialog.getByLabel('模型 API Key').fill('self-hosted-fixture-key');await dialog.getByRole('button',{name:'测试连接',exact:true}).click();await expect(dialog.getByRole('status')).toContainText('连接成功');
 await page.evaluate(()=>{window.dispatchEvent(new Event('focus'));document.dispatchEvent(new Event('visibilitychange'));const channel=new BroadcastChannel('void-account');channel.postMessage({type:'changed'});channel.close()});
 await expect(dialog.getByLabel('模型 API Key')).toHaveValue('self-hosted-fixture-key');await dialog.getByRole('button',{name:'关闭',exact:true}).click();await expect(question).toHaveValue('自托管首条草稿');
 await page.getByRole('button',{name:'发送',exact:true}).click();await expect(page.locator('.markdown')).toContainText('无需账户服务的自托管回答。');
 expect(accountCalls).toBe(0);expect(models).toHaveLength(1);expect(chats).toHaveLength(1);
 for(const request of [...models,...chats]){expect(request.body.mode).toBe('byok');expect(request.headers['x-model-api-key']).toBe('self-hosted-fixture-key')}
 expect(await page.evaluate(()=>JSON.stringify({...localStorage}))).not.toContain('self-hosted-fixture-key');
 await screenshot(page,info,'byok-without-account');
});

test('hosted: stale BYOK settings cannot add a provider or key to a shared chat',async({page},info)=>{
 test.skip(modeOf(info)!=='hosted');await seedPreferences(page,'byok');
 await page.route('**/api/account',r=>r.fulfill({json:accountFixture}));
 await page.route('**/api/status',r=>r.fulfill({json:{ready:true,deployment:{mode:'hosted'},provider:{model:'fixture-model',sharedEnabled:true,byok:false}}}));
 let sent:{headers:Record<string,string>;body:any}|undefined;
 await page.route('**/api/chat',r=>{sent={headers:r.request().headers(),body:r.request().postDataJSON()};return r.fulfill({contentType:'text/event-stream',body:frame('text_delta',{text:'固定官网模式的回答。'})+frame('done',{snapshotId:'mode-fixture',finishReason:'stop'})})});
 await page.goto('/');const dialog=await expectFixedSettings(page,true);await dialog.getByRole('button',{name:'关闭',exact:true}).click();
 await page.locator('#question').fill('旧偏好不能切换官网模式');await page.getByRole('button',{name:'发送',exact:true}).click();await expect(page.locator('.markdown')).toContainText('固定官网模式的回答。');
 expect(sent!.body.mode).toBe('shared');expect(sent!.body).not.toHaveProperty('provider');expect(sent!.body).not.toHaveProperty('apiKey');expect(sent!.headers['x-model-api-key']).toBeUndefined();await noOverflow(page);
});

test('conversation: compact controls keep readable content and usable mobile hit targets',async({page},info)=>{
 const hosted=modeOf(info)==='hosted';await seedPreferences(page,hosted?'byok':'shared');
 if(hosted)await page.route('**/api/account',r=>r.fulfill({json:accountFixture}));
 await page.route('**/api/status',r=>r.fulfill({json:{ready:true,deployment:{mode:hosted?'hosted':'self-hosted'},provider:{model:'fixture-model',sharedEnabled:hosted,byok:!hosted}}}));
 await page.route('**/api/chat',r=>r.fulfill({contentType:'text/event-stream',body:frame('sources',{sources:[source],snapshotId:'mode-fixture'})+frame('text_delta',{text:'## 考据结论\n\n这段测试回答保留原文引用 [1]。\n\n控件应紧凑，正文仍保持清晰可读。'})+frame('done',{snapshotId:'mode-fixture',finishReason:'stop'})}));
 await page.goto('/');
 if(!hosted){const dialog=await settings(page);await dialog.getByLabel('模型 API Key').fill('layout-fixture-key');await dialog.getByRole('button',{name:'关闭',exact:true}).click()}
 await page.locator('#question').fill('验证对话底部与来源控件');await page.getByRole('button',{name:'发送',exact:true}).click();await expect(page.getByRole('button',{name:'重新生成',exact:true})).toBeVisible();
 const metrics=await page.evaluate(()=>{
  const measure=(selector:string)=>{const el=document.querySelector<HTMLElement>(selector)!;const rect=el.getBoundingClientRect(),style=getComputedStyle(el);return {width:rect.width,height:rect.height,x:rect.x,y:rect.y,fontSize:parseFloat(style.fontSize),minHeight:style.minHeight,icon:el.querySelector('svg')?.getBoundingClientRect().width??null}};
  return {viewport:{width:innerWidth,height:innerHeight},composer:measure('.chat-bottom .composer'),textarea:measure('.chat-bottom textarea'),select:measure('.chat-bottom .select-trigger'),depth:measure('.chat-bottom .depth'),send:measure('.chat-bottom .send'),action:measure('.message-actions button'),sources:measure('.citations summary'),body:measure('.markdown')};
 });
 const mobile=page.viewportSize()!.width<=650;
 if(mobile){expect(metrics.textarea.fontSize).toBeGreaterThanOrEqual(16);for(const name of ['select','depth','send','action','sources'] as const)expect(metrics[name].height).toBeGreaterThanOrEqual(44)}
 else {expect(metrics.composer.height).toBeLessThan(90);expect(metrics.select.height).toBeLessThanOrEqual(34);expect(metrics.depth.height).toBeLessThanOrEqual(34);expect(metrics.send.height).toBeLessThanOrEqual(34);expect(metrics.sources.height).toBeLessThanOrEqual(32)}
 expect(metrics.body.fontSize).toBe(mobile?14:16);await noOverflow(page);
 await mkdir(artifacts,{recursive:true});await writeFile(path.join(artifacts,`${info.project.name}-control-metrics.json`),JSON.stringify(metrics,null,2));
 await page.locator('.chat-scroll').evaluate(el=>{el.scrollTop=el.scrollHeight;el.dispatchEvent(new Event('scroll'))});await screenshot(page,info,'compact-conversation');
 if(hosted&&mobile){
  await page.setViewportSize({width:320,height:640});const cost=page.locator('.chat-bottom .composer-cost');await expect(cost).toHaveText('本次 1 额度');await noOverflow(page);await screenshot(page,info,'narrow-standard');
  await page.getByRole('button',{name:'深入考据',exact:true}).click();await expect(cost).toHaveText('本次 3 额度');await noOverflow(page);await screenshot(page,info,'narrow-deep');
  await page.getByRole('button',{name:'中 / EN',exact:true}).click();await expect(cost).toHaveText('3 credits');await noOverflow(page);await screenshot(page,info,'narrow-deep-en');
  await navigate(page,'Settings');const dialog=page.getByRole('dialog',{name:'Settings',exact:true});await expect(dialog.getByLabel('Model API key')).toHaveCount(0);await expect(dialog.getByRole('button',{name:'View credits',exact:true})).toBeVisible();await noOverflow(page);expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);await screenshot(page,info,'narrow-settings-en');
 }
});
