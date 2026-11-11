"""Build a local, provenance-preserving region query bundle from audited inputs."""
import argparse
import hashlib
import json
from itertools import accumulate
from pathlib import Path

from build import field, flight


def read(path):
    return json.loads(Path(path).read_text())


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument('--source', type=Path, required=True, help='Pinned AppSample source folder')
    cli.add_argument('--game-data', type=Path, required=True, help='Area/City Excel and CHS TextMaps')
    cli.add_argument('--regions', type=Path, required=True, help='Normalized scene*_worldArea.json folder')
    cli.add_argument('--calibration', type=Path, required=True)
    cli.add_argument('--crosschecks', type=Path, required=True)
    cli.add_argument('--provenance', type=Path, required=True)
    cli.add_argument('--output', type=Path, required=True)
    args = cli.parse_args()
    texts = {}
    for filename in ['TextMapCHS.json', 'TextMap_MediumCHS.json']:
        texts.update(read(args.game_data / 'TextMap' / filename))
    rows = read(args.game_data / 'ExcelBinOutput/WorldAreaConfigData.json')
    cities = read(args.game_data / 'ExcelBinOutput/CityConfigData.json')
    geometries, geometry_sources = {}, []
    for path in sorted(args.regions.glob('scene*_worldArea.json')):
        scene = int(path.name.split('_')[0][5:])
        geometry_sources.append({'file': path.name, 'sha256': digest(path)})
        for group in read(path)['level1Areas']:
            for row in [group['level1Area'], *group.get('level2Areas', [])]:
                p = row['polygonData']
                ring = [[v.get('x', 0), v.get('z', 0)] for v in p['roadPoints']]
                if len(ring) < 3:
                    raise ValueError(f'Invalid polygon: {path} {row.get("id1")}/{row.get("id2")}')
                key = (scene, row['id1'], row.get('id2'))
                geometries.setdefault(key, []).append({'ring': ring,
                    'height': [p.get('minArea', {}).get('y'), p.get('maxArea', {}).get('y')]})
    areas = []
    for row in rows:
        scene, id1, id2 = row['sceneID'], row.get('areaID1'), row.get('areaID2')
        city_ids = [c['cityId'] for c in cities if id1 in c.get('areaIdVec', [])]
        areas.append({'id': row['id'], 'name': texts.get(str(row.get('areaNameTextMapHash')), ''),
                      'sceneId': scene, 'areaId1': id1, 'areaId2': id2,
                      'cityId': city_ids[0] if len(city_ids) == 1 else None,
                      'cityIds': city_ids, 'polygons': geometries.get((scene, id1, id2), [])})
    source = read(args.source / 'markers.json')
    d = source['data']
    if source['encoding']['delta'] != ['id']:
        raise ValueError('Unknown marker encoding')
    points = [dict(zip(['id', 'type', 'mid', 'lng', 'lat', 'meta'], row)) for row in
              zip(accumulate(d['id']), d['type'], d['mid'], d['lng'], d['lat'], d['meta'])]
    labels = field(flight(args.source / 'zh.html'), 'messages')['markers']
    models = {}
    for key, model in read(args.calibration).items():
        models[key] = {'matrix': model['matrix'], 'uncertaintyWorld': max(20, model['holdoutStats']['max'] + 1),
                       'training': model['trainingStats'], 'holdout': model['holdoutStats'],
                       'matchedAreaIds': sorted({p['areaId'] for p in model['training'] + model['holdout']}),
                       'nativeCandidates': model['candidates']}
    pairs = read(args.crosschecks)['pairs']
    if len({p['appId'] for p in pairs}) != len(pairs):
        raise ValueError('Crosscheck is not one-to-one')
    result = {'schema': 1, 'version': {'appsample': '7.2', 'snapshotTime': source['time']},
              'sources': {'appsampleSHA256': digest(args.source / 'markers.json'),
                          'geometry': read(args.provenance), 'geometryFiles': geometry_sources,
                          'areaConfigSHA256': digest(args.game_data / 'ExcelBinOutput/WorldAreaConfigData.json'),
                          'calibrationSHA256': digest(args.calibration),
                          'crosscheckSHA256': digest(args.crosschecks)},
              'areas': areas, 'models': models, 'points': points,
              'types': {p['type']: labels.get(p['type'], p['type']) for p in points},
              'crosschecks': {str(p['appId']): {**p,
                  'sourceURL': 'https://github.com/Sam5440/Genshin_Impact_Teleport/blob/main/' + p['sourcePath'],
                  'sourceBlobURL': 'https://api.github.com/repos/Sam5440/Genshin_Impact_Teleport/git/blobs/' + p['blob']}
                  for p in pairs}}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')) + '\n')
    missing = [a for a in areas if not a['polygons']]
    print(json.dumps({'points': len(points), 'areas': len(areas), 'withGeometry': len(areas) - len(missing),
                      'missing': [{'id': a['id'], 'name': a['name']} for a in missing]}, ensure_ascii=False))


if __name__ == '__main__':
    main()
