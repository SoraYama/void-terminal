import {test,expect,type Page} from '@playwright/test';
import path from 'node:path';
import type {AccountUsage as Usage} from '../../src/lib/account-contracts';

const screenshots=path.resolve(process.cwd(),'../../artifacts/account-trial');
const status={ready:true,deployment:{mode:'hosted'},activeSnapshot:{id:'account-fixture',sourceRepo:'fixture',sourceCommit:'fixture',gameVersion:null,createdAt:'2026-11-06T00:00:00Z',label:'Account browser fixture',state:'ready'},documentCount:1,chunkCount:1,languages:['zh-CN','en'],retrieval:{lexical:true,semantic:false,model:null},coverage:[],provider:{model:'fixture-model',sharedEnabled:true,byok:false}};
const frame=(event:string,data:unknown)=>`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
type Risk={status:'verified'|'unavailable'}|{status:'verification_required';siteKey:string;challengeAction:'account_device'};
const requiredProof:Risk={status:'verification_required',siteKey:'fixture-only',challengeAction:'account_device'};
type Grant={id:string;createdAt:string;source:'legacy'|'trial'|'manual'|'payment';units:number};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function setup(page:Page,options:{enabled?:boolean;email?:string;theme?:'light'|'dark';locale?:'zh-CN'|'en';mode?:'shared'|'byok';accountGate?:Promise<void>;available?:number;totalGranted?:number;costs?:{standard:number;deep:number}|null;grants?:Grant[];risk?:Risk;daily?:{available:number;held:number;limit:number;resetsAt:string};deviceLimited?:boolean}={}){
 const state={risk:options.risk??{status:'verified'} as Risk,daily:options.daily,enabled:options.enabled??true,email:options.email??'',available:options.available??20,totalGranted:options.totalGranted??20,costs:options.costs===null?undefined:options.costs??{standard:1,deep:3},grants:options.grants,held:0,usage:null as Usage[]|null,accountReads:0,accountError:false,sendCodes:[] as unknown[],verifyCodes:[] as unknown[],chatRequests:[] as {headers:Record<string,string>;body:any}[]};
 await page.addInitScript(({theme,mode,locale})=>localStorage.setItem('void.preferences',JSON.stringify({theme,mode,locale,sourceLanguage:'zh-CN'})),{theme:options.theme??'light',mode:options.mode??'shared',locale:options.locale??'zh-CN'});
 await page.route('**/api/status',r=>r.fulfill({json:status}));
 await page.route('**/api/account',async r=>{
  state.accountReads++;if(options.accountGate)await options.accountGate;
  if(state.accountError)return r.fulfill({status:503,json:{error:{code:'ACCOUNT_UNAVAILABLE',message:'额度暂时无法读取，请重试。'}}});
  if(!state.enabled||!state.email)return r.fulfill({json:{enabled:state.enabled,authenticated:false,risk:state.risk}});
  return r.fulfill({json:{enabled:true,authenticated:true,user:{id:accountId(state.email),email:state.email},credits:{available:state.available,held:state.held,totalGranted:state.totalGranted,...(state.daily?{daily:state.daily,reserve:{available:state.available-state.daily.available,held:0}}:{})},risk:state.risk,eligibility:{status:options.deviceLimited?'device_limit':state.risk?.status==='verification_required'?'verification_required':'ready'},trialCredits:20,costs:state.costs,...(state.grants===undefined?{}:{grants:state.grants}),usage:state.usage??(state.available===20?[]:[{requestId:'00000000-0000-4000-8000-000000000001',createdAt:'2026-11-06T08:00:00Z',depth:'standard',units:1,status:'completed',usedTokens:92,model:'fixture-model'}])}});
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
  const body=r.request().postDataJSON();state.chatRequests.push({headers:r.request().headers(),body});state.available-=body.depth==='deep'?(state.costs?.deep??3):(state.costs?.standard??1);
  await r.fulfill({contentType:'text/event-stream',body:frame('text_delta',{text:'账户隔离测试回答。'})+frame('done',{snapshotId:'account-fixture',finishReason:'stop'})});
 });
 await page.goto('/');
 await expect.poll(()=>state.accountReads).toBeGreaterThan(0);
 return state;
}
function accountId(email:string){return 'account-'+email.split('@')[0]}
async function navigation(page:Page,name:string){const menu=page.getByRole('button',{name:'Menu',exact:true});if(page.viewportSize()!.width<=650)await menu.click();await page.getByRole('button',{name,exact:true}).click()}
async function account(page:Page){await navigation(page,'账户与点数');const dialog=page.getByRole('dialog',{name:'账户与点数',exact:true});await expect(dialog).toBeVisible();return dialog}
async function closeAccount(page:Page){await page.getByRole('dialog',{name:'账户与点数',exact:true}).getByRole('button',{name:'关闭',exact:true}).click()}
async function signIn(page:Page,email:string){const dialog=page.getByRole('dialog',{name:'账户与点数',exact:true});await dialog.getByLabel('邮箱',{exact:true}).fill(email);await dialog.getByRole('button',{name:'发送验证码',exact:true}).click();await dialog.getByLabel('验证码',{exact:true}).fill('123456');await dialog.getByRole('button',{name:'验证并登录',exact:true}).click();await expect(dialog).toHaveCount(0);const reopened=await account(page);await expect(reopened).toContainText(email);await expect(reopened).toContainText('可用点数')}
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
  expect(state.sendCodes).toMatchObject([{email:'alice@example.test',signals:{browser:expect.stringMatching(/^(chromium|safari)$/)}}]);
  await dialog.getByLabel('验证码',{exact:true}).fill('000000');await dialog.getByRole('button',{name:'验证并登录',exact:true}).click();
  await expect(dialog.getByRole('alert')).toBeVisible();await expect(dialog.getByRole('button',{name:'验证并登录',exact:true})).toBeEnabled();
  await dialog.getByLabel('验证码',{exact:true}).fill('123456');await dialog.getByRole('button',{name:'验证并登录',exact:true}).click();
  await expect(dialog).toHaveCount(0);await account(page);await expect(dialog).toContainText('alice@example.test');await expect(dialog).toContainText('20');
  state.available=19;await dialog.getByRole('button',{name:'刷新点数',exact:true}).click();await expect(dialog).toContainText('19');await dialog.getByText('最近使用与获赠记录',{exact:true}).click();await expect(dialog.getByRole('region',{name:'最近用量',exact:true})).toContainText('普通考据');await expect(dialog.getByRole('region',{name:'最近用量',exact:true})).toContainText('已完成');
  const box=await dialog.boundingBox(),viewport=page.viewportSize()!;expect(box).not.toBeNull();expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(viewport.width);expect(box!.y).toBeGreaterThanOrEqual(0);expect(box!.y+box!.height).toBeLessThanOrEqual(viewport.height);
  await screenshot(page,`account-balance-${theme}`,info.project.name);
  await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(page.getByRole('button',{name:page.viewportSize()!.width<=650?'Menu':'账户与点数',exact:true})).toBeFocused();
  const storage=await page.evaluate(()=>({local:Object.fromEntries(Object.entries(localStorage)),session:Object.fromEntries(Object.entries(sessionStorage))}));expect(JSON.stringify(storage)).not.toMatch(/123456|alice@example|access_token|refresh_token|supabase/i);
 });
}

test('account: anonymous draft survives sign-in and requires an explicit shared send',async({page})=>{
 const state=await setup(page);await page.getByRole('textbox',{name:'向虚空提问…',exact:true}).fill('需要登录的共享提问');await page.getByRole('button',{name:'发送',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'账户与点数',exact:true})).toBeVisible();expect(state.chatRequests).toHaveLength(0);
 await signIn(page,'alice@example.test');await closeAccount(page);await expect(page.getByRole('textbox',{name:'向虚空提问…',exact:true})).toHaveValue('需要登录的共享提问');expect(state.chatRequests).toHaveLength(0);
 await page.getByRole('button',{name:'发送',exact:true}).click();await expect.poll(()=>state.chatRequests.length).toBe(1);expect(state.chatRequests[0].body.mode).toBe('shared');
});

test('account: shared sends have fresh request IDs and refresh credits after completion',async({page})=>{
 const state=await setup(page,{email:'alice@example.test',mode:'byok'});const initialReads=state.accountReads;
 await page.getByRole('textbox',{name:'向虚空提问…',exact:true}).fill('第一条共享问题');await page.getByRole('button',{name:'发送',exact:true}).click();await expect(page.locator('.markdown').last()).toHaveText('账户隔离测试回答。');
 await expect.poll(()=>state.accountReads).toBeGreaterThan(initialReads);await expect(page.getByRole('button',{name:'停止生成',exact:true})).toHaveCount(0);
 await page.getByRole('textbox',{name:'继续追问…',exact:true}).fill('第二条共享问题');await page.getByRole('button',{name:'发送',exact:true}).click();await expect.poll(()=>state.chatRequests.length).toBe(2);await expect(page.getByRole('button',{name:'停止生成',exact:true})).toHaveCount(0);
 const ids=state.chatRequests.map(r=>r.headers['x-request-id']);expect(ids.every(id=>uuid.test(id))).toBe(true);expect(new Set(ids).size).toBe(2);
 for(const request of state.chatRequests){expect(request.headers['x-model-api-key']).toBeUndefined();expect(request.body).toMatchObject({mode:'shared'});expect(request.body).not.toHaveProperty('accountId');expect(request.body).not.toHaveProperty('apiKey');expect(request.body).not.toHaveProperty('provider')}
 const dialog=await account(page);await expect(dialog).toContainText('18');
});

test('account: identity switches isolate user histories and never reveal guest records',async({page})=>{
 await setup(page,{mode:'byok'});await seedHistory(page);await page.reload();
 const histories=page.locator('.sidebar .history-row');await expect(histories.filter({hasText:'访客旧对话'})).toHaveCount(0);await expect(histories.filter({hasText:'Alice 私有对话'})).toHaveCount(0);
 await account(page);await signIn(page,'alice@example.test');await closeAccount(page);await expect(histories.filter({hasText:'Alice 私有对话'})).toHaveCount(1);await expect(histories.filter({hasText:'访客旧对话'})).toHaveCount(0);await expect(histories.filter({hasText:'Bob 私有对话'})).toHaveCount(0);
 await navigation(page,'Alice 私有对话');await expect(page.locator('.markdown')).toContainText('Alice 私有对话私有正文');
 let dialog=await account(page);await dialog.getByRole('button',{name:'登出',exact:true}).click();await expect(dialog.getByLabel('邮箱',{exact:true})).toBeVisible();await expect(page.locator('.markdown')).toHaveCount(0);await expect(histories.filter({hasText:'Alice 私有对话'})).toHaveCount(0);
 await signIn(page,'bob@example.test');await closeAccount(page);await expect(histories.filter({hasText:'Bob 私有对话'})).toHaveCount(1);await expect(histories.filter({hasText:'Alice 私有对话'})).toHaveCount(0);await expect(histories.filter({hasText:'访客旧对话'})).toHaveCount(0);
 dialog=await account(page);await dialog.getByRole('button',{name:'登出',exact:true}).click();await closeAccount(page);await expect(histories.filter({hasText:'访客旧对话'})).toHaveCount(0);await expect(histories.filter({hasText:'Bob 私有对话'})).toHaveCount(0);
});

test('account: failed balance refresh hides unverified private state and retry restores the account',async({page})=>{
 const state=await setup(page,{email:'alice@example.test'});await seedHistory(page);await page.reload();await navigation(page,'Alice 私有对话');await expect(page.locator('.markdown')).toContainText('Alice 私有对话私有正文');const dialog=await account(page);await expect(dialog).toContainText('20');state.accountError=true;
 await dialog.getByRole('button',{name:'刷新点数',exact:true}).click();await expect(dialog.getByRole('alert')).toBeVisible();await expect(dialog).not.toContainText('alice@example.test');await expect(dialog.locator('.account-balance')).toHaveCount(0);await expect(page.locator('.markdown')).toHaveCount(0);await expect(page.locator('.sidebar .history-row')).toHaveCount(0);
 state.accountError=false;state.available=17;await dialog.getByRole('button',{name:'重试',exact:true}).click();await expect(dialog).toContainText('17');await expect(dialog).toContainText('alice@example.test');await expect(dialog.getByRole('alert')).toHaveCount(0);await expect(page.locator('.sidebar .history-row').filter({hasText:'Alice 私有对话'})).toHaveCount(1);await expect(page.locator('.sidebar .history-row').filter({hasText:'访客旧对话'})).toHaveCount(0);
});

test('account: unavailable hosted account service keeps account navigation and exposes no key fallback',async({page})=>{
 await setup(page,{enabled:false,mode:'byok'});const unavailable=await account(page);await expect(unavailable).toContainText('账户服务暂未开放');await expect(unavailable).not.toContainText('自己的模型密钥');await closeAccount(page);
 await navigation(page,'设置');const dialog=page.getByRole('dialog',{name:'设置',exact:true});await expect(dialog.getByLabel('模型 API Key')).toHaveCount(0);await expect(dialog.getByLabel('Base URL',{exact:true})).toHaveCount(0);await expect(dialog.getByRole('combobox',{name:'模型连接',exact:true})).toHaveCount(0);await expect(dialog.getByRole('button',{name:'清除密钥',exact:true})).toHaveCount(0);
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
 const dialog=await account(page);await dialog.getByRole('button',{name:'刷新点数',exact:true}).click();
 await dialog.getByText('最近使用与获赠记录',{exact:true}).click();
 const usage=dialog.getByRole('region',{name:'最近用量',exact:true});await expect(usage.getByRole('listitem')).toHaveCount(4);
 await expect(usage).toContainText('处理中 · 暂占 3 点');await expect(usage.getByRole('listitem').nth(1)).toContainText('未扣点数');await expect(usage.getByRole('listitem').nth(2)).toContainText('未扣点数（超时）');await expect(usage).toContainText('已完成 · −1 点');await expect(usage).toContainText('用量未知');await expect(usage.getByText('用量未知',{exact:false})).toHaveCount(1);
 expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);const box=await dialog.boundingBox(),viewport=page.viewportSize()!;expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(viewport.width);expect(box!.y+box!.height).toBeLessThanOrEqual(viewport.height);
 await screenshot(page,'account-usage-statuses-top',info.project.name);await dialog.evaluate(el=>{el.scrollTop=el.scrollHeight});await screenshot(page,'account-usage-statuses-bottom',info.project.name);
});

test('account: logout error still reconciles changed server identity and clears private state',async({page})=>{
 const state=await setup(page,{email:'alice@example.test'});await seedHistory(page);await page.reload();await expect(page.locator('.sidebar .history-row').filter({hasText:'Alice 私有对话'})).toHaveCount(1);await navigation(page,'Alice 私有对话');await expect(page.locator('.markdown')).toContainText('Alice 私有对话私有正文');
 await page.route('**/api/auth/logout',r=>{state.email='';return r.fulfill({status:503,json:{error:{code:'AUTH_UNAVAILABLE',message:'登出响应暂时不可用。'}}})});
 const dialog=await account(page);await dialog.getByRole('button',{name:'登出',exact:true}).click();await expect(dialog.getByRole('alert')).toBeVisible();await expect(dialog.getByLabel('邮箱',{exact:true})).toBeVisible();await expect(page.locator('.markdown')).toHaveCount(0);await expect(page.locator('.sidebar .history-row').filter({hasText:'Alice 私有对话'})).toHaveCount(0);await expect(page.locator('.sidebar .history-row').filter({hasText:'访客旧对话'})).toHaveCount(0);
});

test('account: delayed anonymous lookup preserves a first unsent draft without exposing guest history',async({page})=>{
 let release!:()=>void;const accountGate=new Promise<void>(resolve=>{release=resolve});await setup(page,{mode:'byok',accountGate});
 const prompt=page.getByRole('textbox',{name:'向虚空提问…',exact:true});await prompt.fill('账户初始化期间保留的草稿');release();await expect(prompt).toHaveValue('账户初始化期间保留的草稿');
 const dialog=await account(page);await expect(dialog.getByLabel('邮箱',{exact:true})).toBeVisible();await closeAccount(page);await expect(prompt).toHaveValue('账户初始化期间保留的草稿');
});

test('account: an expired shared chat session opens sign-in without offering BYOK',async({page})=>{
 const state=await setup(page,{email:'alice@example.test'});let requested=false;
 await page.route('**/api/chat',r=>{requested=true;state.email='';return r.fulfill({status:401,json:{error:{code:'LOGIN_REQUIRED',message:'请重新登录。'}}})});
 await page.getByRole('textbox',{name:'向虚空提问…',exact:true}).fill('过期会话提问');await page.getByRole('button',{name:'发送',exact:true}).click();
 await expect.poll(()=>requested).toBe(true);const dialog=page.getByRole('dialog',{name:'账户与点数',exact:true});await expect(dialog.getByLabel('邮箱',{exact:true})).toBeVisible();await expect(dialog).not.toContainText('自己的模型密钥');
});

test('account: an expired shared model-test session opens sign-in without a key error',async({page})=>{
 const state=await setup(page,{email:'alice@example.test'});let tested=false;
 await page.route('**/api/models/test',r=>{tested=true;state.email='';return r.fulfill({status:401,json:{ok:false,code:'LOGIN_REQUIRED',message:'请重新登录。'}})});
 await navigation(page,'设置');const settings=page.getByRole('dialog',{name:'设置',exact:true});await settings.getByRole('button',{name:'测试连接',exact:true}).click();
 await expect.poll(()=>tested).toBe(true);const dialog=page.getByRole('dialog',{name:'账户与点数',exact:true});await expect(dialog.getByLabel('邮箱',{exact:true})).toBeVisible();await expect(settings).toHaveCount(0);expect(state.chatRequests).toHaveLength(0);await expect(dialog).not.toContainText('密钥未被接受');
});

test('account: logout clears a private draft while a fresh anonymous draft survives the next account login',async({page})=>{
 const state=await setup(page,{email:'alice@example.test'});await seedHistory(page);await page.reload();
 await expect(page.locator('.sidebar .history-row').filter({hasText:'Alice 私有对话'})).toHaveCount(1);
 const question=page.locator('#question');await question.fill('Alice 不得跨账户的私有草稿');
 const dialog=await account(page);await dialog.getByRole('button',{name:'登出',exact:true}).click();await expect(dialog.getByLabel('邮箱',{exact:true})).toBeVisible();await closeAccount(page);
 await expect(question).toHaveValue('');await expect(page.locator('.sidebar .history-row').filter({hasText:'Alice 私有对话'})).toHaveCount(0);
 await question.fill('退出后新写的匿名草稿');await page.getByRole('button',{name:'发送',exact:true}).click();expect(state.chatRequests).toHaveLength(0);
 await signIn(page,'bob@example.test');await closeAccount(page);await expect(question).toHaveValue('退出后新写的匿名草稿');
 await expect(page.locator('.sidebar .history-row').filter({hasText:'Bob 私有对话'})).toHaveCount(1);await expect(page.locator('.sidebar .history-row').filter({hasText:'Alice 私有对话'})).toHaveCount(0);
 await page.getByRole('button',{name:'发送',exact:true}).click();await expect.poll(()=>state.chatRequests.length).toBe(1);expect(state.chatRequests[0].body.messages).toEqual([{role:'user',content:'退出后新写的匿名草稿'}]);
});

for(const theme of ['light','dark'] as const){
 test(`credits: incoming grants are separate from research usage (${theme})`,async({page},info)=>{
  const grants:Grant[]=[
   {id:'grant-payment',createdAt:'2026-11-06T08:00:00Z',source:'payment',units:40},
   {id:'grant-manual',createdAt:'2026-11-05T08:00:00Z',source:'manual',units:7},
   {id:'grant-trial',createdAt:'2026-11-04T08:00:00Z',source:'trial',units:20},
   {id:'grant-legacy',createdAt:'2026-11-03T08:00:00Z',source:'legacy',units:13},
  ];
  await setup(page,{email:'alice@example.test',theme,available:79,totalGranted:80,grants});
  const dialog=await account(page),incoming=dialog.getByRole('region',{name:'最近入账',exact:true}),usage=dialog.getByRole('region',{name:'最近用量',exact:true});
  await dialog.getByText('最近使用与获赠记录',{exact:true}).click();
  await expect(dialog.locator('.account-record-totals')).toContainText('累计储备入账');await expect(dialog).not.toContainText('已获试用额度');
  await expect(incoming.getByRole('listitem')).toHaveCount(4);
  for(const [index,label] of ['支付入账','人工入账','新人赠点','历史入账'].entries())await expect(incoming.getByRole('listitem').nth(index)).toContainText(label);
  for(const grant of grants)await expect(incoming).toContainText(`+${grant.units}`);
  await expect(incoming).not.toContainText('普通考据');await expect(usage).toContainText('普通考据');await expect(usage).not.toContainText('人工入账');
  await expect(dialog.getByRole('button',{name:/充值|购买|支付|checkout|buy/i})).toHaveCount(0);
  expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  await screenshot(page,`credit-history-${theme}-top`,info.project.name);await incoming.scrollIntoViewIfNeeded();await screenshot(page,`credit-history-${theme}-records`,info.project.name);
 });
}

test('credits: an older account response never invents incoming grant records',async({page})=>{
 await setup(page,{email:'alice@example.test',totalGranted:80});
 const dialog=await account(page),incoming=dialog.getByRole('region',{name:'最近入账',exact:true});
 await dialog.getByText('最近使用与获赠记录',{exact:true}).click();
 await expect(dialog.locator('.account-record-totals')).toContainText('80');await expect(incoming).toContainText('暂无入账明细');await expect(incoming.getByRole('listitem')).toHaveCount(0);
});

test('credits: English account labels describe total credits and incoming records',async({page})=>{
 await setup(page,{email:'alice@example.test',locale:'en',grants:[{id:'grant-trial',createdAt:'2026-11-06T08:00:00Z',source:'trial',units:20}]});
 await navigation(page,'Account & credits');const dialog=page.getByRole('dialog',{name:'Account & credits',exact:true});
 await dialog.getByText('Recent usage and grants',{exact:true}).click();
 await expect(dialog.locator('.account-record-totals')).toContainText('Total credited');await expect(dialog.getByRole('region',{name:'Recent credits',exact:true}).getByRole('listitem')).toHaveCount(1);await expect(dialog.getByRole('region',{name:'Recent usage',exact:true})).toBeVisible();
});

test('credits: zero balance preserves the raw draft before creating a request or history',async({page},info)=>{
 const state=await setup(page,{email:'alice@example.test',available:0});await expect(page.locator('.composer-cost')).toBeVisible();
 const draft='  零额度时保留完整问题\n第二行仍在  ';await page.locator('#question').fill(draft);await page.getByRole('button',{name:'发送',exact:true}).click();
 const shortage=page.locator('.credit-shortage');await expect(shortage).toContainText('可用点数为 0');await expect(page.locator('#question')).toHaveValue(draft);
 expect(state.chatRequests).toHaveLength(0);await expect(page.locator('.sidebar .history-row')).toHaveCount(0);await expect(page.locator('.message')).toHaveCount(0);await expect(shortage.getByRole('button',{name:'切换为普通考据',exact:true})).toHaveCount(0);
 const action=shortage.getByRole('button',{name:'查看账户',exact:true});expect((await action.boundingBox())!.height).toBeGreaterThanOrEqual(44);expect(await shortage.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
 await screenshot(page,'credit-zero-shortage',info.project.name);await action.click();const dialog=page.getByRole('dialog',{name:'账户与点数',exact:true});await expect(dialog).toBeVisible();await expect(dialog.getByRole('button',{name:/充值|购买|支付/})).toHaveCount(0);await closeAccount(page);await expect(page.locator('#question')).toHaveValue(draft);
 await page.reload();await expect(page.locator('.sidebar .history-row')).toHaveCount(0);
});

for(const available of [1,2]){
 test(`credits: ${available} remaining credits offer standard research without automatically sending`,async({page},info)=>{
  const state=await setup(page,{email:'alice@example.test',available});await expect(page.locator('.composer-cost')).toBeVisible();const draft=`保留 ${available} 额度的深入问题`;
  await page.locator('#question').fill(draft);await page.getByRole('button',{name:'深入考据',exact:true}).click();await page.getByRole('button',{name:'发送',exact:true}).click();
  const shortage=page.locator('.credit-shortage');await expect(shortage).toContainText(String(available));await expect(shortage).toContainText('3');await expect(shortage).not.toContainText('可用点数为 0');await expect(page.locator('#question')).toHaveValue(draft);expect(state.chatRequests).toHaveLength(0);await expect(page.locator('.sidebar .history-row')).toHaveCount(0);
  const switchDepth=shortage.getByRole('button',{name:'切换为普通考据',exact:true});expect((await switchDepth.boundingBox())!.height).toBeGreaterThanOrEqual(44);expect(await shortage.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  await screenshot(page,`credit-deep-shortage-${available}`,info.project.name);await switchDepth.click();await expect(page.getByRole('button',{name:'深入考据',exact:true})).toHaveAttribute('aria-pressed','false');await expect(page.locator('#question')).toHaveValue(draft);expect(state.chatRequests).toHaveLength(0);
  await page.getByRole('button',{name:'发送',exact:true}).click();await expect.poll(()=>state.chatRequests.length).toBe(1);expect(state.chatRequests[0].body.depth).toBe('standard');expect(state.chatRequests[0].body.messages).toEqual([{role:'user',content:draft}]);
 });
}

test('credits: precheck follows configured costs and waits for the server when costs are unknown',async({page})=>{
 const state=await setup(page,{email:'alice@example.test',available:2,costs:{standard:2,deep:5}});await expect(page.locator('.composer-cost')).toContainText('2');await page.locator('#question').fill('读取站点实际计费额度');await page.getByRole('button',{name:'深入考据',exact:true}).click();await page.getByRole('button',{name:'发送',exact:true}).click();
 const shortage=page.locator('.credit-shortage');await expect(shortage).toContainText('5');expect(state.chatRequests).toHaveLength(0);await expect(shortage.getByRole('button',{name:'切换为普通考据',exact:true})).toBeVisible();
 await page.route('**/api/chat',r=>{state.chatRequests.push({headers:r.request().headers(),body:r.request().postDataJSON()});return r.fulfill({status:402,json:{error:{code:'CREDITS_EXHAUSTED',message:'Insufficient credits.'}}})});
 state.costs=undefined;const dialog=await account(page);await dialog.getByRole('button',{name:'刷新点数',exact:true}).click();await expect(page.locator('.composer-cost')).toHaveCount(0);await closeAccount(page);
 await page.getByRole('button',{name:'发送',exact:true}).click();await expect.poll(()=>state.chatRequests.length).toBe(1);
});

test('credits: a server admission race restores the raw draft and uses the refreshed balance',async({page})=>{
 const state=await setup(page,{email:'alice@example.test'});await expect(page.locator('.composer-cost')).toBeVisible();const initialReads=state.accountReads,draft='  服务器拒绝后仍可编辑\n完整草稿  ';let requested=false;
 await page.route('**/api/chat',r=>{requested=true;state.available=2;return r.fulfill({status:402,json:{error:{code:'CREDITS_EXHAUSTED',message:'Insufficient credits.'}}})});
 await page.getByRole('button',{name:'深入考据',exact:true}).click();await page.locator('#question').fill(draft);await page.getByRole('button',{name:'发送',exact:true}).click();
 await expect.poll(()=>requested).toBe(true);await expect.poll(()=>state.accountReads).toBeGreaterThan(initialReads);await expect(page.locator('#question')).toHaveValue(draft);await expect(page.getByRole('button',{name:'停止生成',exact:true})).toHaveCount(0);
 const shortage=page.locator('.credit-shortage');await expect(shortage).toContainText('2');await expect(shortage).not.toContainText('可用点数为 0');await expect(page.locator('.message')).toHaveCount(0);await expect(page.locator('.sidebar .history-row')).toHaveCount(0);
 const dialog=await account(page);await expect(dialog.locator('.account-balance>div').filter({hasText:'可用点数'}).locator('dd')).toHaveText('2');await closeAccount(page);await page.reload();await expect(page.locator('.sidebar .history-row')).toHaveCount(0);
});

test('credits: an edited question rejected by precheck preserves both it and the composer draft',async({page})=>{
 const state=await setup(page,{email:'alice@example.test',available:0});await seedHistory(page);await page.reload();await navigation(page,'Alice 私有对话');await expect(page.locator('.composer-cost')).toBeVisible();
 const composerDraft='保留已有追问草稿',editedQuestion='  Alice 修改后的问题\n原始空格  ';await page.locator('#question').fill(composerDraft);
 await page.locator('.message.user').getByRole('button',{name:'编辑并分支',exact:true}).click();const editor=page.locator('.edit-box');await editor.locator('textarea').fill(editedQuestion);await editor.getByRole('button',{name:'编辑并分支',exact:true}).click();
 await expect(editor.locator('textarea')).toHaveValue(editedQuestion);await expect(page.locator('.credit-shortage')).toContainText('可用点数为 0');expect(state.chatRequests).toHaveLength(0);await expect(page.locator('#question')).toHaveValue(composerDraft);await expect(page.locator('.message.user')).toHaveCount(1);await expect(page.locator('.markdown')).toHaveText('Alice 私有对话私有正文');await expect(page.locator('.sidebar .history-row')).toHaveCount(1);
});

for(const branchAction of ['edit','regenerate'] as const){
test(`credits: a rejected ${branchAction} branch retries only its prefix and preserves the composer draft`,async({page})=>{
 const state=await setup(page,{email:'alice@example.test'});await seedHistory(page);
 await page.evaluate(async()=>{await new Promise<void>((resolve,reject)=>{
  const request=indexedDB.open('void-terminal:account:account-alice',1);request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction('conversations','readwrite');tx.objectStore('conversations').put({id:'Alice 私有对话',title:'Alice 私有对话',updatedAt:Date.now(),messages:[{role:'user',content:'Q1'},{role:'assistant',content:'A1'},{role:'user',content:'Q2'},{role:'assistant',content:'A2'}]});tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>reject(tx.error)};
 })});
 await page.reload();await navigation(page,'Alice 私有对话');await expect(page.locator('.composer-cost')).toBeVisible();
 await page.route('**/api/chat',r=>{state.chatRequests.push({headers:r.request().headers(),body:r.request().postDataJSON()});return state.chatRequests.length===1?r.fulfill({status:402,json:{error:{code:'CREDITS_EXHAUSTED',message:'Insufficient credits.'}}}):r.fulfill({contentType:'text/event-stream',body:frame('text_delta',{text:'编辑后的分支回答。'})+frame('done',{snapshotId:'account-fixture',finishReason:'stop'})})});
 const composerDraft='  Alice 已有追问草稿  ',retryQuestion=branchAction==='edit'?'  Q1 修改后的问题\n保留原始空格  ':'Q1';await page.locator('#question').fill(composerDraft);const editor=page.locator('.edit-box');
 if(branchAction==='edit'){await page.locator('.message.user').first().getByRole('button',{name:'编辑并分支',exact:true}).click();await editor.locator('textarea').fill(retryQuestion);await editor.getByRole('button',{name:'编辑并分支',exact:true}).click()}
 else await page.locator('.message.assistant').first().getByRole('button',{name:'重新生成',exact:true}).click();
 await expect.poll(()=>state.chatRequests.length).toBe(1);await expect(editor.locator('textarea')).toHaveValue(retryQuestion);await expect(page.locator('#question')).toHaveValue(composerDraft);await expect(page.getByRole('button',{name:'停止生成',exact:true})).toHaveCount(0);await expect(page.locator('.message.user')).toHaveCount(2);await expect(page.locator('.markdown')).toHaveText(['A1','A2']);
 await editor.getByRole('button',{name:'编辑并分支',exact:true}).click();await expect.poll(()=>state.chatRequests.length).toBe(2);expect(state.chatRequests[1].body.messages).toEqual([{role:'user',content:retryQuestion}]);await expect(page.locator('.markdown').last()).toHaveText('编辑后的分支回答。');
});
}

test('credits: a delayed admission rejection keeps newly typed text and the prior conversation',async({page})=>{
 await setup(page,{email:'alice@example.test'});await seedHistory(page);await page.reload();await navigation(page,'Alice 私有对话');
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve});let requested=false;
 await page.route('**/api/chat',async r=>{requested=true;await gate;await r.fulfill({status:402,json:{error:{code:'CREDITS_EXHAUSTED',message:'Insufficient credits.'}}})});
 await page.locator('#question').fill('刚提交但未被接受的追问');await page.getByRole('button',{name:'发送',exact:true}).click();await expect.poll(()=>requested).toBe(true);await page.locator('#question').fill('等待期间新写的草稿');release();
 await expect(page.locator('.credit-shortage')).toBeVisible();await expect(page.locator('#question')).toHaveValue('等待期间新写的草稿');await expect(page.locator('.message.user')).toHaveCount(1);await expect(page.locator('.message.user')).toContainText('Alice 私有对话');await expect(page.locator('.markdown')).toHaveText('Alice 私有对话私有正文');
 const rejectedDraft=page.locator('.credit-rejected-draft');await expect(rejectedDraft).toContainText('刚提交但未被接受的追问');await rejectedDraft.getByText('查看未发送问题',{exact:true}).click();await rejectedDraft.getByRole('button',{name:'恢复未发送问题',exact:true}).click();await expect(page.locator('#question')).toHaveValue('刚提交但未被接受的追问');await expect(rejectedDraft).toContainText('等待期间新写的草稿');
 await expect(page.locator('.credit-shortage')).not.toContainText('可用点数为 0');await page.reload();await navigation(page,'Alice 私有对话');await expect(page.locator('.message.user')).toHaveCount(1);await expect(page.locator('.markdown')).toHaveText('Alice 私有对话私有正文');
});

test('credits: a delayed 402 cannot restore a rejected draft into another identity',async({page})=>{
 await setup(page,{email:'alice@example.test'});await expect(page.locator('.composer-cost')).toBeVisible();let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve});let requested=false,fulfilled=false;
 await page.route('**/api/chat',async r=>{requested=true;await gate;await r.fulfill({status:402,json:{error:{code:'CREDITS_EXHAUSTED',message:'Insufficient credits.'}}}).catch(()=>{});fulfilled=true});
 await page.locator('#question').fill('Alice 不得恢复给 Bob 的问题');await page.getByRole('button',{name:'发送',exact:true}).click();await expect.poll(()=>requested).toBe(true);
 const dialog=await account(page);await dialog.getByRole('button',{name:'登出',exact:true}).click();await expect(dialog.getByLabel('邮箱',{exact:true})).toBeVisible();await signIn(page,'bob@example.test');await closeAccount(page);await page.locator('#question').fill('Bob 的新草稿');release();
 await expect.poll(()=>fulfilled).toBe(true);await expect(page.locator('#question')).toHaveValue('Bob 的新草稿');await expect(page.locator('.credit-shortage')).toHaveCount(0);await expect(page.locator('.credit-rejected-draft')).toHaveCount(0);await expect(page.locator('.message')).toHaveCount(0);await expect(page.locator('.sidebar .history-row')).toHaveCount(0);
});

test('credits: ordinary model failures keep existing error and history behavior',async({page})=>{
 await setup(page,{email:'alice@example.test'});await expect(page.locator('.composer-cost')).toBeVisible();await page.route('**/api/chat',r=>r.fulfill({status:503,json:{error:{code:'MODEL_UNAVAILABLE',message:'The model provider is unavailable.'}}}));
 await page.locator('#question').fill('正常模型错误仍保留对话');await page.getByRole('button',{name:'发送',exact:true}).click();await expect(page.locator('.inline-error')).toContainText('模型服务暂时不可用');await expect(page.locator('.credit-shortage')).toHaveCount(0);await expect(page.locator('#question')).toHaveValue('');await expect(page.locator('.message.user')).toContainText('正常模型错误仍保留对话');await expect(page.locator('.sidebar .history-row')).toHaveCount(1);
 await page.reload();await navigation(page,'正常模型错误仍保留对话');await expect(page.locator('.inline-error')).toContainText('模型服务暂时不可用');
});

const dailyFixture = {available:3,held:0,limit:3,resetsAt:'2030-11-07T00:00:00+08:00'};
const fixtureOnlyBsc = '0x1111111111111111111111111111111111111111';
async function mockTurnstile(page:Page,solve:()=>void){
 await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',route=>route.fulfill({contentType:'application/javascript',body:`
 window.turnstile={render(el,opts){const b=document.createElement('button');b.type='button';b.textContent='Fixture challenge';b.onclick=()=>opts.callback('fixture-token-'+opts.action);el.appendChild(b);return 'fixture-widget'},remove(){document.querySelector('.account-challenge-widget button')?.remove()}};`}));
 await page.route('**/api/account/verify-device',route=>{
  expect(route.request().postDataJSON().token).toBe('fixture-token-account_device');
  solve();return route.fulfill({json:{ok:true}});
 });
}

test('free credits: daily and reserve balance show a Shanghai reset and compact history',async({page},info)=>{
 const state=await setup(page,{email:'alice@example.test',available:23,risk:{status:'verified'},daily:dailyFixture,theme:info.project.name.includes('mobile')?'dark':'light'});
 const dialog=await account(page);
 await expect(dialog.getByText('今日点数',{exact:true})).toBeVisible();
 await expect(dialog.getByText('3 / 3',{exact:true})).toBeVisible();
 await expect(dialog.getByText('储备点数',{exact:true})).toBeVisible();
 const reset=dialog.locator('time[datetime="2030-11-07T00:00:00+08:00"]');
 await expect(reset).toContainText('00:00');
 await expect(dialog.getByRole('region',{name:'最近用量',exact:true})).toBeHidden();
 await screenshot(page,'free-credits-daily-reserve',info.project.name);
 await dialog.getByText('最近使用与获赠记录',{exact:true}).click();
 await expect(dialog.getByRole('region',{name:'最近用量',exact:true})).toBeVisible();
 state.available=0;state.daily={...dailyFixture,available:0};
 await closeAccount(page);
 await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
 await expect(page.locator('.sidebar .account-nav-balance')).toHaveText('0');
 await page.locator('#question').fill('没点数时应保留此问题');
 await page.getByRole('button',{name:'发送',exact:true}).click();
 await expect(page.locator('.credit-shortage')).toContainText('北京时间');
 await expect(page.getByRole('button',{name:'邮件申请额外点数',exact:true})).toBeVisible();
 await expect(page.locator('#question')).toHaveValue('没点数时应保留此问题');
 expect(state.chatRequests).toHaveLength(0);
 const sendBox=await page.getByRole('button',{name:'发送',exact:true}).boundingBox();
 expect(sendBox!.y+sendBox!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
 await screenshot(page,'free-credits-exhausted',info.project.name);
 await page.getByRole('button',{name:'邮件申请额外点数',exact:true}).click();
 await expect(dialog.getByRole('link',{name:'打开邮件应用',exact:true})).toHaveAttribute('href',/mailto:fixture@example.test\?subject=/);
 await expect(dialog.getByRole('textbox',{name:'申请模板',exact:true})).toHaveValue(/account-alice/);
 await expect(dialog.getByRole('textbox',{name:'申请模板',exact:true})).not.toHaveValue(/没点数时应保留此问题/);
});

test('free credits: hosted BSC support labels the network and falls back to selecting the complete address',async({page},info)=>{
 if(info.project.name.includes('mobile'))await page.setViewportSize({width:375,height:667});
 await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:()=>Promise.reject(new Error('Fixture denial'))}}));
 await setup(page,{email:'alice@example.test',locale:'en'});
 await page.locator('#question').fill('Sponsorship must preserve this draft.');
 await navigation(page,'Support the project');
 const dialog=page.getByRole('dialog',{name:'Support the project',exact:true});
 await expect(dialog).toContainText('BNB Smart Chain (BSC/BEP-20)');
 await expect(dialog).toContainText('Mainnet · Chain ID 56');
 await expect(dialog).toContainText('BNB · USDT');
 await expect(dialog.getByRole('link',{name:'BscScan',exact:false})).toHaveAttribute('href',`https://bscscan.com/address/${fixtureOnlyBsc}`);
 await expect(dialog.getByRole('link',{name:'Open Ko-fi',exact:true})).toHaveAttribute('href','https://ko-fi.com/fixture-only');
 await expect(dialog.getByText('WeChat',{exact:true})).toHaveCount(0);
 await dialog.getByRole('button',{name:'Copy address',exact:true}).click();
 await expect(dialog.getByRole('status')).toContainText('Copy manually');
 const field=dialog.getByRole('textbox',{name:'Receiving address',exact:true});
 await expect(field).toHaveValue(fixtureOnlyBsc);
 expect(await field.evaluate(el=>(el as HTMLInputElement).selectionEnd)).toBe(fixtureOnlyBsc.length);
 expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
 await screenshot(page,'fixture-only-bsc-support',info.project.name);
 await dialog.getByRole('button',{name:'Close',exact:true}).click();
 await expect(page.locator('#question')).toHaveValue('Sponsorship must preserve this draft.');
});

test('free credits: verify an anonymous device before OTP and preserve the sign-in draft',async({page},info)=>{
 const state=await setup(page,{risk:requiredProof});
 await mockTurnstile(page,()=>{state.risk={status:'verified'}});
 await page.locator('#question').fill('验证设备后保留登录前草稿');
 await page.getByRole('button',{name:'发送',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'账户与点数',exact:true});
 await dialog.getByLabel('邮箱',{exact:true}).fill('alice@example.test');
 await expect(dialog.getByRole('button',{name:'发送验证码',exact:true})).toBeDisabled();
 await expect(dialog.getByText('验证此设备',{exact:true})).toBeVisible();
 await screenshot(page,'free-credits-verification',info.project.name);
 await dialog.getByRole('button',{name:'Fixture challenge'}).click();
 await expect(dialog.getByRole('button',{name:'发送验证码',exact:true})).toBeEnabled();
 await signIn(page,'alice@example.test');await closeAccount(page);
 await expect(page.locator('#question')).toHaveValue('验证设备后保留登录前草稿');
 expect(state.chatRequests).toHaveLength(0);
});

test('free credits: mixed usage explains the original daily period and returned reserve',async({page},info)=>{
 const state=await setup(page,{email:'alice@example.test'});
 const ended={dailyUnits:1,reserveUnits:2,dailyPeriod:'2026-11-06',dailyPeriodEnded:true};
 state.usage=[
  {requestId:'current',createdAt:'2026-11-06T16:01:00Z',depth:'deep',units:3,status:'released',usedTokens:null,model:'current-fixture',allocation:{...ended,dailyPeriod:'2026-11-07',dailyPeriodEnded:false}},
  {requestId:'release',createdAt:'2026-11-06T15:59:00Z',depth:'deep',units:3,status:'released',usedTokens:null,model:'release-fixture',allocation:ended},
  {requestId:'timeout',createdAt:'2026-11-06T15:58:00Z',depth:'deep',units:3,status:'expired',usedTokens:null,model:'timeout-fixture',allocation:ended},
  {requestId:'legacy',createdAt:'2026-11-05T15:00:00Z',depth:'standard',units:1,status:'released',usedTokens:null,model:'legacy-fixture',allocation:{dailyUnits:0,reserveUnits:1,dailyPeriod:null,dailyPeriodEnded:false}},
 ];
 const dialog=await account(page);
 await dialog.getByRole('button',{name:'刷新点数',exact:true}).click();
 await dialog.getByText('最近使用与获赠记录',{exact:true}).click();
 const usage=dialog.getByRole('region',{name:'最近用量',exact:true});
 const records=usage.getByRole('listitem');
 await expect(records.nth(1)).toContainText('未扣点数');
 await expect(records.nth(2)).toContainText('未扣点数（超时）');
 for(const row of [records.nth(1),records.nth(2)]){
  await expect(row).toContainText('已返还 2 点储备点数');
  await expect(row).toContainText('2026-11-06 的每日点数 1 点，周期已结束，不计入今日额度');
  await expect(row).not.toContainText('已返还 ·');
 }
 await expect(records.nth(0)).toContainText('已返还至 2026-11-07 的每日额度：1 点');
 await expect(records.nth(3)).toContainText('已返还 1 点储备点数');
 await expect(records.nth(3)).not.toContainText('每日点数');
 expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
 await usage.evaluate(el=>el.scrollIntoView({block:'start'}));
 await screenshot(page,'free-credits-refund-allocation',info.project.name);
});

test('free credits: anonymous challenge unavailable offers email recovery only when configured',async({page},info)=>{
 await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:()=>Promise.reject(new Error('Fixture denial'))}}));
 await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',route=>route.abort('failed'));
 const state=await setup(page,{risk:requiredProof});
 const dialog=await account(page);
 await dialog.getByLabel('邮箱',{exact:true}).fill('alice@example.test');
 const retry=dialog.getByRole('button',{name:'重新验证',exact:true});
 await expect(retry).toBeVisible();
 await retry.click();
 await expect(retry).toBeVisible();
 await expect(dialog.getByRole('button',{name:'发送验证码',exact:true})).toBeDisabled();
 const help=dialog.getByRole('button',{name:'设备验证遇到问题？邮件求助',exact:true});
 if(process.env.PLAYWRIGHT_WITHOUT_CONTACT==='1'){
  await expect(help).toHaveCount(0);
  await expect(dialog.getByRole('link',{name:'打开邮件应用',exact:true})).toHaveCount(0);
 }else{
  await expect(help).toBeVisible();
  await help.click();
  const link=dialog.getByRole('link',{name:'打开邮件应用',exact:true});
  await expect(link).toHaveAttribute('href',/mailto:fixture@example.test\?subject=/);
  const template=dialog.getByRole('textbox',{name:'求助模板',exact:true});
  await expect(template).toHaveValue(/遇到的问题/);
  await expect(template).not.toHaveValue(/账户识别码|alice@example.test/);
  await dialog.getByRole('button',{name:'复制邮箱',exact:true}).click();
  await expect(dialog.getByText('已选中文本，请手动复制。',{exact:true})).toBeVisible();
  await expect(dialog.getByRole('textbox',{name:'联系邮箱',exact:true})).toHaveValue('fixture@example.test');
  expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await screenshot(page,'free-credits-anonymous-verification-help',info.project.name);
 }
 expect(state.sendCodes).toHaveLength(0);
});

test('free credits: server proof rejection restores an edited branch; revalidation keeps the same history',async({page})=>{
 const state=await setup(page,{email:'alice@example.test',available:23,risk:{status:'verified'},daily:dailyFixture});
 await mockTurnstile(page,()=>{state.risk={status:'verified'}});
 await expect(page.locator('.composer-cost')).toBeVisible();
 await page.locator('#question').fill('应保留的原始问题');
 await page.getByRole('button',{name:'发送',exact:true}).click();
 await expect(page.locator('.markdown')).toHaveText('账户隔离测试回答。');
 await page.getByRole('button',{name:'编辑并分支',exact:true}).click();
 await page.locator('.edit-box textarea').fill('设备过期时不能丢掉这条编辑');
 await page.locator('#question').fill('并存的追问草稿');
 await page.route('**/api/chat',r=>{
  state.risk=requiredProof;
  return r.fulfill({status:403,json:{error:{code:'DEVICE_VERIFICATION_REQUIRED',message:'Device verification required'}}});
 });
 await page.locator('.edit-box').getByRole('button',{name:'编辑并分支',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'账户与点数',exact:true});
 await expect(dialog).toContainText('待验证');
 await dialog.getByRole('button',{name:'Fixture challenge'}).click();
 await expect(dialog.getByText('3 / 3',{exact:true})).toBeVisible();
 await closeAccount(page);
 await expect(page.locator('.edit-box textarea')).toHaveValue('设备过期时不能丢掉这条编辑');
 await expect(page.locator('#question')).toHaveValue('并存的追问草稿');
 await expect(page.locator('.markdown')).toHaveText('账户隔离测试回答。');
 await expect(page.locator('.sidebar .history-row').filter({hasText:'应保留的原始问题'})).toHaveCount(1);
 await page.reload();
 await navigation(page,'应保留的原始问题');
 await expect(page.locator('.markdown')).toHaveText('账户隔离测试回答。');
});

test('free credits: a verified shared device can use its existing reserve',async({page})=>{
 const state=await setup(page,{email:'alice@example.test',available:20,risk:{status:'verified'},deviceLimited:true,daily:{...dailyFixture,available:0}});
 const dialog=await account(page);
 await expect(dialog).toContainText('此设备已有账户领取');
 await expect(dialog.getByRole('button',{name:'Fixture challenge'})).toHaveCount(0);
 await closeAccount(page);
 await page.locator('#question').fill('共享设备已入账的储备仍可使用');
 await page.getByRole('button',{name:'发送',exact:true}).click();
 await expect.poll(()=>state.chatRequests.length).toBe(1);
});

test('free credits: device proof refreshes another tab without losing its unsent draft',async({page,context})=>{
 const options={email:'alice@example.test',available:23,risk:requiredProof,daily:dailyFixture};
 const primary=await setup(page,options);
 const other=await context.newPage();
 const secondary=await setup(other,options);
 await other.locator('#question').fill('另一标签页仍在写的草稿');
 const before=secondary.accountReads;
 await mockTurnstile(page,()=>{primary.risk={status:'verified'};secondary.risk={status:'verified'}});
 const dialog=await account(page);
 await dialog.getByRole('button',{name:'Fixture challenge'}).click();
 await expect(dialog.getByText('3 / 3',{exact:true})).toBeVisible();
 await expect.poll(()=>secondary.accountReads).toBeGreaterThan(before);
 await expect(other.locator('#question')).toHaveValue('另一标签页仍在写的草稿');
 const otherDialog=await account(other);await expect(otherDialog.getByText('3 / 3',{exact:true})).toBeVisible();
 await other.close();
});

test('free credits: a shared budget rejection retains the draft and individual credits',async({page})=>{
 const state=await setup(page,{email:'alice@example.test',available:23,risk:{status:'verified'},daily:dailyFixture});
 await page.route('**/api/chat',r=>r.fulfill({status:429,json:{error:{code:'QUOTA_EXCEEDED',message:'Budget limit reached'}}}));
 await page.locator('#question').fill('公共预算耗尽后保留这条问题');
 await page.getByRole('button',{name:'发送',exact:true}).click();
 await expect(page.locator('.home-error')).toContainText('公共考据预算已用完');
 await expect(page.locator('#question')).toHaveValue('公共预算耗尽后保留这条问题');
 await expect(page.locator('.message')).toHaveCount(0);
 expect(state.available).toBe(23);
 const dialog=await account(page);
 await expect(dialog.getByText('3 / 3',{exact:true})).toBeVisible();
 await expect(dialog.locator('.account-buckets>div').filter({hasText:'储备点数'}).getByText('20',{exact:true})).toBeVisible();
});
