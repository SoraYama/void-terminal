import {describe, expect, it} from 'vitest';
import {
  clusterMapMarkers, fitMapViewport, mapToScreen, screenToMap,
  visibleMapTiles, zoomMapViewport,
  normalizeMapRings,
  mapTileLoadState,
} from '../src/lib/map-viewport';
import type {MapMarker} from '../src/lib/map-cards';

const marker = (id: number, x: number, y: number, role: MapMarker['role'] = 'included'): MapMarker =>
  ({id, x, y, role, coordinateEvidence: 'calibrated-projection'});

describe('map viewport geometry', () => {
  it('fits an asymmetric boundary without stretching or reversing the map y axis', () => {
    const view = fitMapViewport([10, 20, 30, 30], 240, 160, 20);
    expect(view).toEqual({cx: 20, cy: 25, scale: 10, width: 240, height: 160});
    expect(mapToScreen({x: 10, y: 20}, view)).toEqual({x: 20, y: 30});
    expect(mapToScreen({x: 30, y: 30}, view)).toEqual({x: 220, y: 130});
    expect(screenToMap({x: 20, y: 30}, view)).toEqual({x: 10, y: 20});
  });

  it('keeps the map position under a zoom gesture fixed, including at the zoom limit', () => {
    const view = {cx: 20, cy: 25, scale: 10, width: 240, height: 160};
    const next = zoomMapViewport(view, 4, {x: 20, y: 30}, 5, 20);
    expect(next.scale).toBe(20);
    expect(mapToScreen({x: 10, y: 20}, next)).toEqual({x: 20, y: 30});
    expect(zoomMapViewport(next, 2, {x: 20, y: 30}, 5, 20)).toEqual(next);
  });

  it('returns finite geometry for a single point and a narrow container', () => {
    const view = fitMapViewport([.2, .3, .2, .3], 32, 20, 36);
    expect(view.scale).toBeGreaterThan(0);
    expect(Object.values(view).every(Number.isFinite)).toBe(true);
    expect(mapToScreen({x: .2, y: .3}, view)).toEqual({x: 16, y: 10});
  });

  it('maps source tile y upwards and includes negative tile x without world wrapping', () => {
    const view = {cx: 0, cy: 0, scale: 10, width: 200, height: 200};
    const tiles = visibleMapTiles(view, 4, [-10, -10, 10, 10]);
    expect(tiles.map(tile => [tile.x, tile.sourceY]).sort()).toEqual([[-1, -1], [-1, 0], [0, -1], [0, 0]]);
    expect(tiles.find(tile => tile.x === 0 && tile.sourceY === -1)).toMatchObject({left: 0, top: 0, size: 22.5});
    expect(tiles.find(tile => tile.x === 0 && tile.sourceY === 0)).toMatchObject({left: 0, top: -22.5});
  });

  it('clips requests to the supplied map bounds and caps a very large visible tile set', () => {
    const outside = {cx: 100, cy: 100, scale: 10, width: 100, height: 100};
    expect(visibleMapTiles(outside, 15, [0, 0, 1, 1])).toEqual([]);
    const huge = {cx: 0, cy: 0, scale: 1, width: 10000, height: 10000};
    const tiles = visibleMapTiles(huge, 15, [-180, -180, 180, 180], 48);
    expect(tiles).toHaveLength(48);
    expect(new Set(tiles.map(tile => `${tile.x}:${tile.sourceY}`)).size).toBe(48);
  });
});

describe('map loading status', () => {
  it.each([
    {loaded: 6, pending: 33, failed: 0, expected: 'loading'},
    {loaded: 39, pending: 0, failed: 0, expected: 'ready'},
    {loaded: 6, pending: 0, failed: 2, expected: 'partial'},
    {loaded: 0, pending: 0, failed: 2, expected: 'error'},
    {loaded: 0, pending: 2, failed: 1, expected: 'loading'},
  ])('does not call an unfinished visible tile queue ready: $loaded loaded / $pending pending / $failed failed', ({loaded, pending, failed, expected}) => {
    expect(mapTileLoadState({loaded, pending, failed})).toBe(expected);
  });
});

describe('map boundary union winding', () => {
  it('preserves overlapping areas as a union even when source rings have opposite winding', () => {
    const first: [number, number][] = [[0, 0], [4, 0], [4, 4], [0, 4]];
    const overlapping: [number, number][] = [[1, 1], [3, 1], [3, 3], [1, 3]];
    expect(normalizeMapRings([first, [...overlapping].reverse()])).toEqual([first, overlapping]);
  });

  it('normalizes parent and child ring sets independently without changing persisted coordinates', () => {
    const parent: [number, number][] = [[0, 0], [0, 6], [6, 6], [6, 0]];
    const child: [number, number][] = [[2, -2], [8, -2], [8, 4], [2, 4]];
    const original = structuredClone(parent);
    expect(normalizeMapRings([parent])).toEqual([[[6, 0], [6, 6], [0, 6], [0, 0]]]);
    expect(normalizeMapRings([child])).toEqual([child]);
    expect(parent).toEqual(original);
  });
});

describe('map marker clustering', () => {
  const view = {cx: 0, cy: 0, scale: 10, width: 200, height: 200};

  it('clusters nearby points across screen-cell edges while preserving role and count', () => {
    const markers = [marker(1, -6.1, 0), marker(2, -5.9, 0), marker(3, 5, 0), marker(4, -6, 0, 'nearby')];
    const clusters = clusterMapMarkers(markers, view, 40);
    expect(clusters.map(cluster => cluster.markers.map(point => point.id))).toEqual([[1, 2], [3], [4]]);
    expect(clusters[0].x).toBe(40);
    expect(clusters.flatMap(cluster => cluster.markers)).toHaveLength(4);
  });

  it('separates points when zooming in and keeps a selected point individually reachable', () => {
    const markers = [marker(1, 0, 0), marker(2, 1, 0)];
    expect(clusterMapMarkers(markers, view, 40)).toHaveLength(1);
    expect(clusterMapMarkers(markers, {...view, scale: 50}, 40)).toHaveLength(2);
    expect(clusterMapMarkers(markers, view, 40, 2).map(cluster => cluster.markers.map(point => point.id))).toEqual([[1], [2]]);
  });

  it('does not create hit targets for offscreen markers or lose coincident points', () => {
    const markers = [marker(1, 0, 0), marker(2, 0, 0), marker(3, 100, 100)];
    const clusters = clusterMapMarkers(markers, view, 40);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].markers.map(point => point.id)).toEqual([1, 2]);
    expect(clusterMapMarkers([...markers].reverse(), view, 40)).toEqual(clusters);
  });
});
