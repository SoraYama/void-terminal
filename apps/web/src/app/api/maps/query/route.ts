import {loadMapSnapshot,queryMapResources} from '../../../../lib/server/maps';
import {boundedJSON,mapErrorResponse,queryBodySchema} from '../_shared';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(request:Request):Promise<Response> {
  try {
    const parsed=queryBodySchema.safeParse(await boundedJSON(request));
    if(!parsed.success)return Response.json({error:'INVALID_MAP_QUERY',message:'Expected bounded region, resource, optional country and snapshotId fields.'},{status:400});
    const {snapshotId,...query}=parsed.data;
    const snapshot=await loadMapSnapshot(snapshotId,request.signal);
    const result=queryMapResources(snapshot,query);
    request.signal.throwIfAborted();
    return Response.json(result,{status:'card' in result?200:422,headers:{'Cache-Control':'no-store'}});
  }catch(error){
    if(error instanceof RangeError)return Response.json({error:'QUERY_TOO_LARGE',message:error.message},{status:413});
    return mapErrorResponse(error);
  }
}
