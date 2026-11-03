import {describe,it,expect} from 'vitest';
import {readMuseumQuery,listQuery,formatStat,allowedItemImage,ascensionCost,possibleSubstats} from '../src/lib/items';

describe('museum source rules',()=>{
 it('defaults to weapons and keeps selection outside the API query',()=>{
  const state=readMuseumQuery('?item=weapon%3A13501&rarity=5&page=2&snapshotId=immutable');
  expect(state.category).toBe('weapon');
  expect(listQuery(state,'en').get('item')).toBeNull();
  expect(listQuery(state,'en').get('snapshotId')).toBe('immutable');
  expect(listQuery(state,'en').get('page')).toBe('2');
 });
 it('rejects malformed page and filter values',()=>{
  expect(readMuseumQuery('?category=bogus&page=-1&rarity=9&sort=release').category).toBe('weapon');
  expect(readMuseumQuery('?page=-1').page).toBe(1);
  expect(readMuseumQuery('?rarity=9').rarity).toBe('');
 });
 it('formats only at presentation boundaries',()=>{
  expect(formatStat(608.0745972,'','zh-CN')).toBe('608');
  expect(formatStat(66.1536,'%','en')).toBe('66.2%');
 });
 it('accepts verified source families only',()=>{
  expect(allowedItemImage({url:'https://gi.yatta.moe/assets/UI/UI_EquipIcon_Pole_Homa.png',status:'verified'})).toBeTruthy();
  expect(allowedItemImage({url:'https://gi.yatta.moe/assets/UI/furniture/UI_Homeworld.png',status:'verified'})).toBeTruthy();
  expect(allowedItemImage({url:'https://evil.test/asset.png',status:'verified'})).toBeNull();
  expect(allowedItemImage({url:'https://gi.yatta.moe/private/secret.png',status:'verified'})).toBeNull();
  expect(allowedItemImage({url:'https://gi.yatta.moe/assets/UI/UI_Equip.png',status:'unverified'})).toBeNull();
 });
 it('separates stage and cumulative ascension cost',()=>{
  const stages=[{phase:1,levelCap:40,coin:5000,items:[{id:'a',name:'A',count:3}]},{phase:2,levelCap:50,coin:15000,items:[{id:'a',name:'A',count:5}]}];
  expect(ascensionCost(stages,2,false)).toEqual({coin:15000,items:[{id:'a',name:'A',count:5}]});
  expect(ascensionCost(stages,2,true)).toEqual({coin:20000,items:[{id:'a',name:'A',count:8}]});
 });
 it('never offers a selected main stat as a possible substat',()=>{
  const stats=[{key:'HP',label:'HP',unit:'',values:[209]},{key:'ATK',label:'ATK',unit:'',values:[14]}];
  expect(possibleSubstats(stats,'HP')).toEqual([stats[1]]);
 });
});
