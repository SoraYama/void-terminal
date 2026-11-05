'use client';
import {useState,type KeyboardEvent} from 'react';
import {UserCircle} from '@phosphor-icons/react';
import {allowedCharacterImage,readableCharacterText,type CharacterMedia} from '../../lib/characters';

export function CharacterImage({media,name,portrait=false}:{media:CharacterMedia;name:string;portrait?:boolean}){
 const url=allowedCharacterImage(media),[failed,setFailed]=useState('');
 return <span className={'character-image'+(portrait?' portrait':'')}>
  {url&&failed!==url?<img src={url} alt={name} loading={portrait?'eager':'lazy'} decoding="async" referrerPolicy="no-referrer" onError={()=>setFailed(url)}/>:<span className="character-image-fallback"><UserCircle size={portrait?72:32} weight="thin"/><span>{name}</span></span>}
 </span>;
}
export function CharacterText({text,className=''}:{text:string;className?:string}){return <div className={'character-prose '+className}>{readableCharacterText(text).split(/\n\s*\n/).filter(Boolean).map((line,i)=><p key={i}>{line}</p>)}</div>}
export function CharacterTabs<T extends string>({items,value,onChange,label,vertical=false,id}:{items:{value:T;label:string}[];value:T;onChange:(value:T)=>void;label:string;vertical?:boolean;id:string}){
 function keydown(event:KeyboardEvent<HTMLDivElement>){if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const current=items.findIndex(i=>i.value===value),index=event.key==='Home'?0:event.key==='End'?items.length-1:(current+(['ArrowUp','ArrowLeft'].includes(event.key)?-1:1)+items.length)%items.length;onChange(items[index].value);(event.currentTarget.children[index] as HTMLElement)?.focus()}
 return <div className={'character-tabs'+(vertical?' vertical':'')} role="tablist" aria-label={label} aria-orientation={vertical?'vertical':'horizontal'} onKeyDown={keydown}>{items.map(item=><button key={item.value} role="tab" id={`${id}-${item.value}`} aria-controls={`${id}-panel`} aria-selected={value===item.value} tabIndex={value===item.value?0:-1} onClick={()=>onChange(item.value)}>{item.label}</button>)}</div>;
}
