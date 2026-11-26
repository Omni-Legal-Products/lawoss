#!/bin/sh
# Install a pinned network helper from a reviewed source on the dedicated CI host.
set -eu
target=/Library/PrivilegedHelperTools/sk.lawoss.ci
digest=2ea5572268f814317bc3944d1352032f1f4dafe00bfe453eefc64e9dc32627a3
test "$(id -u)" = 0
export PATH=/usr/bin:/bin:/usr/sbin:/sbin
test ! -L "$target"
if test ! -d "$target"; then
    mkdir -m 0755 "$target"
fi
test "$(stat -f '%u:%g:%Lp' "$target")" = 0:0:755
staged=$(mktemp "$target/.softnet.XXXXXX")
trap 'rm -f "$staged"' EXIT
cat /opt/homebrew/opt/softnet/bin/softnet > "$staged"
printf '%s  %s\n' "$digest" "$staged" | shasum -a 256 -c -
chown root:admin "$staged"
chmod 4750 "$staged"
mv -f "$staged" "$target/softnet"
