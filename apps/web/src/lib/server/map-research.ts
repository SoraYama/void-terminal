import 'server-only';
import {z} from 'zod';
import type {ChatEvent,ChatRequest} from '../contracts';
import {MAX_MAP_CARDS,mapCardSchema,type MapCard} from '../map-cards';
import {getMapCatalog,loadMapSnapshot,MapDataError,queryMapResources,searchMapRegions,type MapSnapshot} from './maps';

const boundedName=z.string().trim().min(1).max(200);
const regionArgs=z.object({query:boundedName,country:boundedName.optional()}).strict();
const queryArgs=z.object({region:boundedName,resource:boundedName,country:boundedName.optional()}).strict();
const mapIntent=(text:string)=>/神瞳|宝箱|摩拉|地灵龛|地图|标点|采集|突破材料|地方特产|\b(?:\w*oculus|\w*oculi|chests?|mora|map|farm|collect|ascension materials?)\b/iu.test(text);
const followup=(text:string)=>text.length<=120&&/那|呢|这些|这个|附近|还有|继续|how about|what about|there|nearby|show|zoom/i.test(text);
const mixedIntent=(text:string)=>/剧情|故事|任务原文|传说|背景|由来|lore|story|quest dialogue|history of/i.test(text);
const indefiniteScope=(text:string)=>/附近|周边|周围|半径|\b(?:nearby|around|radius)\b/i.test(text);

export const MAP_RESEARCH_POLICY=`
Map evidence is separate from corpus evidence. Use search_map_regions and query_map_resources for resource counts and locations; never estimate counts from prose, visual density, memory, or earlier assistant replies.
The server, not the model, emits interactive map cards. Do not output card JSON, HTML, coordinates or special Markdown to render them. A returned cardId means the map is already attached. Explain its region, resource and count plainly and cite the provided source URL (not a numbered corpus citation).
Map snapshots and corpus snapshots have independent IDs. The map gameVersion/sourceTime is a data snapshot, not proof of today's game release. Use each returned region exactly; parent areas and neighboring areas are not interchangeable. When names are ambiguous, use returned candidates or ask for the intended region/resource.
An error means the query is unsupported or unresolved, never zero. A count with requires-review is provisional: state boundary/height/overlap limitations beside it. projected-snapshot uses calibrated map positions, not fully verified 3D points. crosschecked verifies the included points against the supplied public 3D crosschecks, not exhaustive completion of all live game spawns. truncated limits displayed markers, not count. Nearby markers are excluded from count. Do not silently add them.
If multiple types such as all chests/materials are requested, discover their exact types first. A card for one type is not a total for the category. At most four distinct resource maps may be returned per answer; ask to narrow additional requests. Never change a pinned map snapshot or invent missing geofences.`;

/** One immutable dataset per request; cards carry only server-computed geometry. */
export async function prepareMapResearch(input:ChatRequest,signal:AbortSignal,emit:(event:ChatEvent)=>void){
 const current=input.messages.at(-1)!.content;
 const recent=input.messages.slice(0,-1).filter(m=>m.role==='user').slice(-6).reverse();
 const inherits=!!input.mapSnapshotId&&followup(current)&&recent.length>0;
 let requested=mapIntent(current)||inherits;
 let active=requested&&!mixedIntent(current);
 const possibleResourceQuery=/多少|几个|哪里|在哪|位置|分布|\b(?:how many|where|locations?)\b/iu.test(current);
 let snapshot:MapSnapshot|undefined;
 let pending:Promise<MapSnapshot>|undefined;
 const cards:MapCard[]=[];
 const results:unknown[]=[];
 const load=async()=>{
  signal.throwIfAborted();
  pending??=loadMapSnapshot(input.mapSnapshotId,signal);
  snapshot=await pending;signal.throwIfAborted();return snapshot;
 };
 const remember=(result:unknown)=>{results.push(result);if(results.length>8)results.shift();return JSON.stringify(result)};
 const failure=(error:unknown)=>{
  signal.throwIfAborted();
  return remember(error instanceof MapDataError?{error:error.code,message:error.message}:{error:'MAP_UNAVAILABLE',message:'Map data is currently unavailable; no count can be established.'});
 };
 const query=async(args:z.infer<typeof queryArgs>)=>{
  const result=queryMapResources(await load(),args);
  if(!('card' in result))return remember(result);
  const card=mapCardSchema.parse(result.card);
  if(card.snapshotId!==snapshot!.id)return remember({error:'MAP_SNAPSHOT_MISMATCH',message:'The map result does not belong to this conversation snapshot.'});
  const existing=cards.findIndex(c=>c.id===card.id);
  if(existing<0&&cards.length>=MAX_MAP_CARDS)return remember({error:'MAP_CARD_LIMIT',message:'Narrow the query to at most four maps per answer.'});
  if(existing<0)cards.push(card);else cards[existing]=card;
  emit({event:'maps',data:{mapSnapshotId:snapshot!.id,maps:[...cards]}});
  return remember({cardId:card.id,mapSnapshotId:card.snapshotId,gameVersion:card.gameVersion,sourceTime:card.sourceTime,region:card.region,resource:card.resource,count:card.count,status:card.status,review:card.review,truncated:card.truncated,displayed:card.markers.filter(p=>p.role==='included').length,markerIds:card.markers.filter(p=>p.role==='included').slice(0,20).map(p=>p.id),sources:card.sources});
 };
 const execute=async(name:string,args:Record<string,unknown>):Promise<string>=>{
  try{
   signal.throwIfAborted();
   if(name==='search_map_regions'){
    const parsed=regionArgs.safeParse(args);if(!parsed.success)return JSON.stringify({error:'INVALID_MAP_ARGUMENTS'});
    const data=await load();return remember({mapSnapshotId:data.id,regions:searchMapRegions(data,parsed.data.query,parsed.data.country).slice(0,20)});
   }
   if(name==='query_map_resources'){
    const parsed=queryArgs.safeParse(args);if(!parsed.success)return JSON.stringify({error:'INVALID_MAP_ARGUMENTS'});
    return await query(parsed.data);
   }
   return JSON.stringify({error:'TOOL_NOT_ALLOWED'});
  }catch(error){return failure(error)}
 };
 // Catalog recognition also covers requests like “标出维摩庄的帕蒂沙兰”,
 // without requiring the user to include a special map keyword.
 {
  try{
   const catalog=getMapCatalog(await load());
   // Prefer an explicit referent in the latest question; older USER text only
   // supplies a missing name and is never used as evidence for a count.
   const mentions=<T extends {name:string;nameEn?:string}>(items:T[],text:string)=>items.filter(item=>[item.name,item.nameEn].some(name=>name&&text.toLocaleLowerCase().includes(name.toLocaleLowerCase()))).sort((a,b)=>b.name.length-a.name.length);
   const countries=[...new Set(catalog.regions.map(r=>r.country).filter(Boolean))].filter(country=>current.includes(country));
   const availableRegions=countries.length===1?catalog.regions.filter(r=>r.country===countries[0]):catalog.regions;
   const regions=mentions(availableRegions,current),resources=mentions(catalog.resources,current);
   requested ||= !mixedIntent(current)&&resources.length>0&&(regions.length>0||possibleResourceQuery);
   active=requested&&!mixedIntent(current);
   const priorRegions=inherits?recent.map(m=>mentions(availableRegions,m.content)).find(hits=>hits.length):undefined;
   const priorResources=inherits?recent.map(m=>mentions(catalog.resources,m.content)).find(hits=>hits.length):undefined;
   const resolvedRegions=regions.length?regions:priorRegions??[];
   const resolvedResources=resources.length?resources:priorResources??[];
   const region=resolvedRegions[0],resource=resolvedResources[0];
   // Multiple requested regions/types must be resolved by the model, rather
   // than silently selecting only the first one from the question.
   const distinctRegions=resolvedRegions.filter(r=>!resolvedRegions.some(other=>other.name.length>r.name.length&&other.name.includes(r.name)));
   const knownFollowup=regions.length>0||resources.length>0||/那里|这里|该区域|这个地区|这个区域|同一|继续|there|this area|same region/i.test(current);
   if(!requested){/* A spatial-sounding lore question still uses corpus retrieval. */}
   else if(indefiniteScope(current))remember({error:'SCOPE_REQUIRED',message:'The requested nearby/radius scope is undefined. Ask for a named game region; do not silently substitute its boundary.',regionCandidates:regions.slice(0,12)});
   else if(region&&resource&&distinctRegions.length===1&&resolvedResources.length===1&&(!inherits||knownFollowup))await query({region:String(region.id),resource:resource.id});
   else remember({mapSnapshotId:snapshot!.id,regionCandidates:regions.slice(0,12),resourceCandidates:resources.slice(0,12),note:'Resolve exact region and resource with map tools. No count is established yet.'});
  }catch(error){signal.throwIfAborted();if(requested)failure(error)}
 }
 return {
  active,cards,get snapshotId(){return results.length?snapshot?.id:undefined},context:()=>JSON.stringify(results),execute,
  tools:[
   {name:'search_map_regions',description:'Find game regions by Chinese/English name, optionally restricted to country. Returns IDs, parent, scene and boundary/calibration availability. Does not establish a resource count.',parameters:{type:'object',properties:{query:{type:'string',maxLength:200},country:{type:'string',maxLength:200}},required:['query'],additionalProperties:false}},
   {name:'query_map_resources',description:'Count and map a specific resource inside an exact game region using the pinned map dataset. Accept Chinese/English names or discovered IDs. Ambiguous resource/category names return candidates; unavailable boundaries return an error, not zero. Creates an interactive map card automatically.',parameters:{type:'object',properties:{region:{type:'string',maxLength:200},resource:{type:'string',maxLength:200},country:{type:'string',maxLength:200}},required:['region','resource'],additionalProperties:false}},
  ],
 };
}
