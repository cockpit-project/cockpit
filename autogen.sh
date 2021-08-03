#!/bin/sh

set -eu

srcdir="$(realpath -m "$0"/..)"

(cd "${srcdir}" && autoreconf -is --warnings obsolete)

[ -n "${NOCONFIGURE:-}" ] || exec "${srcdir}/configure" "$@"
