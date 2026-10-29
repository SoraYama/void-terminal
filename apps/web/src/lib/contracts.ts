export type Locale = 'zh-CN' | 'en';
export type ContentType = 'quest'|'dialogue'|'book'|'weapon'|'artifact'|'material'|'furniture'|'character'|'voice'|'enemy'|'food'|'achievement'|'tcg'|'other';
export const CONTENT_TYPES: ContentType[] = ['quest','dialogue','book','weapon','artifact','material','furniture','character','voice','enemy','food','achievement','tcg','other'];
export interface Provenance { repo:string; commit:string; path:string; locator:string; url:string }
export interface Document { id:string; title:string; type:ContentType; language:Locale; text:string; source:Provenance; metadata:Record<string,unknown>; relations:{kind:string;targetId:string;condition?:string}[] }
export interface Snapshot {id:string;sourceRepo:string;sourceCommit:string;gameVersion:string|null;createdAt:string;label:string;state:'ready'|'building'|'failed'}
export interface CoverageRow {type:string;discovered:number;imported:number;missingText:number;unresolved:number;notes:string[]}
export interface Source {id:string;documentId:string;title:string;type:ContentType;language:Locale;text:string;speaker?:string;path:string;locator:string;sourceUrl:string;snapshotId:string;gameVersion?:string;score?:number;metadata?:Record<string,unknown>}
export interface Citation extends Source {citation:number}
export interface DocumentSummary {id:string;title:string;type:ContentType;language:Locale;excerpt:string;snapshotId:string;metadata?:Record<string,unknown>}
export interface KnowledgeStatus {ready:boolean;activeSnapshot:Snapshot|null;documentCount:number;chunkCount:number;languages:string[];retrieval:{lexical:boolean;semantic:boolean;model:string|null};coverage:CoverageRow[]}
export interface AppStatus extends Partial<KnowledgeStatus> {ready:boolean;provider:{model:string;sharedEnabled:boolean;byok:boolean};error?:{code:string;message:string}}
export interface SearchResult {sources:Source[];snapshotId:string|null;mode:'lexical'|'hybrid';total:number}
export interface LibraryResult {items:DocumentSummary[];total:number;page:number;pageSize:number;snapshotId:string|null}
export interface DocumentResult {document:Document;sources:Source[];snapshotId:string}
export interface SourceResult {source:Source;context:Source[];related:DocumentSummary[]}
export interface ModelProvider {baseUrl?:string;model?:string}
export interface ChatRequest {messages:{role:'user'|'assistant';content:string}[];language:Locale;answerLanguage?:Locale;mode:'byok'|'shared';depth:'standard'|'deep';snapshotId?:string;types?:ContentType[];provider?:ModelProvider}
export interface Usage {inputTokens:number;outputTokens:number}
export type ChatEvent =
 | {event:'status';data:{stage:'searching'|'reading'|'writing';message?:string}}
 | {event:'sources';data:{sources:Citation[];snapshotId:string}}
 | {event:'text_delta';data:{text:string}}
 | {event:'done';data:{snapshotId:string;usage?:Usage;finishReason:string;citationWarnings?:string[]}}
 | {event:'error';data:{code:string;message:string;retryable:boolean}};
