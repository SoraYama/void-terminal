import {test, expect} from '@playwright/test';
import type {AnswerCard} from '../../src/lib/answer-cards';

const snapshotId='answer-cards-fixture';
const question='芙宁娜是谁？铁蜂刺和绝缘之旗印怎么样？';
const common={snapshotId,description:'',rarity:5};
const cards:AnswerCard[]=[
 {...common,citation:1,kind:'character',id:'avatar:10000089',name:'芙宁娜',element:'Water',subtitle:'不休独舞 · 水 · 单手剑 · 枫丹',
  description:'审判舞台上的绝对焦点，直至谢幕的掌声响起。',image:'https://gi.yatta.moe/assets/UI/UI_Gacha_AvatarImg_Furina.png'},
 {...common,citation:2,kind:'weapon',id:'weapon:11407',name:'铁蜂刺',subtitle:'单手剑 · 等级 90',rarity:4,
  image:'https://upload-os-bbs.mihoyo.com/game_record/genshin/equip/UI_EquipIcon_Sword_Exotic.png',facts:[{label:'基础攻击力',value:'510'},{label:'元素精通',value:'165'}]},
 {...common,kind:'artifact',id:'artifact:15020:flower',name:'绝缘之旗印',subtitle:'套装 · 明威之镡',
  image:'https://upload-os-bbs.mihoyo.com/game_record/genshin/equip/UI_RelicIcon_15020_4.png',
  facts:[{label:'2 件套',value:'元素充能效率提高20%。'},{label:'4 件套',value:'基于元素充能效率提高元素爆发造成的伤害。'}]},
];
const source={id:'furina-source',documentId:'furina-document',title:'芙宁娜',type:'character',language:'zh-CN',text:'来自角色图鉴。',path:'Avatar.json',locator:'/76',snapshotId,citation:1};
const sources=[source,...cards.slice(1).map((card,index)=>({...source,id:card.id,documentId:card.id,title:card.name,type:card.kind,citation:index+2}))];
const answer=[
 '芙宁娜是角色，铁蜂刺是武器，另一个条目是圣遗物套装。可以分开来看。',
 '芙宁娜是枫丹的五星水元素角色，使用单手剑。枫丹人最熟悉的她，常常出现在欧庇克莱歌剧院的舞台上。无论是审判时突如其来的提问，还是音乐剧里恰如其分的演出，她都很容易成为全场的焦点。她在舞台上总能以夸张的姿态吸引注意，但这种表演也有细腻的一面。角色档案用「不休独舞」来称呼她，角色故事则记录了观众怎样看待这位从未让他们失望的明星。对枫丹居民而言，歌剧院既是审判的场所，也是可以观赏演出的剧院，因此她的形象往往同时与这两种活动相连。想了解她在枫丹故事里的经历，可以从图鉴的简介开始，再对照角色故事和相关任务原文阅读。读到不同叙述视角时，也可以留意谁在讲述：报纸上的舞台形象、观众眼里的明星和她亲口说的话，提供的是不同层面的资料。这里先保留故事的悬念。 [1]',
 '铁蜂刺是四星单手剑，副属性是元素精通。它在 90 级有 510 点基础攻击力和 165 点元素精通。比较它与其他单手剑时，可以先看角色是否需要元素精通，再结合触发条件和队伍的元素反应。[2]',
 '绝缘之旗印是一套圣遗物。两件套提供元素充能效率，四件套根据充能效率提高元素爆发伤害。明威之镡是其中的生之花，图鉴里可以继续查看套装效果及属性规则。[3]',
].join('\n\n');

test('answer cards: render beside the cited answer, navigate and persist in history',async({page},info)=>{
 await page.addInitScript(theme=>localStorage.setItem('void.preferences',JSON.stringify({theme,locale:'zh-CN',sourceLanguage:'zh-CN',mode:'byok'})),info.project.name==='mobile'?'dark':'light');
 await page.route('**/api/status',r=>r.fulfill({json:{ready:true,provider:{sharedEnabled:false,model:'fixture'},coverage:[]}}));
 await page.route('**/api/chat',r=>r.fulfill({contentType:'text/event-stream',body:
  [['sources',{sources,snapshotId}],['text_delta',{text:answer}],
   ['done',{snapshotId,finishReason:'stop',cards}]].map(([event,data])=>`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('')}));
 await page.route('**/api/sources/*',r=>r.fulfill({json:{source,context:[],related:[]}}));
 await page.route('**/api/characters?*',r=>r.fulfill({json:{characters:[],total:0,page:1,pageSize:48,snapshotId,ready:true,counts:{},regions:[]}}));
 await page.route('**/api/characters/*',r=>{
  expect(new URL(r.request().url()).searchParams.get('snapshotId')).toBe(snapshotId);
  const missing={identifier:'',url:null,status:'missing'};
  return r.fulfill({json:{snapshotId,character:{...cards[0],language:'zh-CN',avatarId:10000089,title:'不休独舞',elementName:'水',weaponName:'单手剑',state:'source-record',icon:missing,portrait:missing,documentIds:[],sources:[],forms:[]}}});
 });
 await page.goto('/');
 const menu=page.getByRole('button',{name:'Menu',exact:true});
 if(await menu.isVisible())await menu.click();
 await page.getByRole('button',{name:'设置',exact:true}).click();
 await page.getByLabel('模型 API Key',{exact:true}).fill('answer-cards-test-key');
 await page.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).click();
 await page.locator('#question').fill(question);
 await page.getByRole('button',{name:'发送',exact:true}).click();
 const entries=page.locator('.message.assistant .markdown');
 await expect(entries.locator('.answer-card')).toHaveCount(3);
 await expect(page.getByRole('heading',{name:'图鉴资料'})).toHaveCount(0);
 await expect(entries.locator(':scope > p').first()).toContainText('可以分开来看。');
 for(const [kind,name] of [['character','芙宁娜'],['weapon','铁蜂刺'],['artifact','绝缘之旗印']]){
  const paragraph=entries.locator(`.answer-card-float:has([data-kind=${kind}]) + p`);
  await expect(paragraph).toContainText(name);
  const flow=await paragraph.evaluate(p=>{
   const float=p.previousElementSibling!.getBoundingClientRect(),body=p.getBoundingClientRect();
   const range=document.createRange();range.selectNode(p.firstChild!);
   const lines=[...range.getClientRects()];
   return {startsBeside:lines[0].left>=float.right&&lines[0].top<float.bottom,
    resumesFullWidth:lines.some(line=>line.top>=float.bottom&&Math.abs(line.left-body.left)<1)};
  });
  expect(flow.startsBeside).toBe(true);
  if(kind==='character')expect(flow.resumesFullWidth).toBe(true);
 }
 await expect(entries.locator('[data-kind=weapon]')).toContainText('元素精通');
 await expect(entries.locator('[data-kind=artifact]')).toContainText('4 件套');
 await expect(entries.locator('[data-kind=weapon]')).toHaveAttribute('href',/category=weapon&item=weapon%3A11407&snapshotId=answer-cards-fixture/);
 await expect(entries.locator('[data-kind=artifact]')).toHaveAttribute('href',/category=artifact&item=artifact%3A15020%3Aflower&snapshotId=answer-cards-fixture/);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await entries.locator('img').evaluateAll(images=>Promise.all(images.map(async image=>{
  if(image instanceof HTMLImageElement)await image.decode().catch(()=>{});
 })));
 await entries.evaluate(answer=>{
  const scroll=answer.closest('.chat-scroll')!;
  const inset=Number.parseFloat(getComputedStyle(scroll).scrollPaddingTop)||0;
  scroll.scrollTop+=answer.getBoundingClientRect().top-scroll.getBoundingClientRect().top-inset;
 });
 await expect(entries.locator('[data-kind=character]')).toBeInViewport({ratio:0.9});
 await page.screenshot({path:info.outputPath('answer-cards.png'),animations:'disabled'});
 await page.locator('.inline-citation').first().click();
 await expect(page.getByRole('dialog')).toContainText('来自角色图鉴。');
 await page.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).click();
 await entries.getByRole('link',{name:'查看芙宁娜的图鉴资料'}).click();
 await expect(page.locator('[data-character-detail] h1')).toHaveText('芙宁娜');
 await page.goBack();
 await expect(entries.locator('.answer-card')).toHaveCount(3);
 await page.reload();
 if(await menu.isVisible())await menu.click();
 await page.locator('.history-row').getByRole('button',{name:question,exact:true}).click();
 await expect(entries.locator('.answer-card')).toHaveCount(3);
});
