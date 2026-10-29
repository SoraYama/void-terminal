export function Emblem(){return <span className="emblem" aria-hidden="true">
 <svg viewBox="0 0 64 80" fill="none" focusable="false">
  <path d="M32 3C28 19 15 31 4 40C16 49 28 62 32 77C36 62 48 49 60 40C49 31 36 19 32 3Z" stroke="var(--gold)" strokeWidth="1.2"/>
  <path d="M12 34C13 23 19 18 25 20M39 20C45 18 51 23 52 34M12 46C14 57 21 62 27 60M37 60C43 62 50 57 52 46" stroke="var(--gold)" strokeWidth=".9" opacity=".6"/>
  <path d="M32 12C23 24 24 32 32 40C40 32 41 24 32 12ZM27 48C17 47 10 41 9 32C20 34 28 39 27 48ZM37 48C47 47 54 41 55 32C44 34 36 39 37 48Z" fill="currentColor"/>
  <path d="M32 66V39M32 55C27 46 21 40 14 36M32 55C37 46 43 40 50 36" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
  <path d="M32 19V34M15 37L23 44M49 37L41 44" stroke="var(--paper)" strokeWidth="1.1" strokeLinecap="round"/>
 </svg>
</span>}
export function Ornament(){return <div className="ornament" aria-hidden="true"><span>✧</span></div>}
export function Wordmark({label='void-terminal · 虚空终端'}:{label?:string}){return <span className="brand-wordmark" role="img" aria-label={label}/>}
export function Scene({home=false}:{home?:boolean}){return <div className={home?'scene home-scene':'scene banner'} aria-hidden="true"><div className="official-logo"><img src="/assets/genshin-logo-official.png" alt=""/></div></div>}
