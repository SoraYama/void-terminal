import {describe,it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {NarrativeText,Conditions} from '../src/components/characters/character-narrative';
import type {Narrative} from '../src/lib/characters';
describe('source narrative display',()=>{
 it('renders localized unlock tips supplied as arrays',()=>{
  expect(renderToStaticMarkup(createElement(Conditions,{conditions:{tips:['Friendship Lv. 2']},zh:false}))).toContain('Friendship Lv. 2');
 });
 it('preserves both gender branches and suppresses unresolved raw source text',()=>{
  const row:Narrative={id:'story',title:'Story',text:'{M#raw unparsed}',conditions:{},displayStatus:'unresolved',sources:[],branches:[{id:'m',title:'Male Traveler',text:'Brother line',conditions:{travelerGender:'male'},displayStatus:'complete'},{id:'f',title:'Female Traveler',text:'Sister line',conditions:{travelerGender:'female'},displayStatus:'complete'}]};
  const html=renderToStaticMarkup(createElement(NarrativeText,{row,zh:false}));expect(html).toContain('Brother line');expect(html).toContain('Sister line');expect(html).toContain('unresolved formatting');expect(html).not.toContain('{M#');
  expect(html).not.toContain('Alternate conditional version');
 });
 it('labels same-title source variants while preserving titles and unknown condition provenance',()=>{
  const row:Narrative={id:'story',title:'角色详细',text:'主要版本',conditions:{openConds:[{condType:'UNKNOWN_STORY_CONDITION',paramList:[123]}]},displayStatus:'complete',sources:[{repo:'source',commit:'fixed',path:'Story.json',locator:'/1',url:'https://example.com/Story.json'}],branches:[{id:'alternate',title:'角色详细',text:'另一版本正文',conditions:{},displayStatus:'complete'}]};
  const zh=renderToStaticMarkup(createElement(NarrativeText,{row,zh:true}));expect(zh).toContain('另一条件版本');expect(zh).toContain('角色详细');expect(zh).toContain('另一版本正文');expect(zh).toContain('条件暂未解析');expect(zh).toContain('https://example.com/Story.json');expect(zh).not.toContain('UNKNOWN_STORY_CONDITION');
  const en=renderToStaticMarkup(createElement(NarrativeText,{row,zh:false}));expect(en).toContain('Alternate conditional version');expect(en).toContain('Condition not yet resolved');
 });
});
