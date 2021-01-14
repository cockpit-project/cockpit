#! /bin/sh

set -euf

d=$HOME/.ssh
p=${2:-authorized_keys}
f=$d/$p

if ! test -f "$f"; then
    mkdir -m 700 -p "$d"
    touch "$f"
    chmod 600 "$f"
fi

while read l; do
    if [ "$l" = "$1" ]; then
        exit 0
    fi
done <"$f"

# Add newline if necessary
! test -s "$f" || tail -c1 < "$f" | read -r _ || echo >> "$f"

echo "$1" >>"$f"
