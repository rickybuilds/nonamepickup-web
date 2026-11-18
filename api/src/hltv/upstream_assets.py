"""Convert required private assets using untouched upstream BSP/MDL code."""
import gzip
import hashlib
import json
import os
import pathlib
import struct
import sys


def convert(request):
    sys.dont_write_bytecode = True
    sys.path.insert(0, request['upstream_root'])
    import bsp
    import mdl
    root = pathlib.Path(request['assets_root']).resolve(strict=True)
    if root == pathlib.Path(root.anchor) or not (root / 'tfc').is_dir():
        raise ValueError('invalid_private_asset_root')
    with gzip.open(os.path.join(request['output_dir'], 'meta.json.gz'), 'rt') as source:
        meta = json.load(source)
    if meta['game'].lower() != 'tfc':
        raise ValueError('unsupported_game_assets')
    models = set()
    for level in meta['levels']:
        for name in level['models'].values():
            if name.lower().endswith('.mdl') and name.lower().startswith('models/player/'):
                models.add(name)
    # Include every server player model, not just class appearance models.
    for track in meta.get('pmodels', {}).values():
        for _, index in track:
            for level in meta['levels']:
                name = level['models'].get(str(index))
                if name and name.lower().endswith('.mdl'):
                    models.add(name)
    if request.get('viewer'):
        # The scanner needs only player models. Hosted playback additionally needs
        # every model index actually referenced by player weapons and demo objects.
        with open(os.path.join(request['output_dir'], 'viewer-models.json'), 'rb') as source:
            viewer_models = json.loads(source.read(65537))
        if not isinstance(viewer_models, list) or len(viewer_models) > 256 or not all(isinstance(name, str) for name in viewer_models):
            raise ValueError('invalid_viewer_model_manifest')
        models.update(viewer_models)
    maps = {level['map'] for level in meta['levels']}
    if len(models) > (256 if request.get('viewer') else 128) or len(maps) > 8:
        raise ValueError('too_many_analysis_assets')
    rows = []
    def safe(filename):
        p = pathlib.Path(filename)
        real = p.resolve(strict=True)
        if root not in real.parents or p.is_symlink() or not real.is_file() or real.stat().st_size > 67108864:
            raise ValueError('unsafe_analysis_asset')
        return real
    with open(os.path.join(request['output_dir'], 'assets.bin'), 'xb') as output:
        output.write(bytes(65536))
        for kind, names in [('map', sorted(maps)), ('model', sorted(models))]:
            for name in names:
                if '\\' in name or ':' in name or '..' in name.split('/') or name.startswith('/'):
                    raise ValueError('unsafe_analysis_asset_name')
                filename = bsp.find_map(str(root), 'tfc', name) if kind == 'map' else mdl.find_model(str(root), 'tfc', name)
                route = '/api/%s/tfc/%s' % (kind, name)
                if not filename:
                    rows.append({'route': route, 'missing': True})
                    continue
                filename = safe(filename)
                # Hash companion studio texture/sequence files too. Reject symlink companions.
                sources = [filename]
                if kind == 'model':
                    sources = sorted(filename.parent.glob(filename.stem + '*.mdl'))
                hashes = []
                for source in sources:
                    source = safe(source)
                    hashes.append([str(source.relative_to(root)).replace('\\', '/'), hashlib.sha256(source.read_bytes()).hexdigest()])
                built, buffers = bsp.build(str(filename), str(root)) if kind == 'map' else mdl.build(str(filename))
                packed = bsp.pack(built, buffers)[0] if kind == 'map' else mdl.pack(built, buffers)
                if len(packed) > 134217728:
                    raise ValueError('analysis_asset_too_large')
                compressed = gzip.compress(packed, 1)
                rows.append({'route': route, 'offset': output.tell(), 'length': len(compressed),
                             'sha256': hashlib.sha256(packed).hexdigest(), 'sources': hashes})
                output.write(compressed)
                if output.tell() > 268435456:
                    raise ValueError('analysis_asset_bundle_too_large')
        header = json.dumps({'version': 1, 'assets': rows}, separators=(',', ':')).encode()
        if len(header) > 65532:
            raise ValueError('analysis_asset_manifest_too_large')
        output.seek(0)
        output.write(struct.pack('<I', len(header)) + header)
    return {'ok': True, 'assets': len(rows), 'missing': sum(bool(row.get('missing')) for row in rows)}


if __name__ == '__main__':
    try:
        print(json.dumps(convert(json.loads(sys.stdin.buffer.read(65537)))))
    except Exception as error:
        print(json.dumps({'error': type(error).__name__ + ': ' + str(error)[:500]}))
        sys.exit(1)
