import type {Locale} from '../lib/contracts';
import {branchContextNote} from '../lib/i18n';
export function BranchNote({metadata,locale}:{metadata?:Record<string,unknown>;locale:Locale}){
 const note=branchContextNote(metadata,locale);
 if(!note)return null;
 return <div className="branch-note"><strong>{note.label}</strong>{note.kind&&<span className="branch-kind">{note.kind}</span>}{note.targetId&&<span className="branch-target">{note.targetId}</span>}{note.condition&&<div className="branch-condition"><span>{note.conditionLabel}</span><code>{note.condition}</code></div>}{note.unknownLabel&&<span className="branch-unknown">{note.unknownLabel}</span>}</div>;
}
