#!/usr/bin/env python3
"""
Minimal GoldSrc Studio MDL v10 -> GLB converter for replay projectile models.

This exports the base mesh pose from a GoldSrc .mdl as a binary glTF (.glb),
embedding indexed studio textures when they are available either in the main
model file or a sibling texture model such as fooT.mdl.

Axis mapping matches the replay viewer:

  threeX = x
  threeY = z
  threeZ = -y
"""

import argparse
import json
import math
import os
import struct
import zlib
from pathlib import Path


STUDIO_MAGIC = 0x54534449  # 'IDST'
STUDIO_VERSION = 10

STUDIO_NF_CHROME = 0x0002
STUDIO_NF_ALPHA = 0x0010
STUDIO_NF_ADDITIVE = 0x0020
STUDIO_NF_MASKED = 0x0040


class MdlFormatError(RuntimeError):
    pass


def safe_float(value, fallback=0.0):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return float(fallback)
    return number if math.isfinite(number) else float(fallback)


def sanitize_values(values, fallback=0.0):
    return [safe_float(value, fallback) for value in values]


def validate_finite_values(values, label):
    for index, value in enumerate(values):
        if not math.isfinite(value):
            raise MdlFormatError(f"{label}: non-finite value at index {index}: {value!r}")


def cstring(raw):
    end = raw.find(b"\0")
    if end >= 0:
        raw = raw[:end]
    return raw.decode("ascii", errors="replace")


def ensure_range(data, offset, size, label):
    if offset < 0:
      raise MdlFormatError(f"{label}: negative offset {offset}")
    end = offset + size
    if end < offset:
        raise MdlFormatError(f"{label}: integer overflow for offset={offset} size={size}")
    if end > len(data):
        raise MdlFormatError(f"{label}: offset {offset} size {size} exceeds file size {len(data)}")
    return offset


def read_struct(fmt, data, offset, label):
    size = struct.calcsize(fmt)
    ensure_range(data, offset, size, label)
    return struct.unpack_from(fmt, data, offset)


def read_i32(data, offset, label):
    return read_struct("<i", data, offset, label)[0]


def read_i16(data, offset, label):
    return read_struct("<h", data, offset, label)[0]


def read_u16(data, offset, label):
    return read_struct("<H", data, offset, label)[0]


def read_u8(data, offset, label):
    return read_struct("<B", data, offset, label)[0]


def read_f32(data, offset, label):
    return read_struct("<f", data, offset, label)[0]


def pad4_blob(blob, pad=b"\0"):
    extra = (-len(blob)) % 4
    return blob + pad * extra


def accessor_min_max(values, stride):
    sanitized = sanitize_values(values)
    validate_finite_values(sanitized, "accessor_min_max")
    chunks = [sanitized[i:i + stride] for i in range(0, len(sanitized), stride)]
    if not chunks or any(len(chunk) != stride for chunk in chunks):
        raise MdlFormatError(f"accessor_min_max: invalid chunking for stride={stride} valueCount={len(sanitized)}")
    mins = [min(chunk[index] for chunk in chunks) for index in range(stride)]
    maxs = [max(chunk[index] for chunk in chunks) for index in range(stride)]
    return mins, maxs


def dot(a, b):
    ax, ay, az = safe_float(a[0]), safe_float(a[1]), safe_float(a[2])
    bx, by, bz = safe_float(b[0]), safe_float(b[1]), safe_float(b[2])
    return ax * bx + ay * by + az * bz


def length(v):
    return math.sqrt(dot(v, v))


def normalize(v):
    size = length(v)
    if size <= 0.000001:
        return (0.0, 1.0, 0.0)
    return (v[0] / size, v[1] / size, v[2] / size)


def subtract(a, b):
    return (
        safe_float(a[0]) - safe_float(b[0]),
        safe_float(a[1]) - safe_float(b[1]),
        safe_float(a[2]) - safe_float(b[2]),
    )


def cross(a, b):
    return (
        safe_float(a[1]) * safe_float(b[2]) - safe_float(a[2]) * safe_float(b[1]),
        safe_float(a[2]) * safe_float(b[0]) - safe_float(a[0]) * safe_float(b[2]),
        safe_float(a[0]) * safe_float(b[1]) - safe_float(a[1]) * safe_float(b[0]),
    )


def to_three(vertex):
    x, y, z = (safe_float(vertex[0]), safe_float(vertex[1]), safe_float(vertex[2]))
    return (x, z, -y)


def to_three_normal(normal):
    x, y, z = (safe_float(normal[0]), safe_float(normal[1]), safe_float(normal[2]))
    return normalize((x, z, -y))


def mat_mul(a, b):
    out = []
    for row in range(3):
        out_row = []
        for col in range(3):
            out_row.append(
                a[row][0] * b[0][col] +
                a[row][1] * b[1][col] +
                a[row][2] * b[2][col]
            )
        out.append(tuple(out_row))
    return tuple(out)


def apply_mat3(mat, vec):
    return (
        safe_float(mat[0][0]) * safe_float(vec[0]) + safe_float(mat[0][1]) * safe_float(vec[1]) + safe_float(mat[0][2]) * safe_float(vec[2]),
        safe_float(mat[1][0]) * safe_float(vec[0]) + safe_float(mat[1][1]) * safe_float(vec[1]) + safe_float(mat[1][2]) * safe_float(vec[2]),
        safe_float(mat[2][0]) * safe_float(vec[0]) + safe_float(mat[2][1]) * safe_float(vec[1]) + safe_float(mat[2][2]) * safe_float(vec[2]),
    )


def rotate_xyz(angles_deg):
    rx = math.radians(angles_deg[0])
    ry = math.radians(angles_deg[1])
    rz = math.radians(angles_deg[2])
    cx, sx = math.cos(rx), math.sin(rx)
    cy, sy = math.cos(ry), math.sin(ry)
    cz, sz = math.cos(rz), math.sin(rz)

    mx = (
        (1.0, 0.0, 0.0),
        (0.0, cx, -sx),
        (0.0, sx, cx),
    )
    my = (
        (cy, 0.0, sy),
        (0.0, 1.0, 0.0),
        (-sy, 0.0, cy),
    )
    mz = (
        (cz, -sz, 0.0),
        (sz, cz, 0.0),
        (0.0, 0.0, 1.0),
    )
    return mat_mul(mat_mul(mz, my), mx)


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


def texture_kind(texture):
    flags = texture.get("flags", 0)
    if flags & STUDIO_NF_ADDITIVE:
        return "additive"
    if flags & STUDIO_NF_ALPHA:
        return "blend"
    if flags & STUDIO_NF_MASKED:
        return "masked"
    return "normal"


def parse_header(data):
    ensure_range(data, 0, 244, "studiohdr_t")
    header = {
        "id": read_i32(data, 0, "header.id"),
        "version": read_i32(data, 4, "header.version"),
        "name": cstring(data[8:72]),
        "length": read_i32(data, 72, "header.length"),
        "flags": read_i32(data, 136, "header.flags"),
        "numbones": read_i32(data, 140, "header.numbones"),
        "boneindex": read_i32(data, 144, "header.boneindex"),
        "numseq": read_i32(data, 164, "header.numseq"),
        "seqindex": read_i32(data, 168, "header.seqindex"),
        "numseqgroups": read_i32(data, 172, "header.numseqgroups"),
        "seqgroupindex": read_i32(data, 176, "header.seqgroupindex"),
        "numtextures": read_i32(data, 180, "header.numtextures"),
        "textureindex": read_i32(data, 184, "header.textureindex"),
        "texturedataindex": read_i32(data, 188, "header.texturedataindex"),
        "numskinref": read_i32(data, 192, "header.numskinref"),
        "numskinfamilies": read_i32(data, 196, "header.numskinfamilies"),
        "skinindex": read_i32(data, 200, "header.skinindex"),
        "numbodyparts": read_i32(data, 204, "header.numbodyparts"),
        "bodypartindex": read_i32(data, 208, "header.bodypartindex"),
    }

    if header["id"] != STUDIO_MAGIC:
        raise MdlFormatError(f"Unsupported MDL magic 0x{header['id'] & 0xffffffff:08x}; expected IDST.")
    if header["version"] != STUDIO_VERSION:
        raise MdlFormatError(f"Unsupported MDL version {header['version']}; expected {STUDIO_VERSION}.")
    if header["length"] <= 0:
        raise MdlFormatError(f"Invalid MDL length {header['length']}.")
    if header["length"] > len(data):
        raise MdlFormatError(f"Header length {header['length']} exceeds file size {len(data)}.")

    return header


def dump_header_info(header):
    return {
        "id": f"0x{header['id'] & 0xffffffff:08x}",
        "version": header["version"],
        "name": header["name"],
        "length": header["length"],
        "flags": header["flags"],
        "numbones": header["numbones"],
        "boneindex": header["boneindex"],
        "numseq": header["numseq"],
        "seqindex": header["seqindex"],
        "numseqgroups": header["numseqgroups"],
        "seqgroupindex": header["seqgroupindex"],
        "numtextures": header["numtextures"],
        "textureindex": header["textureindex"],
        "texturedataindex": header["texturedataindex"],
        "numskinref": header["numskinref"],
        "numskinfamilies": header["numskinfamilies"],
        "skinindex": header["skinindex"],
        "numbodyparts": header["numbodyparts"],
        "bodypartindex": header["bodypartindex"],
    }


def parse_bones(data, header):
    bones = []
    if header["numbones"] <= 0:
        return bones
    ensure_range(data, header["boneindex"], header["numbones"] * 112, "bones")
    for index in range(header["numbones"]):
        base = header["boneindex"] + index * 112
        parent = read_i32(data, base + 32, f"bone[{index}].parent")
        if parent >= header["numbones"]:
            raise MdlFormatError(f"bone[{index}].parent {parent} outside bone count {header['numbones']}")
        # GoldSrc Studio v10 mstudiobone_t layout:
        #   name[32], parent, flags, bonecontroller[6], value[6], scale[6]
        # The base pose floats start at offset 64, not 60.
        bones.append({
            "name": cstring(data[base:base + 32]),
            "parent": parent,
            "flags": read_i32(data, base + 36, f"bone[{index}].flags"),
            "value": tuple(read_f32(data, base + 64 + axis * 4, f"bone[{index}].value[{axis}]") for axis in range(6)),
        })
    return bones


def build_bone_transforms(bones):
    transforms = []
    for index, bone in enumerate(bones):
        local_rotation = rotate_xyz(bone["value"][3:6])
        local_translation = bone["value"][0:3]
        parent = bone["parent"]
        if parent < 0:
            transforms.append({
                "rotation": local_rotation,
                "translation": local_translation,
            })
            continue
        if parent >= len(transforms):
            raise MdlFormatError(f"bone[{index}] references parent {parent} before it was built.")

        parent_transform = transforms[parent]
        world_rotation = mat_mul(parent_transform["rotation"], local_rotation)
        translated = apply_mat3(parent_transform["rotation"], local_translation)
        transforms.append({
            "rotation": world_rotation,
            "translation": (
                parent_transform["translation"][0] + translated[0],
                parent_transform["translation"][1] + translated[1],
                parent_transform["translation"][2] + translated[2],
            ),
        })
    return transforms


def apply_bone_transform(transform, vec):
    rotated = apply_mat3(transform["rotation"], vec)
    return (
        rotated[0] + transform["translation"][0],
        rotated[1] + transform["translation"][1],
        rotated[2] + transform["translation"][2],
    )


def apply_bone_rotation(transform, vec):
    return apply_mat3(transform["rotation"], vec)


def parse_textures(data, header):
    textures = []
    if header["numtextures"] <= 0:
        return textures

    ensure_range(data, header["textureindex"], header["numtextures"] * 80, "textures")
    for index in range(header["numtextures"]):
        base = header["textureindex"] + index * 80
        name = cstring(data[base:base + 64]) or f"texture_{index}"
        flags = read_i32(data, base + 64, f"texture[{index}].flags")
        width = read_i32(data, base + 68, f"texture[{index}].width")
        height = read_i32(data, base + 72, f"texture[{index}].height")
        pixel_offset = read_i32(data, base + 76, f"texture[{index}].index")
        png = b""

        if width > 0 and height > 0 and pixel_offset > 0:
            pixel_count = width * height
            pixels_start = pixel_offset
            if pixels_start + pixel_count > len(data) and header.get("texturedataindex", 0) > 0:
                relative_start = header["texturedataindex"] + pixel_offset
                if relative_start + pixel_count <= len(data):
                    pixels_start = relative_start
            pixels_end = pixels_start + pixel_count
            ensure_range(data, pixels_start, pixel_count, f"texture[{index}].pixels")
            indexed = data[pixels_start:pixels_end]
            remaining = len(data) - pixels_end
            color_count = 256
            palette_start = pixels_end

            if remaining >= 770:
                maybe_count = read_u16(data, pixels_end, f"texture[{index}].paletteCount")
                if 1 <= maybe_count <= 256 and remaining >= 2 + maybe_count * 3:
                    color_count = maybe_count
                    palette_start = pixels_end + 2
                elif remaining >= 768:
                    color_count = min(256, remaining // 3)
                    palette_start = pixels_end
            elif remaining >= 768:
                color_count = min(256, remaining // 3)
                palette_start = pixels_end
            else:
                color_count = 0

            if color_count <= 0:
                textures.append({
                    "name": name,
                    "flags": flags,
                    "width": width,
                    "height": height,
                    "png": b"",
                })
                continue

            ensure_range(data, palette_start, color_count * 3, f"texture[{index}].palette")
            palette = []
            for color_index in range(color_count):
                color_base = palette_start + color_index * 3
                rgb = data[color_base:color_base + 3]
                alpha = 0 if (flags & STUDIO_NF_MASKED and color_index == 255) else 255
                palette.append((rgb[0], rgb[1], rgb[2], alpha))
            png = make_png_rgba(width, height, indexed, palette)

        textures.append({
            "name": name,
            "flags": flags,
            "width": width,
            "height": height,
            "png": png,
        })
    return textures


def texture_model_path(path):
    return path.with_name(f"{path.stem}T{path.suffix}")


def load_textures_for_model(path, header, data):
    textures = parse_textures(data, header)
    if textures:
        return textures, str(path), header

    sibling = texture_model_path(path)
    if not sibling.is_file():
        return [], None, None

    texture_data = sibling.read_bytes()
    texture_header = parse_header(texture_data)
    textures = parse_textures(texture_data, texture_header)
    return textures, str(sibling), texture_header


def parse_skin_families(data, header):
    families = []
    if header["numskinref"] <= 0 or header["numskinfamilies"] <= 0:
        return families
    count = header["numskinref"] * header["numskinfamilies"]
    ensure_range(data, header["skinindex"], count * 2, "skinFamilies")
    for family_index in range(header["numskinfamilies"]):
        family = []
        for ref_index in range(header["numskinref"]):
            offset = header["skinindex"] + ((family_index * header["numskinref"] + ref_index) * 2)
            family.append(read_u16(data, offset, f"skin[{family_index}][{ref_index}]"))
        families.append(family)
    return families


def parse_bodyparts(data, header):
    bodyparts = []
    if header["numbodyparts"] <= 0:
        return bodyparts
    ensure_range(data, header["bodypartindex"], header["numbodyparts"] * 76, "bodyparts")
    for index in range(header["numbodyparts"]):
        offset = header["bodypartindex"] + index * 76
        nummodels = read_i32(data, offset + 64, f"bodypart[{index}].nummodels")
        modelindex = read_i32(data, offset + 72, f"bodypart[{index}].modelindex")
        bodyparts.append({
            "name": cstring(data[offset:offset + 64]) or f"bodypart_{index}",
            "nummodels": nummodels,
            "base": read_i32(data, offset + 68, f"bodypart[{index}].base"),
            "modelindex": modelindex,
        })
    return bodyparts


def parse_model(data, bodypart, model_index):
    model_offset = bodypart["modelindex"] + model_index * 112
    ensure_range(data, model_offset, 112, f"model[{bodypart['name']}:{model_index}]")
    return {
        "name": cstring(data[model_offset:model_offset + 64]) or f"{bodypart['name']}_{model_index}",
        "type": read_i32(data, model_offset + 64, f"model[{model_index}].type"),
        "boundingradius": read_f32(data, model_offset + 68, f"model[{model_index}].boundingradius"),
        "nummesh": read_i32(data, model_offset + 72, f"model[{model_index}].nummesh"),
        "meshindex": read_i32(data, model_offset + 76, f"model[{model_index}].meshindex"),
        "numverts": read_i32(data, model_offset + 80, f"model[{model_index}].numverts"),
        "vertinfoindex": read_i32(data, model_offset + 84, f"model[{model_index}].vertinfoindex"),
        "vertindex": read_i32(data, model_offset + 88, f"model[{model_index}].vertindex"),
        "numnorms": read_i32(data, model_offset + 92, f"model[{model_index}].numnorms"),
        "norminfoindex": read_i32(data, model_offset + 96, f"model[{model_index}].norminfoindex"),
        "normindex": read_i32(data, model_offset + 100, f"model[{model_index}].normindex"),
        "numgroups": read_i32(data, model_offset + 104, f"model[{model_index}].numgroups"),
        "groupindex": read_i32(data, model_offset + 108, f"model[{model_index}].groupindex"),
    }


def parse_meshes(data, model):
    meshes = []
    if model["nummesh"] <= 0:
        return meshes
    ensure_range(data, model["meshindex"], model["nummesh"] * 20, f"{model['name']}.meshes")
    for index in range(model["nummesh"]):
        offset = model["meshindex"] + index * 20
        meshes.append({
            "numtris": read_i32(data, offset + 0, f"{model['name']}.mesh[{index}].numtris"),
            "triindex": read_i32(data, offset + 4, f"{model['name']}.mesh[{index}].triindex"),
            "skinref": read_i32(data, offset + 8, f"{model['name']}.mesh[{index}].skinref"),
            "numnorms": read_i32(data, offset + 12, f"{model['name']}.mesh[{index}].numnorms"),
            "normindex": read_i32(data, offset + 16, f"{model['name']}.mesh[{index}].normindex"),
        })
    return meshes


def parse_vertices(data, model):
    vertices = []
    if model["numverts"] <= 0:
        return vertices
    ensure_range(data, model["vertinfoindex"], model["numverts"], f"{model['name']}.vertBones")
    ensure_range(data, model["vertindex"], model["numverts"] * 12, f"{model['name']}.verts")
    for index in range(model["numverts"]):
        pos = model["vertindex"] + index * 12
        vertices.append({
            "bone": read_u8(data, model["vertinfoindex"] + index, f"{model['name']}.vertBone[{index}]"),
            "position": (
                read_f32(data, pos + 0, f"{model['name']}.vert[{index}].x"),
                read_f32(data, pos + 4, f"{model['name']}.vert[{index}].y"),
                read_f32(data, pos + 8, f"{model['name']}.vert[{index}].z"),
            ),
        })
    return vertices


def parse_normals(data, model):
    normals = []
    if model["numnorms"] <= 0:
        return normals
    ensure_range(data, model["norminfoindex"], model["numnorms"], f"{model['name']}.normBones")
    ensure_range(data, model["normindex"], model["numnorms"] * 12, f"{model['name']}.normals")
    for index in range(model["numnorms"]):
        pos = model["normindex"] + index * 12
        normals.append({
            "bone": read_u8(data, model["norminfoindex"] + index, f"{model['name']}.normBone[{index}]"),
            "normal": (
                read_f32(data, pos + 0, f"{model['name']}.norm[{index}].x"),
                read_f32(data, pos + 4, f"{model['name']}.norm[{index}].y"),
                read_f32(data, pos + 8, f"{model['name']}.norm[{index}].z"),
            ),
        })
    return normals


def resolve_texture(texture_list, mesh, skin_family):
    texture_index = skin_family[mesh["skinref"]] if 0 <= mesh["skinref"] < len(skin_family) else mesh["skinref"]
    if 0 <= texture_index < len(texture_list):
        return texture_index, texture_list[texture_index]
    return texture_index, {
        "name": f"texture_{texture_index}",
        "flags": 0,
        "width": 1,
        "height": 1,
        "png": b"",
    }


def decode_tri_commands(data, mesh, texture, vertices, normals, bone_transforms, model_name, flip_u=False):
    tris = []
    offset = mesh["triindex"]
    ensure_range(data, offset, 2, f"{model_name}.meshTriStart")
    command_counts = []
    min_vertex_index = None
    max_vertex_index = None
    exported_triangle_count = 0

    while True:
        count = read_i16(data, offset, f"{model_name}.triCommandCount")
        offset += 2
        if count == 0:
            break

        is_fan = count < 0
        count = abs(count)
        command_counts.append(-count if is_fan else count)
        verts = []
        ensure_range(data, offset, count * 8, f"{model_name}.triCommandVerts")
        for _ in range(count):
            vert_index = read_i16(data, offset + 0, f"{model_name}.tri.vertIndex")
            norm_index = read_i16(data, offset + 2, f"{model_name}.tri.normIndex")
            tex_s = read_i16(data, offset + 4, f"{model_name}.tri.s")
            tex_t = read_i16(data, offset + 6, f"{model_name}.tri.t")
            offset += 8

            if not (0 <= vert_index < len(vertices)):
                raise MdlFormatError(f"{model_name}: vertex index {vert_index} outside {len(vertices)}")
            min_vertex_index = vert_index if min_vertex_index is None else min(min_vertex_index, vert_index)
            max_vertex_index = vert_index if max_vertex_index is None else max(max_vertex_index, vert_index)

            vertex = vertices[vert_index]
            bone_index = vertex["bone"]
            if not (0 <= bone_index < len(bone_transforms)):
                raise MdlFormatError(f"{model_name}: vertex bone index {bone_index} outside {len(bone_transforms)}")
            position = apply_bone_transform(bone_transforms[bone_index], vertex["position"])

            if 0 <= norm_index < len(normals):
                normal_ref = normals[norm_index]
                normal_bone = normal_ref["bone"]
                if 0 <= normal_bone < len(bone_transforms):
                    normal = apply_bone_rotation(bone_transforms[normal_bone], normal_ref["normal"])
                else:
                    normal = normal_ref["normal"]
                normal = normalize(normal)
            else:
                normal = (0.0, 0.0, 1.0)

            if texture.get("flags", 0) & STUDIO_NF_CHROME:
                uv = chrome_uv_from_normal(to_three_normal(normal))
            else:
                uv = texture_uv(tex_s, tex_t, texture, flip_u=flip_u)
            verts.append({
                "position": to_three(position),
                "normal": to_three_normal(normal),
                "uv": uv,
            })

        if len(verts) < 3:
            continue

        if is_fan:
            for index in range(1, len(verts) - 1):
                tris.append(orient_triangle((verts[0], verts[index], verts[index + 1])))
                exported_triangle_count += 1
        else:
            for index in range(len(verts) - 2):
                tri = (verts[index], verts[index + 1], verts[index + 2]) if index % 2 == 0 else (verts[index + 1], verts[index], verts[index + 2])
                tri = orient_triangle(tri)
                tris.append(tri)
                exported_triangle_count += 1

    if mesh["numtris"] > 0 and exported_triangle_count != mesh["numtris"]:
        raise MdlFormatError(
            f"{model_name}: decoded triangle count {exported_triangle_count} does not match mesh.numtris {mesh['numtris']}"
        )

    return tris, {
        "triangleCommandCounts": command_counts,
        "exportedTriangleCount": exported_triangle_count,
        "vertexIndexRange": [0 if min_vertex_index is None else min_vertex_index, 0 if max_vertex_index is None else max_vertex_index],
    }


def ensure_normal(tri):
    a, b, c = tri
    if length(a["normal"]) > 0.1 and length(b["normal"]) > 0.1 and length(c["normal"]) > 0.1:
        return tri
    face_normal = normalize(cross(
        subtract(b["position"], a["position"]),
        subtract(c["position"], a["position"]),
    ))
    return tuple({**vertex, "normal": face_normal} for vertex in tri)


def orient_triangle(tri):
    a, b, c = tri
    face_normal = normalize(cross(
        subtract(b["position"], a["position"]),
        subtract(c["position"], a["position"]),
    ))
    average_normal = normalize((
        (safe_float(a["normal"][0]) + safe_float(b["normal"][0]) + safe_float(c["normal"][0])) / 3.0,
        (safe_float(a["normal"][1]) + safe_float(b["normal"][1]) + safe_float(c["normal"][1])) / 3.0,
        (safe_float(a["normal"][2]) + safe_float(b["normal"][2]) + safe_float(c["normal"][2])) / 3.0,
    ))

    if length(face_normal) > 0.000001 and length(average_normal) > 0.000001 and dot(face_normal, average_normal) < 0.0:
        return (a, c, b)
    return tri


def sanitize_vertex(vertex):
    position = (
        safe_float(vertex["position"][0]),
        safe_float(vertex["position"][1]),
        safe_float(vertex["position"][2]),
    )
    normal = normalize((
        safe_float(vertex["normal"][0]),
        safe_float(vertex["normal"][1]),
        safe_float(vertex["normal"][2]),
    ))
    uv = (
        safe_float(vertex["uv"][0]),
        safe_float(vertex["uv"][1]),
    )
    return {
        **vertex,
        "position": position,
        "normal": normal,
        "uv": uv,
    }


def chrome_uv_from_normal(normal):
    nx, ny, nz = normalize((
        safe_float(normal[0]),
        safe_float(normal[1]),
        safe_float(normal[2]),
    ))
    denom = math.sqrt((nx * nx) + (ny * ny) + ((nz + 1.0) * (nz + 1.0)))
    if denom <= 0.000001:
        return (0.5, 0.5)
    u = (nx / (2.0 * denom)) + 0.5
    v = 0.5 - (ny / (2.0 * denom))
    return (safe_float(u), safe_float(v))


def texture_uv(tex_s, tex_t, texture, flip_u=False):
    width = max(1, texture.get("width") or 1)
    height = max(1, texture.get("height") or 1)
    # Sample on texel centers to better match GoldSrc's indexed texture lookup.
    u = safe_float((tex_s + 0.5) / width)
    return (
        safe_float(1.0 - u) if flip_u else u,
        safe_float(1.0 - ((tex_t + 0.5) / height)),
    )


def pick_skin_family(skin_families, preferred_index=None):
    if not skin_families:
        return 0, []
    if preferred_index is not None and 0 <= preferred_index < len(skin_families):
        return preferred_index, skin_families[preferred_index]
    for index, family in enumerate(skin_families):
        if family:
            return index, family
    return 0, skin_families[0]


def build_primitives(data, header, textures, skin_families, bone_transforms, debug_enabled=False, preferred_skin_family=None, flip_u=False):
    primitives = {}
    bodyparts = parse_bodyparts(data, header)
    selected_skin_family_index, selected_skin_family = pick_skin_family(skin_families, preferred_skin_family)
    debug_info = {
        "bodypartCount": len(bodyparts),
        "modelCount": 0,
        "meshCount": 0,
        "selectedSkinFamily": selected_skin_family_index,
        "meshes": [],
    }

    for bodypart in bodyparts:
        for model_index in range(max(0, bodypart["nummodels"])):
            model = parse_model(data, bodypart, model_index)
            debug_info["modelCount"] += 1
            vertices = parse_vertices(data, model)
            normals = parse_normals(data, model)
            meshes = parse_meshes(data, model)

            for mesh_index, mesh in enumerate(meshes):
                debug_info["meshCount"] += 1
                texture_index, texture = resolve_texture(textures, mesh, selected_skin_family)
                primitive = primitives.setdefault(texture_index, {
                    "texture": texture,
                    "positions": [],
                    "normals": [],
                    "uvs": [],
                })
                tris, mesh_debug = decode_tri_commands(data, mesh, texture, vertices, normals, bone_transforms, model["name"], flip_u=flip_u)
                if debug_enabled:
                    debug_info["meshes"].append({
                        "bodypart": bodypart["name"],
                        "model": model["name"],
                        "meshIndex": mesh_index,
                        "meshCount": len(meshes),
                        "triangleCommands": mesh_debug["triangleCommandCounts"],
                        "exportedTriangleCount": mesh_debug["exportedTriangleCount"],
                        "vertexIndexRange": mesh_debug["vertexIndexRange"],
                        "texture": texture.get("name"),
                        "textureFlags": texture.get("flags", 0),
                    })
                for tri in tris:
                    tri = ensure_normal(tri)
                    for vertex in tri:
                        safe_vertex = sanitize_vertex(vertex)
                        primitive["positions"].extend(safe_vertex["position"])
                        primitive["normals"].extend(safe_vertex["normal"])
                        primitive["uvs"].extend(safe_vertex["uv"])

    return primitives, debug_info


def validate_glb_json_text(json_text):
    if "NaN" in json_text or "Infinity" in json_text or "-Infinity" in json_text:
        raise MdlFormatError("Generated GLB JSON contains NaN/Infinity tokens.")
    json.loads(json_text)


def validate_written_glb(path):
    data = path.read_bytes()
    ensure_range(data, 0, 20, "glb.header")
    magic, version, total_length = struct.unpack_from("<III", data, 0)
    if magic != 0x46546C67:
        raise MdlFormatError(f"Written GLB has invalid magic 0x{magic:08x}")
    if version != 2:
        raise MdlFormatError(f"Written GLB has invalid version {version}")
    if total_length != len(data):
        raise MdlFormatError(f"Written GLB length mismatch header={total_length} actual={len(data)}")

    json_length = read_i32(data, 12, "glb.json.length")
    json_type = data[16:20]
    if json_type != b"JSON":
        raise MdlFormatError(f"Written GLB first chunk is not JSON: {json_type!r}")
    json_start = 20
    ensure_range(data, json_start, json_length, "glb.json.chunk")
    json_bytes = data[json_start:json_start + json_length]
    json_text = json_bytes.decode("utf-8").rstrip(" \0")
    validate_glb_json_text(json_text)


def write_glb(path, primitives_by_texture, stats, node_rotation=None):
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
        view = {"buffer": 0, "byteOffset": offset, "byteLength": len(blob)}
        if target is not None:
            view["target"] = target
        buffer_views.append(view)
        return len(buffer_views) - 1

    def append_float_accessor(values, stride, accessor_type, min_max=False):
        sanitized = sanitize_values(values)
        validate_finite_values(sanitized, f"accessor:{accessor_type}")
        blob = struct.pack("<" + "f" * len(sanitized), *sanitized)
        view = append_buffer_view(blob, 34962)
        accessor = {
            "bufferView": view,
            "componentType": 5126,
            "count": len(sanitized) // stride,
            "type": accessor_type,
        }
        if min_max:
            mins, maxs = accessor_min_max(sanitized, stride)
            accessor["min"] = mins
            accessor["max"] = maxs
        accessors.append(accessor)
        return len(accessors) - 1

    def material_for(texture_id, texture):
        if texture_id in material_by_texture:
            return material_by_texture[texture_id]

        kind = texture_kind(texture)
        material = {
            "name": texture.get("name") or f"texture_{texture_id}",
            "pbrMetallicRoughness": {
                "baseColorFactor": [1.0, 1.0, 1.0, 1.0],
                "metallicFactor": 0.0,
                "roughnessFactor": 1.0,
            },
            "doubleSided": bool(texture.get("flags", 0) & STUDIO_NF_MASKED),
        }
        png = texture.get("png") or b""
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
        else:
            material["pbrMetallicRoughness"]["baseColorFactor"] = [0.78, 0.78, 0.78, 1.0]

        materials.append(material)
        material_by_texture[texture_id] = len(materials) - 1
        return material_by_texture[texture_id]

    for texture_id, primitive in sorted(primitives_by_texture.items(), key=lambda item: (item[1]["texture"].get("name") or "", item[0])):
        if not primitive["positions"]:
            continue
        mesh_primitives.append({
            "attributes": {
                "POSITION": append_float_accessor(primitive["positions"], 3, "VEC3", True),
                "NORMAL": append_float_accessor(primitive["normals"], 3, "VEC3"),
                "TEXCOORD_0": append_float_accessor(primitive["uvs"], 2, "VEC2"),
            },
            "material": material_for(texture_id, primitive["texture"]),
            "mode": 4,
        })

    if not mesh_primitives:
        raise MdlFormatError("No renderable mesh primitives were produced.")

    bin_blob = b"".join(bin_chunks)
    node = {"mesh": 0, "name": stats.get("modelName", "GoldSrc MDL")}
    if node_rotation is not None:
        node["rotation"] = node_rotation
    gltf = {
        "asset": {"version": "2.0", "generator": "Website-NNPugs GoldSrc MDL converter"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [node],
        "meshes": [{"name": stats.get("modelName", "GoldSrc MDL"), "primitives": mesh_primitives}],
        "buffers": [{"byteLength": len(bin_blob)}],
        "bufferViews": buffer_views,
        "accessors": accessors,
        "materials": materials,
        "extras": {"source": stats},
    }
    if images:
        gltf["images"] = images
        gltf["textures"] = texture_defs
        gltf["samplers"] = [{
            "magFilter": 9728,
            "minFilter": 9728,
            "wrapS": 10497,
            "wrapT": 10497,
        }]
        for texture_def in gltf["textures"]:
            texture_def["sampler"] = 0

    json_text = json.dumps(gltf, separators=(",", ":"), allow_nan=False)
    validate_glb_json_text(json_text)
    json_blob = pad4_blob(json_text.encode("utf-8"), b" ")
    total_length = 12 + 8 + len(json_blob) + 8 + len(bin_blob)

    with open(path, "wb") as handle:
        handle.write(struct.pack("<III", 0x46546C67, 2, total_length))
        handle.write(struct.pack("<I4s", len(json_blob), b"JSON"))
        handle.write(json_blob)
        handle.write(struct.pack("<I4s", len(bin_blob), b"BIN\0"))
        handle.write(bin_blob)
    validate_written_glb(path)


def inspect_mdl(path, preferred_skin_family=None):
    data = path.read_bytes()
    header = parse_header(data)
    texture_header = header
    textures, texture_source, texture_header = load_textures_for_model(path, header, data)
    bodyparts = parse_bodyparts(data, header)
    bones = parse_bones(data, header)
    bone_transforms = build_bone_transforms(bones)
    skin_families = parse_skin_families(data, header)
    _, debug_info = build_primitives(
        data,
        header,
        textures,
        skin_families,
        bone_transforms,
        debug_enabled=True,
        preferred_skin_family=preferred_skin_family,
    )
    models = []
    for bodypart in bodyparts:
        for model_index in range(max(0, bodypart["nummodels"])):
            model = parse_model(data, bodypart, model_index)
            models.append({
                "bodypart": bodypart["name"],
                "modelIndex": model_index,
                "name": model["name"],
                "nummesh": model["nummesh"],
                "meshindex": model["meshindex"],
                "numverts": model["numverts"],
                "vertinfoindex": model["vertinfoindex"],
                "vertindex": model["vertindex"],
                "numnorms": model["numnorms"],
                "norminfoindex": model["norminfoindex"],
                "normindex": model["normindex"],
                "meshes": parse_meshes(data, model),
            })
    return {
        "sourceMdl": str(path),
        "header": dump_header_info(header),
        "textureSource": texture_source,
        "textureHeader": dump_header_info(texture_header) if texture_header else None,
        "textures": [{"name": item["name"], "flags": item["flags"], "width": item["width"], "height": item["height"]} for item in textures],
        "bodyparts": bodyparts,
        "models": models,
        "debug": debug_info,
    }


def convert_mdl_to_glb(mdl_path, glb_path, debug_enabled=False, preferred_skin_family=None, flip_u=False, turn_y=False, pitch_x=False):
    data = mdl_path.read_bytes()
    header = parse_header(data)
    bones = parse_bones(data, header)
    bone_transforms = build_bone_transforms(bones)
    textures, texture_source, _ = load_textures_for_model(mdl_path, header, data)
    skin_families = parse_skin_families(data, header)
    primitives, debug_info = build_primitives(
        data,
        header,
        textures,
        skin_families,
        bone_transforms,
        debug_enabled=debug_enabled,
        preferred_skin_family=preferred_skin_family,
        flip_u=flip_u,
    )

    if not primitives or not any(primitive["positions"] for primitive in primitives.values()):
        raise MdlFormatError("No renderable mesh data was exported from the MDL.")

    stats = {
        "sourceMdl": str(mdl_path),
        "textureSource": texture_source,
        "modelName": header.get("name") or mdl_path.stem,
        "bones": len(bones),
        "sequences": header.get("numseq", 0),
        "pose": "reference",
        "bodyparts": header["numbodyparts"],
        "textures": len(textures),
        "skinfamilies": len(skin_families),
        "selectedSkinFamily": debug_info.get("selectedSkinFamily", 0),
        "triangles": sum(len(primitive["positions"]) // 9 for primitive in primitives.values()),
        "vertices": sum(len(primitive["positions"]) // 3 for primitive in primitives.values()),
    }
    if debug_enabled:
        stats["debug"] = debug_info

    glb_path.parent.mkdir(parents=True, exist_ok=True)
    node_rotation = None
    if pitch_x:
        node_rotation = [-0.7071067811865476, 0.0, 0.0, 0.7071067811865476]
    elif turn_y:
        node_rotation = [0.0, 1.0, 0.0, 0.0]
    write_glb(glb_path, primitives, stats, node_rotation=node_rotation)
    return {"output": str(glb_path), "bytes": os.path.getsize(glb_path), **stats}


def main():
    parser = argparse.ArgumentParser(description="Convert one GoldSrc Studio MDL v10 into a textured GLB.")
    parser.add_argument("mdl", type=Path, help="Input .mdl")
    parser.add_argument("glb", type=Path, nargs="?", help="Output .glb")
    parser.add_argument("--dump-header", action="store_true", help="Print parsed header/bodypart/model offsets for debugging.")
    parser.add_argument("--debug", action="store_true", help="Print mesh triangle-command/debug statistics in the conversion result.")
    parser.add_argument("--skin-family", type=int, default=None, help="Preferred skin family index to export when the MDL contains multiple families.")
    parser.add_argument("--flip-u", action="store_true", help="Mirror the model texture horizontally in the generated GLB.")
    parser.add_argument("--turn-y", action="store_true", help="Rotate the generated model 180 degrees around its Y axis.")
    parser.add_argument("--pitch-x", action="store_true", help="Rotate the generated model -90 degrees around its X axis.")
    args = parser.parse_args()

    if args.dump_header:
        print(json.dumps(inspect_mdl(args.mdl, preferred_skin_family=args.skin_family), indent=2))
        if args.glb is None:
            return

    if args.glb is None:
        raise SystemExit("Output .glb path is required unless --dump-header is used by itself.")

    result = convert_mdl_to_glb(args.mdl, args.glb, debug_enabled=args.debug, preferred_skin_family=args.skin_family, flip_u=args.flip_u, turn_y=args.turn_y, pitch_x=args.pitch_x)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
