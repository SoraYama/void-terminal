'use client';
import {useState,useRef,useEffect,useCallback} from 'react';
import {Play,Pause,ArrowClockwise,SpeakerHigh} from '@phosphor-icons/react';
import type {Locale} from '../../lib/contracts';
import {audioLocales,voiceUrl,type AudioLocale,type Character,type CharacterVoice} from '../../lib/characters';
import {ThemedSelect} from '../themed-select';
import {NarrativeText} from './character-narrative';
export const voiceLocaleNames:Record<AudioLocale,[string,string]>={'zh-CN':['汉语','Chinese'],en:['英语','English'],ja:['日语','Japanese'],ko:['韩语','Korean']};
export function CharacterVoices({character,snapshot,locale,language}:{character:Character;snapshot:string;locale:Locale;language:Locale}){
 const zh=locale==='zh-CN',available=audioLocales.filter(l=>character.voices.some(v=>!!voiceUrl(v.audio[l],character.id,v.id,l,snapshot,language)));
 const [audioLocale,setAudioLocale]=useState<AudioLocale>(available.includes('zh-CN')?'zh-CN':available[0]||'zh-CN'),[selected,setSelected]=useState(character.voices[0]?.id||''),[search,setSearch]=useState(''),[status,setStatus]=useState<'idle'|'loading'|'playing'|'paused'|'error'>('idle');
 const audio=useRef<HTMLAudioElement|null>(null),pending=useRef<AbortController|null>(null),blob=useRef(''),run=useRef(0),mounted=useRef(true);
 const stop=useCallback(()=>{run.current++;pending.current?.abort();pending.current=null;if(audio.current){audio.current.pause();audio.current.removeAttribute('src');audio.current.load();audio.current=null}if(blob.current){URL.revokeObjectURL(blob.current);blob.current=''}},[]);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;stop()}},[stop]);
 useEffect(()=>{stop();setStatus('idle');return stop},[selected,audioLocale,character.id,snapshot,language,locale,stop]);
 const voice=character.voices.find(v=>v.id===selected),url=voice&&voiceUrl(voice.audio[audioLocale],character.id,voice.id,audioLocale,snapshot,language);
 async function play(){
  if(!url)return;
  if(audio.current&&status==='playing'){audio.current.pause();setStatus('paused');return}
  if(audio.current&&status==='paused'){const id=run.current;try{await audio.current.play();if(mounted.current&&id===run.current)setStatus('playing')}catch{if(mounted.current&&id===run.current)setStatus('error')}return}
  stop();const id=run.current,abort=new AbortController();pending.current=abort;setStatus('loading');
  try{const response=await fetch(url,{signal:AbortSignal.any([abort.signal,AbortSignal.timeout(115000)])});if(!response.ok)throw new Error('audio');const data=await response.blob();if(data.size>16*1024*1024)throw new Error('audio');if(abort.signal.aborted||id!==run.current||!mounted.current)return;const objectUrl=URL.createObjectURL(data);blob.current=objectUrl;const player=new Audio(objectUrl);audio.current=player;player.onended=()=>{if(id===run.current&&mounted.current){stop();setStatus('idle')}};player.onerror=()=>{if(id===run.current&&mounted.current){stop();setStatus('error')}};await player.play();if(id===run.current&&mounted.current)setStatus('playing');else{player.pause();player.removeAttribute('src')}}catch{if(!abort.signal.aborted&&id===run.current&&mounted.current){stop();setStatus('error')}}finally{if(id===run.current)pending.current=null}
 }
 const voices=character.voices.filter(v=>v.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
 return <div className="character-voice-section">
  <div className="character-voice-toolbar"><label>{zh?'配音语言':'Voice language'}<ThemedSelect archive label={zh?'配音语言':'Voice language'} value={audioLocale} onValueChange={value=>setAudioLocale(value as AudioLocale)} options={(available.length?available:[audioLocale]).map(value=>({value,label:voiceLocaleNames[value][zh?0:1]}))}/></label><label>{zh?'搜索语音标题':'Search voice titles'}<input type="search" value={search} onChange={e=>setSearch(e.target.value)}/></label></div>
  <div className="character-narrative-layout"><nav className="character-record-list" aria-label={zh?'语音条目':'Voice entries'}>{voices.map(v=><button key={v.id} aria-pressed={v.id===selected} onClick={()=>setSelected(v.id)}>{v.title||v.id}</button>)}{!voices.length&&<p>{zh?'没有匹配的语音':'No matching voice lines'}</p>}</nav>
   <article className="character-reading">{voice?<><h3>{voice.title|| (zh?'语音':'Voice line')}</h3><NarrativeText row={voice} zh={zh}/><div className="character-audio-player"><SpeakerHigh size={23}/><div><strong>{voiceLocaleNames[audioLocale][zh?0:1]}</strong><span>{character.cv[audioLocale]|| (zh?'配音信息暂缺':'Voice actor not recorded')}</span></div>{url?<button disabled={status==='loading'} onClick={()=>void play()} aria-label={status==='playing'?(zh?'暂停语音':'Pause voice'):status==='error'?(zh?'重试播放':'Retry playback'):(zh?'播放语音':'Play voice')}>{status==='playing'?<Pause size={20} weight="fill"/>:status==='error'?<ArrowClockwise size={20}/>:<Play size={20} weight="fill"/>}{status==='loading'?(zh?'正在载入…':'Loading…'):status==='playing'?(zh?'暂停':'Pause'):status==='paused'?(zh?'继续播放':'Resume'):status==='error'?(zh?'重试':'Retry'):(zh?'播放原声':'Play voice')}</button>:<span>{zh?'此条语音暂无该语言的音频':'Audio unavailable for this line and language'}</span>}</div><p className="character-note" role="status">{status==='loading'?(zh?'首次载入可能需要一些时间。切换条目将取消载入。':'The first load may take a moment. Changing entries cancels it.'):status==='error'?(zh?'原声音频载入失败，请重试。':'The original audio could not be played. Please retry.'):!available.length?(zh?'此角色暂无已验证的原声音频。':'No verified original audio is available for this character.'):(zh?'按需载入原声；界面语言与配音语言分别设置。':'Original audio loads on demand. Voice language is independent of display language.')}</p></>:<p>{zh?'暂无语音记录':'No voice records available'}</p>}</article>
  </div>
 </div>;
}
