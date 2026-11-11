import {test,expect,type Page} from '@playwright/test';
import type {Character} from '../../src/lib/characters';
import type {Document,Locale} from '../../src/lib/contracts';
import type {Item} from '../../src/lib/items';
import records from '../fixtures/archive-language.json';
import {navigateArchive} from '../helpers/archive-navigation-browser';

// Reduced real bilingual records from the immutable local snapshots documented
// in the fixture. Browser routing is mocked; this is not a live-service check.
const snapshotId='archive-language-fixture';
const characters=records.characters as unknown as Record<Locale,Character>;
const items=records.items as unknown as Record<Locale,Item[]>;
const documents=records.documents as unknown as Record<Locale,Document>;
const characterId='avatar:10000002';
async function fixture(page:Page,locale:Locale='en'){
 const calls:URL[]=[];
 await page.addInitScript(locale=>localStorage.setItem('void.preferences',JSON.stringify({theme:'light',locale,sourceLanguage:'zh-CN',mode:'byok'})),locale);
 await page.route('**/api/status',route=>route.fulfill({json:{ready:true,provider:{sharedEnabled:false,model:'fixture',byok:true}}}));
 await page.route('**/api/characters**',route=>{
  const url=new URL(route.request().url());calls.push(url);
  const language=url.searchParams.get('language') as Locale,character=characters[language];
  return route.fulfill({json:url.pathname==='/api/characters'?{characters:[character],total:1,page:1,pageSize:48,snapshotId,ready:true,counts:{Ice:1},regions:[character.region]}:{character,snapshotId}});
 });
 await page.route('**/api/items**',route=>{
  const url=new URL(route.request().url());calls.push(url);
  const language=url.searchParams.get('language') as Locale;
  if(url.pathname==='/api/items'){
   const category=url.searchParams.get('category'),rows=items[language].filter(item=>!category||item.category===category);
   return route.fulfill({json:{items:rows,total:rows.length,page:1,pageSize:48,snapshotId,ready:true,counts:{weapon:1,artifact:1,material:1}}});
  }
  const id=decodeURIComponent(url.pathname.split('/').at(-1)!),item=items[language].find(item=>item.id===id);
  return item?route.fulfill({json:{item,snapshotId}}):route.fulfill({status:404,json:{error:{message:'Material omitted from the reduced fixture'}}});
 });
 await page.route('**/api/library?*',route=>{
  const url=new URL(route.request().url());calls.push(url);
  const language=url.searchParams.get('language') as Locale,document=documents[language];
  return route.fulfill({json:{items:[{id:document.id,title:document.title,type:document.type,language,excerpt:document.text,snapshotId}],total:1,page:1,pageSize:24,snapshotId}});
 });
 await page.route('**/api/documents/**',route=>{
  const url=new URL(route.request().url());calls.push(url);
  const id=decodeURIComponent(url.pathname.split('/').at(-1)!),document=Object.values(documents).find(doc=>doc.id===id);
  return route.fulfill({json:{document,sources:[],snapshotId}});
 });
 return calls;
}
async function switchLanguage(page:Page,language:Locale){
 const current=await page.locator('html').getAttribute('lang'),zh=current!=='en';
 await navigateArchive(page,zh?'设置':'Settings');
 const dialog=page.getByRole('dialog',{name:zh?'设置':'Settings',exact:true});
 await dialog.getByRole('combobox',{name:zh?'界面语言':'Interface language',exact:true}).click();
 await page.getByRole('option',{name:language==='en'?'English':'简体中文',exact:true}).click();
 await page.getByRole('dialog',{name:language==='en'?'Settings':'设置',exact:true}).getByRole('button',{name:language==='en'?'Close':'关闭',exact:true}).click();
}

test('archive language: English character content ignores a saved Chinese research language',async({page},info)=>{
 const calls=await fixture(page);await page.goto('/');await navigateArchive(page,'Character Archive');
 await expect(page.locator('.character-card strong')).toHaveText(characters.en.name);
 await page.locator(`[data-character-id="${characterId}"]`).click();
 await expect(page.locator('.character-identity h1')).toHaveText(characters.en.name);
 await page.getByRole('tab',{name:'Profile',exact:true}).click();
 await expect(page.locator('.character-biography')).toContainText(characters.en.description);
 await expect(page.locator('.character-biography')).toContainText(characters.en.affiliation);
 await page.getByRole('tab',{name:'Stories',exact:true}).click();
 await expect(page.locator('.character-reading')).toContainText(characters.en.stories[0].text.slice(0,70).replace(/\s+/g,' '));
 await page.getByRole('tab',{name:'Talents',exact:true}).click();
 await expect(page.locator('.character-ability-reading')).toContainText(characters.en.forms[0].talents[0].name);
 await expect(page.locator('.character-talent-values')).toContainText('1-Hit DMG');
 await page.getByRole('tab',{name:'Constellations',exact:true}).click();
 await expect(page.locator('.character-ability-reading')).toContainText(characters.en.forms[0].constellations[0].name);
 await page.getByRole('tab',{name:'Cultivation',exact:true}).click();
 await expect(page.locator('.character-material-list').first()).toContainText('Shivada Jade Sliver');
 expect(calls.filter(url=>/^\/api\/(characters|items)/.test(url.pathname)).every(url=>url.searchParams.get('language')==='en')).toBe(true);
 await page.screenshot({path:info.outputPath('english-character-materials.png'),animations:'disabled'});
});

test('archive language: English weapon, artifact and material descriptions use English records',async({page},info)=>{
 const calls=await fixture(page);await page.goto('/');await navigateArchive(page,'Compendium');
 await page.locator('.museum-categories').getByRole('button',{name:'All',exact:true}).click();
 for(const item of items.en){
  await page.locator(`[data-item-id="${item.id}"]`).click();
  const detail=page.locator('.museum-detail');
  await expect(detail.getByRole('heading',{name:item.name,exact:true})).toBeVisible();
  await expect(detail.locator('.museum-description')).toHaveText(item.description);
  if(item.weapon){await expect(detail).toContainText(item.weapon.refinements[0].description);await expect(detail).toContainText('CRIT DMG')}
  if(item.artifact){await expect(detail).toContainText(item.artifact.setName);await expect(detail).toContainText(item.artifact.setEffects[0].text)}
  if(item.id==='material:104161')await page.screenshot({path:info.outputPath('english-material-description.png'),animations:'disabled'});
  await detail.getByRole('button',{name:'Back to items',exact:true}).click();
 }
 expect(calls.filter(url=>url.pathname.startsWith('/api/items')).every(url=>url.searchParams.get('language')==='en')).toBe(true);
 await switchLanguage(page,'zh-CN');
 await page.locator('[data-item-id="weapon:13501"]').click();
 await expect(page.locator('.museum-description')).toHaveText(items['zh-CN'][0].description);
 await page.locator('.museum-detail').getByRole('button',{name:'返回道具列表',exact:true}).click();
 const englishRequests=calls.filter(url=>url.pathname.endsWith('weapon%3A13501')&&url.searchParams.get('language')==='en').length;
 await switchLanguage(page,'en');
 await page.locator('[data-item-id="weapon:13501"]').click();
 await expect(page.locator('.museum-description')).toHaveText(items.en[0].description);
 expect(calls.filter(url=>url.pathname.endsWith('weapon%3A13501')&&url.searchParams.get('language')==='en')).toHaveLength(englishRequests);
});

test('archive language: switching the interface replaces character text and preserves research preference',async({page})=>{
 await fixture(page);await page.goto(`/characters?character=${encodeURIComponent(characterId)}&snapshotId=${snapshotId}&tab=info`);
 await expect(page.locator('.character-biography')).toContainText(characters.en.description);
 await switchLanguage(page,'zh-CN');
 await expect(page.locator('.character-biography')).toContainText(characters['zh-CN'].description);
 await expect(page.locator('.character-biography')).not.toContainText(characters.en.description);
 await switchLanguage(page,'en');
 await expect(page.locator('.character-biography')).toContainText(characters.en.description);
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('void.preferences')!).sourceLanguage)).toBe('zh-CN');
});

test('archive language: a late Chinese character response cannot overwrite English content',async({page})=>{
 await fixture(page,'zh-CN');let release!:()=>void,releasedResponse=false;
 const held=new Promise<void>(resolve=>{release=resolve});
 await page.route('**/api/characters/avatar%3A10000002?*',async route=>{const heldResponse=new URL(route.request().url()).searchParams.get('language')==='zh-CN';if(heldResponse)await held;await route.fallback();if(heldResponse)releasedResponse=true});
 const requested=page.waitForRequest(request=>request.url().includes('/api/characters/avatar%3A10000002?'));
 await page.goto(`/characters?character=${encodeURIComponent(characterId)}&snapshotId=${snapshotId}&tab=info`);await requested;
 try{
  await switchLanguage(page,'en');
  await expect(page.locator('.character-biography')).toContainText(characters.en.description);
 }finally{release()}
 await expect.poll(()=>releasedResponse).toBe(true);
 await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
 await expect(page.locator('.character-identity h1')).toHaveText(characters.en.name);
 await expect(page.locator('.character-biography')).not.toContainText(characters['zh-CN'].description);
});

test('archive language: a late Chinese weapon response cannot overwrite English content',async({page},info)=>{
 test.skip(info.project.name==='mobile');
 await fixture(page,'zh-CN');let release!:()=>void,releasedResponse=false;
 const held=new Promise<void>(resolve=>{release=resolve});
 await page.route('**/api/items/weapon%3A13501?*',async route=>{const heldResponse=new URL(route.request().url()).searchParams.get('language')==='zh-CN';if(heldResponse)await held;await route.fallback();if(heldResponse)releasedResponse=true});
 const requested=page.waitForRequest(request=>request.url().includes('/api/items/weapon%3A13501?'));
 await page.goto(`/museum?item=weapon%3A13501&snapshotId=${snapshotId}`);await requested;
 try{
  await switchLanguage(page,'en');
  await expect(page.locator('.museum-description')).toHaveText(items.en[0].description);
 }finally{release()}
 await expect.poll(()=>releasedResponse).toBe(true);
 await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
 await expect(page.locator('.museum-detail h2')).toHaveText(items.en[0].name);
 await expect(page.locator('.museum-description')).not.toContainText(items['zh-CN'][0].description);
});

test('archive language: English library browsing switches back to Chinese without retaining the old document',async({page})=>{
 const calls=await fixture(page);await page.goto('/');await navigateArchive(page,'Teyvat Archive');
 await expect(page.locator('.library-content')).toContainText(documents.en.title);
 await page.locator('.library-content').getByRole('button').filter({hasText:documents.en.title}).click();
 await expect(page.locator('.reading-text')).toContainText(documents.en.text);
 await switchLanguage(page,'zh-CN');
 await expect(page.locator('.reading-text')).toHaveCount(0);
 await expect(page.locator('.library-content')).toContainText(documents['zh-CN'].title);
 expect(calls.filter(url=>url.pathname==='/api/library').map(url=>url.searchParams.get('language'))).toEqual(expect.arrayContaining(['en','zh-CN']));
});
