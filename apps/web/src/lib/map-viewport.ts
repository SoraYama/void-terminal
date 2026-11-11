import type {MapMarker} from './map-cards';

export type MapBounds = readonly [number, number, number, number];
export type MapPosition = {x: number; y: number};
export type MapViewport = {cx: number; cy: number; scale: number; width: number; height: number};
export type MapTile = {z: number; x: number; sourceY: number; left: number; top: number; size: number};
export type MapCluster = {x: number; y: number; markers: MapMarker[]};
export type MapLoadState = 'loading' | 'ready' | 'partial' | 'error';
type MapRings = readonly (readonly (readonly [number, number])[])[];

/** Existing/coarse pixels do not mean the current visible tile queue has finished. */
export function mapTileLoadState({loaded, pending, failed}: {loaded: number; pending: number; failed: number}): MapLoadState {
  if (pending > 0) return 'loading';
  if (!loaded) return 'error';
  return failed > 0 ? 'partial' : 'ready';
}

/** Polygon arrays describe a union, never holes. Nonzero Canvas paths need the same winding. */
export function normalizeMapRings(rings: MapRings): [number, number][][] {
  return rings.map(ring => {
    const [ox, oy] = ring[0];
    const area = ring.reduce((sum, [x, y], index) => {
      const [nx, ny] = ring[(index + 1) % ring.length];
      return sum + (x - ox) * (ny - oy) - (nx - ox) * (y - oy);
    }, 0);
    const copy: [number, number][] = ring.map(([x, y]) => [x, y]);
    return area < 0 ? copy.reverse() : copy;
  });
}

/** Fill and outline (union of child rings) ∩ (union of parent rings), without internal seams. */
export function drawMapBoundary(
  ctx: CanvasRenderingContext2D, outline: CanvasRenderingContext2D | null, view: MapViewport,
  polygons: MapRings, parentPolygons: MapRings | undefined, colors: {paper: string; included: string}, dpr = 1,
) {
  const path = (rings: MapRings) => {
    const result = new Path2D();
    for (const ring of normalizeMapRings(rings)) {
      ring.forEach(([x, y], index) => {
        const point = mapToScreen({x, y}, view);
        if (index) result.lineTo(point.x, point.y); else result.moveTo(point.x, point.y);
      });
      result.closePath();
    }
    return result;
  };
  const child = path(polygons), parent = parentPolygons ? path(parentPolygons) : undefined;
  ctx.save();
  if (parent) ctx.clip(parent);
  ctx.fillStyle = colors.included; ctx.globalAlpha = .13; ctx.fill(child);
  ctx.restore();
  if (!outline) return;
  if (outline.canvas.width !== ctx.canvas.width) outline.canvas.width = ctx.canvas.width;
  if (outline.canvas.height !== ctx.canvas.height) outline.canvas.height = ctx.canvas.height;
  outline.save(); outline.setTransform(dpr, 0, 0, dpr, 0, 0);
  outline.clearRect(0, 0, view.width, view.height);
  const stroke = (boundary: Path2D, clip?: Path2D) => {
    outline!.save();
    if (clip) outline!.clip(clip);
    // Only the outward half survives below, so use twice the intended visible line width.
    outline!.strokeStyle = colors.paper; outline!.lineWidth = 8; outline!.stroke(boundary);
    outline!.strokeStyle = colors.included; outline!.lineWidth = 4; outline!.setLineDash([7, 4]); outline!.stroke(boundary);
    outline!.restore();
  };
  stroke(child, parent);
  if (parent) stroke(parent, child);
  // Remove the intersection interior from all strokes. Overlapping or nested rings then
  // have no false internal borders, irrespective of source winding or polygon order.
  outline.globalCompositeOperation = 'destination-out';
  if (parent) outline.clip(parent);
  outline.fillStyle = '#000'; outline.fill(child);
  outline.restore();
  ctx.drawImage(outline.canvas, 0, 0, view.width, view.height);
}

export function fitMapViewport(bounds: MapBounds, width: number, height: number, padding = 36): MapViewport {
  return {
    cx: (bounds[0] + bounds[2]) / 2, cy: (bounds[1] + bounds[3]) / 2, width, height,
    scale: Math.min(Math.max(1, width - padding * 2) / Math.max(.00001, bounds[2] - bounds[0]),
      Math.max(1, height - padding * 2) / Math.max(.00001, bounds[3] - bounds[1])),
  };
}

/** Coordinates are already projected with y down. Do not apply another Mercator transform. */
export function mapToScreen(point: MapPosition, view: MapViewport): MapPosition {
  return {x: (point.x - view.cx) * view.scale + view.width / 2, y: (point.y - view.cy) * view.scale + view.height / 2};
}

export function screenToMap(point: MapPosition, view: MapViewport): MapPosition {
  return {x: (point.x - view.width / 2) / view.scale + view.cx, y: (point.y - view.height / 2) / view.scale + view.cy};
}

export function zoomMapViewport(view: MapViewport, factor: number, anchor: MapPosition, minScale: number, maxScale: number): MapViewport {
  const world = screenToMap(anchor, view);
  const scale = Math.max(minScale, Math.min(maxScale, view.scale * factor));
  return {...view, scale, cx: world.x - (anchor.x - view.width / 2) / scale, cy: world.y - (anchor.y - view.height / 2) / scale};
}

/** The source indexes tiles upwards; sourceY=-1 is the tile starting at map y=0. */
export function visibleMapTiles(view: MapViewport, z: number, bounds: MapBounds, limit = 80): MapTile[] {
  const size = 360 / 2 ** z;
  const left = Math.max(bounds[0], view.cx - view.width / view.scale / 2);
  const right = Math.min(bounds[2], view.cx + view.width / view.scale / 2);
  const top = Math.max(bounds[1], view.cy - view.height / view.scale / 2);
  const bottom = Math.min(bounds[3], view.cy + view.height / view.scale / 2);
  if (left >= right || top >= bottom || limit <= 0) return [];
  const x0 = Math.floor(left / size), x1 = Math.ceil(right / size) - 1;
  const y0 = Math.floor(top / size), y1 = Math.ceil(bottom / size) - 1;
  const cx = Math.max(x0, Math.min(x1, Math.floor(view.cx / size)));
  const cy = Math.max(y0, Math.min(y1, Math.floor(view.cy / size)));
  const tiles: MapTile[] = [];
  const cap = Math.min(96, Math.floor(limit), (x1 - x0 + 1) * (y1 - y0 + 1));
  const add = (x: number, y: number) => {
    if (tiles.length < cap && x >= x0 && x <= x1 && y >= y0 && y <= y1)
      tiles.push({z, x, sourceY: -y - 1, left: x * size, top: y * size, size});
  };
  // Expand from the center instead of enumerating an unbounded tile grid at extreme zooms.
  add(cx, cy);
  for (let radius = 1; tiles.length < cap; radius++) {
    for (let x = cx - radius; x <= cx + radius; x++) {add(x, cy - radius); add(x, cy + radius);}
    for (let y = cy - radius + 1; y < cy + radius; y++) {add(cx - radius, y); add(cx + radius, y);}
  }
  return tiles;
}

/** Role-separated screen-distance clusters keep reference points out of the counted group. */
export function clusterMapMarkers(markers: readonly MapMarker[], view: MapViewport, radius = 40, selectedId?: number | null): MapCluster[] {
  const groups: MapCluster[] = [];
  for (const marker of [...markers].sort((a, b) => a.id - b.id)) {
    const point = mapToScreen(marker, view);
    if (point.x < -radius || point.y < -radius || point.x > view.width + radius || point.y > view.height + radius) continue;
    const group = marker.id === selectedId ? undefined : groups.find(cluster =>
      cluster.markers[0].id !== selectedId && cluster.markers[0].role === marker.role
      && Math.hypot(cluster.x - point.x, cluster.y - point.y) < radius);
    if (group) {
      const n = group.markers.length;
      group.x = (group.x * n + point.x) / (n + 1); group.y = (group.y * n + point.y) / (n + 1);
      group.markers.push(marker);
    } else groups.push({...point, markers: [marker]});
  }
  return groups;
}
