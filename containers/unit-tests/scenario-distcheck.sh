#!/bin/sh -eux

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
