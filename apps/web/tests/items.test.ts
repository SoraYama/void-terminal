import {describe,it,expect} from 'vitest';
import {readMuseumQuery,listQuery,formatStat,allowedItemImage,ascensionCost,possibleSubstats,itemSubtypeLabel} from '../src/lib/items';

describe('museum source rules',()=>{
 it('localizes known card subtypes using the item source language',()=>{
  const fallback=['其他','Other'] as const;
  expect(itemSubtypeLabel({subtype:'MATERIAL_GCG_CARD',language:'zh-CN'},fallback)).toBe('七圣召唤卡牌');
  expect(itemSubtypeLabel({subtype:'MATERIAL_GCG_CARD',language:'en'},fallback)).toBe('Genius Invokation TCG card');
  expect(itemSubtypeLabel({subtype:'MATERIAL_GCG_CARD_FACE',language:'zh-CN'},fallback)).toBe('七圣召唤卡面');
  expect(itemSubtypeLabel({subtype:'MATERIAL_GCG_CARD_BACK',language:'en'},fallback)).toBe('Genius Invokation TCG card back');
 });
 it('falls back to the source-language category label for unknown enums',()=>{
  expect(itemSubtypeLabel({subtype:'MATERIAL_FUTURE_TYPE',language:'zh-CN'},['材料','Materials'])).toBe('材料');
  expect(itemSubtypeLabel({subtype:'FUTURE_TYPE_2',language:'en'},['小道具','Gadgets'])).toBe('Gadgets');
  expect(itemSubtypeLabel({subtype:'MATERIAL__FUTURE_',language:'en'},['材料','Materials'])).toBe('Materials');
 });
 it('preserves human subtype text without translating or changing the item',()=>{
  for(const subtype of ['角色培养素材','Character development material','ATK bonus','Limited_Edition','constructor','toString']){
   const item={subtype,language:'zh-CN' as const};
   expect(itemSubtypeLabel(item,['材料','Materials'])).toBe(subtype);
   expect(item).toEqual({subtype,language:'zh-CN'});
  }
 });
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
 it('accepts verified card faces only in the constrained gcg directory',()=>{
  const url='https://gi.yatta.moe/assets/UI/gcg/UI_Gcg_CardFace_Char_Avatar_Ganyu.png';
  expect(allowedItemImage({url,status:'verified'})).toBe(url);
  expect(allowedItemImage({url,status:'unreachable'})).toBeNull();
  for(const path of ['gcg/UI_Gcg_Test.png','gcg/UI_EquipIcon_Test.png','gcg/nested/UI_Gcg_CardFace_Test.png','arbitrary/UI_Gcg_CardFace_Test.png','gcg/../gcg/UI_Gcg_CardFace_Test.png']){
   expect(allowedItemImage({url:'https://gi.yatta.moe/assets/UI/'+path,status:'verified'})).toBeNull();
  }
 });
 it('accepts only canonical verified PNGs from the pinned PathOfGenshin sprite tree',()=>{
  const base='https://raw.githubusercontent.com/PathOfGenshin/resources/015a2493b5672b28576ab78ffbcffde2ea0c9844/resources/gi/Sprite/';
  const url=base+'UI_ItemIcon_100102.png';
  expect(allowedItemImage({url,status:'verified'})).toBe(url);
  expect(allowedItemImage({url,status:'unverified'})).toBeNull();
  for(const unsafe of [url.replace('015a2493b5672b28576ab78ffbcffde2ea0c9844','main'),url.replace('PathOfGenshin','other'),url.replace('raw.githubusercontent.com','other.test'),url.replace('raw.githubusercontent.com','name@raw.githubusercontent.com'),url.replace('raw.githubusercontent.com','raw.githubusercontent.com:443'),url+'?v=1',url+'#face',base+'nested/../UI_ItemIcon_100102.png',base+'UI_ItemIcon_100102.svg',base+'Other_100102.png']){
   expect(allowedItemImage({url:unsafe,status:'verified'})).toBeNull();
  }
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
