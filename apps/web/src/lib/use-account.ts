'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import type {AccountFailure,AccountIdentity,AccountSummary} from './account-contracts';
import {collectDeviceSignals} from './device-risk';

export class AccountRequestError extends Error {
 constructor(public code:string,message:string,public retryAfter?:number){super(message)}
}
async function accountRequest<T>(path:string,init?:RequestInit):Promise<T>{
 const response=await fetch(path,{...init,signal:init?.signal||AbortSignal.timeout(15_000),cache:'no-store',credentials:'same-origin'});
 const data=await response.json();
 if(!response.ok)throw new AccountRequestError(data.error?.code||'REQUEST_FAILED',data.error?.message||'Account request failed',typeof data.error?.retryAfter==='number'?data.error.retryAfter:undefined);
 return data;
}
export function useAccount(onIdentityChange:(identity:AccountIdentity)=>void,enabled:boolean){
 const [account,setAccount]=useState<AccountSummary|null>(null),[loading,setLoading]=useState(enabled),[error,setError]=useState<AccountFailure|null>(null);
 const callback=useRef(onIdentityChange);callback.current=onIdentityChange;
 const identity=useRef<AccountIdentity>(undefined),sequence=useRef(0),abort=useRef<AbortController|null>(null),channel=useRef<BroadcastChannel|null>(null);
 const transition=useCallback((next:AccountIdentity)=>{if(identity.current!==next){identity.current=next;callback.current(next)}},[]);
 const refresh=useCallback(async()=>{
  if(!enabled){transition(null);return null}
  const id=++sequence.current;abort.current?.abort();const controller=new AbortController();abort.current=controller;let timedOut=false;const timer=setTimeout(()=>{timedOut=true;controller.abort()},15_000);setLoading(true);setError(null);
  try{
   const result=await accountRequest<AccountSummary>('/api/account',{signal:controller.signal});
   if(typeof result.enabled!=='boolean'||typeof result.authenticated!=='boolean'||(result.authenticated&&(!result.enabled||!result.user?.id)))throw new AccountRequestError('ACCOUNT_UNAVAILABLE','Invalid account response');
   if(id!==sequence.current)return;
   transition(result.authenticated?result.user!.id:null);setAccount(result);return result;
  }catch(cause){if(id===sequence.current&&(!controller.signal.aborted||timedOut)){transition(undefined);setAccount(null);setError({code:cause instanceof AccountRequestError?cause.code:'ACCOUNT_UNAVAILABLE',message:cause instanceof Error?cause.message:'',...(cause instanceof AccountRequestError&&cause.retryAfter?{retryAfter:cause.retryAfter}:{})})}}
  finally{clearTimeout(timer);if(id===sequence.current){setLoading(false);abort.current=null}}
  return null;
 },[transition,enabled]);
 const invalidate=useCallback(()=>{sequence.current++;abort.current?.abort();transition(undefined);setAccount(null);setError(null)},[transition]);
 useEffect(()=>{
  // A fresh deployment prop can replace this client tree without remounting.
  // Discard the previous namespace before enabling or disabling accounts.
  invalidate();
  if(!enabled){transition(null);setAccount(null);setLoading(false);setError(null);return}
  void refresh();
  if(typeof BroadcastChannel!=='undefined'){channel.current=new BroadcastChannel('void-terminal-account');channel.current.onmessage=()=>{invalidate();void refresh()}}
  const focus=()=>{void refresh()};window.addEventListener('focus',focus);
  return()=>{sequence.current++;abort.current?.abort();channel.current?.close();channel.current=null;window.removeEventListener('focus',focus)};
 },[refresh,invalidate,enabled,transition]);
 const post=useCallback(async<T,>(path:string,body?:unknown)=>{if(!enabled)throw new AccountRequestError('AUTH_DISABLED','Accounts are unavailable for this deployment');return accountRequest<T>(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{})})},[enabled]);
 const sendCode=useCallback(async(email:string)=>{await post('/api/auth/send-code',{email,signals:collectDeviceSignals(enabled)})},[post,enabled]);
 // Even rejected/uncertain auth mutations can clear cookies server-side. Recheck
 // identity before exposing any previous conversation or model key.
 const verifyCode=useCallback(async(email:string,code:string)=>{let result:AccountSummary|null|undefined;try{await post('/api/auth/verify-code',{email,code,signals:collectDeviceSignals(enabled)})}finally{invalidate();channel.current?.postMessage({type:'changed'});result=await refresh()}return result},[post,invalidate,refresh,enabled]);
 const logout=useCallback(async()=>{try{await post('/api/auth/logout')}finally{invalidate();channel.current?.postMessage({type:'changed'});await refresh()}},[post,invalidate,refresh]);
 const verifyDevice=useCallback(async(token:string)=>{
  await post<AccountSummary>('/api/account/verify-device',{token,signals:collectDeviceSignals(enabled)});
  channel.current?.postMessage({type:'changed'});
  // Re-read current cookies: another tab may have signed out or switched accounts
  // during the challenge. The returned response is a snapshot of its start.
  return refresh();
 },[post,refresh,enabled]);
 return {account,loading,error,refresh,sendCode,verifyCode,verifyDevice,logout};
}
export type AccountController=ReturnType<typeof useAccount>;
