"""The profile-photo gate: accept only a small, well-formed PNG and rebuild it from its pixels alone.

Pure Python (struct + zlib), no image library, so nothing native has to ship in the Lambda package.
Every check fails closed with PngRejected(reason); the caller turns that into a 400.

What gets through is a brand-new file: the signature, IHDR, PLTE/tRNS when the image needs them, one IDAT
that this module compressed itself from the validated scanlines, and IEND. Text, EXIF, ICC profiles and
every other ancillary chunk (where hidden payloads and metadata live) are dropped, and anything after IEND
(a polyglot HTML/JS tail) is refused rather than trimmed.
"""

import base64
import binascii
import struct
import zlib

MAX_BYTES = 300 * 1024          # the decoded upload; the browser sends a 256x256 PNG, far below this
MIN_SIDE, MAX_SIDE = 16, 512    # caps the pixel count, so the inflated image is at most ~1 MB
SIGNATURE = b"\x89PNG\r\n\x1a\n"
KEEP = (b"PLTE", b"tRNS")       # besides IHDR, IDAT and IEND, the only chunks a rebuilt file carries

# colour type -> (channels, allowed bit depths), from the PNG specification.
COLOUR_TYPES = {0: (1, {1, 2, 4, 8, 16}), 2: (3, {8, 16}), 3: (1, {1, 2, 4, 8}), 4: (2, {8, 16}), 6: (4, {8, 16})}
ADAM7 = ((0, 0, 8, 8), (4, 0, 8, 8), (0, 4, 4, 8), (2, 0, 4, 4), (0, 2, 2, 4), (1, 0, 2, 2), (0, 1, 1, 2))


class PngRejected(ValueError):
    """The upload isn't an acceptable PNG. `reason` is a short code for the API's field error."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


def decode_base64(value) -> bytes:
    """Strict base64 (standard alphabet, correct padding, nothing else) with the size cap applied first."""
    if not isinstance(value, str) or not value:
        raise PngRejected("invalid_base64")
    if len(value) > 4 * -(-MAX_BYTES // 3):
        raise PngRejected("too_large")
    try:
        data = base64.b64decode(value, validate=True)
    except (binascii.Error, ValueError):
        raise PngRejected("invalid_base64")
    if not data:
        raise PngRejected("invalid_base64")
    if len(data) > MAX_BYTES:
        raise PngRejected("too_large")
    return data


def _chunk(ctype: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + ctype + data + struct.pack(">I", zlib.crc32(ctype + data) & 0xFFFFFFFF)


def _chunks(data: bytes):
    """Yield (type, payload) for each chunk, checking framing and CRC, and stop at IEND."""
    pos = len(SIGNATURE)
    while True:
        if pos + 8 > len(data):
            raise PngRejected("truncated")
        length, ctype = struct.unpack(">I4s", data[pos:pos + 8])
        if length > 0x7FFFFFFF or not all(65 <= b <= 90 or 97 <= b <= 122 for b in ctype):
            raise PngRejected("bad_chunk")
        end = pos + 8 + length
        if end + 4 > len(data):
            raise PngRejected("truncated")
        payload = data[pos + 8:end]
        (crc,) = struct.unpack(">I", data[end:end + 4])
        if zlib.crc32(ctype + payload) & 0xFFFFFFFF != crc:
            raise PngRejected("bad_crc")
        pos = end + 4
        yield ctype, payload
        if ctype == b"IEND":
            if length != 0:
                raise PngRejected("bad_chunk")
            if pos != len(data):
                raise PngRejected("trailing_data")
            return


def _header(payload: bytes) -> dict:
    if len(payload) != 13:
        raise PngRejected("bad_header")
    width, height, depth, colour, compression, filtering, interlace = struct.unpack(">IIBBBBB", payload)
    if not (MIN_SIDE <= width <= MAX_SIDE and MIN_SIDE <= height <= MAX_SIDE):
        raise PngRejected("bad_dimensions")
    if colour not in COLOUR_TYPES or depth not in COLOUR_TYPES[colour][1]:
        raise PngRejected("bad_header")
    if compression != 0 or filtering != 0 or interlace not in (0, 1):
        raise PngRejected("bad_header")
    return {"width": width, "height": height, "depth": depth, "colour": colour, "interlace": interlace}


def _scanlines(header: dict) -> list[tuple[int, int]]:
    """(row count, bytes per row including the filter byte) for each image pass."""
    bits = COLOUR_TYPES[header["colour"]][0] * header["depth"]
    w, h = header["width"], header["height"]
    passes = ADAM7 if header["interlace"] else ((0, 0, 1, 1),)
    out = []
    for x0, y0, dx, dy in passes:
        pw, ph = -(-(w - x0) // dx) if w > x0 else 0, -(-(h - y0) // dy) if h > y0 else 0
        if pw and ph:
            out.append((ph, 1 + -(-(pw * bits) // 8)))
    return out


def _inflate(compressed: bytes, header: dict) -> bytes:
    """Decompress IDAT, never past the size IHDR implies, and check every scanline's filter byte."""
    passes = _scanlines(header)
    expected = sum(rows * size for rows, size in passes)
    inflater = zlib.decompressobj()
    try:
        raw = inflater.decompress(compressed, expected + 1)  # a bomb stops here, after expected + 1 bytes
    except zlib.error:
        raise PngRejected("bad_image_data")
    if (len(raw) != expected or not inflater.eof or inflater.unconsumed_tail or inflater.unused_data):
        raise PngRejected("bad_image_data")
    pos = 0
    for rows, size in passes:
        for _ in range(rows):
            if raw[pos] > 4:  # filter types are 0-4
                raise PngRejected("bad_image_data")
            pos += size
    return raw


def sanitize_png(data: bytes) -> bytes:
    """Validate `data` as a PNG and return a fresh copy holding only what's needed to draw it."""
    if len(data) > MAX_BYTES:
        raise PngRejected("too_large")
    if not data.startswith(SIGNATURE):
        raise PngRejected("not_png")
    header, kept, idat, idat_done = None, [], [], False
    for ctype, payload in _chunks(data):
        if header is None:
            if ctype != b"IHDR":
                raise PngRejected("bad_header")
            header = _header(payload)
            continue
        if ctype == b"IHDR":
            raise PngRejected("bad_chunk")
        if ctype == b"IDAT":
            if idat_done:  # IDAT chunks must be consecutive
                raise PngRejected("bad_chunk")
            idat.append(payload)
            continue
        if idat:
            idat_done = True
        if ctype == b"IEND":
            continue  # the last chunk: _chunks() still checks nothing follows it
        if ctype in KEEP:
            seen = {t for t, _ in kept}
            if idat or ctype in seen or (ctype == b"PLTE" and b"tRNS" in seen):
                raise PngRejected("bad_chunk")
            if ctype == b"tRNS" and (header["colour"] in (4, 6) or (header["colour"] == 3 and b"PLTE" not in seen)):
                raise PngRejected("bad_chunk")
            kept.append((ctype, payload))
        elif ctype[0] < 97:  # an unknown critical chunk (upper-case first letter): a decoder must refuse it
            raise PngRejected("bad_chunk")
    if header is None:
        raise PngRejected("truncated")
    palette = next((p for t, p in kept if t == b"PLTE"), None)
    if header["colour"] == 3 and palette is None:
        raise PngRejected("bad_chunk")
    if palette is not None and (header["colour"] in (0, 4) or not palette or len(palette) % 3
                                or len(palette) > 3 * 256):
        raise PngRejected("bad_chunk")
    if not idat:
        raise PngRejected("bad_image_data")
    raw = _inflate(b"".join(idat), header)
    ihdr = struct.pack(">IIBBBBB", header["width"], header["height"], header["depth"], header["colour"],
                       0, 0, header["interlace"])
    return (SIGNATURE + _chunk(b"IHDR", ihdr) + b"".join(_chunk(t, p) for t, p in kept)
            + _chunk(b"IDAT", zlib.compress(raw, 9)) + _chunk(b"IEND", b""))
