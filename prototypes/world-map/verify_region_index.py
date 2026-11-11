"""Acceptance checks using the pinned 7.2 region and marker evidence bundle."""
import argparse
import json
import subprocess
import sys
from pathlib import Path

from region_query import distance_to_ring, inside_ring, polygon_match, query


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument('--data', type=Path, required=True)
    cli.add_argument('--output', type=Path, required=True)
    args = cli.parse_args()
    bundle = json.loads(args.data.read_text())
    areas = bundle['areas']
    assert len(areas) == 597
    assert sum(bool(a['polygons']) for a in areas) == 583
    assert len(bundle['points']) == 89091
    assert len({p['id'] for p in bundle['points']}) == 89091
    latest = [a for a in areas if a['sceneId'] == 3 and a['areaId1'] in (60, 61)]
    assert len(latest) == 19 and all(a['polygons'] for a in latest)
    assert next(a for a in latest if a['id'] == 82006)['areaId1'] == 61
    assert any(len(a['polygons']) > 1 for a in areas)

    # A concave shape cannot be replaced by its bounding box. Edges and height
    # boundaries are included, while points outside either are rejected.
    ring = [[0, 0], [6, 0], [6, 2], [2, 2], [2, 6], [0, 6]]
    assert inside_ring([1, 5], ring) and not inside_ring([4, 4], ring)
    assert inside_ring([2, 4], ring) and distance_to_ring([4, 4], ring) == 2
    polygon = {'ring': ring, 'height': [-2, 10]}
    assert polygon_match([1, 5], polygon, -2) and polygon_match([1, 5], polygon, 10)
    assert not polygon_match([1, 5], polygon, 11)

    result = query(bundle, '奥摩斯港', '草神瞳')
    assert result['status'] == 'crosschecked' and result['count'] == 2
    assert {p['id'] for p in result['points']} == {33876, 33877}
    assert not result['boundaryReview'] and not result['unknownHeightIds'] and not result['overlapReview']
    assert all(p['gameY'] is not None for p in result['points'])
    edge = next(p for p in result['points'] if p['id'] == 33877)
    assert 4.7 < edge['distanceToBoundaryWorld'] < 4.8

    # Missing boundaries and uncalibrated scenes must never turn into zero.
    failures = []
    scene_area = next(a for a in areas if a['sceneId'] != 3 and a['polygons'])
    for name in ['60101', '坚岩隘谷', '不存在的小区域', str(scene_area['id'])]:
        try:
            query(bundle, name, '草神瞳')
        except ValueError as e:
            failures.append({'region': name, 'error': str(e)})
        else:
            raise AssertionError('Unsupported query returned a count: ' + name)

    query_script = str(Path(__file__).with_name('region_query.py'))
    command = [sys.executable, query_script, '--data', str(args.data), '--question']
    actual = subprocess.run(command + ['须弥的奥摩斯港有多少草神瞳'], text=True, capture_output=True, check=True)
    assert json.loads(actual.stdout)['count'] == 2
    for question in ['蒙德的奥摩斯港有多少草神瞳', '奥摩斯港附近有多少草神瞳']:
        rejected = subprocess.run(command + [question], text=True, capture_output=True)
        assert rejected.returncode != 0
        failures.append({'question': question, 'error': rejected.stderr.strip().splitlines()[-1]})
    report = {'status': 'passed', 'catalog': 597, 'withGeometry': 583, 'markers': 89091,
              'latestRegionDefinitionsWithGeometry': 19,
              'ormos': {'count': 2, 'pointIds': [33876, 33877], 'status': result['status']},
              'rejectedQueries': failures, 'geometryEdgeCases': 'passed'}
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(report, ensure_ascii=False))


if __name__ == '__main__':
    main()
