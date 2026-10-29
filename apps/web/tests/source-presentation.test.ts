import {describe,it,expect} from 'vitest';
import {readableGameText,presentSource} from '../src/lib/source-presentation';

describe('readable game source presentation',()=>{
 it('removes game formatting without executing HTML and decodes explicit line breaks',()=>{
  expect(readableGameText('#<color=#D3BC8EFF>【活动规则】</color>\\n第一段。<br>第二段。')).toBe('【活动规则】\n第一段。\n第二段。');
  expect(readableGameText('<script>alert(1)</script><b>正文</b>')).toBe('<script>alert(1)</script>正文');
 });
 it('uses an explicit in-text heading for a long TextMap title and labels it as derived',()=>{
  const raw='#<color=#D3BC8EFF>【活动规则】</color>\\n'+ '规则正文。'.repeat(100);
  const doc={title:raw,type:'other' as const,excerpt:raw,metadata:{kind:'orphan_textmap',contextUnknown:true}};
  const display=presentSource(doc,'zh-CN');
  expect(display).toMatchObject({title:'活动规则',derived:true,unlinked:true,note:'标题摘自原文'});
  expect(display.excerpt.length).toBeLessThanOrEqual(181);expect(doc.title).toBe(raw);
 });
 it('keeps an actual book title and does not invent a title for unknown context',()=>{
  expect(presentSource({title:'少女薇拉的忧郁·卷一',type:'book'},'zh-CN')).toMatchObject({title:'少女薇拉的忧郁·卷一',derived:false,note:null});
  expect(presentSource({title:'',type:'other'},'en').title).toBe('Untitled source');
 });
 it('bounds a single long line including unbroken text and unicode characters',()=>{
  expect(Array.from(presentSource({title:'旅'.repeat(1000),type:'dialogue'},'zh-CN').title)).toHaveLength(49);
  expect(presentSource({title:'An unusually long line '.repeat(30),type:'other'},'en').title.length).toBeLessThanOrEqual(49);
 });
 it('preserves placeholders and literal unknown tags as evidence text',()=>{
  expect(readableGameText('<color=#fff>时间 {TIMEZONE} <unknown>原文</unknown></color>')).toBe('时间 {TIMEZONE} <unknown>原文</unknown>');
 });
 it('replaces filename-only book labels using the passage, and labels image-only records honestly',()=>{
  expect(presentSource({title:'Book1224',type:'book',excerpt:'(test)博士掉落阅读物4内容'},'zh-CN')).toMatchObject({title:'(test)博士掉落阅读物4内容',derived:true});
  expect(presentSource({title:'Book1071',type:'book',excerpt:'<image name=UI_QuestPicture_Flower01_Alpha/>'},'zh-CN')).toMatchObject({title:'未题名图像记录',note:'未标注正式标题'});
  expect(readableGameText('<image name=Flower/>','en')).toBe('[Image]');
  expect(presentSource({title:'Weapon11431_2',type:'book',excerpt:'剑身上刻着一段文字。',metadata:{titleUnresolved:true}},'zh-CN')).toMatchObject({title:'剑身上刻着一段文字。',derived:true});
  expect(presentSource({title:'book Document:121117',type:'book',excerpt:'一封没有落款的信。'},'zh-CN').title).toBe('一封没有落款的信。');
 });
});
