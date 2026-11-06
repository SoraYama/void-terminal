'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import type {AccountFailure,AccountIdentity,AccountSummary} from './account-contracts';

export class AccountRequestError extends Error {
 constructor(public code:string,message:string){super(message)}
}
async function accountRequest<T>(path:string,init?:RequestInit):Promise<T>{
 const response=await fetch(path,{...init,signal:init?.signal||AbortSignal.timeout(15_000),cache:'no-store',credentials:'same-origin'});
 const data=await response.json();
 if(!response.ok)throw new AccountRequestError(data.error?.code||'REQUEST_FAILED',data.error?.message||'Account request failed');
 return data;
}
export function useAccount(onIdentityChange:(identity:AccountIdentity)=>void){
 const [account,setAccount]=useState<AccountSummary|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState<AccountFailure|null>(null);
 const callback=useRef(onIdentityChange);callback.current=onIdentityChange;
 const identity=useRef<AccountIdentity>(undefined),sequence=useRef(0),abort=useRef<AbortController|null>(null),channel=useRef<BroadcastChannel|null>(null);
 const transition=useCallback((next:AccountIdentity)=>{if(identity.current!==next){identity.current=next;callback.current(next)}},[]);
 const refresh=useCallback(async()=>{
  const id=++sequence.current;abort.current?.abort();const controller=new AbortController();abort.current=controller;let timedOut=false;const timer=setTimeout(()=>{timedOut=true;controller.abort()},15_000);setLoading(true);setError(null);
  try{
   const result=await accountRequest<AccountSummary>('/api/account',{signal:controller.signal});
   if(typeof result.enabled!=='boolean'||typeof result.authenticated!=='boolean'||(result.authenticated&&(!result.enabled||!result.user?.id)))throw new AccountRequestError('ACCOUNT_UNAVAILABLE','Invalid account response');
   if(id!==sequence.current)return;
   transition(result.authenticated?result.user!.id:null);setAccount(result);
  }catch(cause){if(id===sequence.current&&(!controller.signal.aborted||timedOut))setError({code:cause instanceof AccountRequestError?cause.code:'ACCOUNT_UNAVAILABLE',message:cause instanceof Error?cause.message:''})}
  finally{clearTimeout(timer);if(id===sequence.current){setLoading(false);abort.current=null}}
 },[transition]);
 const invalidate=useCallback(()=>{sequence.current++;abort.current?.abort();transition(undefined);setAccount(null);setError(null)},[transition]);
 useEffect(()=>{
  void refresh();
  if(typeof BroadcastChannel!=='undefined'){channel.current=new BroadcastChannel('void-terminal-account');channel.current.onmessage=()=>{invalidate();void refresh()}}
  const focus=()=>{void refresh()};window.addEventListener('focus',focus);
  return()=>{sequence.current++;abort.current?.abort();channel.current?.close();channel.current=null;window.removeEventListener('focus',focus)};
 },[refresh,invalidate]);
 const post=useCallback(async(path:string,body?:unknown)=>{await accountRequest<{ok:true}>(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{})})},[]);
 const sendCode=useCallback((email:string)=>post('/api/auth/send-code',{email}),[post]);
 // Even rejected/uncertain auth mutations can clear cookies server-side. Recheck
 // identity before exposing any previous conversation or model key.
 const verifyCode=useCallback(async(email:string,code:string)=>{try{await post('/api/auth/verify-code',{email,code})}finally{invalidate();channel.current?.postMessage({type:'changed'});await refresh()}},[post,invalidate,refresh]);
 const logout=useCallback(async()=>{try{await post('/api/auth/logout')}finally{invalidate();channel.current?.postMessage({type:'changed'});await refresh()}},[post,invalidate,refresh]);
 return {account,loading,error,refresh,sendCode,verifyCode,logout};
}
export type AccountController=ReturnType<typeof useAccount>;
