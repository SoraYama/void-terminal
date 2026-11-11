"""Pair public 3D collection positions to a fixed AppSample resource snapshot.

Only unique, close pairs with a sufficiently distant runner-up are accepted.
This checks community coordinates; it does not turn them into native spawns.
"""
import argparse
import json
import math
import statistics
from collections import Counter
from itertools import accumulate
from pathlib import Path

from region_query import world_point


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument('--markers', type=Path, required=True)
    cli.add_argument('--calibration', type=Path, required=True)
    cli.add_argument('--input', type=Path, required=True)
    cli.add_argument('--city', required=True)
    cli.add_argument('--resource', required=True)
    cli.add_argument('--output', type=Path, required=True)
    args = cli.parse_args()
    data = json.loads(args.markers.read_text())['data']
    points = [{'id': i, 'lng': x, 'lat': y} for i, t, mid, x, y in
              zip(accumulate(data['id']), data['type'], data['mid'], data['lng'], data['lat'])
              if t == args.resource and mid == 2]
    matrix = json.loads(args.calibration.read_text())[args.city]['matrix']
    positions = [world_point(p, matrix) for p in points]
    pairs = []
    for record in json.loads(args.input.read_text())['records']:
        x, y, z = record['point']['position']
        nearest = sorted((math.hypot(x - px, z - pz), i) for i, (px, pz) in enumerate(positions))
        distance, index = nearest[0]
        pairs.append({'sourcePath': record['path'], 'blob': record['blob'], 'xyz': [x, y, z],
                      'appId': points[index]['id'], 'distanceWorld': distance,
                      'runnerUpDistanceWorld': nearest[1][0]})
    counts = Counter(p['appId'] for p in pairs)
    accepted = [p for p in pairs if p['distanceWorld'] < 25
                and p['runnerUpDistanceWorld'] - p['distanceWorld'] > 25
                and counts[p['appId']] == 1]
    distances = sorted(p['distanceWorld'] for p in accepted)
    result = {'summary': {'inputCount': len(pairs), 'appCount': len(points),
                         'accepted': len(accepted), 'maxDistanceWorld': max(distances, default=None),
                         'medianDistanceWorld': statistics.median(distances) if distances else None},
              'criteria': {'maxDistanceWorldExclusive': 25, 'minimumRunnerUpMarginExclusive': 25,
                           'uniqueTarget': True},
              'pairs': accepted, 'excluded': [p for p in pairs if p not in accepted]}
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(result['summary']))


if __name__ == '__main__':
    main()
