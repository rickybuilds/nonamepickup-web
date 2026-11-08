# Bootcamp replay map overviews

The shared replay viewer uses `/assets/data/bootcamp-overviews.json` to project world-space player frames onto the map's transparent GoldSrc overview raster. The overview is shown only for Bootcamp replays; maps without metadata continue to use the coordinate-grid fallback.

## Regenerate from a local TFC installation

Run from the website checkout in Windows PowerShell:

```powershell
.\tools\generate-bootcamp-overviews.ps1 `
  -GameDirectory 'C:\Program Files (x86)\Steam\steamapps\common\Half-Life\tfc'
```

The generator reads matching `maps/<name>.bsp`, `overviews/<name>.txt`, and `overviews/<name>.bmp` files. It uses the BSP v30 world-model bounds and the authoritative GoldSrc projection from `ZOOM`/`ORIGIN`/`ROTATED`; the overview's non-key pixel bounds are retained as audit data. The transparent green color key is converted to PNG alpha. It writes the manifest and PNGs only in this checkout.

GoldSrc overview axes depend on `ROTATED`: with `ROTATED 1`, image right follows world +X and image down follows world -Y. With `ROTATED 0`, image right follows world -Y and image down follows world -X. The generated affine transform records these orientations explicitly and tests verify both image-bound corners for each map.

## Included source coverage

The current manifest contains the 15 maps whose overview text, bitmap, and BSP were present in the local TFC installation: 2fort, avanti, badlands, casbah, crossover2, cz2, dustbowl, epicenter, flagrun, hunted, push, ravelin, rock2, warpath, and well. A map such as `openfire` without all three local source files remains unsupported and displays the grid fallback until verified source assets are provided.

The PNG files are derived from the corresponding local TFC overview bitmaps. This generator does not retrieve or modify game files.
