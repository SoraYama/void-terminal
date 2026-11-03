import {useEffect} from 'react';

/** Capture native scroll events, including scroll surfaces rendered in portals. */
export function useScrollbarVisibility(){
 useEffect(()=>{
  const timers=new Map<HTMLElement,ReturnType<typeof setTimeout>>();
  function onScroll(event:Event){
   const target=event.target===document?document.scrollingElement:event.target;
   if(!(target instanceof HTMLElement))return;
   if(target.scrollHeight<=target.clientHeight&&target.scrollWidth<=target.clientWidth)return;
   target.dataset.scrollFade='true';
   target.dataset.scrolling='true';
   clearTimeout(timers.get(target));
   timers.set(target,setTimeout(()=>{
    delete target.dataset.scrolling;
    timers.delete(target);
   },700));
  }
  document.addEventListener('scroll',onScroll,{capture:true,passive:true});
  return ()=>{
   document.removeEventListener('scroll',onScroll,true);
   for(const [target,timer] of timers){clearTimeout(timer);delete target.dataset.scrolling;delete target.dataset.scrollFade}
  };
 },[]);
}
