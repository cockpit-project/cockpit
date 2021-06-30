#!/bin/sh

set -eu

srcdir="$(realpath -m "$0"/..)"

(cd "${srcdir}" && autoreconf -is)

[ -n "${NOCONFIGURE:-}" ] || exec "${srcdir}/configure" "$@"
