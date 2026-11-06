export interface DeviceSignals {
 browser:'chromium'|'firefox'|'safari'|'other';
 system:'android'|'ios'|'windows'|'macos'|'linux'|'other';
 locale:string;
 timezone:number;
 screen:'small'|'medium'|'large'|'unknown';
}

/** Collect coarse buckets only during an explicitly hosted account action. */
export function collectDeviceSignals(hosted:boolean):DeviceSignals|undefined {
 if(!hosted||typeof window==='undefined')return;
 const {navigator,screen}=window;
 const agent=navigator.userAgent.toLowerCase();
 const browser=/chrom(?:e|ium)|crios|edg|opr/.test(agent)?'chromium':
  /firefox|fxios/.test(agent)?'firefox':agent.includes('safari')?'safari':'other';
 const system=agent.includes('android')?'android':/iphone|ipad|ipod/.test(agent)?'ios':
  agent.includes('windows')?'windows':agent.includes('mac os')?'macos':agent.includes('linux')?'linux':'other';
 const language=navigator.language?.toLowerCase().split(/[-_]/)[0]||'und';
 const locale=/^[a-z]{2,3}$/.test(language)?language:'und';
 const timezone=Math.max(-12,Math.min(14,Math.round(-new Date().getTimezoneOffset()/60)));
 const width=Math.min(screen?.width??0,screen?.height??0);
 return {browser,system,locale,timezone,screen:!width?'unknown':width<600?'small':width<900?'medium':'large'};
}
