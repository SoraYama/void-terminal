import {z} from 'zod';
import type {Locale} from './contracts';
import {mapSnapshotIdSchema, type MapRegionHit} from './map-cards';

const name = z.string().min(1).max(200);
export const mapCatalogSchema = z.object({
  snapshotId: mapSnapshotIdSchema,
  gameVersion: z.string().min(1).max(40),
  sourceTime: z.string().datetime(),
  regions: z.array(z.object({
    id: z.number().int().positive(), name, nameEn: name.optional(),
    country: z.string().max(100), countryEn: z.string().max(100).optional(),
    parentName: z.string().max(200), parentNameEn: z.string().max(200).optional(),
    sceneId: z.number().int().positive(), hasBoundary: z.boolean(), calibrated: z.boolean(),
  }).strict()).min(1).max(10000),
  resources: z.array(z.object({id: z.string().regex(/^o\d{1,8}$/), name, nameEn: name.optional()}).strict()).min(1).max(10000),
}).strict().superRefine((catalog, ctx) => {
  if (new Set(catalog.regions.map(region => region.id)).size !== catalog.regions.length
    || new Set(catalog.resources.map(resource => resource.id)).size !== catalog.resources.length) {
    ctx.addIssue({code: 'custom', message: 'Duplicate catalog IDs'});
  }
});
export type MapCatalog = z.infer<typeof mapCatalogSchema>;
export interface MapWorkspaceQuery {region: string; resource: string; snapshotId: string; error?: string}
type NamedEntry = {id: number | string; name: string; nameEn?: string};
const normalized = (value: string) => value.normalize('NFKC').trim().toLocaleLowerCase('en');

export function mapEntryLabel(entry: {name: string; nameEn?: string}, locale: Locale): string {
  return locale === 'en' && entry.nameEn || entry.name;
}
export function mapEntryMatches(entry: NamedEntry, search: string): boolean {
  const term = normalized(search);
  return [String(entry.id), entry.name, entry.nameEn || ''].some(value => normalized(value).includes(term));
}
export function readMapWorkspaceQuery(search: string): MapWorkspaceQuery {
  const params = new URLSearchParams(search);
  const result: MapWorkspaceQuery = {region: params.get('region')?.trim() || '', resource: params.get('resource')?.trim() || '', snapshotId: params.get('snapshotId') || ''};
  if (['region', 'resource', 'snapshotId'].some(key => params.getAll(key).length > 1)
    || result.region.length > 200 || result.resource.length > 200
    || ['region', 'resource', 'snapshotId'].some(key => params.has(key) && !params.get(key)?.trim())) result.error = 'INVALID_MAP_QUERY';
  if (result.snapshotId && !mapSnapshotIdSchema.safeParse(result.snapshotId).success) result.error = 'INVALID_SNAPSHOT_ID';
  return result;
}
export function mapWorkspaceUrl(query: MapWorkspaceQuery): string {
  const params = new URLSearchParams();
  for (const key of ['region', 'resource', 'snapshotId'] as const) if (query[key]) params.set(key, query[key]);
  return `/map${params.size ? `?${params}` : ''}`;
}
function exactEntry<T extends NamedEntry>(entries: T[], value: string): T | undefined {
  const byId = entries.find(entry => String(entry.id) === value);
  if (byId) return byId;
  const matches = entries.filter(entry => [entry.name, entry.nameEn].some(label => label && normalized(label) === normalized(value)));
  return matches.length === 1 ? matches[0] : undefined;
}
/** Defaults are resolved against this catalog; an explicit missing selection never silently changes. */
export function resolveMapWorkspaceQuery(query: MapWorkspaceQuery, catalog: MapCatalog) {
  const region = query.region ? exactEntry(catalog.regions, query.region)
    : catalog.regions.find(entry => entry.id === 4203)
      || catalog.regions.find(entry => !mapRegionAvailability(entry)) || catalog.regions[0];
  const resource = query.resource ? exactEntry(catalog.resources, query.resource)
    : catalog.resources.find(entry => entry.id === 'o403') || catalog.resources[0];
  const error = query.error || (query.snapshotId && query.snapshotId !== catalog.snapshotId ? 'MAP_RESULT_MISMATCH'
    : !region ? 'REGION_NOT_FOUND' : !resource ? 'RESOURCE_NOT_FOUND' : '');
  return {region, resource, error, query: {
    region: region ? String(region.id) : query.region,
    resource: resource?.id || query.resource,
    snapshotId: catalog.snapshotId,
    ...(error ? {error} : {}),
  } satisfies MapWorkspaceQuery};
}
export function mapRegionAvailability(region: Pick<MapRegionHit, 'hasBoundary' | 'sceneId' | 'calibrated'>): string {
  return !region.hasBoundary ? 'MISSING_BOUNDARY' : region.sceneId !== 3 ? 'UNSUPPORTED_SCENE' : !region.calibrated ? 'UNCALIBRATED_REGION' : '';
}

const countryNames: Record<string, string> = {蒙德: 'Mondstadt', 璃月: 'Liyue', 稻妻: 'Inazuma', 须弥: 'Sumeru', 枫丹: 'Fontaine', 纳塔: 'Natlan', 至冬: 'Snezhnaya'};
export function mapCountryLabel(country: string, locale: Locale): string {
  return country ? locale === 'en' ? countryNames[country] || country : country : locale === 'en' ? 'Other regions' : '其他区域';
}

export function mapWorkspaceError(code: string, locale: Locale): {title: string; detail: string; retryable: boolean} {
  const zh = locale === 'zh-CN';
  const messages: Record<string, [string, string, string, string]> = {
    MISSING_BOUNDARY: ['此区域暂无核验边界', '选择其他区域查看资源。缺少边界时不会给出数量。', 'No verified boundary for this region', 'Choose another region. A missing boundary cannot establish a resource count.'],
    MISSING_PARENT_BOUNDARY: ['上级区域暂无核验边界', '暂时无法确认区域归属，请选择其他区域。', 'Parent boundary is unavailable', 'This region cannot be checked against its parent. Choose another region.'],
    UNSUPPORTED_SCENE: ['此独立场景暂不支持地图查询', '场景坐标尚未校准，请选择大世界中已校准的区域。', 'This independent scene is not supported yet', 'Its map coordinates are not calibrated. Choose a calibrated overworld region.'],
    UNCALIBRATED_REGION: ['此区域的地图坐标尚未校准', '暂时无法可靠定位资源，请选择其他区域。', 'This region is not calibrated yet', 'Resource positions cannot be established reliably. Choose another region.'],
    REGION_NOT_FOUND: ['目录中找不到此区域', '请从当前目录重新选择区域。', 'Region not found in this catalog', 'Select a region from the current catalog.'],
    REGION_AMBIGUOUS: ['区域名称对应多个范围', '请从目录选择一个具体区域。', 'This region name is ambiguous', 'Choose a specific region from the catalog.'],
    RESOURCE_NOT_FOUND: ['目录中找不到此资源', '请从当前目录重新选择资源。', 'Resource not found in this catalog', 'Select a resource from the current catalog.'],
    RESOURCE_AMBIGUOUS: ['资源名称对应多个类型', '请从目录选择一种具体资源。', 'This resource name is ambiguous', 'Choose a specific resource from the catalog.'],
    INVALID_MAP_QUERY: ['地图地址中的查询条件无效', '请重新打开地图目录，或检查分享链接。', 'The map link contains invalid selections', 'Reopen the catalog or check the shared link.'],
    INVALID_SNAPSHOT_ID: ['地图地址中的快照无效', '请检查分享链接，或主动切换到当前地图目录。', 'The map snapshot in this link is invalid', 'Check the shared link or switch to the current catalog.'],
    MAP_SNAPSHOT_UNAVAILABLE: ['此地图快照暂不可用', '可以重试，或主动切换到当前地图目录。原链接不会自动改用其他快照。', 'This map snapshot is unavailable', 'Retry or switch to the current catalog. This link will not silently use a different snapshot.'],
    MAP_CARD_UNSUPPORTED: ['暂时无法显示此区域', '当前地图格式无法完整表达此范围，请选择其他区域。', 'This area cannot be displayed yet', 'The current map format cannot represent this boundary. Choose another region.'],
    MAP_RESULT_MISMATCH: ['地图结果与当前选择不一致', '请重试加载，确保区域、资源和目录来自同一快照。', 'The map result does not match your selection', 'Retry to load the region, resource and catalog from the same snapshot.'],
    SCOPE_REQUIRED: ['请指定一个目录区域', '选择区域后再查看其中的资源。', 'Choose a catalog region', 'Select a named region to view its resources.'],
  };
  const message = messages[code];
  return {
    title: message ? message[zh ? 0 : 2] : zh ? '地图数据暂不可用' : 'Map data is temporarily unavailable',
    detail: message ? message[zh ? 1 : 3] : zh ? '请稍后重试。当前无法确认资源位置或数量。' : 'Please retry. Resource positions and counts cannot be confirmed right now.',
    retryable: !message || ['MAP_SNAPSHOT_UNAVAILABLE', 'MAP_RESULT_MISMATCH'].includes(code),
  };
}
