import {describe,it,expect} from 'vitest';
import {PublicResponseCache,createArchiveSession,archiveDetailKey,resolvedListKey} from '../src/lib/archive-session';

describe('public archive session',()=>{
 it('bounds retained results, shares snapshot aliases, and evicts the least recently read result',()=>{
  const cache=new PublicResponseCache<{id:number}>();
  for(let i=0;i<8;i++)cache.set(`request-${i}`,{id:i},[`snapshot-${i}`]);
  expect(cache.get('snapshot-0')).toEqual({id:0});
  cache.set('request-8',{id:8},['snapshot-8']);
  expect(cache.get('request-1')).toBeUndefined();expect(cache.get('snapshot-1')).toBeUndefined();
  expect(cache.get('request-0')).toEqual({id:0});
  for(let i=2;i<=8;i++)expect(cache.get(`snapshot-${i}`)).toEqual({id:i});
 });
 it('keeps source languages, snapshots, selections and sessions separate',()=>{
  const one=createArchiveSession(),two=createArchiveSession();
  one.library.scroll.set(archiveDetailKey('zh-CN','snapshot-a','doc-1'),400);
  expect(one.library.scroll.get(archiveDetailKey('en','snapshot-a','doc-1'))).toBeUndefined();
  expect(one.library.scroll.get(archiveDetailKey('zh-CN','snapshot-b','doc-1'))).toBeUndefined();
  expect(one.library.scroll.get(archiveDetailKey('zh-CN','snapshot-a','doc-2'))).toBeUndefined();
  expect(two.library.scroll.get(archiveDetailKey('zh-CN','snapshot-a','doc-1'))).toBeUndefined();
  expect(one.museum.scroll.get(archiveDetailKey('zh-CN','snapshot-a','doc-1'))).toBeUndefined();
 });
 it('resolves a snapshot alias without losing filters, pagination, language or page size',()=>{
  expect(resolvedListKey('language=en&page=2&pageSize=48&sort=name&q=flower&category=material&includeInternal=true','snapshot-a')).toBe('language=en&page=2&pageSize=48&sort=name&q=flower&category=material&includeInternal=true&snapshotId=snapshot-a');
 });
});

it('reuses a resolved snapshot even when URL parameter order differs',()=>{
 const session=createArchiveSession();
 const result={characters:[],total:0,page:1,pageSize:48,snapshotId:'snapshot-a',ready:true,counts:{},regions:[]};
 session.characters.lists.set('language=zh-CN&page=1&includeInternal=true',result,['language=zh-CN&page=1&includeInternal=true&snapshotId=snapshot-a']);
 expect(session.characters.lists.get('language=zh-CN&page=1&snapshotId=snapshot-a&includeInternal=true')).toBe(result);
});
