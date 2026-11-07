'use client';
import {useState,type KeyboardEvent} from 'react';
import {UserCircle} from '@phosphor-icons/react';
import {allowedCharacterImage,readableCharacterText,resolveCharacterPortrait,type Character,type CharacterMedia} from '../../lib/characters';

export function CharacterImage({media,name}:{media:CharacterMedia;name:string}){
 const url=allowedCharacterImage(media),[failed,setFailed]=useState('');
 return <CharacterImageFrame src={url&&failed!==url?url:null} name={name} onError={setFailed}/>;
}
export function CharacterPortrait({character,zh}:{character:Character;zh:boolean}){
 const [failed,setFailed]=useState<ReadonlySet<string>>(()=>new Set());
 const art=resolveCharacterPortrait(character,failed);
 return <div className="character-portrait-stage">
  <CharacterImageFrame src={art.src} name={character.name} portrait supplement={art.kind==='supplement'} onError={url=>setFailed(previous=>new Set([...previous,url]))}/>
  {art.kind==='missing'&&<p>{zh?'此角色的原始立绘暂缺':'Original portrait unavailable'}</p>}
 </div>;
}
function CharacterImageFrame({src,name,onError,portrait=false,supplement=false}:{src:string|null;name:string;onError:(url:string)=>void;portrait?:boolean;supplement?:boolean}){
 return <span className={'character-image'+(portrait?' portrait':'')+(supplement?' traveler-portrait':'')}>
  {src?<img key={src} src={src} alt={name} loading={portrait?'eager':'lazy'} decoding="async" referrerPolicy="no-referrer" onError={()=>onError(src)}/>:<span className="character-image-fallback"><UserCircle size={portrait?72:32} weight="thin" aria-hidden="true"/><span>{name}</span></span>}
 </span>;
}
export function CharacterText({text,className=''}:{text:string;className?:string}){return <div className={'character-prose '+className}>{readableCharacterText(text).split(/\n\s*\n/).filter(Boolean).map((line,i)=><p key={i}>{line}</p>)}</div>}
export function CharacterTabs<T extends string>({items,value,onChange,label,vertical=false,id}:{items:{value:T;label:string}[];value:T;onChange:(value:T)=>void;label:string;vertical?:boolean;id:string}){
 function keydown(event:KeyboardEvent<HTMLDivElement>){if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const current=items.findIndex(i=>i.value===value),index=event.key==='Home'?0:event.key==='End'?items.length-1:(current+(['ArrowUp','ArrowLeft'].includes(event.key)?-1:1)+items.length)%items.length;onChange(items[index].value);(event.currentTarget.children[index] as HTMLElement)?.focus()}
 return <div className={'character-tabs'+(vertical?' vertical':'')} role="tablist" aria-label={label} aria-orientation={vertical?'vertical':'horizontal'} onKeyDown={keydown}>{items.map(item=><button key={item.value} role="tab" id={`${id}-${item.value}`} aria-controls={`${id}-panel`} aria-selected={value===item.value} tabIndex={value===item.value?0:-1} onClick={()=>onChange(item.value)}>{item.label}</button>)}</div>;
}
