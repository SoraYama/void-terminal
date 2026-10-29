import type {ChatEvent} from './contracts';
export async function* parseSSE(stream:ReadableStream<Uint8Array>):AsyncGenerator<ChatEvent>{
 const reader=stream.getReader(),decoder=new TextDecoder();let buffer='';
 try{while(true){const {done,value}=await reader.read();buffer+=decoder.decode(value,{stream:!done});buffer=buffer.replace(/\r\n/g,'\n');let boundary:number;
 while((boundary=buffer.indexOf('\n\n'))!==-1){const frame=buffer.slice(0,boundary);buffer=buffer.slice(boundary+2);let event='',data='';for(const line of frame.split('\n')){if(line.startsWith('event:'))event=line.slice(6).trim();if(line.startsWith('data:'))data+=line.slice(5).trimStart()+'\n'}if(!data||!['status','sources','text_delta','done','error'].includes(event))continue;const parsed={event,data:JSON.parse(data)} as ChatEvent;yield parsed;if(event==='done'||event==='error')return;}
 if(done)throw new Error('连接提前结束，请重试 / Stream ended unexpectedly');
 }}finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
}
// Resolve citation marks as local links, preserving markdown code and existing links.
type MarkdownNode={type:string;value?:string;url?:string;children?:MarkdownNode[]};
export function remarkCitations(){return (tree:MarkdownNode)=>{const visit=(node:MarkdownNode)=>{if(!node.children||['link','code','inlineCode'].includes(node.type))return;node.children=node.children.flatMap(child=>{if(child.type!=='text'){visit(child);return [child]}const value=child.value||'',matches=[...value.matchAll(/[\[［](\d+)[\]］]/g)];if(!matches.length)return [child];const result:MarkdownNode[]=[];let start=0;for(const match of matches){if(match.index!>start)result.push({type:'text',value:value.slice(start,match.index)});result.push({type:'link',url:'#citation-'+match[1],children:[{type:'text',value:match[0]}]});start=match.index!+match[0].length}if(start<value.length)result.push({type:'text',value:value.slice(start)});return result})};visit(tree)}}
