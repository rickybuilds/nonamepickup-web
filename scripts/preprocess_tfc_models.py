"""Pre-convert an allowlisted standard TFC Studio model tree for replay playback.

The current in-repository Studio v10 converter intentionally emits a static,
baked pose.  This script records native metadata in the catalog so the viewer
can distinguish source capabilities from GLB capabilities without pretending
that unsupported GoldSrc state was applied.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import struct
from pathlib import Path

from convert_goldsrc_player_models import convert


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "assets" / "tfc" / "models"
PIPELINE_VERSION = 2
PROJECTILES = {
    "bomblet.mdl", "caltrop.mdl", "conc_grenade.mdl", "emp_grenade.mdl",
    "mirv_grenade.mdl", "nail.mdl", "napalm.mdl", "ngrenade.mdl",
    "pipebomb.mdl", "rpgrocket.mdl", "spy_grenade.mdl", "w_grenade.mdl",
}
OBJECTIVES = {"ball.mdl", "flag.mdl", "keycard.mdl"}
BUILDABLES = {
    "base.mdl", "detpack.mdl", "dispenser.mdl", "sentry1.mdl",
    "sentry2.mdl", "sentry3.mdl", "teleporter.mdl",
}
TEAM_COLORS = {
    "blue": (77, 163, 255),
    "red": (255, 93, 108),
    "yellow": (250, 204, 21),
    "green": (74, 222, 128),
}
LEGACY_PROJECTILE_ASSETS = {
    "models/rpgrocket.mdl": "/assets/models/rocket.glb",
    "models/w_grenade.mdl": "/assets/models/grenade.glb",
}


def legacy_projectile_entry(url: str) -> dict:
    return {
        "url": url,
        "kind": "projectile",
        "animations": [],
        "bodygroups": [],
        "skins": 1,
        "boneControllers": 0,
        "attachments": 0,
        "sourceSha256": None,
        "glb": {
            "animations": False,
            "bodygroups": False,
            "skins": "baked-family-0",
            "boneControllers": False,
            "sequenceBlending": False,
            "attachments": False,
        },
        "fallback": "legacy-replay-asset",
    }
LEGACY_PROJECTILE_ASSETS = {
    "models/rpgrocket.mdl": "/assets/models/rocket.glb",
    "models/w_grenade.mdl": "/assets/models/grenade.glb",
}


def legacy_projectile_entry(url: str) -> dict:
    return {
        "url": url,
        "kind": "projectile",
        "animations": [],
        "bodygroups": [],
        "skins": 1,
        "boneControllers": 0,
        "attachments": 0,
        "sourceSha256": None,
        "glb": {
            "animations": False,
            "bodygroups": False,
            "skins": "baked-family-0",
            "boneControllers": False,
            "sequenceBlending": False,
            "attachments": False,
        },
        "fallback": "legacy-replay-asset",
    }


def i32(data: bytes, offset: int) -> int:
    return struct.unpack_from("<i", data, offset)[0]


def cstring(raw: bytes) -> str:
    return raw.split(b"\0", 1)[0].decode("latin1", "replace")


def source_metadata(source: Path) -> dict:
    data = source.read_bytes()
    if data[:4] != b"IDST" or i32(data, 4) != 10:
        raise ValueError("not a GoldSrc Studio v10 model")
    sequences = []
    sequence_count, sequence_index = i32(data, 164), i32(data, 168)
    for number in range(sequence_count):
        offset = sequence_index + number * 176
        sequences.append({
            "index": number,
            "name": cstring(data[offset:offset + 32]),
            "fps": struct.unpack_from("<f", data, offset + 32)[0],
            "frames": i32(data, offset + 56),
            "blends": i32(data, offset + 120),
        })
    bodygroups = []
    bodypart_count, bodypart_index = i32(data, 204), i32(data, 208)
    for number in range(bodypart_count):
        offset = bodypart_index + number * 76
        bodygroups.append({
            "index": number,
            "name": cstring(data[offset:offset + 64]),
            "models": i32(data, offset + 64),
            "base": i32(data, offset + 68),
        })
    return {
        "animations": sequences,
        "bodygroups": bodygroups,
        "skins": i32(data, 196),
        "boneControllers": i32(data, 148),
        "attachments": i32(data, 212),
        "sourceSha256": hashlib.sha256(data).hexdigest(),
    }


def classify(relative: Path) -> str | None:
    name = relative.name.lower()
    parts = [part.lower() for part in relative.parts]
    if parts and parts[0] == "player":
        return "player"
    if name.startswith("p_"):
        return "weapon"
    if name in PROJECTILES:
        return "projectile"
    if name in OBJECTIVES:
        return "objective"
    if name in BUILDABLES:
        return "buildable"
    # Schema 5 uses a generic entity stream for visible studio models that do
    # not belong to a specialized gameplay stream (backpacks, pickups, gibs,
    # dropped items and map-specific props). Viewmodels are client-only and
    # cannot be assigned to a world edict, so they remain outside this catalog.
    if not name.startswith("v_"):
        return "entity"
    return None


def normalized_model_path(relative: Path) -> str:
    return "models/" + relative.as_posix().lower()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path, help="standard TFC models directory")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    source_root = args.source.resolve()
    output_root = args.output.resolve()
    if not source_root.is_dir():
        parser.error(f"source directory does not exist: {source_root}")
    output_root.mkdir(parents=True, exist_ok=True)
    player_drivers: dict[str, Path] = {}
    player_root = source_root / "player"
    if player_root.is_dir():
        for class_dir in sorted(path for path in player_root.iterdir() if path.is_dir()):
            class_name = class_dir.name.lower()
            preferred = class_dir / f"{class_name}2.mdl"
            fallback = class_dir / f"{class_name}.mdl"
            driver = preferred if preferred.is_file() else fallback
            if driver.is_file():
                player_drivers[class_name] = driver
    previous_models: dict[str, dict] = {}
    previous_manifest = output_root / "manifest.json"
    if previous_manifest.is_file():
        try:
            previous_catalog = json.loads(previous_manifest.read_text(encoding="utf-8"))
            if previous_catalog.get("pipelineVersion") == PIPELINE_VERSION:
                previous_models = previous_catalog.get("models", {})
        except (OSError, ValueError, TypeError):
            previous_models = {}

    models: dict[str, dict] = {}
    failures: list[dict] = []
    cached = 0
    for source in sorted(source_root.rglob("*.mdl"), key=lambda item: item.as_posix().lower()):
        relative = source.relative_to(source_root)
        if relative.parts and relative.parts[0].lower() == "backup":
            continue
        kind = classify(relative)
        if kind is None:
            continue
        key = normalized_model_path(relative)
        target_relative = relative.with_suffix(".glb")
        target = output_root / target_relative
        target.parent.mkdir(parents=True, exist_ok=True)
        try:
            metadata = source_metadata(source)
            previous = previous_models.get(key, {})
            if (target.is_file() and previous.get("sourceSha256") == metadata["sourceSha256"]):
                cached += 1
            else:
                convert(
                    source,
                    target=target,
                    skin_family=0,
                    filter_player_team_meshes=kind == "player",
                    generator=f"NoName TFC replay static converter v{PIPELINE_VERSION}",
                )
            entry = {
                "url": "/assets/tfc/models/" + target_relative.as_posix().lower(),
                "kind": kind,
                **metadata,
                "glb": {
                    "animations": False,
                    "bodygroups": False,
                    "skins": "baked-family-0",
                    "boneControllers": False,
                    "sequenceBlending": False,
                    "attachments": False,
                },
            }
            if kind == "weapon":
                held_variants = {}
                held_variant_sources = {}
                for class_name, driver in player_drivers.items():
                    driver_sha = hashlib.sha256(driver.read_bytes()).hexdigest()
                    variant_source = f"{metadata['sourceSha256']}:{driver_sha}"
                    variant_relative = Path("held") / class_name / relative.name
                    variant_target = (output_root / variant_relative).with_suffix(".glb")
                    variant_target.parent.mkdir(parents=True, exist_ok=True)
                    previous_variant_source = previous.get("heldVariantSources", {}).get(class_name)
                    if variant_target.is_file() and previous_variant_source == variant_source:
                        cached += 1
                    else:
                        convert(
                            source,
                            target=variant_target,
                            skin_family=0,
                            filter_player_team_meshes=False,
                            generator=f"NoName TFC held-weapon converter v{PIPELINE_VERSION}",
                            driver_source=driver,
                        )
                    held_variants[class_name] = "/assets/tfc/models/" + variant_relative.with_suffix(".glb").as_posix().lower()
                    held_variant_sources[class_name] = variant_source
                entry["heldVariants"] = held_variants
                entry["heldVariantSources"] = held_variant_sources
            if kind == "buildable":
                team_variants = {}
                team_variant_sources = {}
                for team_name, team_color in TEAM_COLORS.items():
                    variant_source = f"{metadata['sourceSha256']}:{team_name}:{team_color}:warm-v1"
                    variant_relative = Path("teams") / team_name / relative.name
                    variant_target = (output_root / variant_relative).with_suffix(".glb")
                    variant_target.parent.mkdir(parents=True, exist_ok=True)
                    previous_variant_source = previous.get("teamVariantSources", {}).get(team_name)
                    if variant_target.is_file() and previous_variant_source == variant_source:
                        cached += 1
                    else:
                        convert(
                            source,
                            target=variant_target,
                            skin_family=0,
                            filter_player_team_meshes=False,
                            generator=f"NoName TFC buildable team converter v{PIPELINE_VERSION}",
                            team_color=team_color,
                            force_team_recolor=True,
                        )
                    team_variants[team_name] = "/assets/tfc/models/" + variant_relative.with_suffix(".glb").as_posix().lower()
                    team_variant_sources[team_name] = variant_source
                entry["teamVariants"] = team_variants
                entry["teamVariantSources"] = team_variant_sources
            models[key] = entry
        except Exception as error:  # report every source; do not hide partial catalogs
            failures.append({"path": key, "kind": kind, "error": str(error)})

    for key, url in LEGACY_PROJECTILE_ASSETS.items():
        asset = ROOT / url.removeprefix("/")
        if key not in models and asset.is_file():
            models[key] = legacy_projectile_entry(url)

    for key, url in LEGACY_PROJECTILE_ASSETS.items():
        asset = ROOT / url.removeprefix("/")
        if key not in models and asset.is_file():
            models[key] = legacy_projectile_entry(url)

    expected = sorted(
        [f"models/{name}" for name in PROJECTILES | OBJECTIVES | BUILDABLES]
    )
    missing = [name for name in expected if name not in models]
    manifest = {
        "schemaVersion": 1,
        "pipelineVersion": PIPELINE_VERSION,
        "converter": "scripts/convert_goldsrc_player_models.py (static idle-pose GLB)",
        "models": dict(sorted(models.items())),
        "missing": missing,
        "failures": failures,
    }
    (output_root / "manifest.json").write_text(
        json.dumps(manifest, indent=2, sort_keys=False) + "\n", encoding="utf-8"
    )
    print(f"cataloged {len(models)} models; {cached} cached; {len(missing)} missing; {len(failures)} failed")
    for failure in failures:
        print(f"FAILED {failure['path']}: {failure['error']}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
