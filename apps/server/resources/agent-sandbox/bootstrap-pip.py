"""Install a hash-pinned pip before any Python dependency downloads.

Run with the target Python and -I -S. --seed also repairs the guest's ensurepip
wheel so creating a virtual environment cannot restore the affected CA bundle.
"""
import argparse
import hashlib
from pathlib import Path
import re
import shutil
import subprocess
import sys
import sysconfig
import tempfile
import zipfile

VERSION = "26.2.2"
SHA256 = "fd7f4dfa8190e014013b9f08f3e973f4e4c26ffd179a204895533a7254813a70"
WHEEL = f"pip-{VERSION}-py3-none-any.whl"
URL = "https://files.pythonhosted.org/packages/3f/06/3e4420302363fbb71be3c7f35ce042f54bfca330e3e66b3a2e3c4cca579f/" + WHEEL

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--seed", action="store_true")
args = parser.parse_args()
if sys.version_info < (3, 10):
    raise SystemExit("The patched pip requires Python 3.10 or newer.")

with tempfile.TemporaryDirectory(prefix="legalwork-pip-") as temporary:
    wheel = Path(temporary) / WHEEL
    subprocess.run([
        "curl", "--fail", "--silent", "--show-error", "--location",
        "--proto", "=https", "--proto-redir", "=https", "--retry", "2",
        "--connect-timeout", "20", "--max-time", "180", URL, "--output", str(wheel),
    ], check=True)
    if hashlib.sha256(wheel.read_bytes()).hexdigest() != SHA256:
        raise SystemExit("pip wheel SHA-256 mismatch; nothing was installed.")
    with zipfile.ZipFile(wheel) as archive:
        if b"emSign ECC Root CA - G3" in archive.read("pip/_vendor/certifi/cacert.pem"):
            raise SystemExit("pip wheel retains the distrusted root.")
    subprocess.run([
        sys.executable, "-I", str(wheel) + "/pip", "--isolated",
        "--disable-pip-version-check", "install", "--no-index", "--no-deps",
        "--no-cache-dir", "--upgrade", str(wheel),
    ], check=True)
    if args.seed:
        ensurepip = Path(sysconfig.get_path("stdlib")) / "ensurepip"
        source = ensurepip / "__init__.py"
        updated, count = re.subn(r'(?m)^_PIP_VERSION = ["\'][^"\']+["\']$',
                                 f'_PIP_VERSION = "{VERSION}"', source.read_text())
        if count != 1:
            raise SystemExit("Unknown ensurepip layout; refusing to leave an unverified seed.")
        bundled = ensurepip / "_bundled"
        shutil.copyfile(wheel, bundled / WHEEL)
        source.write_text(updated)
        for previous in bundled.glob("pip-*.whl"):
            if previous.name != WHEEL:
                previous.unlink()
        subprocess.run([
            sys.executable, "-I", "-c",
            f"import ensurepip; assert ensurepip.version() == '{VERSION}'",
        ], check=True)

subprocess.run([
    sys.executable, "-I", "-c",
    "import pathlib, pip; from pip._vendor import certifi; "
    f"assert pip.__version__ == '{VERSION}'; "
    "assert 'emSign ECC Root CA - G3' not in pathlib.Path(certifi.where()).read_text(); "
    "print('Verified pip', pip.__version__, 'and its repaired CA bundle')",
], check=True)
