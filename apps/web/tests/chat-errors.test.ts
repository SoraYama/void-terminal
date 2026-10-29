import {describe,it,expect} from 'vitest';
import {ChatRequestError,chatFailure,chatErrorText} from '../src/lib/chat-errors';

describe('localized chat errors',()=>{
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
});
