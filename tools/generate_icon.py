from pathlib import Path
import struct
import zlib

out = Path("src-tauri/icons")
out.mkdir(parents=True, exist_ok=True)

size = 256
bg = (22, 61, 53, 255)
fg = (159, 230, 206, 255)

pixels = []
for y in range(size):
    row = bytearray()
    for x in range(size):
        margin = 18
        radius = 36
        inside = margin <= x < size - margin and margin <= y < size - margin
        corner_ok = True
        corners = [
            (margin + radius, margin + radius, x < margin + radius and y < margin + radius),
            (size - margin - radius - 1, margin + radius, x > size - margin - radius and y < margin + radius),
            (margin + radius, size - margin - radius - 1, x < margin + radius and y > size - margin - radius),
            (size - margin - radius - 1, size - margin - radius - 1, x > size - margin - radius and y > size - margin - radius),
        ]
        for cx, cy, applies in corners:
            if applies and (x - cx) ** 2 + (y - cy) ** 2 > radius ** 2:
                corner_ok = False

        color = bg if inside and corner_ok else (0, 0, 0, 0)
        dx, dy = x - 133, y - 128
        dist = (dx * dx + dy * dy) ** 0.5
        if (56 <= dist <= 82 and x < 160) or (60 <= x <= 98 and 76 <= y <= 180):
            color = fg
        row.extend(color)
    pixels.append(bytes(row))


def png_rgba(width, height, rows):
    raw = b"".join(b"\x00" + row for row in rows)

    def chunk(kind, data):
        return (
            struct.pack(">I", len(data))
            + kind
            + data
            + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
        )

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


png = png_rgba(size, size, pixels)
(out / "icon.png").write_bytes(png)

ico = struct.pack("<HHH", 0, 1, 1)
ico += struct.pack("<BBBBHHII", 0, 0, 0, 0, 1, 32, len(png), 6 + 16)
ico += png
(out / "icon.ico").write_bytes(ico)
