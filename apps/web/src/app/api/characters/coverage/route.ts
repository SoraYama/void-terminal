import {errorResponse} from '../../../../lib/server/errors';
import {knowledge} from '../../../../lib/server/knowledge';
import {characterQuery} from '../../../../lib/server/character-validation';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{const q=characterQuery(request,'coverage');return Response.json(await knowledge(`/v1/characters/coverage${q?'?'+q:''}`,{signal:request.signal,maxBytes:8_000_000}),{headers:{'Cache-Control':'no-store'}})}catch(error){return errorResponse(error)}}
