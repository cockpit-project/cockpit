#!/bin/sh -eux

make XZ_OPT=-0 dist

# container has a writable /results/ in the "dist" scenario, but not in others; copy dist tarball there
if [ -w /results ]; then
    cp cockpit-*.tar.xz /results/
fi
