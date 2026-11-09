import {expect,type Page} from '@playwright/test';

export async function navigateArchive(page:Page,name:string){
 const menu=page.getByRole('button',{name:'Menu',exact:true}),mobile=await menu.isVisible();
 if(mobile){await expect(page.locator('#mobile-navigation')).toHaveCount(0);await menu.click()}
 await page.locator('.nav-item:visible').filter({hasText:name}).click();
 if(mobile)await expect(page.locator('#mobile-navigation')).toHaveCount(0);
}
export async function watchWarmEntry(page:Page,module:'characters'|'museum'|'library'){
 await page.evaluate(module=>{
  const flashes:string[]=[];
  Object.assign(window,{archiveFlashes:flashes});
  const selector={characters:'.character-card-skeleton,.character-section-content[aria-busy="true"]',museum:'.museum-card-skeleton,.museum-detail-body[aria-busy="true"]',library:'.library-content .empty-state[role="status"]'}[module];
  new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes){if(node instanceof Element&&(node.matches(selector)||node.querySelector(selector)))flashes.push(node.className)}}).observe(document.querySelector('main')!,{subtree:true,childList:true});
 },module);
}
export async function expectNoWarmFlash(page:Page){
 await expect.poll(()=>page.evaluate(()=>(window as unknown as {archiveFlashes:string[]}).archiveFlashes)).toEqual([]);
}
