'use client';
import {useState, type MouseEvent} from 'react';
import {ArrowUpRight, Flower, Sword, UserCircle} from '@phosphor-icons/react';
import {answerCardUrl, type AnswerCard} from '../lib/answer-cards';
import type {Locale} from '../lib/contracts';
import {ElementIcon} from './game-icons';
import {Rarity} from './museum/item-image';
import './answer-cards.css';

const kinds = {
 character:{zh:'角色',en:'Character',icon:UserCircle},
 weapon:{zh:'武器',en:'Weapon',icon:Sword},
 artifact:{zh:'圣遗物',en:'Artifact',icon:Flower},
};

export function AnswerCards({cards, locale, onOpen}:{
 cards:AnswerCard[];locale:Locale;onOpen:(card:AnswerCard)=>void;
}){
 const zh=locale==='zh-CN';
 return <aside className={'answer-card-float'+(cards.length>1?' answer-card-float-group':'')} aria-label={cards.map(card=>card.name).join(zh?'、':', ')}>
  {cards.map(card=><ArchiveCard key={card.kind+':'+card.id} card={card} zh={zh} onOpen={onOpen}/>)}
 </aside>;
}

function ArchiveCard({card,zh,onOpen}:{card:AnswerCard;zh:boolean;onOpen:(card:AnswerCard)=>void}){
 const {name,kind,image,rarity,element,subtitle,description,facts}=card;
 const [failed,setFailed]=useState<string|null>(null),[loaded,setLoaded]=useState<string|null>(null),entry=kinds[kind],Icon=entry.icon;
 const available=!!image&&image!==failed;
 function open(event:MouseEvent<HTMLAnchorElement>){
  if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
  event.preventDefault();onOpen(card);
 }
 return <a className="answer-card" href={answerCardUrl(card)} onClick={open} data-kind={kind} data-rarity={rarity} data-element={element}
  aria-label={zh?`查看${name}的图鉴资料`:`View archive entry for ${name}`}>
  <div className="answer-card-art" aria-hidden="true">
   {(!available||loaded!==image)&&<Icon size={34} weight="duotone"/>}
   {available&&<img src={image} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer"
    onLoad={()=>setLoaded(image)} onError={()=>setFailed(image)}/>}
  </div>
  <div className="answer-card-copy">
   <div className="answer-card-title"><ElementIcon element={element}/><strong>{name}</strong><Rarity value={rarity} zh={zh}/></div>
   <span className="answer-card-meta">{[zh?entry.zh:entry.en,subtitle].filter(Boolean).join(' · ')}</span>
   {facts?.length?<dl className="answer-card-facts">{facts.map(({label,value})=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>:null}
   {description&&!facts?.length&&<span className="answer-card-description">{description}</span>}
  </div>
  <ArrowUpRight className="answer-card-arrow" size={17} aria-hidden="true"/>
 </a>;
}
