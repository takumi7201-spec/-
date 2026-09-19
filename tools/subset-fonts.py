#!/usr/bin/env python3
"""書体を、このゲームが実際に出す字だけに絞って woff2 にする。

Google Fonts をそのまま読むと unicode-range 分割の CSS を1枚と woff2 を
数個、毎回ネットワークから取ることになる。オフラインでも Artifact でも
確実に同じ絵にしたいので、必要な字だけ焼いて src/ui/fonts に置く（Vite がハッシュ付きで出力する）。

収録するのは、
  - ソース中に現れる全文字（UI 文言・恐竜名・説明文はすべてリテラル）
  - かな・カタカナ・記号・全角英数の全域（実行時に組み立てる字を落とさない）
であって、常用漢字の全部ではない。文言を足したら再実行すること。

    python3 tools/subset-fonts.py <元TTFのディレクトリ>

元 TTF はリポジトリに置かない。Google Fonts から落としたものを引数の
ディレクトリに置いて実行する。必要なのは4つ:

  chakra600.ttf / chakra700.ttf  Chakra Petch — 数値と英字だけを担う
  zkg700.ttf    / zkg900.ttf     Zen Kaku Gothic New — 日本語

欧文側は和文を持たないので、収録する字を分ける。Chakra Petch に
ひらがなを渡しても入らないうえ、サブセット後のファイルに
「その字を持っている」と申告されると、和文がそちらへ回って豆腐になる。
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'src' / 'ui' / 'fonts'
SCAN_DIRS = [ROOT / 'src']
SCAN_FILES = [ROOT / 'index.html']
SCAN_SUFFIX = {'.ts', '.css', '.html'}

# 実行時に組み立てうる字。ソース走査だけだと取りこぼす
RANGES = [
    (0x20, 0x7E),        # ASCII
    (0xB0, 0xB1),        # ° ±
    (0xD7, 0xD7),        # ×
    (0x2010, 0x2027),    # 約物
    (0x2030, 0x203B),    # ‰ ′ ※
    (0x2190, 0x2193),    # 矢印
    (0x25A0, 0x25CF),    # 幾何学模様
    (0x3000, 0x303F),    # 和文約物
    (0x3041, 0x309F),    # ひらがな
    (0x30A0, 0x30FF),    # カタカナ
    (0x31F0, 0x31FF),    # カタカナ拡張
    (0xFF01, 0xFF60),    # 全角英数記号
    (0xFFE0, 0xFFE6),    # 全角通貨
]


def collect() -> set[str]:
    chars: set[str] = set()
    for lo, hi in RANGES:
        chars.update(chr(c) for c in range(lo, hi + 1))

    files = list(SCAN_FILES)
    for d in SCAN_DIRS:
        files += [p for p in d.rglob('*') if p.suffix in SCAN_SUFFIX]
    for p in files:
        chars.update(p.read_text(encoding='utf-8'))

    # 制御文字は入れない
    return {c for c in chars if ord(c) >= 0x20 and c not in ''}


# 欧文フェイスに渡す範囲。和文を混ぜない——持っていない字を申告させると、
# ブラウザがそのフェイスを選んでしまい、日本語が豆腐になる
LATIN_MAX = 0x2FFF


def subset(src: Path, dst: Path, chars: set[str]) -> None:
    text = ''.join(sorted(chars))
    subprocess.run(
        [
            sys.executable, '-m', 'fontTools.subset', str(src),
            f'--text={text}',
            '--flavor=woff2',
            f'--output-file={dst}',
            '--layout-features=kern,liga,vert,vrt2,palt',
            '--no-hinting',
            '--desubroutinize',
            '--name-IDs=1,2,3,4,6',
        ],
        check=True,
    )


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit('使い方: python3 tools/subset-fonts.py <元TTFのディレクトリ>')
    src_dir = Path(sys.argv[1])
    chars = collect()
    OUT.mkdir(parents=True, exist_ok=True)
    latin = {c for c in chars if ord(c) <= LATIN_MAX}
    faces = (
        ('chakra600.ttf', 'chakra-petch-600.woff2', latin),
        ('chakra700.ttf', 'chakra-petch-700.woff2', latin),
        ('zkg700.ttf', 'zen-kaku-700.woff2', chars),
        ('zkg900.ttf', 'zen-kaku-900.woff2', chars),
    )
    for name, out, use in faces:
        src = src_dir / name
        if not src.exists():
            raise SystemExit(f'{src} がない')
        subset(src, OUT / out, use)
        print(f'{out}: {(OUT / out).stat().st_size / 1024:.1f} KB  ({len(use)} 字)')
    print(f'走査 {len(chars)} 字 / うち欧文 {len(latin)} 字')


if __name__ == '__main__':
    main()
