import {navigateArchive,watchWarmEntry,expectNoWarmFlash} from '../helpers/archive-navigation-browser';
import {test,expect,type Page} from '@playwright/test';
import type {Character,CharacterVoice} from '../../src/lib/characters';

const snapshotId='character-browser-fixture';
const source={repo:'fixture/source',commit:'fixed-fixture',path:'Avatar.json',locator:'/2',url:'https://example.com/source/Avatar.json'};
const missing={identifier:'',url:null,provider:null,status:'missing'};
const material={id:'104161',itemId:'material:104161',count:3};
const makeVoice=(id:string,title:string):CharacterVoice=>({id,title,text:'用于浏览器交互验收的语音文字。',category:'1',conditions:{},displayStatus:'complete',branches:[],sources:[source],audio:{'zh-CN':{identifier:'604297fe5889d620',url:`/api/characters/avatar:10000002/voices/${id}?audioLanguage=zh-CN`,provider:'genshin-voice',status:'verified',verification:'archive-index'}}});
const ayaka:Character={
 id:'avatar:10000002',avatarId:10000002,language:'zh-CN',name:'神里绫华',title:'白鹭霜华',description:'浏览器验收角色资料。',rarity:5,element:'Ice',elementName:'冰',weaponType:'WEAPON_SWORD_ONE_HAND',weaponName:'单手剑',region:'稻妻',state:'source-record',icon:missing,portrait:missing,
 birthday:{month:9,day:28},affiliation:'社奉行',constellationName:'雪鹤座',cv:{'zh-CN':'验收配音'},sources:[source],documentIds:['character-document'],coverage:{stats:'complete',audio:'complete'},
 forms:[{id:'201',name:'冰',element:'Ice',elementName:'冰',coverage:{stats:'complete'},levels:[{level:1,ascension:0,stats:{FIGHT_PROP_BASE_HP:1000.986,FIGHT_PROP_CRITICAL_HURT:.5}},{level:20,ascension:0,stats:{FIGHT_PROP_BASE_HP:2597.12}},{level:20,ascension:1,stats:{FIGHT_PROP_BASE_HP:3455.38}},{level:90,ascension:6,stats:{FIGHT_PROP_BASE_HP:12858.206654,FIGHT_PROP_BASE_ATTACK:342.025,FIGHT_PROP_CRITICAL_HURT:.884}}],
  talents:[{id:'10024',kind:'normal',name:'神里流·倾',description:'完整的普通攻击说明。',icon:missing,cooldown:null,energyCost:null,unlockAscension:null,coverage:{parameters:'complete'},levels:[{level:1,requiredAscension:null,attributes:[{template:'',text:'一段伤害|45.7%',status:'complete'}],unresolvedAttributeHashes:[],materials:[],mora:null,upgradeable:true},{level:2,requiredAscension:2,attributes:[{template:'',text:'一段伤害|49.5%',status:'complete'}],unresolvedAttributeHashes:[],materials:[material],mora:12500,upgradeable:true}]}],
  constellations:Array.from({length:6},(_,i)=>({id:String(21+i),order:i+1,name:`命之座 ${i+1}`,description:`节点 ${i+1} 的完整效果说明。`,icon:missing}))}],
 stories:[{id:'3201',order:1,title:'角色故事一',text:'',conditions:{tips:['好感等级达到 2 后开启']},displayStatus:'complete',sources:[source],branches:[{id:'male',title:'男性旅行者版本',text:'保留男性旅行者对应文本。',conditions:{travelerGender:'male'},displayStatus:'complete'},{id:'female',title:'女性旅行者版本',text:'保留女性旅行者对应文本。',conditions:{travelerGender:'female'},displayStatus:'complete'}]}],
 voices:[makeVoice('3100','初次见面…'),makeVoice('3101','闲聊·安定')],
 ascensions:[{ascension:0,maxLevel:20,materials:[],mora:null},{ascension:1,maxLevel:40,materials:[material],mora:20000},{ascension:2,maxLevel:50,materials:[{...material,count:5}],mora:40000}],
};
const nahida:Character={...ayaka,id:'avatar:10000073',avatarId:10000073,name:'纳西妲',title:'白草净华',element:'Grass',elementName:'草',region:'须弥',forms:[{...ayaka.forms[0],id:'7301',name:'草',element:'Grass',elementName:'草'}],voices:[]};
const traveler:Character={...ayaka,id:'avatar:10000005',avatarId:10000005,name:'旅行者',title:'远行之人',element:'Wind',elementName:'风',forms:[{...ayaka.forms[0],id:'501',name:'风',element:'Wind',elementName:'风'},{...ayaka.forms[0],id:'502',name:'岩',element:'Rock',elementName:'岩'},{...ayaka.forms[0],id:'503',name:'未记录元素',element:'',elementName:''}],voices:[]};
const travelerPortraitUrl='https://gi.yatta.moe/assets/UI/UI_Gacha_AvatarImg_PlayerBoy.png';
const travelerWithPortrait:Character={...traveler,element:null,elementName:'',icon:{...missing,identifier:'UI_AvatarIcon_PlayerBoy'},portrait:{identifier:'UI_Gacha_AvatarImg_PlayerBoy',url:travelerPortraitUrl,status:'verified',verification:'image-header'},coverage:{...traveler.coverage,portrait:'complete'}};
const characters=[ayaka,nahida];
function wav(){const frames=24000*15,data=Buffer.alloc(44+frames*2);data.write('RIFF');data.writeUInt32LE(data.length-8,4);data.write('WAVEfmt ',8);data.writeUInt32LE(16,16);data.writeUInt16LE(1,20);data.writeUInt16LE(1,22);data.writeUInt32LE(24000,24);data.writeUInt32LE(48000,28);data.writeUInt16LE(2,32);data.writeUInt16LE(16,34);data.write('data',36);data.writeUInt32LE(frames*2,40);return data}
async function fixture(page:Page,options:{delayAyaka?:boolean;failAudio?:boolean;unbuilt?:boolean;images?:boolean;traveler?:boolean;travelerPortrait?:boolean}={}){
 const calls:{audio:number;chat:number;snapshots:string[]}={audio:0,chat:0,snapshots:[]};
 const available=options.travelerPortrait?[...characters,travelerWithPortrait]:options.traveler?[...characters,traveler]:characters;
 const records=options.images?available.map(c=>{const identifier=c===ayaka?'UI_AvatarIcon_Ayaka':'UI_AvatarIcon_Nahida';return {...c,icon:{identifier,url:`https://gi.yatta.moe/assets/UI/${identifier}.png`,provider:'yatta',status:'verified',verification:'image-header'}}}):available;
 await page.addInitScript(()=>{
  localStorage.setItem('void.preferences',JSON.stringify({theme:'light',locale:'zh-CN',sourceLanguage:'zh-CN',mode:'byok'}));
  const played:HTMLMediaElement[]=[];Object.assign(window,{characterPlayed:played});const original=HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play=function(){if(!played.includes(this))played.push(this);return original.call(this)};
 });
 await page.route('**/api/status',r=>r.fulfill({json:{ready:true,provider:{sharedEnabled:false,model:'fixture'},coverage:[]}}));
 await page.route('**/api/chat',r=>{calls.chat++;return r.abort()});
 if(options.images)await page.route('https://gi.yatta.moe/assets/UI/**',r=>r.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jr1kAAAAASUVORK5CYII=','base64')}));
 await page.route('**/api/characters**',async r=>{
  const u=new URL(r.request().url()),parts=decodeURIComponent(u.pathname).split('/').filter(Boolean),p=u.searchParams;
  if(parts[3]==='voices'){calls.audio++;calls.snapshots.push(p.get('snapshotId')||'');return options.failAudio&&calls.audio===1?r.fulfill({status:503,json:{error:{message:'Fixture audio unavailable'}}}):r.fulfill({contentType:'audio/wav',body:wav()})}
  if(parts.length===3){const character=records.find(c=>c.id===parts[2]);if(options.delayAyaka&&character===ayaka)await new Promise(resolve=>setTimeout(resolve,400));return r.fulfill({json:{character,snapshotId}})}
  const rows=records.filter(c=>(!p.get('q')||c.name.includes(p.get('q')!))&&(!p.get('element')||c.element===p.get('element')));
  return r.fulfill({json:{characters:options.unbuilt?[]:rows,total:rows.length,page:1,pageSize:48,snapshotId,ready:!options.unbuilt,counts:{Ice:1,Grass:1},regions:['稻妻','须弥']}});
 });
 await page.route('**/api/items/*',r=>{calls.snapshots.push(new URL(r.request().url()).searchParams.get('snapshotId')||'');return r.fulfill({json:{item:{id:material.itemId,language:'zh-CN',name:'哀叙冰玉碎屑',icon:missing},snapshotId}})});
 await page.route('**/api/library?*',r=>r.fulfill({json:{items:[],total:0,page:1,pageSize:24,snapshotId}}));
 await page.route('**/api/documents/character-document?*',r=>{calls.snapshots.push(new URL(r.request().url()).searchParams.get('snapshotId')||'');return r.fulfill({json:{document:{id:'character-document',title:'角色原始文献',type:'character',language:'zh-CN',text:'来自同一快照的角色原始资料。',source,metadata:{},relations:[]},sources:[],snapshotId}})});
 return calls;
}
async function choose(page:Page,label:string,option:string){await page.getByRole('combobox',{name:label,exact:true}).click();await page.getByRole('option',{name:option,exact:true}).click()}
async function openAyaka(page:Page){await page.goto('/characters');await page.locator('.character-card[data-character-id="avatar:10000002"]').click();await expect(page.locator('[data-character-detail] h1')).toHaveText('神里绫华')}
async function audioState(page:Page){return page.evaluate(()=>((window as unknown as {characterPlayed:HTMLMediaElement[]}).characterPlayed).map(a=>({paused:a.paused,time:a.currentTime,src:a.getAttribute('src')})))}

test('characters: failed verified Traveler portrait uses local art with separate source coverage',async({page})=>{
 await fixture(page,{travelerPortrait:true});
 await page.route(travelerPortraitUrl,route=>route.fulfill({status:404,body:'Not found'}));
 const failed=page.waitForResponse(r=>r.url()===travelerPortraitUrl&&r.status()===404);
 await page.goto('/characters?character=avatar%3A10000005');
 await failed;
 const portrait=page.locator('.character-portrait-stage').getByRole('img',{name:'旅行者',exact:true});
 await expect(portrait).toHaveAttribute('src','/assets/genshin-ui/traveler/UI_Gacha_AvatarImg_PlayerBoy.png');
 await expect.poll(()=>portrait.evaluate(img=>(img as HTMLImageElement).naturalWidth)).toBe(1920);
 await page.getByRole('button',{name:'来源与覆盖',exact:true}).click();
 const evidence=page.getByRole('region',{name:'来源与覆盖'});
 await expect(evidence.locator('dl').getByText('立绘',{exact:true}).locator('..')).toContainText('已覆盖');
 await expect(evidence.getByRole('link',{name:/UI_Gacha_AvatarImg_PlayerBoy/})).toHaveAttribute('href',/Rollphes\/genshin-manager\/blob\/cfea64f3f4afbfb8cf6fd3c35088c78528515ca8\/initImages\//);
 await expect(evidence.getByText('补充立绘来源',{exact:true})).toBeVisible();
});

test('characters: archive fonts and original stat/rarity sprites load locally',async({page})=>{
 await fixture(page);
 const loadedSprites=new Set<string>(),fontOrigins=new Set<string>();
 page.on('response',r=>{if(r.ok()&&r.url().includes('/assets/genshin-ui/'))loadedSprites.add(new URL(r.url()).pathname.split('/').at(-1)!);});
 page.on('request',r=>{if(r.resourceType()==='font')fontOrigins.add(new URL(r.url()).origin)});
 await openAyaka(page);
 const stats=page.locator('.character-stat-list'),hp=stats.locator('dt').filter({hasText:'基础生命值'});
 await expect(hp.locator('[aria-hidden=true]')).toBeVisible();
 await expect(stats.getByText('12,858',{exact:true})).toBeVisible();
 await expect.poll(()=>[...loadedSprites]).toEqual(expect.arrayContaining(['UI_Icon_MaxHp.png','UI_Icon_Critical.png','UI_IconStar.png']));
 await expect(hp).toHaveCSS('font-family',/ArchiveUI/);
 const loadedFonts=await page.evaluate(async()=>{
  await document.fonts.ready;
  return [...document.fonts].filter(f=>f.family.replaceAll('"','')==='ArchiveUI'&&f.status==='loaded').length;
 });
 expect(loadedFonts).toBeGreaterThan(0);
 expect([...fontOrigins]).toEqual([new URL(page.url()).origin]);
});

test('characters: stats, talents, narrative branches and same-snapshot cultivation',async({page},info)=>{
 const calls=await fixture(page);await openAyaka(page);
 const identity=page.locator('.character-identity');await expect(identity.getByRole('heading',{name:'神里绫华',exact:true})).toBeVisible();await expect(identity).toContainText('白鹭霜华 · 单手剑');await expect(identity.getByRole('img',{name:'冰',exact:true})).toBeVisible();await expect(identity).not.toContainText('冰');await expect(identity.getByLabel('5星')).toBeVisible();
 const [headerBox,identityBox,menuBox,portraitBox]=await Promise.all([page.locator('.character-detail-header').boundingBox(),identity.boundingBox(),page.locator('.character-section-menu').boundingBox(),page.locator('.character-portrait-stage').boundingBox()]);
 expect(identityBox!.y).toBeGreaterThanOrEqual(headerBox!.y+headerBox!.height-1);expect(portraitBox!.y).toBeGreaterThanOrEqual(identityBox!.y+identityBox!.height-1);
 if(info.project.name==='mobile')expect(identityBox!.y).toBeGreaterThanOrEqual(menuBox!.y+menuBox!.height-1);else {expect(identityBox!.x).toBeGreaterThanOrEqual(menuBox!.x+menuBox!.width-1);const name=await identity.locator('h1').boundingBox(),stats=await page.locator('.character-stats-panel h2').boundingBox();expect(Math.abs(name!.y-stats!.y)).toBeLessThan(2)}
 await expect(page.locator('.character-stat-list')).toContainText('12,858');await expect(page.locator('.character-stat-list')).toContainText('88.4%');
 await choose(page,'等级与突破','等级 20 · 突破 0');await expect(page.locator('.character-stat-list')).toContainText('2,597');
 await choose(page,'等级与突破','等级 20 · 突破 1');await expect(page.locator('.character-stat-list')).toContainText('3,455');
 await page.getByRole('tab',{name:'命之座',exact:true}).click();await expect(identity).toBeInViewport();await page.getByRole('button',{name:'6 命之座 6',exact:true}).click();await expect(page.locator('.character-ability-reading')).toContainText('节点 6 的完整效果说明');
 await page.getByRole('tab',{name:'天赋',exact:true}).click();await choose(page,'天赋等级','等级 2');await expect(page.locator('.character-talent-values')).toContainText('49.5%');
 await page.getByRole('tab',{name:'资料',exact:true}).click();await page.getByRole('tab',{name:'故事',exact:true}).click();await expect(page.locator('.character-reading')).toContainText('好感等级达到 2 后开启');await expect(page.locator('.character-reading')).toContainText('男性旅行者对应文本');await expect(page.locator('.character-reading')).toContainText('女性旅行者对应文本');
 await page.getByRole('tab',{name:'培养',exact:true}).click();await expect(identity).toBeInViewport();await page.getByLabel('显示累计数量').check();await expect(page.locator('.character-material-list').first()).toContainText('60,000');
 const link=page.locator('.character-material-list').first().getByRole('link');await expect(link).toContainText('哀叙冰玉碎屑');expect(new URL(await link.getAttribute('href')||'', 'http://local').searchParams.get('snapshotId')).toBe(snapshotId);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.getByRole('button',{name:'查看原始文献',exact:true}).click();await expect(page.locator('.reading-text')).toContainText('来自同一快照的角色原始资料');expect(calls.snapshots.every(s=>s===snapshotId)).toBe(true);expect(calls.chat).toBe(0);
});

test('characters: decoded playback retries and stops on line and tab changes',async({page})=>{
 const calls=await fixture(page,{failAudio:true});await openAyaka(page);await page.getByRole('tab',{name:'资料',exact:true}).click();await page.getByRole('tab',{name:'语音',exact:true}).click();
 await page.getByRole('button',{name:'播放语音',exact:true}).click();await expect(page.getByRole('button',{name:'重试播放',exact:true})).toBeVisible();await page.getByRole('button',{name:'重试播放',exact:true}).click();
 await expect.poll(async()=> (await audioState(page)).some(a=>!a.paused&&a.time>0)).toBe(true);
 await page.getByRole('button',{name:'闲聊·安定',exact:true}).click();await expect.poll(async()=> (await audioState(page)).every(a=>a.paused&&!a.src)).toBe(true);
 await page.getByRole('button',{name:'播放语音',exact:true}).click();await expect.poll(async()=> (await audioState(page)).filter(a=>!a.paused).length).toBe(1);
 await page.getByRole('tab',{name:'属性',exact:true}).click();await expect.poll(async()=> (await audioState(page)).every(a=>a.paused&&!a.src)).toBe(true);expect(calls.audio).toBe(3);expect(calls.snapshots.every(s=>s===snapshotId)).toBe(true);
});

test('characters: URL back restores filtering and ask remains an unsent draft',async({page})=>{
 const calls=await fixture(page);await page.goto('/characters');await page.getByRole('searchbox',{name:'搜索角色',exact:true}).fill('绫华');await expect(page.locator('.character-card')).toHaveCount(1);await page.locator('.character-card').click();await expect(page.locator('[data-character-detail]')).toBeVisible();await page.goBack();await expect(page.getByRole('searchbox',{name:'搜索角色',exact:true})).toHaveValue('绫华');await expect(page.locator('.character-card')).toHaveCount(1);
 await page.locator('.character-card').click();await page.getByRole('button',{name:'向终端询问',exact:true}).click();await expect(page.locator('#question')).toHaveValue(/神里绫华.*avatar:10000002/);expect(calls.chat).toBe(0);await page.getByRole('button',{name:'恢复之前的草稿',exact:true}).click();await expect(page.locator('#question')).toHaveValue('');
});

test('characters: historical unbuilt snapshot has an explicit empty state',async({page})=>{
 await fixture(page,{unbuilt:true});await page.goto('/characters?snapshotId=old-snapshot');await expect(page.getByRole('heading',{name:'此快照尚未构建角色图鉴'})).toBeVisible();await expect(page.locator('.character-card')).toHaveCount(0);
});

test('characters: browser back cancels a slower character response',async({page})=>{
 await fixture(page,{delayAyaka:true});await page.goto('/characters?character=avatar:10000073&snapshotId='+snapshotId);
 await expect(page.locator('[data-character-detail] h1')).toHaveText('纳西妲');
 await page.locator('.character-avatar-strip [data-character-id="avatar:10000002"]').click();await page.goBack();
 await expect(page.locator('[data-character-detail] h1')).toHaveText('纳西妲');await page.waitForTimeout(500);await expect(page.locator('[data-character-detail] h1')).toHaveText('纳西妲');
});

test('characters: a slow switch keeps the focused avatar and reserves the stat values',async({page},info)=>{
 await fixture(page);
 let release!:()=>void;
 const pending=new Promise<void>(resolve=>{release=resolve});
 await page.route('**/api/characters/avatar%3A10000002?*',async route=>{await pending;await route.fallback()});
 await page.goto('/');
 await navigateArchive(page,'群星图鉴');
 await page.locator('.character-card[data-character-id="avatar:10000073"]').click();
 await expect(page.locator('[data-character-detail] h1')).toHaveText('纳西妲');
 const avatar=page.locator('.character-avatar-strip [data-character-id="avatar:10000002"]');
 try{
  await avatar.focus();
  await avatar.press('Enter');
  await expect(avatar).toBeFocused();
  await expect(avatar).toHaveAttribute('aria-pressed','true');
  await expect(page.getByRole('heading',{name:'神里绫华',exact:true})).toBeVisible();
  await expect(page.locator('.character-stat-list dd').first()).toHaveText('—');
  await page.screenshot({path:info.outputPath('character-pending.png'),scale:'css',animations:'disabled'});
 }finally{release()}
 await expect(page.locator('.character-stat-list dd').first()).toHaveText('12,858');
 await expect(avatar).toBeFocused();
});

test('characters: preparing a question preserves an existing unsent draft',async({page},info)=>{
 const calls=await fixture(page);await page.goto('/');await page.locator('#question').fill('保留我的旧草稿');
 if(info.project.name==='mobile')await page.getByRole('button',{name:'Menu',exact:true}).click();
 await page.getByRole('button',{name:'群星图鉴',exact:true}).click();await page.locator('.character-card[data-character-id="avatar:10000002"]').click();
 await page.getByRole('button',{name:'向终端询问',exact:true}).click();await expect(page.locator('#question')).toHaveValue(/神里绫华/);expect(calls.chat).toBe(0);
 await page.getByRole('button',{name:'恢复之前的草稿',exact:true}).click();await expect(page.locator('#question')).toHaveValue('保留我的旧草稿');
});

test('characters: a direct profile link loads lazy avatar images without visiting the grid',async({page})=>{
 await fixture(page,{images:true});await page.goto('/characters?character=avatar:10000002&tab=info&subtab=voices&snapshotId='+snapshotId);
 const images=page.locator('.character-avatar-strip img');await expect(images).toHaveCount(2);
 await expect.poll(()=>images.evaluateAll(nodes=>nodes.every(node=>node.getBoundingClientRect().width>20&&(node as HTMLImageElement).complete&&(node as HTMLImageElement).naturalWidth>0))).toBe(true);
});

test('characters: direct profile snapshot resolution surfaces list failure and retries before loading pinned detail',async({page})=>{
 await fixture(page);let listCalls=0;const detailSnapshots:string[]=[];
 await page.route('**/api/characters**',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname==='/api/characters'){
   listCalls++;
   if(listCalls===1)return route.fulfill({status:503,json:{error:{message:'Fixture snapshot resolution unavailable'}}});
  }else detailSnapshots.push(url.searchParams.get('snapshotId')||'');
  return route.fallback();
 });
 await page.goto('/characters?character=avatar:10000002');
 await expect(page.locator('.character-state').getByRole('alert')).toHaveText('Fixture snapshot resolution unavailable');
 expect(detailSnapshots).toEqual([]);
 await page.getByRole('button',{name:'重试',exact:true}).click();
 await expect(page.locator('[data-character-detail] h1')).toHaveText('神里绫华');
 expect(listCalls).toBeGreaterThanOrEqual(2);
 expect(detailSnapshots.length).toBeGreaterThan(0);
 expect(detailSnapshots.every(snapshot=>snapshot===snapshotId)).toBe(true);
 expect(new URL(page.url()).searchParams.get('snapshotId')).toBe(snapshotId);
});

test('characters: same-tab material navigation preserves the shell and an existing unsent draft',async({page},info)=>{
 const calls=await fixture(page);await page.goto('/');await page.locator('#question').fill('REVIEW_UNSENT_DRAFT');
 await page.route('**/api/items**',route=>{
  const url=new URL(route.request().url()),item={id:material.itemId,language:'zh-CN',name:'哀叙冰玉碎屑',category:'material',subtype:'角色突破材料',rarity:2,description:'用于角色突破的材料。',story:'',state:'source-record',icon:missing,rawIds:[material.id],documentIds:[],sources:[source],attributes:[],acquisition:[],coverage:{}};
  return route.fulfill({json:url.pathname==='/api/items'?{items:[item],total:1,page:1,pageSize:48,snapshotId,ready:true,counts:{material:1}}:{item,snapshotId}});
 });
 await page.evaluate(()=>Object.assign(window,{characterShellMarker:'preserved'}));
 if(info.project.name==='mobile')await page.getByRole('button',{name:'Menu',exact:true}).click();
 await page.getByRole('button',{name:'群星图鉴',exact:true}).click();await page.locator('.character-card[data-character-id="avatar:10000002"]').click();
 await page.getByRole('tab',{name:'培养',exact:true}).click();
 await expect(page.getByRole('button',{name:'返回图鉴',exact:true})).toHaveCount(1);
 const materialLink=page.locator('.character-material-list').first().getByRole('link');
 await expect(materialLink).toContainText('哀叙冰玉碎屑');await materialLink.click();
 await expect(page.locator('.museum-workspace')).toBeVisible();
 expect(new URL(page.url()).searchParams.get('snapshotId')).toBe(snapshotId);
 expect(new URL(page.url()).searchParams.get('item')).toBe(material.itemId);
 expect(await page.evaluate(()=>(window as unknown as {characterShellMarker?:string}).characterShellMarker)).toBe('preserved');
 if(info.project.name==='mobile'){
  await page.getByRole('dialog').getByRole('button',{name:'返回道具列表',exact:true}).click();
  await page.getByRole('button',{name:'Menu',exact:true}).click();
 }
 await page.getByRole('button',{name:'群星图鉴',exact:true}).click();
 await page.getByRole('button',{name:'向终端询问',exact:true}).click();
 await page.getByRole('button',{name:'恢复之前的草稿',exact:true}).click();
 await expect(page.locator('#question')).toHaveValue('REVIEW_UNSENT_DRAFT');expect(calls.chat).toBe(0);
});

test('characters: seven original element filters keep their accessible labels and filter the list',async({page})=>{
 await fixture(page);await page.goto('/characters');
 const filters=page.getByRole('navigation',{name:'元素筛选',exact:true});
 for(const [token,label] of [['Fire','火'],['Water','水'],['Wind','风'],['Electric','雷'],['Ice','冰'],['Rock','岩'],['Grass','草']]){
  const button=filters.getByRole('button',{name:label,exact:true}),icon=button.locator('[data-element-icon]');
  await expect(icon).toHaveCount(1);expect(await icon.evaluate(node=>getComputedStyle(node).maskImage)).toContain('UI_Icon_Element_'+token+'.png');
  await button.click();await expect(button).toHaveAttribute('aria-pressed','true');await expect.poll(()=>new URL(page.url()).searchParams.get('element')).toBe(token);
 }
 await expect(page.locator('.character-card')).toHaveCount(1);const card=page.locator('.character-card');await expect(card).toContainText('纳西妲');await expect(card.locator('[data-element-icon="Grass"]')).toBeVisible();
});

test('characters: Traveler identity follows the selected form and leaves missing elements without a guessed icon',async({page})=>{
 await fixture(page,{traveler:true});await page.goto('/characters?character=avatar:10000005&snapshotId='+snapshotId);
 const identity=page.locator('.character-identity');await expect(identity.getByRole('heading',{name:'旅行者',exact:true})).toBeVisible();await expect(identity).toContainText('远行之人');await expect(identity.locator('[data-element-icon="Wind"]')).toBeVisible();
 await choose(page,'元素形态','岩 · 502');await expect(identity.getByRole('img',{name:'岩',exact:true})).toBeVisible();await expect(identity).not.toContainText('岩');await expect(identity.locator('[data-element-icon="Rock"]')).toBeVisible();await expect(identity.locator('[data-element-icon="Wind"]')).toHaveCount(0);
 await page.getByRole('tab',{name:'资料',exact:true}).click();await expect(identity).toBeInViewport();await expect(identity.locator('[data-element-icon="Rock"]')).toBeVisible();
 await choose(page,'元素形态','未记录元素 · 503');await expect(identity.locator('[data-element-icon]')).toHaveCount(0);await expect(identity).not.toContainText('风');await expect(identity.getByRole('heading',{name:'旅行者',exact:true})).toBeVisible();
});

test('characters: warm return restores filtered query and profile without loading, and stops audio on exit',async({page})=>{
 await fixture(page);let requests=0;page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/characters')&&!r.url().includes('/voices/'))requests++});
 await page.goto('/characters');await page.getByRole('searchbox').fill('神里');await expect(page.locator('.character-card')).toHaveCount(1);
 await page.locator('.character-card').click();await page.getByRole('tab',{name:'资料',exact:true}).click();await page.getByRole('tab',{name:'语音',exact:true}).click();
 await page.getByRole('button',{name:'播放语音',exact:true}).click();await expect.poll(async()=> (await audioState(page)).some(a=>!a.paused)).toBe(true);
 const url=page.url(),before=requests;
 await navigateArchive(page,'尘世文卷');await expect(page.locator('.character-workspace')).toHaveCount(0);
 await expect.poll(async()=> (await audioState(page)).every(a=>a.paused&&!a.src)).toBe(true);
 await watchWarmEntry(page,'characters');await navigateArchive(page,'群星图鉴');
 await expect(page.locator('[data-character-detail] h1')).toHaveText('神里绫华');await expect(page.getByRole('tab',{name:'语音',exact:true})).toHaveAttribute('aria-selected','true');
 expect(page.url()).toBe(url);await expectNoWarmFlash(page);expect(requests).toBe(before);
 await page.getByRole('button',{name:'返回图鉴',exact:true}).click();await expect(page.getByRole('searchbox')).toHaveValue('神里');await expect(page.locator('.character-card')).toHaveCount(1);
 await page.goBack();await expect(page.locator('[data-character-detail] h1')).toHaveText('神里绫华');await expectNoWarmFlash(page);
});

test('characters: warm profile restores its own tab scroll after a module switch',async({page})=>{
 await fixture(page);await page.route('**/api/characters/avatar%3A10000002?*',r=>r.fulfill({json:{character:{...ayaka,description:Array.from({length:60},()=>ayaka.description).join('\n\n')},snapshotId}}));
 await page.goto('/characters?character=avatar:10000002&tab=info&snapshotId='+snapshotId);await expect(page.locator('[data-character-detail] h1')).toHaveText('神里绫华');
 const scroll=page.locator('.character-section-content');await scroll.evaluate(el=>{el.scrollTop=420});const before=await scroll.evaluate(el=>el.scrollTop);expect(before).toBeGreaterThan(300);
 await navigateArchive(page,'尘世文卷');await expect(page.locator('.character-workspace')).toHaveCount(0);await navigateArchive(page,'群星图鉴');
 await expect(page.locator('[data-character-detail] h1')).toHaveText('神里绫华');await expect.poll(()=>scroll.evaluate(el=>el.scrollTop)).toBe(before);
});

test('characters: leaving before snapshot resolution cannot replace the new module URL',async({page})=>{
 await fixture(page);let started=false;
 await page.route('**/api/characters?*',async r=>{started=true;await new Promise(resolve=>setTimeout(resolve,500));await r.fallback()});
 await page.goto('/characters');await expect.poll(()=>started).toBe(true);await navigateArchive(page,'尘世文卷');await expect(page.locator('.library-scroll')).toBeVisible();
 await page.waitForTimeout(600);await expect(page).toHaveURL(/\/$/);await expect(page.locator('.character-workspace')).toHaveCount(0);
});

test('characters: a material link supersedes a pending generic Museum transition with its explicit snapshot',async({page})=>{
 await fixture(page);await page.route('**/api/items**',route=>{
  const url=new URL(route.request().url()),snapshot=url.searchParams.get('snapshotId')||'generic-snapshot';
  const item={id:material.itemId,language:'zh-CN',name:'哀叙冰玉碎屑',category:'material',subtype:'角色突破材料',rarity:2,description:'用于角色突破的材料。',story:'',state:'source-record',icon:missing,rawIds:[material.id],documentIds:[],sources:[source],attributes:[],acquisition:[],coverage:{}};
  return route.fulfill({json:url.pathname==='/api/items'?{items:[item],total:1,page:1,pageSize:48,snapshotId:snapshot,ready:true,counts:{material:1}}:{item,snapshotId:snapshot}});
 });
 await openAyaka(page);await page.getByRole('tab',{name:'培养',exact:true}).click();await expect(page.locator('.character-material-list').first().getByRole('link')).toContainText('哀叙冰玉碎屑');
 await page.evaluate(()=>{
  const native=document.startViewTransition.bind(document);let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve});
  Object.assign(window,{releaseMaterialTransition:release});
  document.startViewTransition=callback=>native(async()=>{await held;await (callback as ()=>void|Promise<void>)()});
  document.querySelector<HTMLButtonElement>('#desktop-navigation .nav-item[aria-label="万象集录"]')!.click();
  document.querySelector<HTMLAnchorElement>('.character-material-list a')!.click();
 });
 expect(new URL(page.url()).searchParams.get('item')).toBe(material.itemId);expect(new URL(page.url()).searchParams.get('snapshotId')).toBe(snapshotId);
 await page.evaluate(()=>(window as unknown as {releaseMaterialTransition:()=>void}).releaseMaterialTransition());
 await expect(page.locator('.museum-detail h2')).toHaveText('哀叙冰玉碎屑');expect(new URL(page.url()).searchParams.get('snapshotId')).toBe(snapshotId);
});

test('characters: browser Back restores language-specific list scroll after changing source language',async({page})=>{
 await fixture(page);await page.route('**/api/characters?*',route=>{
  const params=new URL(route.request().url()).searchParams,language=params.get('language')||'zh-CN',element=params.get('element')||'Ice';
  const records=Array.from({length:48},(_,i)=>({...ayaka,id:`avatar:${10000100+i}`,name:`${language==='en'?'EN':'ZH'}-${element}-${i}`,language,element}));
  return route.fulfill({json:{characters:records,total:48,page:1,pageSize:48,snapshotId,ready:true,counts:{Ice:48,Grass:48},regions:[]}});
 });
 await page.goto('/characters?element=Ice&snapshotId='+snapshotId);await expect(page.locator('.character-card')).toHaveCount(48);
 const grid=page.locator('.character-grid-scroll');await grid.evaluate(el=>{el.scrollTop=360});await expect.poll(()=>page.evaluate(()=>history.state.characterScroll)).toBe(360);
 await navigateArchive(page,'设置');await choose(page,'资料语言','English sources');await page.getByRole('dialog',{name:'设置',exact:true}).getByRole('button',{name:'关闭',exact:true}).click();
 await expect(page.locator('.character-card strong').first()).toHaveText('EN-Ice-0');await grid.evaluate(el=>{el.scrollTop=720});await expect.poll(()=>page.evaluate(()=>history.state.characterScroll)).toBe(720);
 await page.locator('.character-elements button[data-element="Grass"]').click();await expect(page.locator('.character-card strong').first()).toHaveText('EN-Grass-0');
 await page.goBack();await expect(page.locator('.character-card strong').first()).toHaveText('EN-Ice-0');await expect.poll(()=>grid.evaluate(el=>el.scrollTop)).toBe(720);
});
