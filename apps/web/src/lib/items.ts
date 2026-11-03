import type {Locale,Provenance} from './contracts';

export const itemCategories=['weapon','artifact','material','food','quest','gadget','other'] as const;
export type ItemCategory=typeof itemCategories[number];
export const weaponTypes=['WEAPON_SWORD_ONE_HAND','WEAPON_CLAYMORE','WEAPON_POLE','WEAPON_CATALYST','WEAPON_BOW','WEAPON_CROSSBOW'] as const;
export interface ItemIcon {identifier:string;url:string|null;provider:string;status:'verified'|'unverified'|'missing'|'unreachable'}
export interface Stat {key:string;label:string;value:number;unit:string}
export interface Ascension {phase:number;levelCap:number;coin:number;items:{id:string;name:string;count:number}[]}
export interface Substat {key:string;label:string;unit:string;values:number[]}
export interface ItemSummary {id:string;language:Locale;name:string;category:ItemCategory;subtype:string;rarity:number|null;description:string;icon:ItemIcon;state:'source-record'|'internal'}
export interface Item extends ItemSummary {
 story:string;rawIds:string[];documentIds:string[];sources:Provenance[];attributes:{label:string;value:string}[];acquisition:string[];
 coverage:Record<string,'complete'|'not-applicable'|'upstream-missing'|'unresolved'|'unreachable'>;
 weapon?:{type:string;levels:{level:number;ascension:number;stats:Stat[]}[];refinements:{rank:number;name:string;description:string}[];ascensions:Ascension[]};
 artifact?:{setId:number;setName:string;slot:string;setEffects:{pieces:number;text:string}[];rarities:number[];rules:{rarity:number;maxLevel:number;mainStats:{key:string;label:string;unit:string;values:{level:number;value:number}[]}[];substats:Substat[]}[]};
}
export interface ItemListResult {items:ItemSummary[];total:number;page:number;pageSize:number;snapshotId:string|null;ready:boolean;counts:Record<string,number>}
export interface ItemResult {item:Item;snapshotId:string}
export interface MuseumQuery {category:ItemCategory|'';q:string;rarity:string;weaponType:string;sort:'rarity'|'name';page:number;includeInternal:boolean;item:string;snapshotId:string}
export function readMuseumQuery(search:string):MuseumQuery {
 const p=new URLSearchParams(search),category=p.get('category'),page=Number(p.get('page')||1);
 return {category:category==='all'?'':itemCategories.includes(category as ItemCategory)?category as ItemCategory:'weapon',q:(p.get('q')||'').slice(0,500),rarity:/^[1-5]$/.test(p.get('rarity')||'')?p.get('rarity')!:'',weaponType:weaponTypes.includes(p.get('weaponType') as typeof weaponTypes[number])?p.get('weaponType')!:'',sort:p.get('sort')==='name'?'name':'rarity',page:Number.isInteger(page)&&page>0&&page<=100000?page:1,includeInternal:p.get('includeInternal')==='true',item:p.get('item')||'',snapshotId:p.get('snapshotId')||''};
}
export function listQuery(q:MuseumQuery,language:Locale){
 const p=new URLSearchParams({language,page:String(q.page),pageSize:'48',sort:q.sort});
 for(const key of ['category','q','rarity','snapshotId'] as const)if(q[key])p.set(key,q[key]);
 if(q.category==='weapon'&&q.weaponType)p.set('weaponType',q.weaponType);
 if(q.includeInternal)p.set('includeInternal','true');return p;
}
export function museumUrl(q:MuseumQuery){
 const p=listQuery(q,'zh-CN');p.delete('language');p.delete('pageSize');p.set('category',q.category||'all');if(q.item)p.set('item',q.item);return '/museum?'+p;
}
export function formatStat(value:number,unit:string,locale:Locale){return new Intl.NumberFormat(locale,{maximumFractionDigits:unit==='%'?1:0}).format(value)+unit}
export function allowedItemImage(icon:Pick<ItemIcon,'url'|'status'>):string|null {
 if(icon.status!=='verified'||!icon.url)return null;
 try{const u=new URL(icon.url);if(u.protocol!=='https:'||u.username||u.password||u.port||u.search||u.hash)return null;
  if(u.hostname==='upload-os-bbs.mihoyo.com'&&/^\/game_record\/genshin\/equip\/[A-Za-z0-9_.-]+\.(png|webp|jpe?g)$/i.test(u.pathname))return u.href;
  if(u.hostname==='gi.yatta.moe'&&/^\/assets\/UI\/(?:(?:furniture|reliquary|namecard|monster)\/)?[A-Za-z0-9_.-]+\.(png|webp|jpe?g)$/i.test(u.pathname))return u.href;
 }catch{}return null;
}
export function possibleSubstats(stats:Substat[],main:string){return stats.filter(s=>s.key!==main)}
export function ascensionCost(stages:Ascension[],phase:number,cumulative:boolean){
 const items=new Map<string,{id:string;name:string;count:number}>();let coin=0;
 for(const stage of stages.filter(s=>cumulative?s.phase<=phase:s.phase===phase)){coin+=stage.coin;for(const item of stage.items){const previous=items.get(item.id);items.set(item.id,{...item,count:item.count+(previous?.count||0)})}}
 return {coin,items:[...items.values()]};
}
