#!/bin/sh

set -eu

srcdir="$(realpath -m "$0"/..)"

(cd "${srcdir}" && autoreconf -is --warnings obsolete)

# When calling this as part of cockpituous release-source, download cached dist/
if [ -n "${RELEASE_SOURCE:-}" ] && [ ! -d dist ]; then
    tools/webpack-jumpstart --wait
fi

[ -n "${NOCONFIGURE:-}" ] || exec "${srcdir}/configure" "$@"
