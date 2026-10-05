"""Render a Telegram release message without sending it."""

import argparse
import html
import json
import os
import re
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlsplit
from urllib.request import Request, urlopen

INSTALLERS = (
    (r"(?:lawoss|legalwork)-mac-arm64-.+\.dmg", "🍎 macOS Apple Silicon (.dmg)"),
    (r"(?:lawoss|legalwork)-mac-x64-.+\.dmg", "🍎 macOS Intel (.dmg)"),
    (r"(?:lawoss|legalwork)-win-x64-.+\.exe", "🪟 Windows x64 (.exe)"),
    (
        r"(?:lawoss|legalwork)-linux-(?:x64|x86_64)-.+\.AppImage",
        "🐧 Linux x64 (.AppImage)",
    ),
    (r"(?:lawoss|legalwork)-linux-arm64-.+\.AppImage", "🐧 Linux arm64 (.AppImage)"),
)


def validate_input(repository: str, tag: str) -> None:
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository):
        raise ValueError("Invalid GitHub repository.")
    if not tag or tag != tag.strip() or any(ord(char) < 32 for char in tag):
        raise ValueError(
            "Release tag must be nonempty and contain no control characters."
        )


def fetch_release(repository: str, tag: str, token: str) -> object:
    validate_input(repository, tag)
    request = Request(
        f"https://api.github.com/repos/{repository}/releases/tags/{quote(tag, safe='')}",
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {token}",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "LAWOSS-release-notification",
        },
    )
    try:
        with urlopen(request, timeout=30) as response:
            return json.load(response)
    except HTTPError as error:
        if error.code == 404:
            raise ValueError(
                "Published release was not found; nothing will be sent."
            ) from None
        raise ValueError(f"GitHub release lookup failed (HTTP {error.code}).") from None
    except (URLError, TimeoutError):
        raise ValueError("GitHub release lookup failed or timed out.") from None
    except (ValueError, UnicodeError):
        raise ValueError("GitHub returned an invalid release response.") from None


def github_url(value: object, repository: str, path: str) -> str:
    if not isinstance(value, str):
        raise ValueError("Release contains a missing URL.")
    parsed = urlsplit(value)
    if (
        parsed.scheme != "https"
        or parsed.netloc != "github.com"
        or not parsed.path.startswith(f"/{repository}/releases/{path}/")
        or any(ord(char) < 32 for char in value)
    ):
        raise ValueError("Release contains an unexpected GitHub URL.")
    return html.escape(value, quote=True)


def render_release(release: object, repository: str, tag: str) -> str:
    validate_input(repository, tag)
    if not isinstance(release, dict) or release.get("tag_name") != tag:
        raise ValueError("GitHub returned a different or invalid release.")
    if release.get("draft") is not False or not release.get("published_at"):
        raise ValueError("Release is not published; nothing will be sent.")
    assets = release.get("assets")
    if not isinstance(assets, list):
        raise ValueError("Release contains no asset list.")
    links = []
    for pattern, label in INSTALLERS:
        for asset in assets:
            if not isinstance(asset, dict) or not isinstance(asset.get("name"), str):
                raise ValueError("Release contains an invalid asset.")
            if (
                re.fullmatch(pattern, asset["name"])
                and asset.get("state") == "uploaded"
            ):
                url = github_url(
                    asset.get("browser_download_url"), repository, "download"
                )
                links.append(f'<a href="{url}">{label}</a>')
    if not links:
        raise ValueError(
            "Release has no uploaded macOS, Windows or Linux installers; nothing will be sent."
        )
    url = github_url(release.get("html_url"), repository, "tag")
    prerelease = " (predbežné vydanie)" if release.get("prerelease") else ""
    return "\n".join(
        [
            f"⬇️ <b>LAWOSS {html.escape(tag)}</b>{prerelease}",
            f"Repo: <b>{html.escape(repository)}</b>",
            "",
            *links,
            "",
            f'<a href="{url}">Všetky súbory vydania</a>',
        ]
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repository", required=True)
    parser.add_argument("--tag", required=True)
    args = parser.parse_args()
    try:
        token = os.environ.get("GH_TOKEN", "")
        if not token:
            raise ValueError("GH_TOKEN is required for GitHub release lookup.")
        release = fetch_release(args.repository, args.tag, token)
        print(render_release(release, args.repository, args.tag))
    except ValueError as error:
        print(str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
