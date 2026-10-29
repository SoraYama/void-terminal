import type {Locale} from './contracts';

export interface ChatFailure {message:string;code?:string}
export class ChatRequestError extends Error {
 constructor(message:string,public code?:string){super(message)}
}

// Display text is selected at render time so switching languages also updates
// errors already received or restored from history.
const messages:Record<string,[string,string]>={
 INVALID_PROVIDER:['模型地址或名称无效，请检查设置。','The model endpoint or name is invalid. Check settings.'],
 PROVIDER_ADDRESS_BLOCKED:['仅支持公网 HTTPS 模型接口，不能访问本站内网或 localhost。','Use a public HTTPS model endpoint; private networks and localhost are unavailable.'],
 NOT_FOUND:['未找到请求的原文，请重新检索或重试。','The requested source could not be found. Search again or retry.'],
 MODEL_AUTH:['模型密钥未被接受，请检查 Key 设置。','The model API key was not accepted. Check your key settings.'],
 MODEL_KEY_REQUIRED:['请输入模型 API Key 后重试。','Enter a model API key and retry.'],
 MODEL_UNAVAILABLE:['模型服务暂时不可用，请稍后重试。','The model service is temporarily unavailable. Please retry later.'],
 MODEL_RATE_LIMIT:['模型请求过于频繁，请稍后重试。','The model rate limit was reached. Please retry later.'],
 KNOWLEDGE_UNAVAILABLE:['暂时无法读取知识库，请稍后重试。','The knowledge service is unavailable. Please retry later.'],
 SNAPSHOT_UNAVAILABLE:['这段对话使用的资料快照暂不可用，请稍后重试。','The source snapshot for this conversation is unavailable. Please retry later.'],
 NO_SNAPSHOT:['知识库尚未导入资料，请先检查数据状态。','No source snapshot has been imported. Check corpus status first.'],
 QUOTA_EXCEEDED:['共享服务额度已用完，请稍后重试或使用自己的密钥。','The shared allowance has been used up. Retry later or use your own key.'],
 TIMEOUT:['请求超时，请重试或缩小问题范围。','The request timed out. Retry or narrow your question.'],
 NETWORK_ERROR:['连接失败，请检查网络后重试。','Could not connect. Check your network and retry.'],
 MODEL_STREAM_INCOMPLETE:['回答连接提前中断，请重试。','The answer stream ended unexpectedly. Please retry.'],
 EMPTY_MODEL_ANSWER:['模型本次未生成回答，请重试。','The model did not produce an answer. Please retry.'],
 INVALID_EVIDENCE:['原文校验未通过，请重试。','The source could not be verified. Please retry.'],
 CONTEXT_LIMIT:['对话或资料过长，请缩小问题范围或开始新对话。','The conversation or sources are too long. Narrow your question or start a new conversation.'],
 TOOL_LIMIT:['本次检索未能完成，请简化问题或重试。','The research could not be completed. Simplify your question or retry.'],
 CANCELLED:['已停止生成','Generation stopped'],
 SHARED_DISABLED:['共享服务尚未启用，请使用自己的密钥','Shared service is disabled; use your own key'],
 MESSAGE_TOO_LONG:['问题最多 12000 字符','Maximum 12,000 characters per message'],
 CONVERSATION_LIMIT:['当前对话达到长度限制，请开始新对话','Conversation limit reached. Start a new conversation.'],
 COPY_FAILED:['复制失败，请手动选择文本','Copy failed. Select text manually.'],
 MISSING_CITATIONS:['这段回答未附原文引用，请核对后使用。','This answer has no source citations. Verify it before use.'],
 REQUEST_FAILED:['请求失败，请稍后重试。','The request failed. Please retry later.'],
};
const codeAliases:Record<string,string>={
 SOURCE_NOT_FOUND:'NOT_FOUND',UPSTREAM_UNAVAILABLE:'MODEL_UNAVAILABLE',KNOWLEDGE_AUTH:'KNOWLEDGE_UNAVAILABLE',SERVICE_UNAVAILABLE:'KNOWLEDGE_UNAVAILABLE',
 INVALID_MODEL_RESPONSE:'MODEL_STREAM_INCOMPLETE',INVALID_SERVICE_RESPONSE:'MODEL_STREAM_INCOMPLETE',SERVICE_RESPONSE_LIMIT:'CONTEXT_LIMIT',
 OUTPUT_LIMIT:'CONTEXT_LIMIT',INVALID_TOOL_CALL:'TOOL_LIMIT',
};
const legacy:Record<string,string>={
 'The requested evidence was not found.':'NOT_FOUND',
 'The model API key was not accepted.':'MODEL_AUTH',
 'Enter a valid model API key.':'MODEL_KEY_REQUIRED',
 'The model provider is unavailable.':'MODEL_UNAVAILABLE',
 'The model provider rate limit was reached.':'MODEL_RATE_LIMIT',
 'The knowledge service is unavailable.':'KNOWLEDGE_UNAVAILABLE',
 'The service is temporarily unavailable.':'KNOWLEDGE_UNAVAILABLE',
 'The requested snapshot is unavailable.':'SNAPSHOT_UNAVAILABLE',
 'No imported knowledge snapshot is available.':'NO_SNAPSHOT',
 'The shared usage budget has been reached.':'QUOTA_EXCEEDED',
 'The research request timed out. Please try a narrower question.':'TIMEOUT',
 'The model stream ended before completion.':'MODEL_STREAM_INCOMPLETE',
 'The answer contains no source citations.':'MISSING_CITATIONS',
 '连接提前结束，请重试 / Stream ended unexpectedly':'MODEL_STREAM_INCOMPLETE',
 'Empty response':'MODEL_STREAM_INCOMPLETE',
};
for(const [code,pair] of Object.entries(messages))for(const value of pair)legacy[value]=code;

export function chatFailure(error:unknown):ChatFailure{
 if(error instanceof ChatRequestError)return {message:error.message,code:error.code};
 if(error instanceof Error&&error.name==='AbortError')return {message:'Generation stopped',code:'CANCELLED'};
 if(error instanceof TypeError)return {message:error.message,code:'NETWORK_ERROR'};
 return {message:error instanceof Error?error.message:''};
}
export function chatErrorText(failure:ChatFailure|string,locale:Locale):string{
 const message=typeof failure==='string'?failure:failure.message;
 const code=typeof failure==='string'?legacy[message]:failure.code||legacy[message];
 const pair=messages[codeAliases[code]||code];
 if(pair)return pair[locale==='zh-CN'?0:1];
 const parts=message.split(' · ');
 if(parts.length>1)return parts.map(part=>chatErrorText(part,locale)).join(' · ');
 const citation=/^Unknown citation \[(\d+)\]$/.exec(message);
 if(citation)return locale==='zh-CN'?`引用 [${citation[1]}] 无法对应到已取回的原文。`:`Citation [${citation[1]}] does not match a retrieved source.`;
 return messages.REQUEST_FAILED[locale==='zh-CN'?0:1];
}
