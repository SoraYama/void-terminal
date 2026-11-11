import {z} from 'zod';
import {MapDataError} from '../../../lib/server/maps';
import {mapSnapshotIdSchema} from '../../../lib/map-cards';
export const queryBodySchema=z.object({region:z.string().trim().min(1).max(200),resource:z.string().trim().min(1).max(200),country:z.string().trim().min(1).max(100).optional(),snapshotId:mapSnapshotIdSchema.optional()}).strict();
export function mapErrorResponse(error:unknown):Response {
  if(error instanceof MapDataError){
    const status=error.code==='MAP_TILE_UNAVAILABLE'?502:error.code==='MAP_ASSET_NOT_FOUND'?404:error.code.startsWith('INVALID_')?400:503;
    return Response.json({error:error.code,message:error.message},{status,headers:{'Cache-Control':'no-store'}});
  }
  if(error instanceof Error && error.name==='AbortError') return Response.json({error:'REQUEST_ABORTED',message:'Map request was cancelled.'},{status:499});
  return Response.json({error:'MAP_DATA_UNAVAILABLE',message:'Map data is unavailable.'},{status:503,headers:{'Cache-Control':'no-store'}});
}
export async function boundedJSON(request:Request):Promise<unknown> {
  if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')??'')) throw new MapDataError('INVALID_CONTENT_TYPE','Use application/json.');
  const limit=8192;
  if(Number(request.headers.get('content-length'))>limit) throw new RangeError('Map query body exceeds 8 KiB.');
  const reader=request.body?.getReader();
  if(!reader) throw new MapDataError('INVALID_MAP_QUERY','A JSON query body is required.');
  const chunks:Uint8Array[]=[];let size=0;
  try {
    while(true){request.signal.throwIfAborted();const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw new RangeError('Map query body exceeds 8 KiB.');}chunks.push(value);}
  } finally {reader.releaseLock();}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new MapDataError('INVALID_MAP_QUERY','The body must be valid JSON.');}
}
