#! /bin/bash

set -eux

dev=$1

need_unmount=""

maybe_unmount () {
    if [ -n "$need_unmount" ]; then
        umount "$need_unmount"
        rmdir "$need_unmount"
    fi
}

trap maybe_unmount EXIT INT QUIT

mp=$(findmnt -no TARGET "$dev" | cat)
if [ -z "$mp" ]; then
    mp=$(mktemp -d)
    need_unmount=$mp
    mount "$dev" "$mp" -o ro
fi

# A filesystem is empty if it only has directories in it.

first=$(find "$mp" -not -type d | head -1)
info=$(stat -f -c '{ "unit": %S, "free": %f, "total": %b }' "$mp")

if [ -z "$first" ]; then
    echo yes
else
    echo "$info"
fi
