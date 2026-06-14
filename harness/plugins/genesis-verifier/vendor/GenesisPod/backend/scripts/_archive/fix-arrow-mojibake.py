#!/usr/bin/env python3
"""Replace arrow-mojibake byte patterns. Arrows are common in non-CJK lines so
the line-level CJK heuristic in fix-mojibake.py misses them."""
from pathlib import Path

PATTERNS = [
    (b'\xc3\xa2\xe2\x80\xa0\xe2\x80\x99', '→'.encode('utf-8')),   # → U+2192
    (b'\xc3\xa2\xe2\x80\xa0\xe2\x80\x9d', '↔'.encode('utf-8')),   # ↔ U+2194
    (b'\xc3\xa2\xe2\x80\xa0\xe2\x80\x9c', '↑'.encode('utf-8')),   # ↑ U+2191
    (b'\xc3\xa2\xe2\x80\xa0\xe2\x80\x93', '↓'.encode('utf-8')),   # ↓ U+2193
]

total = 0
for ts in Path('src/modules').rglob('*.ts'):
    data = ts.read_bytes()
    orig = data
    for old, new in PATTERNS:
        data = data.replace(old, new)
    if data != orig:
        ts.write_bytes(data)
        total += 1
        print(f'fixed {ts}')
print(f'total: {total} files')
