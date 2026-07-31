#!/usr/bin/env python3
"""
Convert GoldSrc BSPs in groups that share the same external WAD list.

This keeps WAD textures in memory for each group instead of reparsing the same
WAD files for every map.
"""

import argparse
import importlib.util
import json
import os
import time
from collections import defaultdict
from pathlib import Path


def load_converter(path):
    spec = importlib.util.spec_from_file_location("goldsrc_bsp_converter", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def read_map_names(path):
    names = []
    for line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        value = line.strip()
        if value:
            names.append(value[:-4] if value.lower().endswith(".bsp") else value)
    return names


def discover_map_names(map_dir):
    return sorted(path.stem for path in map_dir.glob("*.bsp"))


def group_maps(converter, map_dir, map_names):
    groups = defaultdict(list)
    missing = []

    for map_name in map_names:
        bsp = map_dir / f"{map_name}.bsp"
        if not bsp.is_file():
            missing.append(str(bsp))
            continue

        data = bsp.read_bytes()
        lumps = converter.parse_header(data)
        wads = tuple(sorted(set(converter.parse_entity_wads(data, lumps[converter.LUMP_ENTITIES]))))
        groups[wads].append({
            "map": map_name,
            "bsp": bsp,
            "data": data,
            "lumps": lumps,
        })

    return groups, missing


def safe_display(value):
    return str(value).encode("ascii", errors="replace").decode("ascii")


def convert_map(converter, item, out_root, wad_textures, loaded_wads, force, skip_newer_than_seconds):
    map_name = item["map"]
    out = out_root / map_name / f"{map_name}.glb"
    if out.is_file() and skip_newer_than_seconds > 0:
        age_seconds = time.time() - out.stat().st_mtime
        if age_seconds < skip_newer_than_seconds:
            print(f"skip fresh {map_name} age={int(age_seconds)}s", flush=True)
            return "skipped"

    if out.is_file() and not force:
        print(f"skip existing {map_name}", flush=True)
        return "skipped"

    print(f"converting {map_name}", flush=True)
    primitives, textures, stats = converter.build_triangles(
        item["data"],
        item["lumps"],
        preloaded_wad_textures=wad_textures,
        preloaded_wads=loaded_wads,
    )
    stats["sourceBsp"] = str(item["bsp"])
    stats["mapName"] = map_name
    if not primitives:
        raise RuntimeError("No renderable geometry was exported.")

    out.parent.mkdir(parents=True, exist_ok=True)
    converter.write_glb(out, primitives, textures, stats)
    print(json.dumps({
        "output": str(out),
        "bytes": os.path.getsize(out),
        **stats,
    }, indent=2), flush=True)
    return "converted"


def main():
    here = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(description="Convert GoldSrc BSPs grouped by shared WAD dependencies.")
    parser.add_argument("--map-dir", type=Path, default=Path("/var/www/tfcbot/download/tfc/maps"))
    parser.add_argument("--wad-dir", action="append", default=[Path("/var/www/tfcbot/download")])
    parser.add_argument("--out-root", type=Path, default=Path("/var/www/tfcbot/assets/maps"))
    parser.add_argument("--map-list", type=Path)
    parser.add_argument("--converter", type=Path, default=here / "convert-goldsrc-bsp-to-glb.py")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--skip-newer-than-seconds", type=int, default=0)
    parser.add_argument("--sleep-between", type=float, default=0.0)
    args = parser.parse_args()

    converter = load_converter(args.converter)
    map_names = read_map_names(args.map_list) if args.map_list else discover_map_names(args.map_dir)
    groups, missing = group_maps(converter, args.map_dir, map_names)

    for path in missing:
        print(f"missing {path}", flush=True)

    converted = 0
    skipped = 0
    failed = 0

    sorted_groups = sorted(groups.items(), key=lambda item: (-len(item[1]), item[0]))
    print(f"Grouped {sum(len(items) for _, items in sorted_groups)} maps into {len(sorted_groups)} WAD sets.", flush=True)

    for wads, items in sorted_groups:
        wad_label = ",".join(safe_display(wad) for wad in wads) if wads else "(embedded only)"
        print(f"loading WAD group maps={len(items)} wads={wad_label}", flush=True)
        wad_textures, loaded_wads = converter.load_wad_textures(args.wad_dir, wads)
        print(f"loaded {len(wad_textures)} WAD textures from {len(loaded_wads)} WAD files", flush=True)

        for item in items:
            try:
                result = convert_map(
                    converter,
                    item,
                    args.out_root,
                    wad_textures,
                    loaded_wads,
                    args.force,
                    args.skip_newer_than_seconds,
                )
                if result == "converted":
                    converted += 1
                else:
                    skipped += 1
            except Exception as exc:
                failed += 1
                print(f"FAILED {item['map']}: {exc}", flush=True)

            if args.sleep_between > 0:
                time.sleep(args.sleep_between)

    print(f"Done. converted={converted} skipped={skipped} failed={failed} missing={len(missing)}", flush=True)
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
