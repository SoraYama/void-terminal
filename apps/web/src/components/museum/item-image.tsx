'use client';
import {useState} from 'react';
import {Sword,Flower,Leaf,CookingPot,Scroll,Compass,Package,Star} from '@phosphor-icons/react';
import {allowedItemImage,type ItemSummary,type ItemCategory} from '../../lib/items';
export const categoryIcons={weapon:Sword,artifact:Flower,material:Leaf,food:CookingPot,quest:Scroll,gadget:Compass,other:Package};
export const categoryNames:Record<ItemCategory,[string,string]>={weapon:['武器','Weapons'],artifact:['圣遗物','Artifacts'],material:['材料','Materials'],food:['食物','Food'],quest:['任务物品','Quest items'],gadget:['小道具','Gadgets'],other:['其他','Other']};
export function ItemImage({item,zh,large=false}:{item:ItemSummary;zh:boolean;large?:boolean}){
 const url=allowedItemImage(item.icon),[failed,setFailed]=useState<string|null>(null),[loaded,setLoaded]=useState<string|null>(null),Icon=categoryIcons[item.category]||Package;
 const available=!!url&&failed!==url;
 return <div className={'museum-image'+(large?' large':'')} data-rarity={item.rarity||1}>{available&&<img src={url} alt={item.name} loading={large?'eager':'lazy'} decoding="async" referrerPolicy="no-referrer" onLoad={()=>setLoaded(url)} onError={()=>setFailed(url)}/>} {(!available||loaded!==url)&&<span className="museum-image-missing"><Icon size={large?60:34} weight="duotone"/><span>{available?(zh?'图片载入中':'Loading image'):(zh?'图片暂缺':'Image unavailable')}</span></span>}</div>;
}
export function Rarity({value,zh}:{value:number|null;zh:boolean}){return value?<span className="museum-rarity" aria-label={`${value}${zh?'星':' stars'}`}>{Array.from({length:value},(_,i)=><Star key={i} size={14} weight="fill" aria-hidden="true"/>)}</span>:null}
