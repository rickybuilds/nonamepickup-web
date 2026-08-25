import json
import struct
import sys
from pathlib import Path


def pad(data, alignment, fill):
    count = (alignment - len(data) % alignment) % alignment
    return data + bytes([fill]) * count


def main():
    source = Path(sys.argv[1])
    output = Path(sys.argv[2])
    document = json.loads(source.read_text(encoding="utf-8"))
    base = source.parent

    buffer = bytearray((base / document["buffers"][0]["uri"]).read_bytes())
    image = document["images"][0]
    image_bytes = (base / image["uri"]).read_bytes()
    image_offset = len(buffer)
    buffer.extend(b"\0" * ((4 - len(buffer) % 4) % 4))
    image_offset = len(buffer)
    buffer.extend(image_bytes)
    document["bufferViews"].append({
        "buffer": 0,
        "byteOffset": image_offset,
        "byteLength": len(image_bytes),
    })
    image.pop("uri", None)
    image["bufferView"] = len(document["bufferViews"]) - 1
    image["mimeType"] = "image/png"
    document["buffers"][0].pop("uri", None)
    document["buffers"][0]["byteLength"] = len(buffer)

    json_chunk = pad(json.dumps(document, separators=(",", ":")).encode("utf-8"), 4, 0x20)
    bin_chunk = pad(bytes(buffer), 4, 0)
    total_length = 12 + 8 + len(json_chunk) + 8 + len(bin_chunk)
    output.write_bytes(
        b"glTF" + struct.pack("<II", 2, total_length)
        + struct.pack("<I4s", len(json_chunk), b"JSON") + json_chunk
        + struct.pack("<I4s", len(bin_chunk), b"BIN\0") + bin_chunk
    )


if __name__ == "__main__":
    main()
