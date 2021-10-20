#!/bin/sh -eux

# build dist tarball fist
"$(dirname "$0")"/scenario-dist.sh

# check translation build
make po/cockpit.pot
# do some spot checks
grep -q 'pkg/base1/cockpit.js' po/cockpit.pot
grep -q 'pkg/shell/hosts_dialog.jsx' po/cockpit.pot
grep -q 'pkg/systemd/services.html' po/cockpit.pot
grep -q 'pkg/static/login.html' po/cockpit.pot
grep -q 'pkg/systemd/manifest.json' po/cockpit.pot
grep -q 'src/bridge/cockpitpackages.c' po/cockpit.pot
! grep -q 'test-.*.js' po/cockpit.pot

# Check that we are lint clean
npm run eslint

# run full test-static-code with git tree (several tests get skipped during distcheck)
tools/test-static-code

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
