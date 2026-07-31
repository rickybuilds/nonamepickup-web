#!/usr/bin/env python3
"""
Minimal GoldSrc BSP v30 -> GLB converter for replay-viewer phase 2.

This exports world geometry with embedded GoldSrc MIP textures when present,
and can fill missing textures from external GoldSrc WAD3 files.
It skips common tool/special textures and writes a GLB using the same axis
mapping as the replay viewer:

  threeX = x
  threeY = z
  threeZ = -y
"""

import argparse
import json
import math
import os
import re
import struct
import zlib
from pathlib import Path


HEADER_LUMPS = 15
LUMP_ENTITIES = 0
LUMP_TEXTURES = 2
LUMP_VERTICES = 3
LUMP_TEXINFO = 6
LUMP_FACES = 7
LUMP_LIGHTING = 8
LUMP_EDGES = 12
LUMP_SURFEDGES = 13

SKIP_TEXTURE_PREFIXES = (
    "aaatrigger",
    "clip",
    "hint",
    "origin",
    "skip",
    "sky",
    "trigger",
    "{invisible",
)
SKIP_TEXTURE_NAMES = {
    "null",
}


def read_i32(data, offset):
    return struct.unpack_from("<i", data, offset)[0]


def read_u16(data, offset):
    return struct.unpack_from("<H", data, offset)[0]


def read_u8(data, offset):
    return struct.unpack_from("<B", data, offset)[0]


def read_i16(data, offset):
    return struct.unpack_from("<h", data, offset)[0]


def read_f32(data, offset):
    return struct.unpack_from("<f", data, offset)[0]


def cstring(raw):
    end = raw.find(b"\0")
    if end >= 0:
        raw = raw[:end]
    return raw.decode("ascii", errors="replace")


def texture_record(name="", width=0, height=0, pixels=b"", palette=None, png=b"", source="bsp"):
    return {
        "name": name,
        "width": width,
        "height": height,
        "pixels": pixels,
        "palette": palette or [],
        "png": png,
        "source": source,
    }


def parse_header(data):
    version = read_i32(data, 0)
    if version != 30:
        raise ValueError(f"Expected GoldSrc BSP version 30, got {version}")

    lumps = []
    for index in range(HEADER_LUMPS):
        base = 4 + index * 8
        lumps.append((read_i32(data, base), read_i32(data, base + 4)))
    return lumps


def parse_mip_texture(data, mip, source="bsp"):
    name = cstring(data[mip:mip + 16])
    width = read_i32(data, mip + 16)
    height = read_i32(data, mip + 20)
    offsets = [read_i32(data, mip + 24 + level * 4) for level in range(4)]
    pixels = b""
    palette = []
    png = b""

    if width > 0 and height > 0 and offsets[0] > 0:
        pixel_count = width * height
        pixels_start = mip + offsets[0]
        pixels_end = pixels_start + pixel_count
        palette_offset = pixels_end + pixel_count // 4 + pixel_count // 16 + pixel_count // 64
        if pixels_end <= len(data) and palette_offset + 2 <= len(data):
            pixels = data[pixels_start:pixels_end]
            color_count = read_u16(data, palette_offset)
            color_count = 256 if color_count <= 0 or color_count > 256 else color_count
            palette_start = palette_offset + 2
            for color_index in range(color_count):
                rgb = data[palette_start + color_index * 3:palette_start + color_index * 3 + 3]
                if len(rgb) == 3:
                    alpha = 0 if name.startswith("{") and color_index == 255 else 255
                    palette.append((rgb[0], rgb[1], rgb[2], alpha))
            if len(palette) >= 1 and len(pixels) == pixel_count:
                png = make_png_rgba(width, height, pixels, palette)

    return texture_record(name, width, height, pixels, palette, png, source)


def parse_textures(data, lump):
    offset, length = lump
    if length <= 4:
        return []

    count = read_i32(data, offset)
    textures = []
    for index in range(count):
        rel = read_i32(data, offset + 4 + index * 4)
        if rel < 0:
            textures.append(texture_record())
            continue
        textures.append(parse_mip_texture(data, offset + rel))
    return textures


def parse_entity_wads(data, lump):
    offset, length = lump
    text = data[offset:offset + length].decode("latin-1", errors="ignore")
    wad_names = []
    for match in re.finditer(r'"wad"\s+"([^"]+)"', text, re.IGNORECASE):
        for value in match.group(1).split(";"):
            value = value.strip().replace("\\", "/")
            if value:
                wad_names.append(Path(value).name.lower())
    return wad_names


def parse_wad_textures(path):
    data = path.read_bytes()
    if len(data) < 12 or data[:4] not in (b"WAD2", b"WAD3"):
        return {}

    count = read_i32(data, 4)
    directory_offset = read_i32(data, 8)
    textures = {}
    for index in range(count):
        entry = directory_offset + index * 32
        if entry + 32 > len(data):
            break
        file_offset = read_i32(data, entry)
        disk_size = read_i32(data, entry + 4)
        lump_type = read_u8(data, entry + 12)
        compression = read_u8(data, entry + 13)
        name = cstring(data[entry + 16:entry + 32])

        if compression != 0 or lump_type not in (0x40, 0x43):
            continue
        if file_offset < 0 or disk_size <= 0 or file_offset + disk_size > len(data):
            continue

        lump_data = data[file_offset:file_offset + disk_size]
        if len(lump_data) >= 40:
            texture = parse_mip_texture(lump_data, 0, str(path))
            if not texture["name"]:
                texture["name"] = name
            if texture.get("png"):
                textures[texture["name"].lower()] = texture
    return textures


def load_wad_textures(wad_dirs, wanted_wads):
    search_dirs = [Path(directory) for directory in wad_dirs if directory]
    wanted = {name.lower() for name in wanted_wads}
    wad_paths = []

    for directory in search_dirs:
        if not directory.is_dir():
            continue
        if wanted:
            found = set()
            for name in wanted:
                direct = directory / name
                if direct.is_file():
                    wad_paths.append(direct)
                    found.add(name)
            missing = wanted - found
            if missing:
                for candidate in directory.rglob("*.wad"):
                    if candidate.name.lower() in missing:
                        wad_paths.append(candidate)
                        found.add(candidate.name.lower())
                        if found >= wanted:
                            break
        else:
            wad_paths.extend(directory.rglob("*.wad"))

    textures = {}
    loaded_wads = []
    for path in sorted(set(wad_paths), key=lambda item: str(item).lower()):
        loaded = parse_wad_textures(path)
        if loaded:
            textures.update(loaded)
            loaded_wads.append(str(path))
    return textures, loaded_wads


def fill_missing_textures_from_wads(textures, wad_textures):
    filled = 0
    for texture in textures:
        if texture.get("png"):
            continue
        wad_texture = wad_textures.get((texture.get("name") or "").lower())
        if not wad_texture:
            continue
        texture.update({
            "width": wad_texture["width"],
            "height": wad_texture["height"],
            "pixels": wad_texture["pixels"],
            "palette": wad_texture["palette"],
            "png": wad_texture["png"],
            "source": wad_texture["source"],
        })
        filled += 1
    return filled


def parse_vertices(data, lump):
    offset, length = lump
    vertices = []
    for pos in range(offset, offset + length, 12):
        x, y, z = struct.unpack_from("<fff", data, pos)
        vertices.append((x, y, z))
    return vertices


def parse_texinfos(data, lump):
    offset, length = lump
    texinfos = []
    for pos in range(offset, offset + length, 40):
        s = struct.unpack_from("<ffff", data, pos)
        t = struct.unpack_from("<ffff", data, pos + 16)
        texture_id = read_i32(data, pos + 32)
        flags = read_i32(data, pos + 36)
        texinfos.append({
            "s": s,
            "t": t,
            "texture_id": texture_id,
            "flags": flags,
        })
    return texinfos


def parse_edges(data, lump):
    offset, length = lump
    edges = []
    for pos in range(offset, offset + length, 4):
        edges.append((read_u16(data, pos), read_u16(data, pos + 2)))
    return edges


def parse_surfedges(data, lump):
    offset, length = lump
    return [read_i32(data, pos) for pos in range(offset, offset + length, 4)]


def make_png_rgba(width, height, indexed_pixels, palette):
    rows = []
    for y in range(height):
        row = bytearray([0])
        start = y * width
        for value in indexed_pixels[start:start + width]:
            if value < len(palette):
                row.extend(palette[value])
            else:
                row.extend((255, 0, 255, 255))
        rows.append(bytes(row))

    raw = b"".join(rows)

    def chunk(kind, payload):
        return (
            struct.pack(">I", len(payload))
            + kind
            + payload
            + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF)
        )

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def should_skip_texture(name):
    lowered = (name or "").lower()
    return lowered in SKIP_TEXTURE_NAMES or any(lowered.startswith(prefix) for prefix in SKIP_TEXTURE_PREFIXES)


def texture_kind(name):
    value = name or ""
    if value.startswith("!"):
        return "water"
    if value.startswith("{"):
        return "masked"
    if value.startswith("+"):
        return "animated"
    return "normal"


def to_three(vertex):
    x, y, z = vertex
    return (x, z, -y)


def texture_uv(vertex, texinfo, texture):
    width = max(1, texture.get("width") or 1)
    height = max(1, texture.get("height") or 1)
    x, y, z = vertex
    s = texinfo["s"]
    t = texinfo["t"]
    u = (x * s[0] + y * s[1] + z * s[2] + s[3]) / width
    v = (x * t[0] + y * t[1] + z * t[2] + t[3]) / height
    return (u, v)


def texture_coords(vertex, texinfo):
    x, y, z = vertex
    s = texinfo["s"]
    t = texinfo["t"]
    return (
        x * s[0] + y * s[1] + z * s[2] + s[3],
        x * t[0] + y * t[1] + z * t[2] + t[3],
    )


def face_light_color(data, lighting_lump, light_offset, source_polygon, texinfo):
    if light_offset < 0 or not source_polygon or not texinfo:
        return (1.0, 1.0, 1.0)

    lighting_offset, lighting_length = lighting_lump
    coords = [texture_coords(vertex, texinfo) for vertex in source_polygon]
    min_s = math.floor(min(coord[0] for coord in coords) / 16)
    max_s = math.ceil(max(coord[0] for coord in coords) / 16)
    min_t = math.floor(min(coord[1] for coord in coords) / 16)
    max_t = math.ceil(max(coord[1] for coord in coords) / 16)
    width = max(1, max_s - min_s + 1)
    height = max(1, max_t - min_t + 1)
    sample_count = width * height
    start = lighting_offset + light_offset
    end = start + sample_count * 3
    if start < lighting_offset or end > lighting_offset + lighting_length or end > len(data):
        return (1.0, 1.0, 1.0)

    raw = data[start:end]
    if not raw:
        return (1.0, 1.0, 1.0)

    red = sum(raw[i] for i in range(0, len(raw), 3)) / sample_count
    green = sum(raw[i] for i in range(1, len(raw), 3)) / sample_count
    blue = sum(raw[i] for i in range(2, len(raw), 3)) / sample_count
    boost = 1.35
    floor = 0.18
    return (
        min(1.0, max(floor, (red / 255.0) * boost)),
        min(1.0, max(floor, (green / 255.0) * boost)),
        min(1.0, max(floor, (blue / 255.0) * boost)),
    )


def subtract(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def cross(a, b):
    return (
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    )


def normalize(v):
    length = math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])
    if length <= 0.000001:
        return (0.0, 1.0, 0.0)
    return (v[0] / length, v[1] / length, v[2] / length)


def build_triangles(data, lumps, wad_dirs=None, preloaded_wad_textures=None, preloaded_wads=None):
    textures = parse_textures(data, lumps[LUMP_TEXTURES])
    wanted_wads = parse_entity_wads(data, lumps[LUMP_ENTITIES])
    if preloaded_wad_textures is not None:
        wad_textures = preloaded_wad_textures
        loaded_wads = preloaded_wads or []
    else:
        wad_textures, loaded_wads = load_wad_textures(wad_dirs or [], wanted_wads)
    external_filled = fill_missing_textures_from_wads(textures, wad_textures)
    vertices = parse_vertices(data, lumps[LUMP_VERTICES])
    texinfos = parse_texinfos(data, lumps[LUMP_TEXINFO])
    edges = parse_edges(data, lumps[LUMP_EDGES])
    surfedges = parse_surfedges(data, lumps[LUMP_SURFEDGES])

    face_offset, face_length = lumps[LUMP_FACES]
    primitives = {}
    kept_faces = 0
    skipped_faces = 0

    for pos in range(face_offset, face_offset + face_length, 20):
        first_edge = read_i32(data, pos + 4)
        edge_count = read_i16(data, pos + 8)
        texinfo_id = read_i16(data, pos + 10)
        light_offset = read_i32(data, pos + 16)

        texinfo = texinfos[texinfo_id] if 0 <= texinfo_id < len(texinfos) else None
        texture_id = texinfo["texture_id"] if texinfo else -1
        texture = textures[texture_id] if 0 <= texture_id < len(textures) else None
        texture_name = texture["name"] if texture else ""
        if should_skip_texture(texture_name):
            skipped_faces += 1
            continue

        polygon = []
        source_polygon = []
        for edge_index in range(first_edge, first_edge + edge_count):
            surfedge = surfedges[edge_index]
            edge = edges[abs(surfedge)]
            vertex_index = edge[0] if surfedge >= 0 else edge[1]
            if 0 <= vertex_index < len(vertices):
                source_vertex = vertices[vertex_index]
                source_polygon.append(source_vertex)
                polygon.append({
                    "position": to_three(source_vertex),
                    "uv": texture_uv(source_vertex, texinfo, texture) if texinfo and texture else (0.0, 0.0),
                })

        if len(polygon) < 3:
            skipped_faces += 1
            continue

        light_color = face_light_color(data, lumps[LUMP_LIGHTING], light_offset, source_polygon, texinfo)
        for i in range(1, len(polygon) - 1):
            tri = (polygon[0], polygon[i], polygon[i + 1])
            normal = normalize(cross(
                subtract(tri[1]["position"], tri[0]["position"]),
                subtract(tri[2]["position"], tri[0]["position"]),
            ))
            primitive = primitives.setdefault(texture_id, {
                "texture": texture,
                "positions": [],
                "normals": [],
                "uvs": [],
                "colors": [],
            })
            for vertex in tri:
                primitive["positions"].extend(vertex["position"])
                primitive["normals"].extend(normal)
                primitive["uvs"].extend(vertex["uv"])
                primitive["colors"].extend(light_color)
        kept_faces += 1

    total_vertices = sum(len(primitive["positions"]) // 3 for primitive in primitives.values())
    return primitives, textures, {
        "textures": len(textures),
        "texturedMaterials": sum(1 for texture in textures if texture.get("png")),
        "externalTexturedMaterials": external_filled,
        "wantedWads": wanted_wads,
        "loadedWads": loaded_wads,
        "lightmappedFaces": kept_faces,
        "keptFaces": kept_faces,
        "skippedFaces": skipped_faces,
        "triangles": total_vertices // 3,
        "vertices": total_vertices,
    }


def pad4_blob(blob, pad=b"\0"):
    extra = (-len(blob)) % 4
    return blob + pad * extra


def accessor_min_max(values, stride):
    chunks = [values[i:i + stride] for i in range(0, len(values), stride)]
    mins = [min(chunk[index] for chunk in chunks) for index in range(stride)]
    maxs = [max(chunk[index] for chunk in chunks) for index in range(stride)]
    return mins, maxs


def write_glb(path, primitives_by_texture, textures, stats):
    bin_chunks = []
    buffer_views = []
    accessors = []
    materials = []
    images = []
    texture_defs = []
    mesh_primitives = []
    material_by_texture = {}

    def append_buffer_view(blob, target=None):
        offset = sum(len(chunk) for chunk in bin_chunks)
        padded = pad4_blob(blob)
        bin_chunks.append(padded)
        view = {
            "buffer": 0,
            "byteOffset": offset,
            "byteLength": len(blob),
        }
        if target is not None:
            view["target"] = target
        buffer_views.append(view)
        return len(buffer_views) - 1

    def append_accessor(values, stride, accessor_type, min_max=False):
        blob = struct.pack("<" + "f" * len(values), *values)
        view = append_buffer_view(blob, 34962)
        accessor = {
            "bufferView": view,
            "componentType": 5126,
            "count": len(values) // stride,
            "type": accessor_type,
        }
        if min_max:
            mins, maxs = accessor_min_max(values, stride)
            accessor["min"] = mins
            accessor["max"] = maxs
        accessors.append(accessor)
        return len(accessors) - 1

    def material_for(texture_id, texture):
        if texture_id in material_by_texture:
            return material_by_texture[texture_id]

        kind = texture_kind(texture.get("name") or "")
        material = {
            "name": texture.get("name") or f"texture_{texture_id}",
            "pbrMetallicRoughness": {
                "baseColorFactor": [1.0, 1.0, 1.0, 0.72 if kind == "water" else 1.0],
                "metallicFactor": 0.0,
                "roughnessFactor": 0.35 if kind == "water" else 0.92,
            },
            "doubleSided": True,
        }
        png = texture.get("png") if texture else b""
        if png:
            image_view = append_buffer_view(png)
            images.append({
                "name": texture.get("name") or f"texture_{texture_id}",
                "bufferView": image_view,
                "mimeType": "image/png",
            })
            texture_defs.append({"source": len(images) - 1})
            material["pbrMetallicRoughness"]["baseColorTexture"] = {"index": len(texture_defs) - 1}
            if kind == "masked":
                material["alphaMode"] = "MASK"
                material["alphaCutoff"] = 0.5
            elif kind == "water":
                material["alphaMode"] = "BLEND"
        else:
            material["pbrMetallicRoughness"]["baseColorFactor"] = [0.62, 0.70, 0.78, 1.0]

        materials.append(material)
        material_by_texture[texture_id] = len(materials) - 1
        return material_by_texture[texture_id]

    for texture_id, primitive in sorted(primitives_by_texture.items(), key=lambda item: (item[1]["texture"].get("name") if item[1]["texture"] else "")):
        positions = primitive["positions"]
        normals = primitive["normals"]
        uvs = primitive["uvs"]
        colors = primitive["colors"]
        if not positions:
            continue
        position_accessor = append_accessor(positions, 3, "VEC3", True)
        normal_accessor = append_accessor(normals, 3, "VEC3")
        uv_accessor = append_accessor(uvs, 2, "VEC2")
        color_accessor = append_accessor(colors, 3, "VEC3")
        mesh_primitives.append({
            "attributes": {
                "POSITION": position_accessor,
                "NORMAL": normal_accessor,
                "TEXCOORD_0": uv_accessor,
                "COLOR_0": color_accessor,
            },
            "material": material_for(texture_id, primitive["texture"] or {}),
            "mode": 4,
        })

    bin_blob = b"".join(bin_chunks)

    gltf = {
        "asset": {
            "version": "2.0",
            "generator": "Website-NNPugs GoldSrc BSP converter",
        },
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0, "name": stats.get("mapName", "GoldSrc BSP")}],
        "meshes": [{
            "name": "worldspawn",
            "primitives": mesh_primitives,
        }],
        "buffers": [{"byteLength": len(bin_blob)}],
        "bufferViews": buffer_views,
        "accessors": accessors,
        "materials": materials,
        "extras": {
            "source": stats,
        },
    }
    if images:
        gltf["images"] = images
        gltf["textures"] = texture_defs
        gltf["samplers"] = [{
            "magFilter": 9728,
            "minFilter": 9984,
            "wrapS": 10497,
            "wrapT": 10497,
        }]
        for texture_def in gltf["textures"]:
            texture_def["sampler"] = 0

    json_blob = pad4_blob(json.dumps(gltf, separators=(",", ":")).encode("utf-8"), b" ")
    total_length = 12 + 8 + len(json_blob) + 8 + len(bin_blob)

    with open(path, "wb") as handle:
        handle.write(struct.pack("<III", 0x46546C67, 2, total_length))
        handle.write(struct.pack("<I4s", len(json_blob), b"JSON"))
        handle.write(json_blob)
        handle.write(struct.pack("<I4s", len(bin_blob), b"BIN\0"))
        handle.write(bin_blob)


def main():
    parser = argparse.ArgumentParser(description="Convert a GoldSrc BSP v30 to a textured GLB mesh.")
    parser.add_argument("bsp", type=Path, help="Input .bsp")
    parser.add_argument("glb", type=Path, help="Output .glb")
    parser.add_argument("--wad-dir", action="append", default=[], help="Directory containing external .wad texture files. Can be used more than once.")
    args = parser.parse_args()

    data = args.bsp.read_bytes()
    lumps = parse_header(data)
    primitives, textures, stats = build_triangles(data, lumps, args.wad_dir)
    stats["sourceBsp"] = str(args.bsp)
    stats["mapName"] = args.bsp.stem

    if not primitives:
        raise RuntimeError("No renderable geometry was exported.")

    args.glb.parent.mkdir(parents=True, exist_ok=True)
    write_glb(args.glb, primitives, textures, stats)
    print(json.dumps({
        "output": str(args.glb),
        "bytes": os.path.getsize(args.glb),
        **stats,
    }, indent=2))


if __name__ == "__main__":
    main()
