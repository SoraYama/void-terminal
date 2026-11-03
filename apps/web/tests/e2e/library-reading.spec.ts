import {test,expect,type Page} from '@playwright/test';
import path from 'node:path';

const passage=Array.from({length:60},(_,i)=>`第${i+1}段。经由烈焰焚烧才会盛开的花朵，记录着旅途中尚未遗忘的故事。`).join('\n\n');
const source={id:'reading-source',documentId:'reading-book',title:'渡火者的决绝',type:'artifact',language:'zh-CN',text:passage,path:'fixtures/reading.json',locator:'text:1',snapshotId:'reading-fixture',citation:1};
async function openLibrary(page:Page,theme:'light'|'dark'){
 await page.addInitScript(theme=>{if(!localStorage.getItem('void.preferences'))localStorage.setItem('void.preferences',JSON.stringify({theme,locale:'zh-CN',sourceLanguage:'zh-CN',mode:'byok'}))},theme);
 await page.route('**/api/status',r=>r.fulfill({json:{ready:true,provider:{model:'fixture',sharedEnabled:false,byok:true},coverage:[]}}));
 await page.route('**/api/library?*',r=>r.fulfill({json:{items:[{id:'reading-book',title:source.title,type:'artifact',language:'zh-CN',excerpt:passage,snapshotId:'reading-fixture'}],total:1,page:1,pageSize:24,snapshotId:'reading-fixture'}}));
 await page.route('**/api/documents/reading-book?*',r=>r.fulfill({json:{document:{id:'reading-book',title:source.title,type:'artifact',language:'zh-CN',text:passage,source:{repo:'fixture',commit:'fixture',path:source.path,locator:source.locator},metadata:{},relations:[]},sources:[source],snapshotId:'reading-fixture'}}));
 await page.goto('/');
 const menu=page.getByRole('button',{name:'Menu',exact:true});if(await menu.isVisible())await menu.click();
 await page.getByRole('button',{name:'原文库',exact:true}).click();
 await page.locator('.document-card').click();await expect(page.locator('.reading-text')).toContainText('第60段');
}
for(const theme of ['light','dark'] as const){
 test(`library: ${theme} full-height reading, fading scrollbars and retained source actions`,async({page},info)=>{
  await openLibrary(page,theme);
  const scroll=page.locator('.library-scroll');
  const bounds=await scroll.boundingBox();expect(bounds!.height/page.viewportSize()!.height).toBeGreaterThan(.88);
  await expect(page.locator('.reading-text')).toBeVisible();
  await page.getByRole('button',{name:'原始文本',exact:true}).click();await expect(page.locator('.reading-text')).toHaveText(passage);
  await page.getByRole('button',{name:'阅读排版',exact:true}).click();
  const initialWidth=(await page.locator('.reading-text').boundingBox())!.width;
  expect(initialWidth).toBeGreaterThan(Math.min(640,page.viewportSize()!.width-48));
  await page.screenshot({path:path.resolve(`../../artifacts/screenshots/${info.project.name}-library-${theme}-expanded.png`),scale:'css',style:'nextjs-portal{visibility:hidden}'});
  await scroll.hover();await page.mouse.wheel(0,650);
  await expect(page.locator('.library-header')).toHaveAttribute('data-compact','true');
  await expect(page.locator('.library-header')).toHaveCSS('opacity','1');
  await expect.poll(()=>scroll.evaluate(el=>getComputedStyle(el).getPropertyValue('--scroll-thumb').trim())).not.toBe('rgba(0, 0, 0, 0)');
  await expect(scroll).toHaveAttribute('data-scrolling','true');
  await page.screenshot({path:path.resolve(`../../artifacts/screenshots/${info.project.name}-library-${theme}-scrolling.png`),scale:'css',style:'nextjs-portal{visibility:hidden}'});
  await expect(scroll).not.toHaveAttribute('data-scrolling','true');
  await expect.poll(()=>scroll.evaluate(el=>getComputedStyle(el).getPropertyValue('--scroll-thumb').trim())).toBe('rgba(0, 0, 0, 0)');
  await page.screenshot({path:path.resolve(`../../artifacts/screenshots/${info.project.name}-library-${theme}-reading.png`),scale:'css',style:'nextjs-portal{visibility:hidden}'});
  await page.getByRole('button',{name:'与原文对话',exact:true}).click();
  await expect(page.locator('.reading-assistant .source-mini')).toBeInViewport();
  await page.locator('.library-header .reader-back').click();await expect(page.locator('.document-card')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 });
}
test('navigation: desktop collapse persists while mobile drawer remains usable',async({page},info)=>{
 test.skip(info.project.name!=='desktop');
 await openLibrary(page,'dark');
 const sidebar=page.locator('.sidebar');
 await expect(page.locator('.sidebar-header .sidebar-toggle')).toHaveCount(0);
 expect((await page.locator('.sidebar-header .brand-wordmark').boundingBox())!.width).toBeGreaterThan(140);
 expect((await page.getByRole('button',{name:'收起菜单',exact:true}).boundingBox())!.y).toBeGreaterThan(page.viewportSize()!.height-90);
 const before=(await page.getByRole('main').boundingBox())!.width;
 await page.getByRole('button',{name:'收起菜单',exact:true}).click();
 await expect(page.getByRole('button',{name:'展开菜单',exact:true})).toHaveAttribute('aria-expanded','false');
 await expect.poll(async()=>(await page.getByRole('main').boundingBox())!.width).toBeGreaterThan(before+100);
 await expect.poll(async()=>(await sidebar.boundingBox())!.width).toBe(76);
 await page.screenshot({path:path.resolve('../../artifacts/screenshots/desktop-library-collapsed.png'),scale:'css',style:'nextjs-portal{visibility:hidden}'});
 await page.reload();await expect(page.getByRole('button',{name:'展开菜单',exact:true})).toBeVisible();
 await page.setViewportSize({width:390,height:844});
 await page.getByRole('button',{name:'Menu',exact:true}).click();
 const drawer=page.getByRole('dialog');await expect(drawer.getByRole('button',{name:'设置',exact:true})).toBeVisible();
 await drawer.getByRole('button',{name:'原文库',exact:true}).click();await expect(drawer).toHaveCount(0);
 await expect(page.locator('.document-card')).toBeVisible();
 await page.setViewportSize({width:1440,height:900});await page.getByRole('button',{name:'展开菜单',exact:true}).click();
 await expect(page.getByRole('button',{name:'收起菜单',exact:true})).toBeVisible();
});
test('navigation: collapse moves continuously, reverses safely and respects reduced motion',async({page},info)=>{
 test.skip(info.project.name!=='desktop');
 await page.emulateMedia({reducedMotion:'no-preference'});
 await openLibrary(page,'light');
 const sidebar=page.locator('.sidebar');
 const expanded=(await sidebar.boundingBox())!.width;
 const frames=await sidebar.evaluate(el=>new Promise<{width:number;overflow:boolean}[]>(resolve=>{
  const frames:{width:number;overflow:boolean}[]=[];
  const started=performance.now();
  (el.querySelector('.sidebar-toggle') as HTMLButtonElement).click();
  const sample=()=>{frames.push({width:el.getBoundingClientRect().width,overflow:document.documentElement.scrollWidth>innerWidth+1});if(performance.now()-started<450)requestAnimationFrame(sample);else resolve(frames)};
  requestAnimationFrame(sample);
 }));
 expect(frames.some(frame=>frame.width>80&&frame.width<expanded-2)).toBe(true);
 expect(frames.every(frame=>!frame.overflow)).toBe(true);
 await expect.poll(async()=>(await sidebar.boundingBox())!.width).toBe(76);
 // Reverse an in-progress expansion rather than queueing another full animation.
 await sidebar.evaluate(el=>new Promise<void>(resolve=>{
  const toggle=el.querySelector('.sidebar-toggle') as HTMLButtonElement;
  toggle.click();setTimeout(()=>{toggle.click();resolve()},70);
 }));
 await expect(sidebar).toHaveAttribute('data-collapsed','true');
 await expect.poll(async()=>(await sidebar.boundingBox())!.width).toBe(76);
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.getByRole('button',{name:'展开菜单',exact:true}).focus();
 await page.keyboard.press('Enter');
 await expect.poll(async()=>(await sidebar.boundingBox())!.width).toBe(expanded);
 await expect(page.getByRole('button',{name:'收起菜单',exact:true})).toBeFocused();
 expect(await sidebar.evaluate(el=>el.getAnimations().some(animation=>'transitionProperty' in animation&&animation.transitionProperty==='width'))).toBe(false);
});
test('library: selected text remains actionable on short screens and transfers into the composer',async({page},info)=>{
 await page.setViewportSize({width:360,height:420});await page.emulateMedia({reducedMotion:'reduce'});
 await openLibrary(page,'dark');
 const paragraph=page.locator('.reading-text p').first();await paragraph.scrollIntoViewIfNeeded();
 await paragraph.evaluate(el=>{const range=document.createRange();range.selectNodeContents(el);const selection=window.getSelection()!;selection.removeAllRanges();selection.addRange(range);el.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}))});
 const bar=page.locator('.selection-bar');await expect(bar).toContainText('第1段');
 await expect(paragraph).toBeInViewport();
 await expect(bar.getByRole('button',{name:'询问这段原文',exact:true})).toBeInViewport();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.screenshot({path:path.resolve(`../../artifacts/screenshots/${info.project.name}-library-selection-short.png`),scale:'css',style:'nextjs-portal{visibility:hidden}'});
 await bar.getByRole('button',{name:'询问这段原文',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'继续追问…',exact:true})).toHaveValue(/请结合原文解释这段内容：\n第1段/);
});
test('library: narrow, intermediate and wide viewports retain one readable canvas',async({page},info)=>{
 test.skip(info.project.name!=='desktop');await openLibrary(page,'light');
 for(const width of [320,651,768,1024,1920]){
  await page.setViewportSize({width,height:width===320?640:900});
  const scroll=page.locator('.library-scroll');await scroll.evaluate(el=>{el.scrollTop=0});
  await expect(page.locator('.reading-heading h1')).toBeInViewport();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  expect(await scroll.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await page.screenshot({path:path.resolve(`../../artifacts/screenshots/library-width-${width}.png`),scale:'css',style:'nextjs-portal{visibility:hidden}'});
 }
});
test('scrollbars: portalled settings also reveal and fade the thumb without a track',async({page})=>{
 await page.setViewportSize({width:390,height:560});await openLibrary(page,'dark');
 await page.getByRole('button',{name:'Menu',exact:true}).click();await page.getByRole('button',{name:'设置',exact:true}).click();
 const dialog=page.getByRole('dialog');await dialog.hover();await page.mouse.wheel(0,180);
 await expect(dialog).toHaveAttribute('data-scrolling','true');
 expect(await dialog.evaluate(el=>getComputedStyle(el).scrollbarColor)).toContain('rgba(0, 0, 0, 0)');
 await expect(dialog).not.toHaveAttribute('data-scrolling','true');
 await expect.poll(()=>dialog.evaluate(el=>getComputedStyle(el).getPropertyValue('--scroll-thumb').trim())).toBe('rgba(0, 0, 0, 0)');
});
test('library: returning from a passage restores a long list after document loading',async({page})=>{
 await openLibrary(page,'light');
 const items=Array.from({length:24},(_,i)=>({id:i===10?'reading-book':`list-${i}`,title:`记录 ${i+1}`,type:'book',language:'zh-CN',excerpt:'用于检查列表阅读位置的记录。',snapshotId:'reading-fixture'}));
 await page.route('**/api/library?*',r=>r.fulfill({json:{items,total:24,page:1,pageSize:24,snapshotId:'reading-fixture'}}));
 await page.locator('.back-link').click();await page.getByLabel('搜索书籍、任务或关键词…').fill('记录');
 await expect(page.locator('.document-card')).toHaveCount(24);
 const card=page.locator('[data-document-id="reading-book"]');await card.scrollIntoViewIfNeeded();
 const scroll=page.locator('.library-scroll');const before=await scroll.evaluate(el=>el.scrollTop);expect(before).toBeGreaterThan(400);
 await page.route('**/api/documents/reading-book?*',async r=>{await new Promise(resolve=>setTimeout(resolve,300));await r.fallback()});
 await card.click();await expect(page.locator('.reading-text')).toBeVisible();await page.locator('.back-link').click();
 await expect.poll(()=>scroll.evaluate(el=>el.scrollTop)).toBeCloseTo(before,0);
});
