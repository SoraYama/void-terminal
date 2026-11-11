"""Read-only region counts over a pinned map audit bundle (no model estimates).

python3 prototypes/world-map/region_query.py --data /absolute/query-bundle.json \
    --question '须弥的奥摩斯港有多少草神瞳'
"""
import argparse
import json
import math


def distance_to_ring(point, ring):
    x, z = point
    distances = []
    for a, b in zip(ring, ring[1:] + ring[:1]):
        dx, dz = b[0] - a[0], b[1] - a[1]
        length = dx * dx + dz * dz
        t = max(0, min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / length)) if length else 0
        distances.append(math.hypot(x - a[0] - t * dx, z - a[1] - t * dz))
    return min(distances) if distances else math.inf


def inside_ring(point, ring):
    if len(ring) < 3:
        return False
    if distance_to_ring(point, ring) < 1e-7:
        return True
    x, z = point
    inside = False
    for (ax, az), (bx, bz) in zip(ring, ring[1:] + ring[:1]):
        if (az > z) != (bz > z) and x < (bx - ax) * (z - az) / (bz - az) + ax:
            inside = not inside
    return inside


def world_point(point, matrix):
    # AppSample's centered map projects latitude through Mercator. These are
    # game-map coordinates, not real-world longitude/latitude geography.
    u = point['lng'] - matrix[2][0]
    v = math.degrees(math.asinh(math.tan(math.radians(point['lat'])))) - matrix[2][1]
    a, b = matrix[0]
    c, d = matrix[1]
    det = a * d - b * c
    if abs(det) < 1e-14:
        raise ValueError('Singular coordinate calibration')
    return [(u * d - v * c) / det, (-u * b + v * a) / det]


def polygon_match(xz, polygon, y=None):
    if not inside_ring(xz, polygon['ring']):
        return False
    if y is not None:
        lo, hi = polygon.get('height', [None, None])
        if lo is not None and y < lo:
            return False
        if hi is not None and y > hi:
            return False
    return True


def query(bundle, region_name, resource_name):
    areas = [r for r in bundle['areas'] if r['name'] == region_name or str(r['id']) == region_name]
    if len(areas) != 1:
        raise ValueError('Region missing or ambiguous: ' + region_name)
    area = areas[0]
    types = [k for k, name in bundle['types'].items() if name == resource_name or k == resource_name]
    if len(types) != 1:
        raise ValueError('Resource missing or ambiguous: ' + resource_name)
    if not area.get('polygons'):
        raise ValueError('No verified boundary for region: ' + region_name)
    model = bundle['models'].get(str(area.get('cityId')))
    if area['sceneId'] != 3 or not model:
        raise ValueError('No verified coordinate calibration for this scene/region')
    if area['areaId1'] not in model.get('matchedAreaIds', []):
        raise ValueError('This region has no verified coordinate anchors')
    parent = next((r for r in bundle['areas'] if r['sceneId'] == area['sceneId']
                   and r['areaId1'] == area['areaId1'] and r.get('areaId2') is None), None)
    if not parent or not parent.get('polygons'):
        raise ValueError('Missing parent boundary; cannot apply game area hierarchy')
    selected, near, height_unknown, overlap = [], [], [], []
    siblings = [r for r in bundle['areas'] if r['sceneId'] == area['sceneId']
                and r['areaId1'] == area['areaId1'] and r.get('areaId2') is not None
                and r['id'] != area['id']]
    threshold = model['uncertaintyWorld']
    for point in bundle['points']:
        if point['mid'] != 2 or point['type'] != types[0]:
            continue
        cross = bundle.get('crosschecks', {}).get(str(point['id']))
        y = cross['xyz'][1] if cross else None
        xz = [cross['xyz'][0], cross['xyz'][2]] if cross else world_point(point, model['matrix'])
        distance = min(distance_to_ring(xz, p['ring']) for p in area['polygons'])
        parent_hit = any(polygon_match(xz, p) for p in parent['polygons'])
        hit = parent_hit and any(polygon_match(xz, p, y) for p in area['polygons'])
        record = {'id': point['id'], 'lng': point['lng'], 'lat': point['lat'],
                  'gameXZ': xz, 'gameY': y, 'inside': hit,
                  'distanceToBoundaryWorld': distance, 'meta': point['meta'],
                  'coordinateEvidence': 'crosschecked-3d' if cross else 'calibrated-projection',
                  'url': f'https://genshin-impact-map.appsample.com/?id={point["id"]}&mid=2&type={point["type"]}'}
        if cross:
            record['crosscheck'] = cross
        if hit:
            selected.append(record)
            if y is None and area.get('areaId2') is not None:
                height_unknown.append(point['id'])
            if area.get('areaId2') is not None:
                also = [r['id'] for r in siblings if any(polygon_match(xz, p, y) for p in r['polygons'])]
                if also:
                    overlap.append({'pointId': point['id'], 'alsoInRegions': also})
        if distance <= threshold and not cross:
            near.append(record)
    if near or height_unknown or overlap:
        status = 'requires-review'
    elif selected and all(p['coordinateEvidence'] == 'crosschecked-3d' for p in selected):
        status = 'crosschecked'
    else:
        status = 'projected-snapshot'
    return {'question': f'{area["name"]}有多少{resource_name}', 'regionId': area['id'],
            'region': area['name'], 'resource': resource_name, 'count': len(selected),
            'status': status,
            'scope': 'declared game-region footprint intersected with its parent; known height checked',
            'points': selected, 'boundaryReview': near, 'unknownHeightIds': height_unknown,
            'overlapReview': overlap,
            'version': bundle['version'], 'sources': bundle['sources'],
            'calibration': {k: v for k, v in model.items() if k != 'matrix'},
            'limits': ['Counts refer to this source snapshot.',
                       'Generic overlapping child-region precedence is not resolved by this query.',
                       '3D crosschecks are public collection coordinates, not authenticated object placements.']}


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument('--data', required=True)
    cli.add_argument('--question')
    cli.add_argument('--region')
    cli.add_argument('--resource')
    args = cli.parse_args()
    with open(args.data) as f:
        bundle = json.load(f)
    region, resource = args.region, args.resource
    if args.question:
        if any(word in args.question for word in ['附近', '周边', '周围', '半径']):
            cli.error('Nearby/radius queries require an explicit scope; a named region is not a radius')
        names = {a['name'] for a in bundle['areas'] if a['name'] and a['name'] in args.question}
        resources = {n for n in bundle['types'].values() if n and n in args.question}
        if not names or not resources:
            cli.error('Question must name a known region and resource')
        region, resource = max(names, key=len), max(resources, key=len)
        countries = {'蒙德': 1, '璃月': 2, '稻妻': 3, '须弥': 4, '枫丹': 5, '纳塔': 6, '至冬': 7}
        requested = {cid for name, cid in countries.items() if name in args.question}
        candidates = [a for a in bundle['areas'] if a['name'] == region]
        if requested and not any(a.get('cityId') in requested for a in candidates):
            cli.error('The named region does not belong to the requested country')
    if not region or not resource:
        cli.error('Use --question or both --region and --resource')
    try:
        print(json.dumps(query(bundle, region, resource), ensure_ascii=False, indent=2))
    except ValueError as error:
        cli.error(str(error))


if __name__ == '__main__':
    main()
