import type {CharacterListResult,CharacterResult,CharacterSummary} from './characters';
import type {ItemListResult,ItemResult} from './items';
import type {LibraryResult,DocumentResult} from './contracts';

// An entry may be found by its original request or its resolved snapshot. Aliases
// share one slot, so eight results never become sixteen retained payloads.
export class PublicResponseCache<T>{
 private entries:{keys:Set<string>;value:T}[]=[];
 constructor(private readonly limit=8,private readonly normalize:(key:string)=>string=key=>key){}
 get(key:string):T|undefined{
  key=this.normalize(key);
  const index=this.entries.findIndex(entry=>entry.keys.has(key));
  if(index<0)return undefined;
  const [entry]=this.entries.splice(index,1);this.entries.push(entry);return entry.value;
 }
 set(key:string,value:T,aliases:string[]=[]){
  const keys=new Set([key,...aliases].map(this.normalize));
  this.entries=this.entries.filter(entry=>![...keys].some(k=>entry.keys.has(k)));
  this.entries.push({keys,value});
  if(this.entries.length>this.limit)this.entries.shift();
 }
}
export function resolvedListKey(key:string,snapshotId:string|null){const params=new URLSearchParams(key);if(snapshotId)params.set('snapshotId',snapshotId);return params.toString()}
export function archiveDetailKey(language:string,snapshotId:string,id:string){return JSON.stringify([language,snapshotId,id])}
function listIdentity(key:string){const params=new URLSearchParams(key);params.sort();return params.toString()}
export function createArchiveCache<List,Detail>(){return {visited:false,lists:new PublicResponseCache<List>(8,listIdentity),details:new PublicResponseCache<Detail>(),scroll:new PublicResponseCache<number>(32)}}
export type ArchiveCache<List,Detail>=ReturnType<typeof createArchiveCache<List,Detail>>;
export type CharacterArchiveCache=ArchiveCache<CharacterListResult,CharacterResult>&{browse:PublicResponseCache<CharacterSummary[]>};
export function createArchiveSession(){return {
 characters:{...createArchiveCache<CharacterListResult,CharacterResult>(),browse:new PublicResponseCache<CharacterSummary[]>(4)},
 museum:createArchiveCache<ItemListResult,ItemResult>(),
 library:createArchiveCache<LibraryResult,DocumentResult>(),
}}
