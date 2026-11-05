'use client';
import {useState} from 'react';
import {ArrowLeft,ArrowSquareOut,ChatCircle,BookOpen} from '@phosphor-icons/react';
import {ThemedSelect} from '../themed-select';
import {ItemImage,Rarity,categoryNames} from './item-image';
import {ascensionCost,formatStat,possibleSubstats,itemSubtypeLabel,type Item,type ItemResult,type ItemTcg,type TcgCost} from '../../lib/items';
import type {Locale} from '../../lib/contracts';
import {safeUrl} from '../../lib/client';

interface Props {result:ItemResult;locale:Locale;onClose:()=>void;onSelect:(id:string)=>void;onOpenDocument:(id:string,snapshotId:string)=>void;onAsk:(name:string,id:string,snapshotId:string)=>void}
export function ItemDetail({result,locale,onClose,onSelect,onOpenDocument,onAsk}:Props){
 const {item,snapshotId}=result,zh=locale==='zh-CN';
 const [tab,setTab]=useState('attributes');
 const tabs=[{id:'attributes',name:zh?'属性':'Details'},...(item.weapon?.ascensions.length?[{id:'growth',name:zh?'培养':'Ascension'}]:[]),...(item.story?[{id:'story',name:zh?'故事':'Story'}]:[]),...(item.tcg?[{id:'tcg',name:zh?'七圣召唤':'TCG'}]:[]),{id:'sources',name:zh?'来源':'Sources'}];
 return <article className="museum-detail">
  <header className="museum-detail-heading"><div><h2>{item.name}</h2><p>{itemSubtypeLabel(item,categoryNames[item.category])}</p><Rarity value={item.rarity} zh={zh}/></div><button onClick={onClose} aria-label={zh?'返回道具列表':'Back to items'} title={zh?'返回道具列表':'Back to items'}><ArrowLeft size={23}/></button></header>
  <ItemImage item={item} zh={zh} large/>
  <div className="museum-detail-body">
   {item.weapon&&<WeaponStats item={item} locale={locale}/>}
   <div className="museum-tabs" role="tablist" aria-label={zh?'道具详情':'Item details'}>{tabs.map((t,i)=><button key={t.id} role="tab" id={`museum-tab-${t.id}`} aria-controls="museum-tabpanel" aria-selected={tab===t.id} tabIndex={tab===t.id?0:-1} onClick={()=>setTab(t.id)} onKeyDown={e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?tabs.length-1:(i+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;setTab(tabs[next].id);document.getElementById(`museum-tab-${tabs[next].id}`)?.focus()}}>{t.name}</button>)}</div>
   <section id="museum-tabpanel" role="tabpanel" aria-labelledby={`museum-tab-${tab}`} tabIndex={0}>
    {tab==='attributes'&&<>{item.weapon&&<WeaponRefinement item={item} zh={zh}/>}<p className="museum-description">{item.description|| (zh?'上游尚未提供说明。':'The source has not supplied a description.')}</p>{item.artifact&&<ArtifactRules item={item} locale={locale}/>}{!!item.attributes.length&&<dl className="museum-attributes">{item.attributes.map((a,i)=><div key={i}><dt>{a.label}</dt><dd>{a.value}</dd></div>)}</dl>}{!!item.acquisition.length&&<><h3>{zh?'获取与用途':'Acquisition and use'}</h3>{item.acquisition.map((a,i)=><p key={i}>{a}</p>)}</>}</>}
    {tab==='growth'&&<AscensionCosts item={item} locale={locale} onSelect={onSelect}/>}
    {tab==='story'&&<p className="museum-story">{item.story}</p>}
    {tab==='tcg'&&item.tcg&&<CardDetails card={item.tcg} itemName={item.name} locale={locale}/>}
    {tab==='sources'&&<><p className="museum-record-state">{item.state==='internal'?(zh?'内部记录 · 不代表可获得道具':'Internal record · Availability not established'):(zh?'收录于源数据 · 不代表当前可获取':'Source record · Current availability not established')}</p><dl className="museum-provenance"><dt>{zh?'快照':'Snapshot'}</dt><dd>{snapshotId}</dd><dt>ID</dt><dd>{item.id}</dd></dl>{item.sources.map((s,i)=><div className="museum-source" key={i}><strong>{s.path}</strong><span>{s.commit} · {s.locator}</span>{safeUrl(s.url)&&<a href={safeUrl(s.url)} target="_blank" rel="noopener noreferrer">{zh?'查看固定版本来源':'View pinned source'}<ArrowSquareOut size={16}/></a>}</div>)}<details className="museum-coverage"><summary>{zh?'资料完整性':'Data completeness'}</summary><dl>{Object.entries(item.coverage).map(([key,value])=><div key={key}><dt>{key}</dt><dd>{({complete:zh?'完整':'Complete','not-applicable':zh?'不适用':'Not applicable','upstream-missing':zh?'上游缺失':'Missing upstream',unresolved:zh?'尚未解析':'Unresolved',unreachable:zh?'不可达':'Unreachable'})[value]}</dd></div>)}</dl></details>{item.documentIds.length?item.documentIds.map((id,i)=><button className="museum-document" key={id} onClick={()=>onOpenDocument(id,snapshotId)}><BookOpen size={18}/>{zh?'查看原始文献':'Read original document'}{i>0?` ${i+1}`:''}</button>):<p>{zh?'该记录尚未关联原始文献。':'No original document is linked to this record.'}</p>}</>}
   </section>
   <button className="museum-ask" onClick={()=>onAsk(item.name,item.id,snapshotId)}><ChatCircle size={20}/>{zh?'向终端询问此道具':'Ask the terminal about this item'}</button>
  </div>
 </article>;
}
const cardFaceLabels={standard:['普通卡面','Standard card face'],gold:['金色卡面','Gold card face'],platinum:['白金卡面','Platinum card face']} as const;
const cardCostLabels:Record<string,readonly [string,string]>={
 GCG_COST_DICE_ANEMO:['风元素骰','Anemo dice'],GCG_COST_DICE_CRYO:['冰元素骰','Cryo dice'],
 GCG_COST_DICE_DENDRO:['草元素骰','Dendro dice'],GCG_COST_DICE_ELECTRO:['雷元素骰','Electro dice'],
 GCG_COST_DICE_GEO:['岩元素骰','Geo dice'],GCG_COST_DICE_HYDRO:['水元素骰','Hydro dice'],
 GCG_COST_DICE_PYRO:['火元素骰','Pyro dice'],GCG_COST_DICE_SAME:['相同元素骰','Matching elemental dice'],
 GCG_COST_DICE_VOID:['任意元素骰','Any elemental dice'],GCG_COST_ENERGY:['充能','Energy'],
 GCG_COST_LEGEND:['秘传','Arcane Legend'],
};
function CardCosts({costs,locale}:{costs:TcgCost[];locale:Locale}){
 const zh=locale==='zh-CN',labelIndex=zh?0:1;
 return <dl className="museum-attributes">{costs.map(({type,count},i)=><div key={i}><dt>{Object.hasOwn(cardCostLabels,type)?cardCostLabels[type][labelIndex]:zh?'其他费用':'Other cost'}</dt><dd>{formatStat(count,'',locale)}</dd></div>)}</dl>;
}
function CardDetails({card,itemName,locale}:{card:ItemTcg;itemName:string;locale:Locale}){
 const zh=locale==='zh-CN',labelIndex=zh?0:1;
 return <>
  <h3>{card.name||itemName}</h3><p className="museum-note">{cardFaceLabels[card.face]?.[labelIndex]}</p>
  {card.effect&&<><h3>{zh?'卡牌效果':'Card effect'}</h3><p>{card.effect}</p></>}
  {card.hp!==undefined&&<dl className="museum-attributes"><div><dt>{zh?'生命值':'Health'}</dt><dd>{formatStat(card.hp,'',locale)}</dd></div></dl>}
  {!!card.costs?.length&&<><h3>{zh?'费用':'Cost'}</h3><CardCosts costs={card.costs} locale={locale}/></>}
  {!!card.skills?.length&&<><h3>{zh?'角色技能':'Character skills'}</h3>{card.skills.map(skill=><div key={skill.id}>
   {skill.name&&<h4>{skill.name}</h4>}{skill.effect&&<p>{skill.effect}</p>}
   {!!skill.costs?.length&&<CardCosts costs={skill.costs} locale={locale}/>}
  </div>)}</>}
  {(card.storyTitle||card.story)&&<><h3>{card.storyTitle||(zh?'卡牌故事':'Card story')}</h3>{card.story&&<p className="museum-story">{card.story}</p>}</>}
  {card.acquisition&&<><h3>{zh?'卡牌获取方式':'How to obtain the card'}</h3><p>{card.acquisition}</p></>}
 </>;
}
function WeaponStats({item,locale}:{item:Item;locale:Locale}){
 const levels=item.weapon!.levels,zh=locale==='zh-CN';const [index,setIndex]=useState(Math.max(0,levels.length-1));const selected=levels[index];
 if(!selected)return <p className="museum-missing">{zh?'等级属性尚未解析。':'Level statistics are not yet available.'}</p>;
 return <div className="museum-weapon-stats"><label className="museum-control"><span>{zh?'等级':'Level'}</span><ThemedSelect label={zh?'等级与突破':'Level and ascension'} value={String(index)} onValueChange={v=>setIndex(Number(v))} options={levels.map((l,i)=>({value:String(i),label:`${l.level} · ${zh?'突破':'Ascension'} ${l.ascension}`}))}/></label><dl className="museum-stats">{selected.stats.map(stat=><div key={stat.key}><dt>{stat.label}</dt><dd>{formatStat(stat.value,stat.unit,locale)}</dd></div>)}</dl></div>;
}
function WeaponRefinement({item,zh}:{item:Item;zh:boolean}){
 const refinements=item.weapon!.refinements,[rank,setRank]=useState(String(refinements[0]?.rank||1)),selected=refinements.find(r=>String(r.rank)===rank);
 return selected?<><label className="museum-control"><span>{zh?'精炼':'Refinement'}</span><ThemedSelect label={zh?'精炼':'Refinement'} value={rank} onValueChange={setRank} options={refinements.map(r=>({value:String(r.rank),label:`${zh?'精炼':'Rank'} ${r.rank}`}))}/></label><h3>{selected.name}</h3><p>{selected.description}</p></>:<p>{zh?'武器技能尚未解析。':'The weapon skill is not yet available.'}</p>;
}
function AscensionCosts({item,locale,onSelect}:{item:Item;locale:Locale;onSelect:(id:string)=>void}){
 const stages=item.weapon!.ascensions,zh=locale==='zh-CN',[phase,setPhase]=useState(String(stages[0]?.phase||1)),[cumulative,setCumulative]=useState(false),cost=ascensionCost(stages,Number(phase),cumulative);
 return <><label className="museum-control"><span>{zh?'突破阶段':'Ascension stage'}</span><ThemedSelect label={zh?'突破阶段':'Ascension stage'} value={phase} onValueChange={setPhase} options={stages.map(s=>({value:String(s.phase),label:`${zh?'突破':'Phase'} ${s.phase} · ${s.levelCap}`}))}/></label><div className="museum-cost-mode"><button aria-pressed={!cumulative} onClick={()=>setCumulative(false)}>{zh?'本阶段':'This stage'}</button><button aria-pressed={cumulative} onClick={()=>setCumulative(true)}>{zh?'累计至此阶段':'Cumulative to this stage'}</button></div><h3>{zh?'突破材料':'Ascension materials'}</h3><div className="museum-cost"><p><span>{zh?'摩拉':'Mora'}</span><strong>{formatStat(cost.coin,'',locale)}</strong></p>{cost.items.map(i=><button key={i.id} onClick={()=>onSelect(i.id)}><span>{i.name}</span><strong>× {formatStat(i.count,'',locale)}</strong></button>)}</div><p className="museum-note">{zh?'仅统计突破，不含升级所需经验与摩拉。':'Ascension only; excludes level-up experience and Mora.'}</p></>;
}
function ArtifactRules({item,locale}:{item:Item;locale:Locale}){
 const artifact=item.artifact!,zh=locale==='zh-CN';const [rarity,setRarity]=useState(String(artifact.rules.at(-1)?.rarity||5));const rule=artifact.rules.find(r=>String(r.rarity)===rarity);const [mainKey,setMainKey]=useState(''),[level,setLevel]=useState<number|null>(null);
 const main=rule?.mainStats.find(m=>m.key===mainKey)||rule?.mainStats[0],levels=main?.values||[],selected=levels.find(v=>v.level===level)||levels.at(-1);
 return <><h3>{artifact.setName}</h3>{artifact.setEffects.map(e=><p key={e.pieces}><strong>{e.pieces}{zh?'件套':' pieces'}</strong> · {e.text}</p>)}<h3>{zh?'词条规则':'Stat rules'}</h3><p className="museum-note">{zh?'以下合并展示源数据不同配置变体的词条与属性值，不代表普通掉落可出现的词条或档位。':'Stats and values from different source configuration variants are combined here; they do not represent stats or roll tiers available on ordinary artifact drops.'}</p>{rule&&main&&selected?<><label className="museum-control"><span>{zh?'星级':'Rarity'}</span><ThemedSelect label={zh?'圣遗物星级':'Artifact rarity'} value={rarity} onValueChange={v=>{setRarity(v);setLevel(null);setMainKey('')}} options={artifact.rules.map(r=>({value:String(r.rarity),label:`${r.rarity}${zh?'星':' stars'}`}))}/></label><label className="museum-control"><span>{zh?'等级':'Level'}</span><ThemedSelect label={zh?'圣遗物等级':'Artifact level'} value={String(selected.level)} onValueChange={v=>setLevel(Number(v))} options={levels.map(v=>({value:String(v.level),label:`+${v.level}`}))}/></label><label className="museum-control"><span>{zh?'主属性':'Main stat'}</span><ThemedSelect label={zh?'主属性':'Main stat'} value={main.key} onValueChange={setMainKey} options={rule.mainStats.map(m=>({value:m.key,label:m.label}))}/></label><dl className="museum-stats"><div><dt>{main.label}</dt><dd>{formatStat(selected.value,main.unit,locale)}</dd></div></dl><h3>{zh?'可能副属性':'Possible substats'}</h3><dl className="museum-substats">{possibleSubstats(rule.substats,main.key).map(s=><div key={s.key}><dt>{s.label}</dt><dd>{s.values.map(v=>formatStat(v,s.unit,locale)).join(' / ')}</dd></div>)}</dl></>:<p>{zh?'此部位的词条规则尚未解析。':'Stat rules for this slot are not yet available.'}</p>}</>;
}
