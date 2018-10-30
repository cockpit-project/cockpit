#!/bin/bash

set -o pipefail
set -eux

export LANG=C.UTF-8

# HACK: Something invoked by our build system is setting stdio to non-blocking.
# Validate that this isn't the surrounding context. See more below.
python3 -c "import fcntl, os; assert fcntl.fcntl(0, fcntl.F_GETFL) & os.O_NONBLOCK == 0; assert fcntl.fcntl(1, fcntl.F_GETFL) & os.O_NONBLOCK == 0; assert fcntl.fcntl(2, fcntl.F_GETFL) & os.O_NONBLOCK == 0"

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

bots/test-bots

# bots/ is by and large an independent project, and for supporting stable
# ranches, we want build/check/dist to work without it; so run everything
# without bots/ in one run (to make sure this works), and keep it in the
# others (to make sure its existence does not break anything)
if [ "${CC:-}" = clang ]; then
    rm -rf bots
fi

./autogen.sh --prefix=/usr --enable-strict --with-systemdunitdir=/tmp

make V=1 all

# HACK: Before running the tests we need to make sure stdio is in blocking mode. We have
# not yet been able to figure out what is putting it non-blocknig.
python3 -c "import fcntl, os; map(lambda fd: fcntl.fcntl(fd, fcntl.F_SETFL, fcntl.fcntl(fd, fcntl.F_GETFL) &~ os.O_NONBLOCK), [0, 1, 2])"

# only run distcheck on main arch
if [ "$ARCH" = amd64 ]; then
    make -j8 distcheck 2>&1
else
    make -j8 check 2>&1
fi

make -j8 check-memory 2>&1 || {
    cat test-suite.log
    exit 1
}
