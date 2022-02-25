#!/bin/sh

set -eu

srcdir="$(realpath -m "$0"/..)"

(cd "${srcdir}" && autoreconf -is --warnings obsolete)
[ -n "${NOCONFIGURE:-}" ] && exit

case "${1:-}" in
    mock)
        # broken configuration with as few deps as possible
        # mostly only useful for running `make dep`
        exec ./configure \
            CPPFLAGS=-Itools/mock-build-env \
            PKG_CONFIG_PATH=tools/mock-build-env \
            --enable-prefix-only \
            --disable-pcp \
            --disable-polkit \
            --disable-ssh \
        ;;

    rpm)
        # configure with the same flags as when building an RPM
        mkdir -p tmp/rpmbuild/SPECS
        tools/create-spec -v 0 -o tmp/rpmbuild/SPECS/cockpit.spec tools/cockpit.spec.in
        exec rpmbuild -D '_topdir tmp/rpmbuild' -D 'make_build #' \
            --build-in-place -bc tmp/rpmbuild/SPECS/cockpit.spec ;;

    *)
        exec "${srcdir}/configure" "$@" ;;
esac
