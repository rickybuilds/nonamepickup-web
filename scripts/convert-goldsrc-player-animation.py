"""Export GoldSrc player gait sequences as morph-animated GLB geometry."""

import argparse
import importlib.util
import json
import math
import struct
from pathlib import Path


HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location(
    "goldsrc_mdl", HERE / "convert-goldsrc-mdl-to-glb.py"
)
MDL = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MDL)

GAIT_SEQUENCES = (3, 4, 6)
MORPH_SAMPLES = 8


def rotate_radians(angles):
    rx, ry, rz = angles
    cx, sx = math.cos(rx), math.sin(rx)
    cy, sy = math.cos(ry), math.sin(ry)
    cz, sz = math.cos(rz), math.sin(rz)
    mx = ((1, 0, 0), (0, cx, -sx), (0, sx, cx))
    my = ((cy, 0, sy), (0, 1, 0), (-sy, 0, cy))
    mz = ((cz, -sz, 0), (sz, cz, 0), (0, 0, 1))
    return MDL.mat_mul(MDL.mat_mul(mz, my), mx)


def bone_records(data, header):
    records = MDL.parse_bones(data, header)
    for index, record in enumerate(records):
        base = header["boneindex"] + index * 112
        record["scale"] = tuple(
            MDL.read_f32(data, base + 88 + axis * 4, f"bone[{index}].scale[{axis}]")
            for axis in range(6)
        )
    return records


def sequence_record(data, header, index):
    if not 0 <= index < header["numseq"]:
        raise MDL.MdlFormatError(f"Sequence {index} is outside 0..{header['numseq'] - 1}")
    base = header["seqindex"] + index * 176
    return {
        "index": index,
        "label": MDL.cstring(data[base:base + 32]) or f"sequence_{index}",
        "fps": MDL.read_f32(data, base + 32, f"sequence[{index}].fps"),
        "numframes": MDL.read_i32(data, base + 56, f"sequence[{index}].numframes"),
        "numblends": MDL.read_i32(data, base + 120, f"sequence[{index}].numblends"),
        "animindex": MDL.read_i32(data, base + 124, f"sequence[{index}].animindex"),
        "seqgroup": MDL.read_i32(data, base + 156, f"sequence[{index}].seqgroup"),
    }


def animation_value(data, anim_entry, axis, frame):
    relative = MDL.read_u16(data, anim_entry + axis * 2, "animation.offset")
    if not relative:
        return 0
    cursor = anim_entry + relative
    remaining = frame
    while True:
        valid = MDL.read_u8(data, cursor, "animation.valid")
        total = MDL.read_u8(data, cursor + 1, "animation.total")
        if total <= 0 or valid > total:
            raise MDL.MdlFormatError("Invalid compressed animation span")
        if remaining < total:
            sample = remaining + 1 if remaining < valid else valid
            return MDL.read_i16(data, cursor + sample * 2, "animation.value")
        remaining -= total
        cursor += (valid + 1) * 2


def local_pose(data, bones, sequence, frame):
    if sequence["seqgroup"] != 0:
        raise MDL.MdlFormatError("External sequence groups are not supported")
    pose = []
    for index, bone in enumerate(bones):
        anim_entry = sequence["animindex"] + index * 12
        values = tuple(
            bone["value"][axis] + animation_value(data, anim_entry, axis, frame) * bone["scale"][axis]
            for axis in range(6)
        )
        # Replay movement already supplies the world-space player origin. Keep
        # GoldSrc sequence root motion out of the baked clip so the body does
        # not drift vertically or translate twice.
        translation = bone["value"][:3] if index == 0 else values[:3]
        rotation = bone["value"][3:] if index == 0 else values[3:]
        pose.append({"translation": translation, "rotation": rotate_radians(rotation)})
    return pose


def world_pose(local, bones):
    world = []
    for index, transform in enumerate(local):
        parent = bones[index]["parent"]
        if parent < 0:
            world.append(transform)
            continue
        parent_transform = world[parent]
        translated = MDL.apply_mat3(parent_transform["rotation"], transform["translation"])
        world.append({
            "rotation": MDL.mat_mul(parent_transform["rotation"], transform["rotation"]),
            "translation": tuple(parent_transform["translation"][axis] + translated[axis] for axis in range(3)),
        })
    return world


def posed_vertex(transform, position):
    return MDL.to_three(MDL.apply_bone_transform(transform, position))


def decode_mesh(data, model, mesh, texture, bones, poses):
    vertices = MDL.parse_vertices(data, model)
    normals = MDL.parse_normals(data, model)
    triangles = []
    offset = mesh["triindex"]
    while True:
        count = MDL.read_i16(data, offset, "triangle.command")
        offset += 2
        if count == 0:
            break
        fan = count < 0
        command = []
        for _ in range(abs(count)):
            vertex_index = MDL.read_i16(data, offset, "triangle.vertex")
            normal_index = MDL.read_i16(data, offset + 2, "triangle.normal")
            tex_s = MDL.read_i16(data, offset + 4, "triangle.s")
            tex_t = MDL.read_i16(data, offset + 6, "triangle.t")
            offset += 8
            vertex = vertices[vertex_index]
            normal_ref = normals[normal_index]
            command.append({
                "vertex": vertex,
                "normal": normal_ref,
                "uv": MDL.texture_uv(tex_s, tex_t, texture),
            })
        if fan:
            triangles.extend((command[0], command[i], command[i + 1]) for i in range(1, len(command) - 1))
        else:
            for i in range(len(command) - 2):
                triangles.append(
                    (command[i], command[i + 1], command[i + 2])
                    if i % 2 == 0 else (command[i + 1], command[i], command[i + 2])
                )

    positions, output_normals, uvs = [], [], []
    targets = [[] for _ in poses]
    base_pose = poses[0]
    for triangle in triangles:
        prepared = []
        for item in triangle:
            vertex = item["vertex"]
            normal_ref = item["normal"]
            prepared.append({
                **item,
                "base_position": posed_vertex(base_pose[vertex["bone"]], vertex["position"]),
                "base_normal": MDL.to_three_normal(MDL.apply_bone_rotation(
                    base_pose[normal_ref["bone"]], normal_ref["normal"]
                )),
            })
        face_normal = MDL.cross(
            MDL.subtract(prepared[1]["base_position"], prepared[0]["base_position"]),
            MDL.subtract(prepared[2]["base_position"], prepared[0]["base_position"]),
        )
        average_normal = tuple(sum(item["base_normal"][axis] for item in prepared) / 3 for axis in range(3))
        if MDL.dot(face_normal, average_normal) < 0:
            prepared[1], prepared[2] = prepared[2], prepared[1]
        for item in prepared:
            vertex = item["vertex"]
            bone = vertex["bone"]
            base_position = item["base_position"]
            positions.extend(base_position)
            output_normals.extend(item["base_normal"])
            uvs.extend(item["uv"])
            for target, pose in zip(targets, poses):
                animated = posed_vertex(pose[bone], vertex["position"])
                target.extend(animated[axis] - base_position[axis] for axis in range(3))
    return positions, output_normals, uvs, targets


def pad4(blob, fill=b"\0"):
    return blob + fill * ((-len(blob)) % 4)


def write_glb(path, name, primitives, clips):
    chunks, views, accessors = [], [], []

    def view(blob, target=None):
        offset = sum(len(chunk) for chunk in chunks)
        chunks.append(pad4(blob))
        item = {"buffer": 0, "byteOffset": offset, "byteLength": len(blob)}
        if target is not None:
            item["target"] = target
        views.append(item)
        return len(views) - 1

    def floats(values, stride, kind, bounds=False, target=34962):
        values = MDL.sanitize_values(values)
        item = {
            "bufferView": view(struct.pack("<" + "f" * len(values), *values), target),
            "componentType": 5126,
            "count": len(values) // stride,
            "type": kind,
        }
        if bounds:
            item["min"], item["max"] = MDL.accessor_min_max(values, stride)
        accessors.append(item)
        return len(accessors) - 1

    primitive_defs = []
    for primitive in primitives:
        attributes = {
            "POSITION": floats(primitive["positions"], 3, "VEC3", True),
            "NORMAL": floats(primitive["normals"], 3, "VEC3"),
            "TEXCOORD_0": floats(primitive["uvs"], 2, "VEC2"),
        }
        target_defs = [{"POSITION": floats(values, 3, "VEC3")} for values in primitive["targets"]]
        primitive_defs.append({"attributes": attributes, "targets": target_defs, "mode": 4})
    animations = []
    target_count = len(primitives[0]["targets"])
    for clip in clips:
        times = clip["times"]
        weights = []
        for target_index in clip["targets"]:
            row = [0.0] * target_count
            row[target_index] = 1.0
            weights.extend(row)
        time_accessor = floats(times, 1, "SCALAR", True, None)
        weight_accessor = floats(weights, 1, "SCALAR", False, None)
        animations.append({
            "name": clip["name"],
            "samplers": [{"input": time_accessor, "output": weight_accessor, "interpolation": "LINEAR"}],
            "channels": [{"sampler": 0, "target": {"node": 0, "path": "weights"}}],
        })

    binary = b"".join(chunks)
    gltf = {
        "asset": {"version": "2.0", "generator": "NoName GoldSrc gait exporter"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"name": name, "mesh": 0}],
        "meshes": [{
            "name": name,
            "weights": [0.0] * target_count,
            "extras": {"targetNames": [f"gait_{index}" for index in range(target_count)]},
            "primitives": primitive_defs,
        }],
        "animations": animations,
        "buffers": [{"byteLength": len(binary)}],
        "bufferViews": views,
        "accessors": accessors,
    }
    json_blob = pad4(json.dumps(gltf, separators=(",", ":")).encode(), b" ")
    total = 12 + 8 + len(json_blob) + 8 + len(binary)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as handle:
        handle.write(struct.pack("<III", 0x46546C67, 2, total))
        handle.write(struct.pack("<I4s", len(json_blob), b"JSON"))
        handle.write(json_blob)
        handle.write(struct.pack("<I4s", len(binary), b"BIN\0"))
        handle.write(binary)
    MDL.validate_written_glb(path)


def convert(source, output):
    data = source.read_bytes()
    header = MDL.parse_header(data)
    bones = bone_records(data, header)
    base_local = [{"translation": bone["value"][:3], "rotation": rotate_radians(bone["value"][3:])} for bone in bones]
    poses = [world_pose(base_local, bones)]
    clips = []
    for sequence_index in GAIT_SEQUENCES:
        sequence = sequence_record(data, header, sequence_index)
        if sequence["numframes"] < 2:
            continue
        target_indexes = []
        for sample in range(MORPH_SAMPLES):
            frame = round(sample * (sequence["numframes"] - 1) / MORPH_SAMPLES)
            poses.append(world_pose(local_pose(data, bones, sequence, frame), bones))
            target_indexes.append(len(poses) - 2)
        target_indexes.append(target_indexes[0])
        duration = (sequence["numframes"] - 1) / max(sequence["fps"], 1.0)
        clips.append({
            "name": f"gait_{sequence_index}_{sequence['label']}",
            "targets": target_indexes,
            "times": [duration * index / MORPH_SAMPLES for index in range(MORPH_SAMPLES + 1)],
        })

    bodypart = MDL.parse_bodyparts(data, header)[0]
    model = MDL.parse_model(data, bodypart, 0)
    mesh = MDL.parse_meshes(data, model)[0]
    textures, _, _ = MDL.load_textures_for_model(source, header, data)
    skin_family = MDL.parse_skin_families(data, header)[0]
    _, texture = MDL.resolve_texture(textures, mesh, skin_family)
    positions, normals, uvs, targets = decode_mesh(data, model, mesh, texture, bones, poses)
    primitives = [{
        "positions": positions,
        "normals": normals,
        "uvs": uvs,
        # poses[0] is the reference pose and does not need a morph target.
        "targets": targets[1:],
    }]
    write_glb(output, source.stem, primitives, clips)
    return {"source": str(source), "output": str(output), "bytes": output.stat().st_size, "clips": [clip["name"] for clip in clips]}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    print(json.dumps(convert(args.source, args.output), indent=2))


if __name__ == "__main__":
    main()
