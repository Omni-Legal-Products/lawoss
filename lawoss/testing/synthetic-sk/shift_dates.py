#!/usr/bin/env python3
"""Posun dátumov v syntetickej kancelárii k dnešku.

Skopíruje strom kancelárie do nového priečinka. V súboroch `.md` posunie každý
dátum RRRR-MM-DD o počet dní medzi `--today` a `--as-of`. Všetky ostatné súbory
(PDF, DOCX, EML, CSV a ďalšie) skopíruje bajtovo rovnaké. Pôvodný priečinok sa
nemení. Používa len štandardnú knižnicu Pythonu.

Záznam pamäte s odtlačkom pravdy (`truth_digest`) sa posúva opatrne: dátumy sa
menia len v hlavičke a v časti `## History`. Telo `## Truth` ostane, inak by
odtlačok prestal sedieť.
"""

from __future__ import annotations

import sys

MIN_PYTHON = (3, 11)


def python_is_supported(version_info: tuple = tuple(sys.version_info)) -> bool:
    """Skontroluje verziu Pythonu a pri starej verzii vypíše zrozumiteľnú správu."""
    if tuple(version_info[:2]) >= MIN_PYTHON:
        return True
    found = ".".join(str(part) for part in version_info[:3])
    print(
        f"Tento skript potrebuje Python 3.11 alebo novší, vy máte {found}. "
        "Nainštalujte novší Python z python.org a spustite skript znova.",
        file=sys.stderr,
    )
    return False


if not python_is_supported():
    sys.exit(2)

import argparse  # noqa: E402
import os  # noqa: E402
import re  # noqa: E402
import shutil  # noqa: E402
import unicodedata  # noqa: E402
from datetime import date, timedelta  # noqa: E402
from pathlib import Path  # noqa: E402

DATASET_AS_OF = "2026-10-17"
BOM = "﻿"

# Dátum nesmie byť súčasťou dlhšieho tokenu: číslo spisu, názov súboru, cesta.
# Čas za dátumom (`2026-10-17T09:00:00Z`) je povolený; posúva sa len dátum.
DATE_RE = re.compile(r"(?<![\w./-])(\d{4})-(\d{2})-(\d{2})(?!(?!T\d)\w|[-/]\w)")
LINE_RE = re.compile(r"[^\n]*\n|[^\n]+")
HEADING_RE = re.compile(r"#{1,2} ")
DIGEST_KEY_RE = re.compile(r"""^["']?(truth_digest|otisk pravdy|odtlačok pravdy)["']?\s*:""")


def shift_text(text: str, days: int) -> str:
    """Posunie všetky platné dátumy RRRR-MM-DD v texte o `days` dní."""
    delta = timedelta(days=days)

    def replace(match: re.Match) -> str:
        try:
            moved = date(int(match[1]), int(match[2]), int(match[3])) + delta
        except (ValueError, OverflowError):
            return match[0]  # neplatný dátum alebo mimo rozsahu: nechať
        return moved.isoformat()

    return DATE_RE.sub(replace, text)


def _frontmatter_end(lines: list[str]) -> int:
    """Index riadku, na ktorom hlavička končí (0, ak hlavička nie je)."""
    if not lines or lines[0].removeprefix(BOM).rstrip() != "---":
        return 0
    for index in range(1, len(lines)):
        if lines[index].rstrip() == "---":
            return index
    return 0


def _has_truth_digest(header_lines: list[str]) -> bool:
    return any(DIGEST_KEY_RE.match(unicodedata.normalize("NFC", line.strip())) for line in header_lines)


def shift_markdown_text(text: str, days: int) -> str:
    lines = LINE_RE.findall(text)
    header_end = _frontmatter_end(lines)
    if not (header_end and _has_truth_digest(lines[1:header_end])):
        return shift_text(text, days)

    out: list[str] = []
    in_history = False
    for index, line in enumerate(lines):
        if index <= header_end:
            out.append(shift_text(line, days))
            continue
        if HEADING_RE.match(line):
            in_history = line.rstrip() == "## History"
        out.append(shift_text(line, days) if in_history else line)
    return "".join(out)


def shift_markdown(data: bytes, days: int) -> bytes:
    """Posunie dátumy v bajtoch súboru `.md`; BOM a konce riadkov ostanú.

    Vyvolá UnicodeDecodeError, ak súbor nie je UTF-8.
    """
    return shift_markdown_text(data.decode("utf-8"), days).encode("utf-8")


def _parse_day(value: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise argparse.ArgumentTypeError(f"neplatný dátum „{value}“, očakáva sa RRRR-MM-DD")


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Skopíruje syntetickú kanceláriu a posunie dátumy v súboroch .md k dnešku."
    )
    parser.add_argument("--source", required=True, type=Path, help="priečinok kancelárie (ostane nezmenený)")
    parser.add_argument("--dest", required=True, type=Path, help="nový priečinok pre kópiu (nesmie existovať)")
    parser.add_argument("--as-of", default=_parse_day(DATASET_AS_OF), type=_parse_day, help=f"dátum datasetu (predvolene {DATASET_AS_OF})")
    parser.add_argument("--today", default=None, type=_parse_day, help="cieľový dátum (predvolene dnes)")
    return parser


def _is_inside(child: Path, parent: Path) -> bool:
    return child == parent or parent in child.parents


def main(argv: list[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    source: Path = args.source.resolve()
    dest: Path = args.dest.parent.resolve() / args.dest.name
    today: date = args.today or date.today()
    days = (today - args.as_of).days

    if not source.is_dir():
        print(f"Zdrojový priečinok neexistuje: {args.source}", file=sys.stderr)
        return 2
    if os.path.lexists(dest):
        print(f"Cieľ už existuje, nič som nezmenil: {args.dest}", file=sys.stderr)
        return 2
    if _is_inside(dest, source):
        print("Cieľ nesmie byť vnútri zdrojového priečinka.", file=sys.stderr)
        return 2

    skipped: list[str] = []

    def copy_file(src: str, dst: str) -> str:
        if not src.lower().endswith(".md"):
            return shutil.copy2(src, dst)
        data = Path(src).read_bytes()
        try:
            data = shift_markdown(data, days)
        except UnicodeDecodeError:
            skipped.append(os.path.relpath(src, source))
        Path(dst).write_bytes(data)
        shutil.copystat(src, dst)
        return dst

    shutil.copytree(source, dest, symlinks=True, copy_function=copy_file)

    print(f"Hotovo: {dest} (posun o {days} dní, z {args.as_of} na {today}).")
    for name in skipped:
        print(f"Upozornenie: {name} nie je UTF-8, skopírovaný bez posunu.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
