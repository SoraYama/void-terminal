import {afterEach,describe,it,expect,vi} from 'vitest';
import {GET as list} from '../src/app/api/characters/route';
import {GET as detail} from '../src/app/api/characters/[id]/route';
import {GET as voice} from '../src/app/api/characters/[id]/voices/[voiceId]/route';
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs()});
const req=(q='')=>new Request('http://localhost/api/characters'+q);
describe('character proxy boundaries',()=>{
 it.each(['?q=a&q=b','?url=http://evil','?pageSize=101','?element=Wood','?weaponType=unknown','?region='+ 'x'.repeat(201),'?audioLanguage=ja'])('rejects invalid list queries %s',async q=>{
  const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);expect((await list(req(q))).status).toBe(400);expect(fetcher).not.toHaveBeenCalled();
 });
 it('uses private upstream auth and raises only character detail JSON limit',async()=>{
  vi.stubEnv('KNOWLEDGE_API_TOKEN','secret');
  vi.stubGlobal('fetch',async(_url:string,opts:RequestInit)=>{expect(new Headers(opts.headers).get('X-Knowledge-Token')).toBe('secret');return Response.json({character:{id:'avatar:10000005',text:'x'.repeat(2_500_000)},snapshotId:'s1'})});
  const response=await detail(req('?language=en&snapshotId=s1'),{params:Promise.resolve({id:'avatar:10000005'})});expect(response.status).toBe(200);expect(response.headers.get('Cache-Control')).toBe('no-store');
 });
 it('rejects voice traversal, arbitrary URL, missing snapshot and invalid locale before fetch',async()=>{
  const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
  for(const q of ['?audioLanguage=ja','?audioLanguage=fr&snapshotId=s1','?audioLanguage=en&snapshotId=s1&url=http://evil'])expect((await voice(req(q),{params:Promise.resolve({id:'avatar:2',voiceId:'123'})})).status).toBe(400);
  expect((await voice(req('?audioLanguage=ja&snapshotId=s1'),{params:Promise.resolve({id:'avatar:2',voiceId:'../x'})})).status).toBe(400);expect(fetcher).not.toHaveBeenCalled();
 });
 it('bounds binary audio and uses private caching only at an explicit snapshot',async()=>{
  const wav=new Uint8Array(44);wav.set(new TextEncoder().encode('RIFF'));wav.set(new TextEncoder().encode('WAVE'),8);
  vi.stubGlobal('fetch',async(url:string,opts:RequestInit)=>{expect(String(url)).toContain('/v1/characters/avatar%3A2/voices/123?audioLanguage=ja&snapshotId=s1');expect(opts.redirect).toBe('error');return new Response(wav,{headers:{'Content-Type':'audio/wav'}})});
  const response=await voice(req('?audioLanguage=ja&snapshotId=s1'),{params:Promise.resolve({id:'avatar:2',voiceId:'123'})});expect(response.status).toBe(200);expect(response.headers.get('Cache-Control')).toContain('private');expect(response.headers.get('Content-Type')).toBe('audio/wav');
  vi.stubGlobal('fetch',async()=>new Response(new Uint8Array(16*1024*1024+1),{headers:{'Content-Type':'audio/wav'}}));expect((await voice(req('?audioLanguage=en&snapshotId=s1'),{params:Promise.resolve({id:'avatar:2',voiceId:'123'})})).status).toBe(503);
 });
});
