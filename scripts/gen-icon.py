#!/usr/bin/env python3
"""Generate placeholder app icons using only Python stdlib.

Produces a 1024x1024 PNG with a dark background and a green circle.
Legacy placeholder generator retained for reference. Production artwork must not be overwritten.
"""
import os
import struct
import zlib
from pathlib import Path

SIZE = 1024
BG = (10, 10, 10)         # #0A0A0A
FG = (34, 212, 110)       # #22D46E
RADIUS = SIZE * 0.32


def build_pixels():
    cx = cy = SIZE / 2
    r2 = RADIUS * RADIUS
    row_stride = SIZE * 3
    raw = bytearray(SIZE * (1 + row_stride))
    for y in range(SIZE):
        raw[y * (1 + row_stride)] = 0  # filter byte
        off = y * (1 + row_stride) + 1
        dy = y + 0.5 - cy
        for x in range(SIZE):
            dx = x + 0.5 - cx
            inside = (dx * dx + dy * dy) <= r2
            r, g, b = FG if inside else BG
            raw[off + x * 3] = r
            raw[off + x * 3 + 1] = g
            raw[off + x * 3 + 2] = b
    return bytes(raw)


def chunk(tag, data):
    return (
        struct.pack(">I", len(data))
        + tag
        + data
        + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    )


def write_png(path: Path):
    ihdr = struct.pack(">IIBBBBB", SIZE, SIZE, 8, 2, 0, 0, 0)
    idat = zlib.compress(build_pixels(), 9)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(png)
    print(f"wrote {path} ({len(png)} bytes)")


if __name__ == "__main__":
    root = Path(__file__).resolve().parent.parent / "assets"
    if any((root / name).exists() for name in ["icon.png", "adaptive-icon.png", "splash.png"]):
        raise SystemExit("Refusing to overwrite production artwork. Use the checked-in generated icons.")
    write_png(root / "icon.png")
    write_png(root / "adaptive-icon.png")
    write_png(root / "splash.png")

