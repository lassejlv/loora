#!/usr/bin/env python3
"""Package modern PNG icon representations into an ICNS container."""

from pathlib import Path
import struct
import sys


ICON_ENTRIES = (
    (b"ic07", "icon_128x128.png"),
    (b"ic08", "icon_256x256.png"),
    (b"ic09", "icon_512x512.png"),
    (b"ic10", "icon_512x512@2x.png"),
    (b"ic11", "icon_16x16@2x.png"),
    (b"ic12", "icon_32x32@2x.png"),
    (b"ic13", "icon_128x128@2x.png"),
    (b"ic14", "icon_256x256@2x.png"),
)


def chunk(kind: bytes, payload: bytes) -> bytes:
    return kind + struct.pack(">I", len(payload) + 8) + payload


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: package-icns.py <iconset-dir> <output.icns>")

    iconset = Path(sys.argv[1])
    output = Path(sys.argv[2])
    entries = [(kind, (iconset / name).read_bytes()) for kind, name in ICON_ENTRIES]
    table_of_contents = b"".join(
        kind + struct.pack(">I", len(payload) + 8) for kind, payload in entries
    )
    body = chunk(b"TOC ", table_of_contents) + b"".join(
        chunk(kind, payload) for kind, payload in entries
    )

    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(b"icns" + struct.pack(">I", len(body) + 8) + body)


if __name__ == "__main__":
    main()
