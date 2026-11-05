import {errorResponse} from '../../../../lib/server/errors';
import {knowledge} from '../../../../lib/server/knowledge';
import {characterIdentity,characterQuery} from '../../../../lib/server/character-validation';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request,context:{params:Promise<{id:string}>}){try{const id=characterIdentity((await context.params).id),q=characterQuery(request,'detail');return Response.json(await knowledge(`/v1/characters/${id}${q?'?'+q:''}`,{signal:request.signal,maxBytes:8_000_000}),{headers:{'Cache-Control':'no-store'}})}catch(error){return errorResponse(error)}}
