import type {Locale} from './contracts';
export interface Preferences {theme:'light'|'dark'|'system';locale:Locale;sourceLanguage:Locale;mode:'byok'|'shared'}
export const defaults:Preferences={theme:'light',locale:'zh-CN',sourceLanguage:'zh-CN',mode:'byok'};
export function safePreferences(value:unknown):Preferences {const v=(value&&typeof value==='object'?value:{}) as Record<string,unknown>;return {theme:v.theme==='dark'||v.theme==='system'?v.theme:'light',locale:v.locale==='en'?'en':'zh-CN',sourceLanguage:v.sourceLanguage==='en'?'en':'zh-CN',mode:v.mode==='shared'?'shared':'byok'}}
export function readPreferences(){try{return safePreferences(JSON.parse(localStorage.getItem('void.preferences')||'{}'))}catch{return defaults}}
export function writePreferences(p:Preferences){localStorage.setItem('void.preferences',JSON.stringify(safePreferences(p)))}
