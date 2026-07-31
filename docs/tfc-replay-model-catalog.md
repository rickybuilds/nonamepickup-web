# TFC replay model catalog

Replay artifacts may name only models preprocessed from a configured standard
TFC `models` directory. Generate the catalog during build or deployment:

```powershell
python scripts/preprocess_tfc_models.py "C:\Program Files (x86)\Steam\steamapps\common\Half-Life\tfc\models"
```

Linux uses the same script with the deployed TFC path, such as
`/root/steamcmd/tfc/tfc/models`. The script scans only known categories: class
models under `player/`, top-level third-person `p_*.mdl` weapons, known
projectiles and objectives, sentry levels/components, dispensers, and other
standard buildables. It preserves source-relative output paths under
`assets/tfc/models`, produces deterministic lowercase catalog keys and URLs,
and reports missing or failed inputs. It does not copy or expose source MDLs.

`assets/tfc/models/manifest.json` maps normalized paths such as
`models/p_mini.mdl` to a record containing `url`, `kind`, native sequence
metadata, bodygroups, skin count, controller/attachment counts, source SHA-256,
and an explicit `glb` capability block. Upload validation uses this file as its
allowlist; conversion never runs in the API or viewer.

## Converter behavior and limitations

The exact converter is `scripts/convert_goldsrc_player_models.py`. It parses
GoldSrc Studio v10 geometry and embedded indexed textures, evaluates frame zero
of the native `idle` sequence (or bind pose), bakes the transformed mesh, maps
GoldSrc coordinates to glTF coordinates, embeds PNG textures, and writes binary
glTF 2.0 with unlit materials.

The generated GLBs are static. They do **not** contain a skeleton or reproduce
native sequences, gait sequences, bodygroup switching, runtime skin-family
switching, bone controllers, sequence blending, or attachments. Native source
capabilities remain in catalog metadata for diagnostics. The viewer retains
recorded values in object metadata and labels them unsupported. Class/team GLBs
remain the primary player visual. Held `p_*.mdl` weapons are persistent child
objects in player space, but native GoldSrc skeleton merging is not reproduced
exactly. No `w_*.mdl` pickup is substituted for a held weapon.
