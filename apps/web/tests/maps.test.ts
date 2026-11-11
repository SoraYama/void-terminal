import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtemp, mkdir, readFile, writeFile, rm, unlink, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {existsSync} from 'node:fs';
import path from 'node:path';
import ormos from './fixtures/maps/ormos-7.2.json';
import {loadMapSnapshot, getMapCatalog, searchMapRegions, queryMapResources} from '../src/lib/server/maps';
import {POST as queryRoute} from '../src/app/api/maps/query/route';
import {GET as regionRoute} from '../src/app/api/maps/regions/route';
import {GET as assetRoute} from '../src/app/api/maps/assets/[snapshotId]/[...asset]/route';
import {mapCardSchema} from '../src/lib/map-cards';
import {distanceToIntersectionBoundary,intersectionBoundary,type XY} from '../src/lib/server/map-spatial';

const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
let root: string;
async function fixture(bundle: unknown = ormos, assets: Record<string, Buffer> = {}) {
  const data = JSON.stringify(bundle);
  const index = JSON.stringify(Object.fromEntries(Object.entries(assets).map(([name, bytes]) => [name, {sha256: sha(bytes), bytes: bytes.length}])));
  const dataHash = sha(data), assetsHash = sha(index);
  const id = `map-7.2-${sha(`${dataHash}\n${assetsHash}\n`).slice(0, 16)}`;
  const dir = path.join(root, id);
  await mkdir(path.join(dir, 'assets'), {recursive: true});
  await writeFile(path.join(dir, 'bundle.json'), data);
  await writeFile(path.join(dir, 'assets.json'), index);
  await writeFile(path.join(dir, 'manifest.json'), JSON.stringify({schema: 1, id, gameVersion: '7.2', sourceTime: '2026-11-09T20:39:02.715Z', dataHash, assetsHash, map: {key: 'teyvat', revision: 'v72-rc1', minZoom: 10, maxZoom: 15, tileSize: 256}}));
  for (const [name, bytes] of Object.entries(assets)) await writeFile(path.join(dir, 'assets', name), bytes);
  await writeFile(path.join(root, 'current.json'), JSON.stringify({snapshotId: id}));
  return {id, dir};
}
const square = (left: number, bottom: number, right: number, top: number, height: [number, number] = [0, 10]) => ({ring: [[left,bottom],[right,bottom],[right,top],[left,top]], height});
function geometryFixture() {
  return {schema: 1, version: ormos.version, sources: {}, types: {o403: '草神瞳'}, typesEn: {o403: 'Dendroculus'},
    models: {'4': {matrix: [[.001,0],[0,.001],[0,0]], uncertaintyWorld: .5, matchedAreaIds: [21]}},
    areas: [
      {id: 4200, name: '父区', sceneId: 3, areaId1: 21, areaId2: null, cityId: 4, polygons: [square(0,0,10,10)]},
      {id: 4203, name: '子区', sceneId: 3, areaId1: 21, areaId2: 2103, cityId: 4, polygons: [square(2,2,12,8)]},
      {id: 4204, name: '重叠区', sceneId: 3, areaId1: 21, areaId2: 2104, cityId: 4, polygons: [square(4,4,6,6)]},
    ], points: [
      {id: 1, type: 'o403', mid: 2, lng: .003, lat: .003, meta: ''},
      {id: 2, type: 'o403', mid: 2, lng: .011, lat: .005, meta: ''},
      {id: 3, type: 'o403', mid: 2, lng: .005, lat: .005, meta: ''},
      {id: 4, type: 'o403', mid: 2, lng: .004, lat: .004, meta: ''},
      {id: 5, type: 'o403', mid: 2, lng: .0021, lat: .003, meta: ''},
    ], crosschecks: {'1': {xyz: [3,0,3]}, '2': {xyz: [11,5,5]}, '3': {xyz: [5,10,5]}, '4': {xyz: [4,11,4]}}};
}
beforeEach(async () => {root = await mkdtemp(path.join(tmpdir(), 'void-maps-')); vi.stubEnv('MAP_DATA_DIR', root);});
afterEach(async () => {vi.unstubAllEnvs(); vi.unstubAllGlobals(); await rm(root, {recursive: true, force: true});});

describe('immutable map snapshots and deterministic geometry', () => {
  it('measures clipped oblique edges and intersection corners rather than the original rings', () => {
    const diamond:XY[]=[[-3,0],[0,3],[3,0],[0,-3]];
    const rectangle:XY[]=[[0,-2],[2,-2],[2,2],[0,2]];
    const boundary=intersectionBoundary([diamond],[rectangle]);
    expect(distanceToIntersectionBoundary([2.2,0],boundary)).toBeCloseTo(.2,10);
    expect(distanceToIntersectionBoundary([2.5,2],boundary)).toBeCloseTo(1.5/Math.SQRT2,10);
    expect(distanceToIntersectionBoundary([0,6],boundary)).toBeCloseTo(4,10);
    expect(distanceToIntersectionBoundary([0,0],intersectionBoundary([diamond],[[[8,8],[9,8],[9,9],[8,9]]]))).toBe(Infinity);
    expect(distanceToIntersectionBoundary([3.2,0],intersectionBoundary([diamond],[[[3,0],[4,0],[4,1],[3,1]]]))).toBeCloseTo(.2,10);
  });
  it('prepares a reproducible snapshot without changing inputs or overwriting an existing snapshot', async () => {
    const source=path.join(root,'input.json'), assets=path.join(root,'input-assets'), output=path.join(root,'prepared');
    await writeFile(source,JSON.stringify(ormos)); await mkdir(assets);
    await writeFile(path.join(assets,'icon_403.png'),Buffer.from('89504e470d0a1a0a00000000','hex'));
    const script=path.resolve(process.cwd(),'../../scripts/prepare-map-data.py');
    const args=[script,'--bundle',source,'--assets',assets,'--output',output];
    const before=await readFile(source);
    execFileSync('python3',args);
    vi.stubEnv('MAP_DATA_DIR',output);
    const snapshot=await loadMapSnapshot();
    execFileSync('python3',args);
    expect((await loadMapSnapshot()).id).toBe(snapshot.id);
    expect(await readFile(source)).toEqual(before);
    await writeFile(path.join(output,snapshot.id,'bundle.json'),'corrupt');
    expect(()=>execFileSync('python3',args,{stdio:'pipe'})).toThrow();
    expect(await readFile(path.join(output,snapshot.id,'bundle.json'),'utf8')).toBe('corrupt');
  });
  it('counts the actual Ormos points and reprojects 3D crosschecks onto its boundary', async () => {
    const {id} = await fixture();
    const snapshot = await loadMapSnapshot();
    expect(snapshot.id).toBe(id);
    const result = queryMapResources(snapshot, {region: 'Port Ormos', resource: 'Dendroculus', country: 'Sumeru'});
    expect(result).toHaveProperty('card');
    if (!('card' in result)) throw new Error(result.message);
    expect(result.card.count).toBe(2);
    expect(result.card.markers.filter(p => p.role === 'included').map(p => p.id)).toEqual([33876,33877]);
    expect(result.card.status).toBe('crosschecked');
    expect(result.card.review).toEqual({boundary: 0, unknownHeight: 0, overlap: 0});
    expect(result.card.markers.find(p => p.id === 33877)?.height).toBeGreaterThanOrEqual(-2);
    expect(result.card.markers.find(p => p.id === 33877)?.y).toBeGreaterThan(0);
    expect(result.card.markers.filter(p => p.role === 'nearby').map(p => p.id).sort()).toEqual([33859,33860]);
    expect(mapCardSchema.safeParse(result.card).success).toBe(true);
  });
  it('uses parent XZ, closed height bounds, unknown height, uncertainty, and sibling overlap', async () => {
    await fixture(geometryFixture());
    const result = queryMapResources(await loadMapSnapshot(), {region: '4203', resource: 'o403'});
    if (!('card' in result)) throw new Error(result.message);
    expect(result.card.markers.filter(p => p.role === 'included').map(p => p.id)).toEqual([1,3,5]);
    expect(result.card.review).toEqual({boundary: 1, unknownHeight: 1, overlap: 1});
    expect(result.card.status).toBe('requires-review');
  });
  it('reviews only the effective parent-child boundary and returns the projected parent clipping rings', async () => {
    const data=geometryFixture();
    data.points=[data.points[0],
      {id:6,type:'o403',mid:2,lng:.0102,lat:.005,meta:''},
      {id:7,type:'o403',mid:2,lng:.0102,lat:.0095,meta:''},
      {id:8,type:'o403',mid:2,lng:.0002,lat:.0095,meta:''},
      {id:9,type:'o403',mid:2,lng:.0118,lat:.005,meta:''},
      {id:10,type:'o403',mid:2,lng:.0102,lat:.0082,meta:''},
    ];
    await fixture(data); const snapshot=await loadMapSnapshot();
    const result=queryMapResources(snapshot,{region:'4203',resource:'o403'});
    expect(result).toMatchObject({card:{count:1,status:'requires-review',review:{boundary:2,unknownHeight:0,overlap:0},parentPolygons:[[[0,-0],[.01,-0],[.01,-.01],[0,-.01]]]}});
    if('card' in result)expect(result.card.markers.filter(p=>p.role==='review').map(p=>p.id).sort((a,b)=>a-b)).toEqual([6,10]);
    const parent=queryMapResources(snapshot,{region:'4200',resource:'o403'});
    if('card' in parent)expect(parent.card).not.toHaveProperty('parentPolygons');
  });
  it.each([4,6])('does not treat overlapping or adjoining polygon seams as union boundaries (start=%s)', async start => {
    const data=geometryFixture();
    data.areas[1].polygons=[square(2,2,6,8),square(start,2,12,8)];
    data.points=[{id:6,type:'o403',mid:2,lng:.0061,lat:.005,meta:''}];
    data.crosschecks={} as typeof data.crosschecks;
    await fixture(data);
    expect(queryMapResources(await loadMapSnapshot(),{region:'4203',resource:'o403'})).toMatchObject({card:{count:1,review:{boundary:0,unknownHeight:1}}});
  });
  it('preserves a polygon union and rejects unsupported, absent, ambiguous or unanchored scopes', async () => {
    const data = geometryFixture();
    data.areas[1].polygons = [square(2,2,4,4), square(5,5,6,6)];
    data.areas.push({...data.areas[1], id: 4303, cityId: 5});
    data.areas.push({...data.areas[1], id: 4403, name: '缺围栏', polygons: []});
    data.areas.push({...data.areas[1], id: 4503, name: '独立场景', sceneId: 5});
    data.areas.push({...data.areas[1], id: 4603, name: '无锚点', areaId1: 22});
    await fixture(data); const snapshot = await loadMapSnapshot();
    const union=queryMapResources(snapshot,{region:'4203',resource:'o403'});
    expect(union).toMatchObject({card:{count:3}});
    if('card' in union) expect(union.card.markers.filter(p=>p.role==='included').map(p=>p.id)).toEqual([1,3,5]);
    expect(queryMapResources(snapshot, {region: '子区', resource: 'o403'})).toMatchObject({error: 'REGION_AMBIGUOUS', candidates: [{id: 4203}, {id: 4303}]});
    expect(queryMapResources(snapshot, {region: '缺围栏', resource: 'o403'})).toMatchObject({error: 'MISSING_BOUNDARY'});
    expect(queryMapResources(snapshot, {region: '独立场景', resource: 'o403'})).toMatchObject({error: 'UNSUPPORTED_SCENE'});
    expect(queryMapResources(snapshot, {region: '无锚点', resource: 'o403'})).toMatchObject({error: 'UNCALIBRATED_REGION'});
    expect(queryMapResources(snapshot, {region: '须弥附近', resource: 'o403'})).toMatchObject({error: 'SCOPE_REQUIRED'});
    expect(searchMapRegions(snapshot, '子区', 'Sumeru').map(r => r.id)).toEqual([4203]);
    expect(getMapCatalog(snapshot).regions.find(r => r.id === 4203)?.parentName).toBe('父区');
    data.areas[0].polygons=[]; await fixture(data);
    expect(queryMapResources(await loadMapSnapshot(),{region:'4203',resource:'o403'})).toMatchObject({error:'MISSING_PARENT_BOUNDARY'});
  });
  it('reports full counts while bounding included markers, and rejects ambiguous resource names', async () => {
    const data = geometryFixture();
    data.points = Array.from({length: 530}, (_, i) => ({id: i + 1, type: 'o403', mid: 2, lng: .003, lat: .003, meta: ''}));
    data.crosschecks = {} as typeof data.crosschecks;
    await fixture(data); const snapshot = await loadMapSnapshot();
    const result = queryMapResources(snapshot, {region: '4203', resource: 'o403'});
    if (!('card' in result)) throw new Error(result.message);
    expect(result.card.count).toBe(530); expect(result.card.markers).toHaveLength(500); expect(result.card.truncated).toBe(true);
    expect(mapCardSchema.safeParse(result.card).success).toBe(true);
    await fixture({...data, types: {o403: '草神瞳', o404: '草神瞳'}});
    expect(queryMapResources(await loadMapSnapshot(), {region: '4203', resource: '草神瞳'})).toMatchObject({error: 'RESOURCE_AMBIGUOUS'});
  });
  it('returns bounded resource-name candidates without turning broad categories into counts', async () => {
    const data=geometryFixture();
    await fixture({...data,types:{o17:'普通的宝箱',o44:'精致的宝箱',o45:'珍贵的宝箱',o403:'草神瞳'},typesEn:{o17:'Common Chest',o44:'Exquisite Chest',o45:'Precious Chest',o403:'Dendroculus'}});
    const snapshot=await loadMapSnapshot();
    expect(queryMapResources(snapshot,{region:'4203',resource:'宝箱'})).toMatchObject({error:'RESOURCE_NOT_FOUND',candidates:[{id:'o17'},{id:'o44'},{id:'o45'}]});
    expect(queryMapResources(snapshot,{region:'4203',resource:'chest'})).toMatchObject({error:'RESOURCE_NOT_FOUND',candidates:[{id:'o17'},{id:'o44'},{id:'o45'}]});
    expect(queryMapResources(snapshot,{region:'4203',resource:'材料'})).toEqual(expect.not.objectContaining({card:expect.anything()}));
  });
  it('refuses corrupted files and missing historical snapshots without latest fallback', async () => {
    const {id, dir} = await fixture(); await loadMapSnapshot(id);
    await writeFile(path.join(dir, 'bundle.json'), '{}');
    await expect(loadMapSnapshot(id)).rejects.toMatchObject({code: 'MAP_DATA_CORRUPT'});
    await expect(loadMapSnapshot('map-7.2-deadbeef')).rejects.toMatchObject({code: 'MAP_SNAPSHOT_UNAVAILABLE'});
    await expect(loadMapSnapshot('../current')).rejects.toMatchObject({code: 'INVALID_SNAPSHOT_ID'});
  });
  it('does not trust changed manifest metadata after a bundle has been cached', async () => {
    const {id,dir}=await fixture(); await loadMapSnapshot(id);
    const manifest=JSON.parse(await readFile(path.join(dir,'manifest.json'),'utf8'));
    manifest.sourceTime='2026-11-10T20:39:02.715Z';
    await writeFile(path.join(dir,'manifest.json'),JSON.stringify(manifest));
    await expect(loadMapSnapshot(id)).rejects.toMatchObject({code:'MAP_DATA_CORRUPT'});
  });
  it('rejects a changed asset index before serving a snapshot', async () => {
    const {id,dir}=await fixture();
    await writeFile(path.join(dir,'assets.json'),'{}\n');
    await expect(loadMapSnapshot(id)).rejects.toMatchObject({code:'MAP_DATA_CORRUPT'});
  });
  const retained=path.resolve(process.cwd(),'../../data/maps');
  it.skipIf(!existsSync(path.join(retained,'current.json')))('accepts the complete retained snapshot and counts real Ormos points', async () => {
    vi.stubEnv('MAP_DATA_DIR',retained);
    const snapshot=await loadMapSnapshot();
    const catalog=getMapCatalog(snapshot);
    expect(catalog.regions).toHaveLength(597); expect(catalog.resources).toHaveLength(759);
    const result=queryMapResources(snapshot,{region:'奥摩斯港',resource:'草神瞳',country:'须弥'});
    expect(result).toMatchObject({card:{count:2,status:'crosschecked',truncated:false,region:{nameEn:'Port Ormos',countryEn:'Sumeru',parentNameEn:'Ardravi Valley'}}});
    if('card' in result)expect(result.card.markers.filter(p=>p.role==='included').map(p=>p.id)).toEqual([33876,33877]);
  });
  it.skipIf(!existsSync(path.join(retained,'current.json')))('flags Windrise point 347 near the effective parent boundary without changing the Ormos count', async () => {
    vi.stubEnv('MAP_DATA_DIR',retained);
    const snapshot=await loadMapSnapshot();
    const result=queryMapResources(snapshot,{region:'风起地',resource:'风神瞳'});
    expect(result).toMatchObject({card:{status:'requires-review'}});
    if(!('card' in result))throw new Error(result.message);
    expect(result.card.review.boundary).toBeGreaterThan(0);
    expect(result.card.markers.find(p=>p.id===347)).toMatchObject({role:'review',coordinateEvidence:'calibrated-projection'});
    expect(queryMapResources(snapshot,{region:'奥摩斯港',resource:'草神瞳'})).toMatchObject({card:{count:2,status:'crosschecked',review:{boundary:0}}});
  });
  it('honors cancellation before IO and rejects nonabsolute deployment directories', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(loadMapSnapshot(undefined, controller.signal)).rejects.toMatchObject({name: 'AbortError'});
    vi.stubEnv('MAP_DATA_DIR', 'relative/path');
    await expect(loadMapSnapshot()).rejects.toMatchObject({code: 'MAP_DATA_CONFIG'});
  });
});

describe('bounded public map routes', () => {
  it('returns valid query cards and country-filtered region hits', async () => {
    await fixture();
    const response = await queryRoute(new Request('http://localhost/api/maps/query', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({region:'奥摩斯港',resource:'草神瞳'})}));
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({card:{count:2}});
    const regions = await regionRoute(new Request('http://localhost/api/maps/regions?q=Ormos&country=Sumeru'));
    expect(await regions.json()).toMatchObject({regions:[{id:4203}]});
  });
  it('rejects oversized or unknown query fields before reading map data', async () => {
    for (const body of [{region:'a',resource:'b',url:'https://evil.test'}, {region:'a'.repeat(201),resource:'b'}]) {
      const response = await queryRoute(new Request('http://localhost/api/maps/query', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}));
      expect(response.status).toBe(400);
    }
    const response = await queryRoute(new Request('http://localhost/api/maps/query', {method:'POST',headers:{'content-type':'application/json'},body:' '.repeat(9000)}));
    expect(response.status).toBe(413);
  });
  it('serves only indexed hash-checked image assets and rejects traversal or arbitrary URLs', async () => {
    const png = Buffer.from('89504e470d0a1a0a00000000', 'hex');
    const {id, dir} = await fixture(ormos, {'icon_403.png':png});
    const request = new Request('http://localhost/api/maps/assets');
    const response = await assetRoute(request, {params:Promise.resolve({snapshotId:id,asset:['icons','o403.png']})});
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toContain('immutable');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(png);
    for (const asset of [['..','manifest.json'],['icons','../../secret'],['tiles','https://evil.test','15','1','2.jpg'],['tiles','teyvat','16','1','2.jpg']]) {
      expect((await assetRoute(request,{params:Promise.resolve({snapshotId:id,asset})})).status).toBe(400);
    }
    await writeFile(path.join(dir,'assets','icon_403.png'),'corrupt');
    expect((await assetRoute(request,{params:Promise.resolve({snapshotId:id,asset:['icons','o403.png']})})).status).toBe(503);
    await unlink(path.join(dir,'assets','icon_403.png'));
    await writeFile(path.join(root,'outside.png'),png);
    await symlink(path.join(root,'outside.png'),path.join(dir,'assets','icon_403.png'));
    expect((await assetRoute(request,{params:Promise.resolve({snapshotId:id,asset:['icons','o403.png']})})).status).toBe(503);
  });
  it('fails clearly when a missing tile cannot be fetched from its fixed trusted origin', async () => {
    const {id} = await fixture();
    vi.stubGlobal('fetch', async (url: string | URL) => {
      expect(String(url)).toBe('https://game-cdn.appsample.com/gim/map-teyvat/v72-rc1/15/tile-20_-13.jpg');
      return new Response('not an image',{headers:{'content-type':'text/html'}});
    });
    const response = await assetRoute(new Request('http://localhost/api/maps/assets'),{params:Promise.resolve({snapshotId:id,asset:['tiles','teyvat','15','20','-13.jpg']})});
    expect(response.status).toBe(502); expect(await response.json()).toMatchObject({error:'MAP_TILE_UNAVAILABLE'});
  });
});
