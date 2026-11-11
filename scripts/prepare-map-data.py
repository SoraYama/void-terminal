#!/usr/bin/env python3
"""Copy audited map inputs into a content-addressed, immutable runtime snapshot.

Only Python's standard library is needed. This is an offline build step; the web
runtime reads the resulting JSON directly and never starts this script. Inputs
are never modified. Re-running verifies an existing snapshot instead of replacing
it. MAP_DATA_DIR should point to the resulting output directory at deployment.
"""
import argparse
import hashlib
import json
import re
import shutil
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def digest(data):
    return hashlib.sha256(data).hexdigest()


def encode(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')) + '\n').encode()


def read(path):
    return json.loads(path.read_bytes())


def flight_messages(path):
    pattern = r'self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)'
    flight = ''.join(json.loads(match.group(1)) for match in re.finditer(pattern, path.read_text()))
    return json.JSONDecoder().raw_decode(flight.split('"messages":', 1)[1])[0]


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument('--bundle', type=Path, required=True)
    cli.add_argument('--assets', type=Path, required=True, help='Retained atlas72-assets directory')
    cli.add_argument('--extra-tiles', type=Path, help='Retained Ormos level-15 x_y.jpg directory')
    cli.add_argument('--source', type=Path, help='Retained AppSample pages; enrich verified English resource names')
    cli.add_argument('--game-data', type=Path, help='TextMap and ExcelBinOutput directory for English region names')
    cli.add_argument('--area-config', type=Path, help='Pinned WorldAreaConfigData used by the audited bundle')
    cli.add_argument('--output', type=Path, default=ROOT / 'data/maps')
    args = cli.parse_args()
    original = args.bundle.read_bytes()
    bundle = json.loads(original)
    if bundle.get('schema') != 1 or bundle['version']['appsample'] != '7.2':
        raise ValueError('Expected the audited schema-1 game-7.2 bundle')
    if len({p['id'] for p in bundle['points']}) != len(bundle['points']):
        raise ValueError('Duplicate marker IDs')
    bundle.setdefault('sources', {})['runtimePreparation'] = {'inputBundleSHA256': digest(original)}
    provenance = bundle['sources']['runtimePreparation']
    if args.source:
        marker_source = args.source / 'markers.json'
        expected = bundle['sources'].get('appsampleSHA256')
        if expected and digest(marker_source.read_bytes()) != expected:
            raise ValueError('AppSample source differs from the audited bundle')
        page = args.source / 'teyvat.html'
        english = flight_messages(page)['markers']
        bundle['typesEn'] = {key: value for key, value in english.items() if key in bundle['types'] and value and value != key}
        provenance['englishPageSHA256'] = digest(page.read_bytes())
    if args.game_data:
        texts = {}
        for name in ('TextMapEN.json', 'TextMap_MediumEN.json'):
            file = args.game_data / 'TextMap' / name
            texts.update(read(file))
            provenance[name] = digest(file.read_bytes())
        config = args.area_config or args.game_data / 'ExcelBinOutput/WorldAreaConfigData.json'
        config_hash = digest(config.read_bytes())
        expected = bundle['sources'].get('areaConfigSHA256')
        if expected and expected != config_hash:
            raise ValueError('Region config differs from the audited bundle; pass --area-config with its pinned original')
        rows = {row['id']: row for row in read(config)}
        for area in bundle['areas']:
            english = texts.get(str(rows.get(area['id'], {}).get('areaNameTextMapHash')))
            if english:
                area['nameEn'] = english
        provenance['englishAreaConfigSHA256'] = config_hash
    asset_files = {}
    for file in sorted(args.assets.iterdir()):
        if re.fullmatch(r'(?:icon_\d{1,8}\.png|teyvat_1[0-5]_-?\d{1,5}_-?\d{1,5}\.jpg)', file.name):
            asset_files[file.name] = file
    if args.extra_tiles:
        for file in sorted(args.extra_tiles.iterdir()):
            if re.fullmatch(r'-?\d{1,5}_-?\d{1,5}\.jpg', file.name):
                name = 'teyvat_15_' + file.name
                if name in asset_files and digest(asset_files[name].read_bytes()) != digest(file.read_bytes()):
                    raise ValueError('Conflicting retained tile: ' + name)
                asset_files[name] = file
    assets = {}
    for name, file in asset_files.items():
        data = file.read_bytes()
        signature = b'\x89PNG\r\n\x1a\n' if name.endswith('.png') else b'\xff\xd8\xff'
        if len(data) > 2_000_000 or not data.startswith(signature):
            raise ValueError('Invalid retained image: ' + name)
        assets[name] = {'sha256': digest(data), 'bytes': len(data)}
    data_bytes, index_bytes = encode(bundle), encode(assets)
    data_hash, assets_hash = digest(data_bytes), digest(index_bytes)
    snapshot_id = 'map-7.2-' + digest(f'{data_hash}\n{assets_hash}\n'.encode())[:16]
    manifest = {'schema': 1, 'id': snapshot_id, 'gameVersion': '7.2', 'sourceTime': bundle['version']['snapshotTime'],
                'dataHash': data_hash, 'assetsHash': assets_hash,
                'map': {'key': 'teyvat', 'revision': 'v72-rc1', 'minZoom': 10, 'maxZoom': 15, 'tileSize': 256}}
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    destination = output / snapshot_id
    expected_files = {'bundle.json': data_bytes, 'assets.json': index_bytes, 'manifest.json': encode(manifest)}
    if destination.exists():
        for name, data in expected_files.items():
            if (destination / name).read_bytes() != data:
                raise ValueError('Refusing to overwrite changed immutable snapshot file: ' + name)
        for name, record in assets.items():
            if digest((destination / 'assets' / name).read_bytes()) != record['sha256']:
                raise ValueError('Refusing to overwrite changed immutable asset: ' + name)
    else:
        temporary = Path(tempfile.mkdtemp(prefix='.prepare-', dir=output))
        try:
            (temporary / 'assets').mkdir()
            for name, data in expected_files.items():
                (temporary / name).write_bytes(data)
            for name, file in asset_files.items():
                shutil.copyfile(file, temporary / 'assets' / name)
                if digest((temporary / 'assets' / name).read_bytes()) != assets[name]['sha256']:
                    raise ValueError('Source asset changed during preparation: ' + name)
            temporary.rename(destination)
        finally:
            if temporary.exists():
                shutil.rmtree(temporary)
    # The only mutable pointer is replaced atomically after all data is verified.
    with tempfile.NamedTemporaryFile(prefix='.current-', dir=output, delete=False) as pointer:
        pointer.write(encode({'snapshotId': snapshot_id}))
        pointer_path = Path(pointer.name)
    pointer_path.replace(output / 'current.json')
    print(json.dumps({'snapshotId': snapshot_id, 'directory': str(destination), 'points': len(bundle['points']),
                      'regions': len(bundle['areas']), 'assets': len(assets),
                      'englishRegions': sum(bool(a.get('nameEn')) for a in bundle['areas']),
                      'englishResources': len(bundle.get('typesEn', {}))}, ensure_ascii=False))


if __name__ == '__main__':
    main()
