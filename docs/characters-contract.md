# Character archive canonical contract (schemaVersion 1)

`build_characters(root, supplementary=None, *, main_commit, supplement_commit)` returns `(records, coverage_report)`. One record per Avatar ID and language (`zh-CN`, `en`), sorted by numeric avatar ID then language. Identity is `avatar:<id>`; `avatarId` is an integer. Missing strings are empty, missing numbers are null, missing collections empty. Source records are not a promise of release or obtainability.

## Summary and detail

`character_summary(record)` returns exactly: `id`, `avatarId`, `language`, `name`, `title`, `description`, `rarity` (number|null), `element` (source element token|null), `elementName`, `weaponType`, `weaponName`, `region`, `state` (`source-record|internal|unclassified`), `icon` (Media). Detail adds `portrait` (Media), `birthday` (`{month:number|null,day:number|null}`), `affiliation`, `constellationName`, `cv` (map `zh-CN|en|ja|ko` to actor name), `sources` (Source[]), `documentIds` (string[]), `forms` (Form[]), `stories` (Story[]), `voices` (Voice[]), `ascensions` (Ascension[]), `coverage` (map field to status).

Default browsing includes only explicit `useType=AVATAR_FORMAL` source rows. Explicit abandoned/test rows or named internal flags are `internal`; absent or unknown useType is `unclassified`, without guessing from a name or ID range. `includeInternal=true` includes both additional classes. Formal source use is not proof of release or availability.

Media: `{identifier:string,url:string|null,provider:string|null,status:'verified'|'unverified'|'missing'|'unreachable',sha256?:string}`. Only verified URLs may render/play as media. This builder emits identifiers without guessed URLs; media verification enriches separately. Audio maps remain empty until exact verified mappings exist.

The media enrichment step adds `verification:'image-header'` and decoded `contentType/width/height` for images. Portrait identifiers join the pinned character image mapping by exact source avatar icon. Failed image URLs are not rendered. Audio media has `verification:'archive-index'`, `resource` (original voice path), and `archive:{url,entry:{name,offset,method,crc32,compressedSize,size}}`; `url` on the Media is a controlled same-origin character voice endpoint. Avatar ID, voice row ID and primary resource type must all match the supplementary mapping. The original-path FNV-1 hash must exist in the locale's ZIP at voice dataset revision `68950dc52d799876d1e64c1ab6c47955502e79a1`. This establishes indexed availability, not that every clip was individually decoded. Playback validates the selected bytes against directory size/CRC and the PCM WAV structure. Four concurrent loads, 16 MiB per clip and a 32 MiB memory cache bound work and memory. No user-supplied URL is fetched.

Source: `{repo,commit,path,locator,url}` from the existing normalization provenance contract. Nested source arrays point at exact table rows; TextMap dependencies are included in record sources. `documentIds` link only deterministic IDs of existing normalization tables.

## Form

`{id:string,name:string,element:string|null,elementName:string,levels:Level[],talents:Talent[],constellations:Constellation[],sources:Source[],coverage:object}`. `id` is the actual AvatarSkillDepot ID. Forms come only from `skillDepotId` and `candSkillDepotIds`; each form joins its own skills/talents. `name` is the localized element name when known, otherwise the character name. Element is the `costElemType` of that depot's energy skill (`Fire`, `Water`, `Wind`, `Electric`, `Ice`, `Rock`, `Grass`), never inferred from an opaque hash.

Level: `{level:number,ascension:number,stats:{[FIGHT_PROP_*]:number}}`. Only finite, source-backed properties appear. Base HP/ATK/DEF use base × matching ARITH_MULTI curve + that promotion's addProp. Named fixed critical/criticalHurt/chargeEfficiency fields add promotion values. Each phase includes its legal lower boundary (previous phase maximum) and every level through unlockMaxLevel, preserving pre/post ascension boundary duplicates. No equipment or conditional buffs.

The previous phase must be the immediate numeric predecessor, not the preceding available row. Phase zero starts at level 1; phase N>0 starts only at the explicit source cap of phase N−1. Missing predecessors omit that phase's unknown range. Any absent initial/intermediate phase makes form and character stat coverage `upstream-missing`, even if remaining ranges have complete values.

Talent: `{id:string,kind:'normal'|'skill'|'burst'|'passive',name,description,icon:Media,cooldown:number|null,energyCost:number|null,unlockAscension:number|null,levels:TalentLevel[],sources:Source[],coverage:object}`. Skill IDs stay numeric strings; passive IDs are `proud:<groupId>`. Depot skills retain order (first normal, remaining skill), followed by energySkill and inherent passives. No subSkill inference or opaque special-passive decoding.

TalentLevel: `{level:number,requiredAscension:number|null,parameters:(number|null)[],attributes:Attribute[],materials:MaterialCost[],mora:number|null,upgradeable:boolean,sources:Source[]}`. `upgradeable` is true for level 1 or a row with explicit real upgrade costs, not merely because a level exists. Attribute: `{template:string,text:string|null,status:'complete'|'unresolved'}`. Supported placeholders use 1-based `paramN` and explicit `F0/F1/F2/I`, `F0P/F1P/F2P`, and `P/P0/P1/P2` formats; P defaults to integer percent. Unknown, nonfinite, unrepresentable or missing parameters produce null text, never leaked template syntax. Full source parameters remain available (nonfinite values become null). Table levels beyond manual costs remain viewable but are not marked upgradeable. Source layout directives embedded in a parameter template remain unresolved rather than selecting an invented platform branch.

Constellation: `{id:string,order:number,name,description,icon:Media,sources:Source[]}`. Source depot talent order is authoritative; zero/missing IDs are omitted, never padded. No fabricated constellation geometry.

Each TalentLevel also has `unresolvedAttributeHashes:string[]`: source `paramDescList` hashes missing from that locale's TextMap. They mark parameter coverage unresolved and are never invented as visible attribute rows. This includes possibly unused upstream slots because their meaning cannot be proven from a missing text hash.

## Narrative and costs

Story: `{id:string,order:number,title:string,text:string,conditions:object,branches:Branch[],sources:Source[]}`. Branch: `{id:string,title:string,text:string,conditions:object}`. Primary story text stays primary; alternate `storyTitle2`/`storyContext2` remains a separate branch. `conditions` preserves named `openConds`, `finishConds` plus localized `tips`; unknown raw condition members are retained without guessed interpretation. Ordering follows source table order, with 1-based order exposed.

Voice: `{id:string,title:string,text:string,category:string,conditions:object,resource:string,audio:{[locale]:Media},sources:Source[]}`. `category` is the literal source type string (no unsupported semantic taxonomy); resource is literal `voiceFile`. Every row remains separate; no name-based audio linkage.

Story and Voice additionally contain `rawTitle`, `rawText` (exact localized TextMap values), `displayStatus:'complete'|'upstream-missing'|'unresolved'`, and `branches:Branch[]` (including on voices). Named alternate story texts remain distinct branches. Source `{M#...}` / `{F#...}` selectors expand into **both** labeled male/female Traveler branches, with `conditions:{travelerGender:'male'|'female'}` and localized labels in branch titles. Primary `text` is empty for a selector-bearing body; callers render all branches instead of selecting a reader identity. Each branch also retains rawTitle/rawText and displayStatus. Unknown directives preserve raw separately, suppress unresolved display text and propagate `unresolved` narrative coverage. A complete branch rendering counts as complete narrative coverage even when the intentionally unselected primary body is empty.

Ascension: `{ascension:number,maxLevel:number,materials:MaterialCost[],mora:number|null,sources:Source[]}`. MaterialCost: `{id:string,itemId:string,count:number}`, with `id` source numeric ID as string and `itemId='material:<id>'` for exact item routing. Costs are per phase, not full leveling experience costs. Talent costs use the same structure. No guessed currency ID; mora is separate.

## Coverage

Field statuses: `complete`, `upstream-missing`, `unresolved`, `not-applicable`, `unreachable`. `coverage_report` returns `{schemaVersion:1,ready:true,localizedRecords,uniqueCharacters,fields,missing,notes}`. `fields[field][status]` counts localized records, `missing[field][language]` lists IDs for noncomplete/nonapplicable fields. Coverage never equates source count or text presence with released characters or playable audio.
