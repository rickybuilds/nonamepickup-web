"""Thin private worker adapter. All decoding/matching comes from untouched Ghosty upstream."""
import contextlib
import gzip
import hashlib
import json
import os
import stat
import sys


def read_source(filename, limit):
    if os.path.islink(filename):
        raise ValueError("source_symlink")
    with open(filename, 'rb') as source:
        before = os.fstat(source.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or not 0 < before.st_size <= limit:
            raise ValueError("source_size_or_type")
        data = source.read(limit + 1)
        after = os.fstat(source.fileno())
    if len(data) != before.st_size or (before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (after.st_size, after.st_mtime_ns, after.st_ctime_ns):
        raise ValueError("source_changed")
    return data


def main(request):
    if os.name != 'nt':
        import resource
        memory = int(request.get('memory_bytes', 2147483648))
        resource.setrlimit(resource.RLIMIT_AS, (memory, memory))
        resource.setrlimit(resource.RLIMIT_CPU, (150, 150))
    sys.dont_write_bytecode = True
    sys.path.insert(0, request['upstream_root'])
    import goldsrc_demo
    import demo_viewer
    import server_log
    if not callable(demo_viewer.export_demo) or not callable(server_log.align_log):
        raise ValueError("unsupported_upstream_api")
    if request.get('check'):
        # Synthetic transport probe for the real upstream matcher. Never stored
        # as a match, detection or production alert.
        import datetime
        origin = datetime.datetime(2026, 1, 1, 12, 0, 0)
        lines = ['L 01/01/2026 - 12:00:00: Loading map "test"']
        kills = []
        for i in range(1, 25):
            stamp = (origin + datetime.timedelta(seconds=i * 5)).strftime('%m/%d/%Y - %H:%M:%S')
            lines.append('L %s: "A<1><STEAM_0:1:1><Blue>" killed "B<2><STEAM_0:1:2><Red>" with "shotgun"' % stamp)
            kills.append([i * 5 + 2, 1, 2])
        meta = {'game': 'tfc', 'map': 'test', 'file': 'compatibility.dem', 'start': 0, 'end': 140, 'kills': kills,
                'players': [{'ent': 1, 'steam': 'STEAM_0:1:1', 'first': 0, 'left': None},
                            {'ent': 2, 'steam': 'STEAM_0:1:2', 'first': 0, 'left': None}], 'pauses': []}
        aligned = server_log.align_log('\n'.join(lines).encode(), 'compatibility.log', meta)
        if aligned['alignment']['anchors'] != 24 or aligned['alignment']['offset'] != 2:
            raise ValueError("incompatible_upstream_matcher")
        return {'ok': True, 'export_version': demo_viewer.EXPORT_VERSION}

    raw = read_source(request['demo_path'], request['max_demo_bytes'])
    if hashlib.sha256(raw).hexdigest() != request['demo_sha256']:
        raise ValueError("demo_checksum_mismatch")
    del raw
    before = os.stat(request['demo_path'])
    with contextlib.redirect_stdout(sys.stderr):
        dm = goldsrc_demo.Demo(request['demo_path']).parse()
        meta, binary = demo_viewer.export_demo(dm)
    after = os.stat(request['demo_path'])
    if (before.st_ino, before.st_size, before.st_mtime_ns) != (after.st_ino, after.st_size, after.st_mtime_ns):
        raise ValueError("demo_changed")
    if not meta.get('complete'):
        raise ValueError("demo_unfinalized_missing_directory")
    if not meta.get('hltv'):
        raise ValueError("demo_is_not_hltv")
    if meta.get('map', '').lower() != request['map'].lower():
        raise ValueError("demo_wrong_map")
    if not meta.get('game', '').lower().startswith('tfc') or not meta.get('frames'):
        raise ValueError("unsupported_demo")

    snapshot = request.get('source_snapshot')
    if snapshot:
        name = snapshot.get('log_filename')
        data = read_source(snapshot['log_path'], 8388608)
        if hashlib.sha256(data).hexdigest() != snapshot.get('sha256'):
            raise ValueError("log_source_checksum_mismatch")
        names = [name]
        originals = [(name, data)]
        source_hash = snapshot.get('source_hash')
        manifest_sha256 = snapshot.get('manifest_sha256')
    else:
        try:
            manifest_bytes = read_source(request['log_manifest'], 65536)
            manifest = json.loads(manifest_bytes)
            result = json.loads(read_source(request['log_result'], 33554432))
        except FileNotFoundError as error:
            raise ValueError('missing_parser_log_manifest' if error.filename == request['log_manifest'] else 'missing_parser_result')
        names = manifest.get('logs')
        if names not in [['round-1.log'], ['round-1.log', 'round-2.log']]:
            raise ValueError("invalid_log_manifest")
        if result.get('matchId') != request['match_id'] or result.get('map', '').lower() != meta['map'].lower():
            raise ValueError("log_match_identity")
        combined = hashlib.sha256()
        originals = []
        for name in names:
            data = read_source(os.path.join(request['log_dir'], name), 8388608)
            combined.update(str(len(data)).encode('ascii') + b':' + data)
            originals.append((name, data))
        source_hash = combined.hexdigest()
        if source_hash != result.get('sourceHash'):
            raise ValueError("log_source_checksum_mismatch")
        manifest_sha256 = hashlib.sha256(manifest_bytes).hexdigest()
    accepted, rejected = [], []
    for index, (name, data) in enumerate(originals):
        try:
            aligned = server_log.align_log(data, name, meta)
            accepted.append((index + 1, name, hashlib.sha256(data).hexdigest(), aligned))
        except server_log.LogError as error:
            rejected.append({'round': index + 1, 'reason': str(error)[:500]})
    if len(accepted) != 1:
        return {'status': 'unmatched' if not accepted else 'ambiguous', 'candidates': rejected,
                'accepted_rounds': [row[0] for row in accepted]}
    if len(binary) > 536870912:
        raise ValueError("decoded_data_too_large")
    round_number, log_name, log_sha, aligned = accepted[0]
    output = request['output_dir']
    with open(os.path.join(output, 'accepted-log.bin'), 'xb') as target:
        target.write(originals[round_number - 1][1])
    with open(os.path.join(output, 'source-manifest.json'), 'xb') as target:
        target.write(json.dumps({'match_id': request['match_id'], 'map': meta['map'], 'logs': names,
                                 'accepted_round': round_number, 'accepted_filename': log_name,
                                 'source_hash': source_hash,
                                 'manifest_sha256': manifest_sha256}, separators=(',', ':')).encode())
    for name, data in [('meta.json.gz', gzip.compress(json.dumps(meta, separators=(',', ':')).encode(), 4)),
                       ('data.bin.gz', gzip.compress(binary, 4)),
                       ('matched-log.json', json.dumps(aligned, separators=(',', ':')).encode())]:
        with open(os.path.join(output, name), 'xb') as target:
            target.write(data)
    return {'status': 'matched', 'log_round': round_number, 'log_filename': log_name,
            'log_sha256': log_sha, 'source_hash': source_hash, 'alignment': aligned['alignment'],
            'export_version': demo_viewer.EXPORT_VERSION, 'rejected_candidates': rejected,
            'manifest_sha256': manifest_sha256}


try:
    request = json.loads(sys.stdin.buffer.read(65537))
    response = main(request)
    print(json.dumps(response, separators=(',', ':')))
except Exception as error:
    print(json.dumps({'status': 'failed', 'error': type(error).__name__ + ': ' + str(error)[:500]}))
    sys.exit(1)
