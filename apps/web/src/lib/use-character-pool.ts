'use client';
import {useEffect,useState} from 'react';
import type {CharacterArchiveCache} from './archive-session';
import type {CharacterListResult,CharacterSummary} from './characters';
import {request} from './client';
import type {Locale} from './contracts';

export function useCharacterPool(snapshotId:string,language:Locale,includeInternal:boolean,cache?:CharacterArchiveCache){
 const key=snapshotId?new URLSearchParams({snapshotId,language,pageSize:'100',includeInternal:String(includeInternal)}).toString():'';
 const [state,setState]=useState<{key:string;characters?:CharacterSummary[];failed?:boolean}>();
 const [attempt,setAttempt]=useState(0);
 useEffect(()=>{
  if(!key||cache?.browse.get(key))return;
  const abort=new AbortController();
  async function readPage(page:number){
   const result=await request<CharacterListResult>('/api/characters?'+key+'&page='+page,{signal:abort.signal});
   if(result.snapshotId!==snapshotId||result.page!==page||result.pageSize<1)throw Error('Invalid character pool response');
   return result;
  }
  async function load(){
   const first=await readPage(1);
   const records=new Map(first.characters.map(c=>[c.id,c]));
   for(let page=2;page<=Math.ceil(first.total/first.pageSize);page++){
    const next=await readPage(page);
    for(const character of next.characters)records.set(character.id,character);
   }
   if(abort.signal.aborted)return;
   const characters=[...records.values()];
   cache?.browse.set(key,characters);setState({key,characters});
  }
  void load().catch(()=>{if(!abort.signal.aborted)setState({key,failed:true})});
  return()=>abort.abort();
 },[key,snapshotId,cache,attempt]);
 const current=state?.key===key?state:undefined;
 return {characters:cache?.browse.get(key)??current?.characters,failed:current?.failed,
  retry:()=>{setState(undefined);setAttempt(n=>n+1)}};
}
