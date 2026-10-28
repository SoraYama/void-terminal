// Live local corpus/UI smoke. No model requests and no mocked browser routes.
import {chromium, expect} from '@playwright/test';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';

const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:3000';
const output = new URL('../artifacts/live-ui/', import.meta.url);
await mkdir(output, {recursive:true});
const cases = (await readFile(new URL('../eval/retrieval-cases.jsonl', import.meta.url),'utf8')).trim().split('\n').map(JSON.parse);
const book = cases.find(c=>c.type==='book' && c.language==='zh-CN').expectedDocuments[0];
const probe = JSON.parse(await readFile(new URL('../eval/unlinked-source-probe.json',import.meta.url),'utf8'));
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? {executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH} : {});
const context = await browser.newContext({viewport:{width:1440,height:900},colorScheme:'light'});
const page = await context.newPage();
const errors=[];
page.on('pageerror',e=>errors.push(e.message));
const report={kind:'real-corpus-live-ui-no-model',startedAt:new Date().toISOString(),viewports:[],checks:[]};
try {
  let start=performance.now();
  await page.goto(baseURL,{waitUntil:'networkidle'});
  report.initialPageMs=Math.round(performance.now()-start);
  const status=await (await page.request.get(baseURL+'/api/status')).json();
  if(!status.ready || status.documentCount<1_500_000) throw new Error('Full final corpus is not ready');
  report.snapshotId=status.activeSnapshot.id;
  report.documentCount=status.documentCount;
  report.chunkCount=status.chunkCount;
  for(const width of [360,390,768,1440]) {
    await page.setViewportSize({width,height:900});
    await page.waitForTimeout(150);
    const size=await page.evaluate(()=>({viewport:innerWidth,scroll:document.documentElement.scrollWidth}));
    if(size.scroll>size.viewport+1) throw new Error('Horizontal overflow at '+width);
    report.viewports.push({...size,width});
    await page.screenshot({path:new URL(`home-${width}.png`,output).pathname,fullPage:true,animations:'disabled'});
  }
  await page.locator('.sidebar').getByRole('button',{name:'原文库',exact:true}).click();
  const bookSearch=page.waitForResponse(r=>r.url().includes('/api/library?')&&new URL(r.url()).searchParams.get('q')===book.title&&r.status()===200);
  await page.getByLabel('搜索书籍、任务或关键词…').fill(book.title);
  await bookSearch;
  await expect(page.locator('.document-card').first()).toBeVisible({timeout:30000});
  const documentResponse=page.waitForResponse(r=>r.url().includes('/api/documents/')&&r.status()===200);
  await page.locator('.document-card').first().click();
  const document=await (await documentResponse).json();
  await expect.poll(async()=>(await page.locator('.reading-text p').allTextContents()).join('\n')).toBe(document.document.text);
  report.checks.push({name:'live-library-and-original-reading',documentId:document.document.id,title:document.document.title,source:document.document.source});
  await page.screenshot({path:new URL('desktop-reading.png',output).pathname,fullPage:true,animations:'disabled'});
  await page.locator('.source-mini').first().click();
  await expect(page.locator('.source-drawer blockquote')).toContainText(document.sources[0].text.slice(0,60));
  await expect(page.locator('.source-drawer')).toContainText(document.sources[0].path);
  await page.screenshot({path:new URL('desktop-source.png',output).pathname,animations:'disabled'});
  await page.locator('.source-drawer').getByRole('button',{name:'关闭',exact:true}).click();
  const orphanSearch=page.waitForResponse(r=>r.url().includes('/api/library?')&&new URL(r.url()).searchParams.get('q')===probe.groundingQuote&&r.status()===200);
  await page.getByLabel('搜索书籍、任务或关键词…').fill(probe.groundingQuote);
  const orphanResults=await (await orphanSearch).json();
  const expectedOrphan=orphanResults.items.find(item=>item.id===probe.expectedDocumentId);
  if(!expectedOrphan) throw new Error('Expected unmapped record missing from literal search');
  await expect(page.locator('.document-card').first()).toBeVisible({timeout:30000});
  const orphanResponse=page.waitForResponse(r=>r.url().includes('/api/documents/')&&r.status()===200);
  await page.locator('.document-card').filter({has:page.getByRole('heading',{name:expectedOrphan.title,exact:true})}).click();
  const orphan=await (await orphanResponse).json();
  if(orphan.document.id!==probe.expectedDocumentId || orphan.document.metadata.contextUnknown!==true) throw new Error('Unknown-context probe mismatch');
  await expect(page.locator('.library-content')).toContainText('尚未关联到角色或任务');
  await page.locator('.source-mini').first().click();
  await expect(page.locator('.source-drawer')).toContainText('尚未关联到角色或任务');
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:new URL('mobile-unmapped-source.png',output).pathname,animations:'disabled'});
  report.checks.push({name:'unmapped-text-provenance-and-visible-uncertainty',documentId:orphan.document.id,literalSearchResults:orphanResults.total,metadata:probe.expectedMetadata});
  if(errors.length) throw new Error('Browser page errors: '+errors.join('; '));
  report.result='passed';
} catch(error) {
  report.result='failed';report.error=error.message;
  await page.screenshot({path:new URL('failure.png',output).pathname,fullPage:true}).catch(()=>{});
  process.exitCode=1;
} finally {
  report.pageErrors=errors;
  await writeFile(new URL('report.json',output),JSON.stringify(report,null,2)+'\n');
  await browser.close();
  console.log(JSON.stringify(report,null,2));
}
