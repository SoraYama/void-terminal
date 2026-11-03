import {test,expect,type Page} from '@playwright/test';
import path from 'node:path';

const sources=Array.from({length:40},(_,i)=>({id:`anchor-${i}`,documentId:`anchor-doc-${i}`,title:`锚点回归原文 ${i+1}`,type:'quest',language:'zh-CN',text:'隔离的浏览器回归原文。',path:'fixture.json',locator:`line:${i}`,snapshotId:'anchor-fixture',citation:i+1}));
async function openHistory(page:Page,short=false){
 await page.addInitScript(()=>localStorage.setItem('void.preferences',JSON.stringify({theme:'light',locale:'zh-CN',sourceLanguage:'zh-CN',mode:'byok'})));
 await page.route('**/api/status',r=>r.fulfill({json:{ready:true,provider:{sharedEnabled:false,model:'fixture'},coverage:[]}}));
 await page.goto('/');
 await page.evaluate(async({short,sources})=>{
  const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('void-terminal',1);r.onupgradeneeded=()=>r.result.createObjectStore('conversations',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
  await new Promise<void>((resolve,reject)=>{
   const tx=db.transaction('conversations','readwrite');
   tx.objectStore('conversations').put({id:'anchor-history',title:'锚点显示回归',updatedAt:Date.now(),messages:[{role:'user',content:'请梳理故事脉络。'},{role:'assistant',content:short?'故事结束。':Array.from({length:32},(_,i)=>`### 第 ${i+1} 幕\n\n旅行者循着原文回望须弥城中的人们，这是隔离的浏览器回归内容。\n\n`).join(''),sources}]});
   tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>reject(tx.error);
  });
 },{short,sources});
 await page.reload();
 const menu=page.getByRole('button',{name:'Menu',exact:true});if(await menu.isVisible())await menu.click();
 await page.getByRole('button',{name:'锚点显示回归',exact:true}).click();
 await expect(page.locator('.answer-tail')).toBeInViewport();
}

test('anchor: completed answer stays hidden at the bottom and throughout its visible range',async({page},info)=>{
 await openHistory(page);
 const scroll=page.locator('.chat-scroll'),tail=page.locator('.answer-tail'),button=page.locator('.back-to-bottom');
 await scroll.evaluate(el=>{el.scrollTop=el.scrollHeight;el.dispatchEvent(new Event('scroll'))});
 await expect(tail).toBeInViewport();
 await expect(button).toBeHidden();
 await page.screenshot({path:path.resolve(`../../artifacts/screenshots/${info.project.name}-anchor-bottom.png`),animations:'disabled'});
 await scroll.evaluate(el=>{el.scrollTop-=60;el.dispatchEvent(new Event('scroll'))});
 await expect(tail).toBeInViewport();await expect(button).toBeHidden();
 await scroll.evaluate(el=>{el.scrollTop=0;el.dispatchEvent(new Event('scroll'))});
 await expect(tail).not.toBeInViewport();await expect(button).toBeVisible();
 await button.click();await expect(tail).toBeInViewport();await expect(button).toBeHidden();
});

test('anchor: reading expanded references never offers a downward jump to an answer above',async({page})=>{
 await openHistory(page);
 await page.locator('details.citations summary').click();
 const scroll=page.locator('.chat-scroll'),button=page.locator('.back-to-bottom');
 await scroll.evaluate(el=>{el.scrollTop=el.scrollHeight;el.dispatchEvent(new Event('scroll'))});
 await expect(button).toBeHidden();
 await page.locator('details.citations summary').click();
 await expect(page.locator('.answer-tail')).toBeInViewport();await expect(button).toBeHidden();
});

test('anchor: an upward gesture on a short answer does not create a stale jump button',async({page})=>{
 await openHistory(page,true);
 const scroll=page.locator('.chat-scroll');
 await scroll.hover();await page.mouse.wheel(0,-35);
 await expect(page.locator('.answer-tail')).toBeInViewport();
 await expect(page.locator('.back-to-bottom')).toBeHidden();
});

test('anchor: viewport resizing recalculates visibility while following is paused',async({page})=>{
 await openHistory(page);
 const scroll=page.locator('.chat-scroll'),tail=page.locator('.answer-tail'),button=page.locator('.back-to-bottom');
 await scroll.evaluate(el=>{el.scrollTop-=180;el.dispatchEvent(new Event('scroll'))});
 await expect(tail).not.toBeInViewport();await expect(button).toBeVisible();
 await page.setViewportSize({width:page.viewportSize()!.width,height:1400});
 await expect(tail).toBeInViewport();await expect(button).toBeHidden();
});
