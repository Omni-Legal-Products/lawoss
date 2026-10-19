"""Testy posunu dátumov v syntetických dátach (len štandardná knižnica).

Spustenie z koreňa repozitára:
    python3 -m unittest lawoss/testing/synthetic-sk/test_shift_dates.py
"""

import contextlib
import io
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import shift_dates  # noqa: E402

SCRIPT = HERE / "shift_dates.py"


def run_cli(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(SCRIPT), *args],
        capture_output=True,
        text=True,
        check=False,
    )


class ShiftDatesTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        root = Path(self._tmp.name)
        self.src = root / "kancelaria"
        self.src.mkdir()
        self.dest = root / "kopia"

    def shift(self, today: str = "2026-10-24", as_of: str = "2026-10-17") -> Path:
        result = run_cli(
            "--source", str(self.src), "--dest", str(self.dest),
            "--as-of", as_of, "--today", today,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        return self.dest

    def test_due_date_in_frontmatter_moves_by_seven_days(self) -> None:
        (self.src / "uloha.md").write_text("---\ndue: 2026-10-20\n---\n\nText\n", encoding="utf-8")
        out = self.shift()
        self.assertEqual(
            (out / "uloha.md").read_text(encoding="utf-8"),
            "---\ndue: 2026-10-27\n---\n\nText\n",
        )

    def test_history_line_date_moves_the_same_way(self) -> None:
        (self.src / "zaznam.md").write_text(
            "## History\n\n- 2026-09-01 [request] - Vytvorenie.\n", encoding="utf-8"
        )
        out = self.shift()
        self.assertIn("- 2026-09-08 [request] - Vytvorenie.", (out / "zaznam.md").read_text(encoding="utf-8"))

    def test_bom_and_crlf_are_preserved_in_markdown(self) -> None:
        raw = b"\xef\xbb\xbf---\r\ndue: 2026-10-20\r\n---\r\n\r\nText\r\n"
        (self.src / "bom.md").write_bytes(raw)
        out = self.shift()
        self.assertEqual(
            (out / "bom.md").read_bytes(),
            b"\xef\xbb\xbf---\r\ndue: 2026-10-27\r\n---\r\n\r\nText\r\n",
        )

    def test_binary_files_stay_byte_identical(self) -> None:
        # Bajty zámerne obsahujú aj text, ktorý vyzerá ako dátum.
        pdf = b"%PDF-1.4\n/CreationDate 2026-10-20\n\x00\xff\xfe\x80 2026-10-20\n%%EOF"
        docx = b"PK\x03\x04\x00\x00 due: 2026-10-20 \xff\xfe"
        (self.src / "zmluva.pdf").write_bytes(pdf)
        (self.src / "zmluva.docx").write_bytes(docx)
        out = self.shift()
        self.assertEqual((out / "zmluva.pdf").read_bytes(), pdf)
        self.assertEqual((out / "zmluva.docx").read_bytes(), docx)

    def test_text_files_other_than_markdown_are_not_touched(self) -> None:
        (self.src / "tabulka.csv").write_text("termin\n2026-10-20\n", encoding="utf-8")
        out = self.shift()
        self.assertEqual((out / "tabulka.csv").read_text(encoding="utf-8"), "termin\n2026-10-20\n")

    def test_existing_dest_is_refused_with_exit_2_and_left_alone(self) -> None:
        (self.src / "a.md").write_text("due: 2026-10-20\n", encoding="utf-8")
        self.dest.mkdir()
        (self.dest / "stary.txt").write_text("nedotknutelne", encoding="utf-8")
        result = run_cli("--source", str(self.src), "--dest", str(self.dest))
        self.assertEqual(result.returncode, 2)
        self.assertEqual([p.name for p in self.dest.iterdir()], ["stary.txt"])

    def test_missing_source_is_refused_with_exit_2(self) -> None:
        result = run_cli("--source", str(self.src / "neexistuje"), "--dest", str(self.dest))
        self.assertEqual(result.returncode, 2)
        self.assertFalse(self.dest.exists())

    def test_matter_number_is_left_unchanged(self) -> None:
        text = "Spis SYN-M001/2026 a SYN-M001/2026-A, termín 2026-10-20.\n"
        (self.src / "spis.md").write_text(text, encoding="utf-8")
        out = self.shift()
        self.assertEqual(
            (out / "spis.md").read_text(encoding="utf-8"),
            "Spis SYN-M001/2026 a SYN-M001/2026-A, termín 2026-10-27.\n",
        )

    def test_dates_inside_longer_tokens_are_left_alone(self) -> None:
        text = "odkaz 2026-10-20-poznamka.md, id 12026-10-205, cesta a/2026-10-20.\n"
        (self.src / "odkazy.md").write_text(text, encoding="utf-8")
        out = self.shift()
        self.assertEqual((out / "odkazy.md").read_text(encoding="utf-8"), text)

    def test_impossible_date_is_left_unchanged(self) -> None:
        (self.src / "nezmysel.md").write_text("a 2026-02-30 b 2026-10-20\n", encoding="utf-8")
        out = self.shift()
        self.assertEqual((out / "nezmysel.md").read_text(encoding="utf-8"), "a 2026-02-30 b 2026-10-27\n")

    def test_negative_shift_when_today_is_before_as_of(self) -> None:
        (self.src / "a.md").write_text("due: 2026-10-20\n", encoding="utf-8")
        out = self.shift(today="2026-10-10")
        self.assertEqual((out / "a.md").read_text(encoding="utf-8"), "due: 2026-10-13\n")

    def test_nested_tree_is_copied_and_source_is_not_modified(self) -> None:
        nested = self.src / "Klienti" / "C001" / "Spisy"
        nested.mkdir(parents=True)
        (nested / "index.md").write_text("updated: 2026-10-17\n", encoding="utf-8")
        out = self.shift()
        self.assertEqual((out / "Klienti" / "C001" / "Spisy" / "index.md").read_text(encoding="utf-8"), "updated: 2026-10-24\n")
        self.assertEqual((nested / "index.md").read_text(encoding="utf-8"), "updated: 2026-10-17\n")

    def test_non_utf8_markdown_is_copied_unchanged(self) -> None:
        raw = b"due: 2026-10-20 \xff\xfe\n"
        (self.src / "rozbite.md").write_bytes(raw)
        result = run_cli("--source", str(self.src), "--dest", str(self.dest),
                         "--as-of", "2026-10-17", "--today", "2026-10-24")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.dest / "rozbite.md").read_bytes(), raw)
        self.assertIn("rozbite.md", result.stderr)

    def test_default_as_of_is_dataset_date(self) -> None:
        (self.src / "a.md").write_text("due: 2026-10-20\n", encoding="utf-8")
        result = run_cli("--source", str(self.src), "--dest", str(self.dest), "--today", "2026-10-18")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.dest / "a.md").read_text(encoding="utf-8"), "due: 2026-10-21\n")


    def test_iso_datetime_with_z_keeps_time_and_suffix(self) -> None:
        (self.src / "cas.md").write_text("vytvorené: 2026-10-17T09:00:00Z\n", encoding="utf-8")
        out = self.shift()
        self.assertEqual((out / "cas.md").read_text(encoding="utf-8"), "vytvorené: 2026-10-24T09:00:00Z\n")

    def test_iso_datetime_with_fraction_and_offset_keeps_time(self) -> None:
        (self.src / "cas.md").write_text('at: "2026-10-17T09:00:00.123+02:00"\n', encoding="utf-8")
        out = self.shift()
        self.assertEqual((out / "cas.md").read_text(encoding="utf-8"), 'at: "2026-10-24T09:00:00.123+02:00"\n')

    def test_letter_t_without_digit_is_not_a_time(self) -> None:
        text = "kód 2026-10-17Tabc a 2026-10-17T\n"
        (self.src / "t.md").write_text(text, encoding="utf-8")
        out = self.shift()
        self.assertEqual((out / "t.md").read_text(encoding="utf-8"), "kód 2026-10-17Tabc a 2026-10-17T\n")

    def test_month_and_year_rollover(self) -> None:
        (self.src / "a.md").write_text("due: 2026-12-30\n", encoding="utf-8")
        out = self.shift()
        self.assertEqual((out / "a.md").read_text(encoding="utf-8"), "due: 2027-01-06\n")

    def test_leap_day_when_shifting_backwards(self) -> None:
        (self.src / "a.md").write_text("due: 2028-03-01\n", encoding="utf-8")
        out = self.shift(today="2028-03-01", as_of="2028-03-02")
        self.assertEqual((out / "a.md").read_text(encoding="utf-8"), "due: 2028-02-29\n")

    def test_dest_inside_source_is_refused_with_exit_2(self) -> None:
        (self.src / "a.md").write_text("due: 2026-10-20\n", encoding="utf-8")
        inside = self.src / "podpriecinok" / "kopia"
        result = run_cli("--source", str(self.src), "--dest", str(inside))
        self.assertEqual(result.returncode, 2)
        self.assertFalse(inside.exists())

    def test_dest_inside_source_is_refused_even_through_dotdot(self) -> None:
        (self.src / "a.md").write_text("due: 2026-10-20\n", encoding="utf-8")
        (self.src / "sub").mkdir()
        sneaky = self.src / "sub" / ".." / "kopia"
        result = run_cli("--source", str(self.src), "--dest", str(sneaky))
        self.assertEqual(result.returncode, 2)
        self.assertFalse((self.src / "kopia").exists())

    def test_bom_constant_is_u_feff(self) -> None:
        self.assertEqual(shift_dates.BOM, chr(0xFEFF))


class PythonVersionCheckTest(unittest.TestCase):
    def check(self, version: tuple) -> tuple[bool, str]:
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr):
            ok = shift_dates.python_is_supported(version)
        return ok, stderr.getvalue()

    def test_old_python_gets_a_clear_slovak_message(self) -> None:
        ok, message = self.check((3, 10, 9))
        self.assertFalse(ok)
        self.assertIn("Python 3.11 alebo novší", message)
        self.assertIn("3.10.9", message)

    def test_supported_python_prints_nothing(self) -> None:
        for version in ((3, 11, 0), (3, 14, 7), (4, 0, 0)):
            with self.subTest(version=version):
                self.assertEqual(self.check(version), (True, ""))


class TruthDigestTest(unittest.TestCase):
    RECORD = (
        "---\n"
        'id: "M019-C2"\n'
        'created: "2026-09-01"\n'
        'updated: "2026-10-17"\n'
        'truth_digest: "1a2b3c4d"\n'
        "---\n"
        "\n"
        "## Truth\n"
        "\n"
        "Lehota uplynie 2026-10-20 a ďalšia 2026-11-01.\n"
        "\n"
        "## History\n"
        "\n"
        "- 2026-09-01 [request] - Vytvorenie.\n"
        "- 2026-10-17 [request] - Zaradenie.\n"
    )

    def test_record_with_digest_keeps_truth_and_shifts_frontmatter_and_history(self) -> None:
        shifted = shift_dates.shift_markdown(self.RECORD.encode("utf-8"), 7)
        self.assertEqual(
            shifted.decode("utf-8"),
            self.RECORD
            .replace('created: "2026-09-01"', 'created: "2026-09-08"')
            .replace('updated: "2026-10-17"', 'updated: "2026-10-24"')
            .replace("- 2026-09-01 [request]", "- 2026-09-08 [request]")
            .replace("- 2026-10-17 [request]", "- 2026-10-24 [request]"),
        )

    def test_same_record_without_digest_shifts_truth_too(self) -> None:
        without = self.RECORD.replace('truth_digest: "1a2b3c4d"\n', "")
        shifted = shift_dates.shift_markdown(without.encode("utf-8"), 7).decode("utf-8")
        self.assertIn("Lehota uplynie 2026-10-27 a ďalšia 2026-11-08.", shifted)

    def test_digest_is_recognised_under_slovak_and_czech_key_names(self) -> None:
        for key in ("odtlačok pravdy", "otisk pravdy"):
            with self.subTest(key=key):
                record = self.RECORD.replace("truth_digest", key)
                shifted = shift_dates.shift_markdown(record.encode("utf-8"), 7).decode("utf-8")
                self.assertIn("Lehota uplynie 2026-10-20 a ďalšia 2026-11-01.", shifted)

    def test_digest_record_keeps_bom_and_crlf(self) -> None:
        raw = b"\xef\xbb\xbf" + self.RECORD.replace("\n", "\r\n").encode("utf-8")
        shifted = shift_dates.shift_markdown(raw, 7)
        self.assertTrue(shifted.startswith(b"\xef\xbb\xbf---\r\n"))
        self.assertNotIn(b"\n", shifted.replace(b"\r\n", b""))
        self.assertIn("Lehota uplynie 2026-10-20".encode("utf-8"), shifted)
        self.assertIn(b"- 2026-09-08 [request]", shifted)

    def test_digest_text_outside_frontmatter_does_not_switch_mode(self) -> None:
        text = "## Truth\n\ntruth_digest: abc, termín 2026-10-20\n"
        shifted = shift_dates.shift_markdown(text.encode("utf-8"), 7).decode("utf-8")
        self.assertIn("termín 2026-10-27", shifted)


if __name__ == "__main__":
    unittest.main()
