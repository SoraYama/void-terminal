'use client';
import {useState,useEffect,useLayoutEffect,useRef,useCallback} from 'react';
import {MagnifyingGlass,ArrowClockwise,CaretLeft,CaretRight} from '@phosphor-icons/react';
import {ThemedSelect} from '../themed-select';
import {Emblem} from '../ui';
import {archiveDetailKey,resolvedListKey,type CharacterArchiveCache} from '../../lib/archive-session';
import {useCharacterPool} from '../../lib/use-character-pool';
import {request} from '../../lib/client';
import type {Locale} from '../../lib/contracts';
import {readCharacterQuery,characterListQuery,characterUrl,elements,characterWeapons,type CharacterQuery,type CharacterResult,type CharacterListResult,type CharacterSummary} from '../../lib/characters';
import {CharacterImage} from './character-ui';
import {ElementIcon} from '../game-icons';
import {CharacterDetail} from './character-detail';
import {Rarity} from '../museum/item-image';
import './characters.css';
const emptyCharacters:CharacterSummary[]=[];
export interface CharacterWorkspaceProps {cache?:CharacterArchiveCache;locale:Locale;language:Locale;onOpenDocument:(id:string,snapshot:string)=>void;onAsk:(name:string,id:string,snapshot:string)=>void;onOpenMaterial:(id:string,snapshot:string)=>void}
export function CharacterWorkspace({locale,language,onOpenDocument,onAsk,onOpenMaterial,cache}:CharacterWorkspaceProps){
 const zh=locale==='zh-CN';
 // Only a previously mounted session can seed browser state. Direct SSR entry
 // keeps the original null state until hydration reads the URL.
 const [initial]=useState(()=>{
  const query=cache?.visited&&typeof window!=='undefined'&&window.location.pathname==='/characters'?readCharacterQuery(window.location.search):null;
  const key=query?characterListQuery(query,language).toString():'';
  const list=cache?.lists.get(key)||null;
  const detail=archiveDetailKey(language,query?.snapshotId||list?.snapshotId||'',query?.character||'');
  return {query,key,list,detail,result:cache?.details.get(detail)||null};
 });
 const [query,setQuery]=useState<CharacterQuery|null>(initial.query),[search,setSearch]=useState(initial.query?.q||''),[list,setList]=useState<CharacterListResult|null>(initial.list),[result,setResult]=useState<CharacterResult|null>(initial.result),[loading,setLoading]=useState(!initial.list),[error,setError]=useState(''),[detailError,setDetailError]=useState<{key:string;message:string}|null>(null),[retry,setRetry]=useState(0);
 const state=useRef(query),scroller=useRef<HTMLDivElement>(null),detailContainer=useRef<HTMLElement>(null),focusId=useRef(''),restoreScroll=useRef<{key:string;top:number}|null>(null),listKey=useRef(initial.key),detailKey=useRef(initial.detail);state.current=query;
 const sourceLanguage=useRef(language);sourceLanguage.current=language;
 const update=useCallback((patch:Partial<CharacterQuery>,replace=false)=>{if(!state.current||window.location.pathname!=='/characters')return;const next={...state.current,...patch};state.current=next;setQuery(next);window.history[replace?'replaceState':'pushState']({...window.history.state,terminalView:'characters'},'',characterUrl(next))},[]);
 useEffect(()=>{if(cache)cache.visited=true;const sync=()=>{if(window.location.pathname!=='/characters')return;const next=readCharacterQuery(window.location.search);state.current=next;setQuery(next);setSearch(next.q);const scrollKey=characterListQuery(next,sourceLanguage.current).toString();restoreScroll.current={key:scrollKey,top:cache?.scroll.get(scrollKey)??(window.history.state?.characterScrollKey===scrollKey?window.history.state.characterScroll:0)}};sync();window.addEventListener('popstate',sync);return()=>window.removeEventListener('popstate',sync)},[cache]);
 useEffect(()=>{if(!query||query.q===search)return;const timer=setTimeout(()=>{update({q:search,page:1,character:'',form:''},true);scroller.current?.scrollTo(0,0)},250);return()=>clearTimeout(timer)},[search,query,update]);
 const key=query?characterListQuery(query,language).toString():'';
 useEffect(()=>{if(!key)return;const abort=new AbortController();listKey.current=key;setError('');
  const accept=(data:CharacterListResult)=>{setList(data);setLoading(false);if(!state.current?.snapshotId&&data.snapshotId)update({snapshotId:data.snapshotId},true)};
  const cached=cache?.lists.get(key);if(cached){accept(cached);return}
  setLoading(true);setList(null);
  request<CharacterListResult>('/api/characters?'+key,{signal:abort.signal}).then(data=>{if(abort.signal.aborted)return;cache?.lists.set(key,data,[resolvedListKey(key,data.snapshotId)]);accept(data)}).catch(e=>{if(!abort.signal.aborted)setError(e.message)}).finally(()=>{if(!abort.signal.aborted)setLoading(false)});return()=>abort.abort();
 },[key,retry,update,cache]);
 const selected=query?.character||'',snapshot=query?.snapshotId||list?.snapshotId||'',selectedKey=archiveDetailKey(language,snapshot,selected);
 const pool=useCharacterPool(selected?snapshot:'',language,query?.includeInternal??false,cache);
 useEffect(()=>{detailKey.current=selectedKey;setDetailError(null);const cached=cache?.details.get(selectedKey);setResult(cached||null);if(cached||!selected||!snapshot)return;const abort=new AbortController();
  request<CharacterResult>(`/api/characters/${encodeURIComponent(selected)}?`+new URLSearchParams({language,snapshotId:snapshot}),{signal:abort.signal}).then(data=>{
   if(abort.signal.aborted)return;
   if(data?.character?.id!==selected||data.character.language!==language||data.snapshotId!==snapshot){setDetailError({key:selectedKey,message:''});return}
   cache?.details.set(selectedKey,data);setResult(data);
  }).catch(e=>{if(!abort.signal.aborted)setDetailError({key:selectedKey,message:e.message})});return()=>abort.abort();
 },[selectedKey,selected,snapshot,language,retry,cache]);
 useLayoutEffect(()=>{if(selected||loading||!scroller.current)return;const queued=restoreScroll.current;scroller.current.scrollTop=queued?.key===key?queued.top:(cache?.scroll.get(key)??0);restoreScroll.current=null;if(focusId.current){scroller.current.querySelector<HTMLButtonElement>(`[data-character-id="${focusId.current}"]`)?.focus({preventScroll:true});focusId.current=''}},[selected,loading,key,cache]);
 function filter(patch:Partial<CharacterQuery>){update({...patch,page:1,character:'',form:''});restoreScroll.current=state.current?{key:characterListQuery(state.current,language).toString(),top:0}:null;scroller.current?.scrollTo(0,0)}
 function select(id:string){focusId.current=id;window.history.replaceState({...window.history.state,characterScroll:scroller.current?.scrollTop||0,characterScrollKey:key},'');update({character:id,browseElement:'',form:'',tab:'attributes',subtab:'biography'})}
 function back(){if(!focusId.current)focusId.current=selected;restoreScroll.current={key,top:cache?.scroll.get(key)??(window.history.state?.characterScrollKey===key?window.history.state.characterScroll:0)};update({character:'',browseElement:'',form:''})}
 const currentResult=cache?.details.get(selectedKey)||(result&&detailKey.current===selectedKey&&result.character.id===selected&&result.character.language===language&&result.snapshotId===snapshot?result:null);
 const currentList=cache?.lists.get(key)||(list&&listKey.current===key?list:null),listLoading=loading&&!currentList;
 const detailScrollKey=query?JSON.stringify([language,characterUrl({...query,browseElement:''})]):'';
 useLayoutEffect(()=>{const element=detailContainer.current?.querySelector('.character-section-content');if(element&&currentResult)element.scrollTop=cache?.scroll.get(detailScrollKey)??0},[currentResult,detailScrollKey,cache]);
 const selectedError=detailError?.key===selectedKey?(detailError.message||(zh?'返回的角色资料与当前选择不一致。':'The response did not match the selected character.')):(!snapshot?error:'');
 if(selected&&query)return <section ref={detailContainer} onScrollCapture={e=>{const element=e.target;if(window.location.pathname==='/characters'&&element instanceof HTMLElement&&element.classList.contains('character-section-content'))cache?.scroll.set(detailScrollKey,element.scrollTop)}} className="character-workspace character-open" aria-label={zh?'群星图鉴':'Character Archive'}>
  <CharacterDetail result={currentResult} recordKey={selectedKey} error={selectedError} onRetry={()=>setRetry(n=>n+1)} query={query} locale={locale} language={language} characters={pool.characters??(currentList?.snapshotId===snapshot?currentList.characters:emptyCharacters)} poolPending={!pool.characters&&!pool.failed} onRetryPool={pool.failed?pool.retry:undefined} onUpdate={update} onBack={back} onOpenDocument={onOpenDocument} onAsk={onAsk} onOpenMaterial={onOpenMaterial}/>
 </section>;
 return <section className="character-workspace" aria-label={zh?'群星图鉴':'Character Archive'}>
  <header className="character-archive-heading"><Emblem/><div><h1>{zh?'群星图鉴':'Character Archive'}</h1><p>{zh?'与旅途中的群星重逢':'Meet the characters of the journey'}</p></div></header>
  <div className="character-catalog">
   <div className="character-toolbar"><label className="character-search"><MagnifyingGlass size={21}/><input type="search" aria-label={zh?'搜索角色':'Search characters'} placeholder={zh?'搜索姓名或角色介绍…':'Search names or descriptions…'} value={search} onChange={e=>setSearch(e.target.value)}/></label><ThemedSelect archive label={zh?'武器类型':'Weapon type'} value={query?.weaponType||''} onValueChange={weaponType=>filter({weaponType})} options={[{value:'',label:zh?'全部武器':'All weapons'},...characterWeapons.map((value,i)=>({value,label:(zh?['单手剑','双手剑','长柄武器','法器','弓']:['Sword','Claymore','Polearm','Catalyst','Bow'])[i]}))]}/><ThemedSelect archive label={zh?'稀有度':'Rarity'} value={query?.rarity||''} onValueChange={rarity=>filter({rarity})} options={[{value:'',label:zh?'全部星级':'All rarities'},...[5,4].map(n=>({value:String(n),label:`${n}${zh?'星':' stars'}`}))]}/><ThemedSelect archive label={zh?'地区':'Region'} value={query?.region||''} onValueChange={region=>filter({region})} options={[{value:'',label:zh?'全部地区':'All regions'},...(currentList?.regions||[]).map(value=>({value,label:value}))]}/></div>
   <nav className="character-elements" aria-label={zh?'元素筛选':'Element filters'}><button aria-pressed={!query?.element} onClick={()=>filter({element:''})}>{zh?'全部':'All'}</button>{elements.map((element,i)=><button data-element={element} key={element} aria-pressed={query?.element===element} onClick={()=>filter({element})}><ElementIcon element={element}/>{(zh?['火','水','风','雷','冰','岩','草']:['Pyro','Hydro','Anemo','Electro','Cryo','Geo','Dendro'])[i]}</button>)}</nav>
   <div className="character-list-meta"><span aria-live="polite">{listLoading?(zh?'检索中…':'Searching…'):currentList?(zh?`${currentList.total} 条源数据记录`:`${currentList.total} source records`):''}</span><ThemedSelect archive label={zh?'排序':'Sort'} value={query?.sort||'rarity'} onValueChange={sort=>filter({sort:sort as CharacterQuery['sort']})} options={[{value:'rarity',label:zh?'稀有度排序':'By rarity'},{value:'name',label:zh?'名称排序':'By name'}]}/><label><input type="checkbox" checked={query?.includeInternal||false} onChange={e=>filter({includeInternal:e.target.checked})}/>{zh?'包含其他源记录':'Include other source records'}</label></div>
   <div className="character-grid-scroll" ref={scroller} aria-busy={listLoading} onScroll={e=>{if(window.location.pathname!=='/characters')return;cache?.scroll.set(key,e.currentTarget.scrollTop);window.history.replaceState({...window.history.state,characterScroll:e.currentTarget.scrollTop,characterScrollKey:key},'')}}>
    {error?<div className="character-state"><h2>{zh?'角色图鉴暂时无法读取':'The character archive could not be loaded'}</h2><p role="alert">{error}</p><button onClick={()=>setRetry(n=>n+1)}><ArrowClockwise size={18}/>{zh?'重试':'Retry'}</button></div>:listLoading?<div className="character-grid">{Array.from({length:24},(_,i)=><div className="character-card-skeleton" key={i}/>)}</div>:!currentList?.ready?<div className="character-state"><Emblem/><h2>{zh?'此快照尚未构建角色图鉴':'This snapshot has no character archive'}</h2><p>{zh?'可继续在尘世文卷阅读已有文献。':'Existing original documents remain available in Teyvat Archive.'}</p></div>:!currentList.characters.length?<div className="character-state"><MagnifyingGlass size={38}/><h2>{zh?'没有找到匹配角色':'No matching characters'}</h2><button onClick={()=>{setSearch('');filter({q:'',element:'',weaponType:'',rarity:'',region:'',includeInternal:false})}}>{zh?'清除筛选':'Clear filters'}</button></div>:<div className="character-grid">{currentList.characters.map(character=><button key={character.id} className="character-card" data-character-id={character.id} data-element={character.element} onClick={()=>select(character.id)}><CharacterImage media={character.icon} name={character.name}/><span className="character-card-copy"><strong>{character.name}</strong><Rarity value={character.rarity} zh={zh}/><small className="character-card-element"><ElementIcon element={character.element}/>{character.elementName||character.weaponName}</small>{character.state!=='source-record'&&<small>{character.state==='internal'?(zh?'内部记录':'Internal record'):(zh?'未分类源记录':'Unclassified source record')}</small>}</span></button>)}</div>}
   </div>
   {currentList&&currentList.total>currentList.pageSize&&<nav className="character-pagination" aria-label={zh?'角色分页':'Character pages'}><button aria-label={zh?'上一页':'Previous page'} disabled={listLoading||currentList.page<=1} onClick={()=>filterPage(currentList.page-1)}><CaretLeft size={20}/></button><span>{currentList.page} / {Math.ceil(currentList.total/currentList.pageSize)}</span><button aria-label={zh?'下一页':'Next page'} disabled={listLoading||currentList.page*currentList.pageSize>=currentList.total} onClick={()=>filterPage(currentList.page+1)}><CaretRight size={20}/></button></nav>}
  </div>
 </section>;
 function filterPage(page:number){update({page});restoreScroll.current=state.current?{key:characterListQuery(state.current,language).toString(),top:0}:null;scroller.current?.scrollTo(0,0)}
}
