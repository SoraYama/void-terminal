'use client';
import {flushSync} from 'react-dom';
import {createArchiveSession,archiveDetailKey,resolvedListKey} from '../lib/archive-session';
import {useState,useEffect,useLayoutEffect,useRef,useCallback} from 'react';
import {ConversationCover,ConversationHeader} from './conversation-header';
import {CitationList} from './citation-list';
import {AnswerMarkdown} from './answer-markdown';
import {answerCardUrl} from '../lib/answer-cards';
import {useConversationScroll} from '../lib/use-conversation-scroll';
import * as Dialog from '@radix-ui/react-dialog';
import {Plus,BookOpen,Compass,UserCircle,Heart,Sparkle,ArrowUp,Stop,Sun,Moon,Globe, Gear, List, X, FileText, Copy, ArrowClockwise, PencilSimple, Check, CaretRight, SidebarSimple} from '@phosphor-icons/react';
import {LibraryWorkspace} from './library-workspace';
import {MuseumWorkspace} from './museum/museum-workspace';
import {CharacterWorkspace} from './characters/character-workspace';
import {NavigationIcon} from './game-icons';
import {useScrollbarVisibility} from '../lib/use-scrollbar-visibility';
import {ThemedSelect} from './themed-select';
import {SourceDrawer} from './source-drawer';
import {AccountPanel} from './account-panel';
import {SupportPanel} from './support-panel';
import type {SupportConfig} from '../lib/support-contracts';
import {creditResetLabel} from '../lib/credit-reset';
import {useAccount} from '../lib/use-account';
import type {AccountIdentity} from '../lib/account-contracts';
import type {DeploymentMode} from '../lib/deployment';
import {SettingsPanel,type ConnectionTestResult} from './settings-panel';
import {Scene,Emblem,Wordmark,Ornament} from './ui';
import type {AppStatus,Citation,ContentType,LibraryResult,DocumentResult,SourceResult} from '../lib/contracts';
import {CONTENT_TYPES} from '../lib/contracts';
import {defaults,readPreferences,writePreferences,selectedProvider,preferencesForDeployment,type Preferences} from '../lib/preferences';
import {historyOperation,branchConversation,conversationSnapshot,chatMessages,conversationMarkdown,type Conversation,type Message} from '../lib/history';
import {parseSSE} from '../lib/stream';
import {request} from '../lib/client';
import {ChatRequestError,chatFailure,chatErrorText,responseErrorCode,accountCreditShortage,creditShortageText,type ChatFailure} from '../lib/chat-errors';
import {text,typeNames} from '../lib/i18n';
const proofErrors=new Set(['DEVICE_VERIFICATION_REQUIRED','DEVICE_CHALLENGE_FAILED','ACCOUNT_RISK_UNAVAILABLE']);
const admissionErrors=new Set([...proofErrors,'LOGIN_REQUIRED','CREDITS_EXHAUSTED','ACCOUNT_RISK_LIMIT','ACCOUNT_BUSY','ACCOUNT_UNAVAILABLE','QUOTA_EXCEEDED','SHARED_DISABLED']);
type TerminalView='home'|'chat'|'library'|'museum'|'characters';
export function Terminal({deploymentMode,initialView='home',support}:{deploymentMode:DeploymentMode;initialView?:TerminalView;support?:SupportConfig}){
 const hosted=deploymentMode==='hosted',hasSponsorship=!!(hosted&&support&&(support.channels.length||support.bsc));
 const contactEmail=hosted?support?.contactEmail:undefined;
 useScrollbarVisibility();
 const [prefs,setPrefs]=useState<Preferences>(()=>preferencesForDeployment(defaults,deploymentMode)),[hydrated,setHydrated]=useState(false),[apiKey,setApiKey]=useState(''),[view,setViewState]=useState<TerminalView>(initialView),[menu,setMenu]=useState(false),[settings,setSettings]=useState(false),[statusOpen,setStatusOpen]=useState(false);
 const [status,setStatus]=useState<AppStatus|null>(null),[statusError,setStatusError]=useState(''),[history,setHistory]=useState<Conversation[]>([]),[current,setCurrent]=useState<Conversation|null>(null),[input,setInputState]=useState(''),[depth,setDepth]=useState(false),[type,setType]=useState<ContentType|''>(''),[busy,setBusy]=useState(false),[stage,setStage]=useState(''),[error,setError]=useState<string|ChatFailure>(''),[storageError,setStorageError]=useState('');
 const inputRevision=useRef(0);
 const [rejectedDraft,setRejectedDraft]=useState<string|null>(null);
 function setInput(value:string){inputRevision.current++;setInputState(value)}
 const [source,setSource]=useState<Citation|null>(null),[sourceInfo,setSourceInfo]=useState<SourceResult|null>(null),[sourceError,setSourceError]=useState(''),[sourceLoading,setSourceLoading]=useState(false),[testResult,setTestResult]=useState<ConnectionTestResult|null>(null),[testing,setTesting]=useState(false),[copied,setCopied]=useState<number|null>(null);
 const [libraryType,setLibraryType]=useState<ContentType|''>('book');
 const [query,setQuery]=useState(''),[page,setPage]=useState(1),[library,setLibrary]=useState<LibraryResult|null>(null),[libraryBusy,setLibraryBusy]=useState(false),[libraryError,setLibraryError]=useState(''),[libraryRetry,setLibraryRetry]=useState(0),[document,setDocument]=useState<DocumentResult|null>(null),[documentBusy,setDocumentBusy]=useState(false),[selection,setSelection]=useState(''),[editIndex,setEditIndex]=useState<number|null>(null),[editText,setEditText]=useState('');
 const sourceFocus=useRef<HTMLElement|null>(null),controller=useRef<AbortController|null>(null),composerRef=useRef<HTMLTextAreaElement>(null),runId=useRef(0);
 const modelTestRun=useRef(0),modelTestAbort=useRef<AbortController|null>(null);
 const sourceAbort=useRef<AbortController|null>(null),documentAbort=useRef<AbortController|null>(null);
 const anonymousDraftEligible=useRef(true);
 const identityScope=useRef<{identity:AccountIdentity;generation:number}>({identity:undefined,generation:0});
 const [accountOpen,setAccountOpen]=useState(false),[supportOpen,setSupportOpen]=useState(false),[showCreditRequest,setShowCreditRequest]=useState(false);
 const panelTrigger=useRef<HTMLElement|null>(null),screenRevision=useRef(0),preflight=useRef(false);
 const [checkingAccount,setCheckingAccount]=useState(false);
 const [draftBackup,setDraftBackup]=useState<{input:string;current:Conversation|null;document:DocumentResult|null;type:ContentType|'';view:TerminalView}|null>(null);
 const [archives]=useState(createArchiveSession);
 const main=useRef<HTMLElement>(null),navigation=useRef(0),requestedView=useRef(view),transition=useRef<ViewTransition|null>(null),fadeTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const libraryResultKey=useRef(''),activeView=useRef(view);activeView.current=view;
 const museumLocation=useRef('/museum'),characterLocation=useRef('/characters');
 function showView(next:TerminalView,animate=true){
  const id=++navigation.current,changed=requestedView.current!==next;requestedView.current=next;
  transition.current?.skipTransition();transition.current=null;
  const root=window.document.documentElement;
  root.removeAttribute('data-terminal-transition');
  if(fadeTimer.current)clearTimeout(fadeTimer.current);main.current?.removeAttribute('data-navigation-fade');
  if(!animate||!changed||matchMedia('(prefers-reduced-motion: reduce)').matches){setViewState(next);return}
  const fade=()=>{if(id!==navigation.current)return;setViewState(next);const element=main.current;if(!element)return;element.removeAttribute('data-navigation-fade');void element.offsetWidth;element.setAttribute('data-navigation-fade','true');fadeTimer.current=setTimeout(()=>element.removeAttribute('data-navigation-fade'),180)};
  if(!window.document.startViewTransition){fade();return}
  root.setAttribute('data-terminal-transition','true');
  try{
   const active=window.document.startViewTransition(()=>{if(id===navigation.current)flushSync(()=>setViewState(next))});transition.current=active;
   void active.ready.catch(()=>{if(id===navigation.current){root.removeAttribute('data-terminal-transition');fade()}});
   void active.finished.catch(()=>{}).finally(()=>{if(id===navigation.current){root.removeAttribute('data-terminal-transition');transition.current=null}});
  }catch{root.removeAttribute('data-terminal-transition');fade()}
 }
 function setView(next:TerminalView,animate=true,destination?:string){
  screenRevision.current++;
  // The address may already name a pending transition. Only remember a URL
  // belonging to the workspace that actually rendered, never the pending target.
  if(activeView.current==='museum'&&window.location.pathname==='/museum')museumLocation.current=window.location.pathname+window.location.search;
  if(activeView.current==='characters'&&window.location.pathname==='/characters')characterLocation.current=window.location.pathname+window.location.search;
  const target=destination??(next==='museum'?museumLocation.current:next==='characters'?characterLocation.current:'/');
  if(next==='museum')museumLocation.current=target;if(next==='characters')characterLocation.current=target;
  if(next!=='library'){documentAbort.current?.abort();setDocumentBusy(false)}
  if(next!==requestedView.current||next==='museum'||next==='characters')window.history.pushState({...window.history.state,terminalView:next},'',target);
  showView(next,animate);
 }
 useEffect(()=>{const sync=()=>{screenRevision.current++;const next=window.location.pathname==='/museum'?'museum':window.location.pathname==='/characters'?'characters':window.history.state?.terminalView||'home';if(next!=='library'){documentAbort.current?.abort();setDocumentBusy(false)}showView(next);setMenu(false)};window.addEventListener('popstate',sync);return()=>{window.removeEventListener('popstate',sync);navigation.current++;transition.current?.skipTransition();window.document.documentElement.removeAttribute('data-terminal-transition');if(fadeTimer.current)clearTimeout(fadeTimer.current)}},[]);
 function askItem(name:string,id:string,snapshotId:string){controller.current?.abort();runId.current++;setBusy(false);setStage('');if(!draftBackup)setDraftBackup({input,current,document,type,view:current?'chat':'home'});setDocument(null);setType('');setCurrent({id:crypto.randomUUID(),title:name,updatedAt:Date.now(),messages:[],snapshotId});setInput((prefs.locale==='zh-CN'?'请根据原始资料介绍这个道具：':'Describe this item using original sources: ')+name+' ('+id+')');setError('');setView('chat');setMenu(false)}
 function askCharacter(name:string,id:string,snapshotId:string){controller.current?.abort();runId.current++;setBusy(false);setStage('');if(!draftBackup)setDraftBackup({input,current,document,type,view:current?'chat':'home'});setDocument(null);setType('character');setCurrent({id:crypto.randomUUID(),title:name,updatedAt:Date.now(),messages:[],snapshotId});setInput((prefs.locale==='zh-CN'?'请根据原始资料介绍这位角色：':'Describe this character using original sources: ')+name+' ('+id+')');setError('');setView('chat');setMenu(false)}
 function openMaterial(id:string,snapshotId:string){setView('museum',true,'/museum?'+new URLSearchParams({category:'all',item:id,snapshotId}));setMenu(false)}
 const t=text(prefs.locale),zh=prefs.locale==='zh-CN';
 const requestPrefs=preferencesForDeployment(prefs,deploymentMode);
 const refreshStatus=useCallback(()=>{setStatusError('');request<AppStatus>('/api/status').then(setStatus).catch(e=>setStatusError(e.message))},[]);
 useEffect(()=>{setPrefs(preferencesForDeployment(readPreferences(),deploymentMode));setHydrated(true);refreshStatus();return ()=>{controller.current?.abort();modelTestAbort.current?.abort();sourceAbort.current?.abort();documentAbort.current?.abort()}},[refreshStatus,deploymentMode]);
 useEffect(()=>{if(!hydrated)return;try{writePreferences(prefs)}catch{};window.document.documentElement.lang=prefs.locale;const media=matchMedia('(prefers-color-scheme: dark)');const apply=()=>{window.document.documentElement.dataset.theme=prefs.theme==='system'?(media.matches?'dark':'light'):prefs.theme};apply();media.addEventListener('change',apply);return()=>media.removeEventListener('change',apply)},[prefs,hydrated]);
 useEffect(()=>{const media=matchMedia('(max-width: 650px)');const closeDesktopMenu=()=>{if(!media.matches)setMenu(false)};media.addEventListener('change',closeDesktopMenu);return()=>media.removeEventListener('change',closeDesktopMenu)},[]);
 const {chatScroll,answerTail,autoScroll,awayFromBottom,compact,onScroll,pauseFollow,resumeFollow}=useConversationScroll(current?.messages,stage,view==='chat',current?.id);
 useLayoutEffect(()=>{const el=composerRef.current;if(!el||view!=='chat')return;el.style.height='auto';el.style.height=Math.min(el.scrollHeight,140)+'px'},[input,view]);
 function invalidateConnectionTest(){modelTestRun.current++;modelTestAbort.current?.abort();modelTestAbort.current=null;setTesting(false);setTestResult(null)}
 function updatePrefs(p:Partial<Preferences>){setPrefs(old=>preferencesForDeployment({...old,...p},deploymentMode));if('mode' in p||'modelBaseUrl' in p||'modelName' in p)invalidateConnectionTest()}
 function canUseHistory(identity:AccountIdentity){return typeof identity==='string'||(!hosted&&identity===null)}
 function changeAccountIdentity(identity:AccountIdentity){
  const previous=identityScope.current.identity;
  const scope={identity,generation:identityScope.current.generation+1};identityScope.current=scope;
  // A confirmed signed-out period starts a new local draft. Leaving an
  // authenticated identity clears its state before a new draft is eligible.
  // Keep eligibility through sign-in's intermediate unverified state.
  const preserveDraft=anonymousDraftEligible.current&&(hosted||identity===null);
  if(identity===null)anonymousDraftEligible.current=true;
  else if(typeof identity==='string')anonymousDraftEligible.current=false;
  controller.current?.abort();controller.current=null;runId.current++;invalidateConnectionTest();sourceAbort.current?.abort();documentAbort.current?.abort();
  if(!preserveDraft){setApiKey('');setInput('')}
  setHistory([]);setCurrent(null);setBusy(false);setStage('');setError('');setStorageError('');setDraftBackup(null);setRejectedDraft(null);setEditIndex(null);setEditText('');setCopied(null);setDocument(null);setDocumentBusy(false);setSelection('');setSource(null);setSourceInfo(null);setSourceError('');setSourceLoading(false);
  // Invalidate queued navigation and discard its captured pixels before exposing
  // another identity. Account resets must never create a replacement snapshot.
  if(previous!==undefined){setView('home',false);setMenu(false)}
  if(canUseHistory(identity))void historyOperation('list',undefined,identity).then(items=>{if(scope===identityScope.current)setHistory(items)}).catch(()=>{if(scope===identityScope.current)setStorageError('storage')});
 }
 const accountSession=useAccount(changeAccountIdentity,hosted);
 const account=accountSession.account;
 function rememberPanelTrigger(){const active=window.document.activeElement;panelTrigger.current=active instanceof HTMLElement?active:null}
 function restorePanelFocus(){
  requestAnimationFrame(()=>{
   if(window.document.querySelector('.account-dialog[data-state="open"]'))return;
   const fallback=Array.from(window.document.querySelectorAll<HTMLElement>('.mobile-header>button,.account-nav,#question')).filter(element=>element.getClientRects().length);
   const target=[panelTrigger.current,...fallback].find(element=>element?.isConnected&&element.getClientRects().length&&!(element instanceof HTMLButtonElement&&element.disabled));
   target?.focus();
  });
 }
 function openAccount(requestCredits=false){if(!hosted)return;rememberPanelTrigger();setShowCreditRequest(requestCredits);setSettings(false);setMenu(false);setAccountOpen(true)}
 function openSupport(){if(!hasSponsorship)return;rememberPanelTrigger();setMenu(false);setAccountOpen(false);setSupportOpen(true)}
 async function save(c:Conversation,scope=identityScope.current){if(scope!==identityScope.current||!canUseHistory(scope.identity))return;setCurrent(c);setHistory(old=>[c,...old.filter(h=>h.id!==c.id)].sort((a,b)=>b.updatedAt-a.updatedAt));try{await historyOperation('save',c,scope.identity)}catch{if(scope===identityScope.current)setStorageError('storage')}}
 function reset(){controller.current?.abort();runId.current++;setBusy(false);setCurrent(null);setView('home');setInput('');setError('');setMenu(false);setDocument(null);setDraftBackup(null);setRejectedDraft(null)}
 async function send(value=input,base=current,branch=false){const content=value.trim();if(!content||busy||preflight.current)return;
 const restoreBranch=()=>{if(branch&&base){setEditIndex(base.messages.length-1);setEditText(value)}};
 const scope=identityScope.current,startedInputRevision=inputRevision.current;
 if(hosted&&(scope.identity===undefined||!account?.authenticated)){openAccount();return}
 if(content.length>12000){setError({code:'MESSAGE_TOO_LONG',message:''});return}
 if(!hosted&&!apiKey){setSettings(true);setTestResult({ok:false,status:400});return}
 if(!canUseHistory(scope.identity))return;
 if(hosted){
  // Check the latest server allowance (including midnight rollover) and device proof.
  const screen=screenRevision.current;
  preflight.current=true;setCheckingAccount(true);
  let fresh;
  try{fresh=await accountSession.refresh()}
  finally{preflight.current=false;setCheckingAccount(false)}
  if(scope!==identityScope.current){if(fresh?.authenticated===false)openAccount();return}
  if(screen!==screenRevision.current)return;
  if(!fresh||!fresh.authenticated){openAccount();return}
  if(fresh.risk?.status!=='verified'){restoreBranch();openAccount();return}
  if(!status?.provider.sharedEnabled||!fresh.enabled){setError({code:'SHARED_DISABLED',message:''});return}
  if(accountCreditShortage(fresh,depth?'deep':'standard')){
   setError({code:'CREDITS_EXHAUSTED',message:''});restoreBranch();if(!branch)composerRef.current?.focus();return;
  }
 }

 const initial=base||{id:crypto.randomUUID(),title:content.slice(0,45),updatedAt:Date.now(),messages:[]};const messages:Message[]=branch?initial.messages:[...initial.messages,{role:'user',content}];const requestMessages=chatMessages(messages);if(requestMessages.length>24||requestMessages.reduce((n,m)=>n+m.content.length,0)>48000){setError(zh?'当前对话达到长度限制，请开始新对话':'Conversation limit reached. Start a new conversation.');return}
 const priorCurrent=current,priorView=view;
 const pinnedSnapshot=conversationSnapshot(initial,document?.snapshotId);const active:Conversation={...initial,snapshotId:pinnedSnapshot,messages:[...messages,{role:'assistant' as const,content:'',sources:[] as Citation[]}],updatedAt:Date.now()};
 // The run owns cancellation even while IndexedDB is still opening or saving.
 const id=++runId.current;const shared=hosted;const requestId=shared?crypto.randomUUID():undefined;const abort=new AbortController();controller.current=abort;
 const clearedInputRevision=!branch&&inputRevision.current===startedInputRevision?(setInput(''),inputRevision.current):null;setEditIndex(null);let admissionRejected=false;
 setError('');setStage(zh?'正在检索原文…':'Searching original sources…');setView('chat');setBusy(true);autoScroll.current=true;
 try{
 // Hosted admission may reject without starting research. Keep the optimistic
 // question in memory only until a real answer or model failure is available.
 if(shared)setCurrent(active);else await save(active,scope);
 if(id!==runId.current)return;
 abort.signal.throwIfAborted();
 const response=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json',...(!hosted?{'X-Model-Api-Key':apiKey}:{'X-Request-Id':requestId!})},body:JSON.stringify({messages:requestMessages,language:prefs.sourceLanguage,answerLanguage:prefs.locale,mode:requestPrefs.mode,depth:depth?'deep':'standard',...(selectedProvider(requestPrefs)?{provider:selectedProvider(requestPrefs)}:{}),...(type?{types:[type]}:{}),...(pinnedSnapshot?{snapshotId:pinnedSnapshot}:{})}),signal:abort.signal});if(!response.ok){const d=await response.json();const code=responseErrorCode(d);admissionRejected=shared&&!!code&&admissionErrors.has(code);throw new ChatRequestError(d.error?.message||`HTTP ${response.status}`,code,d.error?.retryAfter)}if(!response.body)throw new ChatRequestError('Empty response','INVALID_MODEL_RESPONSE');
 for await(const event of parseSSE(response.body)){if(id!==runId.current)break;const last=active.messages[active.messages.length-1];if(event.event==='status')setStage(event.data.message||({searching:zh?'正在检索原文…':'Searching sources…',reading:zh?'正在阅读资料…':'Reading sources…',writing:zh?'正在生成回答…':'Writing answer…'}[event.data.stage]));else if(event.event==='text_delta')last.content+=event.data.text;else if(event.event==='sources'){last.sources=event.data.sources;last.snapshotId=event.data.snapshotId;active.snapshotId??=event.data.snapshotId}else if(event.event==='error')throw new ChatRequestError(event.data.message,event.data.code);else if(event.event==='done'){last.snapshotId=event.data.snapshotId;last.cards=event.data.cards;active.snapshotId??=event.data.snapshotId;if(event.data.citationWarnings?.length)last.error=event.data.citationWarnings.join(' · ')}setCurrent({...active,messages:active.messages.map(m=>({...m}))});}
 }catch(e){if(id===runId.current&&scope===identityScope.current){
  const failure=chatFailure(e);
  if(admissionRejected){
   // Restore the question/branch without overwriting new text or persisting a failed answer.
   if(branch)restoreBranch();
   else if(inputRevision.current===clearedInputRevision)setInput(value);
   else setRejectedDraft(value);
   setCurrent(priorCurrent);setView(priorView);
   setError(failure);
   if(failure.code&&(failure.code==='LOGIN_REQUIRED'||proofErrors.has(failure.code)))openAccount();
  }else{active.messages[active.messages.length-1].error=failure.message;active.messages[active.messages.length-1].errorCode=failure.code;setError(failure)}
 }}finally{if(id===runId.current){controller.current=null;setBusy(false);setStage('');if(!admissionRejected)await save({...active,messages:active.messages.map(m=>({...m})),updatedAt:Date.now()},scope);if(shared&&scope===identityScope.current)void accountSession.refresh()}}
 }
 async function openSource(s:Citation){sourceAbort.current?.abort();const abort=new AbortController();sourceAbort.current=abort;const scope=identityScope.current;sourceFocus.current=window.document.activeElement as HTMLElement;setSource(s);setSourceInfo(null);setSourceError('');setSourceLoading(true);try{const result=await request<SourceResult>(`/api/sources/${encodeURIComponent(s.id)}?snapshotId=${encodeURIComponent(s.snapshotId)}`,{signal:abort.signal});if(scope===identityScope.current&&!abort.signal.aborted)setSourceInfo(result)}catch(e){if(scope===identityScope.current&&!abort.signal.aborted)setSourceError((e as Error).message)}finally{if(scope===identityScope.current&&!abort.signal.aborted)setSourceLoading(false)}}
 const libraryKey=new URLSearchParams({q:query,language:prefs.sourceLanguage,page:String(page),pageSize:'24',...(libraryType?{type:libraryType}:{})}).toString();
 const currentLibrary=archives.library.lists.get(libraryKey)||(libraryResultKey.current===libraryKey?library:null);
 useEffect(()=>{if(view!=='library')return;const cached=archives.library.lists.get(libraryKey);setLibraryError('');if(cached){setLibrary(cached);libraryResultKey.current=libraryKey;setLibraryBusy(false);return}const abort=new AbortController();setLibraryBusy(true);const timer=setTimeout(()=>{
  request<LibraryResult>(`/api/library?${libraryKey}`,{signal:abort.signal}).then(data=>{if(abort.signal.aborted)return;archives.library.lists.set(libraryKey,data,[resolvedListKey(libraryKey,data.snapshotId)]);libraryResultKey.current=libraryKey;setLibrary(data)}).catch(e=>{if(!abort.signal.aborted)setLibraryError(e.message)}).finally(()=>{if(!abort.signal.aborted)setLibraryBusy(false)});
 },250);return()=>{clearTimeout(timer);abort.abort()}},[view,libraryKey,libraryRetry,archives]);
 async function openDocument(id:string,snapshotId?:string){
  documentAbort.current?.abort();const abort=new AbortController();documentAbort.current=abort;const scope=identityScope.current;
  const key=archiveDetailKey(prefs.sourceLanguage,snapshotId||'',id),cached=archives.library.details.get(key);
  setView('library');setDocument(cached||null);setDocumentBusy(!cached);setLibraryError('');setSelection('');if(cached)return;
  try{const result=await request<DocumentResult>(`/api/documents/${encodeURIComponent(id)}${snapshotId?'?snapshotId='+encodeURIComponent(snapshotId):''}`,{signal:abort.signal});if(scope===identityScope.current&&!abort.signal.aborted&&result.document.id===id&&(!snapshotId||result.snapshotId===snapshotId)){archives.library.details.set(key,result,[archiveDetailKey(prefs.sourceLanguage,result.snapshotId,id)]);setDocument(result)}}catch(e){if(scope===identityScope.current&&!abort.signal.aborted)setLibraryError((e as Error).message)}finally{if(scope===identityScope.current&&!abort.signal.aborted)setDocumentBusy(false)}
 }
 async function connectionTest(){if(hosted&&(!account?.authenticated||account.risk?.status!=='verified')){openAccount();return}invalidateConnectionTest();const id=++modelTestRun.current;const abort=new AbortController();modelTestAbort.current=abort;setTesting(true);try{const response=await fetch('/api/models/test',{method:'POST',headers:{'Content-Type':'application/json',...(!hosted?{'X-Model-Api-Key':apiKey}:{})},body:JSON.stringify({mode:requestPrefs.mode,...(selectedProvider(requestPrefs)?{provider:selectedProvider(requestPrefs)}:{})}),signal:abort.signal});const result=await response.json();const code=responseErrorCode(result);if(id===modelTestRun.current&&code&&(code==='LOGIN_REQUIRED'||proofErrors.has(code))){openAccount();void accountSession.refresh()}if(id===modelTestRun.current)setTestResult({ok:response.ok&&result.ok===true,model:typeof result.model==='string'?result.model:undefined,status:response.status,code})}catch{if(id===modelTestRun.current)setTestResult({ok:false})}finally{if(id===modelTestRun.current){setTesting(false);modelTestAbort.current=null}}}
 function exportChat(){if(!current)return;const url=URL.createObjectURL(new Blob([conversationMarkdown(current,prefs.locale)],{type:'text/markdown;charset=utf-8'}));const a=window.document.createElement('a');a.href=url;a.download='void-terminal-'+current.id+'.md';a.click();URL.revokeObjectURL(url)}
 async function deleteChat(id:string){const scope=identityScope.current;if(!canUseHistory(scope.identity))return;try{await historyOperation('delete',id,scope.identity);if(scope!==identityScope.current)return;setHistory(h=>h.filter(c=>c.id!==id));if(current?.id===id)reset()}catch{if(scope===identityScope.current)setStorageError('storage')}}
 function regenerate(index:number){if(!current||busy)return;const userIndex=index-1;if(userIndex<0)return;const branch=branchConversation(current,userIndex,current.messages[userIndex].content);void send(branch.messages[userIndex].content,branch,true)}
 const latestMessage=current?.messages.at(-1);
 const chatError=error||(latestMessage?.role==='assistant'&&latestMessage.error?{message:latestMessage.error,code:latestMessage.errorCode}:null);
 const showCreditShortage=hosted&&typeof error==='object'&&error.code==='CREDITS_EXHAUSTED';
 const creditShortage=hosted&&account?.user?.id===identityScope.current.identity?accountCreditShortage(account,depth?'deep':'standard'):null;
 const resetTime=creditResetLabel(account?.credits?.daily?.resetsAt,zh);
 const sidebar=<>
  <div className="sidebar-header">
   <a className="brand" href="#" title={t.newChat} onClick={e=>{e.preventDefault();reset()}}><Emblem/><Wordmark label={zh?'void-terminal · 虚空终端':'void-terminal · Akasha terminal'}/></a>
  </div>
  <Ornament/>
  <nav>
   <button aria-label={t.newChat} title={t.newChat} className={view==='home'||view==='chat'?'nav-item active':'nav-item'} onClick={reset}><Plus size={26}/><span className="nav-label">{t.newChat}</span></button>
   <button aria-label={t.library} title={t.library} className={view==='library'?'nav-item active':'nav-item'} onClick={()=>{setView('library');setMenu(false)}}><NavigationIcon module="archive"/><span className="nav-label">{t.library}</span><CaretRight size={17} className="push"/></button>
   <button aria-label={zh?'万象集录':'Compendium'} title={zh?'万象集录':'Compendium'} className={view==='museum'?'nav-item active':'nav-item'} onClick={()=>{setView('museum');setMenu(false)}}><NavigationIcon module="compendium"/><span className="nav-label">{zh?'万象集录':'Compendium'}</span><CaretRight size={17} className="push"/></button>
   <button aria-label={zh?'群星图鉴':'Character Archive'} title={zh?'群星图鉴':'Character Archive'} className={view==='characters'?'nav-item active':'nav-item'} onClick={()=>{setView('characters');setMenu(false)}}><NavigationIcon module="characters"/><span className="nav-label">{zh?'群星图鉴':'Character Archive'}</span><CaretRight size={17} className="push"/></button>
  </nav>
  <Ornament/><div className="history-label">{t.recent}</div>
  <div className="history-list">{history.length===0?<p className="muted small">{t.empty}</p>:history.map(c=><div className="history-row" key={c.id}><button aria-label={c.title} title={c.title} className={current?.id===c.id?'selected':''} onClick={()=>{if(busy)return;setCurrent(c);setView('chat');setMenu(false);setError('')}}><FileText size={17}/><span>{c.title}</span>{c.parentId&&<small>↳</small>}</button><button aria-label={`${t.delete} ${c.title}`} onClick={()=>void deleteChat(c.id)} disabled={busy}><X size={15}/></button></div>)}</div>
  <div className="sidebar-bottom"><Ornament/>
   {hosted&&<button className="nav-item account-nav" aria-label={zh?'账户与点数':'Account & credits'} title={zh?'账户与点数':'Account & credits'} onClick={()=>openAccount()}><UserCircle size={22}/><span className="nav-label">{zh?'账户与点数':'Account & credits'}</span>{account?.authenticated&&account.credits&&<small className="account-nav-balance">{account.credits.available}</small>}</button>}
   {hasSponsorship&&<button className="nav-item support-nav" aria-label={zh?'支持虚空终端':'Support the project'} title={zh?'支持虚空终端':'Support the project'} onClick={openSupport}><Heart size={22}/><span className="nav-label">{zh?'支持虚空终端':'Support the project'}</span></button>}
   <button className="nav-item" aria-label={t.settings} title={t.settings} onClick={()=>{setSettings(true);setMenu(false)}}><Gear size={22}/><span className="nav-label">{t.settings}</span></button>
   <div className="sidebar-tools"><button aria-label={t.uiLang} title={t.uiLang} onClick={()=>updatePrefs({locale:zh?'en':'zh-CN'})}><Globe size={21}/><span className="nav-label">中 / EN</span></button><button aria-label={t.theme} title={t.theme} onClick={()=>updatePrefs({theme:prefs.theme==='dark'?'light':'dark'})}>{prefs.theme==='dark'?<Sun size={24}/>:<Moon size={24}/>}</button></div>
   <div className="sidebar-status-row">
    <button className="corpus-link" aria-label={t.status} title={t.status} onClick={()=>{setStatusOpen(true);setMenu(false)}}><span className={status?.ready?'dot ready':'dot'}/><span className="nav-label">{t.status}</span><CaretRight size={13}/></button>
    <button className="sidebar-toggle" aria-label={prefs.sidebarCollapsed?(zh?'展开菜单':'Expand menu'):(zh?'收起菜单':'Collapse menu')} title={prefs.sidebarCollapsed?(zh?'展开菜单':'Expand menu'):(zh?'收起菜单':'Collapse menu')} aria-expanded={!prefs.sidebarCollapsed} aria-controls="desktop-navigation" onClick={()=>updatePrefs({sidebarCollapsed:!prefs.sidebarCollapsed})}><SidebarSimple size={21}/></button>
   </div>
  </div>
 </>;
 const composer=<form className="composer" onSubmit={e=>{e.preventDefault();void send()}}>
  {showCreditShortage&&<div className="credit-shortage" role="alert"><p>{creditShortageText(creditShortage,prefs.locale)}{creditShortage?.available===0&&resetTime&&(zh?`下次每日点数重置：${resetTime}。`:` Next daily reset: ${resetTime}.`)}</p><div className="credit-shortage-actions"><button type="button" onClick={()=>openAccount()}>{zh?'查看账户':'View account'}</button>{contactEmail&&<button type="button" onClick={()=>openAccount(true)}>{zh?'邮件申请额外点数':'Request extra credits by email'}</button>}{creditShortage?.available===0&&<button type="button" onClick={()=>setView('library')}>{zh?'浏览资料':'Browse the archive'}</button>}{creditShortage?.canUseStandard&&<button type="button" onClick={()=>{setDepth(false);setError('');composerRef.current?.focus()}}>{zh?'切换为普通考据':'Switch to standard research'}</button>}</div></div>}
  {rejectedDraft!==null&&<details className="credit-rejected-draft"><summary>{zh?'查看未发送问题':'View unsent question'}</summary><p>{rejectedDraft}</p><button type="button" disabled={busy} onClick={()=>{setRejectedDraft(input||null);setInput(rejectedDraft);composerRef.current?.focus()}}>{zh?'恢复未发送问题':'Restore unsent question'}</button></details>}
  {draftBackup&&<button type="button" className="museum-restore-draft" onClick={()=>{controller.current?.abort();runId.current++;setBusy(false);setStage('');setError('');setCurrent(draftBackup.current);setInput(draftBackup.input);setDocument(draftBackup.document);setType(draftBackup.type);setView(draftBackup.view);setDraftBackup(null)}}>{zh?'恢复之前的草稿':'Restore previous draft'}</button>}<label className="sr-only" htmlFor="question">{view==='home'?t.ask:t.follow}</label><textarea ref={composerRef} id="question" value={input} onChange={e=>setInput(e.target.value)} placeholder={view==='home'?t.ask:t.follow} maxLength={12000} rows={view==='chat'?1:2} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void send()}}}/><div className="composer-tools"><div className="type-select"><FileText size={18} aria-hidden="true"/><ThemedSelect label={t.all} value={type} variant="composer" onValueChange={value=>setType(value as ContentType|'')} options={[{value:'',label:t.all},...CONTENT_TYPES.map(c=>({value:c,label:zh?typeNames[c]:c}))]}/></div><span className="tool-divider"/><button type="button" className={depth?'depth chosen':'depth'} aria-pressed={depth} onClick={()=>{setDepth(d=>!d);if(showCreditShortage)setError('')}}>{depth?<Check size={20} weight="bold" className="depth-check" aria-hidden="true"/>:<Sparkle size={20} aria-hidden="true"/>}{t.deep}</button>{hosted&&account?.authenticated&&account.costs&&<span className="composer-cost">{zh?`本次 ${depth?account.costs.deep:account.costs.standard} 点`:`${depth?account.costs.deep:account.costs.standard} ${((depth?account.costs.deep:account.costs.standard)===1)?'credit':'credits'}`}</span>}{busy?<button type="button" className="send" aria-label={t.stop} onClick={()=>controller.current?.abort()}><Stop size={21} weight="fill"/></button>:<button type="submit" className="send" disabled={checkingAccount||!input.trim()} aria-label={t.send}><ArrowUp size={25}/></button>}</div></form>;
 return <div className="app"><aside className="sidebar" id="desktop-navigation" data-collapsed={!!prefs.sidebarCollapsed}>{sidebar}</aside><header className="mobile-header"><button aria-label="Menu" aria-expanded={menu} aria-controls="mobile-navigation" onClick={()=>setMenu(true)}><List size={24}/></button><span className="mobile-brand"><Emblem/><Wordmark/></span><button onClick={()=>updatePrefs({locale:zh?'en':'zh-CN'})}>中 / EN</button></header><Dialog.Root open={menu} onOpenChange={setMenu}><Dialog.Portal><Dialog.Overlay className="overlay mobile-menu-overlay"/><Dialog.Content className="mobile-menu" id="mobile-navigation"><Dialog.Title className="sr-only">Menu</Dialog.Title><Dialog.Description className="sr-only">Navigation</Dialog.Description><Dialog.Close className="dialog-close" aria-label={t.close}><X size={23}/></Dialog.Close>{sidebar}</Dialog.Content></Dialog.Portal></Dialog.Root>
 <main ref={main} className={'main '+view}>{view==='home'?<><Scene home/><section className="hero"><div className="eyebrow">AKASHA ARCHIVE · {zh?'须弥':'SUMERU'}</div><h1 className={zh?'hero-title hero-title-art':'hero-title'}>{zh?<span className="sr-only">{t.title}</span>:t.title.split('\n').map((line,i)=><span key={i}>{line}</span>)}</h1><p className="hero-subtitle">{t.tagline}</p>{composer}{error&&!showCreditShortage&&<p role="alert" className="home-error">{chatErrorText(error,prefs.locale,deploymentMode)}</p>}{hosted&&account?.enabled&&!account.authenticated&&<p className="hosted-signin-hint">{zh?'登录后提问。符合条件的账户每天可获 3 点，新用户另有一次性赠点（默认 20 点）。':'Sign in to ask. Eligible accounts receive 3 daily credits and a one-time welcome gift (20 credits by default).'}</p>}<div className="suggestions">{[{icon:UserCircle,label:t.character,q:zh?'纳西妲的角色故事中，如何描述她与须弥的联系？':'How do Nahida’s character stories describe her connection to Sumeru?'},{icon:Compass,label:t.quest,q:zh?'请根据任务原文梳理须弥魔神任务的主要脉络。':'Trace the Sumeru Archon Quest using its original dialogue.'},{icon:BookOpen,label:t.book,q:zh?'尘世文卷中有哪些与世界树有关的书籍记录？':'Which books in the archive mention Irminsul?'}].map(s=><button key={s.label} onClick={()=>{setInput(s.q);composerRef.current?.focus()}}><s.icon size={24}/>{s.label}</button>)}</div></section><footer className="home-footer"><span>{t.unofficial}</span><span>SUMERU · TEYVAT</span></footer></>:<><div className="workspace">{view==='chat'?<><ConversationHeader title={current?.title||t.newChat} compact={compact} exportLabel={t.export} onExport={exportChat}/><div className="chat-scroll" ref={chatScroll} onScroll={onScroll} onWheel={e=>{if(e.deltaY<0)pauseFollow()}}><ConversationCover compact={compact} title={current?.title||t.newChat} exportLabel={t.export} onExport={exportChat}/><div className="conversation-messages">{current?.messages.map((m,i)=><article className={'message '+m.role} key={i}>{m.role==='assistant'&&<Emblem/>}<div className="message-body">{editIndex===i?<div className="edit-box"><textarea readOnly={checkingAccount} value={editText} onChange={e=>setEditText(e.target.value)}/><button disabled={checkingAccount} onClick={()=>{if(!current||!editText.trim())return;const b=branchConversation(current,i,editText);void send(editText,b,true)}}>{t.edit}</button><button onClick={()=>setEditIndex(null)}>{t.close}</button></div>:m.role==='user'?<p>{m.content}</p>:<><AnswerMarkdown content={m.content} cards={m.cards} sources={m.sources} messageIndex={i} locale={prefs.locale} onOpenSource={s=>void openSource(s)} onOpenCard={card=>{setView(card.kind==='character'?'characters':'museum',true,answerCardUrl(card));setMenu(false)}}/>{!m.content&&!m.error&&busy&&<p className="stream-stage"><span className="pulses">•••</span> {stage}</p>}{i===current.messages.length-1&&<div className="answer-tail" ref={answerTail} aria-hidden="true"/>}{m.sources&&m.sources.length>0&&<CitationList sources={m.sources} locale={prefs.locale} messageIndex={i} onOpen={s=>void openSource(s)} onExpand={pauseFollow}/>}</>}{!busy&&<div className="message-actions"><button aria-label={t.copy} onClick={async()=>{try{await navigator.clipboard.writeText(m.content);setCopied(i);setTimeout(()=>setCopied(null),1800)}catch{setError(zh?'复制失败，请手动选择文本':'Copy failed. Select text manually.')}}}>{copied===i?<Check size={16}/>:<Copy size={16}/>}</button>{m.role==='user'?<button aria-label={t.edit} onClick={()=>{setEditIndex(i);setEditText(m.content)}}><PencilSimple size={16}/></button>:<button aria-label={t.regenerate} onClick={()=>regenerate(i)}><ArrowClockwise size={16}/></button>}</div>}</div></article>)}{busy&&current?.messages.at(-1)?.content&&<p className="stream-stage">{stage}</p>}</div></div><div className="chat-bottom">{awayFromBottom&&<button className="back-to-bottom" onClick={resumeFollow}>{zh?'回到最新回答':'Back to latest'} ↓</button>}{chatError&&!showCreditShortage&&<p className="inline-error" role="alert">{chatErrorText(chatError,prefs.locale,deploymentMode)}</p>}{composer}<p className="disclaimer">{t.notice}</p></div></>:view==='museum'?<MuseumWorkspace cache={archives.museum} locale={prefs.locale} language={prefs.sourceLanguage} onOpenDocument={openDocument} onAsk={askItem}/>:view==='characters'?<CharacterWorkspace cache={archives.characters} locale={prefs.locale} language={prefs.sourceLanguage} onOpenDocument={openDocument} onAsk={askCharacter} onOpenMaterial={openMaterial}/>:<LibraryWorkspace scrollPositions={archives.library.scroll} listKey={resolvedListKey(libraryKey,currentLibrary?.snapshotId??null)} locale={prefs.locale} query={query} onQuery={value=>{setQuery(value);setPage(1);setDocument(null)}} type={libraryType} onType={value=>{setLibraryType(value);setPage(1);setDocument(null)}} page={page} onPage={setPage} library={currentLibrary} busy={libraryBusy&&!currentLibrary} error={libraryError} onRetry={()=>setLibraryRetry(n=>n+1)} onStatus={()=>setStatusOpen(true)} record={document} documentBusy={documentBusy} onBack={()=>{setDocument(null);setSelection('')}} onOpen={openDocument} onSource={s=>void openSource(s)} selection={selection} onSelection={setSelection} onAsk={()=>{setInput((zh?'请结合原文解释这段内容：\n':'Explain this original passage:\n')+selection);setView('chat');setCurrent(null)}}/>}</div></>}{storageError&&<div className="storage-warning" role="status">{t.storageError}</div>}</main>
 <SourceDrawer source={source} setSource={setSource} sourceFocus={sourceFocus} sourceInfo={sourceInfo} sourceLoading={sourceLoading} sourceError={sourceError} t={t} zh={zh} openDocument={openDocument}/>
 <SettingsPanel deploymentMode={deploymentMode} settings={settings} setSettings={setSettings} prefs={prefs} updatePrefs={updatePrefs} apiKey={apiKey} setApiKey={value=>{invalidateConnectionTest();setApiKey(value)}} testResult={testResult} setTestResult={setTestResult} testing={testing} connectionTest={connectionTest} onClearHistory={async()=>{if(!window.confirm(zh?'清除此身份在本设备的所有对话？此操作无法撤销。':'Delete this identity’s conversations on this device? This cannot be undone.'))return;const scope=identityScope.current;if(!canUseHistory(scope.identity))return;try{await historyOperation('clear',undefined,scope.identity);if(scope!==identityScope.current)return;setHistory([]);reset()}catch{if(scope===identityScope.current)setStorageError('storage')}}} setStatusOpen={setStatusOpen} sharedEnabled={!!status?.provider.sharedEnabled&&!!account?.enabled} account={account} accountLoading={accountSession.loading} accountError={accountSession.error} onAccount={()=>openAccount()} t={t} zh={zh}/>
 {hosted&&<AccountPanel open={accountOpen} onOpenChange={setAccountOpen} onCloseFocus={restorePanelFocus} session={accountSession} zh={zh} sharedEnabled={!!status?.provider.sharedEnabled} contactEmail={contactEmail} showRequest={showCreditRequest} onShowRequest={()=>setShowCreditRequest(true)} onSupport={hasSponsorship?openSupport:undefined}/>}
 {hasSponsorship&&support&&<SupportPanel open={supportOpen} onOpenChange={setSupportOpen} onCloseFocus={restorePanelFocus} support={support} zh={zh}/>}
 <Dialog.Root open={statusOpen} onOpenChange={setStatusOpen}><Dialog.Portal><Dialog.Overlay className="overlay"/><Dialog.Content className="settings-dialog"><Dialog.Title>{t.status}</Dialog.Title><Dialog.Description className="muted">{zh?'当前知识库快照、覆盖范围与模型连接配置':'Active snapshot, coverage, and model configuration'}</Dialog.Description><Dialog.Close className="dialog-close" aria-label={t.close}><X size={24}/></Dialog.Close><Ornament/>{statusError&&<p role="alert" className="inline-error">{statusError}</p>}{status?<><div className="status-banner"><span className={status.ready?'dot ready':'dot'}/>{status.ready?t.available:t.unavailable}</div>{status.error&&<p className="inline-error">{status.error.message}</p>}<dl className="metadata"><dt>{zh?'快照':'Snapshot'}</dt><dd>{status.activeSnapshot?.label||'—'}</dd><dt>Commit</dt><dd>{status.activeSnapshot?.sourceCommit||'—'}</dd><dt>{zh?'文档 / 片段':'Documents / chunks'}</dt><dd>{status.documentCount??'—'} / {status.chunkCount??'—'}</dd><dt>{t.sourceLang}</dt><dd>{status.languages?.join(', ')||'—'}</dd><dt>{zh?'检索':'Retrieval'}</dt><dd>{status.retrieval?.lexical?'Lexical':'—'} {status.retrieval?.semantic?'+ Semantic':''}</dd><dt>{zh?'模型':'Model'}</dt><dd>{status.provider.model}</dd></dl><div className="coverage-table"><table><thead><tr><th>{zh?'类型':'Type'}</th><th>{zh?'导入':'Imported'}</th><th>{zh?'缺文':'Missing'}</th><th>{zh?'未解析':'Unresolved'}</th></tr></thead><tbody>{status.coverage?.map(c=><tr key={c.type}><td>{zh?(typeNames[c.type]||c.type):c.type}</td><td>{c.imported}/{c.discovered}</td><td>{c.missingText}</td><td>{c.unresolved}</td></tr>)}</tbody></table></div></>:<p>{statusError?'':t.loading}</p>}<button className="primary" onClick={refreshStatus}><ArrowClockwise size={19}/>{t.retry}</button></Dialog.Content></Dialog.Portal></Dialog.Root></div>
}
