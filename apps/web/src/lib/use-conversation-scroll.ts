import {useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react';

/** Follow the answer, not footnotes. Scroll input always wins over generation. */
export function useConversationScroll(revision:unknown,stage:string,active:boolean,conversationId?:string){
 const chatScroll=useRef<HTMLDivElement>(null),answerTail=useRef<HTMLDivElement>(null),autoScroll=useRef(true);
 const lastScrollTop=useRef(0);
 const [awayFromBottom,setAwayFromBottom]=useState(false),[compact,setCompact]=useState(false);
 const updateCompact=useCallback(()=>{
  const viewport=chatScroll.current;if(!viewport)return;
  const cover=viewport.querySelector('.conversation-cover');
  const header=viewport.parentElement?.querySelector('.conversation-header');
  setCompact(Boolean(cover&&header&&cover.getBoundingClientRect().bottom<=viewport.getBoundingClientRect().top+header.clientHeight));
 },[]);
 const updatePosition=useCallback(()=>{
  updateCompact();
  const viewport=chatScroll.current,tail=answerTail.current;
  if(!viewport||!tail){setAwayFromBottom(false);return}
  // Pausing follow is independent of whether there is an answer below to jump to.
  const remaining=viewport.scrollHeight-viewport.clientHeight-viewport.scrollTop;
  setAwayFromBottom(remaining>2&&tail.getBoundingClientRect().bottom>viewport.getBoundingClientRect().bottom+2);
 },[updateCompact]);
 const followAnswer=useCallback((reposition=false)=>{
  const viewport=chatScroll.current,tail=answerTail.current;if(!viewport||!tail)return;
  const distance=tail.getBoundingClientRect().bottom-viewport.getBoundingClientRect().bottom+36;
  if(distance>0||reposition)viewport.scrollTop+=distance;
  lastScrollTop.current=viewport.scrollTop;
  updatePosition();
 },[updatePosition]);
 const pauseFollow=useCallback(()=>{autoScroll.current=false;updatePosition()},[updatePosition]);
 const resumeFollow=useCallback(()=>{autoScroll.current=true;followAnswer(true)},[followAnswer]);
 const onScroll=useCallback(()=>{
  const viewport=chatScroll.current,tail=answerTail.current;if(!viewport||!tail)return;
  updatePosition();
  const distance=tail.getBoundingClientRect().bottom-viewport.getBoundingClientRect().bottom;
  const nearAnswer=Math.abs(distance)<90;
  const movingUp=viewport.scrollTop<lastScrollTop.current-1;
  const movingDown=viewport.scrollTop>lastScrollTop.current+1;
  if(movingUp||!nearAnswer)autoScroll.current=false;
  else if(movingDown)autoScroll.current=true;
  lastScrollTop.current=viewport.scrollTop;
 },[updatePosition]);
 useLayoutEffect(()=>{if(active){if(autoScroll.current)followAnswer();else updatePosition()}},[revision,stage,active,followAnswer,updatePosition]);
 useEffect(()=>{
  if(!active)return;
  const viewport=chatScroll.current;if(!viewport)return;
  const observer=new ResizeObserver(()=>{if(autoScroll.current)followAnswer();else updatePosition()});
  observer.observe(viewport);
  const messages=viewport.querySelector('.conversation-messages');if(messages)observer.observe(messages);
  return()=>observer.disconnect();
 },[active,followAnswer,updatePosition]);
 useLayoutEffect(()=>{autoScroll.current=true;lastScrollTop.current=0;setAwayFromBottom(false);if(active)followAnswer(true)},[conversationId,active,followAnswer]);
 return {chatScroll,answerTail,autoScroll,awayFromBottom,compact,onScroll,pauseFollow,resumeFollow};
}
