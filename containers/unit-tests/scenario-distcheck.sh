#!/bin/sh -eux

if [ "${NO_NPM:-}" = "1" ]; then
    # We can't 'make dist' with NO_NPM, so unset it and finish the build
    unset NO_NPM
    test ! -d /tmp/source/node_modules # this shouldn't be here
    if [ -d /source/node_modules ]; then
        cp -r /source/node_modules /tmp/source
    fi
    tools/npm-install
    test -d /tmp/source/node_modules # this must surely be here now
    make
fi

make XZ_COMPRESS_FLAGS='-0' V=0 distcheck 2>&1 || {
  find -name test-suite.log | xargs cat
  exit 1
}

# check translation build
make po/cockpit.pot
# do some spot checks
grep -q 'pkg/base1/cockpit.js' po/cockpit.pot
grep -q 'pkg/shell/machines/machine-dialogs.js' po/cockpit.pot
grep -q 'pkg/systemd/services.html' po/cockpit.pot
grep -q 'pkg/static/login.html' po/cockpit.pot
grep -q 'pkg/systemd/manifest.json.in' po/cockpit.pot
grep -q 'src/bridge/cockpitpackages.c' po/cockpit.pot
! grep -q 'test-.*.js' po/cockpit.pot

# validate that "distclean" does not remove too much
mkdir _distcleancheck
tar -C _distcleancheck -xf cockpit-[0-9]*.tar.xz
cd _distcleancheck/cockpit-*
./configure
make distclean
./configure
make check 2>&1 || {
    find -name test-suite.log | xargs cat
    exit 1
}
