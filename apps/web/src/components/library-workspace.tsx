'use client';

import {useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react';
import {motion,useReducedMotion} from 'motion/react';
import {ArrowLeft,ArrowUp,BookOpen,Database,FileText,MagnifyingGlass,Sparkle,X} from '@phosphor-icons/react';
import type {Citation,ContentType,DocumentResult,LibraryResult,Locale} from '../lib/contracts';
import {CONTENT_TYPES} from '../lib/contracts';
import {text,typeNames} from '../lib/i18n';
import {presentSource} from '../lib/source-presentation';
import {LibraryCard,LibraryReader} from './library-record';
import {Ornament,Scene} from './ui';

interface Props{
 locale:Locale;query:string;onQuery:(value:string)=>void;
 type:ContentType|'';onType:(value:ContentType|'')=>void;
 page:number;onPage:(value:number)=>void;
 library:LibraryResult|null;busy:boolean;error:string;onRetry:()=>void;onStatus:()=>void;
 record:DocumentResult|null;documentBusy:boolean;onBack:()=>void;
 onOpen:(id:string,snapshotId?:string)=>Promise<void>;onSource:(source:Citation)=>void;
 selection:string;onSelection:(value:string)=>void;onAsk:()=>void;
}

export function LibraryWorkspace(props:Props){
 const {locale,query,onQuery,type,onType,page,onPage,library,busy,error,onRetry,onStatus,record,documentBusy,onBack,onOpen,onSource,selection,onSelection,onAsk}=props;
 const zh=locale==='zh-CN',t=text(locale),reduced=useReducedMotion();
 const scroll=useRef<HTMLDivElement>(null),assistant=useRef<HTMLElement>(null),listPosition=useRef(0);
 const [compact,setCompact]=useState(false);
 const updateCompact=useCallback(()=>{
  const viewport=scroll.current,heading=viewport?.querySelector('.reading-heading');
  const header=viewport?.parentElement?.querySelector('.library-header');
  setCompact(Boolean(viewport&&heading&&header&&heading.getBoundingClientRect().bottom<=viewport.getBoundingClientRect().top+header.clientHeight));
 },[]);
 useLayoutEffect(()=>{
  if(scroll.current)scroll.current.scrollTop=record?0:listPosition.current;
  updateCompact();
 },[record?.document.id,updateCompact]);
 useLayoutEffect(()=>{
  if(!selection||!scroll.current)return;
  const selected=window.getSelection();if(!selected?.rangeCount)return;
  const range=selected.getRangeAt(0);
  if(!scroll.current.contains(range.startContainer))return;
  const firstLine=range.getClientRects()[0],viewport=scroll.current.getBoundingClientRect();
  if(firstLine&&firstLine.bottom>viewport.bottom-16){
   scroll.current.scrollTop+=firstLine.top-viewport.top-88;
   updateCompact();
  }
 },[selection,updateCompact]);
 useEffect(()=>{
  if(!scroll.current)return;
  const observer=new ResizeObserver(updateCompact);observer.observe(scroll.current);
  const heading=scroll.current.querySelector('.reading-heading');if(heading)observer.observe(heading);
  return ()=>observer.disconnect();
 },[updateCompact,record?.document.id,locale]);
 function showAssistant(){assistant.current?.scrollIntoView({block:'start',behavior:reduced?'instant':'smooth'})}
 const title=record?presentSource(record.document,locale).title:t.library;
 const talkLabel=zh?'与原文对话':'Talk to the text';
 return <>
  {record&&<motion.header className="conversation-header library-header" data-compact={compact} aria-hidden={!compact} inert={!compact}
   initial={false} animate={{opacity:compact?1:0,y:reduced?0:compact?0:-12}} transition={{duration:reduced?0:.24,ease:[.16,1,.3,1]}}
   style={{pointerEvents:compact?'auto':'none'}}>
   <Scene/><button className="reader-back" aria-label={t.library} onClick={onBack}><ArrowLeft size={20}/></button>
   <h2 title={title}>{title}</h2>
   <button className="reader-talk" onClick={showAssistant} aria-label={talkLabel}><Sparkle size={20}/><span>{talkLabel}</span></button>
  </motion.header>}
  <div className="library-scroll" ref={scroll} onScroll={()=>{if(!record&&!documentBusy)listPosition.current=scroll.current?.scrollTop||0;updateCompact()}}>
   <div className="library-cover"><Scene/></div>
   {!record&&<div className="library-toolbar"><div><h1>{t.library}</h1><p className="library-intro">{zh?'翻开一本书，重温一段旅途。按类别浏览，或搜索记忆中的名字与句子。':'Open a book. Revisit a journey. Browse by category, or search a name or a remembered line.'}</p></div>
    <label className="search"><MagnifyingGlass size={21}/><input aria-label={t.search} placeholder={t.search} value={query} onChange={e=>onQuery(e.target.value)}/></label>
   </div>}
   <div className={'library-layout'+(record?' is-reading':'')}>
    {!record&&<aside className="library-filters" aria-label={zh?'原文类别':'Source categories'}>
     <h2>{zh?'记录与故事':'Records & stories'}</h2><Ornament/>
     <button aria-pressed={!type} className={!type?'filter active':'filter'} onClick={()=>onType('')}><BookOpen size={20}/>{t.all}</button>
     {CONTENT_TYPES.map(c=><button aria-pressed={type===c} className={type===c?'filter active':'filter'} key={c} onClick={()=>onType(c)}><FileText size={18}/>{zh?typeNames[c]:c}</button>)}
    </aside>}
    <section className="library-content">
     {documentBusy?<div role="status" className="empty-state">{t.loading}</div>:record?<>
      <div className="reader-navigation" inert={compact} aria-hidden={compact}><button className="back-link" onClick={onBack}><ArrowLeft size={18}/>{t.library}</button><button className="reader-talk" onClick={showAssistant}><Sparkle size={18}/>{talkLabel}</button></div>
      <LibraryReader key={record.document.id} record={record} locale={locale} onSelection={onSelection} onOpen={onOpen}/>
      <aside className="reading-assistant" ref={assistant}>
       <div className="reading-assistant-heading"><Sparkle size={24}/><h2>{talkLabel}</h2></div>
       <p className="muted">{zh?'选中一段原文，围绕人物、事件与表达继续提问。':'Select a passage to explore its characters, events, and meaning.'}</p>
       {selection&&<><label>{t.selected}</label><blockquote>{selection}</blockquote></>}
       <div className="reading-sources">{record.sources.map((s,i)=><button className="source-mini" key={s.id} onClick={()=>onSource({...s,citation:i+1})}>[{i+1}] {presentSource(s,locale).title}</button>)}</div>
      </aside>
     </>:busy?<div role="status" className="empty-state">{t.loading}</div>:error?<div className="empty-state" role="alert"><Database size={35}/><h2>{zh?'暂时无法读取原文':'Sources are unavailable'}</h2><p>{error}</p><button onClick={onRetry}>{t.retry}</button></div>:!library?.items.length?<div className="empty-state"><BookOpen size={40}/><h2>{t.noData}</h2><p>{zh?'试试其他关键词，或查看数据状态确认语料是否已导入。':'Try another keyword, or check corpus status.'}</p><button onClick={onStatus}>{t.status}</button></div>:<>
      <div className="results-label">{library.total.toLocaleString(locale)} {zh?'篇原文':'passages'} · {type?(zh?typeNames[type]:type):t.all}</div>
      <div className="document-grid">{library.items.map(item=><LibraryCard key={item.id} item={item} locale={locale} onOpen={()=>void onOpen(item.id,item.snapshotId)}/>)}</div>
      <div className="pagination"><button disabled={page<=1} onClick={()=>onPage(page-1)}>{t.previous}</button><span>{page} / {Math.max(1,Math.ceil(library.total/24))}</span><button disabled={page*24>=library.total} onClick={()=>onPage(page+1)}>{t.next}</button></div>
     </>}
    </section>
   </div>
  </div>
  {record&&selection&&<div className="selection-bar" role="region" aria-label={t.selected}><p>{selection}</p><button className="primary" onClick={onAsk}>{t.askSelection}<ArrowUp size={18}/></button><button aria-label={zh?'取消选择':'Clear selection'} onClick={()=>onSelection('')}><X size={19}/></button></div>}
 </>;
}
