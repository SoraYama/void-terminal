import {describe,it,expect} from 'vitest';
import {parseSSE,remarkCitations} from '../src/lib/stream';
import {branchConversation,conversationSnapshot} from '../src/lib/history';
import {contextWarning,branchContextNote} from '../src/lib/i18n';
import {safePreferences} from '../src/lib/preferences';
describe('frontend durable and transport behavior',()=>{
 it('decodes arbitrary UTF8 and SSE boundaries and stops at done',async()=>{
 const bytes=new TextEncoder().encode('event: text_delta\r\ndata: {"text":"须弥"}\r\n\r\nevent: done\ndata: {"snapshotId":"s","finishReason":"stop"}\n\nevent: text_delta\ndata: {"text":"bad"}\n\n');
 const stream=new ReadableStream<Uint8Array>({start(c){for(const b of bytes)c.enqueue(new Uint8Array([b]));c.close()}});
 const events=[];for await(const e of parseSSE(stream))events.push(e);
 expect(events.map(e=>e.event)).toEqual(['text_delta','done']);expect(events[0].data).toEqual({text:'须弥'});
 });
 it('keeps cumulative source arrays and terminates on server error',async()=>{
 const body='event: sources\ndata: {"sources":[{"id":"a","citation":1}],"snapshotId":"s"}\n\nevent: sources\ndata: {"sources":[{"id":"a","citation":1},{"id":"b","citation":2}],"snapshotId":"s"}\n\nevent: error\ndata: {"code":"provider","message":"Failed","retryable":true}\n\n';
 const stream=new ReadableStream<Uint8Array>({start(c){c.enqueue(new TextEncoder().encode(body));c.close()}});
 const result=[];for await(const e of parseSSE(stream))result.push(e);
 expect(result.map(e=>e.event)).toEqual(['sources','sources','error']);expect(result[1].data).toMatchObject({sources:[{id:'a',citation:1},{id:'b',citation:2}]});
 });
 it('resolves numbered citations without rewriting code or existing links',()=>{
 const tree={type:'root',children:[{type:'paragraph',children:[{type:'text',value:'Evidence [2].'},{type:'inlineCode',value:'[3]'},{type:'link',url:'https://example.com',children:[{type:'text',value:'[4]'}]}]}]};
 remarkCitations()(tree);
 expect(tree.children[0].children).toEqual([{type:'text',value:'Evidence '},{type:'link',url:'#citation-2',children:[{type:'text',value:'[2]'}]},{type:'text',value:'.'},{type:'inlineCode',value:'[3]'},{type:'link',url:'https://example.com',children:[{type:'text',value:'[4]'}]}]);
 });
 it('fails when connection ends without done' ,async()=>{
 const stream=new ReadableStream<Uint8Array>({start(c){c.close()}});
 await expect((async()=>{for await(const e of parseSSE(stream))void e})()).rejects.toThrow('结束');
 });
 it('branches edits without mutating original messages',()=>{
 const original={id:'old',title:'first',updatedAt:1,messages:[{role:'user' as const,content:'first'},{role:'assistant' as const,content:'answer'},{role:'user' as const,content:'later'}]};
 const branch=branchConversation(original,0,'edited');
 expect(branch.id).not.toBe(original.id);expect(branch.parentId).toBe('old');expect(branch.messages).toEqual([{role:'user',content:'edited'}]);expect(original.messages).toHaveLength(3);
 });
 it('pins earliest conversation snapshot across followup and edited/regenerated branches',()=>{
 const original={id:'c',title:'Q',updatedAt:1,messages:[{role:'user' as const,content:'Q'},{role:'assistant' as const,content:'A',snapshotId:'snapshot-v1'}]};
 expect(conversationSnapshot(original,'active-v2')).toBe('snapshot-v1');
 expect(conversationSnapshot(branchConversation(original,0,'edited'),'active-v2')).toBe('snapshot-v1');
 expect(conversationSnapshot(null,'reading-v3')).toBe('reading-v3');
 expect(conversationSnapshot(null)).toBeUndefined();
 });
 it('warns in both languages when source context is unknown without implying verified release or speaker',()=>{
 const metadata={kind:'orphan_textmap',contextUnknown:true,testState:'unknown',schemaState:'unmapped'};
 expect(contextWarning(metadata,'zh-CN')).toContain('请勿据此推断说话人、剧情顺序或正式开放状态');
 expect(contextWarning(metadata,'en')).toContain('Do not infer speakers, story order, or official release status');
 expect(contextWarning({contextUnknown:false},'zh-CN')).toBeNull();
 expect(contextWarning(undefined,'en')).toBeNull();
 });
 it('labels graph context separately and preserves raw conditions without inventing linear order',()=>{
 expect(branchContextNote(undefined,'en')).toBeNull();
 expect(branchContextNote({chunk:2},'zh-CN')).toBeNull();
 expect(branchContextNote({contextRelation:{kind:'next',targetId:'b',condition:'quest == 3'}},'zh-CN')).toMatchObject({label:'分支关联',condition:'quest == 3',unknownLabel:null});
 expect(branchContextNote({contextRelation:{kind:'next',targetId:'b'}},'en')).toMatchObject({label:'Related branch',condition:null,unknownLabel:'Condition unknown'});
 expect(branchContextNote({conditionUnknown:true},'zh-CN')).toMatchObject({label:'分支关联',unknownLabel:'条件未确认'});
 expect(branchContextNote({relation:{kind:'choice',condition:{op:'unknown',value:3}},conditionUnknown:true},'en')).toMatchObject({condition:'{"op":"unknown","value":3}',unknownLabel:'Condition unknown'});
 });
 it('only persists allowlisted preferences and never credentials',()=>{
 expect(safePreferences({theme:'dark',locale:'en',sourceLanguage:'zh-CN',apiKey:'secret',mode:'shared'})).toEqual({theme:'dark',locale:'en',sourceLanguage:'zh-CN',mode:'shared'});
 });
});
