import {test,expect,type Page} from '@playwright/test';
import type {Locale} from '../../src/lib/contracts';
import records from '../fixtures/archive-language.json';
import {navigateArchive} from '../helpers/archive-navigation-browser';

const snapshotId='archive-region-language-fixture';
async function fixture(page:Page,locale:Locale){
 const calls:URL[]=[];
 await page.addInitScript(locale=>localStorage.setItem('void.preferences',JSON.stringify({theme:'light',locale,sourceLanguage:'zh-CN',mode:'byok'})),locale);
 await page.route('**/api/status',route=>route.fulfill({json:{ready:true,provider:{sharedEnabled:false,model:'fixture',byok:true}}}));
 await page.route('**/api/characters?*',route=>{
  const url=new URL(route.request().url());calls.push(url);
  const language=url.searchParams.get('language') as Locale,character=records.characters[language];
  const region=url.searchParams.get('region'),pageNumber=Number(url.searchParams.get('page')||1);
  // The real store compares region names literally and returns the complete
  // region choices for the requested language, even if the filter has no rows.
  const matching=(!region||region===character.region)&&(!url.searchParams.get('element')||url.searchParams.get('element')===character.element);
  return route.fulfill({json:{characters:matching&&pageNumber===1?[character]:[],total:matching?1:0,page:pageNumber,pageSize:48,snapshotId,ready:true,counts:matching?{Ice:1}:{},regions:[character.region]}});
 });
 return calls;
}
async function chooseEnglish(page:Page){
 await navigateArchive(page,'设置');
 await page.getByRole('dialog',{name:'设置',exact:true}).getByRole('combobox',{name:'界面语言',exact:true}).click();
 await page.getByRole('option',{name:'English',exact:true}).click();
 await page.getByRole('dialog',{name:'Settings',exact:true}).getByRole('button',{name:'Close',exact:true}).click();
}

test('archive region language: changing to English clears a Chinese region without losing stable filters',async({page})=>{
 const calls=await fixture(page,'zh-CN');
 await page.goto('/characters?'+new URLSearchParams({region:'稻妻',element:'Ice',rarity:'5',snapshotId}));
 await expect(page.locator('.character-card strong')).toHaveText(records.characters['zh-CN'].name);
 await expect(page.getByRole('combobox',{name:'地区',exact:true})).toContainText('稻妻');
 await chooseEnglish(page);
 await expect(page.locator('.character-card strong')).toHaveText(records.characters.en.name);
 await expect(page.getByRole('combobox',{name:'Region',exact:true})).toContainText('All regions');
 const params=new URL(page.url()).searchParams;
 expect(params.has('region')).toBe(false);expect(params.get('element')).toBe('Ice');expect(params.get('rarity')).toBe('5');expect(params.get('snapshotId')).toBe(snapshotId);
 expect(calls.some(url=>url.searchParams.get('language')==='en'&&!url.searchParams.has('region'))).toBe(true);
});

test('archive region language: an English cold entry repairs a saved Chinese region and resets pagination',async({page})=>{
 const calls=await fixture(page,'en');
 await page.goto('/characters?'+new URLSearchParams({region:'稻妻',page:'2',element:'Ice',snapshotId}));
 await expect(page.locator('.character-card strong')).toHaveText(records.characters.en.name);
 await expect(page.getByRole('combobox',{name:'Region',exact:true})).toContainText('All regions');
 const params=new URL(page.url()).searchParams;
 expect(params.has('region')).toBe(false);expect(params.get('page')).toBe('1');expect(params.get('element')).toBe('Ice');expect(params.get('snapshotId')).toBe(snapshotId);
 expect(calls.every(url=>url.searchParams.get('language')==='en')).toBe(true);
});

test('archive region language: a valid English region remains selected',async({page})=>{
 await fixture(page,'en');
 await page.goto('/characters?'+new URLSearchParams({region:'Inazuma',snapshotId}));
 await expect(page.locator('.character-card strong')).toHaveText(records.characters.en.name);
 await expect(page.getByRole('combobox',{name:'Region',exact:true})).toContainText('Inazuma');
 expect(new URL(page.url()).searchParams.get('region')).toBe('Inazuma');
 await page.locator('.character-elements button[data-element="Grass"]').click();
 await expect(page.getByRole('heading',{name:'No matching characters',exact:true})).toBeVisible();
 await expect(page.getByRole('combobox',{name:'Region',exact:true})).toContainText('Inazuma');
 expect(new URL(page.url()).searchParams.get('region')).toBe('Inazuma');
});
