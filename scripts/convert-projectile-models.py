#!/usr/bin/env python3
"""
Batch convert replay projectile GoldSrc models into web GLBs.
"""

import argparse
import importlib.util
import json
import os
from pathlib import Path


MODEL_MAP = [
    ("conc_grenade.mdl", "conc_grenade.glb", None),
    ("w_grenade.mdl", "grenade.glb", None),
    ("rpgrocket.mdl", "rocket.glb", None),
    ("pipebomb.mdl", "pipebomb_yellow.glb", 0),
    ("pipebomb.mdl", "pipebomb_blue.glb", 1),
    ("mirv_grenade.mdl", "mirv.glb", None),
    ("bomblet.mdl", "bomblet.glb", None),
    ("ngrenade.mdl", "nailgrenade.glb", None),
    ("napalm.mdl", "napalm.glb", None),
]


def load_converter(path):
    spec = importlib.util.spec_from_file_location("goldsrc_mdl_converter", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    here = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(description="Batch convert replay projectile MDLs into GLBs.")
    parser.add_argument("--mdl-dir", type=Path, required=True, help="Directory containing source .mdl files.")
    parser.add_argument("--out-dir", type=Path, required=True, help="Directory to write converted .glb files.")
    parser.add_argument("--converter", type=Path, default=here / "convert-goldsrc-mdl-to-glb.py")
    args = parser.parse_args()

    converter = load_converter(args.converter)
    args.out_dir.mkdir(parents=True, exist_ok=True)

    converted = 0
    missing = []
    failed = 0

    for mdl_name, glb_name, skin_family in MODEL_MAP:
        source = args.mdl_dir / mdl_name
        output = args.out_dir / glb_name

        if not source.is_file():
            missing.append(str(source))
            print(f"MISSING {source} -> {output}", flush=True)
            continue

        try:
            result = converter.convert_mdl_to_glb(source, output, preferred_skin_family=skin_family)
            converted += 1
            print(json.dumps(result, indent=2), flush=True)
        except Exception as exc:
            failed += 1
            print(f"FAILED {source}: {exc}", flush=True)

    print(json.dumps({
        "converted": converted,
        "missing": missing,
        "failed": failed,
        "outDir": str(args.out_dir),
        "bytes": sum(os.path.getsize(args.out_dir / glb_name) for _, glb_name, _ in MODEL_MAP if (args.out_dir / glb_name).is_file()),
    }, indent=2), flush=True)

    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
