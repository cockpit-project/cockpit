#!/bin/bash

set -o pipefail
set -eux

# copy host's source tree to avoid changing that, and make sure we have a clean tree
if [ ! -e /source/.git ]; then
    echo "This container must be run with --volume <host cockpit source checkout>:/source:ro" >&2
    exit 1
fi
git clone /source /tmp/source
[ ! -d /source/node_modules ] || cp -r /source/node_modules /tmp/source/
cd /tmp/source

# cross-build flags
ARCH=$(cat /arch)
case $ARCH in
    amd64) ;;
    i386)
        export CFLAGS=-m32
        export LDFLAGS=-m32
        ;;
    *)
        echo "Unknown architecture '$ARCH'" >&2
        exit 1
esac

./autogen.sh --prefix=/usr --enable-strict --with-systemdunitdir=/tmp
make -j2 V=1 all

# only run distcheck on main arch
if [ "$ARCH" = amd64 ]; then
    make -j8 distcheck
else
    make -j8 check
fi

make -j8 check-memory || {
    cat test-suite.log
    exit 1
}
