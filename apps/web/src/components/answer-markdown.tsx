'use client';
import {useMemo} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {remarkAnswerCards} from '../lib/answer-card-placement';
import type {AnswerCard} from '../lib/answer-cards';
import type {Citation,Locale} from '../lib/contracts';
import {safeUrl} from '../lib/client';
import {remarkCitations} from '../lib/stream';
import {ResourceMapCards} from './resource-map-card';
import {parseMapCards,type MapCard} from '../lib/map-cards';
import {AnswerCards} from './answer-cards';

export function AnswerMarkdown({content,cards=[],maps=[],sources,messageIndex,locale,onOpenCard,onOpenSource}:{
 content:string;cards?:AnswerCard[];maps?:MapCard[];sources?:Citation[];messageIndex:number;locale:Locale;
 onOpenCard:(card:AnswerCard)=>void;onOpenSource:(source:Citation)=>void;
}){
 const verifiedMaps=useMemo(()=>parseMapCards(maps),[maps]);
 return <div className="markdown"><ReactMarkdown
  remarkPlugins={[remarkGfm,remarkCitations,[remarkAnswerCards,{cards}]]}
  components={{
   a:({href,children})=>href?.startsWith('#citation-')
    ?<button className="inline-citation" data-source-trigger={`inline-${messageIndex}-${href.slice(10)}`}
      onClick={()=>{const source=sources?.find(s=>s.citation===Number(href.slice(10)));if(source)onOpenSource(source)}}>{children}</button>
    :<a href={href&&safeUrl(href)} target="_blank" rel="noopener noreferrer">{children}</a>,
   img:()=>null,
   aside:({node})=>{
    const indexes=node?.properties.dataAnswerCardIndexes;
    if(typeof indexes!=='string')return null;
    const entries=indexes.split(',').flatMap(index=>cards[Number(index)]?[cards[Number(index)]]:[]);
    return entries.length?<AnswerCards cards={entries} locale={locale} onOpen={onOpenCard}/>:null;
   },
  }}>{content}</ReactMarkdown><ResourceMapCards cards={verifiedMaps} locale={locale}/></div>;
}
