import type {Citation,ChatRequest,Locale} from './contracts';
import type {AnswerCard} from './answer-cards';
import {chatErrorText} from './chat-errors';
export interface Message {role:'user'|'assistant';content:string;sources?:Citation[];snapshotId?:string;error?:string;errorCode?:string;cards?:AnswerCard[]}
export interface Conversation {id:string;parentId?:string;snapshotId?:string;title:string;updatedAt:number;messages:Message[]}
/** Failed/aborted placeholders stay visible locally but are not model messages. */
export function chatMessages(messages:ReadonlyArray<ChatRequest['messages'][number]>):ChatRequest['messages']{
 return messages.filter(m=>m.role!=='assistant'||m.content.trim()).map(({role,content})=>({role,content}));
}
export function conversationMarkdown(conversation:Conversation,locale:Locale):string{
 return conversation.messages.map(m=>{
  const code=m.errorCode&&/^[A-Z][A-Z0-9_]{0,63}$/.test(m.errorCode)?m.errorCode:undefined;
  const failure=m.error||code?`> ${locale==='zh-CN'?'提示':'Status'}: ${chatErrorText({message:m.error||'',code},locale)}${code?` (${code})`:''}\n\n`:'';
  return `## ${m.role}\n\n${m.content}\n\n${failure}${(m.sources||[]).map(s=>`[${s.citation}] ${s.title} — ${s.path} (${s.snapshotId})`).join('\n')}`;
 }).join('\n\n');
}
export function branchConversation(c:Conversation,index:number,content:string):Conversation{return {id:crypto.randomUUID(),parentId:c.id,snapshotId:conversationSnapshot(c),title:content.slice(0,45),updatedAt:Date.now(),messages:[...c.messages.slice(0,index),{role:'user',content}]}}
// The original database remains the guest/BYOK namespace; no legacy records move.
export function historyDatabaseName(accountId?:string|null):string{return accountId?`void-terminal:account:${encodeURIComponent(accountId)}`:'void-terminal'}
function database(accountId?:string|null):Promise<IDBDatabase>{return new Promise((resolve,reject)=>{const r=indexedDB.open(historyDatabaseName(accountId),1);r.onupgradeneeded=()=>r.result.createObjectStore('conversations',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
export async function historyOperation(action:'list'|'save'|'delete'|'clear',value?:Conversation|string,accountId?:string|null):Promise<Conversation[]>{const db=await database(accountId);return new Promise((resolve,reject)=>{const tx=db.transaction('conversations',action==='list'?'readonly':'readwrite'),s=tx.objectStore('conversations');let result:Conversation[]=[];if(action==='list'){const r=s.getAll();r.onsuccess=()=>{result=r.result.sort((a,b)=>b.updatedAt-a.updatedAt)}}else if(action==='save')s.put(value);else if(action==='delete')s.delete(value as string);else s.clear();tx.oncomplete=()=>{db.close();resolve(result)};tx.onerror=tx.onabort=()=>{db.close();reject(tx.error)}})}

export function conversationSnapshot(c:Conversation|null|undefined,readingSnapshot?:string):string|undefined{return c?.snapshotId||c?.messages.find(m=>m.snapshotId||m.sources?.[0]?.snapshotId)?.snapshotId||c?.messages.find(m=>m.sources?.[0]?.snapshotId)?.sources?.[0]?.snapshotId||readingSnapshot}
