import 'server-only';
import {createHash} from 'node:crypto';
import {readFile, realpath, stat} from 'node:fs/promises';
import path from 'node:path';
import {z} from 'zod';
import {mapSnapshotIdSchema} from '../map-cards';

export class MapDataError extends Error {
  constructor(public readonly code: string, message: string) {super(message); this.name = 'MapDataError';}
}
const finite = z.number().finite();
const xy = z.tuple([finite, finite]);
const polygon = z.object({ring: z.array(xy).min(3).max(1024), height: z.tuple([finite.nullable(), finite.nullable()]).optional()});
const area = z.object({id: z.number().int().positive(), name: z.string().max(200), nameEn: z.string().max(200).optional(), sceneId: z.number().int().positive(), areaId1: z.number().int(), areaId2: z.number().int().nullable().optional(), cityId: z.number().int().nullable(), polygons: z.array(polygon).max(16)});
const model = z.object({matrix: z.tuple([xy,xy,xy]), uncertaintyWorld: finite.nonnegative(), matchedAreaIds: z.array(z.number().int())});
const resourceId = z.string().regex(/^o\d{1,8}$/);
const bundleSchema = z.object({
  schema: z.literal(1), version: z.object({appsample: z.string(), snapshotTime: z.string().datetime()}),
  areas: z.array(area).min(1).max(10000), models: z.record(z.string(),model),
  points: z.array(z.object({id: z.number().int().positive(), type: resourceId, mid: z.number().int(), lng: finite.min(-180).max(180), lat: finite.min(-85).max(85), meta: z.string().max(1000)})).max(200000),
  types: z.record(resourceId,z.string().max(200)), typesEn: z.record(resourceId,z.string().max(200)).optional(),
  crosschecks: z.record(z.string(),z.object({xyz: z.tuple([finite,finite,finite]), sourceBlobURL: z.string().optional(), sourceURL: z.string().optional()})),
});
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const mapSchema = z.object({key:z.literal('teyvat'), revision:z.literal('v72-rc1'), minZoom:z.literal(10), maxZoom:z.literal(15), tileSize:z.literal(256)}).strict();
const manifestSchema = z.object({schema:z.literal(1), id:mapSnapshotIdSchema, gameVersion:z.literal('7.2'), sourceTime:z.string().datetime(), dataHash:hash, assetsHash:hash, map:mapSchema}).strict();
const assetsSchema = z.record(z.string().regex(/^(?:icon_\d{1,8}\.png|teyvat_1[0-5]_-?\d{1,5}_-?\d{1,5}\.jpg)$/),z.object({sha256:hash,bytes:z.number().int().positive().max(2_000_000)}).strict());
export type MapBundle = z.infer<typeof bundleSchema>;
export type MapArea = MapBundle['areas'][number];
export type MapModel = MapBundle['models'][string];
export interface MapSnapshot {readonly id:string; readonly gameVersion:string; readonly sourceTime:string}
export interface SnapshotData {bundle:MapBundle; manifest:z.infer<typeof manifestSchema>; assets:z.infer<typeof assetsSchema>; directory:string}
const loaded = new WeakMap<MapSnapshot,SnapshotData>();
const parsedCache = new Map<string,MapBundle>();
export function snapshotData(snapshot:MapSnapshot):SnapshotData {
  const result=loaded.get(snapshot);
  if (!result) throw new MapDataError('MAP_DATA_CORRUPT','Map snapshot was not loaded from the verified store.');
  return result;
}
export const sha256 = (bytes:Uint8Array|string) => createHash('sha256').update(bytes).digest('hex');
export function mapDataDirectory():string {
  const configured=process.env.MAP_DATA_DIR;
  if(configured){if(!path.isAbsolute(configured)) throw new MapDataError('MAP_DATA_CONFIG','MAP_DATA_DIR must be an absolute directory.'); return configured;}
  const cwd=process.cwd();
  return path.resolve(path.basename(cwd)==='web' && path.basename(path.dirname(cwd))==='apps' ? path.join(cwd,'../..') : cwd,'data/maps');
}
/** No dataset or asset symlink may escape its configured immutable store. */
export async function readMapFile(root:string, relative:string, limit:number, signal?:AbortSignal):Promise<Buffer> {
  signal?.throwIfAborted();
  const directory=await realpath(root), file=await realpath(path.join(directory,relative));
  if(!file.startsWith(directory+path.sep)) throw new MapDataError('MAP_DATA_CORRUPT','Map data path escaped its snapshot.');
  const details=await stat(file);
  if(!details.isFile() || details.size>limit) throw new MapDataError('MAP_DATA_CORRUPT','Map data exceeds its allowed size.');
  const bytes=await readFile(file,{signal});
  signal?.throwIfAborted();
  if(bytes.length>limit) throw new MapDataError('MAP_DATA_CORRUPT','Map data exceeds its allowed size.');
  return bytes;
}
function parseJSON(bytes:Buffer):unknown {try{return JSON.parse(bytes.toString('utf8'));}catch{throw new MapDataError('MAP_DATA_CORRUPT','Map data contains invalid JSON.');}}
function corrupt():never {throw new MapDataError('MAP_DATA_CORRUPT','Map snapshot failed integrity validation.');}
async function readManifest(root:string,snapshotId:string,signal?:AbortSignal) {
  if(!mapSnapshotIdSchema.safeParse(snapshotId).success) throw new MapDataError('INVALID_SNAPSHOT_ID','Invalid map snapshot ID.');
  const result=manifestSchema.safeParse(parseJSON(await readMapFile(root,`${snapshotId}/manifest.json`,65536,signal)));
  if(!result.success) corrupt();
  const manifest=result.data;
  if(manifest.id!==snapshotId || snapshotId!==`map-${manifest.gameVersion}-${sha256(`${manifest.dataHash}\n${manifest.assetsHash}\n`).slice(0,16)}`) corrupt();
  return manifest;
}
async function readAssets(root:string,manifest:z.infer<typeof manifestSchema>,signal?:AbortSignal) {
  const bytes=await readMapFile(root,`${manifest.id}/assets.json`,2_000_000,signal);
  if(sha256(bytes)!==manifest.assetsHash)corrupt();
  const parsed=assetsSchema.safeParse(parseJSON(bytes));
  if(!parsed.success)corrupt();
  return parsed.data;
}
/** Tiles verify their own immutable index and bytes; they never parse the point database. */
export async function loadMapAssetStore(snapshotId:string,signal?:AbortSignal):Promise<Omit<SnapshotData,'bundle'>> {
  signal?.throwIfAborted();
  const root=mapDataDirectory();
  try{
    const manifest=await readManifest(root,snapshotId,signal),assets=await readAssets(root,manifest,signal);
    return {manifest,assets,directory:path.join(root,snapshotId)};
  }catch(error){
    signal?.throwIfAborted();
    if(error instanceof MapDataError)throw error;
    throw new MapDataError('MAP_SNAPSHOT_UNAVAILABLE','The requested map snapshot is unavailable. Prepare or mount that exact snapshot.');
  }
}
export async function loadMapSnapshot(snapshotId?:string,signal?:AbortSignal):Promise<MapSnapshot> {
  signal?.throwIfAborted();
  if(snapshotId!==undefined && !mapSnapshotIdSchema.safeParse(snapshotId).success) throw new MapDataError('INVALID_SNAPSHOT_ID','Invalid map snapshot ID.');
  const root=mapDataDirectory();
  try {
    if(snapshotId===undefined){
      const current=z.object({snapshotId:mapSnapshotIdSchema}).strict().safeParse(parseJSON(await readMapFile(root,'current.json',2048,signal)));
      if(!current.success) corrupt();
      snapshotId=current.data.snapshotId;
    }
    const manifest=await readManifest(root,snapshotId,signal);
    const [bytes,assets]=await Promise.all([readMapFile(root,`${snapshotId}/bundle.json`,32_000_000,signal),readAssets(root,manifest,signal)]);
    if(sha256(bytes)!==manifest.dataHash) corrupt();
    let bundle=parsedCache.get(manifest.dataHash);
    if(!bundle){
      const parsed=bundleSchema.safeParse(parseJSON(bytes));
      if(!parsed.success) corrupt();
      bundle=parsed.data;
      if(new Set(bundle.areas.map(a=>a.id)).size!==bundle.areas.length || new Set(bundle.points.map(p=>p.id)).size!==bundle.points.length) corrupt();
      if(parsedCache.size>=2) parsedCache.delete(parsedCache.keys().next().value!);
      parsedCache.set(manifest.dataHash,bundle);
    }
    if(bundle.version.appsample!==manifest.gameVersion || bundle.version.snapshotTime!==manifest.sourceTime) corrupt();
    signal?.throwIfAborted();
    const snapshot=Object.freeze({id:snapshotId,gameVersion:manifest.gameVersion,sourceTime:manifest.sourceTime});
    loaded.set(snapshot,{bundle,manifest,assets,directory:path.join(root,snapshotId)});
    return snapshot;
  } catch(error) {
    signal?.throwIfAborted();
    if(error instanceof MapDataError) throw error;
    throw new MapDataError('MAP_SNAPSHOT_UNAVAILABLE','The requested map snapshot is unavailable. Prepare or mount that exact snapshot.');
  }
}
