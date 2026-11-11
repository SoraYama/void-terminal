import {afterEach,describe,it,expect,vi} from 'vitest';
import {mapCardFixture} from './fixtures/map-card';
import type {ChatEvent,ChatRequest} from '../src/lib/contracts';
const maps=vi.hoisted(()=>({loadMapSnapshot:vi.fn(),getMapCatalog:vi.fn(),searchMapRegions:vi.fn(),queryMapResources:vi.fn()}));
vi.mock('../src/lib/server/maps',()=>({...maps,MapDataError:class extends Error{constructor(public code:string,message:string){super(message)}}}));
import {prepareMapResearch} from '../src/lib/server/map-research';
const input=(question:string):ChatRequest=>({messages:[{role:'user',content:question}],language:'zh-CN',mode:'byok',depth:'standard'});
afterEach(()=>vi.resetAllMocks());
function setup(){
 maps.loadMapSnapshot.mockResolvedValue({id:mapCardFixture.snapshotId,gameVersion:'7.2',sourceTime:mapCardFixture.sourceTime});
 maps.getMapCatalog.mockReturnValue({regions:[{...mapCardFixture.region,hasBoundary:true,calibrated:true}],resources:[mapCardFixture.resource]});
 maps.queryMapResources.mockReturnValue({card:mapCardFixture});
 maps.searchMapRegions.mockReturnValue([{...mapCardFixture.region,hasBoundary:true,calibrated:true}]);
}
describe('map research session',()=>{
 it('prepares verified map evidence without requiring corpus search, keeping a pinned dataset',async()=>{
  setup();const events:ChatEvent[]=[];
  const session=await prepareMapResearch({...input('须弥的奥摩斯港有多少草神瞳？'),mapSnapshotId:mapCardFixture.snapshotId},new AbortController().signal,e=>events.push(e));
  expect(session.active).toBe(true);expect(session.cards).toHaveLength(1);
  expect(session.context()).toContain('33876');expect(session.context()).not.toContain('polygons');
  expect(maps.loadMapSnapshot).toHaveBeenCalledWith(mapCardFixture.snapshotId,expect.any(AbortSignal));
  expect(events[0]).toMatchObject({event:'maps',data:{mapSnapshotId:mapCardFixture.snapshotId}});
  await session.execute('query_map_resources',{region:'奥摩斯港',resource:'草神瞳'});
  expect(maps.loadMapSnapshot).toHaveBeenCalledTimes(1);expect(session.cards).toHaveLength(1);
  expect(JSON.parse(await session.execute('query_map_resources',{region:'奥摩斯港',resource:'草神瞳',snapshotId:'other'}))).toMatchObject({error:'INVALID_MAP_ARGUMENTS'});
 });
 it('does not attach or pin maps for lore but exposes discovery tools',async()=>{
  setup();const session=await prepareMapResearch(input('纳西妲的角色故事'),new AbortController().signal,()=>{});
  expect(session.active).toBe(false);expect(session.cards).toEqual([]);expect(session.snapshotId).toBeUndefined();
  expect(session.tools.map(t=>t.name)).toEqual(['search_map_regions','query_map_resources']);
  await session.execute('search_map_regions',{query:'Port Ormos'});expect(maps.loadMapSnapshot).toHaveBeenCalledOnce();
 });
 it('recognizes a concrete ascension material without requiring the word map or material',async()=>{
  setup();maps.getMapCatalog.mockReturnValue({regions:[mapCardFixture.region],resources:[{id:'o9',name:'琉璃百合',nameEn:'Glaze Lily'}]});
  const session=await prepareMapResearch(input('奥摩斯港有多少琉璃百合'),new AbortController().signal,()=>{});
  expect(session.active).toBe(true);expect(maps.queryMapResources).toHaveBeenCalledWith(expect.anything(),{region:'4203',resource:'o9'});
 });
 it.each(['帮我找奥摩斯港的帕蒂沙兰','把奥摩斯港的帕蒂沙兰标出来','列出奥摩斯港的帕蒂沙兰'])('uses catalog recognition for %s',async question=>{
  setup();maps.getMapCatalog.mockReturnValue({regions:[mapCardFixture.region],resources:[{id:'o404',name:'帕蒂沙兰'}]});
  const session=await prepareMapResearch(input(question),new AbortController().signal,()=>{});
  expect(session.active).toBe(true);expect(maps.queryMapResources).toHaveBeenCalledWith(expect.anything(),{region:'4203',resource:'o404'});
 });
 it('preserves unavailable boundaries as a tool error without a fake empty card',async()=>{
  setup();maps.queryMapResources.mockReturnValue({error:'MISSING_BOUNDARY',message:'该区域没有可核验边界。'});
  const session=await prepareMapResearch(input('奥摩斯港草神瞳有几个'),new AbortController().signal,()=>{});
  expect(session.active).toBe(true);expect(session.cards).toEqual([]);expect(session.context()).toContain('MISSING_BOUNDARY');
 });
 it('retains the original map question for an underspecified followup and respects a new region',async()=>{
  setup();maps.getMapCatalog.mockReturnValue({regions:[mapCardFixture.region,{...mapCardFixture.region,id:4202,name:'维摩庄',nameEn:'Vimara Village'}],resources:[mapCardFixture.resource]});
  await prepareMapResearch({...input(''),mapSnapshotId:mapCardFixture.snapshotId,messages:[{role:'user',content:'奥摩斯港有多少草神瞳'},{role:'assistant',content:'2 个'},{role:'user',content:'那维摩庄呢？'}]},new AbortController().signal,()=>{});
  expect(maps.queryMapResources).toHaveBeenLastCalledWith(expect.anything(),{region:'4202',resource:'o403'});
 });
 it('does not silently select one duplicate region or turn a nearby request into a named boundary',async()=>{
  setup();maps.getMapCatalog.mockReturnValue({regions:[mapCardFixture.region,{...mapCardFixture.region,id:9999}],resources:[mapCardFixture.resource]});
  await prepareMapResearch(input('奥摩斯港有多少草神瞳'),new AbortController().signal,()=>{});
  expect(maps.queryMapResources).not.toHaveBeenCalled();
  setup();const session=await prepareMapResearch(input('奥摩斯港附近有多少草神瞳'),new AbortController().signal,()=>{});
  expect(session.context()).toContain('SCOPE_REQUIRED');expect(maps.queryMapResources).not.toHaveBeenCalled();
 });
 it('inherits the most recent named region across multiple followups',async()=>{
  setup();maps.getMapCatalog.mockReturnValue({regions:[mapCardFixture.region,{...mapCardFixture.region,id:4202,name:'维摩庄'}],resources:[mapCardFixture.resource,{id:'o44',name:'普通的宝箱'}]});
  await prepareMapResearch({...input(''),mapSnapshotId:mapCardFixture.snapshotId,messages:[{role:'user',content:'奥摩斯港有多少草神瞳'},{role:'assistant',content:'2 个'},{role:'user',content:'那维摩庄呢？'},{role:'assistant',content:'结果见地图'},{role:'user',content:'那里普通的宝箱呢？'}]},new AbortController().signal,()=>{});
  expect(maps.queryMapResources).toHaveBeenLastCalledWith(expect.anything(),{region:'4202',resource:'o44'});
 });
});
