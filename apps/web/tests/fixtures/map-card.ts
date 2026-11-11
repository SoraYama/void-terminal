export const mapCardFixture = {
  schemaVersion: 1, kind: 'resource-map', id: 'ormos-o403',
  snapshotId: 'map-7.2-fixture', gameVersion: '7.2', sourceTime: '2026-11-09T20:39:02.715Z',
  region: {id: 4203, name: '奥摩斯港', nameEn: 'Port Ormos', country: '须弥', parentName: '阿陀河谷', sceneId: 3},
  resource: {id: 'o403', name: '草神瞳', nameEn: 'Dendroculus'},
  count: 2, status: 'crosschecked', review: {boundary: 0, unknownHeight: 0, overlap: 0},
  map: {key: 'teyvat', projection: 'appsample-mercator-v1', revision: 'v72-rc1', minZoom: 10, maxZoom: 15, tileSize: 256, bounds: [0.22, 0.13, 0.27, 0.2]},
  polygons: [[[0.22, 0.14], [0.26, 0.14], [0.26, 0.195], [0.22, 0.195]]],
  markers: [
    {id: 33876, x: 0.2344559738, y: 0.1469401309, role: 'included', coordinateEvidence: 'crosschecked-3d', height: 203.654541},
    {id: 33877, x: 0.2398072209, y: 0.1408921639, role: 'included', coordinateEvidence: 'crosschecked-3d', height: 202.922791},
  ],
  truncated: false,
  sources: [{label: 'AppSample', url: 'https://genshin-impact-map.appsample.com/'}],
} as const;
