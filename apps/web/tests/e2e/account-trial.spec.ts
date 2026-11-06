import {test,expect,type Page} from '@playwright/test';
import path from 'node:path';

const screenshots=path.resolve(process.cwd(),'../../artifacts/account-trial');
const status={ready:true,activeSnapshot:{id:'account-fixture',sourceRepo:'fixture',sourceCommit:'fixture',gameVersion:null,createdAt:'2026-11-06T00:00:00Z',label:'Account browser fixture',state:'ready'},documentCount:1,chunkCount:1,languages:['zh-CN','en'],retrieval:{lexical:true,semantic:false,model:null},coverage:[],provider:{model:'fixture-model',sharedEnabled:true,byok:true}};
const frame=(event:string,data:unknown)=>`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
type Usage={requestId:string;createdAt:string;depth:'standard'|'deep';units:number;status:'reserved'|'completed'|'released'|'expired';usedTokens:number|null;model:string};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function setup(page:Page,options:{enabled?:boolean;email?:string;theme?:'light'|'dark';mode?:'shared'|'byok';accountGate?:Promise<void>}={}){
 const state={enabled:options.enabled??true,email:options.email??'',available:20,held:0,usage:null as Usage[]|null,accountReads:0,accountError:false,sendCodes:[] as unknown[],verifyCodes:[] as unknown[],chatRequests:[] as {headers:Record<string,string>;body:any}[]};
 await page.addInitScript(({theme,mode})=>localStorage.setItem('void.preferences',JSON.stringify({theme,mode,locale:'zh-CN',sourceLanguage:'zh-CN'})),{theme:options.theme??'light',mode:options.mode??'shared'});
 await page.route('**/api/status',r=>r.fulfill({json:status}));
 await page.route('**/api/account',async r=>{
  state.accountReads++;if(options.accountGate)await options.accountGate;
  if(state.accountError)return r.fulfill({status:503,json:{error:{code:'ACCOUNT_UNAVAILABLE',message:'额度暂时无法读取，请重试。'}}});
  if(!state.enabled||!state.email)return r.fulfill({json:{enabled:state.enabled,authenticated:false}});
  return r.fulfill({json:{enabled:true,authenticated:true,user:{id:accountId(state.email),email:state.email},credits:{available:state.available,held:state.held,totalGranted:20},trialCredits:20,costs:{standard:1,deep:3},usage:state.usage??(state.available===20?[]:[{requestId:'00000000-0000-4000-8000-000000000001',createdAt:'2026-11-06T08:00:00Z',depth:'standard',units:1,status:'completed',usedTokens:92,model:'fixture-model'}])}});
 });
 await page.route('**/api/auth/send-code',r=>{state.sendCodes.push(r.request().postDataJSON());return r.fulfill({json:{ok:true}})});
 await page.route('**/api/auth/verify-code',r=>{
  const body=r.request().postDataJSON();state.verifyCodes.push(body);
  if(body.code!=='123456')return r.fulfill({status:401,json:{error:{code:'INVALID_OTP',message:'验证码无效或已过期，请重新输入。'}}});
  state.email=body.email;return r.fulfill({json:{ok:true}});
 });
 await page.route('**/api/auth/logout',r=>{state.email='';return r.fulfill({json:{ok:true}})});
 await page.route('**/api/models/test',r=>r.fulfill({json:{ok:true,model:'fixture-model'}}));
 await page.route('**/api/chat',async r=>{
  state.chatRequests.push({headers:r.request().headers(),body:r.request().postDataJSON()});state.available--;
  await r.fulfill({contentType:'text/event-stream',body:frame('text_delta',{text:'账户隔离测试回答。'})+frame('done',{snapshotId:'account-fixture',finishReason:'stop'})});
 });
 await page.goto('/');
 await expect.poll(()=>state.accountReads).toBeGreaterThan(0);
 return state;
}
function accountId(email:string){return 'account-'+email.split('@')[0]}
async function navigation(page:Page,name:string){const menu=page.getByRole('button',{name:'Menu',exact:true});if(page.viewportSize()!.width<=650)await menu.click();await page.getByRole('button',{name,exact:true}).click()}
async function account(page:Page){await navigation(page,'账户与额度');const dialog=page.getByRole('dialog',{name:'账户与额度',exact:true});await expect(dialog).toBeVisible();return dialog}
async function closeAccount(page:Page){await page.getByRole('dialog',{name:'账户与额度',exact:true}).getByRole('button',{name:'关闭',exact:true}).click()}
async function signIn(page:Page,email:string){const dialog=page.getByRole('dialog',{name:'账户与额度',exact:true});await dialog.getByLabel('邮箱',{exact:true}).fill(email);await dialog.getByRole('button',{name:'发送验证码',exact:true}).click();await dialog.getByLabel('验证码',{exact:true}).fill('123456');await dialog.getByRole('button',{name:'验证并登录',exact:true}).click();await expect(dialog).toContainText(email);await expect(dialog).toContainText('可用额度')}
async function screenshot(page:Page,name:string,project:string){await page.screenshot({path:path.join(screenshots,`${project}-${name}.png`),fullPage:true,scale:'css',animations:'disabled',style:'nextjs-portal{visibility:hidden}'})}
async function seedHistory(page:Page){
 await page.evaluate(async()=>{
  async function seed(databaseName:string,title:string){await new Promise<void>((resolve,reject)=>{const request=indexedDB.open(databaseName,1);request.onupgradeneeded=()=>request.result.createObjectStore('conversations',{keyPath:'id'});request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction('conversations','readwrite');tx.objectStore('conversations').put({id:title,title,updatedAt:Date.now(),messages:[{role:'user',content:title},{role:'assistant',content:title+'私有正文'}]});tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>reject(tx.error)}})}
  await seed('void-terminal','访客旧对话');await seed('void-terminal:account:account-alice','Alice 私有对话');await seed('void-terminal:account:account-bob','Bob 私有对话');
 });
}

for(const theme of ['light','dark'] as const){
 test(`account: email code validation, balance and recent usage (${theme})`,async({page},info)=>{
  const state=await setup(page,{theme});const dialog=await account(page);
  await screenshot(page,`account-login-${theme}`,info.project.name);
  await dialog.getByLabel('邮箱',{exact:true}).fill('alice@example.test');await dialog.getByRole('button',{name:'发送验证码',exact:true}).click();
  expect(state.sendCodes).toEqual([{email:'alice@example.test'}]);
  await dialog.getByLabel('验证码',{exact:true}).fill('000000');await dialog.getByRole('button',{name:'验证并登录',exact:true}).click();
  await expect(dialog.getByRole('alert')).toBeVisible();await expect(dialog.getByRole('button',{name:'验证并登录',exact:true})).toBeEnabled();
  await dialog.getByLabel('验证码',{exact:true}).fill('123456');await dialog.getByRole('button',{name:'验证并登录',exact:true}).click();
  await expect(dialog).toContainText('alice@example.test');await expect(dialog).toContainText('20');
  state.available=19;await dialog.getByRole('button',{name:'刷新额度',exact:true}).click();await expect(dialog).toContainText('19');await expect(dialog.getByRole('region',{name:'最近用量',exact:true})).toContainText('普通考据');await expect(dialog.getByRole('region',{name:'最近用量',exact:true})).toContainText('已完成');
  const box=await dialog.boundingBox(),viewport=page.viewportSize()!;expect(box).not.toBeNull();expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(viewport.width);expect(box!.y).toBeGreaterThanOrEqual(0);expect(box!.y+box!.height).toBeLessThanOrEqual(viewport.height);
  await screenshot(page,`account-balance-${theme}`,info.project.name);
  await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(page.getByRole('button',{name:page.viewportSize()!.width<=650?'Menu':'账户与额度',exact:true})).toBeFocused();
  const storage=await page.evaluate(()=>({local:Object.fromEntries(Object.entries(localStorage)),session:Object.fromEntries(Object.entries(sessionStorage))}));expect(JSON.stringify(storage)).not.toMatch(/123456|alice@example|access_token|refresh_token|supabase/i);
 });
}

test('account: unauthenticated shared send opens sign-in without calling the model',async({page})=>{
 const state=await setup(page);await page.getByRole('textbox',{name:'向虚空提问…',exact:true}).fill('需要登录的共享提问');await page.getByRole('button',{name:'发送',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'账户与额度',exact:true})).toBeVisible();expect(state.chatRequests).toHaveLength(0);
});

test('account: shared sends have fresh request IDs and refresh credits after completion',async({page})=>{
 const state=await setup(page,{email:'alice@example.test'});const initialReads=state.accountReads;
 await page.getByRole('textbox',{name:'向虚空提问…',exact:true}).fill('第一条共享问题');await page.getByRole('button',{name:'发送',exact:true}).click();await expect(page.locator('.markdown').last()).toHaveText('账户隔离测试回答。');
 await expect.poll(()=>state.accountReads).toBeGreaterThan(initialReads);await expect(page.getByRole('button',{name:'停止生成',exact:true})).toHaveCount(0);
 await page.getByRole('textbox',{name:'继续追问…',exact:true}).fill('第二条共享问题');await page.getByRole('button',{name:'发送',exact:true}).click();await expect.poll(()=>state.chatRequests.length).toBe(2);await expect(page.getByRole('button',{name:'停止生成',exact:true})).toHaveCount(0);
 const ids=state.chatRequests.map(r=>r.headers['x-request-id']);expect(ids.every(id=>uuid.test(id))).toBe(true);expect(new Set(ids).size).toBe(2);
 for(const request of state.chatRequests){expect(request.headers['x-model-api-key']).toBeUndefined();expect(request.body).toMatchObject({mode:'shared'});expect(request.body).not.toHaveProperty('accountId');expect(request.body).not.toHaveProperty('apiKey');expect(request.body).not.toHaveProperty('provider')}
 const dialog=await account(page);await expect(dialog).toContainText('18');
});

test('account: identity switches isolate histories, clear the current conversation and in-memory key',async({page})=>{
 await setup(page,{mode:'byok'});await seedHistory(page);await page.reload();
 const histories=page.locator('.sidebar .history-row');await expect(histories.filter({hasText:'访客旧对话'})).toHaveCount(1);await expect(histories.filter({hasText:'Alice 私有对话'})).toHaveCount(0);
 await navigation(page,'设置');let settings=page.getByRole('dialog',{name:'设置',exact:true});await settings.getByLabel('模型 API Key').fill('do-not-retain-this-key');await settings.getByRole('button',{name:'关闭',exact:true}).click();
 await account(page);await signIn(page,'alice@example.test');await closeAccount(page);await expect(histories.filter({hasText:'Alice 私有对话'})).toHaveCount(1);await expect(histories.filter({hasText:'访客旧对话'})).toHaveCount(0);await expect(histories.filter({hasText:'Bob 私有对话'})).toHaveCount(0);
 await navigation(page,'设置');settings=page.getByRole('dialog',{name:'设置',exact:true});await expect(settings.getByLabel('模型 API Key')).toHaveValue('');await settings.getByRole('button',{name:'关闭',exact:true}).click();
 await navigation(page,'Alice 私有对话');await expect(page.locator('.markdown')).toContainText('Alice 私有对话私有正文');
 let dialog=await account(page);await dialog.getByRole('button',{name:'登出',exact:true}).click();await expect(dialog.getByLabel('邮箱',{exact:true})).toBeVisible();await expect(page.locator('.markdown')).toHaveCount(0);await expect(histories.filter({hasText:'Alice 私有对话'})).toHaveCount(0);
 await signIn(page,'bob@example.test');await closeAccount(page);await expect(histories.filter({hasText:'Bob 私有对话'})).toHaveCount(1);await expect(histories.filter({hasText:'Alice 私有对话'})).toHaveCount(0);await expect(histories.filter({hasText:'访客旧对话'})).toHaveCount(0);
 dialog=await account(page);await dialog.getByRole('button',{name:'登出',exact:true}).click();await closeAccount(page);await expect(histories.filter({hasText:'访客旧对话'})).toHaveCount(1);await expect(histories.filter({hasText:'Bob 私有对话'})).toHaveCount(0);
});

test('account: a failed balance refresh gives a recoverable error without fabricating zero credits',async({page})=>{
 const state=await setup(page,{email:'alice@example.test'});const dialog=await account(page);await expect(dialog).toContainText('20');state.accountError=true;
 await dialog.getByRole('button',{name:'刷新额度',exact:true}).click();await expect(dialog.getByRole('alert')).toBeVisible();await expect(dialog).toContainText('alice@example.test');
 state.accountError=false;state.available=17;await dialog.getByRole('button',{name:/^(刷新额度|重试)$/}).first().click();await expect(dialog).toContainText('17');await expect(dialog.getByRole('alert')).toHaveCount(0);
});

test('account: disabled trial has no account navigation control and BYOK remains available',async({page})=>{
 await setup(page,{enabled:false,mode:'byok'});await expect(page.getByRole('button',{name:'账户与额度',exact:true})).toHaveCount(0);
 await navigation(page,'设置');const dialog=page.getByRole('dialog',{name:'设置',exact:true});await expect(dialog.getByLabel('模型 API Key')).toBeVisible();await dialog.getByLabel('模型 API Key').fill('local-fixture-key');await dialog.getByRole('button',{name:'测试连接',exact:true}).click();await expect(dialog.getByRole('status')).toContainText('连接成功');
});

test('account: signing out during a shared request aborts it and cannot restore the previous conversation',async({page})=>{
 await setup(page,{email:'alice@example.test'});
 let release!:()=>void;const delayed=new Promise<void>(resolve=>{release=resolve});let dispatched=false;let aborted=false;
 page.on('requestfailed',request=>{if(new URL(request.url()).pathname==='/api/chat')aborted=true});
 await page.route('**/api/chat',async r=>{dispatched=true;await delayed;await r.fulfill({contentType:'text/event-stream',body:frame('text_delta',{text:'Alice 延迟的私有回答'})+frame('done',{snapshotId:'account-fixture',finishReason:'stop'})}).catch(()=>{})});
 await page.getByRole('textbox',{name:'向虚空提问…',exact:true}).fill('Alice 尚未完成的问题');await page.getByRole('button',{name:'发送',exact:true}).click();await expect.poll(()=>dispatched).toBe(true);
 const dialog=await account(page);await dialog.getByRole('button',{name:'登出',exact:true}).click();await expect(dialog.getByLabel('邮箱',{exact:true})).toBeVisible();await expect.poll(()=>aborted).toBe(true);await signIn(page,'bob@example.test');release();await closeAccount(page);
 await expect(page.getByRole('button',{name:'停止生成',exact:true})).toHaveCount(0);await expect(page.locator('.markdown')).toHaveCount(0);await expect(page.getByRole('textbox',{name:'向虚空提问…',exact:true})).toHaveValue('');await expect(page.locator('.sidebar .history-row').filter({hasText:'Alice 尚未完成的问题'})).toHaveCount(0);
 await page.reload();await expect(page.locator('.sidebar .history-row').filter({hasText:'Alice 尚未完成的问题'})).toHaveCount(0);await expect(page.locator('.markdown')).toHaveCount(0);
});

test('account: usage distinguishes held, released, expired and unknown token charges without mobile overflow',async({page},info)=>{
 const state=await setup(page,{email:'alice@example.test',theme:'dark'});state.available=16;state.held=3;
 const longModel='organization/research-model-with-a-long-provider-identifier-'.repeat(4);
 state.usage=(['reserved','released','expired','completed'] as const).map((status,index)=>({requestId:`00000000-0000-4000-8000-00000000000${index+1}`,createdAt:`2026-11-06T0${8-index}:00:00Z`,depth:index===0?'deep':'standard',units:index===0?3:1,status,usedTokens:null,model:longModel}));
 const dialog=await account(page);await dialog.getByRole('button',{name:'刷新额度',exact:true}).click();
 const usage=dialog.getByRole('region',{name:'最近用量',exact:true});await expect(usage.getByRole('listitem')).toHaveCount(4);
 await expect(usage).toContainText('处理中 · 暂占 3 额度');await expect(usage).toContainText('已返还 · 未扣额度');await expect(usage).toContainText('已返还（超时） · 未扣额度');await expect(usage).toContainText('已完成 · −1 额度');await expect(usage).toContainText('用量未知');await expect(usage.getByText('用量未知',{exact:false})).toHaveCount(1);
 expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);const box=await dialog.boundingBox(),viewport=page.viewportSize()!;expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(viewport.width);expect(box!.y+box!.height).toBeLessThanOrEqual(viewport.height);
 await screenshot(page,'account-usage-statuses-top',info.project.name);await dialog.evaluate(el=>{el.scrollTop=el.scrollHeight});await screenshot(page,'account-usage-statuses-bottom',info.project.name);
});

test('account: logout error still reconciles changed server identity and clears private state',async({page})=>{
 const state=await setup(page,{email:'alice@example.test'});await seedHistory(page);await page.reload();await expect(page.locator('.sidebar .history-row').filter({hasText:'Alice 私有对话'})).toHaveCount(1);await navigation(page,'Alice 私有对话');await expect(page.locator('.markdown')).toContainText('Alice 私有对话私有正文');
 await page.route('**/api/auth/logout',r=>{state.email='';return r.fulfill({status:503,json:{error:{code:'AUTH_UNAVAILABLE',message:'登出响应暂时不可用。'}}})});
 const dialog=await account(page);await dialog.getByRole('button',{name:'登出',exact:true}).click();await expect(dialog.getByRole('alert')).toBeVisible();await expect(dialog.getByLabel('邮箱',{exact:true})).toBeVisible();await expect(page.locator('.markdown')).toHaveCount(0);await expect(page.locator('.sidebar .history-row').filter({hasText:'Alice 私有对话'})).toHaveCount(0);await expect(page.locator('.sidebar .history-row').filter({hasText:'访客旧对话'})).toHaveCount(1);
});

test('account: delayed first guest lookup preserves an unsent draft and key typed during initialization',async({page})=>{
 let release!:()=>void;const accountGate=new Promise<void>(resolve=>{release=resolve});await setup(page,{mode:'byok',accountGate});
 const prompt=page.getByRole('textbox',{name:'向虚空提问…',exact:true});await prompt.fill('账户初始化期间保留的草稿');await navigation(page,'设置');const dialog=page.getByRole('dialog',{name:'设置',exact:true});await dialog.getByLabel('模型 API Key').fill('initialization-fixture-key');
 release();await expect(page.locator('.sidebar .account-nav')).toHaveCount(1);await expect(dialog.getByLabel('模型 API Key')).toHaveValue('initialization-fixture-key');await dialog.getByRole('button',{name:'关闭',exact:true}).click();await expect(prompt).toHaveValue('账户初始化期间保留的草稿');
});

test('account: an expired shared model-test session opens account sign-in',async({page})=>{
 const state=await setup(page,{email:'alice@example.test'});let tested=false;
 await page.route('**/api/models/test',r=>{tested=true;state.email='';return r.fulfill({status:401,json:{error:{code:'LOGIN_REQUIRED',message:'请重新登录。'}}})});
 await navigation(page,'设置');const settings=page.getByRole('dialog',{name:'设置',exact:true});await settings.getByRole('button',{name:'测试连接',exact:true}).click();
 await expect.poll(()=>tested).toBe(true);const dialog=page.getByRole('dialog',{name:'账户与额度',exact:true});await expect(dialog.getByLabel('邮箱',{exact:true})).toBeVisible();await expect(settings).toHaveCount(0);expect(state.chatRequests).toHaveLength(0);
});
