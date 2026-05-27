#!/bin/sh

set -eu

srcdir="${0%/*}"

(
    cd "${srcdir}"
    echo "m4_define(VERSION_NUMBER, [$(git describe --tags --abbrev=0)+git])" > version.m4
    # Ensure branding is generated for the current OS before configuring
    echo "Checking branding requirements..."
    python3 ensure-branding.py
    autoreconf -i --warnings obsolete
)

[ -n "${NOCONFIGURE:-}" ] && exit

case "${1:-}" in
    rpm)
        # configure with the same flags as when building an RPM
        exec rpmbuild -D '_topdir tmp/rpmbuild' -D 'make_build #' \
            --build-in-place -bc tools/cockpit.spec ;;

    *)
        exec "${srcdir}/configure" "$@" ;;
esac
