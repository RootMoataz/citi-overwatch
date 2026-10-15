"""The avatar PNG gate: only a small, well-formed PNG gets through, rebuilt with nothing but its pixels."""

import base64
import struct
import zlib

import pytest

from app.rules.png_sanitize import MAX_BYTES, PngRejected, decode_base64, sanitize_png

SIG = b"\x89PNG\r\n\x1a\n"


def chunk(ctype: bytes, data: bytes, *, crc: int | None = None) -> bytes:
    value = zlib.crc32(ctype + data) if crc is None else crc
    return struct.pack(">I", len(data)) + ctype + data + struct.pack(">I", value & 0xFFFFFFFF)


def ihdr(width=32, height=32, depth=8, colour=6, interlace=0) -> bytes:
    return chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, depth, colour, 0, 0, interlace))


def rgba_pixels(width=32, height=32) -> bytes:
    row = b"\x00" + bytes((x * 7) % 256 for x in range(width * 4))
    return row * height


def make_png(width=32, height=32, *, extra_before_idat=(), raw=None, idat=None, tail=b"",
             depth=8, colour=6, plte=None) -> bytes:
    raw = rgba_pixels(width, height) if raw is None else raw
    body = [ihdr(width, height, depth, colour)]
    if plte is not None:
        body.append(chunk(b"PLTE", plte))
    body.extend(extra_before_idat)
    body.append(chunk(b"IDAT", zlib.compress(raw) if idat is None else idat))
    body.append(chunk(b"IEND", b""))
    return SIG + b"".join(body) + tail


def chunk_types(png: bytes) -> list[bytes]:
    pos, out = 8, []
    while pos < len(png):
        (length,) = struct.unpack(">I", png[pos:pos + 4])
        out.append(png[pos + 4:pos + 8])
        pos += 12 + length
    return out


def reason(data: bytes) -> str:
    with pytest.raises(PngRejected) as info:
        sanitize_png(data)
    return info.value.reason


def test_a_valid_png_passes_and_keeps_its_pixels():
    png = make_png()
    out = sanitize_png(png)
    assert out.startswith(SIG)
    assert chunk_types(out) == [b"IHDR", b"IDAT", b"IEND"]
    idat = out[8 + 25:]
    (length,) = struct.unpack(">I", idat[:4])
    assert zlib.decompress(idat[8:8 + length]) == rgba_pixels()


def test_text_metadata_and_every_other_ancillary_chunk_is_stripped():
    payload = b"Comment\x00<script>alert(1)</script>"
    png = make_png(extra_before_idat=[chunk(b"tEXt", payload), chunk(b"zTXt", b"k\x00\x00" + zlib.compress(b"x")),
                                      chunk(b"iTXt", b"k\x00\x00\x00\x00\x00hi"), chunk(b"eXIf", b"MM\x00*"),
                                      chunk(b"iCCP", b"p\x00\x00" + zlib.compress(b"icc")), chunk(b"gAMA", b"\x00\x00\xb1\x8f")])
    out = sanitize_png(png)
    assert chunk_types(out) == [b"IHDR", b"IDAT", b"IEND"]
    assert b"script" not in out and b"tEXt" not in out


def test_a_palette_image_keeps_plte_and_trns():
    raw = (b"\x00" + bytes(16)) * 16
    png = make_png(16, 16, depth=8, colour=3, plte=b"\x00\x00\x00\xff\xff\xff",
                   raw=raw, extra_before_idat=[chunk(b"tRNS", b"\x00")])
    assert chunk_types(sanitize_png(png)) == [b"IHDR", b"PLTE", b"tRNS", b"IDAT", b"IEND"]


def test_split_idat_chunks_are_joined_and_recompressed():
    data = zlib.compress(rgba_pixels())
    half = len(data) // 2
    png = (SIG + ihdr() + chunk(b"IDAT", data[:half]) + chunk(b"IDAT", data[half:]) + chunk(b"IEND", b""))
    assert chunk_types(sanitize_png(png)) == [b"IHDR", b"IDAT", b"IEND"]


def test_an_interlaced_png_passes():
    # Adam7 passes for 16x16: each pass row is a filter byte plus its pixels.
    passes = [(0, 0, 8, 8), (4, 0, 8, 8), (0, 4, 4, 8), (2, 0, 4, 4), (0, 2, 2, 4), (1, 0, 2, 2), (0, 1, 1, 2)]
    raw = b""
    for x0, y0, dx, dy in passes:
        w, h = -(-(16 - x0) // dx), -(-(16 - y0) // dy)
        raw += (b"\x00" + bytes(w * 4)) * h
    png = SIG + ihdr(16, 16, interlace=1) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")
    assert sanitize_png(png).startswith(SIG)


@pytest.mark.parametrize("data, why", [
    (b"<svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)'/>", "not_png"),
    (b"<!doctype html><script>alert(1)</script>", "not_png"),
    (b"GIF89a" + bytes(40), "not_png"),
    (b"\xff\xd8\xff\xe0" + bytes(40), "not_png"),
    (b"", "not_png"),
])
def test_anything_that_is_not_a_png_is_rejected(data, why):
    assert reason(data) == why


def test_a_bad_crc_is_rejected():
    png = SIG + chunk(b"IHDR", struct.pack(">IIBBBBB", 32, 32, 8, 6, 0, 0, 0), crc=1234) + b"rest"
    assert reason(png) == "bad_crc"
    good = make_png()
    flipped = bytearray(good)
    flipped[-20] ^= 0xFF  # inside the IDAT data
    assert reason(bytes(flipped)) == "bad_crc"


def test_html_or_javascript_appended_after_iend_is_rejected():
    assert reason(make_png(tail=b"<html><script>alert(document.cookie)</script></html>")) == "trailing_data"
    assert reason(make_png(tail=b"\x00")) == "trailing_data"


def test_a_missing_iend_or_a_truncated_file_is_rejected():
    png = make_png()
    assert reason(png[:-12]) == "truncated"
    assert reason(png[:40]) == "truncated"
    assert reason(png[:10]) == "truncated"


@pytest.mark.parametrize("width, height", [(513, 32), (32, 513), (15, 32), (32, 8), (100000, 100000), (0, 0)])
def test_dimensions_outside_16_to_512_are_rejected(width, height):
    png = SIG + ihdr(width, height) + chunk(b"IDAT", zlib.compress(b"\x00")) + chunk(b"IEND", b"")
    assert reason(png) == "bad_dimensions"


def test_ihdr_must_come_first_and_be_sane():
    raw = rgba_pixels()
    first_idat = SIG + chunk(b"IDAT", zlib.compress(raw)) + ihdr() + chunk(b"IEND", b"")
    assert reason(first_idat) == "bad_header"
    assert reason(SIG + ihdr(depth=3) + chunk(b"IEND", b"")) == "bad_header"
    assert reason(SIG + ihdr(colour=5) + chunk(b"IEND", b"")) == "bad_header"
    assert reason(SIG + ihdr(colour=2, depth=4) + chunk(b"IEND", b"")) == "bad_header"
    bad_method = SIG + chunk(b"IHDR", struct.pack(">IIBBBBB", 32, 32, 8, 6, 1, 0, 0)) + chunk(b"IEND", b"")
    assert reason(bad_method) == "bad_header"


def test_unknown_critical_chunks_are_rejected():
    assert reason(make_png(extra_before_idat=[chunk(b"EVIL", b"payload")])) == "bad_chunk"


def test_pixel_data_must_match_the_header_exactly():
    short = rgba_pixels()[:-10]
    assert reason(make_png(raw=short)) == "bad_image_data"
    assert reason(make_png(raw=rgba_pixels() + b"\x00" * 50)) == "bad_image_data"
    assert reason(make_png(idat=b"not zlib at all")) == "bad_image_data"
    assert reason(make_png(idat=zlib.compress(rgba_pixels()) + b"junk")) == "bad_image_data"
    bad_filter = b"\x09" + rgba_pixels()[1:]
    assert reason(make_png(raw=bad_filter)) == "bad_image_data"


def test_a_decompression_bomb_is_stopped_without_inflating_it():
    bomb = zlib.compress(b"\x00" * (50 * 1024 * 1024), 9)
    assert len(bomb) < MAX_BYTES
    assert reason(make_png(idat=bomb)) == "bad_image_data"


def test_a_png_without_image_data_is_rejected():
    assert reason(SIG + ihdr() + chunk(b"IEND", b"")) == "bad_image_data"


def test_a_palette_image_needs_its_palette():
    raw = (b"\x00" + bytes(16)) * 16
    assert reason(make_png(16, 16, colour=3, raw=raw)) == "bad_chunk"


def test_too_large_a_file_is_rejected():
    assert reason(make_png() + bytes(MAX_BYTES)) == "too_large"


def test_decode_base64_is_strict_and_size_capped():
    png = make_png()
    assert decode_base64(base64.b64encode(png).decode()) == png
    for bad in ("not base64!!", "abc", "", None, 42, "data:image/png;base64," + base64.b64encode(png).decode()):
        with pytest.raises(PngRejected) as info:
            decode_base64(bad)
        assert info.value.reason == "invalid_base64"
    huge = base64.b64encode(bytes(MAX_BYTES + 1)).decode()
    with pytest.raises(PngRejected) as info:
        decode_base64(huge)
    assert info.value.reason == "too_large"


def test_transparency_must_fit_the_colour_type():
    assert reason(make_png(extra_before_idat=[chunk(b"tRNS", b"\x00\x00")])) == "bad_chunk"  # RGBA has alpha already
    raw = (b"\x00" + bytes(16)) * 16
    trns_first = make_png(16, 16, colour=3, raw=raw, extra_before_idat=[chunk(b"tRNS", b"\x00"),
                                                                        chunk(b"PLTE", b"\x00\x00\x00")])
    assert reason(trns_first) == "bad_chunk"


def grey_png(depth=8, trns=None, size=16):
    raw = (b"\x00" + bytes(-(-size * depth // 8))) * size
    extra = [chunk(b"tRNS", trns)] if trns is not None else []
    return make_png(size, size, depth=depth, colour=0, raw=raw, extra_before_idat=extra)


def rgb_png(trns=None, size=16):
    raw = (b"\x00" + bytes(size * 3)) * size
    extra = [chunk(b"tRNS", trns)] if trns is not None else []
    return make_png(size, size, depth=8, colour=2, raw=raw, extra_before_idat=extra)


def palette_png(entries, trns=None, depth=8):
    size = 16
    raw = (b"\x00" + bytes(-(-size * depth // 8))) * size
    extra = [chunk(b"tRNS", trns)] if trns is not None else []
    return make_png(size, size, depth=depth, colour=3, plte=bytes(3 * entries), raw=raw, extra_before_idat=extra)


def test_grey_transparency_is_exactly_one_two_byte_sample_within_the_bit_depth():
    assert b"tRNS" in chunk_types(sanitize_png(grey_png(trns=b"\x00\xff")))
    assert b"tRNS" in chunk_types(sanitize_png(grey_png(depth=4, trns=b"\x00\x0f")))
    for bad in (b"", b"\x00", b"\x00\x00\x00", b"\x00" * 6):
        assert reason(grey_png(trns=bad)) == "bad_chunk"
    assert reason(grey_png(depth=4, trns=b"\x00\x10")) == "bad_chunk"  # 16 doesn't fit in 4 bits
    assert reason(grey_png(depth=8, trns=b"\x01\x00")) == "bad_chunk"


def test_rgb_transparency_is_exactly_one_six_byte_colour():
    assert b"tRNS" in chunk_types(sanitize_png(rgb_png(trns=b"\x00\x01\x00\x02\x00\x03")))
    for bad in (b"", b"\x00\x00", b"\x00" * 4, b"\x00" * 7, b"\x00" * 8):
        assert reason(rgb_png(trns=bad)) == "bad_chunk"
    assert reason(rgb_png(trns=b"\x00\x00\x01\x00\x00\x00")) == "bad_chunk"  # 256 doesn't fit in 8 bits


def test_palette_transparency_has_at_most_one_alpha_per_entry():
    assert b"tRNS" in chunk_types(sanitize_png(palette_png(4, trns=b"\x00\x80")))
    assert b"tRNS" in chunk_types(sanitize_png(palette_png(4, trns=b"\x00" * 4)))
    assert reason(palette_png(4, trns=b"\x00" * 5)) == "bad_chunk"
    assert reason(palette_png(4, trns=b"")) == "bad_chunk"


def test_transparency_is_refused_for_images_that_already_have_alpha():
    raw = (b"\x00" + bytes(16 * 2)) * 16
    grey_alpha = make_png(16, 16, depth=8, colour=4, raw=raw, extra_before_idat=[chunk(b"tRNS", b"\x00\x00")])
    assert reason(grey_alpha) == "bad_chunk"
    assert reason(make_png(extra_before_idat=[chunk(b"tRNS", b"\x00" * 6)])) == "bad_chunk"


def test_a_palette_cannot_have_more_entries_than_the_bit_depth_can_index():
    assert chunk_types(sanitize_png(palette_png(2, depth=1)))[:2] == [b"IHDR", b"PLTE"]
    assert reason(palette_png(3, depth=1)) == "bad_chunk"
    assert sanitize_png(palette_png(16, depth=4))
    assert reason(palette_png(17, depth=4)) == "bad_chunk"
    assert sanitize_png(palette_png(256, depth=8))
