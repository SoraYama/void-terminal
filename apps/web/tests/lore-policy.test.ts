import {describe,it,expect} from 'vitest';
import {overviewRegion} from '../src/lib/server/lore-policy';

describe('whole-arc overview routing',()=>{
 it.each(['梳理须弥魔神任务第三幕','比较须弥和枫丹魔神任务的主要脉络','概述须弥主线，不要剧透结局','须弥魔神任务里纳西妲为什么这样做？'])('retains focused research for %s',question=>{
  expect(overviewRegion(question,'zh-CN')).toBeUndefined();
 });
 it('uses the source language for an explicit single-region whole-arc overview',()=>{
  expect(overviewRegion('Summarize the Sumeru Archon Quest','zh-CN')).toBe('须弥');
  expect(overviewRegion('梳理须弥魔神任务的主要脉络','en')).toBe('Sumeru');
 });
});
