#!/bin/bash

if [ "$1" = "--build" ]; then
    BUILD_ONLY=1
elif [ -n "$1" ]; then
    echo 'Usage: run.sh [--build]' >&2
    exit 1
fi

set -o pipefail
set -eux

export LANG=C.UTF-8
export MAKEFLAGS="-j $(nproc)"

# Running the tests normally takes under half an hour.  Sometimes the build or
# (more usually) the tests will wedge.  After 50 minutes, print out some
# information about the running processes in order to give us a better chance
# of tracking down problems.
( set +x
  sleep 50m
  echo ===== 50 mins ====================
  ps auxwfe
  echo
  top -b -n1
  echo ===== 50 mins ====================
)&

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

./autogen.sh --prefix=/usr --enable-strict --with-systemdunitdir=/tmp

make V=1 all

if [ -n "${BUILD_ONLY:-}" ]; then
  exit 0
fi

# HACK: Before running the tests we need to make sure stdio is in blocking mode. We have
# not yet been able to figure out what is putting it non-blocknig.
python3 -c "import fcntl, os; map(lambda fd: fcntl.fcntl(fd, fcntl.F_SETFL, fcntl.fcntl(fd, fcntl.F_GETFL) &~ os.O_NONBLOCK), [0, 1, 2])"

if dpkg-architecture --is amd64; then
    # run distcheck on main arch
    make XZ_COMPRESS_FLAGS='-0' distcheck 2>&1
else
    # on i386, validate that "distclean" does not remove too much
    make dist-gzip
    mkdir _distcleancheck
    tar -C _distcleancheck -xf cockpit-[0-9]*.tar.gz
    cd _distcleancheck/cockpit-*
    ./configure
    make distclean
    ./configure
    make check 2>&1
fi

make check-memory 2>&1 || {
    cat test-suite.log
    exit 1
}
