"""Prepare an offline, disposable LAWOSS tester session using only Python 3."""

import argparse
import json
import platform
import re
import shutil
import sys
import tempfile
from pathlib import Path
from urllib.parse import urlencode

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "cz-workflow-derived-v1"


def prepare(parent, locale, system, arch, version):
    """Create a new session. The feedback draft lives outside the app workspace."""
    if version and not re.fullmatch(r"[A-Za-z0-9.+_-]{1,60}", version):
        raise ValueError("Use the version shown in LAWOSS Settings.")
    if FIXTURE == parent.resolve() or FIXTURE in parent.resolve().parents:
        raise ValueError("Choose an output directory outside the reference dataset.")
    parent.mkdir(parents=True, exist_ok=True)
    session = Path(tempfile.mkdtemp(prefix="lawoss-test-", dir=parent))
    try:
        client = session / "C01"
        shutil.copytree(FIXTURE / "office" / "Clients" / "C01", client)
        shutil.copytree(FIXTURE / "third-party", session / "third-party")
        shutil.copy2(FIXTURE / "THIRD_PARTY_NOTICES.md", session)
        query = {"os": system, "arch": arch} if system and arch else {}
        if version:
            query["v"] = version
        base = f"https://lawoss.app/{locale}/alfa/hlasenie"
        form = base + ("?" + urlencode(query) if query else "")
        report = session / "feedback.md"
        report.write_text(
            "# LAWOSS | Test / Testovanie\n\n"
            f"Verzia / Version: {version or '[Settings → Updates]'}\n"
            f"OS / CPU: {system or '?'} / {arch or '?'}\n\n"
            "## Kroky / Steps\n\n## Očakávané / Expected\n\n"
            "## Pozorované / Observed\n\n## Opakovateľnosť / Reproducibility\n\n"
            "## Prílohy / Attachments\n\n"
            f"[Formulár / Feedback form]({form})\n", encoding="utf-8"
        )
        return {"session": str(session), "open_in_lawoss": str(client),
                "case": "Spisy/test-02", "feedback_draft": str(report),
                "feedback_form": form}
    except BaseException:
        shutil.rmtree(session)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path, help="Parent for new test sessions")
    parser.add_argument("--locale", choices=("sk", "cz", "en"), default="sk")
    parser.add_argument("--os", choices=("darwin", "win32"), help="Tester's OS (defaults to this machine)")
    parser.add_argument("--arch", choices=("arm64", "x64"), help="Tester's CPU (defaults to this machine)")
    parser.add_argument("--version", default="", help="Actual installed version shown in Settings")
    args = parser.parse_args()
    system = args.os or (sys.platform if sys.platform in ("darwin", "win32") else "")
    arch = args.arch or {"amd64": "x64", "x86_64": "x64", "arm64": "arm64",
                         "aarch64": "arm64"}.get(platform.machine().lower(), "")
    if args.os and args.os != sys.platform and not args.arch:
        parser.error("--arch is required when preparing a session for another OS")
    try:
        session = prepare(args.output.expanduser().resolve(), args.locale, system, arch, args.version)
    except (OSError, ValueError) as error:
        parser.exit(1, f"{error}\n")
    print(json.dumps(session, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
