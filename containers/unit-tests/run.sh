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

# copy host's source tree to avoid changing that, and make sure we have a clean tree
if [ ! -e /source/.git ]; then
    echo "This container must be run with --volume <host cockpit source checkout>:/source:ro" >&2
    exit 1
fi
git clone /source /tmp/source
[ ! -d /source/node_modules ] || cp -r /source/node_modules /tmp/source/
cd /tmp/source

./autogen.sh --prefix=/usr --enable-strict --with-systemdunitdir=/tmp

make all

if [ -n "${BUILD_ONLY:-}" ]; then
  exit 0
fi

if dpkg-architecture --is amd64; then
    # run distcheck on main arch
    make XZ_COMPRESS_FLAGS='-0' V=0 distcheck 2>&1 || {
        find -name test-suite.log | xargs cat
        exit 1
    }

    # check translation build
    make po/cockpit.pot
    # do some spot checks
    grep -q 'pkg/base1/cockpit.js' po/cockpit.pot
    grep -q 'pkg/lib/machine-dialogs.js' po/cockpit.pot
    grep -q 'pkg/systemd/services.html' po/cockpit.pot
    grep -q 'pkg/static/login.html' po/cockpit.pot
    grep -q 'pkg/systemd/manifest.json.in' po/cockpit.pot
    grep -q 'src/bridge/cockpitpackages.c' po/cockpit.pot
    ! grep -q 'test-.*.js' po/cockpit.pot
else
    # on i386, validate that "distclean" does not remove too much
    make dist-gzip
    mkdir _distcleancheck
    tar -C _distcleancheck -xf cockpit-[0-9]*.tar.gz
    cd _distcleancheck/cockpit-*
    ./configure
    make distclean
    ./configure
    make check 2>&1 || {
        find -name test-suite.log | xargs cat
        exit 1
    }
fi

make check-memory 2>&1 || {
    cat test-suite.log
    exit 1
}
