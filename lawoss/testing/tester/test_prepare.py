import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

SCRIPT = Path(__file__).with_name("prepare.py")


class TesterSession(unittest.TestCase):
    def test_first_and_second_session(self):
        with tempfile.TemporaryDirectory() as tmp:
            command = [sys.executable, str(SCRIPT), "--output", tmp, "--locale", "cz",
                       "--os", "win32", "--arch", "arm64", "--version", "0.0.0"]
            first, second = [
                json.loads(subprocess.check_output(command, text=True)) for _ in range(2)
            ]
            self.assertNotEqual(first["session"], second["session"])
            client = Path(first["open_in_lawoss"])
            case = client / first["case"]
            self.assertTrue(any(case.rglob("*.pdf")) and any(case.rglob("*.eml")))
            self.assertFalse(list(client.rglob("ground-truth")))
            self.assertTrue((client.parent / "third-party" / "OKF-LICENSE.txt").is_file())
            draft = Path(first["feedback_draft"])
            self.assertEqual(draft.parent, client.parent)
            self.assertIn(first["feedback_form"], draft.read_text(encoding="utf-8"))
            link = urlsplit(first["feedback_form"])
            self.assertEqual(link.path, "/cz/alfa/hlasenie")
            self.assertEqual(parse_qs(link.query), {"os": ["win32"], "arch": ["arm64"], "v": ["0.0.0"]})

    def test_invalid_version_creates_no_session(self):
        with tempfile.TemporaryDirectory() as tmp:
            result = subprocess.run([sys.executable, str(SCRIPT), "--output", tmp,
                                     "--version", "invalid/version"], capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(list(Path(tmp).iterdir()), [])


if __name__ == "__main__":
    unittest.main()
