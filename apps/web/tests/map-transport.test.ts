import {describe,it,expect} from 'vitest';
import {parseSSE} from '../src/lib/stream';
import {parseChat} from '../src/lib/server/validation';
import {branchConversation,conversationMapSnapshot,conversationMarkdown,normalizeConversation,type Conversation} from '../src/lib/history';
import {mapCardSchema} from '../src/lib/map-cards';
import {mapCardFixture} from './fixtures/map-card';

const conversation = ():Conversation => ({id:'c',title:'map',updatedAt:1,snapshotId:'corpus-old',messages:[{role:'user',content:'奥摩斯港有多少草神瞳？'},{role:'assistant',content:'2 个',maps:[mapCardSchema.parse(mapCardFixture)],mapSnapshotId:mapCardFixture.snapshotId}]});
describe('map transport and history',()=>{
 it('accepts a separate validated map pin without replacing the corpus pin',()=>{
  const request={messages:[{role:'user',content:'草神瞳'}],language:'zh-CN',mode:'byok',depth:'standard',snapshotId:'corpus-old',mapSnapshotId:mapCardFixture.snapshotId};
  expect(parseChat(request)).toMatchObject({snapshotId:'corpus-old',mapSnapshotId:mapCardFixture.snapshotId});
  expect(()=>parseChat({...request,mapSnapshotId:'../current'})).toThrow();
 });
 it('streams maps before text and finalizes maps without a corpus snapshot',async()=>{
  const encoder=new TextEncoder();
  const frames=[['maps',{mapSnapshotId:mapCardFixture.snapshotId,maps:[mapCardFixture,{...mapCardFixture,id:'bad',schemaVersion:2}]}],['text_delta',{text:'2 个'}],['done',{finishReason:'stop',mapSnapshotId:mapCardFixture.snapshotId,maps:[mapCardFixture]}]];
  const bytes=encoder.encode(frames.map(([event,data])=>`event: ${event}\r\ndata: ${JSON.stringify(data)}\r\n\r\n`).join(''));
  const stream=new ReadableStream<Uint8Array>({start(c){for(let i=0;i<bytes.length;i+=31)c.enqueue(bytes.slice(i,i+31));c.close()}});
  const events=[];for await(const event of parseSSE(stream))events.push(event);
  expect(events.map(e=>e.event)).toEqual(['maps','text_delta','done']);
  expect(events[0].data).toMatchObject({maps:[mapCardFixture]});
  expect(events.at(-1)?.data).not.toHaveProperty('snapshotId');
 });
 it('restores and branches pins independently and exports map scope and source',()=>{
  const restored=normalizeConversation({...conversation(),messages:[...conversation().messages,{role:'assistant',content:'old',maps:[{...mapCardFixture,schemaVersion:2}]}]} as unknown as Conversation);
  expect(restored.messages[2].maps).toEqual([]);
  expect(conversationMapSnapshot(restored)).toBe(mapCardFixture.snapshotId);
  expect(branchConversation(restored,2,'继续')).toMatchObject({snapshotId:'corpus-old',mapSnapshotId:mapCardFixture.snapshotId});
  expect(conversationMarkdown(restored,'zh-CN')).toContain('奥摩斯港');
  expect(conversationMarkdown(restored,'zh-CN')).toContain(mapCardFixture.snapshotId);
  expect(conversationMarkdown(restored,'zh-CN')).toContain('https://genshin-impact-map.appsample.com/');
  expect(conversationMapSnapshot({id:'legacy',title:'old',updatedAt:1,messages:[]})).toBeUndefined();
 });
});
