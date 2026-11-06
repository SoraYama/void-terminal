'use client';
import {useEffect,useRef,useState} from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {ArrowClockwise,CaretRight,Envelope,SignOut,X} from '@phosphor-icons/react';
import {AccountRequestError,type AccountController} from '../lib/use-account';
import {accountErrorText,type AccountFailure,type AccountGrant,type AccountSummary,type AccountUsage} from '../lib/account-contracts';
import {creditResetLabel} from '../lib/credit-reset';
import {AccountRiskChallenge} from './account-risk-challenge';
import {CopyField} from './support-panel';
import {Ornament} from './ui';

interface Props {
 open:boolean;
 onOpenChange:(open:boolean)=>void;
 onCloseFocus:()=>void;
 session:AccountController;
 zh:boolean;
 sharedEnabled:boolean;
 contactEmail?:string;
 showRequest:boolean;
 onShowRequest:()=>void;
 onSupport?:()=>void;
}
const pending=(account:AccountSummary)=>account.risk?.status!=='verified';

function Balances({account,zh}:{account:AccountSummary;zh:boolean}){
 const credits=account.credits;
 if(!credits)return <p className="account-policy">{zh?'暂时无法读取点数，请刷新重试。':'Your balance is temporarily unavailable. Refresh to retry.'}</p>;
 const {daily,reserve}=credits;
 if(!daily||!reserve)return <dl className="account-balance"><div><dt>{zh?'可用点数':'Available credits'}</dt><dd>{credits.available}</dd></div>
  {credits.held>0&&<div><dt>{zh?'处理中占用':'Held for research'}</dt><dd>{credits.held}</dd></div>}</dl>;
 const isPending=pending(account),reset=creditResetLabel(daily.resetsAt,zh);
 const welcome=account.grants?.find(item=>item.source==='trial');
 return <dl className="account-balance account-buckets">
  <div><dt>{zh?'今日点数':'Daily credits'}</dt><dd className={isPending?'account-pending':undefined}>{isPending?(zh?'待验证':'Verification pending'):`${daily.available} / ${daily.limit}`}</dd>
   <dd className="account-bucket-note">
    {reset&&<>{zh?'下次重置：':'Next reset: '}<time dateTime={daily.resetsAt}>{reset}</time>{zh?'。':'. '}</>}
    {zh?'每日点数未用完不累计。':'Unused daily credits do not carry over.'}
   </dd>
  </div>
  <div><dt>{zh?'储备点数':'Reserve credits'}</dt><dd>{reserve.available}</dd>
   <dd className="account-bucket-note">
    {welcome&&<>{zh?`新人赠点 ${welcome.units}。`:`${welcome.units} welcome credits granted. `}</>}
    {!isPending&&daily.available===0&&reserve.available>0?(zh?'接下来的考据使用储备点数。':'Your next research uses reserve credits.'):(zh?'每日点数优先，储备点数保留。':'Daily credits are used first. Reserve credits do not expire.')}
   </dd>
  </div>
 </dl>;
}

function RefundBreakdown({allocation,zh}:{allocation:AccountUsage['allocation'];zh:boolean}){
 if(!allocation)return null;
 const {dailyUnits,reserveUnits,dailyPeriod,dailyPeriodEnded}=allocation;
 const credits=(units:number)=>units===1?'1 credit':`${units} credits`;
 return <>
  {reserveUnits>0&&<span>{zh?`已返还 ${reserveUnits} 点储备点数`:`${reserveUnits} reserve ${reserveUnits===1?'credit':'credits'} returned`}</span>}
  {dailyUnits>0&&dailyPeriod&&<span>{dailyPeriodEnded
   ?(zh?`${dailyPeriod} 的每日点数 ${dailyUnits} 点，周期已结束，不计入今日额度`:`${dailyPeriod} daily allocation: ${credits(dailyUnits)}. That period has ended; these credits do not carry over.`)
   :(zh?`已返还至 ${dailyPeriod} 的每日额度：${dailyUnits} 点`:`${credits(dailyUnits)} returned to the daily allowance for ${dailyPeriod}`)}</span>}
 </>;
}

function CreditRecords({account,zh}:{account:AccountSummary;zh:boolean}){
 const usageText=(item:AccountUsage)=>{
  if(item.status==='completed')return zh?`已完成 · −${item.units} 点`:`Completed · −${item.units} credits`;
  if(item.status==='reserved')return zh?`处理中 · 暂占 ${item.units} 点`:`In progress · Holding ${item.units} credits`;
  if(item.status==='expired')return zh?'未扣点数（超时）':'No credits charged (timeout)';
  return zh?'未扣点数':'No credits charged';
 };
 const dateText=(value:string)=>{const date=new Date(value);return Number.isNaN(date.getTime())?'—':date.toLocaleString(zh?'zh-CN':'en',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})};
 const grantText=(source:AccountGrant['source'])=>({legacy:zh?'历史入账':'Legacy credits',trial:zh?'新人赠点':'Welcome credits',manual:zh?'人工入账':'Manual credits',payment:zh?'支付入账':'Payment credits'}[source]);
 const {credits}=account;
 return <details className="account-records">
  <summary>{zh?'最近使用与获赠记录':'Recent usage and grants'}</summary>
  {credits&&<dl className="account-balance account-record-totals">
   <div><dt>{zh?'累计储备入账':'Total credited to reserve'}</dt><dd>{credits.totalGranted}</dd></div>
   {credits.held>0&&<div><dt>{zh?'处理中占用':'Held for research'}</dt><dd>{credits.held}</dd></div>}
   {!!credits.daily?.held&&<div><dt>{zh?'每日点数暂占':'Held from daily credits'}</dt><dd>{credits.daily.held}</dd></div>}
   {!!credits.reserve?.held&&<div><dt>{zh?'储备点数暂占':'Held from reserve'}</dt><dd>{credits.reserve.held}</dd></div>}
  </dl>}
  <section className="account-usage account-grants" aria-label={zh?'最近入账':'Recent credits'}>
   <h3>{zh?'最近入账':'Recent credits'}</h3>
   {!account.grants?.length?<p className="account-policy">{zh?'暂无入账明细。':'No credit details available.'}</p>:<ul>{account.grants.slice(0,20).map(item=><li key={item.id}><div><strong>{grantText(item.source)}</strong><span className="account-grant-units">+{item.units.toLocaleString(zh?'zh-CN':'en')} {zh?'点':'credits'}</span></div><time dateTime={item.createdAt}>{dateText(item.createdAt)}</time></li>)}</ul>}
  </section>
  <section className="account-usage" aria-label={zh?'最近用量':'Recent usage'}>
   <h3>{zh?'最近用量':'Recent usage'}</h3>
   {!account.usage?.length?<p className="account-policy">{zh?'尚无使用记录。完成一次考据后，会在这里显示。':'No research yet. Your recent usage will appear here.'}</p>:<ul>{account.usage.map(item=><li key={item.requestId}>
    <div>
     <strong>{item.depth==='deep'?(zh?'深入考据':'Deep research'):(zh?'普通考据':'Standard research')}</strong>
     <span>{usageText(item)}</span>
     {(item.status==='released'||item.status==='expired')&&<RefundBreakdown allocation={item.allocation} zh={zh}/>}
     <span className="account-usage-meta">{item.model}{typeof item.usedTokens==='number'?` · ${item.usedTokens.toLocaleString(zh?'zh-CN':'en')} tokens`:item.status==='completed'?` · ${zh?'用量未知':'Token usage unknown'}`:''}</span>
    </div>
    <time dateTime={item.createdAt}>{dateText(item.createdAt)}</time>
   </li>)}</ul>}
  </section>
 </details>;
}

function AccountEmailForm({email,accountId,zh}:{email:string;accountId?:string;zh:boolean}){
 const section=useRef<HTMLElement>(null);
 useEffect(()=>section.current?.scrollIntoView({block:'nearest'}),[]);
 const verification=accountId===undefined;
 const subject=verification?(zh?'虚空终端设备验证求助':'Void Terminal device verification help'):(zh?'虚空终端点数申请':'Void Terminal credit request');
 const body=verification
  ?(zh?'遇到的问题：\n':'Problem encountered:\n')
  :(zh?`账户识别码：${accountId}\n申请用途：\n期望点数：\n`:`Account ID: ${accountId}\nResearch purpose:\nRequested credits:\n`);
 return <section className="credit-request" ref={section} aria-label={subject}>
  <h3>{verification?(zh?'邮件求助':'Get help by email'):(zh?'邮件申请额外点数':'Request extra credits by email')}</h3>
  <p className="account-policy">{verification
   ?(zh?'如果设备验证一直无法完成，可发邮件说明遇到的问题，无需账户识别码。请核对模板后自行发送。':'If device verification keeps failing, email us about the problem. No account ID is needed. Review the template and send the email yourself.')
   :(zh?'请说明考据用途。若与共享设备有关，也可在邮件中说明。请核对模板后自行发送。':'Describe your research purpose and mention any shared-device issue. Review the template and send the email yourself.')}</p>
  <a className="support-link" href={`mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`}><Envelope size={16}/>{zh?'打开邮件应用':'Open email app'}</a>
  <CopyField label={zh?'联系邮箱':'Contact email'} copyLabel={zh?'复制邮箱':'Copy email'} value={email} zh={zh}/>
  <CopyField label={verification?(zh?'求助模板':'Help template'):(zh?'申请模板':'Request template')} copyLabel={zh?'复制模板':'Copy template'} value={body} zh={zh} rows={verification?2:4}/>
 </section>;
}

function VerificationHelp({email,zh}:{email:string;zh:boolean}){
 const [open,setOpen]=useState(false);
 return open?<AccountEmailForm email={email} zh={zh}/>:<button type="button" className="account-secondary" onClick={()=>setOpen(true)}>
  <Envelope size={16}/>{zh?'设备验证遇到问题？邮件求助':'Trouble verifying your device? Get help by email'}<CaretRight size={15} className="push"/>
 </button>;
}

export function AccountPanel({open,onOpenChange,onCloseFocus,session,zh,sharedEnabled,contactEmail,showRequest,onShowRequest,onSupport}:Props){
 const {account,loading,error,refresh,sendCode,verifyCode,verifyDevice,logout}=session;
 const [email,setEmail]=useState(''),[code,setCode]=useState(''),[sent,setSent]=useState(false);
 const [action,setAction]=useState<'send'|'verify'|'logout'|'device'|null>(null);
 const [failure,setFailure]=useState<AccountFailure|null>(null),[notice,setNotice]=useState(false);
 const [resendUntil,setResendUntil]=useState(0),[retryUntil,setRetryUntil]=useState(0),[now,setNow]=useState(0);
 const resendIn=Math.max(0,Math.ceil((resendUntil-now)/1000)),retryIn=Math.max(0,Math.ceil((retryUntil-now)/1000));
 const busy=!!action||loading,risk=account?.risk,blocked=risk?.status!=='verified';
 useEffect(()=>{
  if(account?.authenticated){setEmail('');setCode('');setSent(false);setFailure(null);setNotice(false);setResendUntil(0);setRetryUntil(0)}
 },[account?.user?.id,account?.authenticated]);
 useEffect(()=>{
  if(!open||!(resendIn||retryIn))return;
  const id=window.setInterval(()=>setNow(Date.now()),1000);
  return()=>window.clearInterval(id);
 },[open,resendIn>0,retryIn>0]);
 async function perform(kind:'send'|'verify'|'logout'|'device',token?:string){
  if(action||(kind!=='logout'&&retryIn>0)||((kind==='send'||kind==='verify')&&blocked)||(kind==='send'&&resendIn>0))return;
  setAction(kind);setFailure(null);setNotice(false);
  try{
   if(kind==='send'){
    await sendCode(email.trim());setSent(true);setCode('');setNotice(true);
    const time=Date.now();setNow(time);setResendUntil(time+60_000);
   }else if(kind==='verify'){
    const result=await verifyCode(email.trim(),code.trim());if(result?.authenticated)onOpenChange(false);
   }else if(kind==='device'&&token){
    await verifyDevice(token);
   }else if(kind==='logout'){
    await logout();setCode('');setSent(false);setRetryUntil(0);
   }
  }catch(cause){
   const next=cause instanceof AccountRequestError?cause:new AccountRequestError('REQUEST_FAILED','');
   setFailure({code:next.code,message:next.message});
   if(next.retryAfter&&Number.isFinite(next.retryAfter)){const time=Date.now();setNow(time);setRetryUntil(time+next.retryAfter*1000)}
   if(kind!=='device'&&['DEVICE_VERIFICATION_REQUIRED','ACCOUNT_RISK_UNAVAILABLE'].includes(next.code))void refresh();
  }finally{setAction(null)}
 }
 const challenge=risk?.status==='verification_required'?<AccountRiskChallenge risk={risk} zh={zh} onToken={token=>void perform('device',token)} verifying={action==='device'} retryIn={retryIn}/>:null;
 const unavailable=account?.enabled&&(!risk||risk.status==='unavailable')?<div className="account-error" role="status">
  <p>{accountErrorText({code:'ACCOUNT_RISK_UNAVAILABLE',message:''},zh)}</p>
  <button type="button" onClick={()=>void refresh()} disabled={busy}><ArrowClockwise size={17}/>{zh?'重试':'Retry'}</button>
 </div>:null;
 return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal>
  <Dialog.Overlay className="overlay"/>
  <Dialog.Content className="settings-dialog account-dialog" aria-busy={busy} onCloseAutoFocus={event=>{event.preventDefault();onCloseFocus()}}>
   <Dialog.Title>{zh?'账户与点数':'Account & credits'}</Dialog.Title>
   <Dialog.Description className="account-description">{account?.authenticated?(zh?'对话历史保存在此设备。提问内容会经本站发送给模型服务。':'History is stored on this device. Questions are sent through this site to the model provider.'):(zh?'使用邮箱验证码登录。符合条件的账户每日可获 3 点，新用户另有一次性赠点（默认 20 点）。':'Sign in with an email code. Eligible accounts get 3 daily credits and a one-time welcome gift (20 credits by default).')}</Dialog.Description>
   <Dialog.Close className="dialog-close" aria-label={zh?'关闭':'Close'}><X size={24}/></Dialog.Close><Ornament/>
   {(failure||error)&&<div className="account-error" role="alert">
    <p>{accountErrorText((failure||error)!,zh)}{retryIn>0&&(zh?`请在 ${retryIn} 秒后重试。`:` Try again in ${retryIn}s.`)}</p>
    {error&&<button onClick={()=>void refresh()} disabled={busy}><ArrowClockwise size={17}/>{zh?'重试':'Retry'}</button>}
   </div>}
   {loading&&!account?<p role="status" className="account-loading">{zh?'正在读取账户…':'Loading your account…'}</p>:account?.enabled===false?<p>{zh?'账户服务暂未开放，请稍后重试。':'Accounts are not available yet. Please retry later.'}</p>:account?.authenticated?<>
    <div className="account-identity"><span>{account.user?.email}</span><button onClick={()=>void perform('logout')} disabled={busy}><SignOut size={17}/>{action==='logout'?(zh?'正在登出…':'Signing out…'):(zh?'登出':'Sign out')}</button></div>
    <Balances account={account} zh={zh}/>
    {challenge}{unavailable}
    {account.eligibility?.status==='device_limit'&&<p className="account-policy" role="status">{zh?'此设备已有账户领取免费点数。已入账的点数仍可使用。':'Another account on this device has claimed free credits. You can still use credits already in your account.'}</p>}
    {account.costs&&<p className="account-policy">{zh?`普通考据 ${account.costs.standard} 点 / 次 · 深入考据 ${account.costs.deep} 点 / 次`:`Standard research: ${account.costs.standard} credit · Deep research: ${account.costs.deep} credits`}</p>}
    {!sharedEnabled&&<p className="account-policy">{zh?'考据服务暂未就绪，账户点数会保留。':'Research is temporarily unavailable. Your credits remain in your account.'}</p>}
    <div className="account-actions">
     <button className="primary" disabled={busy} onClick={()=>onOpenChange(false)}>{zh?'返回提问':'Back to question'}</button>
     <button disabled={busy} onClick={()=>void refresh()}><ArrowClockwise size={17}/>{loading?(zh?'正在刷新…':'Refreshing…'):(zh?'刷新点数':'Refresh credits')}</button>
    </div>
    {contactEmail&&account.user&&(showRequest?<AccountEmailForm email={contactEmail} accountId={account.user.id} zh={zh}/>:<button className="account-secondary" onClick={onShowRequest}><Envelope size={16}/>{zh?'邮件申请额外点数':'Request extra credits by email'}<CaretRight size={15} className="push"/></button>)}
    <CreditRecords account={account} zh={zh}/>
   </>:account?.enabled?<><form className="account-form" onSubmit={event=>{event.preventDefault();void perform(sent?'verify':'send')}}>
    <label htmlFor="account-email">{zh?'邮箱':'Email'}<input id="account-email" type="email" autoComplete="email" inputMode="email" maxLength={254} required readOnly={sent} value={email} disabled={busy} onChange={event=>setEmail(event.target.value)}/></label>
    {challenge}{unavailable}
    {sent&&<><label htmlFor="account-code">{zh?'验证码':'Verification code'}<input id="account-code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required autoFocus value={code} disabled={busy} onChange={event=>setCode(event.target.value.replace(/\D/g,''))} aria-describedby="account-code-help"/></label><p id="account-code-help" className="account-policy">{zh?'请填写邮件中的 6 位验证码。未收到时请检查垃圾邮件。':'Enter the six-digit email code. Check your spam folder if it is missing.'}</p></>}
    {notice&&<p role="status" className="account-notice">{zh?'若此邮箱可登录，验证码已发送。':'If this email can sign in, a verification code has been sent.'}</p>}
    <div className="account-actions">
     <button className="primary" type="submit" disabled={busy||blocked||retryIn>0||(!sent&&resendIn>0)||!email.trim()||(sent&&code.length!==6)}>{action==='send'?(zh?'正在发送…':'Sending…'):action==='verify'?(zh?'正在验证…':'Verifying…'):sent?(zh?'验证并登录':'Verify & sign in'):(zh?'发送验证码':'Send code')}</button>
     {sent&&<><button type="button" disabled={busy||blocked||retryIn>0||resendIn>0} onClick={()=>void perform('send')}>{resendIn>0?(zh?`${resendIn} 秒后重发`:`Resend in ${resendIn}s`):(zh?'重新发送':'Resend code')}</button><button type="button" disabled={busy} onClick={()=>{setSent(false);setCode('');setFailure(null);setNotice(false);setResendUntil(0)}}>{zh?'更换邮箱':'Change email'}</button></>}
    </div>
   </form>
    {blocked&&contactEmail&&<VerificationHelp email={contactEmail} zh={zh}/>}
   </>:error&&!loading?<button disabled={!!action} onClick={()=>void perform('logout')}><SignOut size={17}/>{zh?'登出':'Sign out'}</button>:null}
   {onSupport&&<button className="account-secondary" onClick={onSupport}>{zh?'支持虚空终端':'Support the project'}<CaretRight size={15} className="push"/></button>}
  </Dialog.Content>
 </Dialog.Portal></Dialog.Root>;
}
