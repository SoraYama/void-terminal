import {motion,useReducedMotion} from 'motion/react';
import {Download} from '@phosphor-icons/react';
import {Scene} from './ui';

type Props={title:string;exportLabel:string;onExport:()=>void};

export function ConversationCover({title,exportLabel,onExport,compact}:Props&{compact:boolean}){
 return <div className="conversation-cover" inert={compact} aria-hidden={compact}>
  <Scene/>
  <div className="workspace-heading">
   <h1>{title}</h1>
   <button className="icon-button" aria-label={exportLabel} onClick={onExport}><Download size={21}/></button>
  </div>
 </div>;
}

export function ConversationHeader({title,exportLabel,onExport,compact}:Props&{compact:boolean}){
 const reduced=useReducedMotion();
 return <motion.header className="conversation-header" data-compact={compact}
  aria-hidden={!compact} inert={!compact}
  initial={false} animate={{opacity:compact?1:0,y:reduced?0:compact?0:-12}}
  transition={{duration:reduced?0:.24,ease:[.16,1,.3,1]}}
  style={{pointerEvents:compact?'auto':'none'}}>
  <Scene/>
  <h2 title={title}>{title}</h2>
  <button className="icon-button" aria-label={exportLabel} onClick={onExport}><Download size={20}/></button>
 </motion.header>;
}
