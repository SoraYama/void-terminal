import {AppError,errorResponse} from '../../../../../../lib/server/errors';
import {characterIdentity,characterQuery,voiceIdentity} from '../../../../../../lib/server/character-validation';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=120;
const limit=16*1024*1024;
export async function GET(request:Request,context:{params:Promise<{id:string;voiceId:string}>}){
 try{
  const params=await context.params,id=characterIdentity(params.id),voice=voiceIdentity(params.voiceId),q=characterQuery(request,'voice');
  const base=(process.env.KNOWLEDGE_URL||'http://127.0.0.1:8000').replace(/\/+$/,'');
  const response=await fetch(`${base}/v1/characters/${id}/voices/${voice}?${q}`,{headers:process.env.KNOWLEDGE_API_TOKEN?{'X-Knowledge-Token':process.env.KNOWLEDGE_API_TOKEN}:{},signal:AbortSignal.any([request.signal,AbortSignal.timeout(115000)]),cache:'no-store',redirect:'error'});
  if(!response.ok){await response.body?.cancel();throw new AppError(response.status===404?'VOICE_NOT_FOUND':'KNOWLEDGE_UNAVAILABLE',response.status===404?'Audio is unavailable for this voice and language.':'Audio could not be loaded. Please retry.',[404,409,429].includes(response.status)?response.status:503,true)}
  if(!/^audio\/(wav|x-wav)(;|$)/i.test(response.headers.get('Content-Type')||'')||Number(response.headers.get('Content-Length'))>limit||!response.body){await response.body?.cancel();throw new AppError('INVALID_AUDIO','Audio could not be loaded.',503)}
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit)throw new AppError('AUDIO_LIMIT','Audio exceeded the safe size limit.',503);chunks.push(value)}}finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
  if(size<44||new TextDecoder().decode(bytes.subarray(0,4))!=='RIFF'||new TextDecoder().decode(bytes.subarray(8,12))!=='WAVE')throw new AppError('INVALID_AUDIO','Audio could not be loaded.',503);
  return new Response(bytes,{headers:{'Content-Type':'audio/wav','Content-Length':String(size),'Cache-Control':'private, max-age=86400, immutable','X-Content-Type-Options':'nosniff'}});
 }catch(error){return errorResponse(error)}
}
