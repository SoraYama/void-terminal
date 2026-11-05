import {invalid} from './validation';
import {elements,characterWeapons,audioLocales} from '../characters';
export function characterIdentity(id:string){if(!/^avatar:[0-9]{1,16}$/.test(id))throw invalid();return encodeURIComponent(id)}
export function voiceIdentity(id:string){if(!/^[A-Za-z0-9_-]{1,100}$/.test(id))throw invalid();return encodeURIComponent(id)}
export function characterQuery(request:Request,mode:'list'|'detail'|'coverage'|'voice'='list'){
 const p=new URL(request.url).searchParams,allowed=mode==='list'?['q','language','element','weaponType','rarity','region','includeInternal','sort','page','pageSize','snapshotId']:mode==='coverage'?['snapshotId']:mode==='voice'?['language','audioLanguage','snapshotId']:['language','snapshotId'];
 for(const key of [...p.keys()]){if(!allowed.includes(key)||p.getAll(key).length!==1)throw invalid();const value=p.get(key)!.trim();if(!value){p.delete(key);continue}if(value.length>(key==='q'?2000:key==='region'?100:200)||/[\x00-\x1f\x7f]/.test(value)||key==='snapshotId'&&!/^[A-Za-z0-9_-]+$/.test(value))throw invalid();p.set(key,value)}
 for(const [key,values] of [['language',['zh-CN','en']],['audioLanguage',audioLocales],['element',elements],['weaponType',characterWeapons],['sort',['rarity','name']],['includeInternal',['true','false']]] as const)if(p.has(key)&&!(values as readonly string[]).includes(p.get(key)!))throw invalid();
 for(const [key,max] of [['rarity',5],['page',100000],['pageSize',100]] as const)if(p.has(key)&&(!/^\d+$/.test(p.get(key)!)||Number(p.get(key))<1||Number(p.get(key))>max))throw invalid();
 if(mode==='voice'&&(!p.has('snapshotId')||!p.has('audioLanguage')))throw invalid();return p.toString();
}
