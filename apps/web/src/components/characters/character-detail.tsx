'use client';
import {useState,useLayoutEffect,useRef,type ReactNode} from 'react';
import {ArrowLeft,ArrowClockwise,BookOpen,ChatCircle,ArrowSquareOut} from '@phosphor-icons/react';
import {ArchiveSkeleton,ArchivePendingValue} from '../archive-skeleton';
import {ThemedSelect} from '../themed-select';
import {Rarity} from '../museum/item-image';
import type {Locale} from '../../lib/contracts';
import {defaultLevel,elements,formatCharacterStat,orderedCharacterStats,readableCharacterText,resolveCharacterPortrait,type CharacterResult,type CharacterSummary,type CharacterQuery,type CharacterForm} from '../../lib/characters';
import {CharacterStatIcon,ElementIcon} from '../game-icons';
import {CharacterImage,CharacterPortrait,CharacterPortraitPlaceholder,CharacterTabs,CharacterText} from './character-ui';
import {CharacterVoices,voiceLocaleNames} from './character-voices';
import {CharacterStories} from './character-narrative';
import {CharacterCultivation} from './character-materials';
interface Props {result:CharacterResult|null;recordKey:string;error:string;onRetry:()=>void;query:CharacterQuery;locale:Locale;language:Locale;characters:CharacterSummary[];poolPending:boolean;onRetryPool?:()=>void;onUpdate:(patch:Partial<CharacterQuery>,replace?:boolean)=>void;onBack:()=>void;onOpenDocument:(id:string,snapshot:string)=>void;onAsk:(name:string,id:string,snapshot:string)=>void;onOpenMaterial:(id:string,snapshot:string)=>void}
export function CharacterDetail(props:Props){
 const {result,recordKey,error,onRetry,query,locale,characters,poolPending,onRetryPool,onUpdate,onBack}=props,zh=locale==='zh-CN';
 const character=result?.character;
 const summary=characters.find(c=>c.id===query.character);
 const form=character?.forms.find(f=>f.id===query.form)||character?.forms[0];
 const profile=character||summary,baseIdentity=character||(!query.form?summary:undefined);
 const element=(form?form.element:baseIdentity?.element)||'',elementName=(form?form.elementName:baseIdentity?.elementName)||'';
 const identity=<CharacterIdentity character={profile} element={element} elementName={elementName} zh={zh}/>;
 const avatarStrip=useRef<HTMLDivElement>(null),extra=character&&!summary?character:null;
 const strip=(extra?[extra,...characters]:characters).filter(c=>!query.browseElement||c.element===query.browseElement);
 useLayoutEffect(()=>{
  const rail=avatarStrip.current,active=rail?.querySelector<HTMLButtonElement>('[aria-pressed="true"]');
  if(active)active.scrollIntoView({block:'nearest',inline:'center',behavior:'auto'});
  else if(rail)rail.scrollLeft=0;
 },[query.character,query.browseElement,characters,extra]);
 return <div className="character-detail" data-element={element} data-character-detail={character?.id}>
  <header className="character-detail-header">
   <button className="character-back" aria-label={zh?'返回图鉴':'Back to archive'} onClick={onBack}><ArrowLeft size={23}/><span>{zh?'返回图鉴':'Back to archive'}</span></button>
   <div className="character-browse-select"><ThemedSelect archive label={zh?'浏览元素':'Browse by element'} value={query.browseElement} onValueChange={browseElement=>onUpdate({browseElement})}
    options={[{value:'',label:zh?'全部元素':'All elements'},...elements.map((value,i)=>({value,icon:<ElementIcon element={value}/>,label:(zh?['火','水','风','雷','冰','岩','草']:['Pyro','Hydro','Anemo','Electro','Cryo','Geo','Dendro'])[i]}))]}/></div>
   <div ref={avatarStrip} className="character-avatar-strip" role="group" aria-label={zh?'切换角色':'Switch character'} aria-busy={poolPending}>
    {strip.map(c=><button key={c.id} data-character-id={c.id} aria-label={c.name} aria-pressed={c.id===query.character} onClick={()=>{if(c.id!==query.character)onUpdate({character:c.id,form:''})}}><CharacterImage media={c.icon} name={c.name}/></button>)}
    {poolPending&&!strip.length&&Array.from({length:5},(_,i)=><ArchiveSkeleton key={i} className="character-avatar-placeholder" width="46px" height="50px"/>)}
    {!poolPending&&!onRetryPool&&!strip.length&&<span className="character-browse-empty" role="status">{zh?'没有匹配的角色':'No matching characters'}</span>}
   </div>
   {onRetryPool&&<button className="character-browse-retry" aria-label={zh?'重试加载角色列表':'Retry loading characters'} onClick={onRetryPool}><ArrowClockwise size={19}/></button>}
  </header>
  {result?<CharacterRecord key={`${recordKey}:${query.form}`} {...props} result={result} form={form} identity={identity}/>:error?<div className="character-state"><h2>{zh?'角色资料暂时无法读取':'Character details could not be loaded'}</h2><p role="alert">{error}</p><button onClick={onRetry}><ArrowClockwise size={18}/>{zh?'重试':'Retry'}</button></div>:<CharacterDetailSkeleton key={recordKey} query={query} locale={locale} onUpdate={onUpdate} identity={identity}/>}
 </div>;
}
function CharacterIdentity({character,element,elementName,zh}:{character?:CharacterSummary;element:string;elementName:string;zh:boolean}){
 const subtitle=character?[character.title,character.weaponName].filter(Boolean).join(' · '):'';
 return <div className="character-identity"><div className="character-identity-heading">{element&&<span className="character-identity-element" role="img" aria-label={elementName||element}><ElementIcon element={element}/></span>}<h1 aria-hidden={!character||undefined}>{character?.name||<ArchiveSkeleton width="10rem" height="0.85em"/>}</h1>{character&&<Rarity value={character.rarity} zh={zh}/>}</div>{(subtitle||!character)&&<p>{subtitle||<ArchiveSkeleton width="8rem"/>}</p>}</div>;
}
function CharacterSectionTabs({query,zh,onUpdate}:{query:CharacterQuery;zh:boolean;onUpdate:Props['onUpdate']}){
 const tabs=[{value:'attributes' as const,label:zh?'属性':'Attributes'},{value:'constellations' as const,label:zh?'命之座':'Constellations'},{value:'talents' as const,label:zh?'天赋':'Talents'},{value:'info' as const,label:zh?'资料':'Profile'},{value:'cultivation' as const,label:zh?'培养':'Cultivation'}];
 return <CharacterTabs id="character-section" label={zh?'角色资料分区':'Character sections'} items={tabs} value={query.tab} onChange={tab=>onUpdate({tab})} vertical/>;
}
type RecordProps=Pick<Props,'query'|'locale'|'language'|'onUpdate'|'onOpenDocument'|'onAsk'|'onOpenMaterial'>&{result:CharacterResult;form:CharacterForm|undefined;identity:ReactNode};
function CharacterRecord({result,form,identity,query,locale,language,onUpdate,onOpenDocument,onAsk,onOpenMaterial}:RecordProps){
 const {character,snapshotId}=result,zh=locale==='zh-CN';
 const [evidence,setEvidence]=useState(false);
 const supplement=evidence?resolveCharacterPortrait(character).supplement:null;
 return <>
  <div className="character-detail-body"><aside className="character-section-menu"><CharacterSectionTabs query={query} zh={zh} onUpdate={onUpdate}/>{character.state!=='source-record'&&<div className="character-menu-meta"><span>{character.state==='internal'?(zh?'内部源记录':'Internal source record'):(zh?'未分类源记录':'Unclassified source record')}</span></div>}{character.forms.length>1&&<label className="character-form-select">{zh?'元素形态':'Elemental form'}<ThemedSelect archive label={zh?'元素形态':'Elemental form'} value={form?.id||''} onValueChange={id=>onUpdate({form:id})} options={character.forms.map(f=>({value:f.id,label:`${f.name} · ${f.id}`}))}/></label>}</aside>
   <div className="character-content-region">{query.tab!=='attributes'&&identity}
   <div className={'character-section-content '+(query.tab==='attributes'?'attributes':'')} id="character-section-panel" role="tabpanel" aria-labelledby={`character-section-${query.tab}`} tabIndex={0}>
    {query.tab==='attributes'?<>{identity}<CharacterAttributes character={character} form={form} locale={locale}/></>:query.tab==='constellations'?<CharacterConstellations form={form} zh={zh}/>:query.tab==='talents'?<CharacterTalents form={form} zh={zh}/>:query.tab==='cultivation'?<CharacterCultivation character={character} form={form} snapshot={snapshotId} language={language} zh={zh} onOpenMaterial={onOpenMaterial}/>:<div className="character-info"><CharacterTabs id="character-info" label={zh?'角色资料类型':'Profile sections'} value={query.subtab} onChange={subtab=>onUpdate({subtab})} items={[{value:'biography',label:zh?'简介':'Biography'},{value:'stories',label:zh?'故事':'Stories'},{value:'voices',label:zh?'语音':'Voice-overs'}]}/><div id="character-info-panel" role="tabpanel" aria-labelledby={`character-info-${query.subtab}`} tabIndex={0}>{query.subtab==='biography'?<article className="character-reading character-biography"><h2>{character.name}</h2><CharacterText text={character.description}/><dl>{[[zh?'所属':'Affiliation',character.affiliation],[zh?'地区':'Region',character.region],[zh?'生日':'Birthday',character.birthday.month&&character.birthday.day?(zh?`${character.birthday.month}月${character.birthday.day}日`:`${character.birthday.month}/${character.birthday.day}`):''],[zh?'命之座':'Constellation',character.constellationName],...Object.entries(character.cv).map(([l,name])=>[`${voiceLocaleNames[l as keyof typeof voiceLocaleNames]?.[zh?0:1]||l}${zh?'配音':' voice actor'}`,name])].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value|| (zh?'源数据暂缺':'Not recorded')}</dd></div>)}</dl></article>:query.subtab==='stories'?<CharacterStories stories={character.stories} zh={zh}/>:<CharacterVoices key={`${character.id}:${form?.id}:${locale}`} character={character} snapshot={snapshotId} locale={locale} language={language}/>}</div></div>}
   </div>
   </div>
  </div>
  <CharacterDetailActions zh={zh} recordId={character.avatarId} evidence={evidence} onDocument={character.documentIds.length?()=>onOpenDocument(character.documentIds[0],snapshotId):undefined} onAsk={()=>onAsk(character.name,character.id,snapshotId)} onEvidence={()=>setEvidence(v=>!v)}/>
  {evidence&&<section className="character-evidence" aria-label={zh?'来源与覆盖':'Sources and coverage'}><button className="character-evidence-close" onClick={()=>setEvidence(false)}>{zh?'收起':'Close'}</button><h2>{zh?'来源与覆盖':'Sources & coverage'}</h2><p>{zh?'快照':'Snapshot'}: {snapshotId}</p><dl>{Object.entries(character.coverage).map(([field,status])=><div key={field}><dt>{coverageField(field,zh)}</dt><dd>{coverageStatus(status,zh)}</dd></div>)}</dl>{[...new Map(character.sources.map(s=>[s.repo+':'+s.path,s])).values()].slice(0,6).map(s=><a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer"><span>{s.path}</span><small>{s.commit.slice(0,12)}</small><ArrowSquareOut size={16}/></a>)}<p className="character-note">{zh?'显示聚合资料来源摘要；逐条原文保留各自定位。源记录不代表已实装或当前可获取。':'This summary links the underlying source files. Individual records retain exact provenance. Source presence does not prove release or availability.'}</p>{supplement&&<div className="character-supplement-source">
    <h3>{zh?'补充立绘来源':'Supplemental portrait source'}</h3>
    <a href={`https://github.com/${supplement.repository}/blob/${supplement.commit}/${supplement.path}`} target="_blank" rel="noopener noreferrer"><span>{supplement.path}</span><small>{supplement.commit.slice(0,12)}</small><ArrowSquareOut size={16}/></a>
    <p className="character-note">{zh?'仅在快照立绘缺失或加载失败时显示；上方覆盖状态仍按快照记录。':'Shown when the snapshot portrait is missing or fails to load. Coverage above reflects the snapshot.'}</p>
   </div>}</section>}
 </>;
}
function CharacterDetailActions({zh,recordId,evidence,onDocument,onAsk,onEvidence}:{zh:boolean;recordId?:number;evidence?:boolean;onDocument?:()=>void;onAsk?:()=>void;onEvidence?:()=>void}){
 return <footer className="character-detail-footer"><button disabled={!onDocument} onClick={onDocument}><BookOpen size={18}/>{zh?'查看原始文献':'Read original document'}</button><button disabled={!onAsk} onClick={onAsk}><ChatCircle size={18}/>{zh?'向终端询问':'Ask the terminal'}</button><button disabled={!onEvidence} aria-expanded={evidence} onClick={onEvidence}>{zh?'来源与覆盖':'Sources & coverage'}</button><span>{recordId?<>{zh?'源数据记录':'Source record'} · {recordId}</>:<ArchiveSkeleton width="7rem"/>}</span></footer>;
}
function CharacterDetailSkeleton({query,locale,onUpdate,identity}:Pick<RecordProps,'query'|'locale'|'onUpdate'|'identity'>){
 const zh=locale==='zh-CN',attributes=query.tab==='attributes';
 return <>
  <span className="sr-only" role="status">{zh?'正在加载角色资料':'Loading character details'}</span>
  <div className="character-detail-body">
   <aside className="character-section-menu"><CharacterSectionTabs query={query} zh={zh} onUpdate={onUpdate}/></aside>
   <div className="character-content-region">
    {!attributes&&identity}
    <div className={'character-section-content '+(attributes?'attributes':'')} id="character-section-panel" role="tabpanel" aria-labelledby={`character-section-${query.tab}`} aria-busy="true" tabIndex={0}>
     {attributes?<>{identity}
      <div className="character-portrait-stage is-pending"><CharacterPortraitPlaceholder/></div>
      <section className="character-stats-panel" aria-hidden="true">
       <h2>{zh?'角色基础属性':'Character base stats'}</h2><p className="character-note">{zh?'不含武器、圣遗物及条件增益':'Without weapon, artifacts or conditional buffs'}</p>
       <ArchiveSkeleton className="select-trigger archive-control-placeholder" height="44px"/>
       <dl className="character-stat-list">
        {['BASE_HP','BASE_ATTACK','BASE_DEFENSE'].map(key=><div key={key}><dt><CharacterStatIcon stat={key}/><span>{formatCharacterStat(key,0,locale).label}</span></dt><dd><ArchivePendingValue/></dd></div>)}
        {[0,1].map(i=><div key={i}><dt><ArchiveSkeleton width="6em"/></dt><dd><ArchivePendingValue/></dd></div>)}
       </dl>
      </section>
     </>:<CharacterSectionPlaceholder tab={query.tab} zh={zh}/>}
    </div>
   </div>
  </div>
  <CharacterDetailActions zh={zh}/>
 </>;
}
function CharacterSectionPlaceholder({tab,zh}:{tab:CharacterQuery['tab'];zh:boolean}){
 const copy=<div className="character-reading-placeholder"><ArchiveSkeleton width="9rem" height="1.35rem"/><ArchiveSkeleton width="96%"/><ArchiveSkeleton width="87%"/><ArchiveSkeleton width="66%"/></div>;
 const values=<dl className="character-talent-values">{[0,1,2].map(i=><div key={i}><dt><ArchiveSkeleton width="7em"/></dt><dd><ArchivePendingValue/></dd></div>)}</dl>;
 if(tab==='talents'||tab==='constellations')return <div className="character-ability-layout" aria-hidden="true">
  <div className="character-ability-list"><h2>{tab==='talents'?(zh?'天赋':'Talents'):(zh?'命之座':'Constellations')}</h2>{[0,1,2,3].map(i=><div className="character-ability-placeholder" key={i}><ArchiveSkeleton width="44px" height="44px"/><ArchiveSkeleton width="6em"/></div>)}</div>
  <div className="character-reading character-ability-reading">{copy}{tab==='talents'&&values}</div>
 </div>;
 if(tab==='cultivation')return <div className="character-reading" aria-hidden="true">{copy}{values}</div>;
 return <div className="character-info" aria-hidden="true"><div className="character-tabs">{[0,1,2].map(i=><ArchiveSkeleton key={i} width="4.5rem" height="44px"/>)}</div><div className="character-reading character-biography">{copy}</div></div>;
}
function CharacterAttributes({character,form,locale}:{character:CharacterResult['character'];form:CharacterForm|undefined;locale:Locale}){
 const zh=locale==='zh-CN',[selected,setSelected]=useState(defaultLevel(form?.levels||[])),level=form?.levels.find(l=>`${l.level}:${l.ascension}`===selected)||form?.levels.at(-1);
 return <><CharacterPortrait key={character.id} character={character} zh={zh}/><section className="character-stats-panel"><h2>{zh?'角色基础属性':'Character base stats'}</h2><p className="character-note">{zh?'不含武器、圣遗物及条件增益':'Without weapon, artifacts or conditional buffs'}</p>{form?.levels.length?<><ThemedSelect archive label={zh?'等级与突破':'Level and ascension'} value={level?`${level.level}:${level.ascension}`:''} onValueChange={setSelected} options={form.levels.map(l=>({value:`${l.level}:${l.ascension}`,label:zh?`等级 ${l.level} · 突破 ${l.ascension}`:`Level ${l.level} · Ascension ${l.ascension}`}))}/><dl className="character-stat-list">{orderedCharacterStats(level?.stats||{}).map(([key,value])=>{const stat=formatCharacterStat(key,value,locale);return <div key={key}><dt><CharacterStatIcon stat={key}/><span>{stat.label}</span></dt><dd>{stat.value}</dd></div>})}</dl></>:<p>{zh?'此形态的基础属性数据暂缺。':'Base stat data is unavailable for this form.'}</p>}{form?.coverage.stats&&form.coverage.stats!=='complete'&&<p className="character-note">{zh?'部分等级或属性的源数据暂缺，选项仅含可验证记录。':'Some levels or properties are missing from the source. Only verified records are listed.'}</p>}<div className="character-attribute-lore"><h3>{character.constellationName}</h3><p>{character.affiliation||character.region}</p><CharacterText text={character.description}/></div></section></>;
}
function CharacterConstellations({form,zh}:{form:CharacterForm|undefined;zh:boolean}){const [selected,setSelected]=useState(form?.constellations[0]?.id||''),node=form?.constellations.find(c=>c.id===selected)||form?.constellations[0];return <div className="character-ability-layout"><div className="character-ability-list"><h2>{zh?'命之座':'Constellations'}</h2><p className="character-note">{zh?'按原始顺序展示节点；暂无可验证的原始星座连线图。':'Nodes follow source order. A verified original constellation diagram is unavailable.'}</p>{form?.constellations.map(c=><button key={c.id} aria-pressed={c.id===node?.id} onClick={()=>setSelected(c.id)}><span className="character-node-number">{c.order}</span><CharacterImage media={c.icon} name=""/><span>{c.name}</span></button>)}</div><article className="character-reading character-ability-reading">{node?<><CharacterImage media={node.icon} name={node.name}/><h2>{node.name}</h2><CharacterText text={node.description}/><p className="character-note">{zh?'查看说明不会改变基础属性面板。':'Viewing this description does not change the base stat panel.'}</p></>:<p>{zh?'此形态暂无命之座记录。':'No constellation records are available for this form.'}</p>}</article></div>}
function CharacterTalents({form,zh}:{form:CharacterForm|undefined;zh:boolean}){
 const [selected,setSelected]=useState(form?.talents[0]?.id||''),[selectedLevel,setSelectedLevel]=useState(1),talent=form?.talents.find(t=>t.id===selected)||form?.talents[0],level=talent?.levels.find(l=>l.level===selectedLevel)||talent?.levels[0];
 const kinds:Record<string,[string,string]>={normal:['普通攻击','Normal Attack'],skill:['元素战技','Elemental Skill'],burst:['元素爆发','Elemental Burst'],passive:['固有天赋','Passive Talent']};
 return <div className="character-ability-layout"><nav className="character-ability-list" aria-label={zh?'天赋条目':'Talent entries'}><h2>{zh?'天赋':'Talents'}</h2>{form?.talents.map(t=><button key={t.id} aria-pressed={t.id===talent?.id} onClick={()=>{setSelected(t.id);setSelectedLevel(1)}}><CharacterImage media={t.icon} name=""/><span>{t.name}<small>{kinds[t.kind]?.[zh?0:1]}</small></span></button>)}</nav><article className="character-reading character-ability-reading">{talent?<><h2>{talent.name}</h2><CharacterText text={talent.description}/><dl className="character-talent-meta">{talent.cooldown!==null&&<div><dt>{zh?'冷却时间':'Cooldown'}</dt><dd>{talent.cooldown}s</dd></div>}{talent.energyCost!==null&&<div><dt>{zh?'元素能量':'Energy cost'}</dt><dd>{talent.energyCost}</dd></div>}{talent.unlockAscension!==null&&<div><dt>{zh?'解锁突破阶段':'Unlock ascension'}</dt><dd>{talent.unlockAscension}</dd></div>}</dl>{level&&<><ThemedSelect archive label={zh?'天赋等级':'Talent level'} value={String(level.level)} onValueChange={v=>setSelectedLevel(Number(v))} options={talent.levels.map(l=>({value:String(l.level),label:(zh?`等级 ${l.level}`:`Level ${l.level}`)+(!l.upgradeable?(zh?' · 额外等级':' · Additional level'):'')}))}/>{!level.upgradeable&&<p className="character-note">{zh?'这是来源中的额外等级，没有明确的手动升级材料。':'This additional source level has no explicit manual upgrade costs.'}</p>}<dl className="character-talent-values">{level.attributes.map((attribute,i)=>{if(attribute.status!=='complete'||!attribute.text)return <div key={i}><dt>{zh?'倍率条目':'Parameter entry'}</dt><dd>{zh?'尚未解析':'Unresolved'}</dd></div>;const [label,...values]=readableCharacterText(attribute.text).split('|');return <div key={i}><dt>{label}</dt><dd>{values.join(' · ')}</dd></div>})}</dl>{!!level.unresolvedAttributeHashes?.length&&<p className="character-note">{zh?'部分倍率标题的本地化原文暂缺。':'Some parameter labels are missing from the localized source.'}</p>}</>}</>:<p>{zh?'此形态暂无天赋记录。':'No talent records are available for this form.'}</p>}</article></div>;
}
const fieldLabels:Record<string,[string,string]>={stats:['属性','Stats'],talents:['天赋','Talents'],constellations:['命之座','Constellations'],stories:['故事','Stories'],voices:['语音文本','Voice text'],voiceAudio:['音频索引映射','Audio index mapping'],audio:['音频索引映射','Audio index mapping'],image:['图像','Images'],portrait:['立绘','Portrait'],icon:['头像','Icon'],ascensions:['突破材料','Ascension materials'],narrative:['文本格式','Narrative formatting'],parameters:['天赋倍率','Talent parameters'],images:['图像','Images'],name:['姓名','Name'],title:['称号','Title'],description:['简介','Description'],affiliation:['所属','Affiliation'],region:['地区','Region'],birthday:['生日','Birthday'],cv:['配音演员','Voice actors'],weapon:['武器类型','Weapon type'],element:['元素','Element'],rarity:['星级','Rarity'],constellationName:['命之座名称','Constellation name']};
function coverageField(field:string,zh:boolean){return fieldLabels[field]?.[zh?0:1]||field}
function coverageStatus(status:string,zh:boolean){const names:Record<string,[string,string]>={complete:['已覆盖','Covered'],'upstream-missing':['来源暂缺','Missing upstream'],unresolved:['尚未解析','Unresolved'],'not-applicable':['不适用','Not applicable'],unreachable:['暂时不可达','Unreachable']};return names[status]?.[zh?0:1]||status}
