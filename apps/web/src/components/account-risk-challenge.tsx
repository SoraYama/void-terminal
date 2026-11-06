'use client';
import {useEffect,useRef,useState} from 'react';
import type {AccountRisk} from '../lib/account-contracts';

type Turnstile = {
 render(host:HTMLElement,options:Record<string,unknown>):string;
 remove(widget:string):void;
};
type Challenge = Extract<AccountRisk,{status:'verification_required'}>;
let scriptLoad:Promise<Turnstile>|undefined;
function loadWidget(){
 const getApi=()=>(window as Window&{turnstile?:Turnstile}).turnstile;
 const existing=getApi();
 if(existing)return Promise.resolve(existing);
 if(scriptLoad)return scriptLoad;
 scriptLoad=new Promise<Turnstile>((resolve,reject)=>{
  const script=document.createElement('script');
  script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
  script.async=true;
  const finish=()=>{
   clearTimeout(timeout);
   const api=getApi();
   if(api)resolve(api);
   else{script.remove();scriptLoad=undefined;reject(new Error('Turnstile unavailable'))}
  };
  const timeout=window.setTimeout(finish,12_000);
  script.onload=finish;
  script.onerror=finish;
  document.head.appendChild(script);
 });
 return scriptLoad;
}

interface Props {risk:Challenge;zh:boolean;onToken:(token:string)=>void;verifying:boolean;retryIn:number}
export function AccountRiskChallenge({risk,zh,onToken,verifying,retryIn}:Props){
 const host=useRef<HTMLDivElement>(null);
 const submit=useRef(onToken);submit.current=onToken;
 const [attempt,setAttempt]=useState(0);
 const [state,setState]=useState<'loading'|'ready'|'unavailable'|'retry'|'submitted'>('loading');
 useEffect(()=>{
  let disposed=false,api:Turnstile|undefined,widget:string|undefined;
  let submitted=false;
  const reset=()=>{if(!disposed&&!submitted)setState('retry')};
  setState('loading');
  void loadWidget().then(loaded=>{
   if(disposed||!host.current)return;
   api=loaded;
   setState('ready');
   widget=api.render(host.current,{
    sitekey:risk.siteKey,action:risk.challengeAction,
    language:zh?'zh-cn':'en',theme:document.documentElement.dataset.theme==='dark'?'dark':'light',
    size:host.current.clientWidth>=300?'flexible':'compact',
    retry:'never','refresh-expired':'never','refresh-timeout':'never','response-field':false,
    callback:(token:string)=>{if(disposed||submitted)return;submitted=true;setState('submitted');submit.current(token)},
    'expired-callback':reset,'timeout-callback':reset,'unsupported-callback':reset,
    'error-callback':()=>{reset();return true},
   });
  }).catch(()=>{if(!disposed)setState('unavailable')});
  return()=>{disposed=true;if(api&&widget!==undefined)api.remove(widget)};
 },[risk.siteKey,risk.challengeAction,zh,attempt]);

 const retry=state==='unavailable'||state==='retry'||(state==='submitted'&&!verifying);
 return <section className="account-challenge" aria-label={zh?'设备验证':'Device verification'}>
  <h3>{zh?'验证此设备':'Verify this device'}</h3>
  <p className="account-policy">{zh?'完成验证后可继续登录或使用点数。本站用设备 Cookie 和有限的浏览器信息限制重复领取。':'Verify to continue signing in or using credits. A device cookie and limited browser information help prevent repeat claims.'}</p>
  <div className="account-challenge-widget" ref={host}/>
  {(state==='loading'||verifying)&&<p role="status" className="account-policy">{verifying?(zh?'正在确认验证结果…':'Checking the verification result…'):(zh?'正在加载验证…':'Loading verification…')}</p>}
  {retry&&<div className="account-actions">
   <p className="account-policy" role="status">{state==='unavailable'?(zh?'无法加载验证。请检查网络后重试。':'Could not load verification. Check your connection and retry.'):(zh?'如需再次验证，请开始新的验证。':'Start a fresh challenge to try again.')}</p>
   <button type="button" disabled={retryIn>0} onClick={()=>setAttempt(attempt+1)}>{zh?'重新验证':'Try a new challenge'}</button>
  </div>}
 </section>;
}
