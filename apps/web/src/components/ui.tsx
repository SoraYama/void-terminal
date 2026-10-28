import {Compass} from '@phosphor-icons/react';
export function Emblem(){return <span className="emblem" aria-hidden="true"><Compass size={42} weight="duotone"/></span>}
export function Ornament(){return <div className="ornament" aria-hidden="true"><span>✧</span></div>}
export function Scene({home=false}:{home?:boolean}){return <div className={home?'scene home-scene':'scene banner'} aria-hidden="true"><div className="official-logo"><img src="/assets/genshin-logo-official.png" alt=""/></div></div>}
