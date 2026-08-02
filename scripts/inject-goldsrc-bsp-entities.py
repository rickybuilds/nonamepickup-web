#!/usr/bin/env python3
"""Inject complete GoldSrc entity metadata into existing replay-map GLBs.

This preserves every existing mesh, material, texture, and binary chunk. It is
intended for entity-only exporter upgrades that should not require a full BSP
geometry conversion.
"""

import argparse
import importlib.util
import json
import os
import struct
from pathlib import Path


GLB_MAGIC = 0x46546C67
GLB_VERSION = 2
JSON_CHUNK = b"JSON"


def load_converter(path):
    spec = importlib.util.spec_from_file_location("goldsrc_bsp_converter", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def read_map_names(path):
    names = []
    for line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        value = line.strip()
        if value and not value.startswith("#"):
            names.append(value[:-4] if value.lower().endswith(".bsp") else value)
    return names


def case_insensitive_file(directory, filename):
    direct = directory / filename
    if direct.is_file():
        return direct
    lowered = filename.lower()
    if directory.is_dir():
        for candidate in directory.iterdir():
            if candidate.is_file() and candidate.name.lower() == lowered:
                return candidate
    return None


def read_glb(path):
    blob = path.read_bytes()
    if len(blob) < 20:
        raise ValueError("GLB is truncated")
    magic, version, declared_length = struct.unpack_from("<III", blob, 0)
    if magic != GLB_MAGIC or version != GLB_VERSION or declared_length != len(blob):
        raise ValueError("Invalid GLB header")

    chunks = []
    offset = 12
    while offset < len(blob):
        if offset + 8 > len(blob):
            raise ValueError("GLB has a truncated chunk header")
        length, kind = struct.unpack_from("<I4s", blob, offset)
        start = offset + 8
        end = start + length
        if end > len(blob):
            raise ValueError("GLB has a truncated chunk")
        chunks.append((kind, blob[start:end]))
        offset = end
    if not chunks or chunks[0][0] != JSON_CHUNK:
        raise ValueError("GLB JSON chunk is missing")
    document = json.loads(chunks[0][1].decode("utf-8").rstrip(" \t\r\n\0"))
    return document, chunks


def write_glb_atomic(path, document, chunks):
    json_blob = json.dumps(document, separators=(",", ":")).encode("utf-8")
    json_blob += b" " * ((-len(json_blob)) % 4)
    updated = [(JSON_CHUNK, json_blob), *chunks[1:]]
    total_length = 12 + sum(8 + len(payload) for _, payload in updated)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".entity-update.tmp")
    with temporary.open("wb") as handle:
        handle.write(struct.pack("<III", GLB_MAGIC, GLB_VERSION, total_length))
        for kind, payload in updated:
            handle.write(struct.pack("<I4s", len(payload), kind))
            handle.write(payload)
    os.replace(temporary, path)


def inject_map(converter, bsp, source_glb, output_glb, dry_run=False):
    data = bsp.read_bytes()
    lumps = converter.parse_header(data)
    entity_lump = lumps[converter.LUMP_ENTITIES]
    raw_entities = converter.entity_lump_text(data, entity_lump)
    entities = converter.parse_entities(data, entity_lump)
    beams = converter.extract_entity_beams(data, entity_lump)
    document, chunks = read_glb(source_glb)
    extras = document.setdefault("extras", {})
    extras["goldsrcEntityArchiveVersion"] = 1
    extras["goldsrcEntityLump"] = raw_entities
    extras["goldsrcEntities"] = entities
    extras["goldsrcBeams"] = beams
    source = extras.setdefault("source", {})
    source["entityCount"] = len(entities)
    source["entityBeamCount"] = len(beams)
    if not dry_run:
        write_glb_atomic(output_glb, document, chunks)
    return len(entities), len(beams)


def main():
    here = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(description="Inject BSP entities into existing GoldSrc replay GLBs.")
    parser.add_argument("--map-dir", type=Path, required=True, help="Directory containing source BSP files")
    parser.add_argument("--glb-root", type=Path, required=True, help="Root containing the existing <map>/<map>.glb files")
    parser.add_argument("--output-root", type=Path, required=True, help="Clean staging root for updated <map>/<map>.glb files")
    parser.add_argument("--map-list", type=Path, required=True, help="One map name per line")
    parser.add_argument("--converter", type=Path, default=here / "convert-goldsrc-bsp-to-glb.py")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    converter = load_converter(args.converter)
    updated = 0
    missing_bsp = []
    missing_glb = []
    failed = []
    for map_name in read_map_names(args.map_list):
        bsp = case_insensitive_file(args.map_dir, f"{map_name}.bsp")
        map_output = args.glb_root / map_name
        glb = case_insensitive_file(map_output, f"{map_name}.glb")
        if not bsp:
            missing_bsp.append(map_name)
            print(f"missing BSP {map_name}")
            continue
        if not glb:
            missing_glb.append(map_name)
            print(f"missing GLB {map_name}")
            continue
        try:
            output_glb = args.output_root / map_name / f"{map_name}.glb"
            entity_count, beam_count = inject_map(converter, bsp, glb, output_glb, args.dry_run)
            updated += 1
            action = "checked" if args.dry_run else "updated"
            print(f"{action} {map_name} entities={entity_count} beams={beam_count}")
        except Exception as error:
            failed.append(map_name)
            print(f"FAILED {map_name}: {error}")

    print(
        f"Done. updated={updated} missing_bsp={len(missing_bsp)} "
        f"missing_glb={len(missing_glb)} failed={len(failed)}"
    )
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
