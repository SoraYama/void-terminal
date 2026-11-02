import {BookOpen,CaretDown} from '@phosphor-icons/react';
import type {Citation,Locale} from '../lib/contracts';
import {presentSource} from '../lib/source-presentation';

export function CitationList({sources,locale,messageIndex,onOpen,onExpand}:{sources:Citation[];locale:Locale;messageIndex:number;onOpen:(source:Citation)=>void;onExpand:()=>void}){
 return <details className="citations" onToggle={event=>{if(event.currentTarget.open)onExpand()}}>
  <summary><BookOpen size={15} aria-hidden="true"/><span>{locale==='zh-CN'?'参考原文':'Sources'}</span><span className="citation-count">{sources.length}</span><CaretDown size={13} className="citation-caret" aria-hidden="true"/></summary>
  <div className="citation-items">{sources.map(source=><button key={source.id}
   data-source-trigger={`chip-${messageIndex}-${source.citation}`} onClick={()=>onOpen(source)}
   title={presentSource(source,locale).title}>
   <span className="citation-number">[{source.citation}]</span><span className="citation-title">{presentSource(source,locale).title}</span>
  </button>)}</div>
 </details>;
}
