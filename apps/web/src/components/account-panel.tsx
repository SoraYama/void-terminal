'use client';
import {useEffect,useState} from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {ArrowClockwise,SignOut,X} from '@phosphor-icons/react';
import {AccountRequestError,type AccountController} from '../lib/use-account';
import {accountErrorText,type AccountFailure} from '../lib/account-contracts';
import {Ornament} from './ui';

interface Props {open:boolean;onOpenChange:(open:boolean)=>void;session:AccountController;zh:boolean;sharedEnabled:boolean}
export function AccountPanel({open,onOpenChange,session,zh,sharedEnabled}:Props){
 const {account,loading,error,refresh,sendCode,verifyCode,logout}=session;
 const [email,setEmail]=useState(''),[code,setCode]=useState(''),[sent,setSent]=useState(false),[action,setAction]=useState<'send'|'verify'|'logout'|null>(null),[failure,setFailure]=useState<AccountFailure|null>(null),[notice,setNotice]=useState(false);
 useEffect(()=>{if(account?.authenticated){setEmail('');setCode('');setSent(false);setFailure(null);setNotice(false)}},[account?.authenticated]);
 async function perform(kind:'send'|'verify'|'logout'){
  if(action)return;setAction(kind);setFailure(null);setNotice(false);
  try{if(kind==='send'){await sendCode(email.trim());setSent(true);setCode('');setNotice(true)}else if(kind==='verify'){const result=await verifyCode(email.trim(),code.trim());if(result?.authenticated)onOpenChange(false)}else{await logout();setCode('');setSent(false)}}
  catch(cause){setFailure({code:cause instanceof AccountRequestError?cause.code:'REQUEST_FAILED',message:cause instanceof Error?cause.message:''})}
  finally{setAction(null)}
 }
 const busy=!!action||loading;
 const statusText=(status:string)=>status==='completed'?(zh?'已完成':'Completed'):status==='reserved'?(zh?'处理中':'In progress'):status==='expired'?(zh?'已返还（超时）':'Released after timeout'):(zh?'已返还':'Released');
 const dateText=(value:string)=>{const date=new Date(value);return Number.isNaN(date.getTime())?'—':date.toLocaleString(zh?'zh-CN':'en',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})};
 return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal><Dialog.Overlay className="overlay"/><Dialog.Content className="settings-dialog account-dialog" aria-busy={busy} onCloseAutoFocus={event=>{event.preventDefault();requestAnimationFrame(()=>{const target=Array.from(document.querySelectorAll<HTMLElement>('.account-nav,.mobile-header>button,#question')).find(element=>element.getClientRects().length);target?.focus()})}}>
  <Dialog.Title>{zh?'账户与额度':'Account & credits'}</Dialog.Title>
  <Dialog.Description className="account-description">{account?.authenticated?(zh?'考据使用本账户的试用额度。对话历史保存在此设备；提问内容会经本站发送给模型服务。':'Research uses your trial credits. History is stored on this device; questions are sent through this site to the model provider.'):(zh?`受邀邮箱可登录${account?.trialCredits?`并领取一次性 ${account.trialCredits} 额度`:''}，开始原文考据。`:`Invited emails can sign in${account?.trialCredits?` for ${account.trialCredits} one-time trial credits`:''} and start source-based research.`)}</Dialog.Description>
  <Dialog.Close className="dialog-close" aria-label={zh?'关闭':'Close'}><X size={24}/></Dialog.Close><Ornament/>
  {(failure||error)&&<div className="account-error" role="alert"><p>{accountErrorText((failure||error)!,zh)}</p>{error&&<button onClick={()=>void refresh()} disabled={busy}><ArrowClockwise size={17}/>{zh?'重试':'Retry'}</button>}</div>}
  {loading&&!account?<p role="status" className="account-loading">{zh?'正在读取账户…':'Loading your account…'}</p>:account?.enabled===false?<p>{zh?'账户服务暂未开放，请稍后重试。':'Accounts are not available yet. Please retry later.'}</p>:account?.authenticated?<>
   <div className="account-identity"><span>{account.user?.email}</span><button onClick={()=>void perform('logout')} disabled={busy}><SignOut size={17}/>{action==='logout'?(zh?'正在登出…':'Signing out…'):(zh?'登出':'Sign out')}</button></div>
   {account.credits&&<dl className="account-balance"><div><dt>{zh?'可用额度':'Available credits'}</dt><dd>{account.credits.available}</dd></div><div><dt>{zh?'处理中占用':'Held for research'}</dt><dd>{account.credits.held}</dd></div><div><dt>{zh?'已获试用额度':'Trial credits granted'}</dt><dd>{account.credits.totalGranted}</dd></div></dl>}
   {account.costs&&<p className="account-policy">{zh?`普通考据 ${account.costs.standard} 额度 / 次，深入考据 ${account.costs.deep} 额度 / 次。未完成的请求会返还占用额度。`:`Standard research costs ${account.costs.standard} credit; deep research costs ${account.costs.deep}. Uncompleted requests release their held credits.`}</p>}
   <div className="account-actions"><button className="primary" disabled={busy} onClick={()=>onOpenChange(false)}>{zh?'返回提问':'Back to question'}</button><button disabled={busy} onClick={()=>void refresh()}><ArrowClockwise size={17}/>{loading?(zh?'正在刷新…':'Refreshing…'):(zh?'刷新额度':'Refresh credits')}</button></div>
   {!sharedEnabled&&<p className="account-policy">{zh?'考据服务暂未就绪，账户额度会保留。':'Research is temporarily unavailable. Your credits remain in your account.'}</p>}
   <section className="account-usage" aria-label={zh?'最近用量':'Recent usage'}><h3>{zh?'最近用量':'Recent usage'}</h3>{!account.usage?.length?<p className="account-policy">{zh?'尚无使用记录。完成一次考据后，会在这里显示。':'No research yet. Your recent usage will appear here.'}</p>:<ul>{account.usage.map(item=><li key={item.requestId}><div><strong>{item.depth==='deep'?(zh?'深入考据':'Deep research'):(zh?'普通考据':'Standard research')}</strong><span>{statusText(item.status)} · {item.status==='completed'?`−${item.units} ${zh?'额度':'credits'}`:item.status==='reserved'?`${zh?'暂占':'Holding'} ${item.units} ${zh?'额度':'credits'}`:(zh?'未扣额度':'No credits used')}</span><span className="account-usage-meta">{item.model}{typeof item.usedTokens==='number'?` · ${item.usedTokens.toLocaleString(zh?'zh-CN':'en')} tokens`:item.status==='completed'?` · ${zh?'用量未知':'Token usage unknown'}`:''}</span></div><time dateTime={item.createdAt}>{dateText(item.createdAt)}</time></li>)}</ul>}</section>
  </>:account?.enabled?<form className="account-form" onSubmit={event=>{event.preventDefault();void perform(sent?'verify':'send')}}>
   <label htmlFor="account-email">{zh?'邮箱':'Email'}<input id="account-email" type="email" autoComplete="email" inputMode="email" maxLength={254} required readOnly={sent} value={email} disabled={busy} onChange={event=>setEmail(event.target.value)}/></label>
   {sent&&<><label htmlFor="account-code">{zh?'验证码':'Verification code'}<input id="account-code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required autoFocus value={code} disabled={busy} onChange={event=>setCode(event.target.value.replace(/\D/g,''))} aria-describedby="account-code-help"/></label><p id="account-code-help" className="account-policy">{zh?'请填写邮件中的 6 位验证码。未收到时请检查垃圾邮件，确认使用的是受邀邮箱。':'Enter the six-digit email code. If it is missing, check spam and confirm you used an invited email.'}</p></>}
   {notice&&<p role="status" className="account-notice">{zh?'若此邮箱可登录，验证码已发送。':'If this email can sign in, a verification code has been sent.'}</p>}
   <div className="account-actions"><button className="primary" type="submit" disabled={busy||!email.trim()||(sent&&code.length!==6)}>{action==='send'?(zh?'正在发送…':'Sending…'):action==='verify'?(zh?'正在验证…':'Verifying…'):sent?(zh?'验证并登录':'Verify & sign in'):(zh?'发送验证码':'Send code')}</button>{sent&&<><button type="button" disabled={busy} onClick={()=>void perform('send')}>{zh?'重新发送':'Resend code'}</button><button type="button" disabled={busy} onClick={()=>{setSent(false);setCode('');setFailure(null);setNotice(false)}}>{zh?'更换邮箱':'Change email'}</button></>}</div>
  </form>:error&&!loading?<button disabled={!!action} onClick={()=>void perform('logout')}><SignOut size={17}/>{zh?'登出':'Sign out'}</button>:null}
 </Dialog.Content></Dialog.Portal></Dialog.Root>;
}
