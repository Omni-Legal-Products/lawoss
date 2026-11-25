#!/usr/bin/env python3
"""Run one approved GitHub Actions job in a disposable Apple Silicon guest."""
import argparse
import fcntl
import grp
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import socket
import subprocess
import sys
import time
import uuid

ORG = "Omni-Legal-Products"
REPO = f"{ORG}/lawoss"
GROUP = "lawoss-macos-isolated"
IMAGE = "ghcr.io/cirruslabs/macos-sequoia-base@sha256:8386ef670c04b38e57bd0e97fe2cde6bc0598e1bcfba0212ecba1814e659a6b1"
NET = Path("/Library/PrivilegedHelperTools/sk.lawoss.ci/softnet")
NET_HASH = "2ea5572268f814317bc3944d1352032f1f4dafe00bfe453eefc64e9dc32627a3"
TART = "/opt/homebrew/bin/tart"
TIMEOUT = 7200
WORKFLOWS = {
    "macos-local-probe.yml", "ci-tests.yml", "ci-desktop-packaging.yml", "sandbox-runtime.yml",
}
BLOCK = "in 0.0.0.0/0,out @host,out @peers,out 100.64.0.0/10,out 169.254.0.0/16"
PREPARE = r"""
set -euo pipefail
test "$(uname -m)" = arm64
test "$(sw_vers -productVersion | cut -d. -f1)" = 15
if mount | grep -qi virtiofs; then exit 1; fi
test ! -d "/Volumes/My Shared Files"
if security find-identity -v -p codesigning | grep -q 'Developer ID Application'; then exit 1; fi
iface=$(route -n get default | awk '/interface:/{print $2}')
service=$(networksetup -listnetworkserviceorder | awk -v d="$iface" '/^\([0-9]+\)/{sub(/^\([0-9]+\) /,"");s=$0} index($0,"Device: " d ")"){print s;exit}')
test -n "$service"
sudo -n networksetup -setdnsservers "$service" 1.1.1.1 8.8.8.8
gateway=$(route -n get default | awk '/gateway:/{print $2}')
if nc -G 2 -z "$gateway" "$1"; then echo 'Guest reached host canary' >&2; exit 1; fi
umask 077
mkdir "$HOME/lawoss-runner"
cd "$HOME/lawoss-runner"
version=2.338.2
curl -fLsS --retry 3 --max-time 300 -o runner.tgz "https://github.com/actions/runner/releases/download/v$version/actions-runner-osx-arm64-$version.tar.gz"
echo '25a065af409ffa317ab4d5a3b614dd15fc9c40f2172bc1b35a1b1258e919a388  runner.tgz' | shasum -a 256 -c -
tar -xzf runner.tgz
rm runner.tgz
sw_vers
"""
START = r"""
set -euo pipefail
umask 077
cd "$HOME/lawoss-runner"
unset SSH_AUTH_SOCK
export AGENT_TOOLSDIRECTORY="$HOME/lawoss-runner/tools"
mkdir -p "$AGENT_TOOLSDIRECTORY"
IFS= read -r config
test -n "$config"
exec ./run.sh --jitconfig "$config"
"""


def require(ok, message):
    if not ok:
        raise RuntimeError(message)


def api(path, payload=None, method=None):
    cmd = ["gh", "api", path]
    if method:
        cmd += ["-X", method]
    if payload is not None:
        cmd += ["--input", "-"]
    result = subprocess.run(cmd, input=json.dumps(payload) if payload is not None else None,
                            check=True, capture_output=True, text=True)
    return json.loads(result.stdout) if result.stdout.strip() else None


def admit(job, run, sha):
    require(job["status"] == "queued" and job["run_id"] == run["id"], "Job is not queued in this run")
    require(run["repository"]["full_name"] == REPO and run["head_repository"]["full_name"] == REPO,
            "Expected the LAWOSS repository at both ends")
    require(run["path"] in {f".github/workflows/{name}" for name in WORKFLOWS}, "Unexpected workflow")
    prefix = f"lawoss-{sha}-{run['id']}-{run['run_attempt']}-"
    labels = [x for x in job["labels"] if x.startswith(prefix)]
    require(len(labels) == 1 and re.fullmatch(r"[a-z][a-z0-9-]*", labels[0][len(prefix):]),
            "Job does not request this exact approved revision, run and attempt")
    lane = labels[0][len(prefix):]
    if lane == "probe":
        require(run["event"] == "workflow_dispatch", "Probe requires an operator dispatch")
    else:
        require(run["event"] == "pull_request" and lane in {"tests", "runtime", "package"},
                "Only unsigned same-repository PR checks are eligible")
        prs = run.get("pull_requests") or []
        require(len(prs) == 1, "Cannot identify a single PR for this job")
        pr = api(f"repos/{REPO}/pulls/{int(prs[0]['number'])}")
        require(pr["state"] == "open" and pr["head"]["repo"]["full_name"] == REPO
                and pr["head"]["sha"] == run["head_sha"] and pr["merge_commit_sha"] == sha,
                "PR head or test merge commit changed")
    return labels[0]


def group_for_job():
    group, = [g for g in api(f"orgs/{ORG}/actions/runner-groups")["runner_groups"] if g["name"] == GROUP]
    refs = group.get("selected_workflows") or []
    require(group["restricted_to_workflows"] and group["visibility"] == "selected" and refs,
            "Missing workflow or repository restrictions")
    for ref in refs:
        path, sep, version = ref.partition("@")
        require(sep and path in {f"{REPO}/.github/workflows/{f}" for f in WORKFLOWS}
                and (version == "refs/heads/dev" or re.fullmatch("[0-9a-f]{40}", version)),
                "Runner group contains an unapproved workflow reference")
    base = f"orgs/{ORG}/actions/runner-groups/{group['id']}"
    repos = api(base + "/repositories")
    require(repos["total_count"] == 1 and repos["repositories"][0]["full_name"] == REPO,
            "Runner group must be exclusive to LAWOSS")
    return group["id"]


def guest(vm, *args, **kwargs):
    return subprocess.run([TART, "exec", vm, *args], check=True, **kwargs)


def work(job_id, sha):
    job_path = f"repos/{REPO}/actions/jobs/{job_id}"
    job = api(job_path)
    run = api(f"repos/{REPO}/actions/runs/{job['run_id']}")
    label = admit(job, run, sha)
    group_id = group_for_job()
    require(NET.is_file(), f"Missing root-owned Softnet at {NET}")
    st = NET.stat()
    require(st.st_uid == 0 and st.st_gid == grp.getgrnam("admin").gr_gid and st.st_mode & 0o7777 == 0o4750,
            "Unexpected Softnet owner or permissions")
    for parent in (NET.parent, NET.parent.parent):
        st = parent.stat()
        require(not parent.is_symlink() and st.st_uid == 0 and not (st.st_mode & 0o022),
                "Unsafe network helper directory")
    require(not NET.is_symlink() and hashlib.sha256(NET.read_bytes()).hexdigest() == NET_HASH, "Softnet digest mismatch")
    env = {**os.environ, "PATH": f"{NET.parent}:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin",
           "TART_NO_AUTO_PRUNE": "1"}
    vm = f"lawoss-ci-{job_id}-{uuid.uuid4().hex[:8]}"
    process = runner = None
    cloned = False
    try:
        subprocess.run([TART, "clone", IMAGE, vm], env=env, check=True)
        cloned = True
        subprocess.run([TART, "set", vm, "--cpu", "6", "--memory", "12288", "--disk-size", "120"], check=True)
        process = subprocess.Popen([TART, "run", vm, "--no-graphics", "--no-audio", "--no-clipboard",
                                    "--net-softnet-block", BLOCK], env=env)
        end = time.monotonic() + 240
        while time.monotonic() < end and process.poll() is None:
            try:
                guest(vm, "/usr/bin/true", timeout=8, capture_output=True)
                break
            except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
                time.sleep(2)
        else:
            raise RuntimeError("Isolated guest failed to boot")
        with socket.socket() as canary:
            canary.bind(("0.0.0.0", 0))
            canary.listen()
            guest(vm, "/bin/bash", "-c", PREPARE, "guest", str(canary.getsockname()[1]), timeout=450)
        require(admit(api(job_path), run, sha) == label, "Job changed during provisioning")
        jit = api(f"orgs/{ORG}/actions/runners/generate-jitconfig",
                  {"name": vm, "runner_group_id": group_id, "labels": [label], "work_folder": "_work"})
        runner = jit["runner"]["id"]
        print(f"Starting isolated runner {vm} for {job['html_url']}", flush=True)
        # The host GitHub credential never enters the guest. Only the one-job configuration crosses stdin.
        subprocess.run([TART, "exec", "-i", vm, "/bin/bash", "-c", START],
                       input=jit.pop("encoded_jit_config") + "\n", text=True, check=True, timeout=TIMEOUT)
        result = api(job_path)
        require(result["runner_id"] == runner and result["conclusion"] == "success",
                f"Check job outcome on GitHub: {result['html_url']}")
    finally:
        try:
            if cloned:
                if process is not None and process.poll() is None:
                    subprocess.run([TART, "stop", vm], timeout=90, check=True)
                    process.wait(timeout=30)
                subprocess.run([TART, "delete", vm], check=True)
        finally:
            if runner:
                # DELETE is idempotent here only for a verified 404 from the individual runner endpoint.
                result = subprocess.run(["gh", "api", "-X", "DELETE", f"orgs/{ORG}/actions/runners/{runner}"],
                                        capture_output=True, text=True)
                require(result.returncode == 0 or "(HTTP 404)" in result.stderr, "Check runner cleanup on GitHub")


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("job_id", type=int)
    p.add_argument("approved_sha")
    args = p.parse_args()
    require(args.job_id > 0 and re.fullmatch("[0-9a-f]{40}", args.approved_sha), "A job ID and full SHA are required")
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))
    state = Path.home() / "Library/Caches/sk.lawoss.ci"
    state.mkdir(mode=0o700, parents=True, exist_ok=True)
    with (state / "worker.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        work(args.job_id, args.approved_sha)
