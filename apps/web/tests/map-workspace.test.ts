import {describe, expect, it} from 'vitest';
import {mapCatalogSchema, mapCountryLabel, mapEntryMatches, mapRegionAvailability,
  mapWorkspaceError, mapWorkspaceUrl, readMapWorkspaceQuery, resolveMapWorkspaceQuery,
  type MapCatalog} from '../src/lib/map-workspace';

const catalog: MapCatalog = {
  snapshotId: 'map-7.2-test', gameVersion: '7.2', sourceTime: '2026-11-09T20:39:02.715Z',
  regions: [
    {id: 4200, name: '阿陀河谷', nameEn: 'Ardravi Valley', country: '须弥', countryEn: 'Sumeru', parentName: '阿陀河谷', parentNameEn: 'Ardravi Valley', sceneId: 3, hasBoundary: true, calibrated: true},
    {id: 4203, name: '奥摩斯港', nameEn: 'Port Ormos', country: '须弥', countryEn: 'Sumeru', parentName: '阿陀河谷', parentNameEn: 'Ardravi Valley', sceneId: 3, hasBoundary: true, calibrated: true},
    {id: 9999, name: '测试独立场景', nameEn: 'Test independent scene', country: '', parentName: '', sceneId: 9, hasBoundary: true, calibrated: false},
  ],
  resources: [{id: 'o403', name: '草神瞳', nameEn: 'Dendroculus'}, {id: 'o121', name: '兽肉', nameEn: 'Raw Meat'}],
};

describe('atlas selection and snapshot state', () => {
  it('pins the audited default to the loaded catalog and round-trips its exact URL', () => {
    const resolved = resolveMapWorkspaceQuery(readMapWorkspaceQuery(''), catalog);
    expect(resolved.error).toBe('');
    expect(resolved.query).toEqual({region: '4203', resource: 'o403', snapshotId: catalog.snapshotId});
    expect(mapWorkspaceUrl(resolved.query)).toBe('/map?region=4203&resource=o403&snapshotId=map-7.2-test');
    expect(readMapWorkspaceQuery(mapWorkspaceUrl(resolved.query).split('?')[1])).toEqual(resolved.query);
  });
  it('resolves bilingual shared names into unambiguous catalog IDs', () => {
    const selected = resolveMapWorkspaceQuery(readMapWorkspaceQuery('?region=Port+Ormos&resource=草神瞳'), catalog);
    expect(selected.query).toEqual({region: '4203', resource: 'o403', snapshotId: catalog.snapshotId});
    expect(mapEntryMatches(catalog.regions[1], 'ｐＯＲＴ')).toBe(true);
    expect(mapEntryMatches(catalog.resources[0], '神瞳')).toBe(true);
    expect(mapEntryMatches(catalog.resources[0], 'o403')).toBe(true);
  });
  it('never substitutes defaults for an explicitly missing region, resource, or snapshot', () => {
    expect(resolveMapWorkspaceQuery(readMapWorkspaceQuery('?region=123456&resource=o403'), catalog))
      .toMatchObject({error: 'REGION_NOT_FOUND', region: undefined, query: {region: '123456'}});
    expect(resolveMapWorkspaceQuery(readMapWorkspaceQuery('?region=4203&resource=o9999'), catalog))
      .toMatchObject({error: 'RESOURCE_NOT_FOUND', resource: undefined, query: {resource: 'o9999'}});
    expect(resolveMapWorkspaceQuery(readMapWorkspaceQuery('?snapshotId=map-7.2-other'), catalog).error).toBe('MAP_RESULT_MISMATCH');
  });
  it('rejects duplicate, empty and malformed URL scope before querying', () => {
    expect(readMapWorkspaceQuery('?region=4203&region=4200').error).toBe('INVALID_MAP_QUERY');
    expect(readMapWorkspaceQuery('?resource=').error).toBe('INVALID_MAP_QUERY');
    expect(readMapWorkspaceQuery('?region=' + 'a'.repeat(201)).error).toBe('INVALID_MAP_QUERY');
    expect(readMapWorkspaceQuery('?snapshotId=../../current').error).toBe('INVALID_SNAPSHOT_ID');
  });
  it('preserves independent scenes and missing boundaries as unavailable, without zero counts', () => {
    expect(mapRegionAvailability(catalog.regions[1])).toBe('');
    expect(mapRegionAvailability(catalog.regions[2])).toBe('UNSUPPORTED_SCENE');
    expect(mapRegionAvailability({...catalog.regions[1], hasBoundary: false})).toBe('MISSING_BOUNDARY');
    expect(mapRegionAvailability({...catalog.regions[1], calibrated: false})).toBe('UNCALIBRATED_REGION');
    const selected = resolveMapWorkspaceQuery(readMapWorkspaceQuery('?region=9999'), catalog);
    expect(selected.region?.id).toBe(9999);
    expect(selected.error).toBe('');
  });
  it('validates catalogs, accepts source English hierarchy and rejects duplicate IDs', () => {
    expect(mapCatalogSchema.safeParse(catalog).success).toBe(true);
    expect(mapCatalogSchema.safeParse({...catalog, regions: [...catalog.regions, catalog.regions[0]]}).success).toBe(false);
    expect(mapCatalogSchema.safeParse({...catalog, resources: []}).success).toBe(false);
  });
  it('localizes catalog countries and failure codes without exposing server English', () => {
    expect(mapCountryLabel('须弥', 'en')).toBe('Sumeru');
    expect(mapCountryLabel('', 'zh-CN')).toBe('其他区域');
    expect(mapWorkspaceError('MISSING_BOUNDARY', 'zh-CN')).toMatchObject({title: '此区域暂无核验边界', retryable: false});
    expect(mapWorkspaceError('MAP_SNAPSHOT_UNAVAILABLE', 'en').retryable).toBe(true);
    expect(mapWorkspaceError('Unexpected private path error', 'zh-CN').title).toBe('地图数据暂不可用');
  });
});
