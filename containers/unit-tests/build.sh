#!/bin/sh -eux

# run -fanalyzer for default gcc
if [ -z "${CC:-}" ]; then
    export CFLAGS="-fanalyzer"
fi

./autogen.sh --prefix=/usr --enable-strict
