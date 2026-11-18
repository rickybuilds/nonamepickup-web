"""Bounded read-only export adapter for the authenticated hosted viewer."""
import contextlib
import gzip
import hashlib
import json
import os
import stat
import struct
import sys


def regular_file(filename, maximum):
    if os.path.islink(filename):
        raise ValueError("source_symlink")
    with open(filename, "rb") as source:
        before = os.fstat(source.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or not 0 < before.st_size <= maximum:
            raise ValueError("source_size_or_type")
        digest = hashlib.sha256()
        while True:
            block = source.read(1024 * 1024)
            if not block:
                break
            digest.update(block)
        after = os.fstat(source.fileno())
    if (before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (after.st_size, after.st_mtime_ns, after.st_ctime_ns):
        raise ValueError("source_changed")
    return before, digest.hexdigest()


def export(request):
    if os.name != "nt":
        import resource
        memory = int(request.get("memory_bytes", 2147483648))
        resource.setrlimit(resource.RLIMIT_AS, (memory, memory))
        resource.setrlimit(resource.RLIMIT_CPU, (150, 150))
    sys.dont_write_bytecode = True
    sys.path.insert(0, request["upstream_root"])
    import goldsrc_demo
    import demo_viewer

    before, digest = regular_file(request["demo_path"], int(request["max_demo_bytes"]))
    if digest != request["demo_sha256"]:
        raise ValueError("demo_checksum_mismatch")
    with contextlib.redirect_stdout(sys.stderr):
        demo = goldsrc_demo.Demo(request["demo_path"]).parse()
        meta, binary = demo_viewer.export_demo(demo)
    after = os.stat(request["demo_path"])
    if (before.st_ino, before.st_size, before.st_mtime_ns) != (after.st_ino, after.st_size, after.st_mtime_ns):
        raise ValueError("demo_changed")
    if not meta.get("complete"):
        raise ValueError("demo_unfinalized_missing_directory")
    if not meta.get("hltv"):
        raise ValueError("demo_is_not_hltv")
    if meta.get("map", "").lower() != request["map"].lower():
        raise ValueError("demo_wrong_map")
    if not meta.get("game", "").lower().startswith("tfc") or not meta.get("frames"):
        raise ValueError("unsupported_demo")
    if len(binary) > 536870912:
        raise ValueError("decoded_data_too_large")

    used = set()
    for slot in meta.get("slots", []):
        layout = meta.get("buffers", {}).get("info%s" % slot)
        if layout:
            offset, length = layout
            for (value,) in struct.iter_unpack("<I", binary[offset:offset + length]):
                index = (value >> 12) & 1023
                if index:
                    used.add(index)
    layout = meta.get("buffers", {}).get("objs")
    if layout:
        offset, length = layout
        for row in range(offset, offset + length, 24 * 4):
            index = int(struct.unpack_from("<f", binary, row + 2 * 4)[0])
            if index > 0:
                used.add(index)
    models = set()
    for level in meta["levels"]:
        for index in used:
            name = level["models"].get(str(index))
            if name and name.lower().endswith(".mdl"):
                models.add(name)
    models.update("models/" + name + ".mdl" for name in (
        "v_tfc_railgun", "v_tfc_crowbar", "v_flame", "v_tfgl", "v_grenade", "v_tfc_knife",
        "v_tfc_medkit", "v_tfac", "v_tfc_nailgun", "v_tfc_rpg", "v_tfc_12gauge",
        "v_tfc_shotgun", "v_tfc_supernailgun", "v_tfc_sniper", "v_tfc_spanner",
        "v_umbrella", "v_tfc_pistol"))

    output = request["output_dir"]
    for name, data in {
        "meta.json.gz": gzip.compress(json.dumps(meta, separators=(",", ":")).encode(), 4),
        "data.bin.gz": gzip.compress(binary, 4),
        "viewer-models.json": json.dumps(sorted(models), separators=(",", ":")).encode(),
    }.items():
        with open(os.path.join(output, name), "xb") as target:
            target.write(data)
    return {"ok": True, "export_version": demo_viewer.EXPORT_VERSION, "frames": meta["frames"]}


try:
    print(json.dumps(export(json.loads(sys.stdin.buffer.read(65537))), separators=(",", ":")))
except Exception as error:
    print(json.dumps({"error": type(error).__name__ + ": " + str(error)[:500]}))
    sys.exit(1)
