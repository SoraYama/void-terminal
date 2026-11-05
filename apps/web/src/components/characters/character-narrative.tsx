'use client';
import {useState} from 'react';
import type {Narrative,NarrativeBranch} from '../../lib/characters';
import {CharacterText} from './character-ui';
export function NarrativeText({row,zh}:{row:Narrative;zh:boolean}){
 const hasAlternate=row.branches?.some(branch=>!branch.conditions.travelerGender);
 return <>
  <Conditions conditions={row.conditions} zh={zh}/>
  {row.displayStatus==='unresolved'?<p className="character-note">{zh?'这段原文含尚未解析的格式，正文暂未展示。':'This source text contains unresolved formatting and cannot yet be displayed.'}</p>:row.text?<CharacterText text={row.text}/>:!row.branches?.length&&<p className="character-note">{zh?'此条原文正文暂缺。':'The original text is unavailable.'}</p>}
  {row.branches?.map(branch=>{const gender=branch.conditions.travelerGender;return <section className="character-branch" key={branch.id}>
   <h4>{gender?(branch.title||(gender==='male'?(zh?'男性旅行者':'Male Traveler'):(zh?'女性旅行者':'Female Traveler'))):<>{zh?'另一条件版本':'Alternate conditional version'}{branch.title&&<> · {branch.title}</>}</>}</h4>
   <Conditions conditions={branch.conditions} zh={zh} unknownIfEmpty={!gender}/>
   {branch.displayStatus==='unresolved'?<p>{zh?'此版本正文尚未解析。':'This variant has unresolved source formatting.'}</p>:<CharacterText text={branch.text}/>}</section>})}
  {row.sources?.[0]?.url&&(hasAlternate||Object.keys(row.conditions||{}).some(k=>!['tips','travelerGender'].includes(k)))&&<a className="character-source-link" href={row.sources[0].url} target="_blank" rel="noopener noreferrer">{zh?'查看原始解锁条件':'View original unlock conditions'}</a>}
 </>;
}
export function Conditions({conditions,zh,unknownIfEmpty=false}:{conditions:NarrativeBranch['conditions'];zh:boolean;unknownIfEmpty?:boolean}){
 const rawTips=conditions?.tips,known=Array.isArray(rawTips)?rawTips.filter((v):v is string=>typeof v==='string'&&!!v):typeof rawTips==='string'&&rawTips?[rawTips]:[];
 const meaningful=(value:unknown)=>Array.isArray(value)?value.length>0:value!==null&&value!==undefined&&value!==false&&value!=='';
 let unknown=Object.entries(conditions||{}).some(([key,value])=>!['tips','travelerGender','openConds','finishConds'].includes(key)&&meaningful(value));
 for(const key of ['openConds','finishConds']){const rows=conditions?.[key];if(!Array.isArray(rows)){if(meaningful(rows))unknown=true;continue}for(const row of rows){if(!row||typeof row!=='object'){unknown=true;continue}const type=String(row.condType||row.type||''),params=row.paramList||row.params||[];
  if(/FETTER_LEVEL|FETTER_LV|FETTER.*LEVEL/.test(type)&&Array.isArray(params)&&Number(params[0])>0)known.push(zh?`好感等级达到 ${params[0]}`:`Friendship Lv. ${params[0]}`);
  else if(/AVATAR_PROMOTE|AVATAR.*PROMOTE/.test(type)&&Array.isArray(params)&&Number(params[0])>0)known.push(zh?`角色突破阶段 ${params[0]}`:`Ascension phase ${params[0]}`);
  else unknown=true;
 }}
 const unresolved=unknown||unknownIfEmpty&&!known.length;
 return <>{known.length>0&&<p className="character-note">{[...new Set(known)].join(' · ')}</p>}{unresolved&&<p className="character-note">{zh?'条件暂未解析':'Condition not yet resolved'}</p>}</>;
}
export function CharacterStories({stories,zh}:{stories:Narrative[];zh:boolean}){const [selected,setSelected]=useState(stories[0]?.id||'');const row=stories.find(s=>s.id===selected);return <div className="character-narrative-layout"><nav className="character-record-list" aria-label={zh?'故事条目':'Story entries'}>{stories.map(story=><button key={story.id} aria-pressed={story.id===selected} onClick={()=>setSelected(story.id)}>{story.title|| (zh?`故事 ${story.order}`:`Story ${story.order}`)}</button>)}</nav><article className="character-reading">{row?<><h3>{row.title}</h3><NarrativeText row={row} zh={zh}/></>:<p>{zh?'暂无故事记录':'No story records available'}</p>}</article></div>}
