import type {Locale,ModelProvider} from './contracts';
export interface Preferences {theme:'light'|'dark'|'system';locale:Locale;sourceLanguage:Locale;mode:'byok'|'shared';modelBaseUrl?:string;modelName?:string}
export const defaults:Preferences={theme:'light',locale:'zh-CN',sourceLanguage:'zh-CN',mode:'byok'};
export function safePreferences(value:unknown):Preferences {
 const v=(value&&typeof value==='object'?value:{}) as Record<string,unknown>;
 const result:Preferences={theme:v.theme==='dark'||v.theme==='system'?v.theme:'light',locale:v.locale==='en'?'en':'zh-CN',sourceLanguage:v.sourceLanguage==='en'?'en':'zh-CN',mode:v.mode==='shared'?'shared':'byok'};
 if(typeof v.modelBaseUrl==='string'&&v.modelBaseUrl.length<=2048){try{const u=new URL(v.modelBaseUrl.trim());if(u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash)result.modelBaseUrl=v.modelBaseUrl.trim().replace(/\/+$/,'')}catch{}}
 if(typeof v.modelName==='string'&&v.modelName.trim()&&v.modelName.length<=200&&!/[\s\x00-\x1f\x7f]/.test(v.modelName.trim()))result.modelName=v.modelName.trim();
 return result;
}
export function selectedProvider(p:Preferences):ModelProvider|undefined{
 if(p.mode!=='byok')return undefined;
 const baseUrl=p.modelBaseUrl?.trim(),model=p.modelName?.trim();
 return baseUrl||model?{...(baseUrl?{baseUrl}:{}),...(model?{model}:{})}:undefined;
}
export function readPreferences(){try{return safePreferences(JSON.parse(localStorage.getItem('void.preferences')||'{}'))}catch{return defaults}}
export function writePreferences(p:Preferences){localStorage.setItem('void.preferences',JSON.stringify(safePreferences(p)))}
