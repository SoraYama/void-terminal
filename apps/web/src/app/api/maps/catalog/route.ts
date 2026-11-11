import {z} from 'zod';
import {mapSnapshotIdSchema} from '../../../../lib/map-cards';
import {getMapCatalog, loadMapSnapshot} from '../../../../lib/server/maps';
import {mapErrorResponse} from '../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const schema = z.object({snapshotId: mapSnapshotIdSchema.optional()}).strict();

/** Complete names and availability only; coordinates and asset paths stay in the verified store. */
export async function GET(request: Request): Promise<Response> {
  try {
    const params = new URL(request.url).searchParams;
    const parsed = schema.safeParse(Object.fromEntries(params));
    if (!parsed.success || Array.from(params.keys()).some(key => params.getAll(key).length > 1)) {
      return Response.json({error: 'INVALID_MAP_QUERY', message: 'Expected an optional snapshotId query parameter.'}, {status: 400, headers: {'Cache-Control': 'no-store'}});
    }
    const snapshot = await loadMapSnapshot(parsed.data.snapshotId, request.signal);
    const catalog = getMapCatalog(snapshot);
    request.signal.throwIfAborted();
    return Response.json({snapshotId: snapshot.id, gameVersion: snapshot.gameVersion, sourceTime: snapshot.sourceTime, ...catalog}, {headers: {'Cache-Control': 'no-store'}});
  } catch (error) {
    return mapErrorResponse(error);
  }
}
