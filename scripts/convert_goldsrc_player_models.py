"""Convert embedded-texture GoldSrc Studio v10 player MDLs to static idle-pose GLBs."""

from __future__ import annotations

import io
import json
import math
import struct
import colorsys
from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
PLAYER_ROOT = ROOT / "assets" / "models" / "player"


def unpack(data: bytes, fmt: str, offset: int):
    return struct.unpack_from("<" + fmt, data, offset)


def i32(data: bytes, offset: int) -> int:
    return unpack(data, "i", offset)[0]


def cstring(raw: bytes) -> str:
    return raw.split(b"\0", 1)[0].decode("latin1", "replace")


def quaternion_matrix(angles: np.ndarray) -> np.ndarray:
    x, y, z = (float(value) * 0.5 for value in angles)
    sr, cr = math.sin(x), math.cos(x)
    sp, cp = math.sin(y), math.cos(y)
    sy, cy = math.sin(z), math.cos(z)
    qx = sr * cp * cy - cr * sp * sy
    qy = cr * sp * cy + sr * cp * sy
    qz = cr * cp * sy - sr * sp * cy
    qw = cr * cp * cy + sr * sp * sy
    x2, y2, z2 = qx + qx, qy + qy, qz + qz
    xx, xy, xz = qx * x2, qx * y2, qx * z2
    yy, yz, zz = qy * y2, qy * z2, qz * z2
    wx, wy, wz = qw * x2, qw * y2, qw * z2
    return np.array([
        [1.0 - (yy + zz), xy - wz, xz + wy],
        [xy + wz, 1.0 - (xx + zz), yz - wx],
        [xz - wy, yz + wx, 1.0 - (xx + yy)],
    ], dtype=np.float64)


def animation_value(data: bytes, anim_offset: int, channel: int, frame: int, base: float, scale: float) -> float:
    value_offset = unpack(data, "H", anim_offset + channel * 2)[0]
    if value_offset == 0:
        return base
    cursor = anim_offset + value_offset
    remaining = frame
    while True:
        valid, total = unpack(data, "BB", cursor)
        if total == 0:
            return base
        if remaining < total:
            sample_index = remaining + 1 if remaining < valid else valid
            sample = unpack(data, "h", cursor + sample_index * 2)[0]
            return base + sample * scale
        remaining -= total
        cursor += (valid + 1) * 2


def bone_transforms(data: bytes, driver_data: bytes | None = None) -> list[np.ndarray]:
    bone_count = i32(data, 140)
    bone_index = i32(data, 144)
    seq_count = i32(data, 164)
    seq_index = i32(data, 168)
    idle_anim_index = None
    idle_frame = 0
    for seq_number in range(seq_count):
        offset = seq_index + seq_number * 176
        if cstring(data[offset:offset + 32]).lower() == "idle":
            idle_anim_index = i32(data, offset + 124)
            idle_frame = 0
            break

    bones = []
    names = []
    parents = []
    locals_ = []
    for bone_number in range(bone_count):
        offset = bone_index + bone_number * 112
        parent = i32(data, offset + 32)
        names.append(cstring(data[offset:offset + 32]))
        parents.append(parent)
        values = np.array(unpack(data, "6f", offset + 64), dtype=np.float64)
        scales = np.array(unpack(data, "6f", offset + 88), dtype=np.float64)
        if idle_anim_index is not None:
            anim_offset = idle_anim_index + bone_number * 12
            pose = np.array([
                animation_value(data, anim_offset, channel, idle_frame, values[channel], scales[channel])
                for channel in range(6)
            ], dtype=np.float64)
        else:
            pose = values
        local = np.eye(4, dtype=np.float64)
        local[:3, :3] = quaternion_matrix(pose[3:6])
        local[:3, 3] = pose[:3]
        locals_.append(local)

    driver_bones = {}
    if driver_data is not None:
        driver_transforms = bone_transforms(driver_data)
        driver_count = i32(driver_data, 140)
        driver_index = i32(driver_data, 144)
        for driver_number in range(driver_count):
            driver_offset = driver_index + driver_number * 112
            driver_bones[cstring(driver_data[driver_offset:driver_offset + 32]).lower()] = driver_transforms[driver_number]
    aliases = {
        "bip01 r clavicle": "bip01 r arm",
        "bip01 r upperarm": "bip01 r arm1",
        "bip01 r forearm": "bip01 r arm2",
        "bip01 l clavicle": "bip01 l arm",
        "bip01 l upperarm": "bip01 l arm1",
        "bip01 l forearm": "bip01 l arm2",
    }
    for bone_number, local in enumerate(locals_):
        name = names[bone_number].lower()
        driver = driver_bones.get(name)
        if driver is None:
            driver = driver_bones.get(aliases.get(name, ""))
        if driver is not None:
            bones.append(driver.copy())
        else:
            parent = parents[bone_number]
            bones.append(local if parent < 0 else bones[parent] @ local)
    return bones


def texture_records(data: bytes):
    count = i32(data, 180)
    index = i32(data, 184)
    records = []
    for texture_number in range(count):
        offset = index + texture_number * 80
        name = cstring(data[offset:offset + 64])
        flags, width, height, pixels_offset = unpack(data, "4i", offset + 64)
        records.append({
            "name": name,
            "flags": flags,
            "width": width,
            "height": height,
            "offset": pixels_offset,
        })
    return records


def texture_png(
    data: bytes,
    texture: dict,
    team_color: tuple[int, int, int] | None = None,
    force_team_recolor: bool = False,
) -> bytes:
    width, height = texture["width"], texture["height"]
    offset = texture["offset"]
    indices = np.frombuffer(data, dtype=np.uint8, count=width * height, offset=offset).reshape((height, width))
    palette_offset = offset + width * height
    palette = np.frombuffer(
        data,
        dtype=np.uint8,
        count=256 * 3,
        offset=palette_offset,
    ).reshape((256, 3)).copy()
    if team_color is not None and (texture["flags"] & 0x20 or force_team_recolor):
        target_hue, target_saturation, _ = colorsys.rgb_to_hsv(
            *(channel / 255.0 for channel in team_color)
        )
        palette_indexes = range(160, min(224, len(palette))) if texture["flags"] & 0x20 else range(len(palette))
        for palette_index in palette_indexes:
            original = palette[palette_index].astype(np.float64) / 255.0
            original_hue, saturation, value = colorsys.rgb_to_hsv(*original)
            if force_team_recolor and not (saturation >= 0.42 and (original_hue <= 0.18 or original_hue >= 0.96)):
                continue
            recolored = colorsys.hsv_to_rgb(
                target_hue,
                max(saturation, target_saturation * 0.72),
                value,
            )
            palette[palette_index] = np.clip(
                np.rint(np.asarray(recolored) * 255),
                0,
                255,
            ).astype(np.uint8)
    rgb = palette[indices]
    alpha = np.full((height, width, 1), 255, dtype=np.uint8)
    if texture["flags"] & 0x40:
        alpha[indices == 255] = 0
    rgba = np.concatenate((rgb, alpha), axis=2)
    image = Image.fromarray(rgba, "RGBA")
    output = io.BytesIO()
    image.save(output, format="PNG", optimize=True)
    return output.getvalue()


def map_position(value: np.ndarray) -> np.ndarray:
    return np.array([value[0], value[2], -value[1]], dtype=np.float32)


def posed_vertices(data: bytes, model_offset: int, bones: list[np.ndarray]):
    vertex_count = i32(data, model_offset + 80)
    vertex_bone_index = i32(data, model_offset + 84)
    vertex_index = i32(data, model_offset + 88)
    normal_count = i32(data, model_offset + 92)
    normal_bone_index = i32(data, model_offset + 96)
    normal_index = i32(data, model_offset + 100)

    positions = []
    for vertex_number in range(vertex_count):
        raw = np.array(unpack(data, "3f", vertex_index + vertex_number * 12), dtype=np.float64)
        bone = data[vertex_bone_index + vertex_number]
        transformed = bones[bone][:3, :3] @ raw + bones[bone][:3, 3]
        positions.append(map_position(transformed))

    normals = []
    for normal_number in range(normal_count):
        raw = np.array(unpack(data, "3f", normal_index + normal_number * 12), dtype=np.float64)
        bone = data[normal_bone_index + normal_number]
        transformed = bones[bone][:3, :3] @ raw
        length = np.linalg.norm(transformed)
        normals.append(map_position(transformed / length if length else transformed))
    return positions, normals


def mesh_primitives(
    data: bytes,
    bones: list[np.ndarray],
    textures: list[dict],
    *,
    skin_family: int = 1,
    filter_player_team_meshes: bool = True,
):
    skin_ref_count = i32(data, 192)
    skin_family_count = i32(data, 196)
    skin_index = i32(data, 200)
    skin_family = min(max(0, skin_family), max(0, skin_family_count - 1))
    skins = unpack(data, f"{skin_ref_count * skin_family_count}h", skin_index) if skin_ref_count else ()
    bodypart_count = i32(data, 204)
    bodypart_index = i32(data, 208)
    red_texture_start = next(
        (index for index, texture in enumerate(textures) if texture["flags"] & 0x20),
        0,
    )
    primitives = []

    for bodypart_number in range(bodypart_count):
        bodypart_offset = bodypart_index + bodypart_number * 76
        model_count = i32(data, bodypart_offset + 64)
        model_index = i32(data, bodypart_offset + 72)
        if model_count <= 0:
            continue
        model_offset = model_index
        positions, normals = posed_vertices(data, model_offset, bones)
        mesh_count = i32(data, model_offset + 72)
        mesh_index = i32(data, model_offset + 76)

        for mesh_number in range(mesh_count):
            mesh_offset = mesh_index + mesh_number * 20
            command_offset = i32(data, mesh_offset + 4)
            skin_ref = i32(data, mesh_offset + 8)
            if skins and skin_ref < skin_ref_count:
                texture_number = skins[skin_family * skin_ref_count + skin_ref]
            else:
                texture_number = skin_ref
            texture_number = max(0, min(texture_number, len(textures) - 1))
            # TFC player MDLs store blue and red team geometry as overlapping
            # mesh sets. The red set begins at the first texture flagged 0x20;
            # rendering both sets causes z-fighting that appears nearly black.
            if filter_player_team_meshes:
                if texture_number < red_texture_start:
                    continue
                if "black" in textures[texture_number]["name"].lower():
                    continue
            texture = textures[texture_number]
            out_positions, out_normals, out_uvs, out_indices = [], [], [], []
            cursor = command_offset
            while True:
                command = unpack(data, "h", cursor)[0]
                cursor += 2
                if command == 0:
                    break
                strip = command > 0
                count = abs(command)
                command_vertices = []
                for _ in range(count):
                    vertex_number, normal_number, s, t = unpack(data, "4h", cursor)
                    cursor += 8
                    command_vertices.append(len(out_positions))
                    out_positions.append(positions[vertex_number])
                    out_normals.append(normals[normal_number])
                    out_uvs.append(np.array([
                        float(s) / max(1, texture["width"]),
                        float(t) / max(1, texture["height"]),
                    ], dtype=np.float32))
                if strip:
                    for index in range(count - 2):
                        if index % 2 == 0:
                            out_indices.extend((command_vertices[index], command_vertices[index + 1], command_vertices[index + 2]))
                        else:
                            out_indices.extend((command_vertices[index + 1], command_vertices[index], command_vertices[index + 2]))
                else:
                    for index in range(1, count - 1):
                        out_indices.extend((command_vertices[0], command_vertices[index], command_vertices[index + 1]))
            if out_indices:
                primitives.append({
                    "positions": np.asarray(out_positions, dtype=np.float32),
                    "normals": np.asarray(out_normals, dtype=np.float32),
                    "uvs": np.asarray(out_uvs, dtype=np.float32),
                    "indices": np.asarray(out_indices, dtype=np.uint32),
                    "texture": texture_number,
                })
    return primitives


class GlbBuilder:
    def __init__(self):
        self.binary = bytearray()
        self.views = []
        self.accessors = []

    def add_bytes(self, payload: bytes, target=None) -> int:
        while len(self.binary) % 4:
            self.binary.append(0)
        offset = len(self.binary)
        self.binary.extend(payload)
        view = {"buffer": 0, "byteOffset": offset, "byteLength": len(payload)}
        if target is not None:
            view["target"] = target
        self.views.append(view)
        return len(self.views) - 1

    def add_accessor(self, values: np.ndarray, component_type: int, value_type: str, target: int) -> int:
        values = np.ascontiguousarray(values)
        view = self.add_bytes(values.tobytes(), target)
        accessor = {
            "bufferView": view,
            "componentType": component_type,
            "count": len(values),
            "type": value_type,
        }
        if value_type == "VEC3":
            accessor["min"] = values.min(axis=0).astype(float).tolist()
            accessor["max"] = values.max(axis=0).astype(float).tolist()
        self.accessors.append(accessor)
        return len(self.accessors) - 1


def convert(
    source: Path,
    *,
    target: Path | None = None,
    skin_family: int = 1,
    filter_player_team_meshes: bool = True,
    generator: str = "NoName GoldSrc player converter",
    team_color: tuple[int, int, int] | None = None,
    driver_source: Path | None = None,
    force_team_recolor: bool = False,
) -> Path:
    data = source.read_bytes()
    if data[:4] != b"IDST" or i32(data, 4) != 10:
        raise ValueError(f"Unsupported MDL: {source}")
    textures = texture_records(data)
    driver_data = driver_source.read_bytes() if driver_source is not None else None
    bones = bone_transforms(data, driver_data)
    primitives = mesh_primitives(
        data,
        bones,
        textures,
        skin_family=skin_family,
        filter_player_team_meshes=filter_player_team_meshes,
    )
    if not primitives:
        raise ValueError(f"No renderable mesh primitives found in {source}")
    builder = GlbBuilder()

    images, gltf_textures, materials = [], [], []
    for texture in textures:
        png = texture_png(data, texture, team_color, force_team_recolor)
        view = builder.add_bytes(png)
        images.append({"bufferView": view, "mimeType": "image/png", "name": texture["name"]})
        gltf_textures.append({"source": len(images) - 1})
        materials.append({
            "name": texture["name"],
            "doubleSided": True,
            "alphaMode": "MASK" if texture["flags"] & 0x40 else "OPAQUE",
            "alphaCutoff": 0.5,
            "pbrMetallicRoughness": {
                "baseColorTexture": {"index": len(gltf_textures) - 1},
                "metallicFactor": 0.0,
                "roughnessFactor": 1.0,
            },
            "extensions": {"KHR_materials_unlit": {}},
        })

    gltf_primitives = []
    for primitive in primitives:
        position_accessor = builder.add_accessor(primitive["positions"], 5126, "VEC3", 34962)
        normal_accessor = builder.add_accessor(primitive["normals"], 5126, "VEC3", 34962)
        uv_accessor = builder.add_accessor(primitive["uvs"], 5126, "VEC2", 34962)
        index_accessor = builder.add_accessor(primitive["indices"], 5125, "SCALAR", 34963)
        gltf_primitives.append({
            "attributes": {"POSITION": position_accessor, "NORMAL": normal_accessor, "TEXCOORD_0": uv_accessor},
            "indices": index_accessor,
            "material": primitive["texture"],
        })

    document = {
        "asset": {"version": "2.0", "generator": generator},
        "extensionsUsed": ["KHR_materials_unlit"],
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0, "name": source.stem}],
        "meshes": [{"name": source.stem, "primitives": gltf_primitives}],
        "materials": materials,
        "textures": gltf_textures,
        "samplers": [{"magFilter": 9729, "minFilter": 9987, "wrapS": 10497, "wrapT": 10497}],
        "images": images,
        "accessors": builder.accessors,
        "bufferViews": builder.views,
        "buffers": [{"byteLength": len(builder.binary)}],
    }
    for texture in gltf_textures:
        texture["sampler"] = 0

    json_bytes = json.dumps(document, separators=(",", ":")).encode("utf-8")
    while len(json_bytes) % 4:
        json_bytes += b" "
    while len(builder.binary) % 4:
        builder.binary.append(0)
    total_length = 12 + 8 + len(json_bytes) + 8 + len(builder.binary)
    glb = bytearray(struct.pack("<4sII", b"glTF", 2, total_length))
    glb.extend(struct.pack("<I4s", len(json_bytes), b"JSON"))
    glb.extend(json_bytes)
    glb.extend(struct.pack("<I4s", len(builder.binary), b"BIN\0"))
    glb.extend(builder.binary)
    target = target or source.with_suffix(".glb")
    target.write_bytes(glb)
    bounds = np.concatenate([primitive["positions"] for primitive in primitives], axis=0)
    size = bounds.max(axis=0) - bounds.min(axis=0)
    try:
        source_label = source.relative_to(ROOT)
    except ValueError:
        source_label = source
    print(f"{source_label} -> {target.name} ({len(glb):,} bytes, size {size.round(1).tolist()})")
    return target


def main():
    sources = sorted(PLAYER_ROOT.glob("*/*.mdl"))
    if not sources:
        raise SystemExit(f"No player MDLs found under {PLAYER_ROOT}")
    for source in sources:
        convert(source)


if __name__ == "__main__":
    main()
