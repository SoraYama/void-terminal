import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import ormos from './fixtures/maps/ormos-7.2.json';
import {stubFetch} from './helpers/model-fetch';
import {runAgent} from '../src/lib/server/agent';
import type {ChatEvent,ChatRequest} from '../src/lib/contracts';
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
let root:string,snapshotId:string;
beforeEach(async()=>{
 root=await mkdtemp(path.join(tmpdir(),'map-agent-'));vi.stubEnv('MAP_DATA_DIR',root);vi.stubEnv('DEEPSEEK_BASE_URL','https://api.deepseek.com');
 const data=JSON.stringify(ormos),assets='{}',dataHash=sha(data),assetsHash=sha(assets);
 snapshotId=`map-7.2-${sha(`${dataHash}\n${assetsHash}\n`).slice(0,16)}`;
 const dir=path.join(root,snapshotId);await mkdir(dir);
 await writeFile(path.join(dir,'bundle.json'),data);await writeFile(path.join(dir,'assets.json'),assets);
 await writeFile(path.join(dir,'manifest.json'),JSON.stringify({schema:1,id:snapshotId,gameVersion:'7.2',sourceTime:'2026-11-09T20:39:02.715Z',dataHash,assetsHash,map:{key:'teyvat',revision:'v72-rc1',minZoom:10,maxZoom:15,tileSize:256}}));
 await writeFile(path.join(root,'current.json'),JSON.stringify({snapshotId}));
});
afterEach(async()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();await rm(root,{recursive:true,force:true})});
function response(delta:unknown,finish='stop'){
 return new Response(`data: ${JSON.stringify({choices:[{delta,finish_reason:finish}],usage:{prompt_tokens:20,completion_tokens:10}})}\n\ndata: [DONE]\n\n`,{headers:{'content-type':'text/event-stream'}});
}
async function run(question:string,extra:Partial<ChatRequest>={}){
 const events:ChatEvent[]=[];const result=await runAgent({messages:[{role:'user',content:question}],language:'zh-CN',depth:'standard',mode:'byok',...extra},{key:'fixture-key',signal:new AbortController().signal,emit:e=>events.push(e)});return {events,result};
}
describe('actual DSH map tool integration',()=>{
 it('answers a map-only request and streams a card even when the knowledge service is absent',async()=>{
  const upstream=vi.fn(async(url,init)=>{
   expect(String(url)).toContain('/chat/completions');
   const body=JSON.parse(String(init?.body));
   expect(body.messages[0].content).toContain('33876');
   expect(body.messages[0].content).toContain('"count":2');
   return response({content:'奥摩斯港范围内有 2 个草神瞳，见地图。'});
  });stubFetch(upstream);
  const {events,result}=await run('须弥的奥摩斯港有多少草神瞳？');
  expect(result.outcome).toBe('completed');
  const map=events.find(e=>e.event==='maps');expect(map).toMatchObject({event:'maps',data:{mapSnapshotId:snapshotId,maps:[{count:2,status:'crosschecked'}]}});
  expect(events.at(-1)).toMatchObject({event:'done',data:{mapSnapshotId:snapshotId,maps:[{count:2}]}});
  expect(events.at(-1)?.data).not.toHaveProperty('snapshotId');expect(upstream).toHaveBeenCalledOnce();
 });
 it('executes a model map tool call with a fixed map version independently of the corpus pin',async()=>{
  let calls=0;stubFetch(vi.fn(async(_url,init)=>{
   const body=JSON.parse(String(init?.body));
   if(calls++===0)return response({tool_calls:[{index:0,id:'map-query',type:'function',function:{name:'query_map_resources',arguments:JSON.stringify({region:'Port Ormos',resource:'Dendroculus'})}}]},'tool_calls');
   expect(JSON.stringify(body.messages)).toContain('"count\\":2');
   return response({content:'奥摩斯港有 2 个草神瞳。'});
  }));
  const {events,result}=await run('查一下地图上 Port Ormos 的资源',{snapshotId:'corpus-original',mapSnapshotId:snapshotId});
  expect(result.outcome).toBe('completed');expect(calls).toBe(2);
  expect(events.at(-1)).toMatchObject({event:'done',data:{snapshotId:'corpus-original',mapSnapshotId:snapshotId,maps:[{count:2}]}});
 });
 it('does not turn a missing pinned snapshot into a latest result or a zero-count card',async()=>{
  stubFetch(vi.fn(async(_url,init)=>{
   expect(String(init?.body)).toContain('MAP_SNAPSHOT_UNAVAILABLE');
   return response({content:'这份地图版本不可用，暂时不能确认数量。'});
  }));
  const {events}=await run('奥摩斯港有多少草神瞳',{mapSnapshotId:'map-7.2-missing'});
  expect(events.some(e=>e.event==='maps')).toBe(false);expect(events.at(-1)).toMatchObject({event:'done'});
 });
});
