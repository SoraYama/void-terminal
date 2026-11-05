import {describe,it,expect} from 'vitest';
import {readCharacterQuery,characterUrl,allowedCharacterImage,voiceUrl,defaultLevel,formatCharacterStat,orderedCharacterStats,materialTotals} from '../src/lib/characters';

describe('character archive identity and display',()=>{
 it('rejects malformed deep links and retains exact form/tab/snapshot',()=>{
  const q=readCharacterQuery('?character=avatar%3A10000005&form=504&tab=info&subtab=voices&snapshotId=s1&element=Wind&page=2');
  expect(q).toMatchObject({character:'avatar:10000005',form:'504',tab:'info',subtab:'voices',snapshotId:'s1',page:2});
  expect(readCharacterQuery(characterUrl(q).split('?')[1])).toEqual(q);
  expect(readCharacterQuery('?character=../x&form=no&tab=fake&snapshotId=%00&element=unknown&page=Infinity')).toMatchObject({character:'',form:'',tab:'attributes',snapshotId:'',element:'',page:1});
 });
 it('only renders verified identifier-matched original image URLs',()=>{
  const m={status:'verified',verification:'image-header',identifier:'UI_AvatarIcon_Ayaka',url:'https://gi.yatta.moe/assets/UI/UI_AvatarIcon_Ayaka.png'};
  expect(allowedCharacterImage(m)).toBe(m.url);
  const skill={...m,identifier:'Skill_S_Nahida_01',url:'https://gi.yatta.moe/assets/UI/Skill_S_Nahida_01.png'};
  expect(allowedCharacterImage(skill)).toBe(skill.url);
  expect(allowedCharacterImage({...skill,url:'https://evil.test/assets/UI/Skill_S_Nahida_01.png'})).toBeNull();
  for(const patch of [{status:'unverified'},{identifier:'UI_other'},{url:m.url+'?x=1'},{url:'https://evil.test/UI_AvatarIcon_Ayaka.png'}])expect(allowedCharacterImage({...m,...patch})).toBeNull();
 });
 it('pins voice identity, locale and snapshot rather than trusting a URL',()=>{
  const m={identifier:'0123456789abcdef',status:'verified',verification:'archive-index',provider:'genshin-voice',url:'/api/characters/avatar:10000002/voices/123?audioLanguage=ja'};
  expect(voiceUrl(m,'avatar:10000002','123','ja','s1','en')).toBe('/api/characters/avatar%3A10000002/voices/123?language=en&audioLanguage=ja&snapshotId=s1');
  expect(voiceUrl(m,'avatar:10000003','123','ja','s1','en')).toBeNull();
  expect(voiceUrl(m,'avatar:10000002','123','ko','s1','en')).toBeNull();
  expect(voiceUrl(m,'avatar:10000002','123','ja','','en')).toBeNull();
 });
 it('selects a real maximum legal level/phase pair and formats only ratios as percentages',()=>{
  expect(defaultLevel([{level:20,ascension:0,stats:{}},{level:20,ascension:1,stats:{}},{level:1,ascension:0,stats:{}}])).toBe('20:1');
  expect(formatCharacterStat('FIGHT_PROP_BASE_HP',12345.6,'en').value).toBe('12,346');
  expect(formatCharacterStat('FIGHT_PROP_CRITICAL',0.05,'en')).toEqual({label:'CRIT Rate',value:'5%'});
 });
 it('adds source material quantities without mixing phases',()=>{
  const rows=[{ascension:1,mora:20000,materials:[{id:'1',itemId:'material:1',count:3}]},{ascension:2,mora:40000,materials:[{id:'1',itemId:'material:1',count:6}]}];
  expect(materialTotals(rows,2,false)).toMatchObject({mora:40000,materials:[{count:6}]});
  expect(materialTotals(rows,2,true)).toMatchObject({mora:60000,materials:[{count:9}]});
  expect(materialTotals([{ascension:1,mora:null,materials:[]}],1,false).mora).toBeNull();
 });
 it('orders the game panel by HP ATK DEF then mastery critical and recharge independent of JSON key order',()=>{
  const stats={FIGHT_PROP_CHARGE_EFFICIENCY:1,FIGHT_PROP_BASE_ATTACK:299,FIGHT_PROP_BASE_DEFENSE:630,FIGHT_PROP_BASE_HP:10360,FIGHT_PROP_CRITICAL_HURT:.5,FIGHT_PROP_CRITICAL:.05,FIGHT_PROP_ELEMENT_MASTERY:115,FIGHT_PROP_UNKNOWN:2,FIGHT_PROP_INVALID:NaN};
  expect(orderedCharacterStats(stats).map(([key])=>key)).toEqual(['BASE_HP','BASE_ATTACK','BASE_DEFENSE','ELEMENT_MASTERY','CRITICAL','CRITICAL_HURT','CHARGE_EFFICIENCY','UNKNOWN'].map(k=>'FIGHT_PROP_'+k));
 });
});
