#!/usr/bin/env bash
set -u

MAP_DIR="${MAP_DIR:-/var/www/tfcbot/download/tfc/maps}"
WAD_DIR="${WAD_DIR:-/var/www/tfcbot/download}"
OUT_ROOT="${OUT_ROOT:-/var/www/tfcbot/assets/maps}"
CONVERTER="${CONVERTER:-/var/www/tfcbot/scripts/convert-goldsrc-bsp-to-glb.py}"
PYTHON_BIN="${PYTHON_BIN:-python3}"
FORCE="${FORCE:-0}"
JOBS="${JOBS:-1}"
MAP_LIST="${MAP_LIST:-}"
NICE_LEVEL="${NICE_LEVEL:-10}"
SLEEP_BETWEEN="${SLEEP_BETWEEN:-0}"

mkdir -p "$OUT_ROOT"

convert_bsp() {
  bsp="$1"
  if [ ! -f "$bsp" ]; then
    echo "missing $bsp"
    return 1
  fi

  map="$(basename "$bsp" .bsp)"
  outdir="$OUT_ROOT/$map"
  out="$outdir/$map.glb"

  mkdir -p "$outdir"

  if [ -f "$out" ] && [ "$FORCE" != "1" ]; then
    echo "skip existing $map"
    return 0
  fi

  echo "converting $map"
  nice -n "$NICE_LEVEL" "$PYTHON_BIN" "$CONVERTER" "$bsp" "$out" --wad-dir "$WAD_DIR"
}

bsp_list="$(mktemp)"
trap 'rm -f "$bsp_list"' EXIT

if [ -n "$MAP_LIST" ]; then
  while IFS= read -r map || [ -n "$map" ]; do
    map="${map%.bsp}"
    [ -n "$map" ] || continue
    printf '%s\n' "$MAP_DIR/$map.bsp" >> "$bsp_list"
  done < "$MAP_LIST"
else
  find "$MAP_DIR" -maxdepth 1 -type f -name '*.bsp' | sort > "$bsp_list"
fi

if [ ! -s "$bsp_list" ]; then
  echo "No BSP files found."
  exit 0
fi

export MAP_DIR WAD_DIR OUT_ROOT CONVERTER PYTHON_BIN FORCE
export -f convert_bsp

if [ "$JOBS" -gt 1 ]; then
  echo "Running with $JOBS workers"
  xargs -r -n 1 -P "$JOBS" bash -c 'convert_bsp "$1"' _ < "$bsp_list"
else
  failed=0
  while IFS= read -r bsp || [ -n "$bsp" ]; do
    if ! convert_bsp "$bsp"; then
      failed=$((failed + 1))
    fi
    if [ "$SLEEP_BETWEEN" != "0" ]; then
      sleep "$SLEEP_BETWEEN"
    fi
  done < "$bsp_list"

  if [ "$failed" -gt 0 ]; then
    echo "Done with $failed failures."
    exit 1
  fi
fi

echo "Done."
