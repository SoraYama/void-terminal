import {MapDataError,loadMapAssetStore,readMapFile,sha256} from '../../../../../../lib/server/map-data';
import {mapErrorResponse} from '../../../_shared';
export const runtime='nodejs';
export const dynamic='force-dynamic';
let remoteActive=0;
const MAX_BYTES=2_000_000;
function assetName(parts:string[]):{name:string;type:string;tile?:{z:number;x:number;y:number}} {
  if(parts.length===2 && parts[0]==='icons' && /^o\d{1,8}\.png$/.test(parts[1])) return {name:`icon_${parts[1].slice(1)}`,type:'image/png'};
  if(parts.length===5 && parts[0]==='tiles' && parts[1]==='teyvat' && /^1[0-5]$/.test(parts[2]) && /^-?(?:0|[1-9]\d{0,4})$/.test(parts[3]) && /^-?(?:0|[1-9]\d{0,4})\.jpg$/.test(parts[4])) {
    const z=Number(parts[2]),x=Number(parts[3]),y=Number(parts[4].slice(0,-4)),bound=2**(z-1);
    if(Math.abs(x)<bound && Math.abs(y)<bound) return {name:`teyvat_${z}_${x}_${y}.jpg`,type:'image/jpeg',tile:{z,x,y}};
  }
  throw new MapDataError('INVALID_MAP_ASSET','Only supported map tiles and resource icons are available.');
}
function validImage(bytes:Uint8Array,type:string):boolean {
  return type==='image/png'?bytes.length>=8 && Buffer.from(bytes.subarray(0,8)).equals(Buffer.from('89504e470d0a1a0a','hex')):bytes.length>=3 && bytes[0]===255 && bytes[1]===216 && bytes[2]===255;
}
async function fetchTile(tile:{z:number;x:number;y:number},signal:AbortSignal):Promise<Uint8Array> {
  if(remoteActive>=8) throw new MapDataError('MAP_TILE_UNAVAILABLE','High resolution tile requests are busy. Lower resolution tiles may still be available.');
  remoteActive++;
  try {
    const timeout=AbortSignal.timeout(5000),combined=AbortSignal.any([signal,timeout]);
    const url=`https://game-cdn.appsample.com/gim/map-teyvat/v72-rc1/${tile.z}/tile-${tile.x}_${tile.y}.jpg`;
    const response=await fetch(url,{signal:combined,redirect:'error',headers:{Accept:'image/jpeg'},cache:'no-store'});
    if(!response.ok || !/^image\/jpeg(?:;|$)/i.test(response.headers.get('content-type')??'') || Number(response.headers.get('content-length'))>MAX_BYTES){await response.body?.cancel();throw new Error('Invalid tile response');}
    const reader=response.body?.getReader(); if(!reader)throw new Error('Empty tile response');
    const chunks:Uint8Array[]=[];let size=0;
    try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BYTES){await reader.cancel();throw new Error('Oversized tile');}chunks.push(value);}}finally{reader.releaseLock();}
    const bytes=Buffer.concat(chunks);
    if(!validImage(bytes,'image/jpeg'))throw new Error('Invalid tile image');
    return bytes;
  }catch(error){signal.throwIfAborted();throw new MapDataError('MAP_TILE_UNAVAILABLE','This high resolution tile is unavailable. Lower resolution tiles may still be available.');}
  finally{remoteActive--;}
}
export async function GET(request:Request,context:{params:Promise<{snapshotId:string;asset:string[]}>}):Promise<Response> {
  try {
    const {snapshotId,asset}=await context.params,{name,type,tile}=assetName(asset);
    const data=await loadMapAssetStore(snapshotId,request.signal),indexed=data.assets[name];
    let bytes:Uint8Array;
    if(indexed){
      try{bytes=await readMapFile(data.directory,`assets/${name}`,MAX_BYTES,request.signal);}catch(error){request.signal.throwIfAborted();throw new MapDataError('MAP_DATA_CORRUPT','A pinned map asset is missing or invalid.');}
      if(bytes.length!==indexed.bytes || sha256(bytes)!==indexed.sha256 || !validImage(bytes,type))throw new MapDataError('MAP_DATA_CORRUPT','A pinned map asset failed integrity validation.');
    }else if(tile){bytes=await fetchTile(tile,request.signal);}
    else throw new MapDataError('MAP_ASSET_NOT_FOUND','This snapshot has no icon for that resource.');
    request.signal.throwIfAborted();
    return new Response(new Uint8Array(bytes),{headers:{'Content-Type':type,'Content-Length':String(bytes.length),'Cache-Control':'public, max-age=31536000, immutable','X-Content-Type-Options':'nosniff',ETag:`"${sha256(bytes)}"`}});
  }catch(error){return mapErrorResponse(error);}
}
