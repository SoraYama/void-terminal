import {z} from 'zod';

export const MAX_MAP_CARDS = 4;
export const MAX_MAP_MARKERS = 500;
export const mapSnapshotIdSchema = z.string().regex(/^map-[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/);
const label = z.string().min(1).max(200);
const coordinate = z.number().finite().min(-180).max(180);
const xy = z.tuple([coordinate, coordinate]);
const count = z.number().int().min(0).max(1_000_000);
const polygons=z.array(z.array(xy).min(3).max(1024)).min(1).max(16);
const sourceURL = z.string().max(2000).url().refine(value => {
  const url = new URL(value);
  return url.protocol === 'https:' && !url.username && !url.password
    && ['genshin-impact-map.appsample.com', 'github.com', 'api.github.com', 'gitlab.com', 'autopatchhk.yuanshen.com'].includes(url.hostname);
});

export const mapCardSchema = z.object({
  schemaVersion: z.literal(1), kind: z.literal('resource-map'),
  id: z.string().regex(/^[a-zA-Z0-9:_-]{1,180}$/),
  snapshotId: mapSnapshotIdSchema,
  gameVersion: z.string().min(1).max(40), sourceTime: z.string().datetime(),
  region: z.object({id: z.number().int().positive(), name: label, nameEn: label.optional(), country: z.string().max(100), countryEn: label.optional(), parentName: z.string().max(200), parentNameEn: label.optional(), sceneId: z.number().int().positive()}).strict(),
  resource: z.object({id: z.string().regex(/^o\d{1,8}$/), name: label, nameEn: label.optional()}).strict(),
  count, status: z.enum(['crosschecked', 'requires-review', 'projected-snapshot']),
  review: z.object({boundary: count, unknownHeight: count, overlap: count}).strict(),
  map: z.object({
    key: z.literal('teyvat'), projection: z.literal('appsample-mercator-v1'),
    revision: z.string().regex(/^[a-zA-Z0-9-]{1,50}$/),
    minZoom: z.number().int().min(0).max(15), maxZoom: z.number().int().min(0).max(15), tileSize: z.literal(256),
    bounds: z.tuple([coordinate, coordinate, coordinate, coordinate]),
  }).strict(),
  polygons,
  // When present the queried footprint is the intersection of these two unions.
  parentPolygons: polygons.optional(),
  markers: z.array(z.object({
    id: z.number().int().positive(), x: coordinate, y: coordinate,
    role: z.enum(['included', 'nearby', 'review']),
    coordinateEvidence: z.enum(['crosschecked-3d', 'calibrated-projection']),
    height: z.number().finite().nullable().optional(), floor: z.string().max(80).optional(),
  }).strict()).max(MAX_MAP_MARKERS),
  truncated: z.boolean(),
  sources: z.array(z.object({label, url: sourceURL}).strict()).min(1).max(6),
}).strict().superRefine((card, ctx) => {
  const included = card.markers.filter(p => p.role === 'included');
  const issue = (message: string) => ctx.addIssue({code: 'custom', message});
  if (included.length > card.count || (!card.truncated && included.length !== card.count)) issue('Marker count does not match total');
  if (new Set(card.markers.map(p => p.id)).size !== card.markers.length) issue('Duplicate marker IDs');
  if (card.polygons.reduce((sum, ring) => sum + ring.length, 0) > 4096) issue('Too many boundary vertices');
  if (card.parentPolygons && card.parentPolygons.reduce((sum,ring)=>sum+ring.length,0)>4096) issue('Too many parent boundary vertices');
  if (card.map.minZoom > card.map.maxZoom) issue('Invalid tile levels');
  if (card.map.bounds[0] >= card.map.bounds[2] || card.map.bounds[1] >= card.map.bounds[3]) issue('Invalid map bounds');
  const review = card.review.boundary + card.review.unknownHeight + card.review.overlap;
  if (review > 0 && card.status !== 'requires-review') issue('Uncertainty must remain visible');
  if (card.status === 'crosschecked' && included.some(p => p.coordinateEvidence !== 'crosschecked-3d' || p.height == null)) issue('Crosschecked points require 3D evidence');
});

export type MapCard = z.infer<typeof mapCardSchema>;
export type MapMarker = MapCard['markers'][number];
export interface MapQueryInput {region: string; resource: string; country?: string}
export interface MapRegionHit {id: number; name: string; nameEn?: string; country: string; countryEn?: string; parentName: string; parentNameEn?: string; sceneId: number; hasBoundary: boolean; calibrated: boolean}
export interface MapQueryFailure {error: string; message: string; candidates?: {id: string | number; name: string}[]}
export type MapQueryResult = {card: MapCard} | MapQueryFailure;

/** Messages and browser history are untrusted, including future schema versions. */
export function parseMapCards(value: unknown): MapCard[] {
  if (!Array.isArray(value)) return [];
  const cards: MapCard[] = [], ids = new Set<string>();
  for (const entry of value.slice(0, 32)) {
    const parsed = mapCardSchema.safeParse(entry);
    if (parsed.success && !ids.has(parsed.data.id)) {cards.push(parsed.data); ids.add(parsed.data.id);}
    if (cards.length === MAX_MAP_CARDS) break;
  }
  return cards;
}

export function mapTileUrl(card: MapCard, z: number, x: number, sourceY: number): string {
  return `/api/maps/assets/${encodeURIComponent(card.snapshotId)}/tiles/${card.map.key}/${z}/${x}/${sourceY}.jpg`;
}
export function mapIconUrl(card: MapCard): string {
  return `/api/maps/assets/${encodeURIComponent(card.snapshotId)}/icons/${card.resource.id}.png`;
}
export function mapMarkerUrl(card: MapCard, markerId: number): string {
  return 'https://genshin-impact-map.appsample.com/?' + new URLSearchParams({id: String(markerId), mid: '2', type: card.resource.id});
}
