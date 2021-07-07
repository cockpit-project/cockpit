#!/bin/sh

set -eu

echo 'ghp_STDOUTabcdefghijklmnopqrstuvwxyz0123'
echo 'ghp_STDERRabcdefghijklmnopqrstuvwxyz0123' >&2

srcdir="$(realpath -m "$0"/..)"

(cd "${srcdir}" && autoreconf -is)

[ -n "${NOCONFIGURE:-}" ] || exec "${srcdir}/configure" "$@"
