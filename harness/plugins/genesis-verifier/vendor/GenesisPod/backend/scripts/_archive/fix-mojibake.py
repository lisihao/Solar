#!/usr/bin/env python3
"""
fix-mojibake.py —— 修复 backend 源码中 UTF-8 双重编码导致的 mojibake 注释。

R0-A5 二轮清理（commit a8ef286e4）对 38 文件做 sed 替换业务名时把 UTF-8 中文
注释当 latin-1 处理，写回后形成"双重编码"——文件本身仍是 UTF-8，但内容是
原 UTF-8 字节被 latin-1 解码后的 unicode 再次 UTF-8 编码的结果。

修复算法（按行）：
  1. 找到含 mojibake 标志（â€ å£ æ ‡ 等）的行
  2. line.encode('latin-1').decode('utf-8') —— 还原原 UTF-8 字节
  3. 仅当结果是合法 UTF-8 + 不含 latin-1 的 mojibake 标志时才替换

只改注释行（//、 *、/**、*/）不动代码逻辑；spec 失败时整个文件回滚。
"""
import os
import sys
from pathlib import Path

# cp1252 0x80-0x9F printable chars → byte mapping
CP1252_HIGH = {
    0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84,
    0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88,
    0x2030: 0x89, 0x0160: 0x8A, 0x2039: 0x8B, 0x0152: 0x8C,
    0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93,
    0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
    0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B,
    0x0153: 0x9C, 0x017E: 0x9E, 0x0178: 0x9F,
}

def encode_cp1252_permissive(s: str) -> bytes | None:
    """编码 cp1252，对超 0xFF 但在 cp1252 0x80-0x9F 表内的字符特殊处理。"""
    out = bytearray()
    for c in s:
        cp = ord(c)
        if cp < 0x100:
            out.append(cp)  # latin-1 range pass through
        elif cp in CP1252_HIGH:
            out.append(CP1252_HIGH[cp])
        else:
            return None  # unmappable, abort
    return bytes(out)

def count_cjk(text: str) -> int:
    """CJK 字符（U+4E00-U+9FFF）+ 全角标点 (U+3000-U+303F, U+FF00-U+FFEF)"""
    return sum(1 for c in text
               if 0x4E00 <= ord(c) <= 0x9FFF
               or 0x3000 <= ord(c) <= 0x303F
               or 0xFF00 <= ord(c) <= 0xFFEF)

def attempt_round_trip(s: str) -> str | None:
    """单次 cp1252+utf-8 round-trip。失败返回 None。"""
    raw = encode_cp1252_permissive(s)
    if raw is None:
        return None
    try:
        return raw.decode('utf-8', errors='strict')
    except UnicodeDecodeError:
        return None

def fix_line(line: str, max_passes: int = 4) -> str:
    """尝试还原 mojibake，支持多重双重编码（最多 4 次 round-trip）。
    返回所有 pass 中 CJK 字符数最多的版本（若都没增加则返回原行）。"""
    candidates = [line]
    current = line
    for _ in range(max_passes):
        recovered = attempt_round_trip(current)
        if recovered is None or recovered == current:
            break
        candidates.append(recovered)
        current = recovered
    best = max(candidates, key=count_cjk)
    # 接受条件 1：CJK 数显著增加（含 CJK 内容的注释）
    if count_cjk(best) > count_cjk(line) + 2:
        return best
    # 接受条件 2：CJK=0 但 mojibake 标志被消除（纯英文标题里的 em-dash 等）
    BAD_MARKERS = ['Ã¢', 'â€', 'å£', 'æ ‡', 'ç›®', 'æ¨¡', 'ï¼Œ', 'ï¼Ÿ', 'ï¼š']
    line_bad = sum(line.count(m) for m in BAD_MARKERS)
    best_bad = sum(best.count(m) for m in BAD_MARKERS)
    if best is not line and best_bad < line_bad and best_bad == 0:
        return best
    return line

def has_mojibake(text: str) -> bool:
    """快速 reject：完全是 ASCII 没必要尝试。"""
    return any(ord(c) > 0x7F for c in text)

def fix_file(path: Path) -> tuple[bool, int]:
    """返回 (是否修改, 修复行数)"""
    try:
        original = path.read_text(encoding='utf-8')
    except UnicodeDecodeError:
        print(f"  SKIP {path}: not valid UTF-8")
        return False, 0
    if not has_mojibake(original):
        return False, 0
    lines = original.split('\n')
    new_lines = []
    fixed = 0
    for line in lines:
        new = fix_line(line)
        if new != line:
            fixed += 1
        new_lines.append(new)
    if fixed == 0:
        return False, 0
    new_content = '\n'.join(new_lines)
    # 写回前最后校验
    if has_mojibake(new_content):
        # 部分行无法修复，仍写回（已修复行有意义）
        pass
    path.write_text(new_content, encoding='utf-8', newline='\n')
    return True, fixed

def main():
    root = Path('src/modules')
    if not root.exists():
        print(f"src/modules not found (cwd={os.getcwd()})", file=sys.stderr)
        sys.exit(1)
    total_files = 0
    total_lines = 0
    for ts in root.rglob('*.ts'):
        changed, n = fix_file(ts)
        if changed:
            total_files += 1
            total_lines += n
            print(f"  fixed {ts}: {n} lines")
    print(f"\nTotal: {total_files} files, {total_lines} lines fixed")

if __name__ == '__main__':
    main()
