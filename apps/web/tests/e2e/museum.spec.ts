import {test,expect,type Page} from '@playwright/test';
import path from 'node:path';

const snapshotId='museum-fixture';
const source={repo:'https://github.com/example/source',commit:'fixed-fixture',path:'Weapon/13501.json',locator:'13501',url:'https://github.com/example/source/blob/fixed-fixture/Weapon/13501.json'};
const base={language:'zh-CN',state:'source-record',rawIds:['13501'],documentIds:['homa-document'],sources:[source],attributes:[],acquisition:[],coverage:{story:'complete'}};
const homa={...base,id:'weapon:13501',name:'护摩之杖',category:'weapon',subtype:'长柄武器',rarity:5,description:'朱赤的「柴火之杖」，曾在古老的祭仪中使用。',story:'传说在很久以前，每一场火祭都意味着新的开始。',icon:{identifier:'UI_EquipIcon_Pole_Homa',url:'https://gi.yatta.moe/assets/UI/UI_EquipIcon_Pole_Homa.png',status:'verified',provider:'yatta'},weapon:{type:'WEAPON_POLE',levels:[{level:1,ascension:0,stats:[{key:'ATK',label:'基础攻击力',value:45.9364,unit:''}]},{level:20,ascension:0,stats:[{key:'ATK',label:'基础攻击力',value:121.73146,unit:''}]},{level:20,ascension:1,stats:[{key:'ATK',label:'基础攻击力',value:152.83146,unit:''}]},{level:90,ascension:6,stats:[{key:'ATK',label:'基础攻击力',value:608.0745972,unit:''},{key:'CD',label:'暴击伤害',value:66.1536,unit:'%'}]}],refinements:[1,2,3,4,5].map(rank=>({rank,name:'无羁的朱赤之蝶',description:`生命值提升${15+rank*5}%。`})),ascensions:[{phase:1,levelCap:40,coin:5000,items:[{id:'material:100110',name:'漆黑陨铁的一粒',count:5}]},{phase:2,levelCap:50,coin:15000,items:[{id:'material:100110',name:'漆黑陨铁的一粒',count:8}]}]}};
const flower={...base,id:'artifact:15001:flower',name:'角斗士的留恋',category:'artifact',subtype:'生之花',rarity:5,description:'战士佩戴的花。',story:'角斗士的故事。',icon:{...homa.icon,url:'https://gi.yatta.moe/assets/UI/reliquary/UI_RelicIcon_15001_4.png'},artifact:{setId:15001,setName:'角斗士的终幕礼',slot:'flower',setEffects:[{pieces:2,text:'攻击力提高18%。'},{pieces:4,text:'普通攻击造成的伤害提高35%。'}],rarities:[5],rules:[{rarity:5,maxLevel:20,mainStats:[{key:'HP',label:'生命值',unit:'',values:[{level:0,value:717},{level:20,value:4780}]}],substats:[{key:'HP',label:'生命值',unit:'',values:[209,239,269,299]},{key:'ATK',label:'攻击力',unit:'',values:[14,16,18,19]}]}]}};
const quest={...base,id:'material:100110',name:'诗篇断章（上）',category:'quest',subtype:'任务物品',rarity:3,description:'一张被撕下的纸页。',story:'来自古老诗篇的断章。',icon:{identifier:'missing',url:null,status:'missing',provider:'none'}};
const goblet={...flower,id:'artifact:15001:goblet',name:'角斗士的酣醉',subtype:'空之杯',artifact:{...flower.artifact,slot:'goblet',rules:[{rarity:5,maxLevel:20,mainStats:[{key:'HP_PERCENT',label:'生命值百分比',unit:'%',values:[{level:0,value:7},{level:20,value:46.6}]},{key:'ATK_PERCENT',label:'攻击力百分比',unit:'%',values:[{level:0,value:7},{level:20,value:46.6}]}],substats:[{key:'HP_PERCENT',label:'生命值百分比',unit:'%',values:[4.1,4.7,5.3,5.8]},{key:'ATK_PERCENT',label:'攻击力百分比',unit:'%',values:[4.1,4.7,5.3,5.8]}]}]}};
const weapons=[homa,...Array.from({length:23},(_,i)=>({...homa,id:`weapon:${14000+i}`,name:['雾切之回光','终末嗟叹之诗','四风原典','千夜浮梦','赤角石溃杵','渔获'][i%6],rarity:i>5?4:5,icon:{...homa.icon,url:`https://gi.yatta.moe/assets/UI/${['UI_EquipIcon_Sword_Narukami','UI_EquipIcon_Bow_Widsith','UI_EquipIcon_Catalyst_Fourwinds','UI_EquipIcon_Catalyst_Ayus','UI_EquipIcon_Claymore_Itadorimaru','UI_EquipIcon_Pole_Mori'][i%6]}.png`}}))];
const records=[...weapons,flower,goblet,quest];
async function fixture(page:Page,theme='light'){
 await page.addInitScript(theme=>localStorage.setItem('void.preferences',JSON.stringify({theme,locale:'zh-CN',sourceLanguage:'zh-CN',mode:'shared'})),theme);
 await page.route('**/api/status',r=>r.fulfill({json:{ready:true,provider:{model:'fixture',sharedEnabled:true,byok:true}}}));
 await page.route('**/api/items?*',r=>{const q=new URL(r.request().url()).searchParams;const items=records.filter(i=>(!q.get('category')||i.category===q.get('category'))&&(!q.get('q')||i.name.includes(q.get('q')!))&&(!q.get('rarity')||i.rarity===Number(q.get('rarity'))));return r.fulfill({json:{items,total:items.length,page:Number(q.get('page')||1),pageSize:48,snapshotId,ready:true,counts:{weapon:24,artifact:1,quest:1}}})});
 await page.route('**/api/items/*',r=>{const id=decodeURIComponent(new URL(r.request().url()).pathname.split('/').at(-1)!);return r.fulfill({json:{item:records.find(i=>i.id===id)||homa,snapshotId}})});
 await page.route('**/api/library?*',r=>r.fulfill({json:{items:[],total:0,page:1,pageSize:24,snapshotId}}));
 await page.route('**/api/documents/homa-document?*',r=>r.fulfill({json:{document:{id:'homa-document',title:homa.name,type:'weapon',language:'zh-CN',text:homa.story,source,metadata:{},relations:[]},sources:[],snapshotId}}));
}
async function choose(page:Page,label:string,option:string){await page.getByRole('combobox',{name:label,exact:true}).click();await page.getByRole('option',{name:option,exact:true}).click()}
async function selectHoma(page:Page){await page.locator('[data-item-id="weapon:13501"]').click();await expect(page.locator('.museum-detail h2')).toHaveText(homa.name)}
async function settleImages(page:Page){await expect.poll(()=>page.locator('.museum-image img').evaluateAll(images=>images.filter(img=>{const r=img.getBoundingClientRect();return r.top<innerHeight&&r.bottom>0}).every(img=>(img as HTMLImageElement).complete)),{timeout:30000}).toBe(true);await page.waitForTimeout(300)}
for(const theme of ['light','dark'])test(`museum ${theme}: real controls, assets, source and viewport`,async({page},info)=>{
 if(info.project.name==='mobile')await page.setViewportSize({width:390,height:844});
 await fixture(page,theme);await page.goto('/museum');await expect(page.locator('.museum-card')).toHaveCount(24);await settleImages(page);
 await page.screenshot({path:path.resolve(`../../artifacts/screenshots/${info.project.name}-museum-${theme}-grid.png`),scale:'css'});
 await selectHoma(page);await choose(page,'等级与突破','1 · 突破 0');await expect(page.locator('.museum-stats')).toContainText('46');await choose(page,'等级与突破','20 · 突破 0');await expect(page.locator('.museum-stats')).toContainText('122');
 await choose(page,'等级与突破','20 · 突破 1');await expect(page.locator('.museum-stats')).toContainText('153');
 await choose(page,'等级与突破','90 · 突破 6');await expect(page.locator('.museum-stats')).toContainText('608');await expect(page.locator('.museum-stats')).toContainText('66.2%');
 await choose(page,'精炼','精炼 5');await expect(page.locator('.museum-detail')).toContainText('生命值提升40%');
 await page.locator(info.project.name==='mobile'?'.museum-mobile-detail':'.museum-detail-scroll').evaluate(el=>{el.scrollTop=0});await settleImages(page);
 await page.screenshot({path:path.resolve(`../../artifacts/screenshots/${info.project.name}-museum-${theme}-detail.png`),scale:'css'});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.getByRole('tab',{name:'培养',exact:true}).click();await choose(page,'突破阶段','突破 2 · 50');await page.getByRole('button',{name:'累计至此阶段',exact:true}).click();await expect(page.locator('.museum-cost')).toContainText('20,000');
 await page.getByRole('tab',{name:'来源',exact:true}).click();
 const docRequest=page.waitForRequest(r=>r.url().includes('/api/documents/homa-document?'));
 await page.getByRole('button',{name:'查看原始文献',exact:true}).click();expect(new URL((await docRequest).url()).searchParams.get('snapshotId')).toBe(snapshotId);await expect(page.locator('.reading-text')).toContainText(homa.story);
});
test('museum: filters, artifact rules, quest story, fallback and browser back',async({page},info)=>{
 await fixture(page);await page.goto('/museum');await page.getByRole('button',{name:'圣遗物',exact:true}).click();await page.locator(`[data-item-id="${flower.id}"]`).click();
 await choose(page,'圣遗物等级','+20');await expect(page.locator('.museum-stats')).toContainText('4,780');await expect(page.locator('.museum-substats')).not.toContainText('生命值');
 if(info.project.name==='mobile'){await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator(`[data-item-id="${flower.id}"]`)).toBeFocused()}
 await page.getByRole('button',{name:'任务物品',exact:true}).click();await page.locator(`[data-item-id="${quest.id}"]`).click();await expect(page.locator('.museum-detail')).toContainText('图片暂缺');await expect(page.getByRole('tab',{name:'培养',exact:true})).toHaveCount(0);await page.getByRole('tab',{name:'故事',exact:true}).click();await expect(page.locator('.museum-detail')).toContainText(quest.story);
 if(info.project.name==='mobile'){await page.goBack();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator(`[data-item-id="${quest.id}"]`)).toBeFocused()}
 await page.getByRole('searchbox').fill('不存在的道具');await expect(page.locator('.museum-empty')).toContainText('没有找到');await expect(page).toHaveURL(/q=/);await page.getByRole('button',{name:'清除筛选',exact:true}).click();await expect(page.locator('.museum-card')).toHaveCount(24);
});
test('museum: deep link, delayed selection and broken image are safe',async({page},info)=>{
 test.skip(info.project.name==='mobile');await fixture(page);
 await page.route('**/api/items/weapon%3A13501?*',async r=>{await new Promise(resolve=>setTimeout(resolve,700));await r.fulfill({json:{item:homa,snapshotId}})});
 await page.route('**/UI_EquipIcon_Pole_Homa.png',r=>r.abort());
 await page.goto(`/museum?category=weapon&item=weapon%3A13501&snapshotId=${snapshotId}`);await page.locator('[data-item-id="weapon:14000"]').click();await expect(page.locator('.museum-detail h2')).toHaveText('雾切之回光');await page.waitForTimeout(800);await expect(page.locator('.museum-detail h2')).toHaveText('雾切之回光');await expect(page.locator('[data-item-id="weapon:13501"]')).toContainText('图片暂缺');
 await page.reload();await expect(page.locator('.museum-detail h2')).toHaveText('雾切之回光');
});
test('museum: navigation preserves draft and ask pins a new unsent conversation',async({page},info)=>{
 test.skip(info.project.name==='mobile');await fixture(page);await page.goto('/');await page.locator('#question').fill('保留我的草稿');await page.getByRole('button',{name:'道具博览馆',exact:true}).click();await expect(page).toHaveURL(/museum/);await page.goBack();await expect(page.locator('#question')).toHaveValue('保留我的草稿');await page.goForward();await selectHoma(page);
 await page.getByRole('button',{name:'向终端询问此道具',exact:true}).click();await expect(page.locator('#question')).toHaveValue(/护摩之杖/);await page.getByRole('button',{name:'恢复之前的草稿',exact:true}).click();await expect(page.locator('#question')).toHaveValue('保留我的草稿');
 await page.getByRole('button',{name:'道具博览馆',exact:true}).click();await selectHoma(page);await page.getByRole('button',{name:'向终端询问此道具',exact:true}).click();
 let sent=false;await page.route('**/api/chat',r=>{sent=true;expect(r.request().postDataJSON().snapshotId).toBe(snapshotId);return r.fulfill({contentType:'text/event-stream',body:`event: text_delta\ndata: {"text":"fixture reply"}\n\nevent: done\ndata: {"snapshotId":"${snapshotId}","usage":{},"finishReason":"stop"}\n\n`})});
 expect(sent).toBe(false);await page.getByRole('button',{name:'发送',exact:true}).click();await expect(page.locator('.markdown')).toContainText('fixture reply');expect(sent).toBe(true);
});

// Delay the real IndexedDB open success, before historyOperation creates its transaction.
// UI, save(), send(), and the transaction itself remain the production implementation.
async function delayHistory(page:Page){
 await page.addInitScript(()=>{
  const state={hold:false,pending:[] as Array<()=>void>};
  Object.assign(window,{historyDelay:state});
  const open=IDBFactory.prototype.open;
  IDBFactory.prototype.open=function(...args:Parameters<IDBFactory['open']>){
   const request=open.apply(this,args);
   request.addEventListener('success',event=>{
    if(state.hold){event.stopImmediatePropagation();state.pending.push(()=>request.onsuccess?.call(request,event))}
   });
   return request;
  };
 });
}
async function holdHistory(page:Page){await page.evaluate(()=>{(window as unknown as {historyDelay:{hold:boolean}}).historyDelay.hold=true})}
async function releaseHistory(page:Page){
 await page.evaluate(async()=>{
  const state=(window as unknown as {historyDelay:{hold:boolean;pending:Array<()=>void>}}).historyDelay;
  state.hold=false;state.pending.splice(0).forEach(release=>release());
  // A subsequent transaction completes after the released save transaction.
  await new Promise<void>((resolve,reject)=>{const r=indexedDB.open('void-terminal',1);r.onsuccess=()=>{const tx=r.result.transaction('conversations','readonly');tx.objectStore('conversations').getAll();tx.oncomplete=()=>{r.result.close();resolve()};tx.onerror=()=>reject(tx.error)}});
  await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
 });
}
async function awaitHeldHistory(page:Page){await expect.poll(()=>page.evaluate(()=>(window as unknown as {historyDelay:{pending:unknown[]}}).historyDelay.pending.length)).toBe(1)}
async function enterMuseum(page:Page,mobile:boolean){if(mobile)await page.getByRole('button',{name:'Menu',exact:true}).click();await page.getByRole('button',{name:'道具博览馆',exact:true}).click();await selectHoma(page)}

test('museum: Ask cancels a send waiting for initial history persistence',async({page},info)=>{
 await fixture(page);await delayHistory(page);let requests:Array<Record<string,unknown>>=[];
 await page.route('**/api/chat',r=>{requests.push(r.request().postDataJSON());return r.fulfill({contentType:'text/event-stream',body:'event: text_delta\ndata: {"text":"old response"}\n\nevent: done\ndata: {"snapshotId":"old-snapshot"}\n\n'})});
 await page.goto('/');await page.locator('#question').fill('old question');await holdHistory(page);await page.getByRole('button',{name:'发送',exact:true}).click();await awaitHeldHistory(page);
 await enterMuseum(page,info.project.name==='mobile');await page.getByRole('button',{name:'向终端询问此道具',exact:true}).click();
 await expect(page.locator('#question')).toHaveValue(/护摩之杖/);await releaseHistory(page);
 expect(requests).toHaveLength(0);await expect(page.locator('.message')).toHaveCount(0);await expect(page.locator('.stream-stage')).toHaveCount(0);await expect(page.locator('#question')).toHaveValue(/护摩之杖/);
 await page.getByRole('button',{name:'发送',exact:true}).click();await expect.poll(()=>requests.length).toBe(1);expect(requests[0].snapshotId).toBe(snapshotId);
});

test('museum: Restore cancels a send waiting for initial history persistence',async({page},info)=>{
 await fixture(page);await delayHistory(page);let requests=0;
 await page.route('**/api/chat',r=>{requests++;return r.fulfill({contentType:'text/event-stream',body:'event: text_delta\ndata: {"text":"old response"}\n\nevent: done\ndata: {"snapshotId":"old-snapshot"}\n\n'})});
 await page.goto('/');await page.locator('#question').fill('保留我的草稿');await enterMuseum(page,info.project.name==='mobile');await page.getByRole('button',{name:'向终端询问此道具',exact:true}).click();
 await holdHistory(page);await page.getByRole('button',{name:'发送',exact:true}).click();await awaitHeldHistory(page);await page.getByRole('button',{name:'恢复之前的草稿',exact:true}).click();await releaseHistory(page);
 expect(requests).toBe(0);await expect(page.locator('#question')).toHaveValue('保留我的草稿');await expect(page.locator('.main')).toHaveClass('main home');await expect(page.locator('.message')).toHaveCount(0);await expect(page.getByRole('button',{name:'发送',exact:true})).toBeEnabled();
});

test('museum: Stop cancels a send waiting for initial history persistence',async({page})=>{
 await fixture(page);await delayHistory(page);let requests=0;
 await page.route('**/api/chat',r=>{requests++;return r.fulfill({contentType:'text/event-stream',body:'event: done\ndata: {"snapshotId":"old-snapshot"}\n\n'})});
 await page.goto('/');await page.locator('#question').fill('old question');await holdHistory(page);await page.getByRole('button',{name:'发送',exact:true}).click();await awaitHeldHistory(page);
 await page.getByRole('button',{name:'停止生成',exact:true}).click();await releaseHistory(page);
 expect(requests).toBe(0);await expect(page.locator('.stream-stage')).toHaveCount(0);await expect(page.getByRole('button',{name:'停止生成',exact:true})).toHaveCount(0);await expect(page.locator('.inline-error[role="alert"]')).toContainText('已停止');
});

test('museum: Ask cancels an already streaming answer without publishing late events',async({page},info)=>{
 await fixture(page);
 await page.addInitScript(()=>{
  const originalFetch=window.fetch;
  window.fetch=async(...args:Parameters<typeof fetch>)=>{
   if(args[0]!=='/api/chat')return originalFetch(...args);
   const encoder=new TextEncoder();
   return new Response(new ReadableStream({start(controller){
    controller.enqueue(encoder.encode('event: text_delta\ndata: {"text":"first fragment"}\n\n'));
    Object.assign(window,{finishOldStream:()=>{controller.enqueue(encoder.encode('event: text_delta\ndata: {"text":"late old answer"}\n\nevent: done\ndata: {"snapshotId":"old-snapshot"}\n\n'));controller.close()}});
   }}),{headers:{'Content-Type':'text/event-stream'}});
  };
 });
 await page.goto('/');await page.locator('#question').fill('old question');await page.getByRole('button',{name:'发送',exact:true}).click();await expect(page.locator('.markdown')).toContainText('first fragment');
 await enterMuseum(page,info.project.name==='mobile');await page.getByRole('button',{name:'向终端询问此道具',exact:true}).click();await page.evaluate(()=>(window as unknown as {finishOldStream:()=>void}).finishOldStream());
 await expect(page.locator('.message')).toHaveCount(0);await expect(page.locator('#question')).toHaveValue(/护摩之杖/);await expect(page.locator('.stream-stage')).toHaveCount(0);await expect(page.getByRole('button',{name:'发送',exact:true})).toBeEnabled();
});
test('museum: variable artifact main stats exclude matching substats',async({page})=>{
 await fixture(page);await page.goto('/museum?category=artifact&item=artifact%3A15001%3Agoblet');await expect(page.locator('.museum-detail h2')).toHaveText(goblet.name);
 await expect(page.locator('.museum-substats')).not.toContainText('生命值百分比');await choose(page,'主属性','攻击力百分比');await expect(page.locator('.museum-substats')).not.toContainText('攻击力百分比');await expect(page.locator('.museum-substats')).toContainText('生命值百分比');
});
test('museum: server pagination, filters, stale lists, errors and retry',async({page},info)=>{
 test.skip(info.project.name==='mobile');await fixture(page);let fail=false;
 await page.route('**/api/items?*',async r=>{const q=new URL(r.request().url()).searchParams;if(fail)return r.fulfill({status:503,json:{error:{message:'Fixture unavailable'}}});if(q.get('q')==='slow')await new Promise(resolve=>setTimeout(resolve,800));return r.fulfill({json:{items:q.get('q')==='slow'?[quest]:q.get('page')==='2'?[weapons[1]]:[homa],total:49,page:Number(q.get('page')||1),pageSize:48,snapshotId,ready:true,counts:{}}})});
 await page.goto('/museum');await page.getByRole('button',{name:'下一页',exact:true}).click();await expect(page.locator('.museum-card')).toHaveCount(1);await expect(page.locator('.museum-card')).toContainText('雾切之回光');await page.getByRole('button',{name:'上一页',exact:true}).click();await expect(page.locator('.museum-card')).toContainText('护摩之杖');await expect(page).toHaveURL(/page=1/);
 await choose(page,'稀有度','4星');await expect(page).toHaveURL(/rarity=4/);await choose(page,'武器类型','长柄武器');await expect(page).toHaveURL(/weaponType=WEAPON_POLE/);await choose(page,'排序','名称排序');await expect(page).toHaveURL(/sort=name/);await page.getByLabel('包含内部记录').check();await expect(page).toHaveURL(/includeInternal=true/);
 await page.getByRole('searchbox').fill('slow');await page.waitForRequest(r=>new URL(r.url()).searchParams.get('q')==='slow');await page.getByRole('searchbox').fill('fast');await expect(page).toHaveURL(/q=fast/);await page.waitForTimeout(900);await expect(page.locator('.museum-card')).toContainText('护摩之杖');
 fail=true;await page.getByRole('searchbox').fill('failure');await expect(page.locator('.museum-empty').getByRole('alert')).toContainText('Fixture unavailable');fail=false;await page.getByRole('button',{name:'重试',exact:true}).click();await expect(page.locator('.museum-card')).toContainText('护摩之杖');
});
test('museum: UI language, source language and theme remain shared with the shell',async({page},info)=>{
 test.skip(info.project.name==='mobile');await fixture(page);await page.goto('/museum');await page.getByRole('button',{name:'界面语言',exact:true}).click();await expect(page.getByRole('heading',{name:'Item Museum',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Weapons',exact:true})).toHaveAttribute('aria-pressed','true');
 await page.getByRole('button',{name:'Settings',exact:true}).click();const pending=page.waitForRequest(r=>r.url().includes('/api/items?')&&new URL(r.url()).searchParams.get('language')==='en');await choose(page,'Source language','English sources');await page.keyboard.press('Escape');const request=await pending;expect(new URL(request.url()).searchParams.get('snapshotId')).toBe(snapshotId);
});
