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

make NO_DIST_CACHE=1 dist

# container has a writable /results/ in the "dist" scenario, but not in others; copy dist tarball there
if [ -w /results ]; then
    cp cockpit-*.tar.xz /results/
fi
