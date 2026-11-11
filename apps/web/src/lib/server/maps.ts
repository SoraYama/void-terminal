import 'server-only';
import {z} from 'zod';
import {mapCardSchema,MAX_MAP_MARKERS,type MapCard,type MapMarker,type MapQueryInput,type MapQueryResult,type MapRegionHit} from '../map-cards';
import {snapshotData,type MapArea,type MapSnapshot} from './map-data';
import {distanceToIntersectionBoundary,intersectionBoundary,mercator,polygonMatch,projectPoint,worldPoint,type XY} from './map-spatial';
export {MapDataError,loadMapSnapshot,type MapSnapshot} from './map-data';

const countries:Record<number,[string,string]>={1:['蒙德','Mondstadt'],2:['璃月','Liyue'],3:['稻妻','Inazuma'],4:['须弥','Sumeru'],5:['枫丹','Fontaine'],6:['纳塔','Natlan'],7:['至冬','Snezhnaya']};
const normalized=(text:string) => text.normalize('NFKC').trim().toLocaleLowerCase('en');
function countryMatches(area:MapArea,country?:string):boolean {return !country || !!countries[area.cityId??0]?.some(name=>normalized(name)===normalized(country));}
function parentArea(areas:MapArea[],area:MapArea):MapArea|undefined {return areas.find(candidate=>candidate.sceneId===area.sceneId && candidate.areaId1===area.areaId1 && candidate.areaId2==null);}
function regionHit(snapshot:MapSnapshot,area:MapArea):MapRegionHit {
  const {bundle}=snapshotData(snapshot),model=bundle.models[String(area.cityId)],parent=parentArea(bundle.areas,area),country=countries[area.cityId??0];
  return {id:area.id,name:area.name||String(area.id),...(area.nameEn?{nameEn:area.nameEn}:{}),country:country?.[0]??'',...(country?{countryEn:country[1]}:{}),parentName:parent?.name??'',...(parent?.nameEn?{parentNameEn:parent.nameEn}:{}),sceneId:area.sceneId,hasBoundary:area.polygons.length>0,calibrated:area.sceneId===3 && !!model?.matchedAreaIds.includes(area.areaId1)};
}
export function getMapCatalog(snapshot:MapSnapshot):{regions:MapRegionHit[];resources:{id:string;name:string;nameEn?:string}[]} {
  const {bundle}=snapshotData(snapshot);
  return {regions:bundle.areas.map(a=>regionHit(snapshot,a)),resources:Object.entries(bundle.types).map(([id,name])=>({id,name:name||id,...(bundle.typesEn?.[id]?{nameEn:bundle.typesEn[id]}:{})}))};
}
export function searchMapRegions(snapshot:MapSnapshot,query:string,country?:string):MapRegionHit[] {
  if(typeof query!=='string' || query.length>200 || country && country.length>100) return [];
  const term=normalized(query),{bundle}=snapshotData(snapshot);
  return bundle.areas.filter(area=>countryMatches(area,country) && (String(area.id)===term || normalized(area.name).includes(term) || area.nameEn && normalized(area.nameEn).includes(term)))
    .sort((a,b)=>Number(String(b.id)===term || normalized(b.name)===term || normalized(b.nameEn??'')===term)-Number(String(a.id)===term || normalized(a.name)===term || normalized(a.nameEn??'')===term) || a.id-b.id)
    .slice(0,100).map(area=>regionHit(snapshot,area));
}
const inputSchema=z.object({region:z.string().trim().min(1).max(200),resource:z.string().trim().min(1).max(200),country:z.string().trim().min(1).max(100).optional()}).strict();
export function queryMapResources(snapshot:MapSnapshot,input:MapQueryInput):MapQueryResult {
  const parsed=inputSchema.safeParse(input);
  if(!parsed.success) return {error:'INVALID_MAP_QUERY',message:'Name one region and one resource using their catalog names or IDs.'};
  const {region,resource,country}=parsed.data,{bundle,manifest}=snapshotData(snapshot);
  if(/附近|周边|周围|半径|全部地图|全世界|\b(?:nearby|around|radius|everywhere|all world)\b/i.test(region)) return {error:'SCOPE_REQUIRED',message:'Nearby or radius queries require a defined boundary. Select a named catalog region.'};
  const term=normalized(region);
  const areas=bundle.areas.filter(a=>countryMatches(a,country) && (String(a.id)===term || normalized(a.name)===term || !!a.nameEn && normalized(a.nameEn)===term));
  if(areas.length!==1){
    const candidates=areas.length?areas:searchMapRegions(snapshot,region,country);
    return {error:areas.length?'REGION_AMBIGUOUS':'REGION_NOT_FOUND',message:areas.length?'This region name is ambiguous; query a candidate ID.':'No exact region matches this name and country. Choose a catalog region.',...(candidates.length?{candidates:candidates.map(a=>({id:a.id,name:a.name})).slice(0,100)}:{})};
  }
  const resources=Object.entries(bundle.types).filter(([id,name])=>normalized(id)===normalized(resource)||normalized(name)===normalized(resource)||!!bundle.typesEn?.[id]&&normalized(bundle.typesEn[id])===normalized(resource));
  if(resources.length!==1){
    const needle=normalized(resource);
    const candidates=resources.length?resources:Object.entries(bundle.types).filter(([id,name])=>needle.length>=2 && [name,bundle.typesEn?.[id]].some(label=>label && (normalized(label).includes(needle)||needle.includes(normalized(label)))));
    return {error:resources.length?'RESOURCE_AMBIGUOUS':'RESOURCE_NOT_FOUND',message:resources.length?'This resource name is ambiguous; query a resource ID.':'No exact resource matches this name or ID. Select one resource type from the candidates.',...(candidates.length?{candidates:candidates.slice(0,25).map(([id,name])=>({id,name:name||id}))}:{})};
  }
  const area=areas[0],[resourceId,resourceName]=resources[0],model=bundle.models[String(area.cityId)];
  if(!area.polygons.length) return {error:'MISSING_BOUNDARY',message:'This region has no verified boundary in the selected snapshot.'};
  if(area.sceneId!==3) return {error:'UNSUPPORTED_SCENE',message:'This independent scene has no verified map coordinate calibration.'};
  if(!model || !model.matchedAreaIds.includes(area.areaId1) || Math.abs(model.matrix[0][0]*model.matrix[1][1]-model.matrix[0][1]*model.matrix[1][0])<1e-14) return {error:'UNCALIBRATED_REGION',message:'This region has no verified coordinate anchors.'};
  const parent=parentArea(bundle.areas,area);
  if(!parent?.polygons.length) return {error:'MISSING_PARENT_BOUNDARY',message:'The parent region has no verified boundary; hierarchy cannot be checked.'};
  const siblings=bundle.areas.filter(a=>a.sceneId===area.sceneId && a.areaId1===area.areaId1 && a.areaId2!=null && a.id!==area.id);
  const boundary=intersectionBoundary(area.polygons.map(p=>p.ring),area.areaId2!=null?parent.polygons.map(p=>p.ring):undefined);
  const included:MapMarker[]=[],reviewPoints:{marker:MapMarker;distance:number}[]=[],nearby:{marker:MapMarker;distance:number}[]=[];
  const review={boundary:0,unknownHeight:0,overlap:0};
  for(const point of bundle.points){
    if(point.mid!==2 || point.type!==resourceId) continue;
    const cross=bundle.crosschecks[String(point.id)],height=cross?.xyz[1]??null;
    const xz:XY=cross?[cross.xyz[0],cross.xyz[2]]:worldPoint(point.lng,point.lat,model.matrix);
    const distance=distanceToIntersectionBoundary(xz,boundary);
    const parentHit=parent.polygons.some(p=>polygonMatch(xz,p));
    const hit=parentHit && area.polygons.some(p=>polygonMatch(xz,p,height));
    const isReview=distance<=model.uncertaintyWorld && !cross;
    if(isReview) review.boundary++;
    if(hit && height===null && area.areaId2!=null) review.unknownHeight++;
    if(hit && area.areaId2!=null && siblings.some(a=>a.polygons.some(p=>polygonMatch(xz,p,height)))) review.overlap++;
    if(!hit && !isReview && distance>100) continue;
    const [x,y]=cross?projectPoint(xz,model.matrix):[point.lng,-mercator(point.lat)];
    const floor=point.meta.split(';').find(v=>v.startsWith('l='))?.split('|')[2];
    const marker:MapMarker={id:point.id,x,y,role:hit?'included':isReview?'review':'nearby',coordinateEvidence:cross?'crosschecked-3d':'calibrated-projection',height,...(floor?{floor:floor.slice(0,80)}:{})};
    if(hit) included.push(marker);
    else if(isReview) reviewPoints.push({marker,distance});
    else nearby.push({marker,distance});
  }
  included.sort((a,b)=>a.id-b.id);
  const byDistance=(a:{distance:number;marker:MapMarker},b:{distance:number;marker:MapMarker})=>a.distance-b.distance || a.marker.id-b.marker.id;
  const markers=[...included.slice(0,MAX_MAP_MARKERS),...reviewPoints.sort(byDistance).map(p=>p.marker)].slice(0,MAX_MAP_MARKERS);
  markers.push(...nearby.sort(byDistance).slice(0,Math.min(12,MAX_MAP_MARKERS-markers.length)).map(p=>p.marker));
  const polygons=area.polygons.map(p=>p.ring.map(xz=>projectPoint(xz,model.matrix)));
  const parentPolygons=area.areaId2!=null?parent.polygons.map(p=>p.ring.map(xz=>projectPoint(xz,model.matrix))):undefined;
  const extent=[...(boundary.length?boundary.flatMap(segment=>segment.map(xz=>projectPoint(xz,model.matrix))):polygons.flat()),...markers.map(p=>[p.x,p.y] as XY)];
  const xs=extent.map(p=>p[0]),ys=extent.map(p=>p[1]);
  const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
  const padding=Math.max(maxX-minX,maxY-minY,.0001)*.1;
  const hit=regionHit(snapshot,area);
  const card:MapCard={schemaVersion:1,kind:'resource-map',id:`${snapshot.id.replaceAll(".","-")}:${area.id}:${resourceId}`,snapshotId:snapshot.id,gameVersion:snapshot.gameVersion,sourceTime:snapshot.sourceTime,
    region:{id:hit.id,name:hit.name,...(hit.nameEn?{nameEn:hit.nameEn}:{}),country:hit.country,...(hit.countryEn?{countryEn:hit.countryEn}:{}),parentName:hit.parentName,...(hit.parentNameEn?{parentNameEn:hit.parentNameEn}:{}),sceneId:hit.sceneId},
    resource:{id:resourceId,name:resourceName||resourceId,...(bundle.typesEn?.[resourceId]?{nameEn:bundle.typesEn[resourceId]}:{})},
    count:included.length,status:review.boundary||review.unknownHeight||review.overlap?'requires-review':included.length && included.every(p=>p.coordinateEvidence==='crosschecked-3d')?'crosschecked':'projected-snapshot',review,
    map:{...manifest.map,projection:'appsample-mercator-v1',bounds:[minX-padding,minY-padding,maxX+padding,maxY+padding]},polygons,...(parentPolygons?{parentPolygons}:{}),markers,truncated:included.length>markers.filter(p=>p.role==='included').length,
    sources:[{label:'AppSample resource snapshot',url:'https://genshin-impact-map.appsample.com/'},{label:'7.2 native client boundary provenance',url:'https://github.com/TwintailTeam/game-manifests/blob/dbc55338c2ee2067f89761d4992c68215341ee01/hk4e_global.json'}]};
  const crosscheck=markers.find(p=>p.coordinateEvidence==='crosschecked-3d');
  if(crosscheck){const url=bundle.crosschecks[String(crosscheck.id)]?.sourceBlobURL;if(url) card.sources.push({label:'Public collection coordinates (not authenticated spawn data)',url});}
  const validated=mapCardSchema.safeParse(card);
  if(!validated.success) return {error:'MAP_CARD_UNSUPPORTED',message:'This region cannot be represented safely by the current map card protocol.'};
  return {card:validated.data};
}
