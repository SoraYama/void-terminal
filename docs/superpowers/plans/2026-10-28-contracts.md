# void-terminal frozen integration contracts

All JSON uses camelCase. Python internal method args may snake_case. ContentType = quest|dialogue|book|weapon|artifact|material|furniture|character|voice|enemy|food|achievement|tcg|other. Locale = zh-CN|en (additional source locales preserved but not default searchable).

## Normalized import record

Document: {id:string,title:string,type:ContentType,language:Locale,text:string,source:{repo:string,commit:string,path:string,locator:string,url:string},metadata:Record<string,unknown>,relations:Array<{kind:string,targetId:string,condition?:string}>}.

IDs are stable within source namespaces, never titles alone. dialogue metadata includes speaker and nextIds/conditions when known. Book metadata includes series/volume. GameVersion optional, never guessed.

Snapshot: {id:string,sourceRepo:string,sourceCommit:string,gameVersion:string|null,createdAt:string,label:string,state:'ready'|'building'|'failed'}.

CoverageRow: {type:string,discovered:number,imported:number,missingText:number,unresolved:number,notes:string[]}.

## Public source shape

Source: {id:string,documentId:string,title:string,type:ContentType,language:Locale,text:string,speaker?:string,path:string,locator:string,sourceUrl:string,snapshotId:string,gameVersion?:string,score?:number,metadata?:Record<string,unknown>}.

Citation = Source & {citation:number}; integers 1-based, stable for whole response, append-only source array.

DocumentSummary: {id:string,title:string,type:ContentType,language:Locale,excerpt:string,snapshotId:string,metadata?:Record<string,unknown>}.

## Knowledge HTTP (server-to-server)

- GET /v1/status -> {ready:boolean,activeSnapshot:Snapshot|null,documentCount:number,chunkCount:number,languages:string[],retrieval:{lexical:boolean,semantic:boolean,model:string|null},coverage:CoverageRow[]}.
- POST /v1/search body {query:string,language:Locale,types?:ContentType[],snapshotId?:string,limit?:number} -> {sources:Source[],snapshotId:string|null,mode:'lexical'|'hybrid',total:number}.
- GET /v1/documents?q=&type=&language=&page=1&pageSize=24&snapshotId= -> {items:DocumentSummary[],total:number,page:number,pageSize:number,snapshotId:string|null}.
- GET /v1/documents/{id}?snapshotId= -> {document:Document, sources:Source[], snapshotId:string}.
- GET /v1/sources/{id}?snapshotId= -> {source:Source,context:Source[],related:DocumentSummary[]}.
- POST /v1/budget/reserve {requestId:string,identity:string,tokens:number} -> {allowed:boolean,reservationId:string,remaining:number}; daily cap configured knowledge env SHARED_DAILY_TOKEN_BUDGET, reserve atomically, deny if disabled/cap. Server-internal token required in production.
- POST /v1/budget/settle {reservationId:string,usedTokens:number|null} -> {settled:boolean}; null keeps worst-case reservation, repeat idempotent.
- Error {error:{code:string,message:string}}, correct HTTP 400/401/404/409/429/503; never raw exception/keys. Unavailable explicit snapshot must fail, never fall back to active.
- Knowledge internal X-Knowledge-Token set by web/ingest from env when configured; localhost dev can omit.

## Browser API

- GET /api/status -> knowledge status fields plus provider:{model:string,sharedEnabled:boolean,byok:boolean}. Unavailable knowledge returns ready:false and an explicit error status field; do not fake corpus.
- GET /api/library same parameters/results as /v1/documents.
- GET /api/documents/{id} same as knowledge document endpoint.
- GET /api/sources/{id} same as knowledge source endpoint.
- POST /api/models/test header X-Model-Api-Key (BYOK), body {mode:'byok'|'shared'} -> {ok:boolean,model:string,message:string}; no key echoed.
- POST /api/chat header X-Model-Api-Key only for BYOK; body {messages:Array<{role:'user'|'assistant',content:string}>,language:Locale,answerLanguage?:Locale,mode:'byok'|'shared',depth:'standard'|'deep',snapshotId?:string,types?:ContentType[]}. `language` restricts source retrieval; optional `answerLanguage` follows UI locale and defaults to `language` for older clients. Original quotes retain their source language; model translations must be identified as translations, not official text.

SSE: event: <name> newline data: <JSON> newline newline. status={stage:'searching'|'reading'|'writing',message?:string}; sources={sources:Citation[],snapshotId:string}; text_delta={text:string}; done={snapshotId:string,usage?:{inputTokens:number,outputTokens:number},finishReason:string,citationWarnings?:string[]}; error={code:string,message:string,retryable:boolean}. Use UTF-8 TextDecoder streaming; event sources is cumulative append-only array. Event done/error terminates normal response. Fetch abort cancels upstream and downstream work.

Limits: at most 24 messages, each at most 12000 chars and total 48000 chars; last message must user, query nonempty; first retrieval limit 10; citation context total bounded by web agent. Tool rounds <=4, max output token settings bounded at deployment. Standard/deep defaults 4096/8192.

## Environment

Web: KNOWLEDGE_URL=http://127.0.0.1:8000; KNOWLEDGE_API_TOKEN; DEEPSEEK_BASE_URL=https://api.deepseek.com; DEEPSEEK_MODEL=deepseek-flash; DEEPSEEK_API_KEY (shared only); SHARED_MODE_ENABLED=false; SESSION_SECRET (production required for shared); TRUST_PROXY=false.

Knowledge: DATABASE_URL=sqlite:///../../data/catalog.sqlite (local default resolved from repo cwd/config); production postgresql://…; KNOWLEDGE_API_TOKEN; SHARED_DAILY_TOKEN_BUDGET=0; EMBEDDING_MODEL=intfloat/multilingual-e5-small; EMBEDDING_ENABLED=false by default until weights/index explicitly built; source/model cache locations under ignored data/ and models/.

## Ownership and coupling

Root owns apps/web/package.json, configs, src/lib/contracts.ts, global plan/ledger. UI consumes APIs and shared types; server implements them. Ingest produces plain normalized dictionaries; Store ingests them. Knowledge owner must expose import_snapshot signature early so ingestion can wire CLI. Runtime errors from missing services are visible to user, never replaced with fictional data.
