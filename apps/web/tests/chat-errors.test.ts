import {describe,it,expect} from 'vitest';
import {ChatRequestError,chatFailure,chatErrorText,responseErrorCode} from '../src/lib/chat-errors';
import {accountErrorText} from '../src/lib/account-contracts';

describe('localized chat errors',()=>{
 it('explains invalid requests rather than displaying the generic failure',()=>{
  expect(chatErrorText({code:'INVALID_REQUEST',message:'The request is invalid or exceeds the allowed limits.'},'zh-CN')).toContain('请求内容无效');
  expect(chatErrorText({code:'INVALID_REQUEST',message:''},'en')).toContain('request is invalid');
 });
 it('translates error codes without depending on server message wording',()=>{
  const failure=chatFailure(new ChatRequestError('Different server wording','NOT_FOUND'));
  expect(chatErrorText(failure,'zh-CN')).toBe('未找到请求的原文，请重新检索或重试。');
  expect(chatErrorText(failure,'en')).toBe('The requested source could not be found. Search again or retry.');
 });
 it('localizes old history that only stored the English error message',()=>{
  expect(chatErrorText('The requested evidence was not found.','zh-CN')).toBe('未找到请求的原文，请重新检索或重试。');
 });
 it('handles cancellation, network failure and unrecognized errors in both languages',()=>{
  expect(chatErrorText(chatFailure(new DOMException('Aborted','AbortError')),'zh-CN')).toBe('已停止生成');
  expect(chatErrorText(chatFailure(new TypeError('Failed to fetch')),'en')).toBe('Could not connect. Check your network and retry.');
  expect(chatErrorText({message:'Unknown technical details',code:'UNKNOWN_CODE'},'zh-CN')).toBe('请求失败，请稍后重试。');
 });
 it('keeps citation warnings useful when they are displayed above the composer',()=>{
  expect(chatErrorText('Unknown citation [8] · The answer contains no source citations.','zh-CN')).toContain('引用 [8]');
  expect(chatErrorText('Unknown citation [8]','en')).toContain('[8]');
 });
 it('recognizes login expiry in both model-test and chat response formats',()=>{
  expect(responseErrorCode({ok:false,code:'LOGIN_REQUIRED'})).toBe('LOGIN_REQUIRED');
  expect(responseErrorCode({error:{code:'LOGIN_REQUIRED'}})).toBe('LOGIN_REQUIRED');
  expect(responseErrorCode({code:401})).toBeUndefined();
  expect(responseErrorCode(null)).toBeUndefined();
 });
 it('asks for a reload when a deployment changed and reports invalid configuration',()=>{
  expect(chatErrorText({code:'MODE_NOT_ALLOWED',message:''},'zh-CN')).toContain('刷新页面');
  expect(chatErrorText({code:'MODE_NOT_ALLOWED',message:''},'en')).toContain('Reload the page');
  expect(chatErrorText({code:'DEPLOYMENT_CONFIG',message:''},'en')).toContain('configuration is unavailable');
  expect(accountErrorText({code:'MODE_NOT_ALLOWED',message:''},true)).toContain('刷新页面');
 });
 it('keeps hosted failures free of unavailable key-setting advice in both languages',()=>{
  for(const code of ['CREDITS_EXHAUSTED','QUOTA_EXCEEDED','SHARED_DISABLED','MODEL_AUTH','MODEL_KEY_REQUIRED','INVALID_PROVIDER','PROVIDER_ADDRESS_BLOCKED']){
   expect(chatErrorText({code,message:''},'en','hosted')).not.toMatch(/key|endpoint|settings/i);
   expect(chatErrorText({code,message:''},'zh-CN','hosted')).not.toMatch(/密钥|Key|设置|模型地址/);
  }
  expect(accountErrorText({code:'AUTH_DISABLED',message:''},false)).not.toMatch(/key/i);
  expect(chatErrorText({code:'MODEL_AUTH',message:''},'en','self-hosted')).toContain('key settings');
 });
});
