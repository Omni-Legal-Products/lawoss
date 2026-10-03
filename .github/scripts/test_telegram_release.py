"""Offline release fixtures and the actual workflow shell with stubbed delivery."""

import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import HTTPError, URLError
from urllib.parse import quote

from telegram_release import fetch_release, render_release

REPOSITORY = "Omni-Legal-Products/lawoss"


def fixture(tag: str, names: list[str], prerelease: bool = False) -> dict:
    base = f"https://github.com/{REPOSITORY}/releases"
    return {
        "tag_name": tag,
        "draft": False,
        "prerelease": prerelease,
        "published_at": "2026-09-22T19:11:03Z",
        "html_url": f"{base}/tag/{quote(tag, safe='')}",
        "assets": [
            {
                "name": name,
                "state": "uploaded",
                "browser_download_url": f"{base}/download/{quote(tag, safe='')}/{name}",
            }
            for name in names
        ],
    }


class ReleaseTests(unittest.TestCase):
    def test_historical_release_includes_all_five_platforms(self):
        names = [
            "legalwork-mac-arm64-0.1.14.dmg",
            "legalwork-mac-x64-0.1.14.dmg",
            "legalwork-win-x64-0.1.14.exe",
            "legalwork-linux-x86_64-0.1.14.AppImage",
            "legalwork-linux-arm64-0.1.14.AppImage",
        ]
        release = fixture("v0.1.14", names + ["latest.yml", names[0] + ".blockmap"])
        message = render_release(release, REPOSITORY, "v0.1.14")
        for name in names:
            self.assertIn(name, message)
        self.assertEqual(message.count('<a href="'), 6)
        self.assertIn("<b>LAWOSS v0.1.14</b>", message)
        self.assertNotIn("latest.yml", message)
        self.assertNotIn("blockmap", message)

    def test_current_alpha_releases_include_only_available_installers(self):
        for tag, name, platform in [
            (
                "alpha-macos-v0.1.15-alpha.2-8858366",
                "lawoss-mac-arm64-0.1.15-alpha.2.g8858366.dmg",
                "macOS",
            ),
            (
                "alpha-windows-v0.1.15-alpha.2-65ba399",
                "lawoss-win-x64-0.1.15-alpha.2.g65ba399.exe",
                "Windows",
            ),
        ]:
            with self.subTest(tag=tag):
                release = fixture(tag, [name, "latest.yml"], prerelease=True)
                message = render_release(release, REPOSITORY, tag)
                self.assertIn(release["assets"][0]["browser_download_url"], message)
                self.assertIn(platform, message)
                self.assertIn("predbežné vydanie", message)
                self.assertEqual(message.count('<a href="'), 2)

    def test_lawoss_suffix_and_api_asset_url_are_preserved(self):
        tag = "v0.2.1-lawoss.1"
        release = fixture(tag, ["lawoss-linux-x64-custom-build.AppImage"])
        message = render_release(release, REPOSITORY, tag)
        self.assertIn(release["assets"][0]["browser_download_url"], message)

    def test_unpublished_missing_and_incomplete_assets_fail(self):
        for changes in [
            {"draft": True},
            {"published_at": None},
            {"assets": None},
            {"tag_name": "different"},
            {"assets": []},
            {"assets": [{"name": "lawoss-win-x64-1.exe", "state": "new"}]},
        ]:
            with self.subTest(changes=changes):
                release = fixture("v1.0.0", ["lawoss-win-x64-1.exe"])
                release.update(changes)
                with self.assertRaises(ValueError):
                    render_release(release, REPOSITORY, "v1.0.0")
        with self.assertRaisesRegex(ValueError, "no uploaded"):
            render_release(
                fixture("alpha-macos-latest", ["latest-mac.yml"]),
                REPOSITORY,
                "alpha-macos-latest",
            )

    def test_html_escaping_and_untrusted_urls(self):
        tag = 'preview/a<&"b'
        release = fixture(tag, ["lawoss-win-x64-1.exe"])
        release["assets"][0]["browser_download_url"] += '?a=1&b="2"'
        message = render_release(release, REPOSITORY, tag)
        self.assertIn("preview/a&lt;&amp;&quot;b", message)
        self.assertIn("?a=1&amp;b=&quot;2&quot;", message)
        for url in [
            "https://evil.example/file",
            "javascript:alert(1)",
            "https://github.com/other/repo/releases/download/x/a.exe",
        ]:
            release["assets"][0]["browser_download_url"] = url
            with self.assertRaisesRegex(ValueError, "unexpected GitHub URL"):
                render_release(release, REPOSITORY, tag)

    @patch("telegram_release.urlopen")
    def test_fetch_encodes_tag_and_reads_github_api(self, opener):
        tag = "preview/alpha&one"
        release = fixture(tag, ["lawoss-win-x64-1.exe"])
        opener.return_value.__enter__.return_value = io.BytesIO(
            json.dumps(release).encode()
        )
        self.assertEqual(fetch_release(REPOSITORY, tag, "fixture-token"), release)
        request = opener.call_args.args[0]
        self.assertEqual(
            request.full_url,
            f"https://api.github.com/repos/{REPOSITORY}/releases/tags/preview%2Falpha%26one",
        )
        self.assertEqual(request.get_header("Authorization"), "Bearer fixture-token")
        self.assertEqual(opener.call_args.kwargs["timeout"], 30)

    @patch("telegram_release.urlopen")
    def test_api_errors_are_clear_and_do_not_leak_response_or_token(self, opener):
        for error, expected in [
            (HTTPError("url", 404, "secret response", {}, None), "not found"),
            (HTTPError("url", 403, "secret response", {}, None), "HTTP 403"),
            (URLError("secret response"), "failed or timed out"),
            (TimeoutError(), "failed or timed out"),
        ]:
            with self.subTest(error=error):
                opener.side_effect = error
                with self.assertRaisesRegex(ValueError, expected) as raised:
                    fetch_release(REPOSITORY, "v1.0.0", "fixture-token")
                self.assertNotIn("secret", str(raised.exception))
                self.assertNotIn("fixture-token", str(raised.exception))

    @patch("telegram_release.urlopen")
    def test_invalid_json(self, opener):
        opener.return_value.__enter__.return_value = io.BytesIO(b"invalid json")
        with self.assertRaisesRegex(ValueError, "invalid release response"):
            fetch_release(REPOSITORY, "v1.0.0", "fixture-token")


class WorkflowTests(unittest.TestCase):
    def run_workflow(self, event_name: str, event: dict, helper_failure: bool = False):
        workflow = Path(__file__).parents[1] / "workflows/telegram-notify.yml"
        source = workflow.read_text().split(
            "      - name: Send Telegram notification\n", 1
        )[1]
        script = source.split("        run: |\n", 1)[1]
        script = "\n".join(line[10:] for line in script.splitlines())
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "event.json").write_text(
                json.dumps({"repository": {"full_name": REPOSITORY}, **event})
            )
            (root / "curl").write_text(
                '#!/bin/bash\nprintf "%s\\n" "$@" > "$CAPTURE"\nprintf \'{"ok":true}\\n\'\n'
            )
            (root / "python3").write_text(
                "#!/bin/bash\necho 'fixture lookup failed' >&2\nexit 1\n"
                if helper_failure
                else "#!/bin/bash\nprintf '⬇️ <b>LAWOSS fixture release</b>\\n'\n"
            )
            for command in ("curl", "python3"):
                (root / command).chmod(0o700)
            capture = root / "capture.txt"
            env = {
                **os.environ,
                "PATH": f"{root}:{os.environ['PATH']}",
                "GITHUB_EVENT_NAME": event_name,
                "GITHUB_EVENT_PATH": str(root / "event.json"),
                "GITHUB_REPOSITORY": REPOSITORY,
                "GITHUB_ACTOR": "fixture-actor",
                "GITHUB_RUN_ID": "123",
                "TG_TOKEN": "fixture",
                "TG_CHAT": "fixture",
                "TG_TOPIC": "fixture",
                "CAPTURE": str(capture),
            }
            result = subprocess.run(
                ["bash", "-euo", "pipefail", "-c", script],
                env=env,
                text=True,
                capture_output=True,
            )
            return result, capture.read_text() if capture.exists() else ""

    def test_empty_tag_preserves_manual_test(self):
        for inputs in ({}, {"release_tag": ""}):
            result, delivery = self.run_workflow(
                "workflow_dispatch", {"inputs": inputs}
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("Telegram test", delivery)
            self.assertIn("actions/runs/123", delivery)

    def test_manual_release_uses_helper_output(self):
        result, delivery = self.run_workflow(
            "workflow_dispatch", {"inputs": {"release_tag": "alpha-windows-v1"}}
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("LAWOSS fixture release", delivery)

    def test_failed_lookup_never_reaches_delivery(self):
        result, delivery = self.run_workflow(
            "workflow_dispatch",
            {"inputs": {"release_tag": "missing"}},
            helper_failure=True,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(delivery, "")

    def test_published_release_event_preserves_existing_message(self):
        result, delivery = self.run_workflow(
            "release",
            {
                "release": {
                    "tag_name": "v1.0.0",
                    "name": "Example",
                    "html_url": "https://github.com/example",
                }
            },
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Nový release", delivery)
        self.assertNotIn("fixture release", delivery)


if __name__ == "__main__":
    unittest.main()
