import {z} from 'zod';
import {mapSnapshotIdSchema} from '../../../../lib/map-cards';
import {loadMapSnapshot,searchMapRegions} from '../../../../lib/server/maps';
import {mapErrorResponse} from '../_shared';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const schema=z.object({q:z.string().max(200).default(''),country:z.string().trim().min(1).max(100).optional(),snapshotId:mapSnapshotIdSchema.optional()}).strict();
export async function GET(request:Request):Promise<Response> {
  try {
    const params=new URL(request.url).searchParams;
    const parsed=schema.safeParse(Object.fromEntries(params));
    if(!parsed.success || Array.from(params.keys()).some(key=>params.getAll(key).length>1))return Response.json({error:'INVALID_MAP_QUERY',message:'Expected q, country and snapshotId query parameters.'},{status:400});
    const snapshot=await loadMapSnapshot(parsed.data.snapshotId,request.signal);
    return Response.json({snapshotId:snapshot.id,regions:searchMapRegions(snapshot,parsed.data.q,parsed.data.country)},{headers:{'Cache-Control':'no-store'}});
  }catch(error){return mapErrorResponse(error);}
}
