import type {Locale} from '../lib/contracts';
import {contextWarning} from '../lib/i18n';
export function ContextWarning({metadata,locale}:{metadata?:Record<string,unknown>;locale:Locale}){
 const warning=contextWarning(metadata,locale);
 return warning?<p role="note" className="context-warning">{warning}</p>:null;
}
