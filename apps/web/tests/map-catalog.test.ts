import {beforeEach, describe, expect, it, vi} from 'vitest';

const mocks = vi.hoisted(() => ({load: vi.fn(), catalog: vi.fn()}));
vi.mock('../src/lib/server/maps', async importOriginal => {
  const original = await importOriginal<typeof import('../src/lib/server/maps')>();
  return {...original, loadMapSnapshot: mocks.load, getMapCatalog: mocks.catalog};
});
import {GET} from '../src/app/api/maps/catalog/route';
import {MapDataError} from '../src/lib/server/maps';

const snapshot = {id: 'map-7.2-test', gameVersion: '7.2', sourceTime: '2026-11-09T20:39:02.715Z'};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.load.mockResolvedValue(snapshot);
  mocks.catalog.mockReturnValue({regions: Array.from({length: 125}, (_, index) => ({id: index + 1})), resources: [{id: 'o403', name: '草神瞳'}]});
});

describe('read-only atlas catalog route', () => {
  it('returns the complete catalog and its exact immutable snapshot without a model connection', async () => {
    const request = new Request('https://void.test/api/maps/catalog?snapshotId=map-7.2-test');
    const response = await GET(request);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(mocks.load).toHaveBeenCalledWith(snapshot.id, request.signal);
    expect(mocks.catalog).toHaveBeenCalledWith(snapshot);
    expect(body).toMatchObject({snapshotId: snapshot.id, gameVersion: snapshot.gameVersion, sourceTime: snapshot.sourceTime});
    expect(body.regions).toHaveLength(125);
    expect(body.resources).toEqual([{id: 'o403', name: '草神瞳'}]);
    expect(Object.keys(body).sort()).toEqual(['gameVersion', 'regions', 'resources', 'snapshotId', 'sourceTime']);
  });
  it('uses the active snapshot only when no snapshot was requested', async () => {
    const request = new Request('https://void.test/api/maps/catalog');
    await GET(request);
    expect(mocks.load).toHaveBeenCalledWith(undefined, request.signal);
  });
  it.each(['?snapshotId=../other', '?snapshotId=map-a&snapshotId=map-b', '?q=须弥', '?snapshotId='])('rejects invalid catalog scope %s', async suffix => {
    const response = await GET(new Request(`https://void.test/api/maps/catalog${suffix}`));
    expect(response.status).toBe(400);
    expect(mocks.load).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({error: 'INVALID_MAP_QUERY'});
  });
  it('does not silently fall back when a pinned snapshot is unavailable', async () => {
    mocks.load.mockRejectedValue(new MapDataError('MAP_SNAPSHOT_UNAVAILABLE', 'Snapshot is unavailable.'));
    const response = await GET(new Request('https://void.test/api/maps/catalog?snapshotId=map-7.2-missing'));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({error: 'MAP_SNAPSHOT_UNAVAILABLE'});
    expect(mocks.load).toHaveBeenCalledTimes(1);
    expect(mocks.catalog).not.toHaveBeenCalled();
  });
});
