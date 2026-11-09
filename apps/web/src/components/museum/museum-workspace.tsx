'use client';
import {useEffect,useLayoutEffect,useRef,useState,useCallback} from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {MagnifyingGlass,SquaresFour,Check,CaretLeft,CaretRight,ArrowClockwise} from '@phosphor-icons/react';
import {ThemedSelect} from '../themed-select';
import {Emblem} from '../ui';
import {archiveDetailKey,resolvedListKey,type ArchiveCache} from '../../lib/archive-session';
import {request} from '../../lib/client';
import type {Locale} from '../../lib/contracts';
import {readMuseumQuery,listQuery,museumUrl,itemCategories,weaponTypes,type MuseumQuery,type ItemListResult,type ItemResult} from '../../lib/items';
import {ItemImage,Rarity,categoryIcons,categoryNames} from './item-image';
import {ItemDetail} from './item-detail';
import './museum.css';

interface Props {cache?:ArchiveCache<ItemListResult,ItemResult>;locale:Locale;language:Locale;onOpenDocument:(id:string,snapshotId:string)=>void;onAsk:(name:string,id:string,snapshotId:string)=>void}
export function MuseumWorkspace({locale,language,onOpenDocument,onAsk,cache}:Props){
 const zh=locale==='zh-CN';
 const [initial]=useState(()=>{const query=cache?.visited&&typeof window!=='undefined'&&window.location.pathname==='/museum'?readMuseumQuery(window.location.search):null;const list=cache?.lists.get(query?listQuery(query,language).toString():'')||null;return {query,list,result:cache?.details.get(archiveDetailKey(language,query?.snapshotId||list?.snapshotId||'',query?.item||''))||null}});
 const [query,setQuery]=useState<MuseumQuery|null>(initial.query),[search,setSearch]=useState(initial.query?.q||''),[mobile,setMobile]=useState(()=>!!initial.query&&matchMedia('(max-width: 1100px)').matches),[listResponse,setList]=useState<ItemListResult|null>(initial.list),[result,setResult]=useState<ItemResult|null>(initial.result),[loading,setLoading]=useState(!initial.list),[error,setError]=useState(''),[detailError,setDetailError]=useState<{key:string;message:string}|null>(null),[retry,setRetry]=useState(0);
 const listKey=useRef(initial.query?listQuery(initial.query,language).toString():'');
 const stateRef=useRef(query),listRun=useRef(0),detailRun=useRef(0),lastCard=useRef<HTMLElement|null>(null),grid=useRef<HTMLDivElement|null>(null),opened=useRef(false),noAutoSelect=useRef(!!initial.query),restoreScroll=useRef<number|null>(null);
 const desktopDetail=useRef<HTMLElement>(null),mobileDetail=useRef<HTMLDivElement>(null);
 stateRef.current=query;
 const update=useCallback((patch:Partial<MuseumQuery>,replace=false)=>{const current=stateRef.current;if(!current||window.location.pathname!=='/museum')return;const next={...current,...patch};stateRef.current=next;setQuery(next);window.history[replace?'replaceState':'pushState']({...window.history.state,museum:true},'',museumUrl(next))},[]);
 useEffect(()=>{if(cache)cache.visited=true;const media=matchMedia('(max-width: 1100px)');const syncMedia=()=>setMobile(media.matches);syncMedia();const initial=readMuseumQuery(window.location.search);stateRef.current=initial;setQuery(initial);setSearch(initial.q);const sync=()=>{if(window.location.pathname!=='/museum')return;const next=readMuseumQuery(window.location.search);stateRef.current=next;setQuery(next);setSearch(next.q);noAutoSelect.current=true;if(!next.item)opened.current=false};window.addEventListener('popstate',sync);media.addEventListener('change',syncMedia);return()=>{window.removeEventListener('popstate',sync);media.removeEventListener('change',syncMedia)}},[]);
 useEffect(()=>{if(!query||search===query.q)return;const timer=setTimeout(()=>{noAutoSelect.current=false;update({q:search,page:1,item:''},true);grid.current?.scrollTo(0,0)},250);return()=>clearTimeout(timer)},[search,query,update]);
 const requestKey=query?listQuery(query,language).toString():'';
 const list=cache?.lists.get(requestKey)||(listKey.current===requestKey?listResponse:null);
 useEffect(()=>{if(!requestKey)return;const abort=new AbortController(),id=++listRun.current;setError('');
  const accept=(data:ItemListResult)=>{listKey.current=requestKey;setList(data);setLoading(false);const current=stateRef.current!;const patch:Partial<MuseumQuery>={};if(!current.snapshotId&&data.snapshotId)patch.snapshotId=data.snapshotId;if(!current.item&&!matchMedia('(max-width: 1100px)').matches&&!noAutoSelect.current&&data.items[0])patch.item=data.items[0].id;if(Object.keys(patch).length)update(patch,true)};
  const cached=cache?.lists.get(requestKey);if(cached){accept(cached);return}
  setLoading(true);setList(null);
  request<ItemListResult>('/api/items?'+requestKey,{signal:abort.signal}).then(data=>{if(abort.signal.aborted||id!==listRun.current)return;cache?.lists.set(requestKey,data,[resolvedListKey(requestKey,data.snapshotId)]);accept(data)}).catch(e=>{if(!abort.signal.aborted&&id===listRun.current)setError(e.message)}).finally(()=>{if(!abort.signal.aborted&&id===listRun.current)setLoading(false)});return()=>abort.abort();
 },[requestKey,retry,update,cache]);
 const selected=query?.item||'',snapshot=query?.snapshotId||list?.snapshotId||'',selectedKey=archiveDetailKey(language,snapshot,selected);
 useEffect(()=>{const cached=cache?.details.get(selectedKey);setResult(cached||null);setDetailError(null);if(cached||!selected||!snapshot)return;const abort=new AbortController(),id=++detailRun.current;
  request<ItemResult>(`/api/items/${encodeURIComponent(selected)}?`+new URLSearchParams({language,snapshotId:snapshot}),{signal:abort.signal}).then(data=>{
   if(abort.signal.aborted||id!==detailRun.current)return;
   if(data?.item?.id!==selected||data.item.language!==language||data.snapshotId!==snapshot){setDetailError({key:selectedKey,message:''});return}
   cache?.details.set(selectedKey,data);setResult(data);
  }).catch(e=>{if(!abort.signal.aborted&&id===detailRun.current)setDetailError({key:selectedKey,message:e.message})});return()=>abort.abort();
 },[selectedKey,selected,snapshot,language,retry,cache]);
 useLayoutEffect(()=>{if(!loading&&grid.current){grid.current.scrollTop=restoreScroll.current??cache?.scroll.get(requestKey)??0;restoreScroll.current=null}},[loading,requestKey,cache]);
 useLayoutEffect(()=>{const panel=mobile?mobileDetail.current:desktopDetail.current;if(panel)panel.scrollTop=0},[selectedKey,mobile]);
 function filter(patch:Partial<MuseumQuery>){noAutoSelect.current=false;restoreScroll.current=0;update({...patch,item:'',page:1});grid.current?.scrollTo(0,0)}
 function select(id:string){lastCard.current=document.activeElement as HTMLElement;opened.current=true;update({item:id})}
 function close(){noAutoSelect.current=true;if(mobile&&opened.current){opened.current=false;window.history.back()}else update({item:''},true)}
 const currentResult=cache?.details.get(selectedKey)||(result&&result.item.id===selected&&result.item.language===language&&result.snapshotId===snapshot?result:null);
 const summary=list?.snapshotId===snapshot?list.items.find(item=>item.id===selected&&item.language===language):undefined;
 const selectedError=detailError?.key===selectedKey?(detailError.message||(zh?'返回的道具资料与当前选择不一致。':'The response did not match the selected item.')):(!snapshot?error:'');
 const detail=selected?<ItemDetail result={currentResult} summary={summary} selected={selected} recordKey={selectedKey} error={selectedError} onRetry={()=>setRetry(v=>v+1)} locale={locale} onClose={close} onSelect={id=>update({item:id},true)} onOpenDocument={onOpenDocument} onAsk={onAsk}/>:<div className="museum-detail-state"><Emblem/><p>{zh?'选择道具，查看它的故事与属性。':'Select an item to read its story and stats.'}</p></div>;
 return <section className="museum-workspace" aria-label={zh?'万象集录':'Compendium'}>
  <header className="museum-header"><Emblem/><div><h1>{zh?'万象集录':'Compendium'}</h1><p>{zh?'武器、圣遗物与旅途中的珍藏':'Weapons, artifacts and treasures of the journey'}</p></div></header>
  <div className="museum-layout"><div className="museum-inventory">
   <div className="museum-toolbar"><label className="museum-search"><MagnifyingGlass size={21}/><input type="search" aria-label={zh?'搜索道具':'Search items'} placeholder={zh?'搜索道具名称或说明…':'Search item names or descriptions…'} value={search} onChange={e=>setSearch(e.target.value)}/></label><ThemedSelect archive label={zh?'稀有度':'Rarity'} value={query?.rarity||''} onValueChange={rarity=>filter({rarity})} options={[{value:'',label:zh?'全部星级':'All rarities'},...[5,4,3,2,1].map(n=>({value:String(n),label:`${n}${zh?'星':' stars'}`}))]}/><ThemedSelect archive label={zh?'排序':'Sort'} value={query?.sort||'rarity'} onValueChange={sort=>filter({sort:sort as MuseumQuery['sort']})} options={[{value:'rarity',label:zh?'稀有度排序':'By rarity'},{value:'name',label:zh?'名称排序':'By name'}]}/></div>
   <nav className="museum-categories" aria-label={zh?'道具分类':'Item categories'}><button aria-pressed={query?.category===''} onClick={()=>filter({category:'',weaponType:''})}><SquaresFour size={23}/><span>{zh?'全部':'All'}</span></button>{itemCategories.map(category=>{const Icon=categoryIcons[category];return <button key={category} aria-pressed={query?.category===category} onClick={()=>filter({category,weaponType:''})}><Icon size={23} weight="duotone"/><span>{categoryNames[category][zh?0:1]}</span></button>})}</nav>
   <div className="museum-list-options"><span aria-live="polite">{loading?(zh?'检索中…':'Searching…'):list?(zh?`${list.total.toLocaleString(locale)} 条源数据记录`:`${list.total.toLocaleString(locale)} source records`):''}</span>{query?.category==='weapon'&&<ThemedSelect archive label={zh?'武器类型':'Weapon type'} value={query.weaponType} onValueChange={weaponType=>filter({weaponType})} options={[{value:'',label:zh?'全部武器':'All weapons'},...weaponTypes.map((type,i)=>({value:type,label:(zh?['单手剑','双手剑','长柄武器','法器','弓','弩']:['Sword','Claymore','Polearm','Catalyst','Bow','Crossbow'])[i]}))]}/>}<label><input type="checkbox" checked={query?.includeInternal||false} onChange={e=>filter({includeInternal:e.target.checked})}/>{zh?'包含内部记录':'Include internal records'}</label></div>
   <div className="museum-grid-scroll" ref={grid} aria-busy={loading} onScroll={e=>{if(window.location.pathname==='/museum')cache?.scroll.set(requestKey,e.currentTarget.scrollTop)}}>
    {error?<div className="museum-empty"><p role="alert">{zh?'无法读取道具列表：':'Could not load items: '}{error}</p><button onClick={()=>setRetry(v=>v+1)}><ArrowClockwise size={18}/>{zh?'重试':'Retry'}</button></div>:!list&&loading?<div className="museum-grid">{Array.from({length:24},(_,i)=><div className="museum-card-skeleton" key={i}/>)}</div>:list&&!list.ready?<div className="museum-empty"><BookEmpty/><h2>{zh?'此快照尚未构建道具图鉴':'This snapshot has no item catalog'}</h2><p>{zh?'原始文献仍可在尘世文卷阅读。':'Original documents remain available in Teyvat Archive.'}</p></div>:list?.items.length?<div className="museum-grid">{list.items.map(item=><button key={item.id} className="museum-card" data-item-id={item.id} data-category={item.category} data-rarity={item.rarity||1} aria-pressed={selected===item.id} onClick={()=>select(item.id)}><ItemImage item={item} zh={zh}/><Rarity value={item.rarity} zh={zh}/><span className="museum-card-name">{item.name}</span>{selected===item.id&&<span className="museum-selected"><Check size={14} weight="bold"/></span>}{item.state==='internal'&&<small className="museum-internal">{zh?'内部':'Internal'}</small>}</button>)}</div>:<div className="museum-empty"><MagnifyingGlass size={34}/><h2>{zh?'没有找到匹配道具':'No matching items'}</h2><p>{zh?'试试其他名称，或清除当前筛选。':'Try another name or clear the current filters.'}</p><button onClick={()=>{setSearch('');filter({q:'',category:'weapon',rarity:'',weaponType:'',includeInternal:false})}}>{zh?'清除筛选':'Clear filters'}</button></div>}
   </div>
   {list&&list.total>list.pageSize&&<nav className="museum-pagination" aria-label={zh?'分页':'Pagination'}><button aria-label={zh?'上一页':'Previous page'} disabled={loading||list.page<=1} onClick={()=>{noAutoSelect.current=false;update({page:list.page-1,item:''});grid.current?.scrollTo(0,0)}}><CaretLeft size={19}/></button><span>{list.page} / {Math.ceil(list.total/list.pageSize)}</span><button aria-label={zh?'下一页':'Next page'} disabled={loading||list.page*list.pageSize>=list.total} onClick={()=>{noAutoSelect.current=false;update({page:list.page+1,item:''});grid.current?.scrollTo(0,0)}}><CaretRight size={19}/></button></nav>}
  </div>{!mobile&&<aside ref={desktopDetail} className="museum-detail-scroll" aria-label={zh?'道具详情':'Item details'}>{detail}</aside>}</div>
  <Dialog.Root open={mobile&&!!selected} onOpenChange={open=>{if(!open)close()}}><Dialog.Portal><Dialog.Overlay className="overlay museum-overlay"/><Dialog.Content ref={mobileDetail} className="museum-mobile-detail" onCloseAutoFocus={e=>{e.preventDefault();lastCard.current?.focus({preventScroll:true})}}><Dialog.Title className="sr-only">{currentResult?.item.name||summary?.name||(zh?'道具详情':'Item details')}</Dialog.Title><Dialog.Description className="sr-only">{zh?'属性、故事和来源':'Stats, story and sources'}</Dialog.Description>{detail}</Dialog.Content></Dialog.Portal></Dialog.Root>
 </section>;
}
function BookEmpty(){return <SquaresFour size={40} weight="duotone"/>}
